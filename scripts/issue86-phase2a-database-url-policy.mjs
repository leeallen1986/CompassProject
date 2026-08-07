import { createHash } from "node:crypto";

export const DATABASE_URL_QUERY_POLICY = Object.freeze({
  policyVersion: 1,
  allowedIgnoredQueryKeys: Object.freeze(["ssl"]),
  requiredOccurrenceCount: 1,
  maxRawUrlBytes: 4096,
  maxIgnoredValueCharacters: 2048,
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function reject(code) {
  throw new Error(code);
}

function validateDecodedValue(value) {
  if (
    typeof value !== "string" ||
    value.length > DATABASE_URL_QUERY_POLICY.maxIgnoredValueCharacters ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    reject("DATABASE_URL_SSL_OPTION_VALUE_REJECTED");
  }
}

export function normaliseDatabaseUrlForPreflight(raw) {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    Buffer.byteLength(raw, "utf8") > DATABASE_URL_QUERY_POLICY.maxRawUrlBytes
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
  if (entries.length !== DATABASE_URL_QUERY_POLICY.requiredOccurrenceCount) {
    reject("DATABASE_URL_QUERY_SHAPE_REJECTED");
  }

  const [[key, value]] = entries;
  if (key !== "ssl") reject("DATABASE_URL_QUERY_KEY_REJECTED");
  validateDecodedValue(value);

  const questionMark = raw.indexOf("?");
  if (questionMark < 0) reject("DATABASE_URL_SSL_OPTION_MISSING");
  const rawQuery = raw.slice(questionMark + 1);
  if (
    rawQuery.includes("&") ||
    !(rawQuery === "ssl" || rawQuery.startsWith("ssl="))
  ) {
    reject("DATABASE_URL_QUERY_ENCODING_REJECTED");
  }

  const sanitizedDatabaseUrl = raw.slice(0, questionMark);
  if (!sanitizedDatabaseUrl) reject("DATABASE_URL_SANITIZATION_FAILED");

  const policyEvidence = {
    policyVersion: DATABASE_URL_QUERY_POLICY.policyVersion,
    ignoredQueryParameterNames: ["ssl"],
    ignoredQueryParameterOccurrenceCount: 1,
    queryValuesUsedForConnectionConfiguration: false,
    queryStringRemovedBeforeApprovedParser: true,
  };

  return {
    sanitizedDatabaseUrl,
    policyEvidence,
    policySha256: sha256(
      Buffer.from(JSON.stringify(policyEvidence), "utf8"),
    ),
  };
}
