import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { normaliseDatabaseUrlForPreflight } from "./issue86-phase2a-database-url-policy.mjs";
import { runProductionDiscovery } from "./issue86-phase2a-production-discovery.mjs";

const RAW = "mysql://user:password@db.example:3306/compass?ssl=required";
const DISCOVERY_BYTES = Buffer.from("reviewed-discovery");
const POLICY_BYTES = Buffer.from("reviewed-policy");
const CORE_BYTES = Buffer.from("reviewed-core");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function discoveryEnv(extra = {}) {
  return {
    DATABASE_URL: RAW,
    ISSUE86_DISCOVERY_EXPECTED_SCRIPT_SHA256: sha256(DISCOVERY_BYTES),
    ISSUE86_DISCOVERY_EXPECTED_URL_POLICY_SHA256: sha256(POLICY_BYTES),
    ISSUE86_DISCOVERY_EXPECTED_CORE_SHA256: sha256(CORE_BYTES),
    ...extra,
  };
}

function sourceInputs(extra = {}) {
  return {
    env: discoveryEnv(),
    discoveryBytes: DISCOVERY_BYTES,
    policyBytes: POLICY_BYTES,
    coreBytes: CORE_BYTES,
    urlPolicy: { normaliseDatabaseUrlForPreflight },
    ...extra,
  };
}

const core = {
  parseDatabaseUrl(raw) {
    const parsed = new URL(raw);
    return {
      config: {
        host: parsed.hostname,
        port: Number(parsed.port),
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.slice(1),
        charset: "utf8mb4",
        multipleStatements: false,
        namedPlaceholders: false,
        supportBigNumbers: true,
        bigNumberStrings: true,
        dateStrings: true,
        timezone: "Z",
        flags: "-LOCAL_FILES",
        ssl: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      },
    };
  },
  classifyEngine(versionString, versionComment) {
    return {
      versionString,
      versionComment,
      oracleMySql84ExactProfileMatched:
        /^8\.4\.[0-9]+$/.test(versionString) &&
        /MySQL Community Server/i.test(versionComment),
    };
  },
  canonicalHash() {
    return "c".repeat(64);
  },
};

function fakeConnection({
  closeFails = false,
  requireAllSteps = true,
  statusVersion = "TLSv1.3",
  statusCipher = "TLS_AES_256_GCM_SHA384",
} = {}) {
  const steps = [
    ["SELECT VERSION()", [{
      versionString: "8.4.11",
      versionComment: "MySQL Community Server - GPL",
      currentUserSha256: "a".repeat(64),
      targetIdentitySha256: "b".repeat(64),
    }]],
    ["SELECT CURRENT_ROLE()", [{ currentRole: "NONE" }]],
    ["SHOW GRANTS", [
      { grant: "GRANT USAGE ON *.* TO `user`@`%`" },
      { grant: "GRANT SELECT ON `compass`.* TO `user`@`%`" },
    ]],
    ["SHOW CREATE USER", [{ create: "CREATE USER `user`@`%` REQUIRE SSL" }]],
    ["SHOW SESSION STATUS", [
      { Variable_name: "Ssl_cipher", Value: statusCipher },
      { Variable_name: "Ssl_version", Value: statusVersion },
    ]],
  ];
  let index = 0;
  return {
    connection: {
      stream: {
        encrypted: true,
        authorized: true,
        authorizationError: null,
        getProtocol: () => "TLSv1.3",
        getCipher: () => ({ name: "TLS_AES_256_GCM_SHA384" }),
        getPeerCertificate: () => ({ fingerprint256: "AB:".repeat(31) + "AB" }),
      },
    },
    async query(sql) {
      const step = steps[index++];
      assert.ok(step, `unexpected query: ${sql}`);
      assert.ok(sql.startsWith(step[0]), `expected ${step[0]}, got ${sql}`);
      return [step[1], []];
    },
    async end() {
      if (closeFails) throw new Error("close failed");
      if (requireAllSteps) assert.equal(index, steps.length);
    },
  };
}

describe("production discovery", () => {
  test("pins sources, uses the sanitized URL, and returns only hashed identities", async () => {
    let config;
    const result = await runProductionDiscovery(sourceInputs({
      core,
      connectionFactory: async value => {
        config = value;
        return fakeConnection();
      },
    }));

    assert.equal(config.host, "db.example");
    assert.equal(config.database, "compass");
    assert.equal(config.ssl.rejectUnauthorized, true);
    assert.equal(config.multipleStatements, false);
    assert.equal(config.flags, "-LOCAL_FILES");
    assert.equal(result.engine.oracleMySql84ExactProfileMatched, true);
    assert.equal(result.currentUserSha256, "a".repeat(64));
    assert.equal(result.targetIdentitySha256, "b".repeat(64));
    assert.equal(result.transport.authorized, true);
    assert.equal(result.tlsSocketAndSessionStatusMatched, true);
    assert.equal(result.currentRole.none, true);
    assert.equal(result.grants.appearsSelectOnly, true);
    assert.deepEqual(result.grants.nonSelectPrivilegeFlags, []);
    assert.equal(result.sourceAttestation.discoveryScript.matched, true);
    assert.equal(result.sourceAttestation.urlPolicy.matched, true);
    assert.equal(result.sourceAttestation.core.matched, true);
    assert.deepEqual(result.executedStatementIds, [
      "ENGINE_IDENTITY",
      "CURRENT_ROLE",
      "SHOW_GRANTS",
      "SHOW_CREATE_USER",
      "TLS_STATUS",
    ]);
    assert.equal(result.connectionClosed, true);
    const json = JSON.stringify(result);
    assert.equal(json.includes("password"), false);
    assert.equal(json.includes("db.example"), false);
    assert.equal(json.includes("compass"), false);
  });

  test("does not connect if any source pin fails", async () => {
    for (const [name, code] of [
      ["ISSUE86_DISCOVERY_EXPECTED_SCRIPT_SHA256", "DISCOVERY_SCRIPT_SHA256_MISMATCH"],
      ["ISSUE86_DISCOVERY_EXPECTED_URL_POLICY_SHA256", "DISCOVERY_URL_POLICY_SHA256_MISMATCH"],
      ["ISSUE86_DISCOVERY_EXPECTED_CORE_SHA256", "DISCOVERY_CORE_SHA256_MISMATCH"],
    ]) {
      let called = false;
      await assert.rejects(
        runProductionDiscovery(sourceInputs({
          env: discoveryEnv({ [name]: "0".repeat(64) }),
          core,
          connectionFactory: async () => {
            called = true;
          },
        })),
        error => error?.message === code,
      );
      assert.equal(called, false);
    }
  });

  test("does not connect if the query policy is not exact", async () => {
    let called = false;
    await assert.rejects(
      runProductionDiscovery(sourceInputs({
        env: discoveryEnv({ DATABASE_URL: RAW + "&x=1" }),
        core,
        connectionFactory: async () => {
          called = true;
        },
      })),
      error => error?.message === "DATABASE_URL_QUERY_SHAPE_REJECTED",
    );
    assert.equal(called, false);
  });

  test("fails closed if TLS is not authorised", async () => {
    const connection = fakeConnection({ requireAllSteps: false });
    connection.connection.stream.authorized = false;
    await assert.rejects(
      runProductionDiscovery(sourceInputs({
        core,
        connectionFactory: async () => connection,
      })),
      error => error?.message === "DISCOVERY_TLS_NOT_VERIFIED",
    );
  });

  test("fails closed if MySQL TLS status disagrees with the socket", async () => {
    await assert.rejects(
      runProductionDiscovery(sourceInputs({
        core,
        connectionFactory: async () =>
          fakeConnection({ statusVersion: "TLSv1.2" }),
      })),
      error => error?.message === "DISCOVERY_TLS_STATUS_MISMATCH",
    );
  });

  test("fails when connection close is not proven", async () => {
    await assert.rejects(
      runProductionDiscovery(sourceInputs({
        core,
        connectionFactory: async () => fakeConnection({ closeFails: true }),
      })),
      /close failed/,
    );
  });
});
