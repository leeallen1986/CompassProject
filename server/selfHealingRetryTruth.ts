export const SELF_HEALING_CRITICAL_STEP_NAMES = new Set([
  "RSS Harvest",
  "AI Extraction",
  "Tier Classification",
  "Staleness Check",
  "Source Monitoring Snapshot",
]);

export interface PersistedSelfHealingRetry {
  id: number;
  status: string;
  triggeredBy?: string | null;
  steps?: unknown;
}

export type PersistedRetryState = "completed" | "failed" | "incomplete" | "missing";

export interface SelfHealingRetryTruth {
  runId: number | null;
  state: PersistedRetryState;
  succeeded: boolean;
  criticalFailures: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function criticalFailuresFromSteps(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  const failures = new Set<string>();
  for (const step of steps) {
    if (!isRecord(step)) continue;
    const name = typeof step.name === "string" ? step.name : "";
    const status = typeof step.status === "string" ? step.status : "";
    if (status === "failed" && SELF_HEALING_CRITICAL_STEP_NAMES.has(name)) {
      failures.add(name);
    }
  }
  return [...failures].sort();
}

/**
 * Persisted pipelineRuns state is authoritative for self-healing truth.
 * A resolved runDailyPipeline() Promise is not success by itself.
 */
export function classifyPersistedSelfHealingRetry(
  run: PersistedSelfHealingRetry | null | undefined,
): SelfHealingRetryTruth {
  if (!run) {
    return {
      runId: null,
      state: "missing",
      succeeded: false,
      criticalFailures: [],
    };
  }

  const criticalFailures = criticalFailuresFromSteps(run.steps);
  if (run.status === "completed") {
    return {
      runId: run.id,
      state: "completed",
      succeeded: true,
      criticalFailures,
    };
  }
  if (run.status === "failed") {
    return {
      runId: run.id,
      state: "failed",
      succeeded: false,
      criticalFailures,
    };
  }
  return {
    runId: run.id,
    state: "incomplete",
    succeeded: false,
    criticalFailures,
  };
}

/** Bounded owner-facing failure text: never includes raw stage/provider errors. */
export function selfHealingFailureSummary(truth: SelfHealingRetryTruth): string {
  const runLabel = truth.runId === null ? "unknown" : String(truth.runId);
  const critical = truth.criticalFailures.length > 0
    ? ` Critical failed stages: ${truth.criticalFailures.join(", ")}.`
    : "";

  if (truth.state === "missing") {
    return "The retry execution returned without a new persisted self-healing pipeline row. Success could not be confirmed.";
  }
  if (truth.state === "incomplete") {
    return `Self-healing retry run ${runLabel} did not reach a final completed status.${critical}`;
  }
  return `Self-healing retry run ${runLabel} persisted final status ${truth.state}.${critical}`;
}
