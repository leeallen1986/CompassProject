export const PIPELINE_STALL_MINUTES = 60;

export type PersistedPipelineRunState = {
  id: number;
  status: "running" | "completed" | "failed";
  startedAt: Date | string;
  completedAt?: Date | string | null;
  lastProgressAt?: Date | string | null;
  currentStep?: string | null;
  triggeredBy?: string | null;
};

export type PipelineRunHealth =
  | "missing"
  | "healthy_running"
  | "stale_running"
  | "completed"
  | "failed";

export interface ClassifiedPipelineRun {
  health: PipelineRunHealth;
  runId: number | null;
  progressAgeMinutes: number | null;
  currentStep: string | null;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function classifyPipelineRun(
  run: PersistedPipelineRunState | null | undefined,
  now: Date = new Date(),
  stallMinutes: number = PIPELINE_STALL_MINUTES,
): ClassifiedPipelineRun {
  if (!run) {
    return { health: "missing", runId: null, progressAgeMinutes: null, currentStep: null };
  }
  if (run.status === "completed") {
    return { health: "completed", runId: run.id, progressAgeMinutes: null, currentStep: run.currentStep ?? null };
  }
  if (run.status === "failed") {
    return { health: "failed", runId: run.id, progressAgeMinutes: null, currentStep: run.currentStep ?? null };
  }

  const progressAt = asDate(run.lastProgressAt) ?? asDate(run.startedAt);
  const progressAgeMinutes = progressAt
    ? Math.max(0, (now.getTime() - progressAt.getTime()) / 60_000)
    : Number.POSITIVE_INFINITY;
  return {
    health: progressAgeMinutes > stallMinutes ? "stale_running" : "healthy_running",
    runId: run.id,
    progressAgeMinutes,
    currentStep: run.currentStep ?? null,
  };
}

export type SelfHealingDecision =
  | "retry"
  | "skip_completed"
  | "skip_healthy_running"
  | "block_stale_running";

export function selfHealingDecision(health: PipelineRunHealth): SelfHealingDecision {
  if (health === "missing" || health === "failed") return "retry";
  if (health === "completed") return "skip_completed";
  if (health === "healthy_running") return "skip_healthy_running";
  return "block_stale_running";
}

export type ScheduledTriggerDecision =
  | "allow"
  | "block_healthy_running"
  | "block_stale_running";

export function scheduledTriggerDecision(health: PipelineRunHealth): ScheduledTriggerDecision {
  if (health === "healthy_running") return "block_healthy_running";
  if (health === "stale_running") return "block_stale_running";
  return "allow";
}

export function expectedRunWindowKey(windowStart: Date): string {
  return windowStart.toISOString().slice(0, 13);
}

export function staleRunMessage(classified: ClassifiedPipelineRun): string {
  const age = classified.progressAgeMinutes === null ? "unknown" : `${Math.round(classified.progressAgeMinutes)} min`;
  const step = classified.currentStep ? ` at ${classified.currentStep}` : "";
  return `Pipeline run ${classified.runId ?? "unknown"} has made no recorded progress for ${age}${step}`;
}
