import { createHash } from "node:crypto";
import { normaliseDatabaseUrlForPreflight } from "./issue86-phase2a-database-url-policy.mjs";

export const RECURRING_SNAPSHOT_DATABASE_URL_POLICY = Object.freeze({
  policyVersion: 1,
  acceptedShapes: Object.freeze(["no_query", "single_ignored_ssl"]),
  allowedIgnoredQueryKeys: Object.freeze(["ssl"]),
  maxRawUrlBytes: 4096,
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function reject(code) {
  throw new Error(code);
}

function evidenceSha256(policyEvidence) {
  return sha256(Buffer.from(JSON.stringify(policyEvidence), "utf8"));
}

/**
 * Adapt only the provider-style `?ssl=...` shape already covered by the
 * Issue #86 URL policy. The query value is ignored completely: connection TLS
 * is configured later by the strict approved parser, not by DATABASE_URL.
 */
export function normaliseRecurringSnapshotDatabaseUrl(raw) {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    Buffer.byteLength(raw, "utf8") >
      RECURRING_SNAPSHOT_DATABASE_URL_POLICY.maxRawUrlBytes
  ) {
    reject("DATABASE_URL_MISSING_OR_INVALID");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    reject("DATABASE_URL_PARSE_FAILED");
  }

  if (parsed.protocol !== "mysql:") reject("DATABASE_URL_SCHEME_REJECTED");
  if (parsed.hash) reject("DATABASE_URL_FRAGMENT_REJECTED");

  const entries = [...parsed.searchParams.entries()];
  if (entries.length === 0) {
    const policyEvidence = {
      policyVersion: RECURRING_SNAPSHOT_DATABASE_URL_POLICY.policyVersion,
      acceptedShape: "no_query",
      ignoredQueryParameterNames: [],
      ignoredQueryParameterOccurrenceCount: 0,
      queryValuesUsedForConnectionConfiguration: false,
      queryStringRemovedBeforeApprovedParser: false,
    };
    return {
      sanitizedDatabaseUrl: raw,
      policyEvidence,
      policySha256: evidenceSha256(policyEvidence),
    };
  }

  const normalized = normaliseDatabaseUrlForPreflight(raw);
  const policyEvidence = {
    policyVersion: RECURRING_SNAPSHOT_DATABASE_URL_POLICY.policyVersion,
    acceptedShape: "single_ignored_ssl",
    ignoredQueryParameterNames:
      normalized.policyEvidence.ignoredQueryParameterNames,
    ignoredQueryParameterOccurrenceCount:
      normalized.policyEvidence.ignoredQueryParameterOccurrenceCount,
    queryValuesUsedForConnectionConfiguration: false,
    queryStringRemovedBeforeApprovedParser: true,
  };

  return {
    sanitizedDatabaseUrl: normalized.sanitizedDatabaseUrl,
    policyEvidence,
    policySha256: evidenceSha256(policyEvidence),
  };
}
