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

const SAFE_TRANSPORT_CODES = new Set([
  "EAI_AGAIN",
  "EADDRNOTAVAIL",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "UND_ERR_ABORTED",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_DESTROYED",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
  "UND_ERR_RES_EXCEEDED",
  "UND_ERR_SOCKET",
]);

const MAX_TRANSPORT_CODES = 6;
const MAX_TRANSPORT_ERROR_DEPTH = 5;
const MAX_TRANSPORT_CHILD_ERRORS = 8;

export interface LLMFailureDetails {
  kind: LLMFailureKind;
  status?: number;
  requestId?: string;
  retryAfterMs?: number;
  /** Bounded provider telemetry only; never a URL, key or request payload. */
  provider?: string;
  /** Bounded configured model identifier only. */
  model?: string;
  /** Allow-listed transport/library codes only; never raw error text or addresses. */
  transportCodes?: string[];
}

function sanitizedTransportCodes(values: readonly string[] | undefined): string[] | undefined {
  if (!values?.length) return undefined;
  const safe = [...new Set(values.filter(value => SAFE_TRANSPORT_CODES.has(value)))]
    .sort()
    .slice(0, MAX_TRANSPORT_CODES);
  return safe.length ? safe : undefined;
}

/**
 * Extract only allow-listed network/TLS/undici codes from a thrown fetch error.
 * Raw messages, hostnames, addresses, certificate data and stack traces are
 * deliberately ignored.
 */
export function safeTransportErrorCodes(error: unknown): string[] {
  const codes = new Set<string>();
  const seen = new Set<object>();

  const visit = (value: unknown, depth: number): void => {
    if (
      depth > MAX_TRANSPORT_ERROR_DEPTH ||
      codes.size >= MAX_TRANSPORT_CODES ||
      !value ||
      typeof value !== "object"
    ) {
      return;
    }

    const objectValue = value as object;
    if (seen.has(objectValue)) return;
    seen.add(objectValue);

    const record = value as Record<string, unknown>;
    if (typeof record.code === "string" && SAFE_TRANSPORT_CODES.has(record.code)) {
      codes.add(record.code);
    }

    visit(record.cause, depth + 1);

    if (Array.isArray(record.errors)) {
      for (const child of record.errors.slice(0, MAX_TRANSPORT_CHILD_ERRORS)) {
        visit(child, depth + 1);
        if (codes.size >= MAX_TRANSPORT_CODES) break;
      }
    }
  };

  visit(error, 0);
  return [...codes].sort();
}

export class LLMInvokeError extends Error {
  readonly kind: LLMFailureKind;
  readonly status?: number;
  readonly requestId?: string;
  readonly retryAfterMs?: number;
  readonly provider?: string;
  readonly model?: string;
  readonly transportCodes?: string[];

  constructor(details: LLMFailureDetails) {
    const status = details.status ? `, HTTP ${details.status}` : "";
    // Provider request IDs, provider/model attribution and bounded transport
    // codes remain structured metadata and never enter the public message.
    super(`LLM unavailable (${details.kind}${status})`);
    this.name = "LLMInvokeError";
    this.kind = details.kind;
    this.status = details.status;
    this.requestId = details.requestId;
    this.retryAfterMs = details.retryAfterMs;
    this.provider = details.provider;
    this.model = details.model;
    this.transportCodes = sanitizedTransportCodes(details.transportCodes);
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
