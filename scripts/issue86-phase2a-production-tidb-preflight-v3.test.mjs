import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import {
  ACCOUNT_POLICY_SENTINEL,
  ACCOUNT_POLICY_SENTINEL_SHA256,
  evaluateEffectiveSecureTransport,
  inspectTidbCreateUserStatement,
  sanitizeTidbCreateUserRows,
} from "./issue86-phase2a-tidb-account-policy.mjs";
import {
  exitCodeForReadiness,
  runTidbPreflightV3,
} from "./issue86-phase2a-production-tidb-preflight-v3.mjs";
import {
  SNAPSHOT_STATEMENT_IDS,
  TIDB_SQL,
} from "./issue86-phase2a-tidb-preflight-core.mjs";
import { canonicalHash } from "./issue86-phase2a-preflight-core.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const V3_PATH = join(
  SCRIPT_DIR,
  "issue86-phase2a-production-tidb-preflight-v3.mjs",
);
const ACCOUNT_POLICY_PATH = join(
  SCRIPT_DIR,
  "issue86-phase2a-tidb-account-policy.mjs",
);

const hashFile = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const V2_IDS = Object.freeze([
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

const CENSUS_HASHES = ["a".repeat(64), "b".repeat(64)];
const CENSUS_SHA256 = canonicalHash(CENSUS_HASHES);

function tempOutput() {
  const parent = mkdtempSync(join(tmpdir(), "issue86-v3-test-"));
  chmodSync(parent, 0o700);
  return { parent, output: join(parent, "evidence") };
}

function baseEnv({ reviewedCensus = true } = {}) {
  return {
    DATABASE_URL: "mysql://user:password@localhost:4000/database?ssl=ignored",
    ISSUE86_TIDB_PREFLIGHT_EXPECTED_V3_SHA256: hashFile(V3_PATH),
    ISSUE86_TIDB_PREFLIGHT_EXPECTED_ACCOUNT_POLICY_SHA256:
      hashFile(ACCOUNT_POLICY_PATH),
    ...(reviewedCensus
      ? {
          ISSUE86_TIDB_PREFLIGHT_EXPECTED_CHECK_CENSUS_COUNT: "2",
          ISSUE86_TIDB_PREFLIGHT_EXPECTED_CHECK_CENSUS_SHA256: CENSUS_SHA256,
        }
      : {}),
  };
}

function fakeUnderlyingConnection({
  createUser =
    "CREATE USER 'user'@'%' IDENTIFIED WITH 'mysql_native_password' AS '*AAAA' REQUIRE NONE PASSWORD EXPIRE DEFAULT ACCOUNT UNLOCK",
  requireSecureTransport = "ON",
} = {}) {
  let closed = false;
  return {
    connection: { stream: {} },
    async query(sql) {
      if (sql === TIDB_SQL.SHOW_CREATE_USER.sql) {
        return [[{ "CREATE USER": createUser }], []];
      }
      if (sql === TIDB_SQL.GLOBAL_VARIABLES.sql) {
        return [
          [
            { Variable_name: "foreign_key_checks", Value: "ON" },
            { Variable_name: "require_secure_transport", Value: requireSecureTransport },
            { Variable_name: "tidb_enable_check_constraint", Value: "OFF" },
            { Variable_name: "tidb_enable_foreign_key", Value: "ON" },
            { Variable_name: "tidb_enable_noop_functions", Value: "OFF" },
          ],
          [],
        ];
      }
      if (String(sql).startsWith("SELECT COUNT(*) AS rowCount FROM information_schema.TIDB_CHECK_CONSTRAINTS")) {
        return [[{ rowCount: "2" }], []];
      }
      if (String(sql).startsWith("SELECT SHA2(CONCAT_WS(CHAR(0), CONSTRAINT_SCHEMA")) {
        return [CENSUS_HASHES.map((rowHash) => ({ rowHash })), []];
      }
      return [[], []];
    },
    async end() {
      closed = true;
    },
    get closed() {
      return closed;
    },
  };
}

function fakeRunV2({
  readiness = "READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION",
  blockers = [],
  queryOverride = null,
} = {}) {
  return async ({ connectionFactory }) => {
    const connection = await connectionFactory({});
    for (const id of V2_IDS) {
      if (queryOverride && id === "TLS_STATUS") {
        await connection.query(queryOverride);
      } else {
        await connection.query(TIDB_SQL[id].sql);
      }
    }
    await connection.end();
    return {
      applyReadiness: readiness,
      blockers,
      productionDatabaseWrites: 0,
    };
  };
}

describe("sanitised TiDB account policy", () => {
  test("authentication rotations produce the same sentinel", () => {
    const a = sanitizeTidbCreateUserRows([
      {
        "CREATE USER":
          "CREATE USER 'user'@'%' IDENTIFIED WITH 'mysql_native_password' AS '*AAAA' REQUIRE NONE ACCOUNT UNLOCK",
      },
    ]);
    const b = sanitizeTidbCreateUserRows([
      {
        "CREATE USER":
          "CREATE USER 'user'@'%' IDENTIFIED WITH 'mysql_native_password' AS '*BBBB' REQUIRE NONE ACCOUNT UNLOCK",
      },
    ]);
    assert.deepEqual(a.rows, [{ "CREATE USER": ACCOUNT_POLICY_SENTINEL }]);
    assert.deepEqual(b.rows, a.rows);
    assert.equal(ACCOUNT_POLICY_SENTINEL_SHA256, canonicalHash(ACCOUNT_POLICY_SENTINEL));
    assert.equal(a.policy.authenticationMaterialRedacted, true);
    assert.equal(b.policy.authenticationMaterialRedacted, true);
  });

  test("cluster secure transport can satisfy REQUIRE NONE", () => {
    const policy = inspectTidbCreateUserStatement(
      "CREATE USER 'user'@'%' IDENTIFIED WITH 'mysql_native_password' AS '*AAAA' REQUIRE NONE",
    );
    const result = evaluateEffectiveSecureTransport({
      accountPolicy: policy,
      globalVariableRows: [
        { Variable_name: "require_secure_transport", Value: "ON" },
      ],
    });
    assert.equal(result.accountRequiresSecureTransport, false);
    assert.equal(result.clusterRequiresSecureTransport, true);
    assert.equal(result.effectiveSecureTransport, true);
  });

  test("account-level REQUIRE SSL is sufficient when cluster policy is off", () => {
    const policy = inspectTidbCreateUserStatement(
      "CREATE USER 'user'@'%' IDENTIFIED WITH 'mysql_native_password' AS '*AAAA' REQUIRE SSL",
    );
    const result = evaluateEffectiveSecureTransport({
      accountPolicy: policy,
      globalVariableRows: [
        { Variable_name: "require_secure_transport", Value: "OFF" },
      ],
    });
    assert.equal(result.effectiveSecureTransport, true);
  });

  test("rejects ambiguous or multi-statement account definitions", () => {
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

describe("TiDB preflight v3 controller", () => {
  test("returns READY only with reviewed census and exact read-only transcript", async () => {
    const { parent, output } = tempOutput();
    try {
      const final = await runTidbPreflightV3({
        outputDir: output,
        env: baseEnv(),
        runV2: fakeRunV2(),
        realConnectionFactory: async () => fakeUnderlyingConnection(),
      });
      assert.equal(final.applyReadiness, "READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION");
      assert.equal(final.checkConstraintCensusReviewed, true);
      assert.equal(final.effectiveSecureTransport, true);
      assert.equal(final.productionDatabaseWrites, 0);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("blocks an unreviewed census but still proves read-only execution", async () => {
    const { parent, output } = tempOutput();
    try {
      const final = await runTidbPreflightV3({
        outputDir: output,
        env: baseEnv({ reviewedCensus: false }),
        runV2: fakeRunV2(),
        realConnectionFactory: async () => fakeUnderlyingConnection(),
      });
      assert.equal(final.applyReadiness, "BLOCKED_TIDB_CHECK_CENSUS_UNREVIEWED");
      assert.equal(final.productionDatabaseWrites, 0);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("preserves the CHECK-disabled blocker and maps it to exit code 2", async () => {
    const { parent, output } = tempOutput();
    try {
      const final = await runTidbPreflightV3({
        outputDir: output,
        env: baseEnv(),
        runV2: fakeRunV2({
          readiness: "BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED",
          blockers: ["BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED"],
        }),
        realConnectionFactory: async () => fakeUnderlyingConnection(),
      });
      assert.equal(final.applyReadiness, "BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED");
      assert.equal(final.productionDatabaseWrites, 0);
      assert.equal(exitCodeForReadiness(final.applyReadiness), 2);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("rejects SQL outside the closed manifest", async () => {
    const { parent, output } = tempOutput();
    try {
      await assert.rejects(
        runTidbPreflightV3({
          outputDir: output,
          env: baseEnv(),
          runV2: fakeRunV2({ queryOverride: "SELECT 1" }),
          realConnectionFactory: async () => fakeUnderlyingConnection(),
        }),
        /TIDB_V3_UNKNOWN_SQL_REJECTED/,
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

test("blocked readiness exits 2 in a real child process", () => {
  const parent = mkdtempSync(join(tmpdir(), "issue86-v3-exit-"));
  const helper = join(parent, "exit-helper.mjs");
  writeFileSync(
    helper,
    `import { exitCodeForReadiness } from ${JSON.stringify(pathToFileURL(V3_PATH).href)};\nprocess.exitCode = exitCodeForReadiness("BLOCKED_TIDB_CHECK_CONSTRAINTS_DISABLED");\n`,
  );
  try {
    const result = spawnSync(process.execPath, [helper], { encoding: "utf8" });
    assert.equal(result.status, 2, result.stderr);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
