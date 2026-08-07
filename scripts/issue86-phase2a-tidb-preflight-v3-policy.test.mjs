import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import {
  READY_FOR_TIDB_APPLY,
  canonicalHash,
  classifyCheckConstraintCensus,
  evaluateTidbV3Readiness,
  exitCodeForReadiness,
  normaliseCreateUserStatement,
  validateTidbAccountPolicy,
} from "./issue86-phase2a-tidb-preflight-v3-policy.mjs";

const ROLE = "NONE";
const GRANTS = [
  "GRANT USAGE ON *.* TO `u`@`%`",
  "GRANT SELECT ON `db`.* TO `u`@`%`",
  "GRANT SELECT ON `INFORMATION_SCHEMA`.* TO `u`@`%`",
];

function account(statement, options = {}) {
  const grants = options.grants ?? GRANTS;
  return validateTidbAccountPolicy({
    roleRows: [{ currentRole: ROLE }],
    grantRows: grants.map((grant) => ({ Grants: grant })),
    createUserRows: [{ "CREATE USER": statement }],
    expectedRoleSha256: canonicalHash(ROLE),
    expectedGrantSha256: canonicalHash([...grants].sort()),
    expectedGrantRowCount: 3,
    requireSecureTransportEnabled: options.requireSecureTransportEnabled ?? true,
  });
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
    accountPolicyMatched: true,
    transportPolicyEnforced: true,
    oneConnectionOnly: true,
    connectionIdConsistent: true,
    capabilitiesObserved: true,
    checkConstraintsEnabled: true,
    foreignKeyFeatureEnabled: true,
    globalForeignKeyChecksEnabled: true,
    sessionForeignKeyChecksEnabled: true,
    noopFunctionsDisabled: true,
    metadataCapabilitiesExact: true,
    checkCensusObserved: true,
    checkCensusPinned: true,
    journalSchemaExact: true,
    predecessorFootprintExact: true,
    snapshotsEqual: true,
    transcriptExact: true,
    connectionClosed: true,
  };
}

const READY_DATABASE = {
  databaseStateClassification: READY_FOR_TIDB_APPLY,
  blocker: null,
};

describe("CREATE USER sanitisation", () => {
  test("authentication-string rotation produces a stable sanitised hash", () => {
    const a = normaliseCreateUserStatement(
      "CREATE USER `u`@`%` IDENTIFIED WITH 'mysql_native_password' AS '*AAAA' REQUIRE NONE",
    );
    const b = normaliseCreateUserStatement(
      "CREATE USER `u`@`%` IDENTIFIED WITH 'mysql_native_password' AS '*BBBB' REQUIRE NONE",
    );
    assert.equal(a, b);
    assert.ok(a.includes("CREATE USER <CURRENT_USER>"));
    assert.ok(a.includes("'<redacted>'"));
  });

  test("redacts password and account identity", () => {
    const value = normaliseCreateUserStatement(
      "CREATE USER 'alice'@'example.com' IDENTIFIED BY 'secret' REQUIRE SSL",
    );
    assert.equal(value.includes("alice"), false);
    assert.equal(value.includes("example.com"), false);
    assert.equal(value.includes("secret"), false);
    assert.ok(value.includes("<CURRENT_USER>"));
    assert.ok(value.includes("<redacted>"));
  });
});

describe("TiDB account policy", () => {
  test("accepts REQUIRE NONE when cluster secure transport is enabled", () => {
    const result = account(
      "CREATE USER `u`@`%` IDENTIFIED WITH 'mysql_native_password' AS '*HASH1' REQUIRE NONE",
      { requireSecureTransportEnabled: true },
    );
    assert.equal(result.passed, true);
    assert.equal(result.accountRequiresSslOrX509, false);
    assert.equal(result.clusterRequiresSecureTransport, true);
    assert.equal(result.effectiveTransportRequired, true);
  });

  test("rejects REQUIRE NONE when cluster secure transport is disabled", () => {
    const result = account(
      "CREATE USER `u`@`%` IDENTIFIED WITH 'mysql_native_password' AS '*HASH1' REQUIRE NONE",
      { requireSecureTransportEnabled: false },
    );
    assert.equal(result.passed, false);
    assert.equal(result.effectiveTransportRequired, false);
  });

  test("accepts account-level REQUIRE SSL when cluster secure transport is disabled", () => {
    const result = account(
      "CREATE USER `u`@`%` IDENTIFIED WITH 'mysql_native_password' AS '*HASH1' REQUIRE SSL",
      { requireSecureTransportEnabled: false },
    );
    assert.equal(result.passed, true);
    assert.equal(result.accountRequiresSslOrX509, true);
  });

  test("rejects an added write privilege", () => {
    const grants = [
      GRANTS[0],
      GRANTS[1].replace("SELECT", "SELECT, INSERT"),
      GRANTS[2],
    ];
    const result = account(
      "CREATE USER `u`@`%` IDENTIFIED WITH 'mysql_native_password' AS '*HASH1' REQUIRE SSL",
      { grants, requireSecureTransportEnabled: true },
    );
    assert.equal(result.passed, false);
    assert.equal(result.noForbiddenPrivileges, false);
  });

  test("auth rotation changes raw hash but not sanitised policy hash", () => {
    const a = account(
      "CREATE USER `u`@`%` IDENTIFIED WITH 'mysql_native_password' AS '*HASH1' REQUIRE NONE",
    );
    const b = account(
      "CREATE USER `u`@`%` IDENTIFIED WITH 'mysql_native_password' AS '*HASH2' REQUIRE NONE",
    );
    assert.notEqual(a.rawAccountDefinitionSha256, b.rawAccountDefinitionSha256);
    assert.equal(
      a.sanitisedAccountDefinitionSha256,
      b.sanitisedAccountDefinitionSha256,
    );
    assert.equal(a.passed, true);
    assert.equal(b.passed, true);
  });
});

describe("CHECK census", () => {
  test("zero constraints is safe for the enablement assessment", () => {
    const census = classifyCheckConstraintCensus({
      countRows: [{ rowCount: "0" }],
      detailRows: [],
    });
    assert.equal(census.count, 0);
    assert.equal(census.safeForAutomaticEnablementAssessment, true);
  });

  test("existing constraints are recorded and require review", () => {
    const census = classifyCheckConstraintCensus({
      countRows: [{ rowCount: "1" }],
      detailRows: [
        {
          tableName: "t",
          constraintName: "c",
          checkClause: "(`x` > 0)",
          tableId: "42",
        },
      ],
    });
    assert.equal(census.count, 1);
    assert.equal(census.safeForAutomaticEnablementAssessment, false);
  });
});

describe("v3 readiness and CLI exit", () => {
  test("returns READY only when every gate passes", () => {
    const result = evaluateTidbV3Readiness({
      facts: readyFacts(),
      databaseState: READY_DATABASE,
    });
    assert.equal(result.applyReadiness, READY_FOR_TIDB_APPLY);
    assert.deepEqual(result.blockers, []);
  });

  test("CHECK disabled blocks precisely", () => {
    const facts = readyFacts();
    facts.checkConstraintsEnabled = false;
    const result = evaluateTidbV3Readiness({ facts, databaseState: READY_DATABASE });
    assert.equal(result.applyReadiness, "BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED");
  });

  test("un-pinned census cannot fail open", () => {
    const facts = readyFacts();
    facts.checkCensusPinned = false;
    const result = evaluateTidbV3Readiness({ facts, databaseState: READY_DATABASE });
    assert.equal(result.applyReadiness, "BLOCKED_CHECK_CENSUS_UNPINNED");
  });

  test("blocked results map to exit code 2", () => {
    assert.equal(exitCodeForReadiness("BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED"), 2);
    assert.equal(exitCodeForReadiness(READY_FOR_TIDB_APPLY), 0);
  });

  test("real child process returns exit code 2 for blocked readiness", () => {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const child = spawnSync(
      process.execPath,
      [
        resolve(scriptDir, "issue86-phase2a-tidb-cli-exit-contract.mjs"),
        "BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED",
      ],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 2, child.stderr);
    const parsed = JSON.parse(child.stdout);
    assert.equal(
      parsed.applyReadiness,
      "BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED",
    );
  });
});
