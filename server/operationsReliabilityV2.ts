import { desc, eq, gte } from "drizzle-orm";
import { getDb, getSystemKv, setSystemKv } from "./db";
import { pipelineRuns } from "../drizzle/schema";
import { notifyOwner } from "./_core/notification";
import { runDailyPipeline } from "./dailyPipeline";
import {
  PIPELINE_STALL_MINUTES,
  classifyPipelineRun,
  expectedRunWindowKey,
  selfHealingDecision,
  staleRunMessage,
  type ClassifiedPipelineRun,
  type PersistedPipelineRunState,
} from "./pipelineRunReliability";

const LOG_PREFIX = "[OpsReliabilityV2]";
const EXPECTED_RUN_HOUR_UTC = 20;
const RETRY_DELAY_MINUTES = 10;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const NOTIFICATION_COOLDOWN_HOURS = 6;

let started = false;
let selfHealingInFlight = false;
let attemptCount = 0;
let lastAttemptAt: Date | null = null;

export function expectedWindowStart(now: Date): Date {
  const start = new Date(now);
  start.setUTCHours(EXPECTED_RUN_HOUR_UTC, 0, 0, 0);
  if (now < start) start.setUTCDate(start.getUTCDate() - 1);
  return start;
}

function pipelineRunProjection() {
  return {
    id: pipelineRuns.id,
    status: pipelineRuns.status,
    startedAt: pipelineRuns.startedAt,
    completedAt: pipelineRuns.completedAt,
    lastProgressAt: pipelineRuns.lastProgressAt,
    currentStep: pipelineRuns.currentStep,
    triggeredBy: pipelineRuns.triggeredBy,
  };
}

async function loadAnyRunningRun(): Promise<PersistedPipelineRunState | null> {
  const db = await getDb();
  if (!db) return null;
  const [run] = await db
    .select(pipelineRunProjection())
    .from(pipelineRuns)
    .where(eq(pipelineRuns.status, "running"))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  return run ?? null;
}

async function loadExpectedWindowRun(now = new Date()): Promise<PersistedPipelineRunState | null> {
  const db = await getDb();
  if (!db) return null;
  const [run] = await db
    .select(pipelineRunProjection())
    .from(pipelineRuns)
    .where(gte(pipelineRuns.startedAt, expectedWindowStart(now)))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  return run ?? null;
}

/**
 * Running writer ownership always wins over the expected-window row. This is
 * critical when yesterday's worker is orphaned but today's window is missing
 * or failed: self-healing must not create a second writer alongside it.
 */
export async function getExpectedRunHealth(now = new Date()): Promise<ClassifiedPipelineRun> {
  const running = await loadAnyRunningRun();
  if (running) return classifyPipelineRun(running, now);
  return classifyPipelineRun(await loadExpectedWindowRun(now), now);
}

async function notifyWithCooldown(title: string, content: string): Promise<void> {
  const key = "ops.v2.lastReliabilityNotificationAt";
  const stored = await getSystemKv(key);
  if (stored) {
    const previous = new Date(stored);
    if (Number.isFinite(previous.getTime())) {
      const ageHours = (Date.now() - previous.getTime()) / 3_600_000;
      if (ageHours < NOTIFICATION_COOLDOWN_HOURS) return;
    }
  }
  await notifyOwner({ title, content });
  await setSystemKv(key, new Date().toISOString());
}

async function retryAlreadyAttempted(windowStart: Date): Promise<boolean> {
  const stored = await getSystemKv("ops.v2.selfHealingWindow");
  return stored === expectedRunWindowKey(windowStart);
}

async function markRetryAttempted(windowStart: Date): Promise<void> {
  await setSystemKv("ops.v2.selfHealingWindow", expectedRunWindowKey(windowStart));
}

export type SelfHealingOutcome =
  | "retry_succeeded"
  | "retry_failed"
  | "retry_in_flight"
  | "retry_already_attempted"
  | "skipped_completed"
  | "skipped_healthy_running"
  | "blocked_stale_running";

export async function attemptStatusAwareSelfHealing(now = new Date()): Promise<SelfHealingOutcome> {
  if (selfHealingInFlight) return "retry_in_flight";

  const classified = await getExpectedRunHealth(now);
  const decision = selfHealingDecision(classified.health);

  if (decision === "skip_completed") {
    console.log(`${LOG_PREFIX} Expected run already completed (run ${classified.runId})`);
    return "skipped_completed";
  }
  if (decision === "skip_healthy_running") {
    console.log(`${LOG_PREFIX} Persisted pipeline writer is healthy and still running (run ${classified.runId})`);
    return "skipped_healthy_running";
  }
  if (decision === "block_stale_running") {
    const message = staleRunMessage(classified);
    console.error(`${LOG_PREFIX} ${message}; automatic retry blocked to prevent concurrent writers`);
    await notifyWithCooldown(
      "⚠️ Pipeline STALLED mid-run",
      `${message}.\n\nAutomatic retry was NOT started because the previous worker may still be alive. Clear or terminate the stale execution plane before retrying.`,
    );
    return "blocked_stale_running";
  }

  const windowStart = expectedWindowStart(now);
  if (await retryAlreadyAttempted(windowStart)) {
    console.warn(`${LOG_PREFIX} Self-healing retry already attempted for ${expectedRunWindowKey(windowStart)}; no repeat retry`);
    return "retry_already_attempted";
  }

  await markRetryAttempted(windowStart);
  selfHealingInFlight = true;
  attemptCount++;
  lastAttemptAt = new Date();
  try {
    console.log(`${LOG_PREFIX} Starting bounded self-healing retry #${attemptCount}; prior state=${classified.health}`);
    await runDailyPipeline("self-healing-retry");
    console.log(`${LOG_PREFIX} Self-healing retry completed successfully`);
    return "retry_succeeded";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} Self-healing retry failed: ${message}`);
    await notifyWithCooldown(
      "⚠️ Pipeline Self-Healing Failed",
      `A status-aware self-healing retry was actually started and failed.\n\nError: ${message}\n\nNo additional automatic retry will be started for this run window.`,
    );
    return "retry_failed";
  } finally {
    selfHealingInFlight = false;
  }
}

async function reliabilityCheck(): Promise<void> {
  try {
    const now = new Date();
    const windowStart = expectedWindowStart(now);
    const retryEligibleAt = new Date(windowStart);
    retryEligibleAt.setUTCMinutes(RETRY_DELAY_MINUTES);
    if (now < retryEligibleAt) return;

    const outcome = await attemptStatusAwareSelfHealing(now);
    if (outcome === "retry_succeeded") {
      await notifyWithCooldown(
        "✅ Pipeline Self-Healing Succeeded",
        "The expected pipeline run was missing or failed. A status-aware retry was actually started and completed successfully.",
      );
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Reliability check failed:`, error);
  }
}

async function startupReliabilityScan(): Promise<void> {
  try {
    const classified = await getExpectedRunHealth(new Date());
    if (classified.health === "stale_running") {
      const message = staleRunMessage(classified);
      console.error(`${LOG_PREFIX} Startup detected stale writer: ${message}`);
      await notifyWithCooldown(
        "⚠️ Pipeline stale run detected on startup",
        `${message}.\n\nThe row was NOT auto-failed because worker ownership cannot be proven safely. Duplicate automatic execution remains blocked.`,
      );
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Startup reliability scan failed:`, error);
  }
}

export function handleWarmup(_req: any, res: any): void {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    uptime: process.uptime(),
    reliabilityVersion: 2,
    stallThresholdMinutes: PIPELINE_STALL_MINUTES,
    selfHealingInFlight,
    selfHealingAttempts: attemptCount,
    lastSelfHealingAttempt: lastAttemptAt?.toISOString() ?? null,
  });
}

export function startOperationsReliability(): void {
  if (started) return;
  started = true;
  if (process.env.DISABLE_SELF_HEALING === "true") {
    console.log(`${LOG_PREFIX} Disabled by DISABLE_SELF_HEALING=true`);
    return;
  }

  console.log(`${LOG_PREFIX} Status-aware reliability checker started (30 min interval, ${PIPELINE_STALL_MINUTES} min progress-stall threshold)`);
  void startupReliabilityScan();

  setTimeout(() => {
    void reliabilityCheck();
    setInterval(() => void reliabilityCheck(), CHECK_INTERVAL_MS);
  }, 5 * 60 * 1000);
}
