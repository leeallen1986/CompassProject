#!/usr/bin/env node
import { createHash } from "node:crypto";
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
import { createConnection } from "mysql2/promise";
import {
  SNAPSHOT_STATEMENT_IDS,
  TIDB_SQL,
  parseProductionDatabaseUrl,
} from "./issue86-phase2a-tidb-preflight-core.mjs";
import { runTidbPreflightV2 } from "./issue86-phase2a-production-tidb-preflight-v2.mjs";
import {
  ACCOUNT_POLICY_SENTINEL_SHA256,
  evaluateEffectiveSecureTransport,
  sanitizeTidbCreateUserRows,
} from "./issue86-phase2a-tidb-account-policy.mjs";
import {
  assertNoSecrets,
  canonicalHash,
  canonicalJson,
  sanitizeMessage,
} from "./issue86-phase2a-preflight-core.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const ACCOUNT_POLICY_PATH = join(
  SCRIPT_DIR,
  "issue86-phase2a-tidb-account-policy.mjs",
);

const CHECK_CENSUS_SQL = Object.freeze({
  CHECK_CENSUS_COUNT:
    "SELECT COUNT(*) AS rowCount FROM information_schema.TIDB_CHECK_CONSTRAINTS WHERE UPPER(CONSTRAINT_SCHEMA) NOT IN ('INFORMATION_SCHEMA','METRICS_SCHEMA','MYSQL','PERFORMANCE_SCHEMA')",
  CHECK_CENSUS_ROWS:
    "SELECT SHA2(CONCAT_WS(CHAR(0), CONSTRAINT_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, CHECK_CLAUSE), 256) AS rowHash FROM information_schema.TIDB_CHECK_CONSTRAINTS WHERE UPPER(CONSTRAINT_SCHEMA) NOT IN ('INFORMATION_SCHEMA','METRICS_SCHEMA','MYSQL','PERFORMANCE_SCHEMA') ORDER BY CONSTRAINT_SCHEMA, TABLE_NAME, CONSTRAINT_NAME LIMIT 10001",
});

const V2_EXPECTED_TRANSCRIPT = Object.freeze([
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
]);

const V3_EXPECTED_TRANSCRIPT = Object.freeze(
  V2_EXPECTED_TRANSCRIPT.flatMap((id) =>
    id === "GLOBAL_VARIABLES"
      ? [id, "CHECK_CENSUS_COUNT", "CHECK_CENSUS_ROWS"]
      : [id],
  ),
);

const FILES = Object.freeze({
  accountPolicy: "issue86-phase2a-tidb-preflight-v3-account-policy.json",
  census: "issue86-phase2a-tidb-preflight-v3-check-census.json",
  zeroWrite: "issue86-phase2a-tidb-preflight-v3-zero-write.json",
  final: "issue86-phase2a-tidb-preflight-v3-final.json",
  index: "issue86-phase2a-tidb-preflight-v3-sha256.json",
  complete: "issue86-phase2a-tidb-preflight-v3-COMPLETE.json",
});

const now = () => new Date().toISOString();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function requireSha(env, name) {
  const value = env[name];
  if (!/^[0-9a-f]{64}$/.test(value ?? "")) {
    throw new Error(`${name}_MISSING_OR_INVALID`);
  }
  return value;
}

function optionalCensusPins(env) {
  const count = String(
    env.ISSUE86_TIDB_PREFLIGHT_EXPECTED_CHECK_CENSUS_COUNT ?? "",
  );
  const hash = String(
    env.ISSUE86_TIDB_PREFLIGHT_EXPECTED_CHECK_CENSUS_SHA256 ?? "",
  );
  const absent = count === "" && hash === "";
  if (absent) return { supplied: false, count: null, sha256: null };
  if (!/^(?:0|[1-9][0-9]*)$/.test(count) || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error("TIDB_CHECK_CENSUS_PINS_INVALID");
  }
  return { supplied: true, count, sha256: hash };
}

function parseArgs(argv) {
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

function reserveOutput(path) {
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

function writeJson(outputDir, filename, value) {
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
  return { byteSize: bytes.length, sha256: sha256(bytes) };
}

function flushDirectory(path) {
  const fd = openSync(path, fsConstants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writePack(outputDir, evidence, secrets) {
  for (const value of Object.values(evidence)) assertNoSecrets(value, secrets);
  const index = {};
  for (const key of ["accountPolicy", "census", "zeroWrite", "final"]) {
    index[FILES[key]] = writeJson(outputDir, FILES[key], evidence[key]);
  }
  const indexMeta = writeJson(outputDir, FILES.index, index);
  flushDirectory(outputDir);
  writeJson(outputDir, FILES.complete, {
    status: "COMPLETE",
    evidenceFileCount: 4,
    indexFilename: FILES.index,
    indexByteSize: indexMeta.byteSize,
    indexSha256: indexMeta.sha256,
    v2EvidenceDirectory: "v2",
  });
  flushDirectory(outputDir);
}

function exactDecimal(value, label) {
  const text = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]*)$/.test(text)) {
    throw new Error(`${label}_INVALID`);
  }
  return text;
}

function censusFromRows(countRows, hashRows) {
  if (!Array.isArray(countRows) || countRows.length !== 1) {
    throw new Error("TIDB_CHECK_CENSUS_COUNT_INVALID");
  }
  if (
    !countRows[0] ||
    typeof countRows[0] !== "object" ||
    Array.isArray(countRows[0]) ||
    canonicalJson(Object.keys(countRows[0]).sort()) !==
      canonicalJson(["rowCount"])
  ) {
    throw new Error("TIDB_CHECK_CENSUS_COUNT_SHAPE_INVALID");
  }
  const rowCount = exactDecimal(
    countRows[0].rowCount,
    "TIDB_CHECK_CENSUS_COUNT",
  );
  if (BigInt(rowCount) > 10000n) {
    throw new Error("TIDB_CHECK_CENSUS_LIMIT_EXCEEDED");
  }
  if (!Array.isArray(hashRows) || BigInt(hashRows.length) !== BigInt(rowCount)) {
    throw new Error("TIDB_CHECK_CENSUS_ROWS_INCOMPLETE");
  }
  const hashes = hashRows.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      canonicalJson(Object.keys(row).sort()) !== canonicalJson(["rowHash"]) ||
      !/^[0-9a-f]{64}$/.test(String(row.rowHash ?? ""))
    ) {
      throw new Error("TIDB_CHECK_CENSUS_ROW_INVALID");
    }
    return String(row.rowHash);
  });
  return {
    visibilityScope: "account_visible_non_system_schemas",
    rowCount,
    rowsSha256: canonicalHash(hashes),
    rawConstraintNamesStored: false,
    rawCheckClausesStored: false,
  };
}

function makeConnectionFactory({ realConnectionFactory, state }) {
  const sqlToId = new Map();
  for (const [id, statement] of Object.entries(TIDB_SQL)) {
    if (sqlToId.has(statement.sql)) throw new Error("TIDB_SQL_NOT_UNIQUE");
    sqlToId.set(statement.sql, id);
  }
  for (const [id, sql] of Object.entries(CHECK_CENSUS_SQL)) {
    sqlToId.set(sql, id);
  }

  return async (config) => {
    state.connectionFactoryCalls += 1;
    if (state.connectionFactoryCalls !== 1) {
      throw new Error("TIDB_V3_MULTIPLE_CONNECTIONS_REJECTED");
    }
    const connection = await realConnectionFactory(config);
    state.connectionEstablished = true;
    return {
      connection: connection.connection,
      async query(sql, params) {
        if (params !== undefined && (!Array.isArray(params) || params.length !== 0)) {
          throw new Error("TIDB_V3_QUERY_PARAMETERS_REJECTED");
        }
        const statementId = sqlToId.get(String(sql));
        if (!statementId) throw new Error("TIDB_V3_UNKNOWN_SQL_REJECTED");
        const [rows, fields] = await connection.query(sql);
        if (!Array.isArray(rows)) throw new Error("TIDB_V3_RESULT_INVALID");
        state.transcript.push({
          sequence: state.transcript.length + 1,
          statementId,
          kind: "READ",
          method: "query",
          sqlSha256: sha256(Buffer.from(String(sql), "utf8")),
          rowCount: rows.length,
        });

        if (statementId === "SHOW_CREATE_USER") {
          const sanitized = sanitizeTidbCreateUserRows(rows);
          state.accountPolicy = sanitized.policy;
          return [sanitized.rows, fields];
        }

        if (statementId === "GLOBAL_VARIABLES") {
          state.effectiveTransport = evaluateEffectiveSecureTransport({
            accountPolicy: state.accountPolicy,
            globalVariableRows: rows,
          });
          if (!state.effectiveTransport.effectiveSecureTransport) {
            throw new Error("TIDB_EFFECTIVE_SECURE_TRANSPORT_REQUIRED");
          }
          const [countRows] = await this.query(
            CHECK_CENSUS_SQL.CHECK_CENSUS_COUNT,
          );
          const [hashRows] = await this.query(CHECK_CENSUS_SQL.CHECK_CENSUS_ROWS);
          state.census = censusFromRows(countRows, hashRows);
        }

        return [rows, fields];
      },
      async end() {
        await connection.end();
        state.connectionClosed = true;
      },
    };
  };
}

function transcriptExact(transcript) {
  return (
    canonicalJson(transcript.map((row) => row.statementId)) ===
      canonicalJson(V3_EXPECTED_TRANSCRIPT) &&
    transcript.every((row) => row.kind === "READ" && row.method === "query")
  );
}

export async function runTidbPreflightV3({
  outputDir,
  env = process.env,
  runV2 = runTidbPreflightV2,
  realConnectionFactory = createConnection,
}) {
  const startedAt = now();
  const expectedV3Sha = requireSha(
    env,
    "ISSUE86_TIDB_PREFLIGHT_EXPECTED_V3_SHA256",
  );
  const expectedAccountPolicySha = requireSha(
    env,
    "ISSUE86_TIDB_PREFLIGHT_EXPECTED_ACCOUNT_POLICY_SHA256",
  );
  const actualV3Sha = sha256(readFileSync(SCRIPT_PATH));
  const actualAccountPolicySha = sha256(readFileSync(ACCOUNT_POLICY_PATH));
  if (actualV3Sha !== expectedV3Sha) throw new Error("TIDB_V3_SHA_MISMATCH");
  if (actualAccountPolicySha !== expectedAccountPolicySha) {
    throw new Error("TIDB_ACCOUNT_POLICY_SHA_MISMATCH");
  }

  const { parsed } = parseProductionDatabaseUrl(env.DATABASE_URL);
  const secrets = {
    highRisk: parsed.secrets.highRisk,
    contextual: parsed.secrets.contextual,
  };
  const expectedCensus = optionalCensusPins(env);
  reserveOutput(outputDir);
  const v2OutputDir = join(outputDir, "v2");
  const state = {
    connectionFactoryCalls: 0,
    connectionEstablished: false,
    connectionClosed: false,
    transcript: [],
    accountPolicy: null,
    effectiveTransport: null,
    census: null,
  };
  const connectionFactory = makeConnectionFactory({
    realConnectionFactory,
    state,
  });
  const v2Env = {
    ...env,
    ISSUE86_TIDB_PREFLIGHT_EXPECTED_ACCOUNT_DEFINITION_SHA256:
      ACCOUNT_POLICY_SENTINEL_SHA256,
  };

  const v2Final = await runV2({
    outputDir: v2OutputDir,
    env: v2Env,
    connectionFactory,
  });

  const allQueriesExact = transcriptExact(state.transcript);
  const censusReviewed =
    expectedCensus.supplied &&
    state.census !== null &&
    state.census.rowCount === expectedCensus.count &&
    state.census.rowsSha256 === expectedCensus.sha256;

  const blockers = [...(v2Final.blockers ?? [])];
  if (!state.accountPolicy) blockers.push("BLOCKED_TIDB_ACCOUNT_POLICY_UNOBSERVED");
  if (state.effectiveTransport?.effectiveSecureTransport !== true) {
    blockers.push("BLOCKED_TIDB_EFFECTIVE_SECURE_TRANSPORT");
  }
  if (!state.census) blockers.push("BLOCKED_TIDB_CHECK_CENSUS_INCOMPLETE");
  else if (!censusReviewed) blockers.push("BLOCKED_TIDB_CHECK_CENSUS_UNREVIEWED");
  if (!allQueriesExact) blockers.push("BLOCKED_TIDB_V3_EXECUTOR_TRANSCRIPT");
  if (!state.connectionClosed) blockers.push("BLOCKED_TIDB_V3_CONNECTION_CLOSE");
  const uniqueBlockers = [...new Set(blockers)];

  const productionDatabaseWrites =
    v2Final.productionDatabaseWrites === 0 &&
    allQueriesExact &&
    state.connectionClosed &&
    state.effectiveTransport?.effectiveSecureTransport === true
      ? 0
      : null;

  const final = {
    preflightType: "issue86_phase2a_tidb_read_only_v3",
    startedAt,
    completedAt: now(),
    underlyingV2ApplyReadiness: v2Final.applyReadiness,
    applyReadiness:
      uniqueBlockers.length === 0 &&
      v2Final.applyReadiness === "READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION"
        ? "READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION"
        : uniqueBlockers[0] ?? v2Final.applyReadiness,
    applyAuthorized: false,
    migrationAppliedByThisPreflight: false,
    blockers: uniqueBlockers,
    accountPolicyMatched: state.accountPolicy !== null,
    effectiveSecureTransport:
      state.effectiveTransport?.effectiveSecureTransport === true,
    checkConstraintCensusComplete: state.census !== null,
    checkConstraintCensusReviewed: censusReviewed,
    underlyingTranscriptExact: allQueriesExact,
    productionDatabaseWrites,
  };

  const evidence = {
    accountPolicy: {
      source: "SHOW CREATE USER CURRENT_USER()",
      policy: state.accountPolicy,
      effectiveTransport: state.effectiveTransport,
      authenticationMaterialPersisted: false,
      accountDefinitionRawHashRequired: false,
      sentinelSha256: ACCOUNT_POLICY_SENTINEL_SHA256,
    },
    census: {
      observed: state.census,
      expected: expectedCensus,
      reviewed: censusReviewed,
    },
    zeroWrite: {
      connectionFactoryCalls: state.connectionFactoryCalls,
      connectionEstablished: state.connectionEstablished,
      connectionClosed: state.connectionClosed,
      executedStatements: state.transcript,
      executorTranscriptExact: allQueriesExact,
      allStatementsReadOnly: state.transcript.every(
        (row) => row.kind === "READ" && row.method === "query",
      ),
      databaseWritesByPreflightConnection: productionDatabaseWrites,
      globalProductionDatabaseWritesDuringWindow: "not_proven",
      migrationCommandsExecuted: 0,
    },
    final,
  };
  writePack(outputDir, evidence, secrets);
  return final;
}

export function exitCodeForReadiness(applyReadiness) {
  return applyReadiness ===
    "READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION"
    ? 0
    : 2;
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  try {
    const outputDir = parseArgs(argv);
    const final = await runTidbPreflightV3({ outputDir, env });
    process.stdout.write(`${JSON.stringify(final, null, 2)}\n`);
    return exitCodeForReadiness(final.applyReadiness);
  } catch (error) {
    const code = String(error?.message ?? "TIDB_PREFLIGHT_V3_FAILED")
      .split(":")[0]
      .replace(/[^A-Z0-9_]/gi, "_")
      .slice(0, 128);
    process.stderr.write(`tidbPreflightV3Failure=${sanitizeMessage(code)}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  process.exitCode = await main();
}
