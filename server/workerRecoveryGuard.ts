import { desc, eq, gte } from "drizzle-orm";
import { pipelineRuns } from "../drizzle/schema";
import { getDb, getSystemKv, setSystemKv } from "./db";
import {
  classifyPipelineRun,
  expectedRunWindowKey,
  selfHealingDecision,
  type PersistedPipelineRunState,
} from "./pipelineRunReliability";
import { runRecoveryPipeline } from "./pipelineRecovery";

export const EXPECTED_PIPELINE_HOUR_UTC = 20;

export type WorkerRecoveryOutcome =
  | "recovery_completed"
  | "recovery_failed"
  | "recovery_not_needed"
  | "recovery_blocked_running"
  | "recovery_already_attempted";

export function workerExpectedWindowStart(now: Date): Date {
  const start = new Date(now);
  start.setUTCHours(EXPECTED_PIPELINE_HOUR_UTC, 0, 0, 0);
  if (now < start) start.setUTCDate(start.getUTCDate() - 1);
  return start;
}

async function loadAnyRunningRun(): Promise<PersistedPipelineRunState | null> {
  const db = await getDb();
  if (!db) return null;
  const [run] = await db
    .select({
      id: pipelineRuns.id,
      status: pipelineRuns.status,
      startedAt: pipelineRuns.startedAt,
      completedAt: pipelineRuns.completedAt,
      lastProgressAt: pipelineRuns.lastProgressAt,
      currentStep: pipelineRuns.currentStep,
      triggeredBy: pipelineRuns.triggeredBy,
    })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.status, "running"))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  return run ?? null;
}

async function loadWindowRun(windowStart: Date): Promise<PersistedPipelineRunState | null> {
  const db = await getDb();
  if (!db) return null;
  const [run] = await db
    .select({
      id: pipelineRuns.id,
      status: pipelineRuns.status,
      startedAt: pipelineRuns.startedAt,
      completedAt: pipelineRuns.completedAt,
      lastProgressAt: pipelineRuns.lastProgressAt,
      currentStep: pipelineRuns.currentStep,
      triggeredBy: pipelineRuns.triggeredBy,
    })
    .from(pipelineRuns)
    .where(gte(pipelineRuns.startedAt, windowStart))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  return run ?? null;
}

export async function attemptWorkerRecovery(now: Date = new Date()): Promise<WorkerRecoveryOutcome> {
  const windowStart = workerExpectedWindowStart(now);
  const running = await loadAnyRunningRun();
  if (running) return "recovery_blocked_running";

  const classified = classifyPipelineRun(await loadWindowRun(windowStart), now);
  const decision = selfHealingDecision(classified.health);
  if (decision === "skip_completed") return "recovery_not_needed";
  if (decision === "skip_healthy_running" || decision === "block_stale_running") {
    return "recovery_blocked_running";
  }

  const windowKey = expectedRunWindowKey(windowStart);
  if (await getSystemKv("ops.v2.selfHealingWindow") === windowKey) {
    return "recovery_already_attempted";
  }

  // Mark before execution so an exception before row creation cannot create a
  // repeat storm. A controller can later clear only under an explicit runbook.
  await setSystemKv("ops.v2.selfHealingWindow", windowKey);
  const result = await runRecoveryPipeline();
  return result.status === "completed" ? "recovery_completed" : "recovery_failed";
}
