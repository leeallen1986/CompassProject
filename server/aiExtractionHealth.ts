import { LLMInvokeError, type LLMFailureKind } from "./_core/llmErrors";

export const AI_EXTRACTION_FAILURE_RATIO_THRESHOLD = 0.5;
export const AI_EXTRACTION_MIN_FAILURES_FOR_STAGE_FAILURE = 5;

export type ExtractionFailureCategory =
  | "configuration"
  | "quota_or_usage_exhausted"
  | "rate_limited"
  | "authentication"
  | "timeout"
  | "provider_unavailable"
  | "provider_rejected"
  | "empty_response"
  | "schema_or_json_parse"
  | "missing_article_result"
  | "database_insert_error"
  | "circuit_open"
  | "unknown";

export type ExtractionFailureCategoryCounts = Partial<
  Record<ExtractionFailureCategory, number>
>;

export interface ExtractionHealthInput {
  processed: number;
  extracted: number;
  duplicates: number;
  skipped: number;
  failed: number;
  failureCategories?: ExtractionFailureCategoryCounts;
}

export type ExtractionHealthState = "no_work" | "healthy" | "degraded" | "failed";

export interface ExtractionHealthDecision {
  state: ExtractionHealthState;
  processed: number;
  accounted: number;
  unaccounted: number;
  effectiveFailures: number;
  failureRatio: number;
  shouldFailStage: boolean;
  safeReason: string | null;
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function mapLLMFailureKind(kind: LLMFailureKind): ExtractionFailureCategory {
  switch (kind) {
    case "configuration":
      return "configuration";
    case "quota_exhausted":
      return "quota_or_usage_exhausted";
    case "rate_limited":
      return "rate_limited";
    case "authentication":
      return "authentication";
    case "timeout":
      return "timeout";
    case "upstream_unavailable":
      return "provider_unavailable";
    case "upstream_rejected":
      return "provider_rejected";
    case "malformed_response":
      return "schema_or_json_parse";
    case "circuit_open":
      return "circuit_open";
  }
}

/**
 * Convert provider/application errors into a bounded, payload-free category.
 * The returned value is safe to persist in run telemetry and article metadata.
 */
export function classifyExtractionFailure(error: unknown): ExtractionFailureCategory {
  if (error instanceof LLMInvokeError) return mapLLMFailureKind(error.kind);
  if (error instanceof SyntaxError) return "schema_or_json_parse";

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("empty llm response")) return "empty_response";
  if (message.includes("missing article result")) return "missing_article_result";
  if (message.includes("database insert") || message.includes("failed to insert")) {
    return "database_insert_error";
  }
  if (message.includes("json") || message.includes("schema")) {
    return "schema_or_json_parse";
  }
  return "unknown";
}

export function incrementFailureCategory(
  counts: ExtractionFailureCategoryCounts,
  category: ExtractionFailureCategory,
  amount = 1,
): ExtractionFailureCategoryCounts {
  const next = { ...counts };
  next[category] = nonNegativeInteger(next[category] ?? 0) + nonNegativeInteger(amount);
  return next;
}

/**
 * Decide whether the extraction stage is healthy without conflating
 * non-relevant/skipped articles with genuine errors.
 */
export function evaluateExtractionHealth(
  input: ExtractionHealthInput,
): ExtractionHealthDecision {
  const processed = nonNegativeInteger(input.processed);
  const extracted = nonNegativeInteger(input.extracted);
  const duplicates = nonNegativeInteger(input.duplicates);
  const skipped = nonNegativeInteger(input.skipped);
  const failed = nonNegativeInteger(input.failed);
  const accounted = extracted + duplicates + skipped + failed;
  const unaccounted = Math.max(0, processed - accounted);
  const effectiveFailures = failed + unaccounted;
  const failureRatio = processed > 0 ? effectiveFailures / processed : 0;

  if (processed === 0) {
    return {
      state: "no_work",
      processed,
      accounted,
      unaccounted,
      effectiveFailures,
      failureRatio,
      shouldFailStage: false,
      safeReason: null,
    };
  }

  if (effectiveFailures === 0) {
    return {
      state: "healthy",
      processed,
      accounted,
      unaccounted,
      effectiveFailures,
      failureRatio,
      shouldFailStage: false,
      safeReason: null,
    };
  }

  const shouldFailStage =
    effectiveFailures === processed ||
    (effectiveFailures >= AI_EXTRACTION_MIN_FAILURES_FOR_STAGE_FAILURE &&
      failureRatio >= AI_EXTRACTION_FAILURE_RATIO_THRESHOLD);

  return {
    state: shouldFailStage ? "failed" : "degraded",
    processed,
    accounted,
    unaccounted,
    effectiveFailures,
    failureRatio,
    shouldFailStage,
    safeReason:
      `AI extraction quality failure: ${effectiveFailures}/${processed} ` +
      `items failed or were unaccounted (${Math.round(failureRatio * 100)}%)`,
  };
}

export function sortedFailureCategoryCounts(
  counts: ExtractionFailureCategoryCounts | undefined,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts ?? {})
      .filter(([, count]) => Number.isFinite(count) && (count ?? 0) > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, count]) => [category, Math.floor(count as number)]),
  );
}
