#!/usr/bin/env node
import { createConnection } from "mysql2/promise";
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SQL_STATEMENTS,
  SOURCE_CONTRACT,
  assertNoSecrets,
  buildExpected0090Contract,
  canonicalHash,
  canonicalJson,
  classifyEngine,
  classifyJournalAndPhase2a,
  compareMutationCounters,
  evaluateReadiness,
  lintSqlManifest,
  parseDatabaseUrl,
  parseMutationCounters,
  parseStatusRows,
  sanitizeMessage,
  sha256,
  validate0090Footprint,
  validateJournalSchema,
  verifySourceBundle,
} from "./issue86-phase2a-preflight-core.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const CORE_PATH = resolve(SCRIPT_DIR, "issue86-phase2a-preflight-core.mjs");
const MYSQL2_PACKAGE_PATH = resolve(PROJECT_ROOT, "node_modules/mysql2/package.json");
const EXPECTED_MYSQL2_VERSION = "3.16.3";
const EXPECTED_TLS_VERSIONS = new Set(["TLSv1.2", "TLSv1.3"]);
const COMPLETION_FILENAME = "issue86-phase2a-preflight-COMPLETE.json";
const EVIDENCE_FILENAMES = [
  "issue86-phase2a-preflight-source-attestation.json",
  "issue86-phase2a-preflight-engine-capability.json",
  "issue86-phase2a-preflight-migration-journal.json",
  "issue86-phase2a-preflight-schema-footprint.json",
  "issue86-phase2a-preflight-zero-write.json",
  "issue86-phase2a-preflight-final.json",
];

function utcNow() {
  return new Date().toISOString();
}

function exactObjectColumns(row, expected, label) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`${label}_ROW_INVALID`);
  }
  const actual = Object.keys(row).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    throw new Error(`${label}_COLUMN_SHAPE_MISMATCH`);
  }
}

function rowsFromResult(result, statementId) {
  const rows = result?.[0];
  if (Array.isArray(rows)) return rows;
  if (
    rows &&
    typeof rows === "object" &&
    SQL_STATEMENTS[statementId].kind === "CONTROL"
  ) {
    return [];
  }
  throw new Error(`STATEMENT_RESULT_INVALID:${statementId}`);
}

class LockedExecutor {
  constructor(connection) {
    this.connection = connection;
    this.transcript = [];
    this.callCounts = new Map();
  }

  async run(statementId) {
    const statement = SQL_STATEMENTS[statementId];
    if (!statement) throw new Error(`UNKNOWN_STATEMENT_ID:${statementId}`);
    const callCount = (this.callCounts.get(statementId) ?? 0) + 1;
    this.callCounts.set(statementId, callCount);
    const result = await this.connection.query(statement.sql);
    const rows = rowsFromResult(result, statementId);
    this.transcript.push({
      sequence: this.transcript.length + 1,
      statementId,
      method: "query",
      kind: statement.kind,
      sqlSha256: sha256(Buffer.from(statement.sql, "utf8")),
      rowCount: rows.length,
      callCount,
    });
    return rows;
  }

  ids() {
    return this.transcript.map((entry) => entry.statementId);
  }
}

function parseCli(argv) {
  if (
    argv.length !== 2 ||
    argv[0] !== "--output-dir" ||
    !argv[1] ||
    argv[1].startsWith("-")
  ) {
    throw new Error(
      "CLI_USAGE: expected exactly --output-dir <new-directory>",
    );
  }
  return { outputDir: resolve(argv[1]) };
}

function validateOutputLocation(outputDir) {
  try {
    lstatSync(outputDir);
    throw new Error("OUTPUT_PATH_ALREADY_EXISTS");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const parent = dirname(outputDir);
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error("OUTPUT_PARENT_NOT_SECURE_DIRECTORY");
  }
  if (realpathSync(parent) !== parent) {
    throw new Error("OUTPUT_PARENT_NOT_CANONICAL");
  }
}

function reserveOutputDirectory(outputDir) {
  mkdirSync(outputDir, { mode: 0o700 });
  const stat = lstatSync(outputDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("OUTPUT_DIRECTORY_RESERVATION_FAILED");
  }
}

function readTlsCa(path) {
  if (!path) throw new Error("PREFLIGHT_CA_FILE_MISSING");
  const absolute = resolve(path);
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const fd = openSync(absolute, fsConstants.O_RDONLY | noFollow);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > 1048576) {
      throw new Error("PREFLIGHT_CA_FILE_INVALID");
    }
    const pem = readFileSync(fd, "utf8");
    if (
      !pem.includes("-----BEGIN CERTIFICATE-----") ||
      !pem.includes("-----END CERTIFICATE-----")
    ) {
      throw new Error("PREFLIGHT_CA_FILE_NOT_CERTIFICATE");
    }
    return { pem, sha256: sha256(Buffer.from(pem, "utf8")) };
  } finally {
    closeSync(fd);
  }
}

function requireSha256(env, name) {
  const value = env[name];
  if (!/^[0-9a-f]{64}$/.test(value ?? "")) {
    throw new Error(`${name}_MISSING_OR_INVALID`);
  }
  return value;
}

function runtimeProfile(env) {
  const pkg = JSON.parse(readFileSync(MYSQL2_PACKAGE_PATH, "utf8"));
  const expectedNode = env.ISSUE86_PREFLIGHT_EXPECTED_NODE_VERSION;
  const nodeExact =
    typeof expectedNode === "string" &&
    /^v22\.[0-9]+\.[0-9]+$/.test(expectedNode) &&
    process.version === expectedNode;
  const mysql2Exact = pkg.version === EXPECTED_MYSQL2_VERSION;
  return {
    passed: nodeExact && mysql2Exact,
    nodeVersion: process.version,
    expectedNodeVersion: expectedNode ?? null,
    mysql2Version: pkg.version,
    expectedMysql2Version: EXPECTED_MYSQL2_VERSION,
  };
}

function inspectTlsSocket(connection) {
  const stream = connection?.connection?.stream;
  const cipher = stream?.getCipher?.();
  const certificate = stream?.getPeerCertificate?.();
  const protocol = stream?.getProtocol?.();
  const peerFingerprintSha256 = String(
    certificate?.fingerprint256 ?? "",
  )
    .replaceAll(":", "")
    .toLowerCase();
  return {
    encrypted: stream?.encrypted === true,
    authorized: stream?.authorized === true,
    authorizationError: stream?.authorizationError ? true : false,
    protocol: protocol ?? null,
    cipher: cipher?.name ?? null,
    peerFingerprintSha256:
      /^[0-9a-f]{64}$/.test(peerFingerprintSha256)
        ? peerFingerprintSha256
        : null,
  };
}

function validateTls(socketEvidence, statusRows, expectedPeerFingerprintSha256) {
  const status = parseStatusRows(statusRows, ["Ssl_cipher", "Ssl_version"]);
  const sessionCipher = status.get("Ssl_cipher");
  const sessionVersion = status.get("Ssl_version");
  const verified =
    socketEvidence.encrypted === true &&
    socketEvidence.authorized === true &&
    socketEvidence.authorizationError === false &&
    EXPECTED_TLS_VERSIONS.has(socketEvidence.protocol) &&
    socketEvidence.protocol === sessionVersion &&
    Boolean(socketEvidence.cipher) &&
    socketEvidence.cipher === sessionCipher &&
    socketEvidence.peerFingerprintSha256 === expectedPeerFingerprintSha256;
  return {
    verified,
    peerCertificatePinned:
      socketEvidence.peerFingerprintSha256 === expectedPeerFingerprintSha256,
    expectedPeerFingerprintSha256,
    socket: socketEvidence,
    session: {
      protocol: sessionVersion || null,
      cipher: sessionCipher || null,
    },
  };
}

function validateGrantProfile(rows, currentRole, databaseName) {
  const grants = rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("GRANT_ROW_INVALID");
    }
    const values = Object.values(row);
    if (values.length !== 1 || typeof values[0] !== "string") {
      throw new Error("GRANT_ROW_SHAPE_INVALID");
    }
    return values[0];
  });
  const escapedDb = databaseName.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  const usage = /^GRANT USAGE ON \*\.\* TO /i;
  const select = new RegExp(
    `^GRANT SELECT ON \\\`${escapedDb}\\\`\\.\\* TO `,
    "i",
  );
  const forbidden =
    /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|INDEX|TRIGGER|EVENT|EXECUTE|FILE|PROCESS|SUPER|RELOAD|SHUTDOWN|REPLICATION|GRANT OPTION|SYSTEM_USER|CONNECTION_ADMIN)\b/i;
  const everyAllowed =
    grants.length >= 2 &&
    grants.every(
      (grant) =>
        !forbidden.test(grant) && (usage.test(grant) || select.test(grant)),
    );
  const hasSelect = grants.some((grant) => select.test(grant));
  return {
    matched:
      currentRole === "NONE" &&
      everyAllowed &&
      hasSelect,
    currentRoleNone: currentRole === "NONE",
    grantCount: grants.length,
    grantTextSha256: canonicalHash([...grants].sort()),
  };
}

function validateCapabilities(capRow, tableConstraintRows, checkConstraintRows, regexpRow) {
  exactObjectColumns(
    regexpRow,
    ["lowercaseAccepted", "uppercaseAccepted", "shortAccepted"],
    "REGEXP_CAPABILITY",
  );
  const tcColumns = tableConstraintRows.map((row) => row.columnName);
  const ccColumns = checkConstraintRows.map((row) => row.columnName);
  const exactRegexp =
    String(regexpRow.lowercaseAccepted) === "1" &&
    String(regexpRow.uppercaseAccepted) === "0" &&
    String(regexpRow.shortAccepted) === "0";
  const passed =
    /^8\.4\.[0-9]+$/.test(String(capRow.versionVariable)) &&
    capRow.defaultStorageEngine === "InnoDB" &&
    String(capRow.lowerCaseTableNames) === "0" &&
    String(capRow.sessionForeignKeyChecks) === "1" &&
    String(capRow.globalForeignKeyChecks) === "1" &&
    /STRICT_(?:ALL|TRANS)_TABLES/.test(String(capRow.sessionSqlMode)) &&
    tcColumns.includes("ENFORCED") &&
    [
      "CONSTRAINT_CATALOG",
      "CONSTRAINT_SCHEMA",
      "CONSTRAINT_NAME",
      "CHECK_CLAUSE",
    ].every((name) => ccColumns.includes(name)) &&
    exactRegexp;
  return {
    passed,
    versionVariable: String(capRow.versionVariable),
    versionComment: String(capRow.versionComment),
    versionCompileOs: String(capRow.versionCompileOs),
    versionCompileMachine: String(capRow.versionCompileMachine),
    serverLicense: String(capRow.serverLicense),
    lowerCaseTableNames: String(capRow.lowerCaseTableNames),
    defaultStorageEngine: capRow.defaultStorageEngine,
    sessionForeignKeyChecks: String(capRow.sessionForeignKeyChecks),
    globalForeignKeyChecks: String(capRow.globalForeignKeyChecks),
    sessionSqlMode: String(capRow.sessionSqlMode),
    serverCharacterSet: String(capRow.serverCharacterSet),
    serverCollation: String(capRow.serverCollation),
    tableConstraintsEnforcedColumnPresent: tcColumns.includes("ENFORCED"),
    checkConstraintsColumns: ccColumns,
    regexpProbe: {
      lowercaseAccepted: String(regexpRow.lowercaseAccepted),
      uppercaseAccepted: String(regexpRow.uppercaseAccepted),
      shortAccepted: String(regexpRow.shortAccepted),
    },
  };
}

async function readConnectionId(executor) {
  const rows = await executor.run("CONNECTION_ID");
  if (rows.length !== 1) throw new Error("CONNECTION_ID_ROW_COUNT");
  exactObjectColumns(rows[0], ["connectionId"], "CONNECTION_ID");
  const id = String(rows[0].connectionId ?? "");
  if (!/^[1-9][0-9]*$/.test(id)) throw new Error("CONNECTION_ID_INVALID");
  return id;
}

async function captureMetadata(executor) {
  const journalTables = await executor.run("JOURNAL_TABLES");
  const journalColumns = await executor.run("JOURNAL_COLUMNS");
  const journalIndexes = await executor.run("JOURNAL_INDEXES");
  const journalConstraints = await executor.run("JOURNAL_CONSTRAINTS");
  const journalTriggers = await executor.run("JOURNAL_TRIGGERS");
  const journalSchema = validateJournalSchema({
    tables: journalTables,
    columns: journalColumns,
    indexes: journalIndexes,
    constraints: journalConstraints,
    triggers: journalTriggers,
  });
  if (!journalSchema.exact) throw new Error("JOURNAL_SCHEMA_NOT_EXACT");

  const countRows = await executor.run("JOURNAL_RELEVANT_COUNT");
  if (countRows.length !== 1) throw new Error("JOURNAL_COUNT_ROW_COUNT");
  exactObjectColumns(countRows[0], ["rowCount"], "JOURNAL_COUNT");
  const relevantRows = await executor.run("JOURNAL_RELEVANT");
  const latestRows = await executor.run("JOURNAL_LATEST");

  const predecessor = {
    tables: await executor.run("PREDECESSOR_TABLES"),
    columns: await executor.run("PREDECESSOR_COLUMNS"),
    indexes: await executor.run("PREDECESSOR_INDEXES"),
    constraints: await executor.run("PREDECESSOR_CONSTRAINTS"),
    keys: await executor.run("PREDECESSOR_KEYS"),
    referential: await executor.run("PREDECESSOR_REFERENTIAL"),
    checks: await executor.run("PREDECESSOR_CHECKS"),
  };
  const phase2aTables = await executor.run("PHASE2A_TABLES");
  const phase2aResidue = await executor.run("PHASE2A_RESIDUE");

  return {
    journal: {
      tables: journalTables,
      columns: journalColumns,
      indexes: journalIndexes,
      constraints: journalConstraints,
      triggers: journalTriggers,
      schemaExact: journalSchema.exact,
      relevantCount: String(countRows[0].rowCount),
      relevantRows,
      latestRows,
    },
    predecessor,
    phase2a: {
      tables: phase2aTables,
      residue: phase2aResidue,
    },
  };
}

async function confirmSnapshot(executor) {
  const warnings = await executor.run("SHOW_WARNINGS");
  if (warnings.length !== 0) throw new Error("START_SNAPSHOT_WARNINGS");
  const rows = await executor.run("CONFIRM_SESSION");
  if (rows.length !== 1) throw new Error("CONFIRM_SESSION_ROW_COUNT");
  exactObjectColumns(
    rows[0],
    ["transactionReadOnly", "transactionIsolation", "connectionId"],
    "CONFIRM_SESSION",
  );
  if (
    String(rows[0].transactionReadOnly) !== "1" ||
    String(rows[0].transactionIsolation) !== "REPEATABLE-READ"
  ) {
    throw new Error("READ_ONLY_SNAPSHOT_NOT_CONFIRMED");
  }
  return String(rows[0].connectionId);
}

function readySequence() {
  const snapshotIds = [
    "JOURNAL_TABLES",
    "JOURNAL_COLUMNS",
    "JOURNAL_INDEXES",
    "JOURNAL_CONSTRAINTS",
    "JOURNAL_TRIGGERS",
    "JOURNAL_RELEVANT_COUNT",
    "JOURNAL_RELEVANT",
    "JOURNAL_LATEST",
    "PREDECESSOR_TABLES",
    "PREDECESSOR_COLUMNS",
    "PREDECESSOR_INDEXES",
    "PREDECESSOR_CONSTRAINTS",
    "PREDECESSOR_KEYS",
    "PREDECESSOR_REFERENTIAL",
    "PREDECESSOR_CHECKS",
    "PHASE2A_TABLES",
    "PHASE2A_RESIDUE",
  ];
  return [
    "COUNTERS",
    "CONNECTION_ID",
    "TLS_STATUS",
    "ENGINE_IDENTITY",
    "CURRENT_ROLE",
    "SHOW_GRANTS",
    "SET_ISOLATION",
    "SET_READ_ONLY",
    "START_SNAPSHOT",
    "SHOW_WARNINGS",
    "CONFIRM_SESSION",
    "ORACLE_CAPABILITIES",
    "TABLE_CONSTRAINTS_METADATA",
    "CHECK_CONSTRAINTS_METADATA",
    "REGEXP_CAPABILITY",
    ...snapshotIds,
    "ROLLBACK",
    "CONNECTION_ID",
    "START_SNAPSHOT",
    "SHOW_WARNINGS",
    "CONFIRM_SESSION",
    ...snapshotIds,
    "ROLLBACK",
    "COUNTERS",
    "CONNECTION_ID",
  ];
}

function stableRowsHash(snapshot) {
  return canonicalHash(snapshot);
}

function writeAtomicJson(outputDir, filename, value) {
  const finalPath = join(outputDir, filename);
  const tempPath = join(outputDir, `.${filename}.tmp-${process.pid}`);
  const bytes = Buffer.from(canonicalJson(value), "utf8");
  const fd = openSync(
    tempPath,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, finalPath);
  return {
    filename,
    byteSize: bytes.length,
    sha256: sha256(bytes),
  };
}

function writeEvidencePack(outputDir, evidence, secrets) {
  for (const value of Object.values(evidence)) assertNoSecrets(value, secrets);
  const mapping = [
    [EVIDENCE_FILENAMES[0], evidence.source],
    [EVIDENCE_FILENAMES[1], evidence.engine],
    [EVIDENCE_FILENAMES[2], evidence.journal],
    [EVIDENCE_FILENAMES[3], evidence.schema],
    [EVIDENCE_FILENAMES[4], evidence.zeroWrite],
    [EVIDENCE_FILENAMES[5], evidence.final],
  ];
  const index = {};
  for (const [filename, value] of mapping) {
    const meta = writeAtomicJson(outputDir, filename, value);
    index[filename] = {
      byteSize: meta.byteSize,
      sha256: meta.sha256,
    };
  }
  writeAtomicJson(
    outputDir,
    "issue86-phase2a-preflight-sha256.json",
    index,
  );
}

function addBlocker(blockers, code) {
  if (code) blockers.add(code);
}

export async function runPreflight({
  outputDir,
  connectionFactory = createConnection,
  env = process.env,
}) {
  const blockers = new Set();
  let outputReserved = false;
  let connection = null;
  let executor = null;
  let connectionAttempts = 0;
  let connectionsEstablished = 0;
  let connectionClosedSuccessfully = false;
  let connectionOpenedAt = null;
  let connectionClosedAt = null;
  let countersBefore = null;
  let countersAfter = null;
  let counterComparison = null;
  let snapshotA = null;
  let snapshotB = null;
  let rollbackAAttempted = false;
  let rollbackASucceeded = false;
  let rollbackBAttempted = false;
  let rollbackBSucceeded = false;
  let transactionOpen = false;
  const connectionIds = [];
  let secrets = { highRisk: [], contextual: [] };
  const startedAt = utcNow();

  const manifest = lintSqlManifest();
  if (!manifest.passed) {
    throw new Error(`SQL_MANIFEST_INVALID:${manifest.errors.join(",")}`);
  }

  const sourceResult = verifySourceBundle({
    projectRoot: PROJECT_ROOT,
    toolPath: SCRIPT_PATH,
    corePath: CORE_PATH,
    expectedToolSha256: env.ISSUE86_PREFLIGHT_EXPECTED_TOOL_SHA256,
    expectedCoreSha256: env.ISSUE86_PREFLIGHT_EXPECTED_CORE_SHA256,
  });
  if (!sourceResult.passed) {
    throw new Error(`SOURCE_GATE_FAILED:${sourceResult.errors.join(",")}`);
  }
  const { snapshot0090, ...sourceEvidence } = sourceResult;
  const expected0090 = buildExpected0090Contract(snapshot0090);
  const runtime = runtimeProfile(env);
  if (!runtime.passed) {
    throw new Error("RUNTIME_PROFILE_MISMATCH");
  }

  const parsed = parseDatabaseUrl(env.DATABASE_URL);
  const tlsCa = readTlsCa(env.ISSUE86_PREFLIGHT_CA_FILE);
  parsed.config.ssl.ca = tlsCa.pem;
  parsed.config.connectTimeout = 10000;
  secrets = [...parsed.secrets, tlsCa.pem];

  const expectedIdentity = env.ISSUE86_PREFLIGHT_EXPECTED_DB_IDENTITY_SHA256;
  if (!/^[0-9a-f]{64}$/.test(expectedIdentity ?? "")) {
    throw new Error("EXPECTED_PRODUCTION_IDENTITY_MISSING_OR_INVALID");
  }

  validateOutputLocation(outputDir);
  reserveOutputDirectory(outputDir);
  outputReserved = true;

  let engineEvidence = {
    observed: false,
    runtime,
    tlsCaSha256: tlsCa.sha256,
    queryManifestSha256: manifest.sha256,
    expected0090ManifestSha256: canonicalHash(expected0090),
  };
  let journalEvidence = null;
  let schemaEvidence = null;
  let databaseState = {
    databaseStateClassification: "BLOCKED_DATABASE_STATE_UNKNOWN",
    blocker: "BLOCKED_DATABASE_STATE_UNKNOWN",
  };
  let facts = {
    sourceGatePassed: true,
    runtimeProfilePassed: runtime.passed,
    productionIdentityMatched: false,
    tlsVerified: false,
    grantProfileMatched: false,
    oneConnectionOnly: false,
    readOnlySnapshotsEstablished: false,
    oracleMySql84ExactProfileMatched: false,
    capabilitiesPassed: false,
    journalSchemaExact: false,
    predecessorFootprintExact: false,
    snapshotsEqual: false,
    connectionIdConsistent: false,
    rollbacksSucceeded: false,
    executorTranscriptExact: false,
    zeroWriteConfirmed: false,
    connectionClosedSuccessfully: false,
    databaseStateClassification: databaseState.databaseStateClassification,
  };

  try {
    connectionAttempts += 1;
    connection = await connectionFactory(parsed.config);
    connectionsEstablished += 1;
    connectionOpenedAt = utcNow();
    executor = new LockedExecutor(connection);

    countersBefore = parseMutationCounters(await executor.run("COUNTERS"));
    connectionIds.push(await readConnectionId(executor));

    const tlsSocket = inspectTlsSocket(connection);
    const tls = validateTls(tlsSocket, await executor.run("TLS_STATUS"));
    facts.tlsVerified = tls.verified;
    if (!tls.verified) throw new Error("TLS_NOT_VERIFIED");

    const identityRows = await executor.run("ENGINE_IDENTITY");
    if (identityRows.length !== 1) throw new Error("ENGINE_IDENTITY_ROW_COUNT");
    exactObjectColumns(
      identityRows[0],
      [
        "versionString",
        "versionComment",
        "connectionId",
        "targetIdentitySha256",
      ],
      "ENGINE_IDENTITY",
    );
    const engine = classifyEngine(
      identityRows[0].versionString,
      identityRows[0].versionComment,
    );
    facts.oracleMySql84ExactProfileMatched =
      engine.oracleMySql84ExactProfileMatched;
    facts.productionIdentityMatched =
      String(identityRows[0].targetIdentitySha256) === expectedIdentity;
    connectionIds.push(String(identityRows[0].connectionId));
    engineEvidence = {
      ...engineEvidence,
      observed: true,
      tls,
      targetIdentitySha256: String(identityRows[0].targetIdentitySha256),
      productionIdentityMatched: facts.productionIdentityMatched,
      engine,
    };
    if (!facts.productionIdentityMatched) {
      throw new Error("PRODUCTION_IDENTITY_MISMATCH");
    }
    if (!facts.oracleMySql84ExactProfileMatched) {
      throw new Error("ENGINE_UNSUPPORTED_OR_UNCERTAIN");
    }

    const roleRows = await executor.run("CURRENT_ROLE");
    if (roleRows.length !== 1) throw new Error("CURRENT_ROLE_ROW_COUNT");
    exactObjectColumns(roleRows[0], ["currentRole"], "CURRENT_ROLE");
    const grants = validateGrantProfile(
      await executor.run("SHOW_GRANTS"),
      String(roleRows[0].currentRole),
      parsed.config.database,
    );
    facts.grantProfileMatched = grants.matched;
    engineEvidence.grants = grants;
    if (!grants.matched) throw new Error("READ_ONLY_GRANT_PROFILE_MISMATCH");

    await executor.run("SET_ISOLATION");
    await executor.run("SET_READ_ONLY");

    await executor.run("START_SNAPSHOT");
    transactionOpen = true;
    connectionIds.push(await confirmSnapshot(executor));

    const capRows = await executor.run("ORACLE_CAPABILITIES");
    if (capRows.length !== 1) throw new Error("CAPABILITIES_ROW_COUNT");
    const tableConstraintRows = await executor.run(
      "TABLE_CONSTRAINTS_METADATA",
    );
    const checkConstraintRows = await executor.run("CHECK_CONSTRAINTS_METADATA");
    const regexpRows = await executor.run("REGEXP_CAPABILITY");
    if (regexpRows.length !== 1) throw new Error("REGEXP_ROW_COUNT");
    const capabilities = validateCapabilities(
      capRows[0],
      tableConstraintRows,
      checkConstraintRows,
      regexpRows[0],
    );
    facts.capabilitiesPassed = capabilities.passed;
    engineEvidence.capabilities = capabilities;
    if (!capabilities.passed) throw new Error("CAPABILITY_GATE_FAILED");

    snapshotA = await captureMetadata(executor);
    rollbackAAttempted = true;
    await executor.run("ROLLBACK");
    rollbackASucceeded = true;
    transactionOpen = false;
    connectionIds.push(await readConnectionId(executor));

    await executor.run("START_SNAPSHOT");
    transactionOpen = true;
    connectionIds.push(await confirmSnapshot(executor));
    snapshotB = await captureMetadata(executor);
    rollbackBAttempted = true;
    await executor.run("ROLLBACK");
    rollbackBSucceeded = true;
    transactionOpen = false;

    countersAfter = parseMutationCounters(await executor.run("COUNTERS"));
    counterComparison = compareMutationCounters(countersBefore, countersAfter);
    connectionIds.push(await readConnectionId(executor));

    const predecessorA = validate0090Footprint(
      snapshotA.predecessor,
      expected0090,
    );
    const predecessorB = validate0090Footprint(
      snapshotB.predecessor,
      expected0090,
    );
    const snapshotsEqual =
      stableRowsHash(snapshotA) === stableRowsHash(snapshotB);
    const journalSchemaExact =
      snapshotA.journal.schemaExact === true &&
      snapshotB.journal.schemaExact === true;
    databaseState = classifyJournalAndPhase2a({
      relevantRows: snapshotA.journal.relevantRows,
      relevantCount: snapshotA.journal.relevantCount,
      latestRows: snapshotA.journal.latestRows,
      phase2aTables: snapshotA.phase2a.tables,
      phase2aResidue: snapshotA.phase2a.residue,
    });
    addBlocker(blockers, databaseState.blocker);

    facts = {
      ...facts,
      oneConnectionOnly:
        connectionAttempts === 1 && connectionsEstablished === 1,
      readOnlySnapshotsEstablished: true,
      journalSchemaExact,
      predecessorFootprintExact:
        predecessorA.exact === true && predecessorB.exact === true,
      snapshotsEqual,
      connectionIdConsistent:
        connectionIds.length >= 5 &&
        new Set(connectionIds).size === 1,
      rollbacksSucceeded: rollbackASucceeded && rollbackBSucceeded,
      executorTranscriptExact:
        canonicalJson(executor.ids()) === canonicalJson(readySequence()),
      zeroWriteConfirmed:
        counterComparison.allZero === true,
      databaseStateClassification:
        databaseState.databaseStateClassification,
    };

    journalEvidence = {
      schemaExact: journalSchemaExact,
      observationAHash: canonicalHash(snapshotA.journal),
      observationBHash: canonicalHash(snapshotB.journal),
      observationHashesEqual:
        canonicalHash(snapshotA.journal) === canonicalHash(snapshotB.journal),
      relevantRows: snapshotA.journal.relevantRows,
      latestRows: snapshotA.journal.latestRows,
      ...databaseState,
    };
    schemaEvidence = {
      observationAHash: stableRowsHash(snapshotA),
      observationBHash: stableRowsHash(snapshotB),
      observationsEqual: snapshotsEqual,
      predecessor: {
        exactA: predecessorA.exact,
        exactB: predecessorB.exact,
        expectedHash: predecessorA.expectedHash,
        observedHashA: predecessorA.observedHash,
        observedHashB: predecessorB.observedHash,
      },
      phase2a: {
        tables: snapshotA.phase2a.tables,
        residue: snapshotA.phase2a.residue,
        physicalState: databaseState.phase2aPhysicalState,
      },
    };
  } catch (error) {
    addBlocker(blockers, sanitizeMessage(error?.message, secrets));
  } finally {
    if (connection && transactionOpen && executor) {
      try {
        if (!rollbackAAttempted) rollbackAAttempted = true;
        else if (!rollbackBAttempted) rollbackBAttempted = true;
        await executor.run("ROLLBACK");
        if (!rollbackASucceeded) rollbackASucceeded = true;
        else rollbackBSucceeded = true;
      } catch {
        addBlocker(blockers, "BLOCKED_CLEANUP_ROLLBACK_FAILED");
      }
      transactionOpen = false;
    }

    if (connection) {
      try {
        await connection.end();
        connectionClosedSuccessfully = true;
        connectionClosedAt = utcNow();
      } catch {
        addBlocker(blockers, "BLOCKED_CONNECTION_CLOSE");
      }
    }
  }

  facts.oneConnectionOnly =
    connectionAttempts === 1 && connectionsEstablished === 1;
  facts.connectionClosedSuccessfully = connectionClosedSuccessfully;
  facts.connectionIdConsistent =
    connectionIds.length >= 2 && new Set(connectionIds).size === 1;
  facts.rollbacksSucceeded = rollbackASucceeded && rollbackBSucceeded;
  facts.zeroWriteConfirmed =
    facts.zeroWriteConfirmed === true &&
    counterComparison?.allZero === true &&
    facts.connectionIdConsistent &&
    facts.rollbacksSucceeded &&
    connectionClosedSuccessfully;
  facts.databaseStateClassification =
    databaseState.databaseStateClassification;

  const outcome = evaluateReadiness(facts, [...blockers]);
  const zeroWriteEvidence = {
    connectionAttempts,
    connectionsEstablished,
    reconnectAttemptsByTool: 0,
    connectionIds,
    connectionIdConsistent: facts.connectionIdConsistent,
    rollbackA: {
      attempted: rollbackAAttempted,
      succeeded: rollbackASucceeded,
    },
    rollbackB: {
      attempted: rollbackBAttempted,
      succeeded: rollbackBSucceeded,
    },
    connectionClose: {
      succeeded: connectionClosedSuccessfully,
      closedAt: connectionClosedAt,
    },
    mutationCounterSetComplete:
      Boolean(countersBefore) && Boolean(countersAfter),
    mutationCounterDeltas: counterComparison?.deltas ?? null,
    mutationCounterDeltasAllZero: counterComparison?.allZero ?? false,
    zeroWriteConfirmed: facts.zeroWriteConfirmed,
    databaseWritesByPreflightConnection:
      facts.zeroWriteConfirmed ? 0 : null,
    globalProductionDatabaseWritesDuringWindow: "NOT_PROVEN",
    migrationAppliedByThisPreflight: false,
    executedStatements:
      executor?.transcript ?? [],
  };
  const finalEvidence = {
    expectedSourceCheckpoint: SOURCE_CONTRACT.expectedSourceCheckpoint,
    preflightStartedAt: startedAt,
    preflightCompletedAt: utcNow(),
    connectionOpenedAt,
    connectionClosedAt,
    sourceGatePassed: true,
    runtimeProfilePassed: runtime.passed,
    productionIdentityMatched: facts.productionIdentityMatched,
    tlsVerified: facts.tlsVerified,
    grantProfileMatched: facts.grantProfileMatched,
    engineProfileMatched: facts.oracleMySql84ExactProfileMatched,
    capabilitiesPassed: facts.capabilitiesPassed,
    migration0090ExactAndLatest:
      databaseState.migration0090ExactAndLatest ?? null,
    migration0091JournalEntryAbsent:
      databaseState.migration0091JournalEntryAbsent ?? null,
    phase2aPhysicalState:
      databaseState.phase2aPhysicalState ?? "UNKNOWN",
    actual0091CheckConstraintsInstalled:
      databaseState.phase2aPhysicalState === "ABSENT" ? false : null,
    actual0091ForeignKeysInstalled:
      databaseState.phase2aPhysicalState === "ABSENT" ? false : null,
    actual0091ConstraintEnforcementBehavior:
      "NOT_TESTED_BY_READ_ONLY_PREFLIGHT",
    databaseWritesByPreflightConnection:
      facts.zeroWriteConfirmed ? 0 : null,
    globalProductionDatabaseWritesDuringWindow: "NOT_PROVEN",
    ...outcome,
  };

  if (!connectionClosedSuccessfully) {
    if (outputReserved) {
      try {
        rmSync(outputDir, { recursive: true, force: true });
      } catch {}
    }
    throw new Error(
      `PREFLIGHT_INCOMPLETE_NO_EVIDENCE_CONNECTION_NOT_CLOSED:${outcome.blockers.join(",")}`,
    );
  }

  const evidence = {
    source: sourceEvidence,
    engine: engineEvidence,
    journal: journalEvidence,
    schema: schemaEvidence,
    zeroWrite: zeroWriteEvidence,
    final: finalEvidence,
  };
  writeEvidencePack(outputDir, evidence, secrets);
  return {
    exitCode: outcome.ready ? 0 : 2,
    outputDir,
    final: finalEvidence,
  };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const { outputDir } = parseCli(argv);
    const result = await runPreflight({ outputDir });
    process.stdout.write(
      `applyReadiness=${result.final.applyReadiness}\napplyAuthorized=false\nmigrationAppliedByThisPreflight=false\noutputDir=${result.outputDir}\n`,
    );
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(
      `preflightOperationalFailure=${sanitizeMessage(error?.message)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}
