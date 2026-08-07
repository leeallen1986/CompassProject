import { createHash } from "node:crypto";

export const READY_FOR_TIDB_APPLY =
  "READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION";

const FORBIDDEN_PRIVILEGE =
  /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|INDEX|TRIGGER|EVENT|EXECUTE|FILE|PROCESS|SUPER|RELOAD|SHUTDOWN|REPLICATION|GRANT OPTION|SYSTEM_USER|CONNECTION_ADMIN|REFERENCES|LOCK TABLES|CREATE ROUTINE|ALTER ROUTINE|SHOW VIEW|CREATE TEMPORARY TABLES)\b/i;

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortDeep(value[key])]),
  );
}

export function canonicalJson(value) {
  return `${JSON.stringify(sortDeep(value))}\n`;
}

export function canonicalHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function oneStringPerRow(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label}_ROWS_INVALID`);
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`${label}_ROW_INVALID`);
    }
    const values = Object.values(row);
    if (values.length !== 1 || typeof values[0] !== "string") {
      throw new Error(`${label}_ROW_SHAPE_INVALID`);
    }
    return values[0].trim();
  });
}

function redactQuotedSecret(text, prefix) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(
    new RegExp(`(${escaped}\\s*)'(?:''|[^'])*'`, "gi"),
    "$1'<redacted>'",
  );
}

export function normaliseCreateUserStatement(statement) {
  if (typeof statement !== "string" || statement.trim().length === 0) {
    throw new Error("CREATE_USER_STATEMENT_INVALID");
  }
  if (/[\u0000-\u001f\u007f]/.test(statement.replace(/[\r\n\t]/g, ""))) {
    throw new Error("CREATE_USER_CONTROL_CHARACTER");
  }

  let value = statement.replace(/\s+/g, " ").trim();
  if (!/^CREATE\s+USER\b/i.test(value)) {
    throw new Error("CREATE_USER_PREFIX_INVALID");
  }

  value = value.replace(
    /^CREATE\s+USER\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`(?:``|[^`])+`|'(?:''|[^'])+'|[^\s@]+)\s*@\s*(?:`(?:``|[^`])+`|'(?:''|[^'])+'|[^\s]+)/i,
    "CREATE USER <CURRENT_USER>",
  );

  value = redactQuotedSecret(value, "AS");
  value = redactQuotedSecret(value, "IDENTIFIED BY PASSWORD");
  value = redactQuotedSecret(value, "IDENTIFIED BY");
  value = redactQuotedSecret(value, "ATTRIBUTE");
  value = redactQuotedSecret(value, "COMMENT");

  if (!value.startsWith("CREATE USER <CURRENT_USER>")) {
    throw new Error("CREATE_USER_ACCOUNT_NOT_REDACTED");
  }
  return value;
}

export function validateTidbAccountPolicy({
  roleRows,
  grantRows,
  createUserRows,
  expectedRoleSha256,
  expectedGrantSha256,
  expectedGrantRowCount,
  requireSecureTransportEnabled,
}) {
  if (!Array.isArray(roleRows) || roleRows.length !== 1) {
    throw new Error("TIDB_ROLE_ROW_COUNT");
  }
  const currentRole = String(roleRows[0].currentRole ?? "");
  const grants = oneStringPerRow(grantRows, "TIDB_GRANT");
  const createStatements = oneStringPerRow(createUserRows, "TIDB_CREATE_USER");
  const createStatement = createStatements.length === 1 ? createStatements[0] : null;
  const sanitisedCreateStatement = createStatement
    ? normaliseCreateUserStatement(createStatement)
    : null;
  const roleSha256 = canonicalHash(currentRole);
  const grantSha256 = canonicalHash([...grants].sort());
  const rawAccountDefinitionSha256 = createStatement
    ? canonicalHash(createStatement)
    : null;
  const sanitisedAccountDefinitionSha256 = sanitisedCreateStatement
    ? canonicalHash(sanitisedCreateStatement)
    : null;
  const rowCountExact = grants.length === expectedGrantRowCount;
  const noForbiddenPrivileges = grants.every(
    (grant) => !FORBIDDEN_PRIVILEGE.test(grant),
  );
  const hasSelect = grants.some((grant) => /\bSELECT\b/i.test(grant));
  const accountRequiresSslOrX509 =
    createStatement !== null &&
    /\bREQUIRE\s+(?:SSL|X509)\b/i.test(createStatement) &&
    !/\bREQUIRE\s+NONE\b/i.test(createStatement);
  const effectiveTransportRequired =
    accountRequiresSslOrX509 || requireSecureTransportEnabled === true;
  const authMaterialExcludedFromPolicy =
    sanitisedCreateStatement !== null &&
    sanitisedCreateStatement.includes("<CURRENT_USER>") &&
    (!/\bIDENTIFIED\b/i.test(createStatement ?? "") ||
      sanitisedCreateStatement.includes("<redacted>"));

  return {
    passed:
      currentRole === "NONE" &&
      roleSha256 === expectedRoleSha256 &&
      grantSha256 === expectedGrantSha256 &&
      rowCountExact &&
      noForbiddenPrivileges &&
      hasSelect &&
      createStatements.length === 1 &&
      authMaterialExcludedFromPolicy &&
      effectiveTransportRequired,
    currentRoleNone: currentRole === "NONE",
    roleSha256,
    grantSha256,
    grantRowCount: grants.length,
    expectedGrantRowCount,
    rowCountExact,
    noForbiddenPrivileges,
    hasSelect,
    accountDefinitionRowCount: createStatements.length,
    rawAccountDefinitionSha256,
    sanitisedAccountDefinitionSha256,
    authMaterialExcludedFromPolicy,
    accountRequiresSslOrX509,
    clusterRequiresSecureTransport: requireSecureTransportEnabled === true,
    effectiveTransportRequired,
  };
}

function decimalCount(value, label) {
  const text = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]*)$/.test(text)) throw new Error(`${label}_INVALID`);
  return Number(text);
}

export function classifyCheckConstraintCensus({ countRows, detailRows }) {
  if (!Array.isArray(countRows) || countRows.length !== 1) {
    throw new Error("CHECK_CENSUS_COUNT_ROWS_INVALID");
  }
  if (!Array.isArray(detailRows)) throw new Error("CHECK_CENSUS_DETAIL_ROWS_INVALID");
  const count = decimalCount(countRows[0].rowCount, "CHECK_CENSUS_COUNT");
  if (count > 1000) throw new Error("CHECK_CENSUS_LIMIT_EXCEEDED");
  if (detailRows.length !== count) throw new Error("CHECK_CENSUS_COUNT_MISMATCH");
  const rows = detailRows.map((row) => {
    const tableName = String(row.tableName ?? "");
    const constraintName = String(row.constraintName ?? "");
    const checkClause = String(row.checkClause ?? "");
    const tableId = String(row.tableId ?? "");
    if (!tableName || !constraintName || !checkClause || !/^[0-9]+$/.test(tableId)) {
      throw new Error("CHECK_CENSUS_ROW_INVALID");
    }
    return { tableName, constraintName, checkClause, tableId };
  });
  const sha256 = canonicalHash(rows);
  return {
    observed: true,
    count,
    sha256,
    rows,
    empty: count === 0,
    safeForAutomaticEnablementAssessment: count === 0,
  };
}

export function evaluateTidbV3Readiness({ facts, databaseState }) {
  const blockers = [];
  const require = (condition, code) => {
    if (!condition) blockers.push(code);
  };

  require(facts.sourceGatePassed, "BLOCKED_SOURCE_GATE");
  require(facts.runtimeProfilePassed, "BLOCKED_RUNTIME_PROFILE");
  require(facts.productionIdentityMatched, "BLOCKED_PRODUCTION_IDENTITY");
  require(facts.accountIdentityMatched, "BLOCKED_ACCOUNT_IDENTITY");
  require(facts.tlsVerified, "BLOCKED_TLS_NOT_VERIFIED");
  require(facts.peerCertificatePinned, "BLOCKED_PEER_CERTIFICATE_PIN");
  require(facts.engineExact, "BLOCKED_TIDB_ENGINE_MISMATCH");
  require(facts.accountPolicyMatched, "BLOCKED_TIDB_ACCOUNT_POLICY");
  require(facts.transportPolicyEnforced, "BLOCKED_TIDB_TRANSPORT_POLICY");
  require(facts.oneConnectionOnly, "BLOCKED_CONNECTION_COUNT");
  require(facts.connectionIdConsistent, "BLOCKED_CONNECTION_ID");
  require(facts.capabilitiesObserved, "BLOCKED_TIDB_CAPABILITIES_UNOBSERVED");
  if (facts.capabilitiesObserved) {
    require(
      facts.checkConstraintsEnabled,
      "BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED",
    );
    require(
      facts.foreignKeyFeatureEnabled,
      "BLOCKED_TIDB_FOREIGN_KEY_FEATURE_DISABLED",
    );
    require(
      facts.globalForeignKeyChecksEnabled,
      "BLOCKED_TIDB_GLOBAL_FOREIGN_KEY_CHECKS_DISABLED",
    );
    require(
      facts.sessionForeignKeyChecksEnabled,
      "BLOCKED_TIDB_SESSION_FOREIGN_KEY_CHECKS_DISABLED",
    );
    require(facts.noopFunctionsDisabled, "BLOCKED_TIDB_NOOP_FUNCTIONS_ENABLED");
    require(facts.metadataCapabilitiesExact, "BLOCKED_TIDB_METADATA_CAPABILITIES");
  }
  require(facts.checkCensusObserved, "BLOCKED_CHECK_CENSUS_UNOBSERVED");
  require(facts.checkCensusPinned, "BLOCKED_CHECK_CENSUS_UNPINNED");
  require(facts.journalSchemaExact, "BLOCKED_JOURNAL_SCHEMA");
  require(facts.predecessorFootprintExact, "BLOCKED_PREDECESSOR_FOOTPRINT");
  require(facts.snapshotsEqual, "BLOCKED_METADATA_CHANGED_DURING_PREFLIGHT");
  require(facts.transcriptExact, "BLOCKED_EXECUTOR_TRANSCRIPT");
  require(facts.connectionClosed, "BLOCKED_CONNECTION_CLOSE");

  if (databaseState?.databaseStateClassification !== READY_FOR_TIDB_APPLY) {
    blockers.push(databaseState?.blocker ?? "BLOCKED_DATABASE_STATE_UNKNOWN");
  }

  const unique = [...new Set(blockers)];
  return {
    applyReadiness: unique.length === 0 ? READY_FOR_TIDB_APPLY : unique[0],
    applyAuthorized: false,
    migrationAppliedByThisPreflight: false,
    blockers: unique,
  };
}

export function exitCodeForReadiness(readiness) {
  return readiness === READY_FOR_TIDB_APPLY ? 0 : 2;
}
