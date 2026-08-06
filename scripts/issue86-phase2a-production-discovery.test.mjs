import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runProductionDiscovery } from "./issue86-phase2a-production-discovery.mjs";

const RAW = "mysql://user:password@db.example:3306/compass?ssl=required";

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
  test("uses the sanitized URL and returns only hashed account/target identities", async () => {
    let config;
    const result = await runProductionDiscovery({
      env: { DATABASE_URL: RAW },
      core,
      connectionFactory: async value => {
        config = value;
        return fakeConnection();
      },
    });

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
    assert.match(result.sourceAttestation.discoveryScriptSha256, /^[0-9a-f]{64}$/);
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

  test("does not connect if the query policy is not exact", async () => {
    let called = false;
    await assert.rejects(
      runProductionDiscovery({
        env: { DATABASE_URL: RAW + "&x=1" },
        core,
        connectionFactory: async () => {
          called = true;
        },
      }),
      error => error?.message === "DATABASE_URL_QUERY_SHAPE_REJECTED",
    );
    assert.equal(called, false);
  });

  test("fails closed if TLS is not authorised", async () => {
    const connection = fakeConnection({ requireAllSteps: false });
    connection.connection.stream.authorized = false;
    await assert.rejects(
      runProductionDiscovery({
        env: { DATABASE_URL: RAW },
        core,
        connectionFactory: async () => connection,
      }),
      error => error?.message === "DISCOVERY_TLS_NOT_VERIFIED",
    );
  });

  test("fails closed if MySQL TLS status disagrees with the socket", async () => {
    await assert.rejects(
      runProductionDiscovery({
        env: { DATABASE_URL: RAW },
        core,
        connectionFactory: async () =>
          fakeConnection({ statusVersion: "TLSv1.2" }),
      }),
      error => error?.message === "DISCOVERY_TLS_STATUS_MISMATCH",
    );
  });

  test("fails when connection close is not proven", async () => {
    await assert.rejects(
      runProductionDiscovery({
        env: { DATABASE_URL: RAW },
        core,
        connectionFactory: async () => fakeConnection({ closeFails: true }),
      }),
      /close failed/,
    );
  });
});
