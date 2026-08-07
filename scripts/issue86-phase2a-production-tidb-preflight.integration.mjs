import assert from "node:assert/strict";
import { X509Certificate, createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createConnection } from "mysql2/promise";
import { canonicalHash } from "./issue86-phase2a-preflight-core.mjs";
import { runTidbPreflightV2 } from "./issue86-phase2a-production-tidb-preflight-v2.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const TOOL = join(SCRIPT_DIR, "issue86-phase2a-production-tidb-preflight-v2.mjs");
const TIDB_CORE = join(SCRIPT_DIR, "issue86-phase2a-tidb-preflight-core.mjs");
const POLICY = join(SCRIPT_DIR, "issue86-phase2a-tidb-preflight-policy.mjs");
const ORIGINAL_CORE = join(SCRIPT_DIR, "issue86-phase2a-preflight-core.mjs");
const URL_POLICY = join(SCRIPT_DIR, "issue86-phase2a-database-url-policy.mjs");
const HOST = "127.0.0.1";
const PORT = Number(process.env.ISSUE86_TIDB_PORT ?? "4000");
const DATABASE = "issue86_tidb_preflight_it";
const USER = "issue86_tidb_preflight_ro";
const PASSWORD = "Issue86-TiDB-Preflight-Disposable-2026!";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashFile(path) {
  return sha256(readFileSync(path));
}

function migrationsThrough0090() {
  const root = mkdtempSync(join(tmpdir(), "issue86-tidb-through-0090-"));
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

async function accountPins(admin) {
  const [[identity]] = await admin.query(
    "SELECT SHA2(? ,256) AS currentUserSha256, SHA2(CONCAT_WS(CHAR(0), @@server_uuid, ?, @@port, ?), 256) AS targetIdentitySha256",
    [`${USER}@%`, DATABASE, `${USER}@%`],
  );
  const ro = await createConnection(
    config({ user: USER, password: PASSWORD, database: DATABASE, ca: CA }),
  );
  try {
    const [[role]] = await ro.query("SELECT CURRENT_ROLE() AS currentRole");
    const [grantRows] = await ro.query("SHOW GRANTS");
    const [createRows] = await ro.query("SHOW CREATE USER CURRENT_USER()");
    const grants = grantRows.map((row) => String(Object.values(row)[0]));
    const create = createRows.map((row) => String(Object.values(row)[0]));
    assert.equal(create.length, 1);
    return {
      currentUserSha256: String(identity.currentUserSha256),
      targetIdentitySha256: String(identity.targetIdentitySha256),
      roleSha256: canonicalHash(String(role.currentRole)),
      grantsSha256: canonicalHash([...grants].sort()),
      accountDefinitionSha256: canonicalHash(create[0]),
      grantRowCount: grants.length,
    };
  } finally {
    await ro.end();
  }
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
      async query(sql) {
        const result = await connection.query(sql);
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

function verifyEvidence(outputDir, expectedReadiness) {
  const files = readdirSync(outputDir).sort();
  assert.deepEqual(files, [
    "issue86-phase2a-tidb-preflight-COMPLETE.json",
    "issue86-phase2a-tidb-preflight-engine.json",
    "issue86-phase2a-tidb-preflight-final.json",
    "issue86-phase2a-tidb-preflight-journal.json",
    "issue86-phase2a-tidb-preflight-schema.json",
    "issue86-phase2a-tidb-preflight-sha256.json",
    "issue86-phase2a-tidb-preflight-source.json",
    "issue86-phase2a-tidb-preflight-zero-write.json",
  ]);
  assert.equal(statSync(outputDir).mode & 0o077, 0);
  const final = JSON.parse(
    readFileSync(join(outputDir, "issue86-phase2a-tidb-preflight-final.json"), "utf8"),
  );
  assert.equal(final.applyReadiness, expectedReadiness);
  assert.equal(final.applyAuthorized, false);
  assert.equal(final.migrationAppliedByThisPreflight, false);
  const zeroWrite = JSON.parse(
    readFileSync(join(outputDir, "issue86-phase2a-tidb-preflight-zero-write.json"), "utf8"),
  );
  assert.equal(zeroWrite.connectionAttempts, 1);
  assert.equal(zeroWrite.connectionsEstablished, 1);
  assert.equal(zeroWrite.connectionClosed, true);
  assert.equal(zeroWrite.databaseWritesByPreflightConnection, 0);
  assert.equal(zeroWrite.executedStatements.every((row) => row.kind === "READ"), true);
  return { final, zeroWrite };
}

const CA_PATH = resolve(process.env.ISSUE86_TIDB_CA_FILE ?? "");
const CERT_PATH = resolve(process.env.ISSUE86_TIDB_SERVER_CERT_FILE ?? "");
const RESULT_ROOT = resolve(process.env.ISSUE86_TIDB_PREFLIGHT_RESULT_DIR ?? "");
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
    await migrate(drizzle(root), { migrationsFolder: folder });
    const [[journal]] = await root.query(
      "SELECT hash, CAST(created_at AS CHAR) AS createdAt FROM __drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1",
    );
    assert.deepEqual(journal, {
      hash: "8bd973622561a0ebb3b3a6a6f649ccedeaa8b95b19ba23cdac458e49c80e90b2",
      createdAt: "1784077724863",
    });
    await root.query(`DROP USER IF EXISTS '${USER}'@'%'`);
    await root.query(
      `CREATE USER '${USER}'@'%' IDENTIFIED BY '${PASSWORD}' REQUIRE SSL`,
    );
    await root.query(`GRANT SELECT ON \`${DATABASE}\`.* TO '${USER}'@'%'`);
    const trust = await accountPins(root);
    const baseEnv = {
      DATABASE_URL: `mysql://${encodeURIComponent(USER)}:${encodeURIComponent(PASSWORD)}@${HOST}:${PORT}/${DATABASE}?ssl=ignored`,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_TOOL_SHA256: hashFile(TOOL),
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_TIDB_CORE_SHA256: hashFile(TIDB_CORE),
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_POLICY_SHA256: hashFile(POLICY),
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_ORIGINAL_CORE_SHA256: hashFile(ORIGINAL_CORE),
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_URL_POLICY_SHA256: hashFile(URL_POLICY),
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_PEER_CERT_SHA256: peerSha256,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_DB_IDENTITY_SHA256:
        trust.targetIdentitySha256,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_DB_ACCOUNT_SHA256:
        trust.currentUserSha256,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_ROLE_SHA256: trust.roleSha256,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_GRANTS_SHA256: trust.grantsSha256,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_ACCOUNT_DEFINITION_SHA256:
        trust.accountDefinitionSha256,
      ISSUE86_TIDB_PREFLIGHT_EXPECTED_GRANT_ROW_COUNT: String(trust.grantRowCount),
    };
    const before = await schemaFingerprint(root);
    const readyOutput = join(RESULT_ROOT, "ready");
    const ready = await runTidbPreflightV2({
      outputDir: readyOutput,
      env: baseEnv,
      connectionFactory: wrappedConnectionFactory(CA),
    });
    assert.equal(
      ready.applyReadiness,
      "READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION",
      JSON.stringify(ready),
    );
    verifyEvidence(readyOutput, "READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION");
    assert.equal(await schemaFingerprint(root), before);

    await root.query("SET GLOBAL tidb_enable_check_constraint = OFF");
    const blockedOutput = join(RESULT_ROOT, "checks-off");
    const blocked = await runTidbPreflightV2({
      outputDir: blockedOutput,
      env: baseEnv,
      connectionFactory: wrappedConnectionFactory(CA),
    });
    assert.equal(
      blocked.applyReadiness,
      "BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED",
      JSON.stringify(blocked),
    );
    verifyEvidence(blockedOutput, "BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED");
    assert.equal(await schemaFingerprint(root), before);

    process.stdout.write(
      `${JSON.stringify(
        {
          integrationType: "issue86_phase2a_tidb_preflight",
          version: "8.0.11-TiDB-v8.5.3",
          readyApplyReadiness: ready.applyReadiness,
          disabledApplyReadiness: blocked.applyReadiness,
          schemaFingerprintBeforeAfterMatched: true,
          connectionMode: "certificate_authorized_tls",
          databaseWritesByPreflight: 0,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await root.query("SET GLOBAL tidb_enable_check_constraint = OFF");
    await root.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
    await root.query(`DROP USER IF EXISTS '${USER}'@'%'`);
    await root.end();
    rmSync(folder, { recursive: true, force: true });
  }
}

await main();
