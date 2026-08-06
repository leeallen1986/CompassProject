import assert from "node:assert/strict";
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
  test("passes a query-free URL to the reviewed runner and leaves caller env unchanged", async () => {
    const raw = `${BASE}?ssl=required`;
    const env = { DATABASE_URL: raw, KEEP: "value" };
    let received;
    const wrapped = await runWrappedPreflight({
      argv: ["--output-dir", "/tmp/issue86-wrapper-test"],
      env,
      wrapperBytes: Buffer.from("reviewed-wrapper"),
      policyBytes: Buffer.from("reviewed-policy"),
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
    assert.match(wrapped.wrapperAttestation.wrapperSha256, /^[0-9a-f]{64}$/);
    assert.match(wrapped.wrapperAttestation.policyModuleSha256, /^[0-9a-f]{64}$/);
  });

  test("does not invoke the runner when the URL policy fails", async () => {
    let called = false;
    await assert.rejects(
      runWrappedPreflight({
        argv: ["--output-dir", "/tmp/issue86-wrapper-test"],
        env: { DATABASE_URL: `${BASE}?ssl=true&x=1` },
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
