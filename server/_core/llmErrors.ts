export type LLMFailureKind =
  | "configuration"
  | "quota_exhausted"
  | "rate_limited"
  | "authentication"
  | "timeout"
  | "upstream_unavailable"
  | "upstream_rejected"
  | "malformed_response"
  | "circuit_open";

export interface LLMFailureDetails {
  kind: LLMFailureKind;
  status?: number;
  requestId?: string;
  retryAfterMs?: number;
  /** Bounded provider telemetry only; never a URL, key or request payload. */
  provider?: string;
  /** Bounded configured model identifier only. */
  model?: string;
}

export class LLMInvokeError extends Error {
  readonly kind: LLMFailureKind;
  readonly status?: number;
  readonly requestId?: string;
  readonly retryAfterMs?: number;
  readonly provider?: string;
  readonly model?: string;

  constructor(details: LLMFailureDetails) {
    const status = details.status ? `, HTTP ${details.status}` : "";
    // Provider request IDs and provider/model telemetry remain available as
    // internal structured metadata but never enter the public Error.message.
    super(`LLM unavailable (${details.kind}${status})`);
    this.name = "LLMInvokeError";
    this.kind = details.kind;
    this.status = details.status;
    this.requestId = details.requestId;
    this.retryAfterMs = details.retryAfterMs;
    this.provider = details.provider;
    this.model = details.model;
  }
}

function providerCode(body: string): number | undefined {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const direct = parsed.code;
    const nested = (parsed.error as Record<string, unknown> | undefined)?.code;
    const value = direct ?? nested;
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  } catch {
    // Non-JSON upstream bodies are classified from status/text only.
  }
  return undefined;
}

export function classifyLLMHttpFailure(
  status: number,
  body: string
): LLMFailureKind {
  const normalised = body.toLowerCase();
  const code = providerCode(body);
  const quotaEvidence =
    code === 9 ||
    /usage\s+exhausted|quota\s+exhausted|insufficient\s+(credit|quota)|credit\s+exhausted/.test(
      normalised
    );

  if (
    quotaEvidence &&
    (status === 412 || status === 400 || status === 402 || status === 429)
  ) {
    return "quota_exhausted";
  }
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "authentication";
  if (status >= 500) return "upstream_unavailable";
  return "upstream_rejected";
}

export function parseRetryAfterMs(
  value: string | null,
  now = Date.now()
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

export function isDeterministicFallbackEligible(
  error: unknown
): error is LLMInvokeError {
  return (
    error instanceof LLMInvokeError &&
    [
      "configuration",
      "quota_exhausted",
      "rate_limited",
      "timeout",
      "upstream_unavailable",
      "circuit_open",
    ].includes(error.kind)
  );
}

/** Parse model-controlled JSON without ever echoing its contents in an error. */
export function parseLLMJson<T>(content: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new LLMInvokeError({ kind: "malformed_response" });
  }
}
