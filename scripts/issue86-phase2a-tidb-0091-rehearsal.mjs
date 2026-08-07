#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createConnection } from "mysql2/promise";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "drizzle/0091_issue86_buyer_route_evidence.sql",
);
const EXPECTED_MIGRATION_SHA256 =
  "d6b76795819387a012768978403156b3b1b7f70fd129cbfe1484d052bf7346c4";
const EXPECTED_VERSION = "8.0.11-TiDB-v8.5.3";
const TABLES = Object.freeze([
  "projectEvidenceClaimSources",
  "projectEvidenceClaims",
  "projectEvidenceEvents",
  "projectEvidenceSources",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function splitMigration(sql) {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.equal(statements.length, 29, "unexpected 0091 statement count");
  assert.equal(
    statements.filter((statement) => /^CREATE TABLE /i.test(statement)).length,
    4,
  );
  assert.equal(
    statements.filter((statement) => /^CREATE (?:UNIQUE )?INDEX /i.test(statement))
      .length,
    18,
  );
  assert.equal(
    statements.filter((statement) => /^ALTER TABLE /i.test(statement)).length,
    7,
  );
  return statements;
}

async function connect(database) {
  return createConnection({
    host: "127.0.0.1",
    port: Number(process.env.ISSUE86_TIDB_PORT ?? "4000"),
    user: "root",
    password: "",
    database,
    multipleStatements: false,
    namedPlaceholders: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    timezone: "Z",
    flags: "-LOCAL_FILES",
  });
}

async function applyMigration(connection, statements) {
  for (let index = 0; index < statements.length; index += 1) {
    try {
      await connection.query(statements[index]);
    } catch (error) {
      const code = String(error?.code ?? "UNKNOWN");
      const message = String(error?.message ?? "migration statement failed")
        .replace(/[\r\n]+/g, " ")
        .slice(0, 500);
      throw new Error(`0091_STATEMENT_${index + 1}_FAILED:${code}:${message}`);
    }
  }
}

async function metadata(connection, database) {
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME AS tableName
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME IN (?,?,?,?)
      ORDER BY TABLE_NAME`,
    [database, ...TABLES],
  );
  const [checkRows] = await connection.query(
    `SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName,
            CHECK_CLAUSE AS checkClause
       FROM information_schema.TIDB_CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ?
        AND TABLE_NAME IN (?,?,?,?)
      ORDER BY TABLE_NAME, CONSTRAINT_NAME`,
    [database, ...TABLES],
  );
  const [foreignKeyRows] = await connection.query(
    `SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName,
            REFERENCED_TABLE_NAME AS referencedTableName,
            UPDATE_RULE AS updateRule, DELETE_RULE AS deleteRule
       FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ?
        AND TABLE_NAME IN (?,?,?,?)
      ORDER BY TABLE_NAME, CONSTRAINT_NAME`,
    [database, ...TABLES],
  );
  const [indexRows] = await connection.query(
    `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName,
            NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seqInIndex,
            COLUMN_NAME AS columnName
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME IN (?,?,?,?)
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [database, ...TABLES],
  );
  return {
    tables: tableRows,
    checks: checkRows,
    foreignKeys: foreignKeyRows,
    indexes: indexRows,
  };
}

async function expectCheckRejected(connection, keyPrefix) {
  try {
    await connection.query(
      `INSERT INTO projectEvidenceSources
        (sourceKey, openDedupeKey, projectId, sourceType, sourceName,
         sourceReference, documentTitle, retrievedAt, lastCheckedAt,
         revision, capturedBy)
       VALUES (?, ?, 1, 'official_project_site', 'source', 'ref', 'doc',
               NOW(), NOW(), 0, 1)`,
      [`${keyPrefix}-source`, `${keyPrefix}-open`],
    );
    return { rejected: false, code: null };
  } catch (error) {
    return { rejected: true, code: String(error?.code ?? "UNKNOWN") };
  }
}

async function expectForeignKeyRejected(connection, keyPrefix) {
  try {
    await connection.query(
      `INSERT INTO projectEvidenceClaimSources
        (linkKey, projectId, claimId, sourceId, supportScope, stance,
         supportStrength, isPrimary, evidenceSummary, createdBy)
       VALUES (?, 1, 999999, 999999, 'identity_only', 'context_only',
               'context_only', false, 'invalid foreign key probe', 1)`,
      [`${keyPrefix}-binding`],
    );
    return { rejected: false, code: null };
  } catch (error) {
    return { rejected: true, code: String(error?.code ?? "UNKNOWN") };
  }
}

async function runDatabase({ root, database, checkConstraintsEnabled }) {
  await root.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await root.query(`CREATE DATABASE \`${database}\``);
  await root.query(
    `SET GLOBAL tidb_enable_check_constraint = ${checkConstraintsEnabled ? "ON" : "OFF"}`,
  );
  const [[capability]] = await root.query(
    `SELECT @@global.tidb_enable_check_constraint AS checkConstraintsEnabled,
            @@global.tidb_enable_foreign_key AS foreignKeyFeatureEnabled,
            @@global.foreign_key_checks AS globalForeignKeyChecks`,
  );

  const connection = await connect(database);
  try {
    const sql = readFileSync(MIGRATION_PATH);
    assert.equal(sha256(sql), EXPECTED_MIGRATION_SHA256);
    const statements = splitMigration(sql.toString("utf8"));
    await applyMigration(connection, statements);
    const observed = await metadata(connection, database);
    const checkProbe = await expectCheckRejected(connection, database);
    const foreignKeyProbe = await expectForeignKeyRejected(connection, database);
    return {
      database,
      requestedCheckConstraintState: checkConstraintsEnabled,
      capability: Object.fromEntries(
        Object.entries(capability).map(([key, value]) => [key, String(value)]),
      ),
      tableCount: observed.tables.length,
      checkConstraintCount: observed.checks.length,
      foreignKeyCount: observed.foreignKeys.length,
      indexRowCount: observed.indexes.length,
      metadataSha256: sha256(Buffer.from(JSON.stringify(observed), "utf8")),
      checkProbe,
      foreignKeyProbe,
    };
  } finally {
    await connection.end();
  }
}

async function observeAfterGlobalToggle({ root, database, enabled, label }) {
  await root.query(
    `SET GLOBAL tidb_enable_check_constraint = ${enabled ? "ON" : "OFF"}`,
  );
  const connection = await connect(database);
  try {
    const observed = await metadata(connection, database);
    return {
      globalCheckConstraintState: enabled ? "ON" : "OFF",
      tableCount: observed.tables.length,
      checkConstraintCount: observed.checks.length,
      foreignKeyCount: observed.foreignKeys.length,
      checkProbe: await expectCheckRejected(connection, label),
      foreignKeyProbe: await expectForeignKeyRejected(connection, label),
    };
  } finally {
    await connection.end();
  }
}

async function main() {
  const root = await connect(undefined);
  const result = {
    rehearsalType: "issue86_phase2a_tidb_0091",
    migrationSha256: EXPECTED_MIGRATION_SHA256,
    databaseWrites: "disposable_ci_only",
  };
  try {
    const [[identity]] = await root.query(
      "SELECT VERSION() AS versionString, @@version_comment AS versionComment",
    );
    result.versionString = String(identity.versionString ?? "");
    result.versionComment = String(identity.versionComment ?? "");
    assert.ok(
      result.versionString.startsWith(EXPECTED_VERSION),
      `unexpected TiDB version: ${result.versionString}`,
    );
    result.enabled = await runDatabase({
      root,
      database: "issue86_tidb_checks_on",
      checkConstraintsEnabled: true,
    });
    result.disabled = await runDatabase({
      root,
      database: "issue86_tidb_checks_off",
      checkConstraintsEnabled: false,
    });
    result.globalToggle = {
      createdWhileOnObservedAfterGlobalOff: await observeAfterGlobalToggle({
        root,
        database: "issue86_tidb_checks_on",
        enabled: false,
        label: "created-on-global-off",
      }),
      createdWhileOffObservedAfterGlobalOn: await observeAfterGlobalToggle({
        root,
        database: "issue86_tidb_checks_off",
        enabled: true,
        label: "created-off-global-on",
      }),
    };

    assert.equal(result.enabled.tableCount, 4);
    assert.equal(result.enabled.checkConstraintCount, 35);
    assert.equal(result.enabled.foreignKeyCount, 7);
    assert.equal(result.enabled.checkProbe.rejected, true);
    assert.equal(result.enabled.foreignKeyProbe.rejected, true);
    assert.equal(result.disabled.tableCount, 4);
    assert.equal(result.disabled.foreignKeyCount, 7);
    assert.equal(result.disabled.checkProbe.rejected, false);
    assert.equal(result.disabled.foreignKeyProbe.rejected, true);
    assert.equal(
      result.globalToggle.createdWhileOnObservedAfterGlobalOff.tableCount,
      4,
    );
    assert.equal(
      result.globalToggle.createdWhileOffObservedAfterGlobalOn.tableCount,
      4,
    );
    assert.equal(
      result.globalToggle.createdWhileOnObservedAfterGlobalOff.foreignKeyCount,
      7,
    );
    assert.equal(
      result.globalToggle.createdWhileOffObservedAfterGlobalOn.foreignKeyCount,
      7,
    );

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await root.query("DROP DATABASE IF EXISTS `issue86_tidb_checks_on`");
    await root.query("DROP DATABASE IF EXISTS `issue86_tidb_checks_off`");
    await root.query("SET GLOBAL tidb_enable_check_constraint = OFF");
    await root.end();
  }
}

await main();
