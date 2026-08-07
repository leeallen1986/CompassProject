import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  TIDB_SQL,
  evaluateTidbReadiness,
  validateTidbAccountProfile,
  validateTidbCapabilities,
} from "./issue86-phase2a-tidb-preflight-core.mjs";
import { lintTidbReadOnlySqlManifest } from "./issue86-phase2a-tidb-preflight-policy.mjs";
import { canonicalHash } from "./issue86-phase2a-preflight-core.mjs";

const TABLE_CONSTRAINTS = [
  "CONSTRAINT_CATALOG",
  "CONSTRAINT_SCHEMA",
  "CONSTRAINT_NAME",
  "TABLE_SCHEMA",
  "TABLE_NAME",
  "CONSTRAINT_TYPE",
].map((columnName, index) => ({ columnName, ordinalPosition: index + 1 }));
const CHECK_CONSTRAINTS = [
  "CONSTRAINT_CATALOG",
  "CONSTRAINT_SCHEMA",
  "CONSTRAINT_NAME",
  "CHECK_CLAUSE",
].map((columnName, index) => ({ columnName, ordinalPosition: index + 1 }));
const TIDB_CHECK_CONSTRAINTS = [
  "CONSTRAINT_CATALOG",
  "CONSTRAINT_SCHEMA",
  "CONSTRAINT_NAME",
  "CHECK_CLAUSE",
  "TABLE_NAME",
  "TABLE_ID",
].map((columnName, index) => ({ columnName, ordinalPosition: index + 1 }));

function variables({ checks = "ON", foreignKeyFeature = "ON", foreignKeys = "ON", noop = "OFF" } = {}) {
  return {
    globalVariableRows: [
      { Variable_name: "foreign_key_checks", Value: foreignKeys },
      { Variable_name: "require_secure_transport", Value: "OFF" },
      { Variable_name: "tidb_enable_check_constraint", Value: checks },
      { Variable_name: "tidb_enable_foreign_key", Value: foreignKeyFeature },
      { Variable_name: "tidb_enable_noop_functions", Value: noop },
    ],
    sessionVariableRows: [
      { Variable_name: "foreign_key_checks", Value: foreignKeys },
    ],
    tableConstraintMetadataRows: TABLE_CONSTRAINTS,
    checkConstraintMetadataRows: CHECK_CONSTRAINTS,
    tidbCheckConstraintMetadataRows: TIDB_CHECK_CONSTRAINTS,
  };
}

function readyFacts() {
  return {
    sourceGatePassed: true,
    runtimeProfilePassed: true,
    productionIdentityMatched: true,
    accountIdentityMatched: true,
    tlsVerified: true,
    peerCertificatePinned: true,
    engineExact: true,
    accountProfileMatched: true,
    oneConnectionOnly: true,
    connectionIdConsistent: true,
    capabilitiesObserved: true,
    checkConstraintsEnabled: true,
    foreignKeyFeatureEnabled: true,
    globalForeignKeyChecksEnabled: true,
    sessionForeignKeyChecksEnabled: true,
    noopFunctionsDisabled: true,
    metadataCapabilitiesExact: true,
    journalSchemaExact: true,
    predecessorFootprintExact: true,
    snapshotsEqual: true,
    transcriptExact: true,
    connectionClosed: true,
  };
}

const readyDatabase = {
  databaseStateClassification: "READY_FOR_SEPARATE_APPLY_AUTHORIZATION",
  blocker: null,
};

describe("TiDB fixed SQL boundary", () => {
  test("permits SHOW CREATE USER but rejects no mutating statement", () => {
    const result = lintTidbReadOnlySqlManifest();
    assert.equal(result.passed, true, result.errors.join(","));
    assert.ok(TIDB_SQL.SHOW_CREATE_USER.sql.startsWith("SHOW CREATE USER"));
    assert.equal(
      Object.values(TIDB_SQL).every((statement) =>
        /^(?:SELECT|SHOW)\b/i.test(statement.sql),
      ),
      true,
    );
  });

  test("manifest contains no transaction or migration statement", () => {
    const text = Object.values(TIDB_SQL)
      .map((statement) => statement.sql)
      .join("\n");
    assert.equal(
      /^(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|SET|START|COMMIT|ROLLBACK)\b/im.test(
        text,
      ),
      false,
    );
    assert.equal(text.includes("0091_issue86_buyer_route_evidence.sql"), false);
  });
});

describe("TiDB capability gate", () => {
  test("passes only with CHECK and foreign-key enforcement enabled", () => {
    const result = validateTidbCapabilities(variables());
    assert.equal(result.passed, true);
    assert.equal(result.checksEnabled, true);
    assert.equal(result.foreignKeyFeatureEnabled, true);
    assert.equal(result.globalForeignKeyChecksEnabled, true);
    assert.equal(result.sessionForeignKeyChecksEnabled, true);
    assert.equal(result.noopFunctionsDisabled, true);
    assert.equal(result.requireSecureTransportEnabled, false);
  });

  for (const [label, options, property] of [
    ["CHECK constraints off", { checks: "OFF" }, "checksEnabled"],
    ["foreign-key feature off", { foreignKeyFeature: "OFF" }, "foreignKeyFeatureEnabled"],
    ["foreign-key checks off", { foreignKeys: "OFF" }, "globalForeignKeyChecksEnabled"],
    ["noop functions on", { noop: "ON" }, "noopFunctionsDisabled"],
  ]) {
    test(`blocks when ${label}`, () => {
      const result = validateTidbCapabilities(variables(options));
      assert.equal(result.passed, false);
      assert.equal(result[property], false);
    });
  }

  test("rejects MySQL-style ENFORCED metadata drift", () => {
    const result = validateTidbCapabilities({
      ...variables(),
      tableConstraintMetadataRows: [
        ...TABLE_CONSTRAINTS,
        { columnName: "ENFORCED", ordinalPosition: 7 },
      ],
    });
    assert.equal(result.passed, false);
    assert.equal(result.tableMetadataExact, false);
  });
});

describe("TiDB account evidence", () => {
  const role = "NONE";
  const grants = [
    "GRANT USAGE ON *.* TO `u`@`%`",
    "GRANT SELECT ON `db`.* TO `u`@`%`",
    "GRANT SELECT ON `INFORMATION_SCHEMA`.* TO `u`@`%`",
  ];
  const createUser = "CREATE USER `u`@`%` IDENTIFIED WITH 'mysql_native_password' REQUIRE NONE";
  const expected = {
    expectedRoleSha256: canonicalHash(role),
    expectedGrantSha256: canonicalHash([...grants].sort()),
    expectedAccountDefinitionSha256: canonicalHash(createUser),
    expectedGrantRowCount: 3,
  };

  test("accepts an exact hash-pinned SELECT-only account", () => {
    const result = validateTidbAccountProfile({
      roleRows: [{ currentRole: role }],
      grantRows: grants.map((grant) => ({ Grants: grant })),
      createUserRows: [{ "CREATE USER": createUser }],
      ...expected,
    });
    assert.equal(result.passed, true);
    assert.equal(result.accountRequiresSslOrX509, false);
  });

  test("rejects an added write privilege even when row count is pinned", () => {
    const modified = [grants[0], grants[1].replace("SELECT", "SELECT, INSERT"), grants[2]];
    const result = validateTidbAccountProfile({
      roleRows: [{ currentRole: role }],
      grantRows: modified.map((grant) => ({ Grants: grant })),
      createUserRows: [{ "CREATE USER": createUser }],
      expectedRoleSha256: canonicalHash(role),
      expectedGrantSha256: canonicalHash([...modified].sort()),
      expectedAccountDefinitionSha256: canonicalHash(createUser),
      expectedGrantRowCount: 3,
    });
    assert.equal(result.passed, false);
    assert.equal(result.noForbiddenPrivileges, false);
  });
});

describe("TiDB readiness classification", () => {
  test("returns the separate TiDB apply-readiness state only when every gate passes", () => {
    const result = evaluateTidbReadiness({
      facts: readyFacts(),
      databaseState: readyDatabase,
    });
    assert.equal(result.applyReadiness, "READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION");
    assert.deepEqual(result.blockers, []);
    assert.equal(result.applyAuthorized, false);
    assert.equal(result.migrationAppliedByThisPreflight, false);
  });

  test("CHECK disabled has a precise hard blocker", () => {
    const facts = readyFacts();
    facts.checkConstraintsEnabled = false;
    const result = evaluateTidbReadiness({ facts, databaseState: readyDatabase });
    assert.equal(result.applyReadiness, "BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED");
    assert.ok(result.blockers.includes("BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED"));
  });

  test("a clean capability state cannot override an unexpected migration order", () => {
    const result = evaluateTidbReadiness({
      facts: readyFacts(),
      databaseState: {
        databaseStateClassification: "BLOCKED_UNEXPECTED_MIGRATION_ORDER",
        blocker: "BLOCKED_UNEXPECTED_MIGRATION_ORDER",
      },
    });
    assert.notEqual(result.applyReadiness, "READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION");
    assert.ok(result.blockers.includes("BLOCKED_UNEXPECTED_MIGRATION_ORDER"));
  });

  for (const gate of Object.keys(readyFacts())) {
    test(`gate ${gate} cannot fail open`, () => {
      const facts = readyFacts();
      facts[gate] = false;
      const result = evaluateTidbReadiness({ facts, databaseState: readyDatabase });
      assert.notEqual(result.applyReadiness, "READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION");
    });
  }
});
