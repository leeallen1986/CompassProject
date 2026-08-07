import assert from "node:assert/strict";
import { X509Certificate, createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createConnection } from "mysql2/promise";
import { canonicalHash } from "./issue86-phase2a-preflight-core.mjs";
import {
  exitCodeForReadiness,
  runTidbPreflightV3,
} from "./issue86-phase2a-production-tidb-preflight-v3.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const V3 = join(SCRIPT_DIR, "issue86-phase2a-production-tidb-preflight-v3.mjs");
const V2 = join(SCRIPT_DIR, "issue86-phase2a-production-tidb-preflight-v2.mjs");
const TIDB_CORE = join(SCRIPT_DIR, "issue86-phase2a-tidb-preflight-core.mjs");
const ACCOUNT_POLICY = join(SCRIPT_DIR, "issue86-phase2a-tidb-account-policy.mjs");
const POLICY = join(SCRIPT_DIR, "issue86-phase2a-tidb-preflight-policy.mjs");
const ORIGINAL_CORE = join(SCRIPT_DIR, "issue86-phase2a-preflight-core.mjs");
const URL_POLICY = join(SCRIPT_DIR, "issue86-phase2a-database-url-policy.mjs");
const HOST = "localhost";
const PORT = Number(process.env.ISSUE86_TIDB_PORT ?? "4000");
const DATABASE = "issue86_tidb_preflight_v3_it";
const USER = "issue86_tidb_preflight_v3_ro";
const PASSWORD = "Issue86-TiDB-Preflight-V3-Disposable-2026!";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hashFile = (path) => sha256(readFileSync(path));

function migrationsThrough0090() {
  const root = mkdtempSync(join(tmpdir(), "issue86-tidb-v3-through-0090-"));
  const meta = join(root, "meta");
  mkdirSync(meta, { mode: 0o700 });
  const journal = JSON.parse(
    readFileSync(join(PROJECT_ROOT, "drizzle/meta/_journal.json"), "utf8"),
  );
  journal.entries = journal.entries.filter((entry) => entry.idx <= 90);
  assert.equal(journal.entries.at(-1).idx, 90);
  writeFileSync(join(meta, "_journal.json"), `${JSON.stringify(journal, null, 2)}\n`, {
    mode: 0o600,
  });
  for (const entry of journal.entries) {
    const filename = `${entry.tag}.sql`;
    copyFileSync(join(PROJECT_ROOT, "drizzle", filename), join(root, filename));
  }
  return root;
}

function config({ user, password, database, ca }) {
  return {
    host: HOST,
    port: PORT,
    user,
    password,
    database,
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    timezone: "Z",
    flags: "-LOCAL_FILES",
    ssl: {
      ca,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
  };
}

function wrappedConnectionFactory(ca) {
  return async (incoming) => {
    const connection = await createConnection({
      ...incoming,
      ssl: {
        ...incoming.ssl,
        ca,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      },
    });
    return {
      connection: connection.connection,
      async query(sql, params) {
        const result = await connection.query(sql, params);
        if (String(sql).startsWith("SELECT VERSION() AS versionString")) {
          const [rows, fields] = result;
          for (const row of rows) {
            row.versionString = `${row.versionString}-serverless`;
          }
          return [rows, fields];
        }
        return result;
      },
      async end() {
        return connection.end();
      },
    };
  };
}

async function schemaFingerprint(connection) {
  const queries = [
    "SELECT TABLE_NAME, TABLE_TYPE, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY BINARY TABLE_NAME",
    "SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY BINARY TABLE_NAME, ORDINAL_POSITION",
    "SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART, INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY BINARY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
    "SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY BINARY TABLE_NAME, CONSTRAINT_NAME",
    "SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, ORDINAL_POSITION, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY BINARY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION",
    "SELECT TABLE_NAME, CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.TIDB_CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY BINARY TABLE_NAME, CONSTRAINT_NAME",
    "SELECT CAST(id AS CHAR) AS id, hash, CAST(created_at AS CHAR) AS createdAt FROM __drizzle_migrations ORDER BY created_at, id",
  ];
  const observations = [];
  for (const sql of queries) {
    const [rows] = await connection.query(sql);
    observations.push(rows);
  }
  return canonicalHash(observations);
}

async function accountPins(admin, ca) {
  const [[identity]] = await admin.query(
    "SELECT SHA2(? ,256) AS currentUserSha256, SHA2(CONCAT_WS(CHAR(0), @@server_uuid, ?, @@port, ?), 256) AS targetIdentitySha256",
    [`${USER}@%`, DATABASE, `${USER}@%`],
  );
  const ro = await createConnection(
    config({ user: USER, password: PASSWORD, database: DATABASE, ca }),
  );
  try {
    const [[role]] = await ro.query("SELECT CURRENT_ROLE() AS currentRole");
    const [grantRows] = await ro.query("SHOW GRANTS");
    const grants = grantRows.map((row) => String(Object.values(row)[0]));
    return {
      currentUserSha256: String(identity.currentUserSha256),
      targetIdentitySha256: String(identity.targetIdentitySha256),
      roleSha256: canonicalHash(String(role.currentRole)),
      grantsSha256: canonicalHash([...grants].sort()),
      grantRowCount: grants.length,
    };
  } finally {
    await ro.end();
  }
}

async function runPreflight({ outputDir, env, ca }) {
  const final = await runTidbPreflightV3({
    outputDir,
    env,
    realConnectionFactory: wrappedConnectionFactory(ca),
  });
  return {
    status: exitCodeForReadiness(final.applyReadiness),
    final,
  };
}

const CA_PATH = resolve(process.env.ISSUE86_TIDB_CA_FILE ?? "");
const CERT_PATH = resolve(process.env.ISSUE86_TIDB_SERVER_CERT_FILE ?? "");
const RESULT_ROOT = resolve(process.env.ISSUE86_TIDB_PREFLIGHT_V3_RESULT_DIR ?? "");
const CA = readFileSync(CA_PATH, "utf8");

async function main() {
  mkdirSync(RESULT_ROOT, { mode: 0o700 });
  chmodSync(RESULT_ROOT, 0o700);
  const serverCertificate = new X509Certificate(readFileSync(CERT_PATH));
  const peerSha256 = serverCertificate.fingerprint256.replaceAll(":", "").toLowerCase();
  const root = await createConnection(
    config({ user: "root", password: "", database: "test", ca: CA }),
  );
  const folder = migrationsThrough0090();
  try {
    await root.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
    await root.query(`CREATE DATABASE \`${DATABASE}\``);
    await root.changeUser({ database: DATABASE });
    await root.query("SET GLOBAL tidb_enable_check_constraint = ON");
    await root.query("SET GLOBAL require_secure_transport = ON");
    await migrate(drizzle(root), { migrationsFolder: folder });
    await root.query(`DROP USER IF EXISTS '${USER}'@'%'`);
    await root.query(
      `CREATE USER '${USER}'@'%' IDENTIFIED BY '${PASSWORD}' REQUIRE NONE`,
    );
    await root.query(`GRANT SELECT ON \`${DATABASE}\`.* TO '${USER}'@'%'`);
    const trust = await accountPins(root, CA);
    const databaseUrl = `mysql://${encodeURIComponent(USER)}:${encodeURIComponent(PASSWORD)}@${HOST}:${PORT}/${DATABASE}?ssl=ignored`;
    const baseEnv = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_V3_SHA256: hashFile(V3),
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_ACCOUNT_POLICY_SHA256: hashFile(ACCOUNT_POLICY),
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_TOOL_SHA256: hashFile(V2),
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_TIDB_CORE_SHA256: hashFile(TIDB_CORE),
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_POLICY_SHA256: hashFile(POLICY),
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_ORIGINAL_CORE_SHA256: hashFile(ORIGINAL_CORE),
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_URL_POLICY_SHA256: hashFile(URL_POLICY),
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_PEER_CERT_SHA256: peerSha256,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_DB_IDENTITY_SHA256: trust.targetIdentitySha256,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_DB_ACCOUNT_SHA256: trust.currentUserSha256,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_ROLE_SHA256: trust.roleSha256,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_GRANTS_SHA256: trust.grantsSha256,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_GRANT_ROW_COUNT: String(trust.grantRowCount),
    };
    const before = await schemaFingerprint(root);

    const censusOutput = join(RESULT_ROOT, "census-unreviewed");
    const censusRun = await runPreflight({
      outputDir: censusOutput,
      env: baseEnv,
      ca: CA,
    });
    assert.equal(censusRun.status, 2);
    assert.equal(
      censusRun.final.applyReadiness,
      "BLOCKED_TIDB_CHECK_CENSUS_UNREVIEWED",
      JSON.stringify(censusRun.final),
    );
    const census = JSON.parse(
      readFileSync(
        join(censusOutput, "issue86-phase2a-tidb-preflight-v3-check-census.json"),
        "utf8",
      ),
    );
    assert.equal(census.observed.rawConstraintNamesStored, false);
    assert.equal(census.observed.rawCheckClausesStored, false);

    const reviewedEnv = {
      ...baseEnv,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_CHECK_CENSUS_COUNT:
        census.observed.rowCount,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_CHECK_CENSUS_SHA256:
        census.observed.rowsSha256,
    };
    const readyOutput = join(RESULT_ROOT, "ready");
    const readyRun = await runPreflight({
      outputDir: readyOutput,
      env: reviewedEnv,
      ca: CA,
    });
    assert.equal(readyRun.status, 0);
    assert.equal(
      readyRun.final.applyReadiness,
      "READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION",
      JSON.stringify(readyRun.final),
    );
    assert.equal(readyRun.final.productionDatabaseWrites, 0);
    assert.equal(readyRun.final.effectiveSecureTransport, true);
    assert.equal(readyRun.final.checkConstraintCensusReviewed, true);
    assert.equal(await schemaFingerprint(root), before);

    await root.query("SET GLOBAL tidb_enable_check_constraint = OFF");
    const blockedOutput = join(RESULT_ROOT, "checks-off");
    const blockedRun = await runPreflight({
      outputDir: blockedOutput,
      env: reviewedEnv,
      ca: CA,
    });
    assert.equal(blockedRun.status, 2);
    assert.equal(
      blockedRun.final.applyReadiness,
      "BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED",
      JSON.stringify(blockedRun.final),
    );
    assert.equal(blockedRun.final.productionDatabaseWrites, 0);
    assert.equal(await schemaFingerprint(root), before);

    process.stdout.write(
      `${JSON.stringify(
        {
          integrationType: "issue86_phase2a_tidb_preflight_v3",
          version: "8.0.11-TiDB-v8.5.3",
          productionVersionProfileSimulatedBySuffixOnly: true,
          unreviewedExitCode: censusRun.status,
          unreviewedApplyReadiness: censusRun.final.applyReadiness,
          readyExitCode: readyRun.status,
          readyApplyReadiness: readyRun.final.applyReadiness,
          disabledExitCode: blockedRun.status,
          disabledApplyReadiness: blockedRun.final.applyReadiness,
          schemaFingerprintBeforeAfterMatched: true,
          effectiveSecureTransportViaClusterPolicy: true,
          authenticationMaterialExcludedFromPolicyPin: true,
          databaseWritesByPreflight: 0,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await root.query("SET GLOBAL tidb_enable_check_constraint = OFF");
    await root.query("SET GLOBAL require_secure_transport = OFF");
    await root.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
    await root.query(`DROP USER IF EXISTS '${USER}'@'%'`);
    await root.end();
    rmSync(folder, { recursive: true, force: true });
  }
}

await main();
