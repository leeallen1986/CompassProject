#!/usr/bin/env node
import assert from "node:assert/strict";
import { createConnection } from "mysql2/promise";

const DATABASE = "issue86_tidb_check_transition";

async function connect(database) {
  return createConnection({
    host: "127.0.0.1",
    port: Number(process.env.ISSUE86_TIDB_PORT ?? "4000"),
    user: "root",
    password: "",
    database,
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    timezone: "Z",
    flags: "-LOCAL_FILES",
  });
}

async function checkCount(connection, tableName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS rowCount
       FROM information_schema.TIDB_CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ?`,
    [DATABASE, tableName],
  );
  return Number(row.rowCount);
}

async function invalidInsert(connection, tableName, id) {
  try {
    await connection.query(`INSERT INTO \`${tableName}\` (id, value) VALUES (?, -1)`, [id]);
    return { rejected: false, code: null };
  } catch (error) {
    return { rejected: true, code: String(error?.code ?? "UNKNOWN") };
  }
}

async function main() {
  const root = await connect(undefined);
  const result = {
    rehearsalType: "issue86_tidb_check_global_transition",
    databaseWrites: "disposable_ci_only",
    versionString: null,
    transitions: {},
  };

  try {
    const [[identity]] = await root.query("SELECT VERSION() AS versionString");
    result.versionString = String(identity.versionString ?? "");
    assert.ok(result.versionString.startsWith("8.0.11-TiDB-v8.5.3"));

    await root.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
    await root.query(`CREATE DATABASE \`${DATABASE}\``);
    await root.query("SET GLOBAL tidb_enable_check_constraint = ON");

    const connection = await connect(DATABASE);
    try {
      await connection.query(
        "CREATE TABLE created_on (id INT PRIMARY KEY, value INT, CONSTRAINT created_on_value CHECK (value > 0))",
      );
      result.transitions.createdOn = {
        countAfterCreate: await checkCount(connection, "created_on"),
        invalidWhileGlobalOn: await invalidInsert(connection, "created_on", 1),
      };

      await root.query("SET GLOBAL tidb_enable_check_constraint = OFF");
      result.transitions.createdOn.countAfterGlobalOff = await checkCount(
        connection,
        "created_on",
      );
      result.transitions.createdOn.invalidWhileGlobalOff = await invalidInsert(
        connection,
        "created_on",
        2,
      );

      await connection.query(
        "CREATE TABLE created_off (id INT PRIMARY KEY, value INT, CONSTRAINT created_off_value CHECK (value > 0))",
      );
      result.transitions.createdOff = {
        countAfterCreate: await checkCount(connection, "created_off"),
        invalidWhileGlobalOff: await invalidInsert(connection, "created_off", 3),
      };

      await root.query("SET GLOBAL tidb_enable_check_constraint = ON");
      result.transitions.createdOn.countAfterGlobalReenable = await checkCount(
        connection,
        "created_on",
      );
      result.transitions.createdOn.invalidAfterGlobalReenable = await invalidInsert(
        connection,
        "created_on",
        4,
      );
      result.transitions.createdOff.countAfterGlobalReenable = await checkCount(
        connection,
        "created_off",
      );
      result.transitions.createdOff.invalidAfterGlobalReenable = await invalidInsert(
        connection,
        "created_off",
        5,
      );

      assert.equal(result.transitions.createdOn.countAfterCreate, 1);
      assert.equal(result.transitions.createdOn.invalidWhileGlobalOn.rejected, true);
      assert.equal(result.transitions.createdOn.countAfterGlobalOff, 1);
      assert.equal(result.transitions.createdOn.countAfterGlobalReenable, 1);
      assert.equal(
        result.transitions.createdOn.invalidAfterGlobalReenable.rejected,
        true,
      );
      assert.equal(result.transitions.createdOff.countAfterCreate, 0);
      assert.equal(result.transitions.createdOff.invalidWhileGlobalOff.rejected, false);
      assert.equal(result.transitions.createdOff.countAfterGlobalReenable, 0);
      assert.equal(
        result.transitions.createdOff.invalidAfterGlobalReenable.rejected,
        false,
      );
    } finally {
      await connection.end();
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await root.query("SET GLOBAL tidb_enable_check_constraint = OFF");
    await root.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
    await root.end();
  }
}

await main();
