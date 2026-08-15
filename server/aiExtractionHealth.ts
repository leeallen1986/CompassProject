import { LLMInvokeError, type LLMFailureKind } from "./_core/llmErrors";

export const AI_EXTRACTION_FAILURE_RATIO_THRESHOLD = 0.5;
export const AI_EXTRACTION_MIN_FAILURES_FOR_STAGE_FAILURE = 5;
export const AI_EXTRACTION_METADATA_KEY = "__aiExtraction";

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

export type ExtractionAttemptOutcome =
  | "extracted"
  | "duplicate"
  | "skipped"
  | "deferred"
  | "failed";

export interface ExtractionAttemptMetadata {
  version: 1;
  pipelineRunId: number | null;
  batchIndex: number | null;
  attemptedAt: string;
  outcome: ExtractionAttemptOutcome;
  failureCategory: ExtractionFailureCategory | null;
  providerCallAttempted: boolean;
  providerCallSucceeded: boolean;
  attemptCount: number;
}

export interface ExtractionHealthInput {
  processed: number;
  extracted: number;
  duplicates: number;
  skipped: number;
  failed: number;
  deferred?: number;
  sideEffectFailures?: number;
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
  sideEffectFailures: number;
  shouldFailStage: boolean;
  safeReason: string | null;
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

/** Convert provider/application errors into a bounded, payload-free category. */
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

/**
 * Batch/provider failures are retryable system failures, not evidence that an
 * individual article is bad. Keep those articles queued and stop the run from
 * turning the rest of the selected cohort into permanent failures.
 */
export function shouldDeferExtractionFailure(
  category: ExtractionFailureCategory,
): boolean {
  return category !== "database_insert_error";
}

/** True only when the adapter got as far as attempting an upstream request. */
export function didAttemptExtractionProviderCall(
  category: ExtractionFailureCategory,
): boolean {
  return category !== "configuration" && category !== "circuit_open";
}

export function safeExtractionFailureMessage(
  category: ExtractionFailureCategory,
): string {
  return `AI extraction unavailable (${category})`;
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

export function previousExtractionAttemptCount(value: unknown): number {
  if (!isRecord(value)) return 0;
  const metadata = value[AI_EXTRACTION_METADATA_KEY];
  if (!isRecord(metadata)) return 0;
  return nonNegativeInteger(Number(metadata.attemptCount));
}

/**
 * Add a bounded attempt ledger without changing the existing top-level project
 * extraction shape. No prompt, response, article text or raw provider error is
 * stored.
 */
export function withExtractionAttemptMetadata(
  existing: unknown,
  input: Omit<ExtractionAttemptMetadata, "version" | "attemptCount">,
  historySource: unknown = existing,
): Record<string, unknown> {
  const base = isRecord(existing) ? { ...existing } : {};
  const metadata: ExtractionAttemptMetadata = {
    version: 1,
    ...input,
    attemptCount: previousExtractionAttemptCount(historySource) + 1,
  };
  return {
    ...base,
    [AI_EXTRACTION_METADATA_KEY]: metadata,
  };
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
  const deferred = nonNegativeInteger(input.deferred ?? 0);
  const sideEffectFailures = nonNegativeInteger(input.sideEffectFailures ?? 0);
  const accounted = extracted + duplicates + skipped + failed + deferred;
  const unaccounted = Math.max(0, processed - accounted);
  const effectiveFailures = failed + deferred + unaccounted;
  const failureRatio = processed > 0 ? effectiveFailures / processed : 0;

  if (processed === 0) {
    return {
      state: "no_work",
      processed,
      accounted,
      unaccounted,
      effectiveFailures,
      failureRatio,
      sideEffectFailures,
      shouldFailStage: false,
      safeReason: null,
    };
  }

  if (effectiveFailures === 0 && sideEffectFailures === 0) {
    return {
      state: "healthy",
      processed,
      accounted,
      unaccounted,
      effectiveFailures,
      failureRatio,
      sideEffectFailures,
      shouldFailStage: false,
      safeReason: null,
    };
  }

  const shouldFailStage =
    effectiveFailures === processed ||
    (effectiveFailures >= AI_EXTRACTION_MIN_FAILURES_FOR_STAGE_FAILURE &&
      failureRatio >= AI_EXTRACTION_FAILURE_RATIO_THRESHOLD);

  const reasonParts: string[] = [];
  if (effectiveFailures > 0) {
    reasonParts.push(
      `${effectiveFailures}/${processed} items failed, were deferred, or were unaccounted ` +
      `(${Math.round(failureRatio * 100)}%)`,
    );
  }
  if (sideEffectFailures > 0) {
    reasonParts.push(`${sideEffectFailures} secondary insert operation(s) failed`);
  }

  return {
    state: shouldFailStage ? "failed" : "degraded",
    processed,
    accounted,
    unaccounted,
    effectiveFailures,
    failureRatio,
    sideEffectFailures,
    shouldFailStage,
    safeReason: `AI extraction quality failure: ${reasonParts.join("; ")}`,
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

export function failureCategoryStepCounts(
  counts: ExtractionFailureCategoryCounts | undefined,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(sortedFailureCategoryCounts(counts)).map(([category, count]) => [
      `failure_${category}`,
      count,
    ]),
  );
}
