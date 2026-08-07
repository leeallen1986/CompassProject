import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SNAPSHOT_STATEMENT_IDS,
  TIDB_PROFILE,
  TIDB_SQL,
  classifyTidbDatabaseState,
  expectedTidb0090Contract,
  hashBytes,
  parseProductionDatabaseUrl,
  sourceAttestation,
  validateTidb0090Footprint,
  validateTidbCapabilities,
  validateTidbJournalSchema,
} from "./issue86-phase2a-tidb-preflight-core.mjs";
import { lintTidbReadOnlySqlManifest } from "./issue86-phase2a-tidb-preflight-policy.mjs";
import {
  assertNoSecrets,
  canonicalHash,
  canonicalJson,
  sanitizeMessage,
} from "./issue86-phase2a-preflight-core.mjs";
import { classifyCheckConstraintCensus } from "./issue86-phase2a-tidb-preflight-v3-policy.mjs";

const SUPPORT_PATH = fileURLToPath(import.meta.url);
export const SCRIPT_DIR = dirname(SUPPORT_PATH);
export const SCRIPT_PATH = join(SCRIPT_DIR, "issue86-phase2a-production-tidb-preflight-v3.mjs");
export const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
export const TIDB_CORE_PATH = join(SCRIPT_DIR, "issue86-phase2a-tidb-preflight-core.mjs");
export const READ_POLICY_PATH = join(SCRIPT_DIR, "issue86-phase2a-tidb-preflight-policy.mjs");
export const V3_POLICY_PATH = join(SCRIPT_DIR, "issue86-phase2a-tidb-preflight-v3-policy.mjs");
export const CLI_EXIT_PATH = join(SCRIPT_DIR, "issue86-phase2a-tidb-cli-exit-contract.mjs");
export const ORIGINAL_CORE_PATH = join(SCRIPT_DIR, "issue86-phase2a-preflight-core.mjs");
export const URL_POLICY_PATH = join(SCRIPT_DIR, "issue86-phase2a-database-url-policy.mjs");
export const MYSQL2_PACKAGE_PATH = join(PROJECT_ROOT, "node_modules/mysql2/package.json");
export const NODE_VERSION = "v22.13.0";
export const MYSQL2_VERSION = "3.16.3";

export const FILES = Object.freeze({
  source: "issue86-phase2a-tidb-preflight-v3-source.json",
  engine: "issue86-phase2a-tidb-preflight-v3-engine.json",
  journal: "issue86-phase2a-tidb-preflight-v3-journal.json",
  schema: "issue86-phase2a-tidb-preflight-v3-schema.json",
  zeroWrite: "issue86-phase2a-tidb-preflight-v3-zero-write.json",
  final: "issue86-phase2a-tidb-preflight-v3-final.json",
  index: "issue86-phase2a-tidb-preflight-v3-sha256.json",
  complete: "issue86-phase2a-tidb-preflight-v3-COMPLETE.json",
});

const Q = (sql) => ({ kind: "READ", method: "query", sql });
const V3_SQL = Object.freeze({
  CHECK_CENSUS_COUNT: Q(
    "SELECT COUNT(*) AS rowCount FROM information_schema.TIDB_CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()",
  ),
  CHECK_CENSUS_ROWS: Q(
    "SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, CHECK_CLAUSE AS checkClause, CAST(TABLE_ID AS CHAR) AS tableId FROM information_schema.TIDB_CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY BINARY TABLE_NAME, CONSTRAINT_NAME LIMIT 1001",
  ),
});
export const ALL_SQL = Object.freeze({ ...TIDB_SQL, ...V3_SQL });
export const V3_SNAPSHOT_STATEMENT_IDS = Object.freeze([
  "CHECK_CENSUS_COUNT",
  "CHECK_CENSUS_ROWS",
  ...SNAPSHOT_STATEMENT_IDS,
]);
const now = () => new Date().toISOString();

export function requireSha(env, name) {
  const value = env[name];
  if (!/^[0-9a-f]{64}$/.test(value ?? "")) {
    throw new Error(`${name}_MISSING_OR_INVALID`);
  }
  return value;
}

export function optionalSha(env, name) {
  const value = env[name];
  if (value === undefined || value === "") return null;
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${name}_INVALID`);
  return value;
}

export function requireCount(env, name) {
  const value = String(env[name] ?? "");
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name}_MISSING_OR_INVALID`);
  return Number(value);
}

export function optionalCount(env, name) {
  const value = env[name];
  if (value === undefined || value === "") return null;
  if (!/^(?:0|[1-9][0-9]*)$/.test(String(value))) throw new Error(`${name}_INVALID`);
  return Number(value);
}

export function parseArgs(argv) {
  if (
    argv.length !== 2 ||
    argv[0] !== "--output-dir" ||
    !argv[1] ||
    argv[1].startsWith("-")
  ) {
    throw new Error("CLI_USAGE");
  }
  return resolve(argv[1]);
}

export function reserveOutput(path) {
  const rel = relative(PROJECT_ROOT, path);
  if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`))) {
    throw new Error("OUTPUT_INSIDE_REPOSITORY_REJECTED");
  }
  try {
    lstatSync(path);
    throw new Error("OUTPUT_EXISTS");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const parent = dirname(path);
  const parentStat = lstatSync(parent);
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    (parentStat.mode & 0o022) !== 0 ||
    realpathSync(parent) !== parent ||
    (typeof process.getuid === "function" && parentStat.uid !== process.getuid())
  ) {
    throw new Error("OUTPUT_PARENT_REJECTED");
  }
  mkdirSync(path, { mode: 0o700 });
  const stat = statSync(path);
  if ((stat.mode & 0o077) !== 0) throw new Error("OUTPUT_MODE_REJECTED");
}

export function writeJson(outputDir, filename, value) {
  const bytes = Buffer.from(canonicalJson(value), "utf8");
  const temp = join(outputDir, `.${filename}.tmp-${process.pid}`);
  const final = join(outputDir, filename);
  const fd = openSync(
    temp,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, final);
  return { byteSize: bytes.length, sha256: hashBytes(bytes) };
}

export function flushDirectory(path) {
  const fd = openSync(path, fsConstants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function writePack(outputDir, evidence, secrets) {
  for (const value of Object.values(evidence)) assertNoSecrets(value, secrets);
  const index = {};
  for (const key of ["source", "engine", "journal", "schema", "zeroWrite", "final"]) {
    const filename = FILES[key];
    index[filename] = writeJson(outputDir, filename, evidence[key]);
  }
  const indexMeta = writeJson(outputDir, FILES.index, index);
  flushDirectory(outputDir);
  writeJson(outputDir, FILES.complete, {
    status: "COMPLETE",
    evidenceFileCount: 6,
    indexFilename: FILES.index,
    indexByteSize: indexMeta.byteSize,
    indexSha256: indexMeta.sha256,
  });
  flushDirectory(outputDir);
}

export function exactKeys(row, keys, label) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`${label}_ROW_INVALID`);
  }
  if (canonicalJson(Object.keys(row).sort()) !== canonicalJson([...keys].sort())) {
    throw new Error(`${label}_SHAPE_INVALID`);
  }
}

export function lintExtraSql() {
  const errors = [];
  for (const [id, statement] of Object.entries(V3_SQL)) {
    const sql = statement.sql.trim();
    if (statement.kind !== "READ" || statement.method !== "query") {
      errors.push(`${id}_BOUNDARY_INVALID`);
    }
    if (!/^(?:SELECT|SHOW)\b/i.test(sql)) errors.push(`${id}_NOT_READ_ONLY`);
    if (sql.includes(";")) errors.push(`${id}_SEMICOLON_REJECTED`);
    if (
      /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|SET|CALL|DO|LOAD|LOCK|UNLOCK|ADMIN)\b/i.test(
        sql,
      )
    ) {
      errors.push(`${id}_MUTATION_TOKEN_REJECTED`);
    }
  }
  return {
    passed: errors.length === 0,
    errors,
    sha256: canonicalHash(ALL_SQL),
  };
}

export class Executor {
  constructor(connection) {
    this.connection = connection;
    this.transcript = [];
  }

  async run(id) {
    const statement = ALL_SQL[id];
    if (!statement) throw new Error(`UNKNOWN_STATEMENT:${id}`);
    const [rows] = await this.connection.query(statement.sql);
    if (!Array.isArray(rows)) throw new Error(`RESULT_INVALID:${id}`);
    this.transcript.push({
      sequence: this.transcript.length + 1,
      statementId: id,
      method: statement.method,
      kind: statement.kind,
      sqlSha256: hashBytes(Buffer.from(statement.sql, "utf8")),
      rowCount: rows.length,
    });
    return rows;
  }

  ids() {
    return this.transcript.map((row) => row.statementId);
  }
}

export async function getConnectionId(executor) {
  const rows = await executor.run("CONNECTION_ID");
  if (rows.length !== 1) throw new Error("CONNECTION_ID_COUNT");
  exactKeys(rows[0], ["connectionId"], "CONNECTION_ID");
  const id = String(rows[0].connectionId ?? "");
  if (!/^[1-9][0-9]*$/.test(id)) throw new Error("CONNECTION_ID_INVALID");
  return id;
}

export function inspectTls(connection) {
  const stream = connection?.connection?.stream;
  const cert = stream?.getPeerCertificate?.();
  const fingerprint = String(cert?.fingerprint256 ?? "")
    .replaceAll(":", "")
    .toLowerCase();
  return {
    encrypted: stream?.encrypted === true,
    authorized: stream?.authorized === true,
    authorizationErrorPresent: Boolean(stream?.authorizationError),
    protocol: stream?.getProtocol?.() ?? null,
    cipher: stream?.getCipher?.()?.name ?? null,
    peerCertificateSha256: /^[0-9a-f]{64}$/.test(fingerprint)
      ? fingerprint
      : null,
  };
}

export function tlsStatus(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row.Variable_name ?? row.variableName ?? "");
    if (!["Ssl_cipher", "Ssl_version"].includes(key) || map.has(key)) {
      throw new Error("TLS_STATUS_INVALID");
    }
    map.set(key, String(row.Value ?? row.value ?? ""));
  }
  if (map.size !== 2) throw new Error("TLS_STATUS_INCOMPLETE");
  return Object.fromEntries(map);
}

export function validateTls(connection, rows, expectedPeer) {
  const transport = inspectTls(connection);
  const session = tlsStatus(rows);
  const verified =
    transport.encrypted === true &&
    transport.authorized === true &&
    transport.authorizationErrorPresent === false &&
    ["TLSv1.2", "TLSv1.3"].includes(transport.protocol) &&
    Boolean(transport.cipher) &&
    transport.peerCertificateSha256 === expectedPeer &&
    session.Ssl_version === transport.protocol &&
    session.Ssl_cipher === transport.cipher;
  return {
    verified,
    peerCertificatePinned: transport.peerCertificateSha256 === expectedPeer,
    expectedPeerCertificateSha256: expectedPeer,
    transport,
    session,
  };
}

export async function capture(executor, expected0090) {
  const checkCensus = classifyCheckConstraintCensus({
    countRows: await executor.run("CHECK_CENSUS_COUNT"),
    detailRows: await executor.run("CHECK_CENSUS_ROWS"),
  });
  const journalBase = {
    tables: await executor.run("JOURNAL_TABLES"),
    columns: await executor.run("JOURNAL_COLUMNS"),
    indexes: await executor.run("JOURNAL_INDEXES"),
    constraints: await executor.run("JOURNAL_CONSTRAINTS"),
    triggers: await executor.run("JOURNAL_TRIGGERS"),
  };
  const journalValidation = validateTidbJournalSchema(journalBase);
  const count = await executor.run("JOURNAL_RELEVANT_COUNT");
  if (count.length !== 1) throw new Error("JOURNAL_COUNT_INVALID");
  exactKeys(count[0], ["rowCount"], "JOURNAL_COUNT");
  const predecessorRows = {
    tables: await executor.run("PREDECESSOR_TABLES"),
    columns: await executor.run("PREDECESSOR_COLUMNS"),
    indexes: await executor.run("PREDECESSOR_INDEXES"),
    constraints: await executor.run("PREDECESSOR_CONSTRAINTS"),
    keys: await executor.run("PREDECESSOR_KEYS"),
    referential: await executor.run("PREDECESSOR_REFERENTIAL"),
    checks: await executor.run("PREDECESSOR_CHECKS"),
  };
  const predecessor = validateTidb0090Footprint(predecessorRows, expected0090);
  return {
    checkCensus,
    journal: {
      ...journalBase,
      schemaExact: journalValidation.exact,
      schemaExpectedHash: journalValidation.expectedHash,
      schemaObservedHash: journalValidation.observedHash,
      relevantCount: String(count[0].rowCount),
      relevantRows: await executor.run("JOURNAL_RELEVANT"),
      latestRows: await executor.run("JOURNAL_LATEST"),
    },
    predecessor: {
      exact: predecessor.exact,
      expectedHash: predecessor.expectedHash,
      observedHash: predecessor.observedHash,
    },
    phase2a: {
      tables: await executor.run("PHASE2A_TABLES"),
      residue: await executor.run("PHASE2A_RESIDUE"),
    },
  };
}

export function expectedTranscript() {
  return [
    "CONNECTION_ID",
    "TLS_STATUS",
    "ENGINE_IDENTITY",
    "CURRENT_ROLE",
    "SHOW_GRANTS",
    "SHOW_CREATE_USER",
    "GLOBAL_VARIABLES",
    "SESSION_VARIABLES",
    "TABLE_CONSTRAINTS_METADATA",
    "CHECK_CONSTRAINTS_METADATA",
    "TIDB_CHECK_CONSTRAINTS_METADATA",
    ...V3_SNAPSHOT_STATEMENT_IDS,
    "CONNECTION_ID",
    ...V3_SNAPSHOT_STATEMENT_IDS,
    "CONNECTION_ID",
  ];
}

export function runtime() {
  const pkg = JSON.parse(readFileSync(MYSQL2_PACKAGE_PATH, "utf8"));
  return {
    passed: process.version === NODE_VERSION && pkg.version === MYSQL2_VERSION,
    nodeVersion: process.version,
    mysql2Version: pkg.version,
    expectedNodeVersion: NODE_VERSION,
    expectedMysql2Version: MYSQL2_VERSION,
  };
}

export function pins(env) {
  return {
    tool: requireSha(env, "ISSUE86_TIDB_V3_EXPECTED_TOOL_SHA256"),
    tidbCore: requireSha(env, "ISSUE86_TIDB_V3_EXPECTED_TIDB_CORE_SHA256"),
    readPolicy: requireSha(env, "ISSUE86_TIDB_V3_EXPECTED_READ_POLICY_SHA256"),
    v3Policy: requireSha(env, "ISSUE86_TIDB_V3_EXPECTED_V3_POLICY_SHA256"),
    cliExit: requireSha(env, "ISSUE86_TIDB_V3_EXPECTED_CLI_EXIT_SHA256"),
    originalCore: requireSha(env, "ISSUE86_TIDB_V3_EXPECTED_ORIGINAL_CORE_SHA256"),
    urlPolicy: requireSha(env, "ISSUE86_TIDB_V3_EXPECTED_URL_POLICY_SHA256"),
    peer: requireSha(env, "ISSUE86_TIDB_V3_EXPECTED_PEER_CERT_SHA256"),
    identity: requireSha(env, "ISSUE86_TIDB_V3_EXPECTED_DB_IDENTITY_SHA256"),
    account: requireSha(env, "ISSUE86_TIDB_V3_EXPECTED_DB_ACCOUNT_SHA256"),
    role: requireSha(env, "ISSUE86_TIDB_V3_EXPECTED_ROLE_SHA256"),
    grants: requireSha(env, "ISSUE86_TIDB_V3_EXPECTED_GRANTS_SHA256"),
    grantRows: requireCount(env, "ISSUE86_TIDB_V3_EXPECTED_GRANT_ROW_COUNT"),
    censusSha256: optionalSha(env, "ISSUE86_TIDB_V3_EXPECTED_CHECK_CENSUS_SHA256"),
    censusCount: optionalCount(env, "ISSUE86_TIDB_V3_EXPECTED_CHECK_CENSUS_COUNT"),
  };
}

export {
  TIDB_PROFILE,
  classifyTidbDatabaseState,
  parseProductionDatabaseUrl,
  sourceAttestation,
  assertNoSecrets,
  canonicalHash,
  sanitizeMessage,
};
