import { canonicalHash } from "./issue86-phase2a-preflight-core.mjs";

export const ACCOUNT_POLICY_SENTINEL =
  "ISSUE86_TIDB_ACCOUNT_POLICY_V1_VALIDATED";
export const ACCOUNT_POLICY_SENTINEL_SHA256 = canonicalHash(
  ACCOUNT_POLICY_SENTINEL,
);

const SECURE_REQUIRE_PATTERN =
  /\bREQUIRE\s+(?:SSL|X509|SUBJECT\b|ISSUER\b|CIPHER\b)/i;
const REQUIRE_NONE_PATTERN = /\bREQUIRE\s+NONE\b/i;
const DISALLOWED_CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function oneStringValue(row, label) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`${label}_ROW_INVALID`);
  }
  const entries = Object.entries(row);
  if (entries.length !== 1 || typeof entries[0][1] !== "string") {
    throw new Error(`${label}_ROW_SHAPE_INVALID`);
  }
  return entries[0];
}

export function inspectTidbCreateUserStatement(statement) {
  if (
    typeof statement !== "string" ||
    DISALLOWED_CONTROL_PATTERN.test(statement)
  ) {
    throw new Error("TIDB_CREATE_USER_STATEMENT_INVALID");
  }
  const normalized = statement.trim().replace(/\s+/g, " ");
  if (
    normalized.length === 0 ||
    normalized.length > 16384 ||
    normalized.includes(";") ||
    !/^CREATE\s+USER\b/i.test(normalized) ||
    (normalized.match(/\bCREATE\s+USER\b/gi) ?? []).length !== 1 ||
    !/\bIDENTIFIED\b/i.test(normalized)
  ) {
    throw new Error("TIDB_CREATE_USER_STATEMENT_INVALID");
  }

  const requireNone = REQUIRE_NONE_PATTERN.test(normalized);
  const requiresSecureTransport = SECURE_REQUIRE_PATTERN.test(normalized);
  if (requireNone && requiresSecureTransport) {
    throw new Error("TIDB_CREATE_USER_REQUIREMENT_AMBIGUOUS");
  }

  const requireMode = requireNone
    ? "NONE"
    : requiresSecureTransport
      ? "SECURE"
      : "UNSPECIFIED";

  return {
    policyVersion: 1,
    authenticationClausePresent: true,
    authenticationMaterialRedacted: true,
    requireMode,
    requiresSecureTransport,
    accountLocked: /\bACCOUNT\s+LOCK\b/i.test(normalized),
  };
}

export function sanitizeTidbCreateUserRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("TIDB_CREATE_USER_ROW_COUNT");
  }
  const [key, statement] = oneStringValue(rows[0], "TIDB_CREATE_USER");
  const policy = inspectTidbCreateUserStatement(statement);
  return {
    rows: [{ [key]: ACCOUNT_POLICY_SENTINEL }],
    policy,
  };
}

function variableMap(rows) {
  if (!Array.isArray(rows)) throw new Error("TIDB_GLOBAL_VARIABLE_ROWS_INVALID");
  const map = new Map();
  for (const row of rows) {
    const name = String(row?.Variable_name ?? row?.variableName ?? "");
    const value = String(row?.Value ?? row?.value ?? "");
    if (!name || map.has(name)) {
      throw new Error("TIDB_GLOBAL_VARIABLE_ROWS_INVALID");
    }
    map.set(name, value);
  }
  return map;
}

export function evaluateEffectiveSecureTransport({
  accountPolicy,
  globalVariableRows,
}) {
  if (!accountPolicy || accountPolicy.policyVersion !== 1) {
    throw new Error("TIDB_ACCOUNT_POLICY_MISSING");
  }
  const variables = variableMap(globalVariableRows);
  if (!variables.has("require_secure_transport")) {
    throw new Error("TIDB_REQUIRE_SECURE_TRANSPORT_UNOBSERVED");
  }
  const clusterRequiresSecureTransport = /^(?:1|ON)$/i.test(
    variables.get("require_secure_transport"),
  );
  const effectiveSecureTransport =
    accountPolicy.requiresSecureTransport || clusterRequiresSecureTransport;
  return {
    accountRequiresSecureTransport: accountPolicy.requiresSecureTransport,
    clusterRequiresSecureTransport,
    effectiveSecureTransport,
  };
}
