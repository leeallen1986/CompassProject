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
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIDB_PROFILE,
  TIDB_SQL,
  SNAPSHOT_STATEMENT_IDS,
  classifyTidbDatabaseState,
  evaluateTidbReadiness,
  expectedTidb0090Contract,
  hashBytes,
  lintTidbSqlManifest,
  parseProductionDatabaseUrl,
  sourceAttestation,
  validateTidb0090Footprint,
  validateTidbAccountProfile,
  validateTidbCapabilities,
  validateTidbJournalSchema,
} from "./issue86-phase2a-tidb-preflight-core.mjs";
import {
  assertNoSecrets,
  canonicalHash,
  canonicalJson,
  sanitizeMessage,
} from "./issue86-phase2a-preflight-core.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const TIDB_CORE_PATH = resolve(SCRIPT_DIR, "issue86-phase2a-tidb-preflight-core.mjs");
const ORIGINAL_CORE_PATH = resolve(SCRIPT_DIR, "issue86-phase2a-preflight-core.mjs");
const URL_POLICY_PATH = resolve(SCRIPT_DIR, "issue86-phase2a-database-url-policy.mjs");
const MYSQL2_PACKAGE_PATH = resolve(PROJECT_ROOT, "node_modules/mysql2/package.json");
const EXPECTED_NODE_VERSION = "v22.13.0";
const EXPECTED_MYSQL2_VERSION = "3.16.3";
const EVIDENCE_NAMES = Object.freeze({
  source: "issue86-phase2a-tidb-preflight-source.json",
  engine: "issue86-phase2a-tidb-preflight-engine.json",
  journal: "issue86-phase2a-tidb-preflight-journal.json",
  schema: "issue86-phase2a-tidb-preflight-schema.json",
  zeroWrite: "issue86-phase2a-tidb-preflight-zero-write.json",
  final: "issue86-phase2a-tidb-preflight-final.json",
  index: "issue86-phase2a-tidb-preflight-sha256.json",
  complete: "issue86-phase2a-tidb-preflight-COMPLETE.json",
});

function utcNow() {
  return new Date().toISOString();
}

function requireSha256(env, name) {
  const value = env[name];
  if (!/^[0-9a-f]{64}$/.test(value ?? "")) {
    throw new Error(`${name}_MISSING_OR_INVALID`);
  }
  return value;
}

function requirePositiveInteger(env, name) {
  const value = String(env[name] ?? "");
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name}_MISSING_OR_INVALID`);
  return Number(value);
}

function parseCli(argv) {
  if (
    argv.length !== 2 ||
    argv[0] !== "--output-dir" ||
    !argv[1] ||
    argv[1].startsWith("-")
  ) {
    throw new Error("CLI_USAGE: expected exactly --output-dir <new-directory>");
  }
  return { outputDir: resolve(argv[1]) };
}

function validateOutputLocation(outputDir) {
  const fromRepository = relative(PROJECT_ROOT, outputDir);
  if (
    fromRepository === "" ||
    (fromRepository !== ".." && !fromRepository.startsWith(`..${sep}`))
  ) {
    throw new Error("OUTPUT_PATH_INSIDE_REPOSITORY_REJECTED");
  }
  try {
    lstatSync(outputDir);
    throw new Error("OUTPUT_PATH_ALREADY_EXISTS");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const parent = dirname(outputDir);
  const stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("OUTPUT_PARENT_NOT_SECURE_DIRECTORY");
  }
  if (
    (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
    (stat.mode & 0o022) !== 0 ||
    realpathSync(parent) !== parent
  ) {
    throw new Error("OUTPUT_PARENT_OWNER_OR_MODE_REJECTED");
  }
}

function reserveOutputDirectory(outputDir) {
  mkdirSync(outputDir, { mode: 0o700 });
  const stat = lstatSync(outputDir);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new Error("OUTPUT_DIRECTORY_RESERVATION_FAILED");
  }
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
  return { filename, byteSize: bytes.length, sha256: hashBytes(bytes) };
}

function fsyncDirectory(path) {
  const fd = openSync(path, fsConstants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function sourcePins(env) {
  return {
    tool: requireSha256(env, "ISSUE86_TIDB_PREFLIGHT_EXPECTED_TOOL_SHA256"),
    tidbCore: requireSha256(env, "ISSUE86_TIDB_PREFLIGHT_EXPECTED_TIDB_CORE_SHA256"),
    originalCore: requireSha256(env, "ISSUE86_TIDB_PREFLIGHT_EXPECTED_ORIGINAL_CORE_SHA256"),
    urlPolicy: requireSha256(env, "ISSUE86_TIDB_PREFLIGHT_EXPECTED_URL_POLICY_SHA256"),
  };
}

function runtimeProfile() {
  const mysql2 = JSON.parse(readFileSync(MYSQL2_PACKAGE_PATH, "utf8"));
  return {
    passed:
      process.version === EXPECTED_NODE_VERSION &&
      mysql2.version === EXPECTED_MYSQL2_VERSION,
    nodeVersion: process.version,
    expectedNodeVersion: EXPECTED_NODE_VERSION,
    mysql2Version: mysql2.version,
    expectedMysql2Version: EXPECTED_MYSQL2_VERSION,
  };
}

function inspectTls(connection) {
  const stream = connection?.connection?.stream;
  const certificate = stream?.getPeerCertificate?.();
  const fingerprint = String(certificate?.fingerprint256 ?? "")
    .replaceAll(":", "")
    .toLowerCase();
  return {
    encrypted: stream?.encrypted === true,
    authorized: stream?.authorized === true,
    authorizationErrorPresent: Boolean(stream?.authorizationError),
    protocol: stream?.getProtocol?.() ?? null,
    cipher: stream?.getCipher?.()?.name ?? null,
    peerCertificateSha256: /^[0-9a-f]{64}$/.test(fingerprint) ? fingerprint : null,
  };
}

function parseTlsStatus(rows) {
  const map = new Map();
  for (const row of rows) {
    const name = String(row.Variable_name ?? row.variableName ?? "");
    if (!["Ssl_cipher", "Ssl_version"].includes(name) || map.has(name)) {
      throw new Error("TLS_STATUS_SHAPE_INVALID");
    }
    map.set(name, String(row.Value ?? row.value ?? ""));
  }
  if (map.size !== 2) throw new Error("TLS_STATUS_INCOMPLETE");
  return Object.fromEntries(map);
}

function validateTls(transport, status, expectedPeer) {
  const matched =
    transport.encrypted === true &&
    transport.authorized === true &&
    transport.authorizationErrorPresent === false &&
    ["TLSv1.2", "TLSv1.3"].includes(transport.protocol) &&
    Boolean(transport.cipher) &&
    transport.peerCertificateSha256 === expectedPeer &&
    status.Ssl_version === transport.protocol &&
    status.Ssl_cipher === transport.cipher;
  return {
    matched,
    peerCertificatePinned: transport.peerCertificateSha256 === expectedPeer,
    expectedPeerCertificateSha256: expectedPeer,
    transport,
    session: status,
  };
}

function exactColumns(row, names, label) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`${label}_ROW_INVALID`);
  }
  if (canonicalJson(Object.keys(row).sort()) !== canonicalJson([...names].sort())) {
    throw new Error(`${label}_COLUMN_SHAPE_INVALID`);
  }
}

class LockedExecutor {
  constructor(connection) {
    this.connection = connection;
    this.transcript = [];
  }

  async run(statementId) {
    const statement = TIDB_SQL[statementId];
    if (!statement) throw new Error(`UNKNOWN_TIDB_STATEMENT:${statementId}`);
    const [rows] = await this.connection.query(statement.sql);
    if (!Array.isArray(rows)) throw new Error(`TIDB_RESULT_INVALID:${statementId}`);
    this.transcript.push({
      sequence: this.transcript.length + 1,
      statementId,
      kind: statement.kind,
      method: statement.method,
      sqlSha256: hashBytes(Buffer.from(statement.sql, "utf8")),
      rowCount: rows.length,
    });
    return rows;
  }

  ids() {
    return this.transcript.map((item) => item.statementId);
  }
}

async function connectionId(executor) {
  const rows = await executor.run("CONNECTION_ID");
  if (rows.length !== 1) throw new Error("CONNECTION_ID_ROW_COUNT");
  exactColumns(rows[0], ["connectionId"], "CONNECTION_ID");
  const value = String(rows[0].connectionId ?? "");
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("CONNECTION_ID_INVALID");
  return value;
}

async function captureSnapshot(executor, expected0090) {
  const journalObservation = {
    tables: await executor.run("JOURNAL_TABLES"),
    columns: await executor.run("JOURNAL_COLUMNS"),
    indexes: await executor.run("JOURNAL_INDEXES"),
    constraints: await executor.run("JOURNAL_CONSTRAINTS"),
    triggers: await executor.run("JOURNAL_TRIGGERS"),
  };
  const journalSchema = validateTidbJournalSchema(journalObservation);
  const countRows = await executor.run("JOURNAL_RELEVANT_COUNT");
  if (countRows.length !== 1) throw new Error("JOURNAL_COUNT_ROW_COUNT");
  exactColumns(countRows[0], ["rowCount"], "JOURNAL_COUNT");
  const predecessorObservation = {
    tables: await executor.run("PREDECESSOR_TABLES"),
    columns: await executor.run("PREDECESSOR_COLUMNS"),
    indexes: await executor.run("PREDECESSOR_INDEXES"),
    constraints: await executor.run("PREDECESSOR_CONSTRAINTS"),
    keys: await executor.run("PREDECESSOR_KEYS"),
    referential: await executor.run("PREDECESSOR_REFERENTIAL"),
    checks: await executor.run("PREDECESSOR_CHECKS"),
  };
  const predecessor = validateTidb0090Footprint(
    predecessorObservation,
    expected0090,
  );
  return {
    journal: {
      ...journalObservation,
      schemaExact: journalSchema.exact,
      schemaExpectedHash: journalSchema.expectedHash,
      schemaObservedHash: journalSchema.observedHash,
      relevantCount: String(countRows[0].rowCount),
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

function expectedSequence() {
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
    ...SNAPSHOT_STATEMENT_IDS,
    "CONNECTION_ID",
    ...SNAPSHOT_STATEMENT_IDS,
    "CONNECTION_ID",
  ];
}

function writeEvidence(outputDir, evidence, secrets) {
  for (const value of Object.values(evidence)) assertNoSecrets(value, secrets);
  const mapping = [
    [EVIDENCE_NAMES.source, evidence.source],
    [EVIDENCE_NAMES.engine, evidence.engine],
    [EVIDENCE_NAMES.journal, evidence.journal],
    [EVIDENCE_NAMES.schema, evidence.schema],
    [EVIDENCE_NAMES.zeroWrite, evidence.zeroWrite],
    [EVIDENCE_NAMES.final, evidence.final],
  ];
  const index = {};
  for (const [filename, value] of mapping) {
    const meta = writeAtomicJson(outputDir, filename, value);
    index[filename] = { byteSize: meta.byteSize, sha256: meta.sha256 };
  }
  const indexMeta = writeAtomicJson(outputDir, EVIDENCE_NAMES.index, index);
  fsyncDirectory(outputDir);
  writeAtomicJson(outputDir, EVIDENCE_NAMES.complete, {
    status: "COMPLETE",
    evidenceFileCount: mapping.length,
    indexFilename: EVIDENCE_NAMES.index,
    indexByteSize: indexMeta.byteSize,
    indexSha256: indexMeta.sha256,
  });
  fsyncDirectory(outputDir);
}

export async function runTidbPreflight({
  outputDir,
  env = process.env,
  connectionFactory = createConnection,
}) {
  const startedAt = utcNow();
  const manifest = lintTidbSqlManifest();
  if (!manifest.passed) {
    throw new Error(`TIDB_SQL_MANIFEST_INVALID:${manifest.errors.join(",")}`);
  }
  const pins = sourcePins(env);
  const source = sourceAttestation({
    projectRoot: PROJECT_ROOT,
    toolPath: SCRIPT_PATH,
    corePath: TIDB_CORE_PATH,
    expectedToolSha256: pins.tool,
    expectedCoreSha256: pins.tidbCore,
  });
  if (!source.passed) throw new Error(`TIDB_SOURCE_GATE_FAILED:${source.errors.join(",")}`);
  const actualOriginalCore = hashBytes(readFileSync(ORIGINAL_CORE_PATH));
  const actualUrlPolicy = hashBytes(readFileSync(URL_POLICY_PATH));
  if (actualOriginalCore !== pins.originalCore) {
    throw new Error("TIDB_ORIGINAL_CORE_SHA256_MISMATCH");
  }
  if (actualUrlPolicy !== pins.urlPolicy) {
    throw new Error("TIDB_URL_POLICY_SHA256_MISMATCH");
  }
  const runtime = runtimeProfile();
  if (!runtime.passed) throw new Error("TIDB_RUNTIME_PROFILE_MISMATCH");
  const { normalized, parsed } = parseProductionDatabaseUrl(env.DATABASE_URL);
  parsed.config.connectTimeout = 10000;
  const expectedPeer = requireSha256(
    env,
    "ISSUE86_TIDB_PREFLIGHT_EXPECTED_PEER_CERT_SHA256",
  );
  const expectedIdentity = requireSha256(
    env,
    "ISSUE86_TIDB_PREFLIGHT_EXPECTED_DB_IDENTITY_SHA256",
  );
  const expectedAccount = requireSha256(
    env,
    "ISSUE86_TIDB_PREFLIGHT_EXPECTED_DB_ACCOUNT_SHA256",
  );
  const expectedRole = requireSha256(
    env,
    "ISSUE86_TIDB_PREFLIGHT_EXPECTED_ROLE_SHA256",
  );
  const expectedGrants = requireSha256(
    env,
    "ISSUE86_TIDB_PREFLIGHT_EXPECTED_GRANTS_SHA256",
  );
  const expectedAccountDefinition = requireSha256(
    env,
    "ISSUE86_TIDB_PREFLIGHT_EXPECTED_ACCOUNT_DEFINITION_SHA256",
  );
  const expectedGrantRowCount = requirePositiveInteger(
    env,
    "ISSUE86_TIDB_PREFLIGHT_EXPECTED_GRANT_ROW_COUNT",
  );
  validateOutputLocation(outputDir);
  reserveOutputDirectory(outputDir);

  let connection = null;
  let connectionClosed = false;
  let executor = null;
  let attempts = 0;
  let established = 0;
  let snapshotA = null;
  let snapshotB = null;
  let engineEvidence = null;
  let capabilities = null;
  let databaseState = {
    databaseStateClassification: "BLOCKED_DATABASE_STATE_UNKNOWN",
    blocker: "BLOCKED_DATABASE_STATE_UNKNOWN",
  };
  let fatalError = null;
  const connectionIds = [];
  const expected0090 = expectedTidb0090Contract(source.snapshot0090);
  const { snapshot0090: _snapshot, ...safeSource } = source;
  const secrets = {
    highRisk: parsed.secrets.highRisk,
    contextual: parsed.secrets.contextual,
  };

  try {
    attempts = 1;
    connection = await connectionFactory(parsed.config);
    established = 1;
    executor = new LockedExecutor(connection);
    connectionIds.push(await connectionId(executor));
    const tls = validateTls(
      inspectTls(connection),
      parseTlsStatus(await executor.run("TLS_STATUS")),
      expectedPeer,
    );
    if (!tls.matched) throw new Error("TIDB_TLS_NOT_VERIFIED");

    const identityRows = await executor.run("ENGINE_IDENTITY");
    if (identityRows.length !== 1) throw new Error("TIDB_ENGINE_ROW_COUNT");
    exactColumns(
      identityRows[0],
      [
        "versionString",
        "versionComment",
        "connectionId",
        "currentUserSha256",
        "targetIdentitySha256",
      ],
      "TIDB_ENGINE",
    );
    connectionIds.push(String(identityRows[0].connectionId));
    const engineExact =
      String(identityRows[0].versionString) === TIDB_PROFILE.exactVersion &&
      String(identityRows[0].versionComment) === TIDB_PROFILE.exactComment;
    const productionIdentityMatched =
      String(identityRows[0].targetIdentitySha256) === expectedIdentity;
    const accountIdentityMatched =
      String(identityRows[0].currentUserSha256) === expectedAccount;

    const account = validateTidbAccountProfile({
      roleRows: await executor.run("CURRENT_ROLE"),
      grantRows: await executor.run("SHOW_GRANTS"),
      createUserRows: await executor.run("SHOW_CREATE_USER"),
      expectedRoleSha256: expectedRole,
      expectedGrantSha256: expectedGrants,
      expectedAccountDefinitionSha256: expectedAccountDefinition,
      expectedGrantRowCount,
    });
    capabilities = validateTidbCapabilities({
      globalVariableRows: await executor.run("GLOBAL_VARIABLES"),
      sessionVariableRows: await executor.run("SESSION_VARIABLES"),
      tableConstraintMetadataRows: await executor.run("TABLE_CONSTRAINTS_METADATA"),
      checkConstraintMetadataRows: await executor.run("CHECK_CONSTRAINTS_METADATA"),
      tidbCheckConstraintMetadataRows: await executor.run(
        "TIDB_CHECK_CONSTRAINTS_METADATA",
      ),
    });
    snapshotA = await captureSnapshot(executor, expected0090);
    connectionIds.push(await connectionId(executor));
    snapshotB = await captureSnapshot(executor, expected0090);
    connectionIds.push(await connectionId(executor));
    databaseState = classifyTidbDatabaseState(snapshotB);
    engineEvidence = {
      versionString: String(identityRows[0].versionString),
      versionComment: String(identityRows[0].versionComment),
      engineExact,
      productionIdentityMatched,
      accountIdentityMatched,
      targetIdentitySha256: String(identityRows[0].targetIdentitySha256),
      currentUserSha256: String(identityRows[0].currentUserSha256),
      tls,
      account,
      capabilities,
    };
  } catch (error) {
    fatalError = sanitizeMessage(error?.message ?? "TIDB_PREFLIGHT_FAILED");
  } finally {
    if (connection) {
      try {
        await connection.end();
        connectionClosed = true;
      } catch (error) {
        fatalError = fatalError ?? sanitizeMessage(error?.message ?? "TIDB_CONNECTION_CLOSE_FAILED");
      }
    }
  }

  const snapshotsEqual =
    snapshotA !== null &&
    snapshotB !== null &&
    canonicalHash(snapshotA) === canonicalHash(snapshotB);
  const idsConsistent =
    connectionIds.length === 4 && new Set(connectionIds).size === 1;
  const transcriptExact =
    executor !== null &&
    canonicalJson(executor.ids()) === canonicalJson(expectedSequence());
  const facts = {
    sourceGatePassed: source.passed,
    runtimeProfilePassed: runtime.passed,
    productionIdentityMatched: engineEvidence?.productionIdentityMatched === true,
    accountIdentityMatched: engineEvidence?.accountIdentityMatched === true,
    tlsVerified: engineEvidence?.tls?.matched === true,
    peerCertificatePinned:
      engineEvidence?.tls?.peerCertificatePinned === true,
    engineExact: engineEvidence?.engineExact === true,
    accountProfileMatched: engineEvidence?.account?.passed === true,
    oneConnectionOnly: attempts === 1 && established === 1,
    connectionIdConsistent: idsConsistent,
    capabilitiesObserved: capabilities !== null,
    checkConstraintsEnabled: capabilities?.checksEnabled === true,
    foreignKeyFeatureEnabled: capabilities?.foreignKeyFeatureEnabled === true,
    globalForeignKeyChecksEnabled:
      capabilities?.globalForeignKeyChecksEnabled === true,
    sessionForeignKeyChecksEnabled:
      capabilities?.sessionForeignKeyChecksEnabled === true,
    noopFunctionsDisabled: capabilities?.noopFunctionsDisabled === true,
    metadataCapabilitiesExact:
      capabilities?.tableMetadataExact === true &&
      capabilities?.checkMetadataExact === true &&
      capabilities?.tidbCheckMetadataExact === true,
    journalSchemaExact:
      snapshotA?.journal?.schemaExact === true &&
      snapshotB?.journal?.schemaExact === true,
    predecessorFootprintExact:
      snapshotA?.predecessor?.exact === true &&
      snapshotB?.predecessor?.exact === true,
    snapshotsEqual,
    transcriptExact,
    connectionClosed,
  };
  let verdict = evaluateTidbReadiness({ facts, databaseState });
  if (fatalError) {
    verdict = {
      ...verdict,
      applyReadiness: "PREFLIGHT_INCOMPLETE",
      blockers: [...new Set([...verdict.blockers, fatalError])],
    };
  }

  const evidence = {
    source: {
      ...safeSource,
      runtime,
      sourcePins: {
        tool: pins.tool,
        tidbCore: pins.tidbCore,
        originalCore: {
          expected: pins.originalCore,
          actual: actualOriginalCore,
          matched: actualOriginalCore === pins.originalCore,
        },
        urlPolicy: {
          expected: pins.urlPolicy,
          actual: actualUrlPolicy,
          matched: actualUrlPolicy === pins.urlPolicy,
        },
      },
      urlPolicy: normalized.policyEvidence,
      urlPolicySha256: normalized.policySha256,
      queryManifestSha256: manifest.sha256,
    },
    engine: engineEvidence ?? {
      observed: false,
      capabilities,
    },
    journal: {
      databaseState,
      snapshotA: snapshotA?.journal ?? null,
      snapshotB: snapshotB?.journal ?? null,
    },
    schema: {
      snapshotA: snapshotA
        ? {
            predecessor: snapshotA.predecessor,
            phase2a: snapshotA.phase2a,
          }
        : null,
      snapshotB: snapshotB
        ? {
            predecessor: snapshotB.predecessor,
            phase2a: snapshotB.phase2a,
          }
        : null,
      snapshotsEqual,
      snapshotASha256: snapshotA ? canonicalHash(snapshotA) : null,
      snapshotBSha256: snapshotB ? canonicalHash(snapshotB) : null,
    },
    zeroWrite: {
      connectionAttempts: attempts,
      connectionsEstablished: established,
      connectionClosed,
      connectionIds,
      connectionIdConsistent: idsConsistent,
      executedStatements: executor?.transcript ?? [],
      executorTranscriptExact: transcriptExact,
      statementKinds: executor?.transcript.map((item) => item.kind) ?? [],
      databaseWritesByPreflightConnection:
        transcriptExact &&
        executor.transcript.every((item) => item.kind === "READ") &&
        engineEvidence?.account?.passed === true
          ? 0
          : null,
      globalProductionDatabaseWritesDuringWindow: "not_proven",
      migrationCommandsExecuted: 0,
    },
    final: {
      preflightType: "issue86_phase2a_tidb_read_only",
      startedAt,
      completedAt: utcNow(),
      exactEngineProfile: TIDB_PROFILE,
      facts,
      databaseState,
      ...verdict,
      applyAuthorized: false,
      migrationAppliedByThisPreflight: false,
      productionDatabaseWrites:
        transcriptExact &&
        executor?.transcript.every((item) => item.kind === "READ") &&
        engineEvidence?.account?.passed === true
          ? 0
          : null,
    },
  };
  writeEvidence(outputDir, evidence, secrets);
  return evidence.final;
}

export async function main() {
  const { outputDir } = parseCli(process.argv.slice(2));
  try {
    const result = await runTidbPreflight({ outputDir });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.applyReadiness !== "READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION") {
      process.exitCode = 2;
    }
  } catch (error) {
    const code = String(error?.message ?? "TIDB_PREFLIGHT_FAILED")
      .split(":")[0]
      .replace(/[^A-Z0-9_]/gi, "_")
      .slice(0, 128);
    process.stderr.write(`tidbPreflightFailure=${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}
