import { and, desc, eq, gt } from "drizzle-orm";
import { pipelineRuns } from "../drizzle/schema";
import { getDb } from "./db";

export type SupervisedPipelineTrigger = "cron" | "self-healing-retry";

export const PIPELINE_SUPERVISOR_HEARTBEAT_MS = 2 * 60 * 1000;
export const APOLLO_GAP_FILL_WALL_CLOCK_LIMIT_MS = 15 * 60 * 1000;

export interface OwnedPipelineRunSnapshot {
  id: number;
  status: "running" | "completed" | "failed";
  triggeredBy: string | null;
  startedAt: Date;
  completedAt: Date | null;
  lastProgressAt: Date | null;
  currentStep: string | null;
  lastActivityNote: string | null;
  errors: string[] | null;
}

export interface SupervisorObservationState {
  currentStep: string | null;
  currentStepObservedAtMs: number | null;
}

export type SupervisorDecision =
  | { action: "continue"; nextState: SupervisorObservationState }
  | { action: "terminate_apollo_timeout"; nextState: SupervisorObservationState };

function runProjection() {
  return {
    id: pipelineRuns.id,
    status: pipelineRuns.status,
    triggeredBy: pipelineRuns.triggeredBy,
    startedAt: pipelineRuns.startedAt,
    completedAt: pipelineRuns.completedAt,
    lastProgressAt: pipelineRuns.lastProgressAt,
    currentStep: pipelineRuns.currentStep,
    lastActivityNote: pipelineRuns.lastActivityNote,
    errors: pipelineRuns.errors,
  };
}

export function observeOwnedRun(
  snapshot: Pick<OwnedPipelineRunSnapshot, "currentStep">,
  previous: SupervisorObservationState,
  nowMs: number,
  apolloLimitMs: number = APOLLO_GAP_FILL_WALL_CLOCK_LIMIT_MS,
): SupervisorDecision {
  const stepChanged = snapshot.currentStep !== previous.currentStep;
  const nextState: SupervisorObservationState = stepChanged
    ? {
        currentStep: snapshot.currentStep,
        currentStepObservedAtMs: snapshot.currentStep ? nowMs : null,
      }
    : previous;

  if (
    snapshot.currentStep === "Apollo Gap-Fill" &&
    nextState.currentStepObservedAtMs !== null &&
    nowMs - nextState.currentStepObservedAtMs >= apolloLimitMs
  ) {
    return { action: "terminate_apollo_timeout", nextState };
  }

  return { action: "continue", nextState };
}

export async function loadAnyRunningPipelineRun(): Promise<OwnedPipelineRunSnapshot | null> {
  const db = await getDb();
  if (!db) return null;
  const [run] = await db
    .select(runProjection())
    .from(pipelineRuns)
    .where(eq(pipelineRuns.status, "running"))
    .orderBy(desc(pipelineRuns.id))
    .limit(1);
  return (run as OwnedPipelineRunSnapshot | undefined) ?? null;
}

/** Snapshot the highest existing row for this trigger before owned execution. */
export async function loadLatestPipelineRunForTrigger(
  trigger: SupervisedPipelineTrigger,
): Promise<OwnedPipelineRunSnapshot | null> {
  const db = await getDb();
  if (!db) return null;
  const [run] = await db
    .select(runProjection())
    .from(pipelineRuns)
    .where(eq(pipelineRuns.triggeredBy, trigger))
    .orderBy(desc(pipelineRuns.id))
    .limit(1);
  return (run as OwnedPipelineRunSnapshot | undefined) ?? null;
}

/**
 * Identify a row created after this process took its pre-execution ID snapshot.
 * Ownership is based on monotonic auto-increment ID rather than startedAt:
 * MySQL timestamp columns are persisted at lower precision than JavaScript
 * Date values, so millisecond timestamp comparisons can miss the process's own
 * row when both occur in the same second.
 */
export async function loadLatestOwnedPipelineRun(
  trigger: SupervisedPipelineTrigger,
  previousRunId: number | null,
): Promise<OwnedPipelineRunSnapshot | null> {
  const db = await getDb();
  if (!db) return null;
  const where = previousRunId === null
    ? eq(pipelineRuns.triggeredBy, trigger)
    : and(
        eq(pipelineRuns.triggeredBy, trigger),
        gt(pipelineRuns.id, previousRunId),
      );
  const [run] = await db
    .select(runProjection())
    .from(pipelineRuns)
    .where(where)
    .orderBy(desc(pipelineRuns.id))
    .limit(1);
  return (run as OwnedPipelineRunSnapshot | undefined) ?? null;
}

/**
 * Supervisor heartbeat means only that the dedicated owned process is alive.
 * It deliberately does not claim a step completed or produced business output.
 * The process supervisor separately enforces an Apollo wall-clock boundary.
 */
export async function heartbeatOwnedPipelineRun(
  trigger: SupervisedPipelineTrigger,
  previousRunId: number | null,
  now: Date = new Date(),
): Promise<OwnedPipelineRunSnapshot | null> {
  const run = await loadLatestOwnedPipelineRun(trigger, previousRunId);
  if (!run || run.status !== "running") return run;

  const db = await getDb();
  if (!db) return run;
  const step = run.currentStep || "unknown step";
  await db.update(pipelineRuns)
    .set({
      lastProgressAt: now,
      lastActivityNote: `Supervisor heartbeat: owned process alive at ${step}; step completion not implied.`,
    })
    .where(and(
      eq(pipelineRuns.id, run.id),
      eq(pipelineRuns.status, "running"),
      eq(pipelineRuns.triggeredBy, trigger),
    ));

  return { ...run, lastProgressAt: now };
}

function appendBoundedError(existing: string[] | null, reason: string): string[] {
  const preserved = Array.isArray(existing) ? existing.filter(value => typeof value === "string") : [];
  if (!preserved.includes(reason)) preserved.push(reason);
  return preserved;
}

/**
 * Finalise only the newest row created after this owned process took its
 * pre-execution run-ID snapshot. This is used only while the process is
 * terminating, never while an unknown writer could still be alive.
 */
export async function finalizeOwnedPipelineRun(
  trigger: SupervisedPipelineTrigger,
  previousRunId: number | null,
  reason: string,
  completedAt: Date = new Date(),
): Promise<{ finalized: boolean; runId: number | null }> {
  const run = await loadLatestOwnedPipelineRun(trigger, previousRunId);
  if (!run || run.status !== "running") {
    return { finalized: false, runId: run?.id ?? null };
  }

  const db = await getDb();
  if (!db) return { finalized: false, runId: run.id };

  await db.update(pipelineRuns)
    .set({
      status: "failed",
      completedAt,
      currentStep: null,
      errors: appendBoundedError(run.errors, reason),
      lastActivityNote: reason,
    })
    .where(and(
      eq(pipelineRuns.id, run.id),
      eq(pipelineRuns.status, "running"),
      eq(pipelineRuns.triggeredBy, trigger),
    ));

  const [after] = await db
    .select({ id: pipelineRuns.id, status: pipelineRuns.status })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, run.id))
    .limit(1);
  return {
    finalized: after?.status === "failed",
    runId: run.id,
  };
}
