import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const SOURCE_CONTRACT = deepFreeze({
  expectedSourceCheckpoint: "39cbd1de",
  migration0090: {
    path: "drizzle/0090_full_potential_v1_commercial_model.sql",
    bytes: 5362,
    sha256: "8bd973622561a0ebb3b3a6a6f649ccedeaa8b95b19ba23cdac458e49c80e90b2",
    gitBlobSha1: "31f66396bce700c81705850fd0fda213f0d764b4",
    finalByte: 0x3b,
    knownSingleLfVariant:
      "85ef1c42f3e252b837fcd6df2ce350f8c9af84b5854f934410a0c7b18a677d0f",
    journalIndex: 90,
    journalTag: "0090_full_potential_v1_commercial_model",
    journalWhen: "1784077724863",
  },
  migration0091: {
    path: "drizzle/0091_issue86_buyer_route_evidence.sql",
    bytes: 23270,
    sha256: "d6b76795819387a012768978403156b3b1b7f70fd129cbfe1484d052bf7346c4",
    gitBlobSha1: "0d9518009603721b5ec6ce2b16fed28672c9f2e1",
    journalIndex: 91,
    journalTag: "0091_issue86_buyer_route_evidence",
    journalWhen: "1786008053119",
    createTableCount: 4,
    createIndexCount: 18,
    foreignKeyCount: 7,
    checkCount: 35,
    segmentCount: 29,
  },
  journal: {
    path: "drizzle/meta/_journal.json",
    gitBlobSha1: "00418af069bd35d4470b32e8b88a51c57fc8a2df",
  },
  snapshot0090: {
    path: "drizzle/meta/0090_snapshot.json",
    gitBlobSha1: "d91478126ba4d42fff52a3dd0bcb0596e0918cff",
  },
});

export const PHASE2A_TABLES = deepFreeze([
  "projectEvidenceSources",
  "projectEvidenceClaims",
  "projectEvidenceClaimSources",
  "projectEvidenceEvents",
]);

export const PREDECESSOR_CREATED_TABLES = deepFreeze([
  "fullPotentialEvidence",
  "fullPotentialModelEvidenceLinks",
  "fullPotentialModelLines",
  "fullPotentialModelReviews",
  "fullPotentialModels",
]);

export const PREDECESSOR_ACCOUNT_SENTINELS = deepFreeze([
  "parentAccountId",
  "mergedIntoAccountId",
  "relationshipType",
  "recordStatus",
  "countsTowardPotential",
]);

export const MUTATION_COUNTER_NAMES = deepFreeze([
  "Com_alter_db",
  "Com_alter_event",
  "Com_alter_function",
  "Com_alter_procedure",
  "Com_alter_server",
  "Com_alter_table",
  "Com_alter_tablespace",
  "Com_alter_user",
  "Com_analyze",
  "Com_assign_to_keycache",
  "Com_call_procedure",
  "Com_change_repl_filter",
  "Com_change_replication_source",
  "Com_create_db",
  "Com_create_event",
  "Com_create_function",
  "Com_create_index",
  "Com_create_procedure",
  "Com_create_server",
  "Com_create_table",
  "Com_create_trigger",
  "Com_create_udf",
  "Com_create_user",
  "Com_create_view",
  "Com_delete",
  "Com_delete_multi",
  "Com_do",
  "Com_drop_db",
  "Com_drop_event",
  "Com_drop_function",
  "Com_drop_index",
  "Com_drop_procedure",
  "Com_drop_server",
  "Com_drop_table",
  "Com_drop_trigger",
  "Com_drop_user",
  "Com_drop_view",
  "Com_flush",
  "Com_grant",
  "Com_insert",
  "Com_insert_select",
  "Com_install_plugin",
  "Com_load",
  "Com_lock_tables",
  "Com_optimize",
  "Com_preload_keys",
  "Com_purge",
  "Com_purge_before_date",
  "Com_rename_table",
  "Com_rename_user",
  "Com_repair",
  "Com_replace",
  "Com_replace_select",
  "Com_replica_start",
  "Com_replica_stop",
  "Com_reset",
  "Com_restart",
  "Com_revoke",
  "Com_revoke_all",
  "Com_shutdown",
  "Com_truncate",
  "Com_uninstall_plugin",
  "Com_unlock_tables",
  "Com_update",
  "Com_update_multi",
  "Com_xa_commit",
  "Com_xa_end",
  "Com_xa_prepare",
  "Com_xa_rollback",
  "Com_xa_start",
]);

const S = (kind, sql) => ({ method: "query", kind, sql });

export const SQL_STATEMENTS = deepFreeze({
  COUNTERS: S(
    "SHOW",
    "SHOW SESSION STATUS WHERE Variable_name IN ('Com_alter_db','Com_alter_event','Com_alter_function','Com_alter_procedure','Com_alter_server','Com_alter_table','Com_alter_tablespace','Com_alter_user','Com_analyze','Com_assign_to_keycache','Com_call_procedure','Com_change_repl_filter','Com_change_replication_source','Com_create_db','Com_create_event','Com_create_function','Com_create_index','Com_create_procedure','Com_create_server','Com_create_table','Com_create_trigger','Com_create_udf','Com_create_user','Com_create_view','Com_delete','Com_delete_multi','Com_do','Com_drop_db','Com_drop_event','Com_drop_function','Com_drop_index','Com_drop_procedure','Com_drop_server','Com_drop_table','Com_drop_trigger','Com_drop_user','Com_drop_view','Com_flush','Com_grant','Com_insert','Com_insert_select','Com_install_plugin','Com_load','Com_lock_tables','Com_optimize','Com_preload_keys','Com_purge','Com_purge_before_date','Com_rename_table','Com_rename_user','Com_repair','Com_replace','Com_replace_select','Com_replica_start','Com_replica_stop','Com_reset','Com_restart','Com_revoke','Com_revoke_all','Com_shutdown','Com_truncate','Com_uninstall_plugin','Com_unlock_tables','Com_update','Com_update_multi','Com_xa_commit','Com_xa_end','Com_xa_prepare','Com_xa_rollback','Com_xa_start')",
  ),
  CONNECTION_ID: S("READ", "SELECT CONNECTION_ID() AS connectionId"),
  TLS_STATUS: S(
    "SHOW",
    "SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_cipher','Ssl_version')",
  ),
  ENGINE_IDENTITY: S(
    "READ",
    "SELECT VERSION() AS versionString, @@version_comment AS versionComment, CONNECTION_ID() AS connectionId, SHA2(CURRENT_USER(), 256) AS currentUserSha256, SHA2(CONCAT_WS(CHAR(0), @@server_uuid, DATABASE(), @@port, CURRENT_USER()), 256) AS targetIdentitySha256",
  ),
  CURRENT_ROLE: S("READ", "SELECT CURRENT_ROLE() AS currentRole"),
  SHOW_GRANTS: S("SHOW", "SHOW GRANTS"),
  SHOW_CREATE_USER: S("SHOW", "SHOW CREATE USER CURRENT_USER()"),
  SET_ISOLATION: S(
    "CONTROL",
    "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ",
  ),
  SET_READ_ONLY: S("CONTROL", "SET SESSION TRANSACTION READ ONLY"),
  START_SNAPSHOT: S(
    "CONTROL",
    "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY",
  ),
  SHOW_WARNINGS: S("SHOW", "SHOW WARNINGS"),
  CONFIRM_SESSION: S(
    "READ",
    "SELECT @@session.transaction_read_only AS transactionReadOnly, @@session.transaction_isolation AS transactionIsolation, CONNECTION_ID() AS connectionId",
  ),
  ROLLBACK: S("CONTROL", "ROLLBACK"),
  ORACLE_CAPABILITIES: S(
    "READ",
    "SELECT @@version AS versionVariable, @@version_comment AS versionComment, @@version_compile_os AS versionCompileOs, @@version_compile_machine AS versionCompileMachine, @@license AS serverLicense, @@lower_case_table_names AS lowerCaseTableNames, @@default_storage_engine AS defaultStorageEngine, @@session.foreign_key_checks AS sessionForeignKeyChecks, @@global.foreign_key_checks AS globalForeignKeyChecks, @@session.sql_mode AS sessionSqlMode, @@character_set_server AS serverCharacterSet, @@collation_server AS serverCollation",
  ),
  TABLE_CONSTRAINTS_METADATA: S(
    "READ",
    "SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, IS_NULLABLE AS isNullable, ORDINAL_POSITION AS ordinalPosition FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema' AND TABLE_NAME = 'TABLE_CONSTRAINTS' ORDER BY ORDINAL_POSITION",
  ),
  CHECK_CONSTRAINTS_METADATA: S(
    "READ",
    "SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, IS_NULLABLE AS isNullable, ORDINAL_POSITION AS ordinalPosition FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema' AND TABLE_NAME = 'CHECK_CONSTRAINTS' ORDER BY ORDINAL_POSITION",
  ),
  REGEXP_CAPABILITY: S(
    "READ",
    "SELECT REGEXP_LIKE(REPEAT('a', 64), '^[0-9a-f]{64}$', 'c') AS lowercaseAccepted, REGEXP_LIKE(REPEAT('A', 64), '^[0-9a-f]{64}$', 'c') AS uppercaseAccepted, REGEXP_LIKE(REPEAT('a', 63), '^[0-9a-f]{64}$', 'c') AS shortAccepted",
  ),
  JOURNAL_TABLES: S(
    "READ",
    "SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = '__drizzle_migrations' ORDER BY BINARY TABLE_NAME",
  ),
  JOURNAL_COLUMNS: S(
    "READ",
    "SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_KEY AS columnKey, EXTRA AS extra, ORDINAL_POSITION AS ordinalPosition FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations' ORDER BY ORDINAL_POSITION",
  ),
  JOURNAL_INDEXES: S(
    "READ",
    "SELECT INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seqInIndex, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations' ORDER BY INDEX_NAME, SEQ_IN_INDEX",
  ),
  JOURNAL_CONSTRAINTS: S(
    "READ",
    "SELECT CONSTRAINT_NAME AS constraintName, CONSTRAINT_TYPE AS constraintType, ENFORCED AS enforced FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations' ORDER BY CONSTRAINT_NAME",
  ),
  JOURNAL_TRIGGERS: S(
    "READ",
    "SELECT TRIGGER_NAME AS triggerName, EVENT_MANIPULATION AS eventManipulation, ACTION_TIMING AS actionTiming FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = '__drizzle_migrations' ORDER BY TRIGGER_NAME",
  ),
  JOURNAL_RELEVANT_COUNT: S(
    "READ",
    "SELECT COUNT(*) AS rowCount FROM __drizzle_migrations WHERE created_at >= 1784077724863 OR hash IN ('8bd973622561a0ebb3b3a6a6f649ccedeaa8b95b19ba23cdac458e49c80e90b2','85ef1c42f3e252b837fcd6df2ce350f8c9af84b5854f934410a0c7b18a677d0f','d6b76795819387a012768978403156b3b1b7f70fd129cbfe1484d052bf7346c4')",
  ),
  JOURNAL_RELEVANT: S(
    "READ",
    "SELECT CAST(id AS CHAR) AS id, hash, CAST(created_at AS CHAR) AS createdAt FROM __drizzle_migrations WHERE created_at >= 1784077724863 OR hash IN ('8bd973622561a0ebb3b3a6a6f649ccedeaa8b95b19ba23cdac458e49c80e90b2','85ef1c42f3e252b837fcd6df2ce350f8c9af84b5854f934410a0c7b18a677d0f','d6b76795819387a012768978403156b3b1b7f70fd129cbfe1484d052bf7346c4') ORDER BY created_at, id LIMIT 1001",
  ),
  JOURNAL_LATEST: S(
    "READ",
    "SELECT CAST(id AS CHAR) AS id, hash, CAST(created_at AS CHAR) AS createdAt FROM __drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 10",
  ),
  PREDECESSOR_TABLES: S(
    "READ",
    "SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) IN ('fullpotentialaccounts','fullpotentialevidence','fullpotentialmodelevidencelinks','fullpotentialmodellines','fullpotentialmodelreviews','fullpotentialmodels') ORDER BY BINARY TABLE_NAME",
  ),
  PREDECESSOR_COLUMNS: S(
    "READ",
    "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, ORDINAL_POSITION AS ordinalPosition, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME IN ('fullPotentialEvidence','fullPotentialModelEvidenceLinks','fullPotentialModelLines','fullPotentialModelReviews','fullPotentialModels') OR (TABLE_NAME = 'fullPotentialAccounts' AND COLUMN_NAME IN ('parentAccountId','mergedIntoAccountId','relationshipType','recordStatus','countsTowardPotential'))) ORDER BY BINARY TABLE_NAME, ORDINAL_POSITION",
  ),
  PREDECESSOR_INDEXES: S(
    "READ",
    "SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seqInIndex, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('fullPotentialEvidence','fullPotentialModelEvidenceLinks','fullPotentialModelLines','fullPotentialModelReviews','fullPotentialModels') ORDER BY BINARY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
  ),
  PREDECESSOR_CONSTRAINTS: S(
    "READ",
    "SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, CONSTRAINT_TYPE AS constraintType, ENFORCED AS enforced FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('fullPotentialEvidence','fullPotentialModelEvidenceLinks','fullPotentialModelLines','fullPotentialModelReviews','fullPotentialModels') ORDER BY BINARY TABLE_NAME, CONSTRAINT_NAME",
  ),
  PREDECESSOR_KEYS: S(
    "READ",
    "SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, COLUMN_NAME AS columnName, ORDINAL_POSITION AS ordinalPosition, REFERENCED_TABLE_NAME AS referencedTableName, REFERENCED_COLUMN_NAME AS referencedColumnName FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('fullPotentialEvidence','fullPotentialModelEvidenceLinks','fullPotentialModelLines','fullPotentialModelReviews','fullPotentialModels') ORDER BY BINARY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION",
  ),
  PREDECESSOR_REFERENTIAL: S(
    "READ",
    "SELECT CONSTRAINT_NAME AS constraintName, TABLE_NAME AS tableName, REFERENCED_TABLE_NAME AS referencedTableName, UPDATE_RULE AS updateRule, DELETE_RULE AS deleteRule FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('fullPotentialEvidence','fullPotentialModelEvidenceLinks','fullPotentialModelLines','fullPotentialModelReviews','fullPotentialModels') ORDER BY BINARY TABLE_NAME, CONSTRAINT_NAME",
  ),
  PREDECESSOR_CHECKS: S(
    "READ",
    "SELECT tc.TABLE_NAME AS tableName, tc.CONSTRAINT_NAME AS constraintName, tc.ENFORCED AS enforced, cc.CHECK_CLAUSE AS checkClause FROM information_schema.TABLE_CONSTRAINTS tc INNER JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND tc.TABLE_NAME IN ('fullPotentialEvidence','fullPotentialModelEvidenceLinks','fullPotentialModelLines','fullPotentialModelReviews','fullPotentialModels') ORDER BY BINARY tc.TABLE_NAME, tc.CONSTRAINT_NAME",
  ),
  PHASE2A_TABLES: S(
    "READ",
    "SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) IN ('projectevidencesources','projectevidenceclaims','projectevidenceclaimsources','projectevidenceevents') ORDER BY BINARY TABLE_NAME",
  ),
  PHASE2A_RESIDUE: S(
    "READ",
    "SELECT 'constraint' AS objectKind, TABLE_NAME AS tableName, CONSTRAINT_NAME AS objectName FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND LOWER(CONSTRAINT_NAME) LIKE 'projectevidence%' UNION ALL SELECT 'index' AS objectKind, TABLE_NAME AS tableName, INDEX_NAME AS objectName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND LOWER(INDEX_NAME) LIKE 'projectevidence%' ORDER BY objectKind, tableName, objectName",
  ),
});

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function gitBlobSha1(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const prefix = Buffer.from(`blob ${buffer.length}\0`);
  return createHash("sha1").update(prefix).update(buffer).digest("hex");
}

export function sortDeep(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortDeep);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortDeep(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(sortDeep(value), null, 2) + "\n";
}

export function canonicalHash(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function readRegularFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`SOURCE_NOT_REGULAR_FILE:${path}`);
  }
  return readFileSync(path);
}

function verifyFile(buffer, expected, errors, label) {
  const digest = sha256(buffer);
  const blob = gitBlobSha1(buffer);
  if (buffer.length !== expected.bytes) errors.push(`${label}_BYTE_SIZE_MISMATCH`);
  if (digest !== expected.sha256) errors.push(`${label}_SHA256_MISMATCH`);
  if (expected.gitBlobSha1 && blob !== expected.gitBlobSha1) {
    errors.push(`${label}_GIT_BLOB_MISMATCH`);
  }
  return { byteSize: buffer.length, sha256: digest, gitBlobSha1: blob };
}

function inspect0091(sql) {
  const segments = sql
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean);
  const createTableCount = segments.filter((s) => /^CREATE TABLE /i.test(s)).length;
  const createIndexCount = segments.filter((s) =>
    /^CREATE (?:UNIQUE )?INDEX /i.test(s),
  ).length;
  const foreignKeyCount = segments.filter((s) =>
    /^ALTER TABLE [\s\S]+ ADD CONSTRAINT [\s\S]+ FOREIGN KEY /i.test(s),
  ).length;
  const checkCount = (sql.match(/\bCHECK\s*\(/gi) ?? []).length;
  const allowed = segments.every(
    (s) =>
      /^CREATE TABLE /i.test(s) ||
      /^CREATE (?:UNIQUE )?INDEX /i.test(s) ||
      /^ALTER TABLE [\s\S]+ ADD CONSTRAINT [\s\S]+ FOREIGN KEY /i.test(s),
  );
  const forbidden = segments.some((s) =>
    /^(?:INSERT|UPDATE|DELETE|REPLACE|DROP|TRUNCATE|RENAME|GRANT|REVOKE|LOAD|CALL|CREATE TEMPORARY)\b/i.test(
      s,
    ),
  );
  return {
    segmentCount: segments.length,
    createTableCount,
    createIndexCount,
    foreignKeyCount,
    checkCount,
    allowed,
    forbidden,
  };
}

export function verifySourceBundle({
  projectRoot,
  toolPath,
  corePath,
  expectedToolSha256,
  expectedCoreSha256,
}) {
  const errors = [];
  if (!/^[0-9a-f]{64}$/.test(expectedToolSha256 ?? "")) {
    errors.push("EXPECTED_TOOL_SHA256_MISSING_OR_INVALID");
  }
  if (!/^[0-9a-f]{64}$/.test(expectedCoreSha256 ?? "")) {
    errors.push("EXPECTED_CORE_SHA256_MISSING_OR_INVALID");
  }

  const tool = readRegularFile(toolPath);
  const core = readRegularFile(corePath);
  const toolActual = sha256(tool);
  const coreActual = sha256(core);
  if (toolActual !== expectedToolSha256) errors.push("RUNTIME_TOOL_SHA256_MISMATCH");
  if (coreActual !== expectedCoreSha256) errors.push("RUNTIME_CORE_SHA256_MISMATCH");

  const path0090 = resolve(projectRoot, SOURCE_CONTRACT.migration0090.path);
  const path0091 = resolve(projectRoot, SOURCE_CONTRACT.migration0091.path);
  const journalPath = resolve(projectRoot, SOURCE_CONTRACT.journal.path);
  const snapshotPath = resolve(projectRoot, SOURCE_CONTRACT.snapshot0090.path);
  const buffer0090 = readRegularFile(path0090);
  const buffer0091 = readRegularFile(path0091);
  const journalBuffer = readRegularFile(journalPath);
  const snapshotBuffer = readRegularFile(snapshotPath);

  const attestation0090 = verifyFile(
    buffer0090,
    SOURCE_CONTRACT.migration0090,
    errors,
    "MIGRATION_0090",
  );
  if (
    buffer0090.length === 0 ||
    buffer0090[buffer0090.length - 1] !== SOURCE_CONTRACT.migration0090.finalByte
  ) {
    errors.push("MIGRATION_0090_FINAL_BYTE_MISMATCH");
  }

  const attestation0091 = verifyFile(
    buffer0091,
    SOURCE_CONTRACT.migration0091,
    errors,
    "MIGRATION_0091",
  );
  if (gitBlobSha1(journalBuffer) !== SOURCE_CONTRACT.journal.gitBlobSha1) {
    errors.push("JOURNAL_GIT_BLOB_MISMATCH");
  }
  if (
    gitBlobSha1(snapshotBuffer) !== SOURCE_CONTRACT.snapshot0090.gitBlobSha1
  ) {
    errors.push("SNAPSHOT_0090_GIT_BLOB_MISMATCH");
  }

  let journal;
  let snapshot0090;
  try {
    journal = JSON.parse(journalBuffer.toString("utf8"));
    snapshot0090 = JSON.parse(snapshotBuffer.toString("utf8"));
  } catch {
    errors.push("SOURCE_JSON_PARSE_FAILED");
  }

  if (journal) {
    for (const expected of [
      SOURCE_CONTRACT.migration0090,
      SOURCE_CONTRACT.migration0091,
    ]) {
      const matches = journal.entries?.filter(
        (entry) =>
          entry.idx === expected.journalIndex ||
          entry.tag === expected.journalTag,
      );
      if (
        matches?.length !== 1 ||
        String(matches[0].when) !== expected.journalWhen ||
        matches[0].idx !== expected.journalIndex ||
        matches[0].tag !== expected.journalTag ||
        matches[0].version !== "5" ||
        matches[0].breakpoints !== true
      ) {
        errors.push(`JOURNAL_SOURCE_${expected.journalIndex}_MISMATCH`);
      }
    }
  }

  const inventory = inspect0091(buffer0091.toString("utf8"));
  for (const [key, expected] of [
    ["segmentCount", SOURCE_CONTRACT.migration0091.segmentCount],
    ["createTableCount", SOURCE_CONTRACT.migration0091.createTableCount],
    ["createIndexCount", SOURCE_CONTRACT.migration0091.createIndexCount],
    ["foreignKeyCount", SOURCE_CONTRACT.migration0091.foreignKeyCount],
    ["checkCount", SOURCE_CONTRACT.migration0091.checkCount],
  ]) {
    if (inventory[key] !== expected) errors.push(`MIGRATION_0091_${key}_MISMATCH`);
  }
  if (!inventory.allowed || inventory.forbidden) {
    errors.push("MIGRATION_0091_STATEMENT_BOUNDARY_FAILED");
  }

  return {
    passed: errors.length === 0,
    errors,
    expectedSourceCheckpoint: SOURCE_CONTRACT.expectedSourceCheckpoint,
    runtime: {
      tool: { byteSize: tool.length, sha256: toolActual },
      core: { byteSize: core.length, sha256: coreActual },
    },
    migration0090: {
      ...attestation0090,
      expectedSha256: SOURCE_CONTRACT.migration0090.sha256,
      finalByteHex:
        buffer0090.length > 0
          ? buffer0090[buffer0090.length - 1].toString(16).padStart(2, "0")
          : null,
    },
    migration0091: {
      ...attestation0091,
      expectedSha256: SOURCE_CONTRACT.migration0091.sha256,
    },
    journalGitBlobSha1: gitBlobSha1(journalBuffer),
    snapshot0090GitBlobSha1: gitBlobSha1(snapshotBuffer),
    inventory,
    snapshot0090,
  };
}

function decodeUrlComponent(value, label) {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error(`DATABASE_URL_${label}_BAD_ENCODING`);
  }
  if (!decoded || /[\u0000-\u001f\u007f]/.test(decoded)) {
    throw new Error(`DATABASE_URL_${label}_INVALID`);
  }
  return decoded;
}

export function parseDatabaseUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096) {
    throw new Error("DATABASE_URL_MISSING_OR_INVALID");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL_PARSE_FAILED");
  }
  if (parsed.protocol !== "mysql:") throw new Error("DATABASE_URL_SCHEME_REJECTED");
  if (parsed.search || parsed.hash) throw new Error("DATABASE_URL_OPTIONS_REJECTED");
  if (!parsed.hostname || !parsed.username || !parsed.password) {
    throw new Error("DATABASE_URL_COMPONENT_MISSING");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) throw new Error("DATABASE_URL_DATABASE_PATH_INVALID");
  const port = parsed.port === "" ? 3306 : Number(parsed.port);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (parsed.port !== "" && String(port) !== parsed.port)
  ) {
    throw new Error("DATABASE_URL_PORT_INVALID");
  }
  const host = decodeUrlComponent(parsed.hostname, "HOST");
  const user = decodeUrlComponent(parsed.username, "USER");
  const password = decodeUrlComponent(parsed.password, "PASSWORD");
  const database = decodeUrlComponent(segments[0], "DATABASE");
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database)) {
    throw new Error("DATABASE_URL_DATABASE_IDENTIFIER_REJECTED");
  }
  return {
    config: {
      host,
      port,
      user,
      password,
      database,
      charset: "utf8mb4",
      multipleStatements: false,
      namedPlaceholders: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true,
      timezone: "Z",
      flags: "-LOCAL_FILES",
      ssl: {
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      },
    },
    secrets: {
      highRisk: [
        raw,
        password,
        encodeURIComponent(password),
        `${user}:${password}@`,
      ].filter(Boolean),
      contextual: [host, user, database].filter(Boolean),
    },
  };
}

export function classifyEngine(versionString, versionComment) {
  const version = String(versionString ?? "");
  const comment = String(versionComment ?? "");
  const combined = `${version} ${comment}`.toLowerCase();
  const markers = {
    tidb: combined.includes("tidb"),
    mariadb: combined.includes("mariadb") || combined.includes("maria db"),
    percona: combined.includes("percona"),
    vitess: combined.includes("vitess") || combined.includes("planetscale"),
    aurora: combined.includes("aurora"),
    ndb:
      combined.includes("ndb cluster") ||
      combined.includes("ndbcluster") ||
      /\bndb\b/.test(combined),
  };
  const compatibilityLayerDetected = Object.values(markers).some(Boolean);
  const oracleComment =
    /mysql community server/i.test(comment) ||
    /mysql enterprise/i.test(comment) ||
    /mysql commercial/i.test(comment);
  const oracleMySql84ExactProfileMatched =
    /^8\.4\.[0-9]+$/.test(version) &&
    oracleComment &&
    !compatibilityLayerDetected;
  return {
    versionString: version,
    versionComment: comment,
    markers,
    compatibilityLayerDetected,
    oracleMySql84ExactProfileMatched,
    engineClassificationCertain:
      oracleMySql84ExactProfileMatched || compatibilityLayerDetected,
  };
}

export function parseStatusRows(rows, requiredNames) {
  if (!Array.isArray(rows)) throw new Error("STATUS_ROWS_NOT_ARRAY");
  const values = new Map();
  for (const row of rows) {
    const name = row.Variable_name ?? row.variableName;
    const value = row.Value ?? row.value;
    if (typeof name !== "string" || values.has(name)) {
      throw new Error("STATUS_ROWS_DUPLICATE_OR_INVALID_NAME");
    }
    values.set(name, String(value ?? ""));
  }
  for (const name of requiredNames) {
    if (!values.has(name)) throw new Error(`STATUS_ROW_MISSING:${name}`);
  }
  return values;
}

export function parseMutationCounters(rows) {
  const all = parseStatusRows(rows, MUTATION_COUNTER_NAMES);
  if (all.size !== MUTATION_COUNTER_NAMES.length) {
    throw new Error("MUTATION_COUNTER_SET_UNEXPECTED");
  }
  const counters = {};
  for (const name of MUTATION_COUNTER_NAMES) {
    const raw = all.get(name);
    if (!/^(0|[1-9][0-9]*)$/.test(raw)) {
      throw new Error(`MUTATION_COUNTER_INVALID:${name}`);
    }
    counters[name] = BigInt(raw);
  }
  return counters;
}

export function compareMutationCounters(before, after) {
  const deltas = {};
  let allZero = true;
  for (const name of MUTATION_COUNTER_NAMES) {
    if (!(name in before) || !(name in after)) {
      throw new Error(`MUTATION_COUNTER_SET_INCOMPLETE:${name}`);
    }
    if (after[name] < before[name]) {
      throw new Error(`MUTATION_COUNTER_DECREASED:${name}`);
    }
    const delta = after[name] - before[name];
    deltas[name] = delta.toString();
    if (delta !== 0n) allZero = false;
  }
  return { allZero, deltas };
}

function normalizeDefault(value, columnType = "") {
  if (value === undefined || value === null) return null;
  let text = String(value);
  if (/^'.*'$/.test(text)) text = text.slice(1, -1);
  if (/^\(now\(\)\)$/i.test(text)) return "CURRENT_TIMESTAMP";
  if (/^current_timestamp(?:\(\))?$/i.test(text)) return "CURRENT_TIMESTAMP";
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

function expectedColumn(tableName, column, ordinalPosition) {
  const extra = [
    column.autoincrement ? "auto_increment" : "",
    column.onUpdate ? "on update current_timestamp" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    tableName,
    columnName: column.name,
    ordinalPosition: String(ordinalPosition),
    columnType: normalizeType(column.type),
    isNullable: column.notNull ? "NO" : "YES",
    columnDefault: normalizeDefault(column.default, column.type),
    extra,
  };
}

function expectedIndexes(tableName, table) {
  const rows = [];
  for (const pk of Object.values(table.compositePrimaryKeys ?? {})) {
    pk.columns.forEach((columnName, index) =>
      rows.push({
        tableName,
        indexName: "PRIMARY",
        nonUnique: "0",
        seqInIndex: String(index + 1),
        columnName,
        subPart: null,
        indexType: "BTREE",
      }),
    );
  }
  for (const unique of Object.values(table.uniqueConstraints ?? {})) {
    unique.columns.forEach((columnName, index) =>
      rows.push({
        tableName,
        indexName: unique.name,
        nonUnique: "0",
        seqInIndex: String(index + 1),
        columnName,
        subPart: null,
        indexType: "BTREE",
      }),
    );
  }
  for (const index of Object.values(table.indexes ?? {})) {
    index.columns.forEach((column, position) =>
      rows.push({
        tableName,
        indexName: index.name,
        nonUnique: index.isUnique ? "0" : "1",
        seqInIndex: String(position + 1),
        columnName: typeof column === "string" ? column : column.expression,
        subPart: null,
        indexType: String(index.method ?? "BTREE").toUpperCase(),
      }),
    );
  }
  return rows.sort(compareRows);
}

function compareRows(a, b) {
  return canonicalJson(a).localeCompare(canonicalJson(b));
}

export function buildExpected0090Contract(snapshot) {
  if (!snapshot?.tables) throw new Error("SNAPSHOT_0090_TABLES_MISSING");
  const tables = [];
  const columns = [];
  const indexes = [];
  const constraints = [];
  const keys = [];

  for (const tableName of PREDECESSOR_CREATED_TABLES) {
    const table = snapshot.tables[tableName];
    if (!table) throw new Error(`SNAPSHOT_0090_TABLE_MISSING:${tableName}`);
    tables.push({ tableName, tableType: "BASE TABLE", engine: "InnoDB" });
    Object.values(table.columns).forEach((column, index) => {
      columns.push(expectedColumn(tableName, column, index + 1));
    });
    const tableIndexes = expectedIndexes(tableName, table);
    indexes.push(...tableIndexes);
    const primary = Object.values(table.compositePrimaryKeys ?? {});
    for (const item of primary) {
      constraints.push({
        tableName,
        constraintName: "PRIMARY",
        constraintType: "PRIMARY KEY",
        enforced: "YES",
      });
      item.columns.forEach((columnName, index) =>
        keys.push({
          tableName,
          constraintName: "PRIMARY",
          columnName,
          ordinalPosition: String(index + 1),
          referencedTableName: null,
          referencedColumnName: null,
        }),
      );
    }
    for (const item of Object.values(table.uniqueConstraints ?? {})) {
      constraints.push({
        tableName,
        constraintName: item.name,
        constraintType: "UNIQUE",
        enforced: "YES",
      });
      item.columns.forEach((columnName, index) =>
        keys.push({
          tableName,
          constraintName: item.name,
          columnName,
          ordinalPosition: String(index + 1),
          referencedTableName: null,
          referencedColumnName: null,
        }),
      );
    }
    if (
      Object.keys(table.foreignKeys ?? {}).length ||
      Object.keys(table.checkConstraint ?? {}).length
    ) {
      throw new Error(`SNAPSHOT_0090_UNEXPECTED_CONSTRAINT:${tableName}`);
    }
  }

  const account = snapshot.tables.fullPotentialAccounts;
  if (!account) throw new Error("SNAPSHOT_0090_ACCOUNT_TABLE_MISSING");
  tables.push({
    tableName: "fullPotentialAccounts",
    tableType: "BASE TABLE",
    engine: "InnoDB",
  });
  const accountColumns = Object.values(account.columns);
  const firstAppendedSentinelOrdinal =
    accountColumns.length - PREDECESSOR_ACCOUNT_SENTINELS.length + 1;
  if (firstAppendedSentinelOrdinal < 1) {
    throw new Error("SNAPSHOT_0090_ACCOUNT_COLUMN_COUNT_INVALID");
  }
  PREDECESSOR_ACCOUNT_SENTINELS.forEach((sentinel, sentinelIndex) => {
    const column = accountColumns.find((candidate) => candidate.name === sentinel);
    if (!column) throw new Error(`SNAPSHOT_0090_SENTINEL_MISSING:${sentinel}`);
    // 0090 adds these five columns with plain ALTER TABLE ... ADD statements.
    // MySQL appends them after the 37 predecessor columns (physical ordinals 38-42),
    // even though Drizzle's snapshot serializes them near the start of the object.
    columns.push(
      expectedColumn(
        "fullPotentialAccounts",
        column,
        firstAppendedSentinelOrdinal + sentinelIndex,
      ),
    );
  });

  return deepFreeze({
    tables: tables.sort(compareRows),
    columns: columns.sort(compareRows),
    indexes: indexes.sort(compareRows),
    constraints: constraints.sort(compareRows),
    keys: keys.sort(compareRows),
    referential: [],
    checks: [],
  });
}

function normalizeObservedRows(rows, fields) {
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

export function validate0090Footprint(observation, expected) {
  const actual = {
    tables: normalizeObservedRows(observation.tables, [
      "tableName",
      "tableType",
      "engine",
    ]),
    columns: normalizeObservedRows(observation.columns, [
      "tableName",
      "columnName",
      "ordinalPosition",
      "columnType",
      "isNullable",
      "columnDefault",
      "extra",
    ]),
    indexes: normalizeObservedRows(observation.indexes, [
      "tableName",
      "indexName",
      "nonUnique",
      "seqInIndex",
      "columnName",
      "subPart",
      "indexType",
    ]),
    constraints: normalizeObservedRows(observation.constraints, [
      "tableName",
      "constraintName",
      "constraintType",
      "enforced",
    ]),
    keys: normalizeObservedRows(observation.keys, [
      "tableName",
      "constraintName",
      "columnName",
      "ordinalPosition",
      "referencedTableName",
      "referencedColumnName",
    ]),
    referential: normalizeObservedRows(observation.referential, [
      "constraintName",
      "tableName",
      "referencedTableName",
      "updateRule",
      "deleteRule",
    ]),
    checks: normalizeObservedRows(observation.checks, [
      "tableName",
      "constraintName",
      "enforced",
      "checkClause",
    ]),
  };
  const expectedCanonical = sortDeep(expected);
  const exact = canonicalJson(actual) === canonicalJson(expectedCanonical);
  return {
    exact,
    expectedHash: canonicalHash(expectedCanonical),
    observedHash: canonicalHash(actual),
    actual,
  };
}

function canonicalDecimal(value, label) {
  const text = String(value ?? "");
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    throw new Error(`${label}_NOT_CANONICAL_DECIMAL`);
  }
  return text;
}

export function validateJournalSchema({
  tables,
  columns,
  indexes,
  constraints,
  triggers,
}) {
  const actual = {
    tables: normalizeObservedRows(tables, ["tableName", "tableType", "engine"]),
    columns: normalizeObservedRows(columns, [
      "columnName",
      "dataType",
      "columnType",
      "isNullable",
      "columnKey",
      "extra",
      "ordinalPosition",
    ]),
    indexes: normalizeObservedRows(indexes, [
      "indexName",
      "nonUnique",
      "seqInIndex",
      "columnName",
      "subPart",
      "indexType",
    ]),
    constraints: normalizeObservedRows(constraints, [
      "constraintName",
      "constraintType",
      "enforced",
    ]),
    triggers: normalizeObservedRows(triggers, [
      "triggerName",
      "eventManipulation",
      "actionTiming",
    ]),
  };
  const expected = {
    tables: [
      {
        tableName: "__drizzle_migrations",
        tableType: "BASE TABLE",
        engine: "InnoDB",
      },
    ],
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
      {
        constraintName: "PRIMARY",
        constraintType: "PRIMARY KEY",
        enforced: "YES",
      },
      {
        constraintName: "id",
        constraintType: "UNIQUE",
        enforced: "YES",
      },
    ],
    triggers: [],
  };
  const expectedCanonical = {
    tables: normalizeObservedRows(expected.tables, ["tableName", "tableType", "engine"]),
    columns: normalizeObservedRows(expected.columns, [
      "columnName",
      "dataType",
      "columnType",
      "isNullable",
      "columnKey",
      "extra",
      "ordinalPosition",
    ]),
    indexes: normalizeObservedRows(expected.indexes, [
      "indexName",
      "nonUnique",
      "seqInIndex",
      "columnName",
      "subPart",
      "indexType",
    ]),
    constraints: normalizeObservedRows(expected.constraints, [
      "constraintName",
      "constraintType",
      "enforced",
    ]),
    triggers: normalizeObservedRows(expected.triggers, [
      "triggerName",
      "eventManipulation",
      "actionTiming",
    ]),
  };
  const exact = canonicalJson(actual) === canonicalJson(expectedCanonical);
  return {
    exact,
    expectedHash: canonicalHash(expectedCanonical),
    observedHash: canonicalHash(actual),
  };
}

export function classifyJournalAndPhase2a({
  relevantRows,
  relevantCount,
  latestRows,
  phase2aTables,
  phase2aResidue,
}) {
  const count = BigInt(canonicalDecimal(relevantCount, "JOURNAL_RELEVANT_COUNT"));
  if (count > 1000n || BigInt(relevantRows.length) !== count) {
    return {
      databaseStateClassification: "BLOCKED_JOURNAL_RESULT_TRUNCATED",
      blocker: "BLOCKED_JOURNAL_RESULT_TRUNCATED",
    };
  }
  const rows = relevantRows.map((row) => ({
    id: canonicalDecimal(row.id, "JOURNAL_ID"),
    hash: String(row.hash ?? ""),
    createdAt: canonicalDecimal(row.createdAt, "JOURNAL_CREATED_AT"),
  }));
  const latest = latestRows.map((row) => ({
    id: canonicalDecimal(row.id, "JOURNAL_LATEST_ID"),
    hash: String(row.hash ?? ""),
    createdAt: canonicalDecimal(row.createdAt, "JOURNAL_LATEST_CREATED_AT"),
  }));

  const c90 = SOURCE_CONTRACT.migration0090;
  const c91 = SOURCE_CONTRACT.migration0091;
  const exact90 = rows.filter(
    (row) => row.hash === c90.sha256 && row.createdAt === c90.journalWhen,
  );
  const lf90ByHash = rows.filter(
    (row) => row.hash === c90.knownSingleLfVariant,
  );
  const lf90 = lf90ByHash.filter(
    (row) => row.createdAt === c90.journalWhen,
  );
  const timestamp90 = rows.filter((row) => row.createdAt === c90.journalWhen);
  const hash90 = rows.filter((row) => row.hash === c90.sha256);
  const exact91 = rows.filter(
    (row) => row.hash === c91.sha256 && row.createdAt === c91.journalWhen,
  );
  const timestamp91 = rows.filter((row) => row.createdAt === c91.journalWhen);
  const hash91 = rows.filter((row) => row.hash === c91.sha256);
  const laterUnexpected = rows.filter(
    (row) =>
      BigInt(row.createdAt) > BigInt(c90.journalWhen) &&
      !(row.hash === c91.sha256 && row.createdAt === c91.journalWhen),
  );

  const foundNames = phase2aTables.map((row) => row.tableName);
  const exactPhaseNames =
    foundNames.length === PHASE2A_TABLES.length &&
    PHASE2A_TABLES.every((name) => foundNames.includes(name));
  const exactPhaseBasics =
    exactPhaseNames &&
    phase2aTables.every(
      (row) => row.tableType === "BASE TABLE" && row.engine === "InnoDB",
    );
  const phaseAbsent = phase2aTables.length === 0 && phase2aResidue.length === 0;
  const phasePartial =
    !phaseAbsent && !(exactPhaseBasics && phase2aResidue.length > 0);

  let databaseStateClassification;
  let blocker = null;
  if (
    timestamp91.length !== exact91.length ||
    hash91.length !== exact91.length ||
    exact91.length > 1
  ) {
    databaseStateClassification = "BLOCKED_JOURNAL_HASH_MISMATCH";
  } else if (laterUnexpected.length > 0) {
    databaseStateClassification = "BLOCKED_UNEXPECTED_MIGRATION_ORDER";
  } else if (lf90.length > 0) {
    databaseStateClassification =
      "BLOCKED_PREDECESSOR_HASH_VARIANT_REQUIRES_CONTROLLER_REVIEW";
  } else if (lf90ByHash.length > 0) {
    databaseStateClassification = "BLOCKED_PREDECESSOR_DIVERGENCE";
  } else if (
    exact90.length !== 1 ||
    timestamp90.length !== 1 ||
    hash90.length !== 1
  ) {
    databaseStateClassification = "BLOCKED_PREDECESSOR_DIVERGENCE";
  } else if (
    exact91.length === 1 &&
    (latest.length === 0 ||
      latest[0].hash !== c91.sha256 ||
      latest[0].createdAt !== c91.journalWhen)
  ) {
    databaseStateClassification = "BLOCKED_JOURNAL_LATEST_INCONSISTENT";
  } else if (exact91.length === 1 && exactPhaseBasics) {
    databaseStateClassification =
      "ALREADY_APPLIED_REQUIRES_EXACT_POST_VERIFY";
  } else if (exact91.length === 1) {
    databaseStateClassification =
      "BLOCKED_JOURNALED_SCHEMA_MISSING_OR_DIVERGENT";
  } else if (!phaseAbsent && !exactPhaseBasics) {
    databaseStateClassification = "BLOCKED_PARTIAL_OR_CASE_COLLIDING_SCHEMA";
  } else if (exactPhaseBasics) {
    databaseStateClassification = "BLOCKED_UNJOURNALED_SCHEMA";
  } else if (
    latest.length === 0 ||
    latest[0].hash !== c90.sha256 ||
    latest[0].createdAt !== c90.journalWhen
  ) {
    databaseStateClassification = "BLOCKED_PREDECESSOR_NOT_LATEST";
  } else if (!phaseAbsent) {
    databaseStateClassification = phasePartial
      ? "BLOCKED_PARTIAL_SCHEMA"
      : "BLOCKED_SCHEMA_STATE_UNKNOWN";
  } else {
    databaseStateClassification = "READY_DATABASE_STATE";
  }
  if (databaseStateClassification !== "READY_DATABASE_STATE") {
    blocker = databaseStateClassification;
  }

  const exact90Unique =
    exact90.length === 1 &&
    timestamp90.length === 1 &&
    hash90.length === 1;
  return {
    databaseStateClassification,
    blocker,
    predecessorHashClassification:
      lf90ByHash.length
        ? "known_single_trailing_lf_variant"
        : exact90Unique
          ? "exact_committed_source_bytes"
          : "unexpected_or_absent",
    migration0090ExactAndLatest:
      exact90Unique &&
      latest[0]?.hash === c90.sha256 &&
      latest[0]?.createdAt === c90.journalWhen,
    migration0091JournalEntryAbsent:
      exact91.length === 0 && timestamp91.length === 0 && hash91.length === 0,
    phase2aPhysicalState: phaseAbsent
      ? "ABSENT"
      : exactPhaseBasics
        ? "FOUR_TABLE_FOOTPRINT_REQUIRES_POST_VERIFY"
        : "PARTIAL_OR_CASE_COLLISION",
  };
}

export function lintSqlManifest() {
  const errors = [];
  const allowedStarts = /^(?:SELECT|SHOW|SET SESSION|START TRANSACTION|ROLLBACK)\b/i;
  for (const [id, statement] of Object.entries(SQL_STATEMENTS)) {
    if (statement.method !== "query") errors.push(`${id}:METHOD_NOT_QUERY`);
    if (!allowedStarts.test(statement.sql)) errors.push(`${id}:START_REJECTED`);
    if (statement.sql.includes(";")) errors.push(`${id}:SEMICOLON_REJECTED`);
    const safeShowCreateCurrentUser =
      id === "SHOW_CREATE_USER" &&
      statement.sql === "SHOW CREATE USER CURRENT_USER()";
    if (
      !safeShowCreateCurrentUser &&
      /\b(?:INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|DROP|CREATE|ALTER|GRANT|REVOKE|CALL|HANDLER|LOAD DATA|GET_LOCK|SLEEP|BENCHMARK|INTO OUTFILE|INTO DUMPFILE|FOR UPDATE|FOR SHARE)\b/i.test(
        statement.sql,
      )
    ) {
      errors.push(`${id}:WRITE_OR_SIDE_EFFECT_TOKEN`);
    }
  }
  return {
    passed: errors.length === 0,
    errors,
    sha256: canonicalHash(SQL_STATEMENTS),
    statementCount: Object.keys(SQL_STATEMENTS).length,
  };
}

export function evaluateReadiness(facts, initialBlockers = []) {
  const databaseBlocker =
    facts.databaseStateClassification !== "READY_DATABASE_STATE"
      ? facts.databaseStateClassification || "BLOCKED_DATABASE_STATE_UNKNOWN"
      : null;
  const blockers = new Set(
    initialBlockers.filter((blocker) => blocker && blocker !== databaseBlocker),
  );
  const requirements = [
    ["sourceGatePassed", "BLOCKED_SOURCE_GATE"],
    ["runtimeProfilePassed", "BLOCKED_RUNTIME_PROFILE"],
    ["productionIdentityMatched", "BLOCKED_PRODUCTION_IDENTITY"],
    ["accountIdentityMatched", "BLOCKED_ACCOUNT_IDENTITY"],
    ["caPinned", "BLOCKED_CA_PIN"],
    ["peerCertificatePinned", "BLOCKED_PEER_CERTIFICATE_PIN"],
    ["tlsVerified", "BLOCKED_TLS"],
    ["grantProfileMatched", "BLOCKED_GRANT_PROFILE"],
    ["oneConnectionOnly", "BLOCKED_CONNECTION_COUNT"],
    ["readOnlySnapshotsEstablished", "BLOCKED_READ_ONLY"],
    ["oracleMySql84ExactProfileMatched", "BLOCKED_ENGINE"],
    ["rehearsedEngineVersionMatched", "BLOCKED_UNREHEARSED_ENGINE_PATCH"],
    ["capabilitiesPassed", "BLOCKED_CAPABILITIES"],
    ["journalSchemaExact", "BLOCKED_JOURNAL_SCHEMA"],
    ["predecessorFootprintExact", "BLOCKED_PREDECESSOR_FOOTPRINT"],
    ["snapshotsEqual", "BLOCKED_METADATA_CHANGED_DURING_PREFLIGHT"],
    ["connectionIdConsistent", "BLOCKED_CONNECTION_ID_CHANGED"],
    ["rollbacksSucceeded", "BLOCKED_ROLLBACK"],
    ["executorTranscriptExact", "BLOCKED_EXECUTOR_TRANSCRIPT"],
    ["zeroWriteConfirmed", "BLOCKED_ZERO_WRITE"],
    ["connectionClosedSuccessfully", "BLOCKED_CONNECTION_CLOSE"],
  ];
  for (const [key, blocker] of requirements) {
    if (facts[key] !== true) blockers.add(blocker);
  }
  const nonDatabaseGatesPassed = blockers.size === 0;
  if (databaseBlocker) blockers.add(databaseBlocker);
  const ordered = [...blockers].sort();
  const ready = ordered.length === 0;
  return {
    applyReadiness: ready
      ? "READY_FOR_SEPARATE_APPLY_AUTHORIZATION"
      : facts.databaseStateClassification ===
            "ALREADY_APPLIED_REQUIRES_EXACT_POST_VERIFY" &&
          nonDatabaseGatesPassed
        ? "ALREADY_APPLIED_REQUIRES_EXACT_POST_VERIFY"
        : "PREFLIGHT_BLOCKED",
    applyAuthorized: false,
    separateApplyAuthorizationRequired: true,
    migrationAppliedByThisPreflight: false,
    ready,
    blockers: ordered,
  };
}

function secretValues(secrets) {
  if (Array.isArray(secrets)) return secrets.filter(Boolean).map(String);
  return [
    ...(secrets?.highRisk ?? []),
    ...(secrets?.contextual ?? []),
  ]
    .filter(Boolean)
    .map(String);
}

export function sanitizeMessage(value, secrets = {}) {
  let text = String(value ?? "unknown error");
  for (const secret of secretValues(secrets)) {
    text = text.split(secret).join("[REDACTED]");
  }
  text = text
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, "[REDACTED_URL]")
    .replace(/access denied for user\s+[^\s]+/gi, "access denied for user [REDACTED]")
    .replace(/password\s*[=:]\s*[^\s,;]+/gi, "password=[REDACTED]");
  return text.slice(0, 512);
}

export function assertNoSecrets(value, secrets = {}) {
  const content = typeof value === "string" ? value : canonicalJson(value);
  for (const secret of secrets.highRisk ?? []) {
    if (!secret) continue;
    const text = String(secret);
    const escapedBody = JSON.stringify(text).slice(1, -1);
    if (content.includes(text) || content.includes(escapedBody)) {
      throw new Error("EVIDENCE_SECRET_SCAN_FAILED");
    }
  }
  for (const secret of secrets.contextual ?? []) {
    if (!secret) continue;
    const text = String(secret);
    if (content.includes(JSON.stringify(text))) {
      throw new Error("EVIDENCE_SECRET_SCAN_FAILED");
    }
  }
}

export function projectRootFromCore(coreUrl) {
  return resolve(new URL("..", coreUrl).pathname);
}
