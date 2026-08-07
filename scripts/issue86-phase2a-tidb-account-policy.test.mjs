import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ACCOUNT_POLICY_SENTINEL,
  ACCOUNT_POLICY_SENTINEL_SHA256,
  evaluateEffectiveSecureTransport,
  inspectTidbCreateUserStatement,
  sanitizeTidbCreateUserRows,
} from "./issue86-phase2a-tidb-account-policy.mjs";
import { canonicalHash } from "./issue86-phase2a-preflight-core.mjs";

describe("TiDB account policy parser", () => {
  test("authentication rotations map to one stable redacted sentinel", () => {
    const first = sanitizeTidbCreateUserRows([
      {
        "CREATE USER":
          "CREATE USER 'user'@'%' IDENTIFIED WITH 'mysql_native_password' AS '*AAAA' REQUIRE NONE ACCOUNT UNLOCK",
      },
    ]);
    const second = sanitizeTidbCreateUserRows([
      {
        "CREATE USER":
          "CREATE USER 'user'@'%' IDENTIFIED WITH 'mysql_native_password' AS '*BBBB' REQUIRE NONE ACCOUNT UNLOCK",
      },
    ]);
    assert.deepEqual(first.rows, [{ "CREATE USER": ACCOUNT_POLICY_SENTINEL }]);
    assert.deepEqual(second.rows, first.rows);
    assert.equal(ACCOUNT_POLICY_SENTINEL_SHA256, canonicalHash(ACCOUNT_POLICY_SENTINEL));
    assert.equal(first.policy.authenticationMaterialRedacted, true);
  });

  test("allows ordinary formatting whitespace but rejects hidden control bytes", () => {
    const policy = inspectTidbCreateUserStatement(
      "CREATE USER 'user'@'%'\nIDENTIFIED WITH 'mysql_native_password' AS '*AAAA'\nREQUIRE NONE",
    );
    assert.equal(policy.requireMode, "NONE");
    assert.throws(
      () =>
        inspectTidbCreateUserStatement(
          "CREATE USER 'user'@'%' IDENTIFIED BY 'x'\u0000 REQUIRE NONE",
        ),
      /TIDB_CREATE_USER_STATEMENT_INVALID/,
    );
  });

  test("requires effective transport from account or cluster policy", () => {
    const none = inspectTidbCreateUserStatement(
      "CREATE USER 'user'@'%' IDENTIFIED BY 'x' REQUIRE NONE",
    );
    const ssl = inspectTidbCreateUserStatement(
      "CREATE USER 'user'@'%' IDENTIFIED BY 'x' REQUIRE SSL",
    );
    assert.equal(
      evaluateEffectiveSecureTransport({
        accountPolicy: none,
        globalVariableRows: [
          { Variable_name: "require_secure_transport", Value: "ON" },
        ],
      }).effectiveSecureTransport,
      true,
    );
    assert.equal(
      evaluateEffectiveSecureTransport({
        accountPolicy: ssl,
        globalVariableRows: [
          { Variable_name: "require_secure_transport", Value: "OFF" },
        ],
      }).effectiveSecureTransport,
      true,
    );
    assert.equal(
      evaluateEffectiveSecureTransport({
        accountPolicy: none,
        globalVariableRows: [
          { Variable_name: "require_secure_transport", Value: "OFF" },
        ],
      }).effectiveSecureTransport,
      false,
    );
  });

  test("rejects multi-statement and contradictory REQUIRE clauses", () => {
    assert.throws(
      () =>
        inspectTidbCreateUserStatement(
          "CREATE USER 'u'@'%' IDENTIFIED BY 'x' REQUIRE NONE; DROP USER 'u'@'%'",
        ),
      /TIDB_CREATE_USER_STATEMENT_INVALID/,
    );
    assert.throws(
      () =>
        inspectTidbCreateUserStatement(
          "CREATE USER 'u'@'%' IDENTIFIED BY 'x' REQUIRE NONE REQUIRE SSL",
        ),
      /TIDB_CREATE_USER_REQUIREMENT_AMBIGUOUS/,
    );
  });
});
