import { and, desc, eq, gte } from "drizzle-orm";
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
import {
  classifyPersistedSelfHealingRetry,
  selfHealingFailureSummary,
  type PersistedSelfHealingRetry,
} from "./selfHealingRetryTruth";

const LOG_PREFIX = "[OpsReliabilityV2]";
const EXPECTED_RUN_HOUR_UTC = 20;
const RETRY_DELAY_MINUTES = 10;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const NOTIFICATION_COOLDOWN_HOURS = 6;
const LAST_NOTIFIED_WORKER_RECOVERY_KEY = "ops.v2.lastNotifiedSelfHealingRunId";

/**
 * Issue #104 v2: automatic recovery belongs to the dedicated worker plane.
 * The web service is an observer by default because an in-process timer can be
 * suspended/restarted independently of the worker and cannot safely own a
 * long-running production writer. The old execution path is retained only as
 * an explicit emergency compatibility switch.
 */
const WEB_SELF_HEALING_ENABLED = process.env.ENABLE_WEB_SELF_HEALING === "true";

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

function selfHealingRetryProjection() {
  return {
    id: pipelineRuns.id,
    status: pipelineRuns.status,
    triggeredBy: pipelineRuns.triggeredBy,
    steps: pipelineRuns.steps,
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

async function loadLatestSelfHealingRetry(): Promise<PersistedSelfHealingRetry | null> {
  const db = await getDb();
  if (!db) return null;
  const [run] = await db
    .select(selfHealingRetryProjection())
    .from(pipelineRuns)
    .where(eq(pipelineRuns.triggeredBy, "self-healing-retry"))
    .orderBy(desc(pipelineRuns.id))
    .limit(1);
  return run ?? null;
}

async function loadWindowSelfHealingRetry(windowStart: Date): Promise<PersistedSelfHealingRetry | null> {
  const db = await getDb();
  if (!db) return null;
  const [run] = await db
    .select(selfHealingRetryProjection())
    .from(pipelineRuns)
    .where(and(
      eq(pipelineRuns.triggeredBy, "self-healing-retry"),
      gte(pipelineRuns.startedAt, windowStart),
    ))
    .orderBy(desc(pipelineRuns.id))
    .limit(1);
  return run ?? null;
}

async function loadNewRetryTruth(previousRetryId: number | null) {
  const latest = await loadLatestSelfHealingRetry();
  return classifyPersistedSelfHealingRetry(
    latest && latest.id !== previousRetryId ? latest : null,
  );
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

async function notifyRetryFailure(summary: string): Promise<void> {
  await notifyWithCooldown(
    "⚠️ Pipeline Self-Healing Failed",
    `${summary}\n\nNo additional automatic retry will be started for this run window.`,
  );
}

/**
 * Worker recovery notifications are keyed to the persisted retry row rather
 * than a web-process Promise. This preserves Issue #115 truth while keeping
 * production writer ownership on the dedicated worker. A per-run marker is
 * used instead of the generic six-hour cooldown so a result is never silently
 * suppressed by an earlier stale-run alert.
 */
async function notifyWorkerRecoveryTruth(windowStart: Date): Promise<void> {
  if (WEB_SELF_HEALING_ENABLED) return;
  const run = await loadWindowSelfHealingRetry(windowStart);
  if (!run || run.status === "running") return;

  const alreadyNotified = await getSystemKv(LAST_NOTIFIED_WORKER_RECOVERY_KEY);
  if (alreadyNotified === String(run.id)) return;

  const truth = classifyPersistedSelfHealingRetry(run);
  if (truth.succeeded) {
    await notifyOwner({
      title: "✅ Pipeline Self-Healing Succeeded",
      content: `Dedicated-worker recovery run ${truth.runId} reached persisted status completed.`,
    });
  } else {
    await notifyOwner({
      title: "⚠️ Pipeline Self-Healing Failed",
      content: `${selfHealingFailureSummary(truth)}\n\nNo additional automatic recovery will be started for this run window.`,
    });
  }
  await setSystemKv(LAST_NOTIFIED_WORKER_RECOVERY_KEY, String(run.id));
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
  | "blocked_stale_running"
  | "worker_recovery_pending";

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
    console.warn(`${LOG_PREFIX} Worker recovery already attempted for ${expectedRunWindowKey(windowStart)}; no repeat retry`);
    return "retry_already_attempted";
  }

  if (!WEB_SELF_HEALING_ENABLED) {
    console.warn(
      `${LOG_PREFIX} Expected run is ${classified.health}; web execution is disabled and the dedicated worker recovery cron owns the retry.`,
    );
    return "worker_recovery_pending";
  }

  // Explicit compatibility path only. Production default is worker-owned
  // recovery; keeping this path allows a controlled rollback without losing
  // the Issue #115 persisted-status truth boundary.
  const previousRetryId = (await loadLatestSelfHealingRetry())?.id ?? null;
  await markRetryAttempted(windowStart);
  selfHealingInFlight = true;
  attemptCount++;
  lastAttemptAt = new Date();
  try {
    console.log(`${LOG_PREFIX} Starting legacy web self-healing retry #${attemptCount}; prior state=${classified.health}`);
    await runDailyPipeline("self-healing-retry");

    const truth = await loadNewRetryTruth(previousRetryId);
    if (!truth.succeeded) {
      console.error(`${LOG_PREFIX} Self-healing retry resolved without persisted success`, {
        runId: truth.runId,
        persistedState: truth.state,
        criticalFailures: truth.criticalFailures,
      });
      await notifyRetryFailure(selfHealingFailureSummary(truth));
      return "retry_failed";
    }

    console.log(`${LOG_PREFIX} Self-healing retry persisted completed status (run ${truth.runId})`);
    return "retry_succeeded";
  } catch (error) {
    const truth = await loadNewRetryTruth(previousRetryId);
    const errorType = error instanceof Error ? error.name : typeof error;
    console.error(`${LOG_PREFIX} Self-healing retry execution threw`, {
      errorType,
      runId: truth.runId,
      persistedState: truth.state,
      criticalFailures: truth.criticalFailures,
    });
    const summary = truth.runId !== null
      ? selfHealingFailureSummary(truth)
      : "The self-healing retry execution threw before a completed persisted result could be confirmed.";
    await notifyRetryFailure(summary);
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

    await notifyWorkerRecoveryTruth(windowStart);
    const outcome = await attemptStatusAwareSelfHealing(now);
    if (outcome === "retry_succeeded") {
      await notifyWithCooldown(
        "✅ Pipeline Self-Healing Succeeded",
        "The expected pipeline run was missing or failed. A status-aware retry was actually started and its persisted pipeline status is completed.",
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
    recoveryExecutionPlane: WEB_SELF_HEALING_ENABLED ? "web_legacy_override" : "dedicated_worker",
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

  console.log(
    `${LOG_PREFIX} Reliability observer started (30 min interval, ${PIPELINE_STALL_MINUTES} min progress-stall threshold, recovery plane=${WEB_SELF_HEALING_ENABLED ? "web legacy override" : "dedicated worker"})`,
  );
  void startupReliabilityScan();

  setTimeout(() => {
    void reliabilityCheck();
    setInterval(() => void reliabilityCheck(), CHECK_INTERVAL_MS);
  }, 5 * 60 * 1000);
}
