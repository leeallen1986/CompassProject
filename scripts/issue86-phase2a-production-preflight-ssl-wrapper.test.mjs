import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import {
  DATABASE_URL_QUERY_POLICY,
  normaliseDatabaseUrlForPreflight,
} from "./issue86-phase2a-database-url-policy.mjs";
import {
  parseWrapperCli,
  runWrappedPreflight,
} from "./issue86-phase2a-production-preflight-ssl-wrapper.mjs";

const BASE = "mysql://user:password@db.example:3306/compass";
const WRAPPER_BYTES = Buffer.from("reviewed-wrapper");
const POLICY_BYTES = Buffer.from("reviewed-policy");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pinnedEnv(extra = {}) {
  return {
    ISSUE86_PREFLIGHT_EXPECTED_WRAPPER_SHA256: sha256(WRAPPER_BYTES),
    ISSUE86_PREFLIGHT_EXPECTED_URL_POLICY_SHA256: sha256(POLICY_BYTES),
    ...extra,
  };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error?.message === code);
}

describe("DATABASE_URL ssl option policy", () => {
  test("accepts exactly one lowercase ssl option and preserves the raw prefix", () => {
    const raw = `${BASE}?ssl=%7B%22mode%22%3A%22required%22%7D`;
    const result = normaliseDatabaseUrlForPreflight(raw);
    assert.equal(result.sanitizedDatabaseUrl, BASE);
    assert.deepEqual(result.policyEvidence.ignoredQueryParameterNames, ["ssl"]);
    assert.equal(result.policyEvidence.ignoredQueryParameterOccurrenceCount, 1);
    assert.equal(result.policyEvidence.queryValuesUsedForConnectionConfiguration, false);
    assert.match(result.policySha256, /^[0-9a-f]{64}$/);
  });

  test("does not normalize encoded credentials while removing the query", () => {
    const raw = "mysql://user:p%40ss%2Fword@db.example:3306/compass?ssl=true";
    const result = normaliseDatabaseUrlForPreflight(raw);
    assert.equal(
      result.sanitizedDatabaseUrl,
      "mysql://user:p%40ss%2Fword@db.example:3306/compass",
    );
  });

  test("rejects a missing query", () => {
    expectCode(
      () => normaliseDatabaseUrlForPreflight(BASE),
      "DATABASE_URL_QUERY_SHAPE_REJECTED",
    );
  });

  test("rejects duplicate ssl options", () => {
    expectCode(
      () => normaliseDatabaseUrlForPreflight(`${BASE}?ssl=true&ssl=false`),
      "DATABASE_URL_QUERY_SHAPE_REJECTED",
    );
  });

  test("rejects every unknown option", () => {
    for (const key of ["sslmode", "tls", "multipleStatements", "charset"]) {
      expectCode(
        () => normaliseDatabaseUrlForPreflight(`${BASE}?${key}=true`),
        "DATABASE_URL_QUERY_KEY_REJECTED",
      );
    }
  });

  test("rejects mixed known and unknown options", () => {
    expectCode(
      () => normaliseDatabaseUrlForPreflight(`${BASE}?ssl=true&charset=utf8`),
      "DATABASE_URL_QUERY_SHAPE_REJECTED",
    );
  });

  test("rejects case variants", () => {
    expectCode(
      () => normaliseDatabaseUrlForPreflight(`${BASE}?SSL=true`),
      "DATABASE_URL_QUERY_KEY_REJECTED",
    );
  });

  test("rejects fragments", () => {
    expectCode(
      () => normaliseDatabaseUrlForPreflight(`${BASE}?ssl=true#fragment`),
      "DATABASE_URL_FRAGMENT_REJECTED",
    );
  });

  test("rejects decoded control characters in the ignored value", () => {
    expectCode(
      () => normaliseDatabaseUrlForPreflight(`${BASE}?ssl=%0A`),
      "DATABASE_URL_SSL_OPTION_VALUE_REJECTED",
    );
  });

  test("rejects an oversized ignored value", () => {
    const value = "x".repeat(
      DATABASE_URL_QUERY_POLICY.maxIgnoredValueCharacters + 1,
    );
    expectCode(
      () => normaliseDatabaseUrlForPreflight(`${BASE}?ssl=${value}`),
      "DATABASE_URL_SSL_OPTION_VALUE_REJECTED",
    );
  });

  test("rejects non-MySQL URLs without echoing input", () => {
    const secret = "super-secret-password";
    assert.throws(
      () => normaliseDatabaseUrlForPreflight(`postgres://user:${secret}@db/x?ssl=true`),
      error =>
        error?.message === "DATABASE_URL_SCHEME_REJECTED" &&
        !error.message.includes(secret),
    );
  });
});

describe("wrapper delegation", () => {
  test("pins wrapper/policy, passes a query-free URL, and leaves caller env unchanged", async () => {
    const raw = `${BASE}?ssl=required`;
    const env = pinnedEnv({ DATABASE_URL: raw, KEEP: "value" });
    let received;
    const wrapped = await runWrappedPreflight({
      argv: ["--output-dir", "/tmp/issue86-wrapper-test"],
      env,
      wrapperBytes: WRAPPER_BYTES,
      policyBytes: POLICY_BYTES,
      runPreflightImpl: async input => {
        received = input;
        return {
          exitCode: 0,
          outputDir: input.outputDir,
          final: { applyReadiness: "READY_FOR_SEPARATE_APPLY_AUTHORIZATION" },
        };
      },
    });

    assert.equal(env.DATABASE_URL, raw);
    assert.equal(received.env.DATABASE_URL, BASE);
    assert.equal(received.env.KEEP, "value");
    assert.equal(
      wrapped.result.final.applyReadiness,
      "READY_FOR_SEPARATE_APPLY_AUTHORIZATION",
    );
    assert.equal(wrapped.wrapperAttestation.wrapperPin.matched, true);
    assert.equal(wrapped.wrapperAttestation.policyPin.matched, true);
    assert.match(wrapped.wrapperAttestation.wrapperSha256, /^[0-9a-f]{64}$/);
    assert.match(wrapped.wrapperAttestation.policyModuleSha256, /^[0-9a-f]{64}$/);
  });

  test("does not invoke the runner when either source pin fails", async () => {
    for (const env of [
      pinnedEnv({
        DATABASE_URL: `${BASE}?ssl=true`,
        ISSUE86_PREFLIGHT_EXPECTED_WRAPPER_SHA256: "0".repeat(64),
      }),
      pinnedEnv({
        DATABASE_URL: `${BASE}?ssl=true`,
        ISSUE86_PREFLIGHT_EXPECTED_URL_POLICY_SHA256: "0".repeat(64),
      }),
    ]) {
      let called = false;
      await assert.rejects(
        runWrappedPreflight({
          argv: ["--output-dir", "/tmp/issue86-wrapper-test"],
          env,
          wrapperBytes: WRAPPER_BYTES,
          policyBytes: POLICY_BYTES,
          runPreflightImpl: async () => {
            called = true;
          },
        }),
        /SHA256_MISMATCH/,
      );
      assert.equal(called, false);
    }
  });

  test("does not invoke the runner when the URL policy fails", async () => {
    let called = false;
    await assert.rejects(
      runWrappedPreflight({
        argv: ["--output-dir", "/tmp/issue86-wrapper-test"],
        env: pinnedEnv({ DATABASE_URL: `${BASE}?ssl=true&x=1` }),
        wrapperBytes: WRAPPER_BYTES,
        policyBytes: POLICY_BYTES,
        runPreflightImpl: async () => {
          called = true;
        },
      }),
      error => error?.message === "DATABASE_URL_QUERY_SHAPE_REJECTED",
    );
    assert.equal(called, false);
  });

  test("requires exactly one output-dir pair", () => {
    assert.deepEqual(
      parseWrapperCli(["--output-dir", "/tmp/new-dir"]),
      { outputDir: "/tmp/new-dir" },
    );
    for (const argv of [
      [],
      ["--output-dir"],
      ["--output-dir=/tmp/x"],
      ["--output-dir", "/tmp/x", "extra"],
      ["--sql", "SELECT 1"],
      ["--output-dir", "--apply"],
    ]) {
      expectCode(
        () => parseWrapperCli(argv),
        "CLI_USAGE: expected exactly --output-dir <new-directory>",
      );
    }
  });
});
