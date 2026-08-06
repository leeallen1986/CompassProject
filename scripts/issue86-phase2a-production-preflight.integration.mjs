import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
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
import { SQL_STATEMENTS, canonicalJson } from "./issue86-phase2a-preflight-core.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const TOOL_PATH = join(SCRIPT_DIR, "issue86-phase2a-production-preflight.mjs");
const CORE_PATH = join(SCRIPT_DIR, "issue86-phase2a-preflight-core.mjs");
const USER = "issue86_preflight_ro";
const DATABASE = "issue86_preflight_it";
const PASSWORD = "Issue86-Disposable-Only-2026!";
const HOST = "127.0.0.1";
const PORT = 3307;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashFile(path) {
  return sha256(readFileSync(path));
}

function sortDeep(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortDeep);
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortDeep(value[key])]),
  );
}

function canonicalHash(value) {
  return sha256(Buffer.from(JSON.stringify(sortDeep(value)), "utf8"));
}

function requireRegularFile(path, label) {
  const stat = lstatSync(path);
  assert.equal(stat.isFile(), true, label + " must be a file");
  assert.equal(stat.isSymbolicLink(), false, label + " must not be a symlink");
}

function makeMigrationsThrough0090() {
  const root = mkdtempSync(join(tmpdir(), "issue86-through-0090-"));
  const meta = join(root, "meta");
  mkdirSync(meta, { mode: 0o700 });
  const journalPath = join(PROJECT_ROOT, "drizzle/meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.filter((entry) => entry.idx <= 90);
  assert.equal(journal.entries.at(-1).idx, 90);
  writeFileSync(join(meta, "_journal.json"), JSON.stringify(journal, null, 2) + "\n", {
    mode: 0o600,
  });
  for (const entry of journal.entries) {
    const filename = String(entry.tag) + ".sql";
    copyFileSync(join(PROJECT_ROOT, "drizzle", filename), join(root, filename));
  }
  return root;
}

function connectionConfig(ca, user, password, database) {
  return {
    host: HOST,
    port: PORT,
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
      ca,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
  };
}

async function schemaFingerprint(connection) {
  const statements = [
    "SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY BINARY TABLE_NAME",
    "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, ORDINAL_POSITION AS ordinalPosition, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY BINARY TABLE_NAME, ORDINAL_POSITION",
    "SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seqInIndex, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY BINARY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
    "SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, CONSTRAINT_TYPE AS constraintType, ENFORCED AS enforced FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY BINARY TABLE_NAME, CONSTRAINT_NAME",
    "SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, COLUMN_NAME AS columnName, ORDINAL_POSITION AS ordinalPosition, REFERENCED_TABLE_NAME AS referencedTableName, REFERENCED_COLUMN_NAME AS referencedColumnName FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY BINARY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION",
    "SELECT tc.TABLE_NAME AS tableName, tc.CONSTRAINT_NAME AS constraintName, tc.ENFORCED AS enforced, cc.CHECK_CLAUSE AS checkClause FROM information_schema.TABLE_CONSTRAINTS tc INNER JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA = DATABASE() ORDER BY BINARY tc.TABLE_NAME, tc.CONSTRAINT_NAME",
    "SELECT CAST(id AS CHAR) AS id, hash, CAST(created_at AS CHAR) AS createdAt FROM __drizzle_migrations ORDER BY created_at, id",
  ];
  const observations = [];
  for (const sql of statements) {
    const [rows] = await connection.query(sql);
    observations.push(rows);
  }
  return canonicalHash(observations);
}

function runChild(path, args, env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [path, ...args], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectRun);
    child.once("close", (code, signal) => {
      resolveRun({ code, signal, stdout, stderr });
    });
  });
}

function evidenceFiles(outputDir) {
  return readdirSync(outputDir).sort();
}

function verifyEvidence(outputDir, forbiddenValues) {
  const files = evidenceFiles(outputDir);
  assert.deepEqual(files, [
    "issue86-phase2a-preflight-COMPLETE.json",
    "issue86-phase2a-preflight-engine-capability.json",
    "issue86-phase2a-preflight-final.json",
    "issue86-phase2a-preflight-migration-journal.json",
    "issue86-phase2a-preflight-schema-footprint.json",
    "issue86-phase2a-preflight-sha256.json",
    "issue86-phase2a-preflight-source-attestation.json",
    "issue86-phase2a-preflight-zero-write.json",
  ]);
  assert.equal(statSync(outputDir).mode & 0o077, 0);
  for (const filename of files) {
    const path = join(outputDir, filename);
    assert.equal(statSync(path).mode & 0o077, 0);
    const text = readFileSync(path, "utf8");
    for (const forbidden of forbiddenValues) {
      assert.equal(text.includes(forbidden), false, "secret leaked in " + filename);
    }
  }
  const indexPath = join(outputDir, "issue86-phase2a-preflight-sha256.json");
  const indexBytes = readFileSync(indexPath);
  const index = JSON.parse(indexBytes.toString("utf8"));
  assert.equal(Object.keys(index).length, 6);
  assert.equal("issue86-phase2a-preflight-sha256.json" in index, false);
  assert.equal("issue86-phase2a-preflight-COMPLETE.json" in index, false);
  for (const [filename, expected] of Object.entries(index)) {
    assert.equal(filename.includes("/"), false);
    const bytes = readFileSync(join(outputDir, filename));
    assert.equal(bytes.length, expected.byteSize);
    assert.equal(sha256(bytes), expected.sha256);
  }
  const completion = JSON.parse(
    readFileSync(join(outputDir, "issue86-phase2a-preflight-COMPLETE.json"), "utf8"),
  );
  assert.equal(completion.status, "COMPLETE");
  assert.equal(completion.indexSha256, sha256(indexBytes));
  const final = JSON.parse(
    readFileSync(join(outputDir, "issue86-phase2a-preflight-final.json"), "utf8"),
  );
  assert.equal(final.applyReadiness, "READY_FOR_SEPARATE_APPLY_AUTHORIZATION");
  assert.equal(final.applyAuthorized, false);
  assert.equal(final.migrationAppliedByThisPreflight, false);
  assert.deepEqual(final.blockers, []);
  const zeroWrite = JSON.parse(
    readFileSync(join(outputDir, "issue86-phase2a-preflight-zero-write.json"), "utf8"),
  );
  assert.equal(zeroWrite.zeroWriteConfirmed, true);
  assert.equal(zeroWrite.databaseWritesByPreflightConnection, 0);
  assert.equal(zeroWrite.connectionAttempts, 1);
  assert.equal(zeroWrite.connectionsEstablished, 1);
  assert.equal(new Set(zeroWrite.connectionIds).size, 1);
  assert.equal(
    Object.values(zeroWrite.mutationCounterDeltas).every((value) => value === "0"),
    true,
  );
  const expectedSql = zeroWrite.executedStatements.map(
    (entry) => SQL_STATEMENTS[entry.statementId].sql,
  );
  return { final, zeroWrite, expectedSql, index };
}

async function main() {
  const caPath = resolve(process.env.ISSUE86_PREFLIGHT_IT_CA_FILE || "");
  const serverCertPath = resolve(
    process.env.ISSUE86_PREFLIGHT_IT_SERVER_CERT_FILE || "",
  );
  const resultRoot = resolve(process.env.ISSUE86_PREFLIGHT_IT_RESULT_DIR || "");
  const rootPassword = process.env.ISSUE86_PREFLIGHT_IT_ROOT_PASSWORD;
  if (!rootPassword || !resultRoot) throw new Error("integration environment missing");
  requireRegularFile(caPath, "CA");
  requireRegularFile(serverCertPath, "server certificate");
  mkdirSync(resultRoot, { mode: 0o700 });
  chmodSync(resultRoot, 0o700);
  const outputDir = join(resultRoot, "evidence");
  const migrationsFolder = makeMigrationsThrough0090();
  const ca = readFileSync(caPath, "utf8");
  const serverCertificate = new X509Certificate(readFileSync(serverCertPath));
  const peerFingerprintSha256 = serverCertificate.fingerprint256
    .replaceAll(":", "")
    .toLowerCase();
  let admin;
  try {
    admin = await createConnection(
      connectionConfig(ca, "root", rootPassword, DATABASE),
    );
    await migrate(drizzle(admin), { migrationsFolder });

    const [journalRows] = await admin.query(
      "SELECT hash, CAST(created_at AS CHAR) AS createdAt FROM __drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1",
    );
    assert.deepEqual(journalRows, [
      {
        hash: "8bd973622561a0ebb3b3a6a6f649ccedeaa8b95b19ba23cdac458e49c80e90b2",
        createdAt: "1784077724863",
      },
    ]);
    const [phaseTables] = await admin.query(
      "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) IN ('projectevidencesources','projectevidenceclaims','projectevidenceclaimsources','projectevidenceevents')",
    );
    assert.equal(phaseTables.length, 0);

    await admin.query("DROP USER IF EXISTS '" + USER + "'@'%'");
    await admin.query(
      "CREATE USER '" + USER + "'@'%' IDENTIFIED BY '" + PASSWORD + "' REQUIRE SSL",
    );
    await admin.query("GRANT SELECT ON " + DATABASE + ".* TO '" + USER + "'@'%'");

    const [trustRows] = await admin.query(
      "SELECT VERSION() AS versionString, SHA2('" +
        USER +
        "@%', 256) AS accountSha256, SHA2(CONCAT_WS(CHAR(0), @@server_uuid, '" +
        DATABASE +
        "', @@port, '" +
        USER +
        "@%'), 256) AS identitySha256",
    );
    assert.equal(trustRows.length, 1);
    assert.match(String(trustRows[0].versionString), /^8\.4\.[0-9]+$/);

    const beforeFingerprint = await schemaFingerprint(admin);
    await admin.query("SET GLOBAL general_log = OFF");
    await admin.query("TRUNCATE TABLE mysql.general_log");
    await admin.query("SET GLOBAL general_log = ON");

    const toolSha256 = hashFile(TOOL_PATH);
    const coreSha256 = hashFile(CORE_PATH);
    const databaseUrl =
      "mysql://" +
      encodeURIComponent(USER) +
      ":" +
      encodeURIComponent(PASSWORD) +
      "@" +
      HOST +
      ":" +
      PORT +
      "/" +
      DATABASE;
    const childEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_PATH: process.env.NODE_PATH,
      DATABASE_URL: databaseUrl,
      ISSUE86_PREFLIGHT_CA_FILE: caPath,
      ISSUE86_PREFLIGHT_EXPECTED_CA_SHA256: hashFile(caPath),
      ISSUE86_PREFLIGHT_EXPECTED_PEER_CERT_SHA256: peerFingerprintSha256,
      ISSUE86_PREFLIGHT_EXPECTED_NODE_VERSION: process.version,
      ISSUE86_PREFLIGHT_EXPECTED_TOOL_SHA256: toolSha256,
      ISSUE86_PREFLIGHT_EXPECTED_CORE_SHA256: coreSha256,
      ISSUE86_PREFLIGHT_EXPECTED_DB_IDENTITY_SHA256:
        trustRows[0].identitySha256,
      ISSUE86_PREFLIGHT_EXPECTED_DB_ACCOUNT_SHA256:
        trustRows[0].accountSha256,
      ISSUE86_PREFLIGHT_EXPECTED_MYSQL_VERSION:
        trustRows[0].versionString,
    };
    const child = await runChild(
      TOOL_PATH,
      ["--output-dir", outputDir],
      childEnv,
    );
    process.stdout.write(child.stdout);
    process.stderr.write(child.stderr);
    assert.equal(child.signal, null);
    assert.equal(child.code, 0);

    await admin.query("SET GLOBAL general_log = OFF");
    const afterFingerprint = await schemaFingerprint(admin);
    assert.equal(afterFingerprint, beforeFingerprint);

    const verified = verifyEvidence(outputDir, [
      PASSWORD,
      rootPassword,
      ca,
      databaseUrl,
      USER,
      DATABASE,
    ]);

    const [logRows] = await admin.query(
      "SELECT user_host AS userHost, thread_id AS threadId, command_type AS commandType, argument FROM mysql.general_log ORDER BY event_time, thread_id",
    );
    const candidateThreads = new Set(
      logRows
        .filter(
          (row) =>
            String(row.userHost).includes(USER) ||
            String(row.argument).includes(USER + "@"),
        )
        .map((row) => String(row.threadId)),
    );
    assert.equal(candidateThreads.size, 1);
    const threadId = [...candidateThreads][0];
    const preflightRows = logRows.filter(
      (row) => String(row.threadId) === threadId,
    );
    const queryArguments = preflightRows
      .filter((row) => row.commandType === "Query")
      .map((row) => String(row.argument));
    assert.deepEqual(queryArguments, verified.expectedSql);
    assert.equal(
      queryArguments.every((sql) =>
        /^(?:SELECT|SHOW|SET SESSION|START TRANSACTION|ROLLBACK)\b/i.test(sql),
      ),
      true,
    );

    const mysql2Version = JSON.parse(
      readFileSync(join(PROJECT_ROOT, "node_modules/mysql2/package.json"), "utf8"),
    ).version;
    const summary = {
      status: "PASS",
      mysqlImageDigest: process.env.ISSUE86_PREFLIGHT_IT_MYSQL_IMAGE_DIGEST,
      mysqlVersion: trustRows[0].versionString,
      nodeVersion: process.version,
      mysql2Version,
      toolSha256,
      coreSha256,
      caSha256: hashFile(caPath),
      peerCertificateSha256: peerFingerprintSha256,
      schemaFingerprintBefore: beforeFingerprint,
      schemaFingerprintAfter: afterFingerprint,
      preflightConnectionCount: candidateThreads.size,
      preflightQueryCount: queryArguments.length,
      executedStatementIds: verified.zeroWrite.executedStatements.map(
        (entry) => entry.statementId,
      ),
      evidenceIndexSha256: hashFile(
        join(outputDir, "issue86-phase2a-preflight-sha256.json"),
      ),
      applyAuthorized: false,
      migrationAppliedByPreflight: false,
      productionConnectionUsed: false,
    };
    writeFileSync(
      join(resultRoot, "issue86-phase2a-integration-summary.json"),
      canonicalJson(summary),
      { mode: 0o600 },
    );
  } finally {
    if (admin) {
      try {
        await admin.query("SET GLOBAL general_log = OFF");
      } catch {}
      try {
        await admin.end();
      } catch {}
    }
    rmSync(migrationsFolder, { recursive: true, force: true });
  }
}

await main();
