export const MANUAL_PIPELINE_TIMEOUT_MS = 90 * 60 * 1000;
export const AUTOMATED_PIPELINE_TIMEOUT_MS = 180 * 60 * 1000;

const AUTOMATED_TRIGGERS = new Set([
  "cron",
  "scheduled-task",
  "scheduled-task-secret",
  "self-healing-retry",
]);

/**
 * Dedicated cron/self-healing execution gets a larger wall-clock budget than
 * interactive/manual execution. This fixes the 90-minute cron cutoff without
 * weakening the web/manual safety limit.
 */
export function selectPipelineRuntimeBudgetMs(triggeredBy?: string | null): number {
  const trigger = (triggeredBy ?? "").trim().toLowerCase();
  return AUTOMATED_TRIGGERS.has(trigger)
    ? AUTOMATED_PIPELINE_TIMEOUT_MS
    : MANUAL_PIPELINE_TIMEOUT_MS;
}

export function isAutomatedPipelineTrigger(triggeredBy?: string | null): boolean {
  return selectPipelineRuntimeBudgetMs(triggeredBy) === AUTOMATED_PIPELINE_TIMEOUT_MS;
}
