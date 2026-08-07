import { createHash } from "node:crypto";
import {
  buildExpected0090Contract,
  canonicalHash,
  canonicalJson,
  classifyJournalAndPhase2a,
  parseDatabaseUrl,
  sha256,
  sortDeep,
  verifySourceBundle,
} from "./issue86-phase2a-preflight-core.mjs";
import { normaliseDatabaseUrlForPreflight } from "./issue86-phase2a-database-url-policy.mjs";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const TIDB_PROFILE = deepFreeze({
  exactVersion: "8.0.11-TiDB-v8.5.3-serverless",
  exactComment:
    "TiDB Server (Apache License 2.0) Community Edition, MySQL 8.0 compatible",
  migration0091Sha256:
    "d6b76795819387a012768978403156b3b1b7f70fd129cbfe1484d052bf7346c4",
  migration0090Sha256:
    "8bd973622561a0ebb3b3a6a6f649ccedeaa8b95b19ba23cdac458e49c80e90b2",
});

const Q = (sql) => ({ kind: "READ", method: "query", sql });

export const TIDB_SQL = deepFreeze({
  CONNECTION_ID: Q("SELECT CONNECTION_ID() AS connectionId"),
  ENGINE_IDENTITY: Q(
    "SELECT VERSION() AS versionString, @@version_comment AS versionComment, CONNECTION_ID() AS connectionId, SHA2(CURRENT_USER(), 256) AS currentUserSha256, SHA2(CONCAT_WS(CHAR(0), @@server_uuid, DATABASE(), @@port, CURRENT_USER()), 256) AS targetIdentitySha256",
  ),
  CURRENT_ROLE: Q("SELECT CURRENT_ROLE() AS currentRole"),
  SHOW_GRANTS: Q("SHOW GRANTS"),
  SHOW_CREATE_USER: Q("SHOW CREATE USER CURRENT_USER()"),
  TLS_STATUS: Q(
    "SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_cipher','Ssl_version')",
  ),
  GLOBAL_VARIABLES: Q(
    "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('foreign_key_checks','require_secure_transport','tidb_enable_check_constraint','tidb_enable_foreign_key','tidb_enable_noop_functions')",
  ),
  SESSION_VARIABLES: Q(
    "SHOW SESSION VARIABLES WHERE Variable_name IN ('foreign_key_checks')",
  ),
  TABLE_CONSTRAINTS_METADATA: Q(
    "SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, IS_NULLABLE AS isNullable, ORDINAL_POSITION AS ordinalPosition FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema' AND TABLE_NAME = 'TABLE_CONSTRAINTS' ORDER BY ORDINAL_POSITION",
  ),
  CHECK_CONSTRAINTS_METADATA: Q(
    "SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, IS_NULLABLE AS isNullable, ORDINAL_POSITION AS ordinalPosition FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema' AND TABLE_NAME = 'CHECK_CONSTRAINTS' ORDER BY ORDINAL_POSITION",
  ),
  TIDB_CHECK_CONSTRAINTS_METADATA: Q(
    "SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, IS_NULLABLE AS isNullable, ORDINAL_POSITION AS ordinalPosition FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema' AND TABLE_NAME = 'TIDB_CHECK_CONSTRAINTS' ORDER BY ORDINAL_POSITION",
  ),
  JOURNAL_TABLES: Q(
    "SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = '__drizzle_migrations' ORDER BY BINARY TABLE_NAME",
  ),
  JOURNAL_COLUMNS: Q(
    "SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_KEY AS columnKey, EXTRA AS extra, ORDINAL_POSITION AS ordinalPosition FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations' ORDER BY ORDINAL_POSITION",
  ),
  JOURNAL_INDEXES: Q(
    "SELECT INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seqInIndex, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations' ORDER BY INDEX_NAME, SEQ_IN_INDEX",
  ),
  JOURNAL_CONSTRAINTS: Q(
    "SELECT CONSTRAINT_NAME AS constraintName, CONSTRAINT_TYPE AS constraintType FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations' ORDER BY CONSTRAINT_NAME",
  ),
  JOURNAL_TRIGGERS: Q(
    "SELECT TRIGGER_NAME AS triggerName, EVENT_MANIPULATION AS eventManipulation, ACTION_TIMING AS actionTiming FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = '__drizzle_migrations' ORDER BY TRIGGER_NAME",
  ),
  JOURNAL_RELEVANT_COUNT: Q(
    "SELECT COUNT(*) AS rowCount FROM __drizzle_migrations WHERE created_at >= 1784077724863 OR hash IN ('8bd973622561a0ebb3b3a6a6f649ccedeaa8b95b19ba23cdac458e49c80e90b2','85ef1c42f3e252b837fcd6df2ce350f8c9af84b5854f934410a0c7b18a677d0f','d6b76795819387a012768978403156b3b1b7f70fd129cbfe1484d052bf7346c4')",
  ),
  JOURNAL_RELEVANT: Q(
    "SELECT CAST(id AS CHAR) AS id, hash, CAST(created_at AS CHAR) AS createdAt FROM __drizzle_migrations WHERE created_at >= 1784077724863 OR hash IN ('8bd973622561a0ebb3b3a6a6f649ccedeaa8b95b19ba23cdac458e49c80e90b2','85ef1c42f3e252b837fcd6df2ce350f8c9af84b5854f934410a0c7b18a677d0f','d6b76795819387a012768978403156b3b1b7f70fd129cbfe1484d052bf7346c4') ORDER BY created_at, id LIMIT 1001",
  ),
  JOURNAL_LATEST: Q(
    "SELECT CAST(id AS CHAR) AS id, hash, CAST(created_at AS CHAR) AS createdAt FROM __drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 10",
  ),
  PREDECESSOR_TABLES: Q(
    "SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) IN ('fullpotentialaccounts','fullpotentialevidence','fullpotentialmodelevidencelinks','fullpotentialmodellines','fullpotentialmodelreviews','fullpotentialmodels') ORDER BY BINARY TABLE_NAME",
  ),
  PREDECESSOR_COLUMNS: Q(
    "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, ORDINAL_POSITION AS ordinalPosition, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME IN ('fullPotentialEvidence','fullPotentialModelEvidenceLinks','fullPotentialModelLines','fullPotentialModelReviews','fullPotentialModels') OR (TABLE_NAME = 'fullPotentialAccounts' AND COLUMN_NAME IN ('parentAccountId','mergedIntoAccountId','relationshipType','recordStatus','countsTowardPotential'))) ORDER BY BINARY TABLE_NAME, ORDINAL_POSITION",
  ),
  PREDECESSOR_INDEXES: Q(
    "SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seqInIndex, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('fullPotentialEvidence','fullPotentialModelEvidenceLinks','fullPotentialModelLines','fullPotentialModelReviews','fullPotentialModels') ORDER BY BINARY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
  ),
  PREDECESSOR_CONSTRAINTS: Q(
    "SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, CONSTRAINT_TYPE AS constraintType FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('fullPotentialEvidence','fullPotentialModelEvidenceLinks','fullPotentialModelLines','fullPotentialModelReviews','fullPotentialModels') ORDER BY BINARY TABLE_NAME, CONSTRAINT_NAME",
  ),
  PREDECESSOR_KEYS: Q(
    "SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, COLUMN_NAME AS columnName, ORDINAL_POSITION AS ordinalPosition, REFERENCED_TABLE_NAME AS referencedTableName, REFERENCED_COLUMN_NAME AS referencedColumnName FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('fullPotentialEvidence','fullPotentialModelEvidenceLinks','fullPotentialModelLines','fullPotentialModelReviews','fullPotentialModels') ORDER BY BINARY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION",
  ),
  PREDECESSOR_REFERENTIAL: Q(
    "SELECT CONSTRAINT_NAME AS constraintName, TABLE_NAME AS tableName, REFERENCED_TABLE_NAME AS referencedTableName, UPDATE_RULE AS updateRule, DELETE_RULE AS deleteRule FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('fullPotentialEvidence','fullPotentialModelEvidenceLinks','fullPotentialModelLines','fullPotentialModelReviews','fullPotentialModels') ORDER BY BINARY TABLE_NAME, CONSTRAINT_NAME",
  ),
  PREDECESSOR_CHECKS: Q(
    "SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, CHECK_CLAUSE AS checkClause FROM information_schema.TIDB_CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('fullPotentialEvidence','fullPotentialModelEvidenceLinks','fullPotentialModelLines','fullPotentialModelReviews','fullPotentialModels') ORDER BY BINARY TABLE_NAME, CONSTRAINT_NAME",
  ),
  PHASE2A_TABLES: Q(
    "SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) IN ('projectevidencesources','projectevidenceclaims','projectevidenceclaimsources','projectevidenceevents') ORDER BY BINARY TABLE_NAME",
  ),
  PHASE2A_RESIDUE: Q(
    "SELECT 'constraint' AS objectKind, TABLE_NAME AS tableName, CONSTRAINT_NAME AS objectName FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND LOWER(CONSTRAINT_NAME) LIKE 'projectevidence%' UNION ALL SELECT 'index' AS objectKind, TABLE_NAME AS tableName, INDEX_NAME AS objectName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND LOWER(INDEX_NAME) LIKE 'projectevidence%' ORDER BY objectKind, tableName, objectName",
  ),
});

export const SNAPSHOT_STATEMENT_IDS = deepFreeze([
  "JOURNAL_TABLES",
  "JOURNAL_COLUMNS",
  "JOURNAL_INDEXES",
  "JOURNAL_CONSTRAINTS",
  "JOURNAL_TRIGGERS",
  "JOURNAL_RELEVANT_COUNT",
  "PREDECESSOR_TABLES",
  "PREDECESSOR_COLUMNS",
  "PREDECESSOR_INDEXES",
  "PREDECESSOR_CONSTRAINTS",
  "PREDECESSOR_KEYS",
  "PREDECESSOR_REFERENTIAL",
  "PREDECESSOR_CHECKS",
  "JOURNAL_RELEVANT",
  "JOURNAL_LATEST",
  "PHASE2A_TABLES",
  "PHASE2A_RESIDUE",
]);

export function hashBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function lintTidbSqlManifest() {
  const errors = [];
  for (const [id, statement] of Object.entries(TIDB_SQL)) {
    const normalized = statement.sql.trim();
    if (statement.method !== "query") errors.push(`${id}_METHOD_INVALID`);
    if (!/^(?:SELECT|SHOW)\b/i.test(normalized)) errors.push(`${id}_NOT_READ_ONLY`);
    if (normalized.includes(";")) errors.push(`${id}_SEMICOLON_REJECTED`);
    if (
      /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|SET|CALL|DO|LOAD|LOCK|UNLOCK|ADMIN)\b/i.test(
        normalized,
      )
    ) {
      errors.push(`${id}_MUTATION_TOKEN_REJECTED`);
    }
  }
  return {
    passed: errors.length === 0,
    errors,
    sha256: canonicalHash(TIDB_SQL),
    statementCount: Object.keys(TIDB_SQL).length,
  };
}

function normalizeDefault(value, columnType = "") {
  if (value === undefined || value === null) return null;
  let text = String(value);
  if (/^'.*'$/.test(text)) text = text.slice(1, -1);
  if (/^(?:now\(\)|\(now\(\)\)|current_timestamp(?:\(\))?)$/i.test(text)) {
    return "CURRENT_TIMESTAMP";
  }
  if (text === "true") return "1";
  if (text === "false") return "0";
  if (/^decimal\([0-9]+,[0-9]+\)$/i.test(String(columnType)) && /^-?[0-9]+(?:\.[0-9]+)?$/.test(text)) {
    const negative = text.startsWith("-");
    const unsigned = negative ? text.slice(1) : text;
    let [integer, fraction = ""] = unsigned.split(".");
    integer = integer.replace(/^0+(?=[0-9])/, "");
    fraction = fraction.replace(/0+$/, "");
    const normalized = fraction ? `${integer}.${fraction}` : integer;
    return negative && normalized !== "0" ? `-${normalized}` : normalized;
  }
  return text;
}

function normalizeExtra(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/default_generated/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeType(value) {
  const text = String(value ?? "").toLowerCase();
  return text === "boolean" ? "tinyint(1)" : text;
}

function compareRows(a, b) {
  return canonicalJson(a).localeCompare(canonicalJson(b));
}

function normalizeRows(rows, fields) {
  return rows
    .map((row) =>
      Object.fromEntries(
        fields.map((field) => {
          let value = row[field];
          if (field === "columnDefault") value = normalizeDefault(value, row.columnType);
          else if (field === "extra") value = normalizeExtra(value);
          else if (field === "columnType") value = normalizeType(value);
          else if (value !== null && value !== undefined) value = String(value);
          else value = null;
          return [field, value];
        }),
      ),
    )
    .sort(compareRows);
}

function stripEnforced(rows) {
  return rows.map(({ enforced: _ignored, ...row }) => row);
}

export function expectedTidb0090Contract(snapshot0090) {
  const mysql = buildExpected0090Contract(snapshot0090);
  return sortDeep({
    ...mysql,
    constraints: stripEnforced(mysql.constraints),
    checks: mysql.checks.map(({ enforced: _ignored, ...row }) => row),
  });
}

export function validateTidb0090Footprint(observation, expected) {
  const actual = {
    tables: normalizeRows(observation.tables, ["tableName", "tableType", "engine"]),
    columns: normalizeRows(observation.columns, [
      "tableName",
      "columnName",
      "ordinalPosition",
      "columnType",
      "isNullable",
      "columnDefault",
      "extra",
    ]),
    indexes: normalizeRows(observation.indexes, [
      "tableName",
      "indexName",
      "nonUnique",
      "seqInIndex",
      "columnName",
      "subPart",
      "indexType",
    ]),
    constraints: normalizeRows(observation.constraints, [
      "tableName",
      "constraintName",
      "constraintType",
    ]),
    keys: normalizeRows(observation.keys, [
      "tableName",
      "constraintName",
      "columnName",
      "ordinalPosition",
      "referencedTableName",
      "referencedColumnName",
    ]),
    referential: normalizeRows(observation.referential, [
      "constraintName",
      "tableName",
      "referencedTableName",
      "updateRule",
      "deleteRule",
    ]),
    checks: normalizeRows(observation.checks, [
      "tableName",
      "constraintName",
      "checkClause",
    ]),
  };
  const canonicalExpected = sortDeep(expected);
  return {
    exact: canonicalJson(actual) === canonicalJson(canonicalExpected),
    expectedHash: canonicalHash(canonicalExpected),
    observedHash: canonicalHash(actual),
    actual,
  };
}

export function validateTidbJournalSchema(observation) {
  const actual = {
    tables: normalizeRows(observation.tables, ["tableName", "tableType", "engine"]),
    columns: normalizeRows(observation.columns, [
      "columnName",
      "dataType",
      "columnType",
      "isNullable",
      "columnKey",
      "extra",
      "ordinalPosition",
    ]),
    indexes: normalizeRows(observation.indexes, [
      "indexName",
      "nonUnique",
      "seqInIndex",
      "columnName",
      "subPart",
      "indexType",
    ]),
    constraints: normalizeRows(observation.constraints, [
      "constraintName",
      "constraintType",
    ]),
    triggers: normalizeRows(observation.triggers, [
      "triggerName",
      "eventManipulation",
      "actionTiming",
    ]),
  };
  const expected = {
    tables: [{ tableName: "__drizzle_migrations", tableType: "BASE TABLE", engine: "InnoDB" }],
    columns: [
      {
        columnName: "id",
        dataType: "bigint",
        columnType: "bigint unsigned",
        isNullable: "NO",
        columnKey: "PRI",
        extra: "auto_increment",
        ordinalPosition: "1",
      },
      {
        columnName: "hash",
        dataType: "text",
        columnType: "text",
        isNullable: "NO",
        columnKey: "",
        extra: "",
        ordinalPosition: "2",
      },
      {
        columnName: "created_at",
        dataType: "bigint",
        columnType: "bigint",
        isNullable: "YES",
        columnKey: "",
        extra: "",
        ordinalPosition: "3",
      },
    ],
    indexes: [
      {
        indexName: "PRIMARY",
        nonUnique: "0",
        seqInIndex: "1",
        columnName: "id",
        subPart: null,
        indexType: "BTREE",
      },
      {
        indexName: "id",
        nonUnique: "0",
        seqInIndex: "1",
        columnName: "id",
        subPart: null,
        indexType: "BTREE",
      },
    ],
    constraints: [
      { constraintName: "PRIMARY", constraintType: "PRIMARY KEY" },
      { constraintName: "id", constraintType: "UNIQUE" },
    ],
    triggers: [],
  };
  const canonicalExpected = {
    tables: normalizeRows(expected.tables, ["tableName", "tableType", "engine"]),
    columns: normalizeRows(expected.columns, [
      "columnName",
      "dataType",
      "columnType",
      "isNullable",
      "columnKey",
      "extra",
      "ordinalPosition",
    ]),
    indexes: normalizeRows(expected.indexes, [
      "indexName",
      "nonUnique",
      "seqInIndex",
      "columnName",
      "subPart",
      "indexType",
    ]),
    constraints: normalizeRows(expected.constraints, ["constraintName", "constraintType"]),
    triggers: [],
  };
  return {
    exact: canonicalJson(actual) === canonicalJson(canonicalExpected),
    expectedHash: canonicalHash(canonicalExpected),
    observedHash: canonicalHash(actual),
  };
}

function exactMetadataColumns(rows, expected) {
  const actual = rows.map((row) => String(row.columnName));
  return canonicalJson(actual) === canonicalJson(expected);
}

function variableMap(rows) {
  const result = new Map();
  for (const row of rows) {
    const name = String(row.Variable_name ?? row.variableName ?? "");
    const value = String(row.Value ?? row.value ?? "");
    if (!name || result.has(name)) throw new Error("TIDB_VARIABLE_ROWS_INVALID");
    result.set(name, value);
  }
  return result;
}

function isOn(value) {
  return /^(?:1|ON)$/i.test(String(value));
}

function isOff(value) {
  return /^(?:0|OFF)$/i.test(String(value));
}

export function validateTidbCapabilities({
  globalVariableRows,
  sessionVariableRows,
  tableConstraintMetadataRows,
  checkConstraintMetadataRows,
  tidbCheckConstraintMetadataRows,
}) {
  const global = variableMap(globalVariableRows);
  const session = variableMap(sessionVariableRows);
  const requiredGlobal = [
    "foreign_key_checks",
    "require_secure_transport",
    "tidb_enable_check_constraint",
    "tidb_enable_foreign_key",
    "tidb_enable_noop_functions",
  ];
  const globalComplete = requiredGlobal.every((name) => global.has(name));
  const sessionComplete = session.has("foreign_key_checks");
  const tableMetadataExact = exactMetadataColumns(tableConstraintMetadataRows, [
    "CONSTRAINT_CATALOG",
    "CONSTRAINT_SCHEMA",
    "CONSTRAINT_NAME",
    "TABLE_SCHEMA",
    "TABLE_NAME",
    "CONSTRAINT_TYPE",
  ]);
  const checkMetadataExact = exactMetadataColumns(checkConstraintMetadataRows, [
    "CONSTRAINT_CATALOG",
    "CONSTRAINT_SCHEMA",
    "CONSTRAINT_NAME",
    "CHECK_CLAUSE",
  ]);
  const tidbCheckMetadataExact = exactMetadataColumns(tidbCheckConstraintMetadataRows, [
    "CONSTRAINT_CATALOG",
    "CONSTRAINT_SCHEMA",
    "CONSTRAINT_NAME",
    "CHECK_CLAUSE",
    "TABLE_NAME",
    "TABLE_ID",
  ]);
  const checksEnabled = isOn(global.get("tidb_enable_check_constraint"));
  const foreignKeyFeatureEnabled = isOn(global.get("tidb_enable_foreign_key"));
  const globalForeignKeyChecksEnabled = isOn(global.get("foreign_key_checks"));
  const sessionForeignKeyChecksEnabled = isOn(session.get("foreign_key_checks"));
  const noopFunctionsDisabled = isOff(global.get("tidb_enable_noop_functions"));
  const requireSecureTransportEnabled = isOn(global.get("require_secure_transport"));
  return {
    passed:
      globalComplete &&
      sessionComplete &&
      checksEnabled &&
      foreignKeyFeatureEnabled &&
      globalForeignKeyChecksEnabled &&
      sessionForeignKeyChecksEnabled &&
      noopFunctionsDisabled &&
      tableMetadataExact &&
      checkMetadataExact &&
      tidbCheckMetadataExact,
    globalComplete,
    sessionComplete,
    checksEnabled,
    foreignKeyFeatureEnabled,
    globalForeignKeyChecksEnabled,
    sessionForeignKeyChecksEnabled,
    noopFunctionsDisabled,
    requireSecureTransportEnabled,
    tableMetadataExact,
    checkMetadataExact,
    tidbCheckMetadataExact,
    values: {
      foreignKeyChecksGlobal: global.get("foreign_key_checks") ?? null,
      foreignKeyChecksSession: session.get("foreign_key_checks") ?? null,
      requireSecureTransport: global.get("require_secure_transport") ?? null,
      tidbEnableCheckConstraint: global.get("tidb_enable_check_constraint") ?? null,
      tidbEnableForeignKey: global.get("tidb_enable_foreign_key") ?? null,
      tidbEnableNoopFunctions: global.get("tidb_enable_noop_functions") ?? null,
    },
  };
}

function oneStringPerRow(rows, label) {
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

export function validateTidbAccountProfile({
  roleRows,
  grantRows,
  createUserRows,
  expectedRoleSha256,
  expectedGrantSha256,
  expectedAccountDefinitionSha256,
  expectedGrantRowCount,
}) {
  if (roleRows.length !== 1) throw new Error("TIDB_ROLE_ROW_COUNT");
  const currentRole = String(roleRows[0].currentRole ?? "");
  const grants = oneStringPerRow(grantRows, "TIDB_GRANT");
  const createStatements = oneStringPerRow(createUserRows, "TIDB_CREATE_USER");
  const forbidden =
    /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|INDEX|TRIGGER|EVENT|EXECUTE|FILE|PROCESS|SUPER|RELOAD|SHUTDOWN|REPLICATION|GRANT OPTION|SYSTEM_USER|CONNECTION_ADMIN|REFERENCES|LOCK TABLES|CREATE ROUTINE|ALTER ROUTINE|SHOW VIEW|CREATE TEMPORARY TABLES)\b/i;
  const roleSha256 = canonicalHash(currentRole);
  const grantSha256 = canonicalHash([...grants].sort());
  const accountDefinitionSha256 =
    createStatements.length === 1 ? canonicalHash(createStatements[0]) : null;
  const rowCountExact = grants.length === expectedGrantRowCount;
  const noForbiddenPrivileges = grants.every((grant) => !forbidden.test(grant));
  return {
    passed:
      currentRole === "NONE" &&
      roleSha256 === expectedRoleSha256 &&
      grantSha256 === expectedGrantSha256 &&
      accountDefinitionSha256 === expectedAccountDefinitionSha256 &&
      createStatements.length === 1 &&
      rowCountExact &&
      noForbiddenPrivileges,
    currentRoleNone: currentRole === "NONE",
    roleSha256,
    grantSha256,
    accountDefinitionSha256,
    grantRowCount: grants.length,
    expectedGrantRowCount,
    rowCountExact,
    noForbiddenPrivileges,
    accountDefinitionRowCount: createStatements.length,
    accountRequiresSslOrX509:
      createStatements.length === 1 &&
      /\bREQUIRE (?:SSL|X509)\b/i.test(createStatements[0]) &&
      !/\bREQUIRE NONE\b/i.test(createStatements[0]),
  };
}

export function classifyTidbDatabaseState(snapshot) {
  const state = classifyJournalAndPhase2a({
    relevantRows: snapshot.journal.relevantRows,
    relevantCount: snapshot.journal.relevantCount,
    latestRows: snapshot.journal.latestRows,
    phase2aTables: snapshot.phase2a.tables,
    phase2aResidue: snapshot.phase2a.residue,
  });
  if (state.databaseStateClassification === "READY_DATABASE_STATE") {
    return {
      ...state,
      databaseStateClassification: "READY_FOR_SEPARATE_APPLY_AUTHORIZATION",
      blocker: null,
    };
  }
  return state;
}

export function evaluateTidbReadiness({ facts, databaseState }) {
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
  require(facts.accountProfileMatched, "BLOCKED_TIDB_ACCOUNT_PROFILE");
  require(facts.oneConnectionOnly, "BLOCKED_CONNECTION_COUNT");
  require(facts.connectionIdConsistent, "BLOCKED_CONNECTION_ID");
  require(facts.capabilitiesObserved, "BLOCKED_TIDB_CAPABILITIES_UNOBSERVED");
  if (facts.capabilitiesObserved) {
    require(facts.checkConstraintsEnabled, "BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED");
    require(facts.foreignKeyFeatureEnabled, "BLOCKED_TIDB_FOREIGN_KEY_FEATURE_DISABLED");
    require(facts.globalForeignKeyChecksEnabled, "BLOCKED_TIDB_GLOBAL_FOREIGN_KEY_CHECKS_DISABLED");
    require(facts.sessionForeignKeyChecksEnabled, "BLOCKED_TIDB_SESSION_FOREIGN_KEY_CHECKS_DISABLED");
    require(facts.noopFunctionsDisabled, "BLOCKED_TIDB_NOOP_FUNCTIONS_ENABLED");
    require(facts.metadataCapabilitiesExact, "BLOCKED_TIDB_METADATA_CAPABILITIES");
  }
  require(facts.journalSchemaExact, "BLOCKED_JOURNAL_SCHEMA");
  require(facts.predecessorFootprintExact, "BLOCKED_PREDECESSOR_FOOTPRINT");
  require(facts.snapshotsEqual, "BLOCKED_METADATA_CHANGED_DURING_PREFLIGHT");
  require(facts.transcriptExact, "BLOCKED_EXECUTOR_TRANSCRIPT");
  require(facts.connectionClosed, "BLOCKED_CONNECTION_CLOSE");
  if (databaseState?.databaseStateClassification !== "READY_FOR_SEPARATE_APPLY_AUTHORIZATION") {
    blockers.push(databaseState?.blocker ?? "BLOCKED_DATABASE_STATE_UNKNOWN");
  }
  const uniqueBlockers = [...new Set(blockers)];
  return {
    applyReadiness:
      uniqueBlockers.length === 0
        ? "READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION"
        : uniqueBlockers[0],
    applyAuthorized: false,
    migrationAppliedByThisPreflight: false,
    blockers: uniqueBlockers,
  };
}

export function sourceAttestation({
  projectRoot,
  toolPath,
  corePath,
  expectedToolSha256,
  expectedCoreSha256,
}) {
  return verifySourceBundle({
    projectRoot,
    toolPath,
    corePath,
    expectedToolSha256,
    expectedCoreSha256,
  });
}

export function parseProductionDatabaseUrl(raw) {
  const normalized = normaliseDatabaseUrlForPreflight(raw);
  const parsed = parseDatabaseUrl(normalized.sanitizedDatabaseUrl);
  return { normalized, parsed };
}
