import assert from "node:assert/strict";
import test from "node:test";
import { parseDatabaseUrl } from "./issue86-phase2a-preflight-core.mjs";
import {
  RECURRING_SNAPSHOT_DATABASE_URL_POLICY,
  normaliseRecurringSnapshotDatabaseUrl,
} from "./recurring-project-database-url-policy.mjs";

const BASE = "mysql://snapshot_reader:synthetic-secret@db.example.test:4000/compass";

test("accepts a query-free URL unchanged", () => {
  const result = normaliseRecurringSnapshotDatabaseUrl(BASE);
  assert.equal(result.sanitizedDatabaseUrl, BASE);
  assert.deepEqual(result.policyEvidence, {
    policyVersion: 1,
    acceptedShape: "no_query",
    ignoredQueryParameterNames: [],
    ignoredQueryParameterOccurrenceCount: 0,
    queryValuesUsedForConnectionConfiguration: false,
    queryStringRemovedBeforeApprovedParser: false,
  });
  assert.match(result.policySha256, /^[0-9a-f]{64}$/);
});

test("accepts exactly one ssl option but never uses or exposes its value", () => {
  const ignoredValue = "provider-specific-sensitive-shape";
  const raw = `${BASE}?ssl=${encodeURIComponent(ignoredValue)}`;
  const result = normaliseRecurringSnapshotDatabaseUrl(raw);
  assert.equal(result.sanitizedDatabaseUrl, BASE);
  assert.deepEqual(result.policyEvidence, {
    policyVersion: 1,
    acceptedShape: "single_ignored_ssl",
    ignoredQueryParameterNames: ["ssl"],
    ignoredQueryParameterOccurrenceCount: 1,
    queryValuesUsedForConnectionConfiguration: false,
    queryStringRemovedBeforeApprovedParser: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /provider-specific-sensitive-shape/);

  const parsed = parseDatabaseUrl(result.sanitizedDatabaseUrl);
  assert.equal(parsed.config.multipleStatements, false);
  assert.equal(parsed.config.flags, "-LOCAL_FILES");
  assert.deepEqual(parsed.config.ssl, {
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  });
});

test("rejects unknown, repeated and multiple query options", () => {
  const rejected = [
    `${BASE}?connectTimeout=1000`,
    `${BASE}?ssl=one&ssl=two`,
    `${BASE}?ssl=one&mode=two`,
    `${BASE}?mode=one&ssl=two`,
  ];
  for (const raw of rejected) {
    assert.throws(
      () => normaliseRecurringSnapshotDatabaseUrl(raw),
      /DATABASE_URL_(?:QUERY_SHAPE|QUERY_KEY|QUERY_ENCODING)_REJECTED/,
    );
  }
});

test("rejects fragments, schemes and malformed URLs", () => {
  assert.throws(
    () => normaliseRecurringSnapshotDatabaseUrl(`${BASE}#fragment`),
    /DATABASE_URL_FRAGMENT_REJECTED/,
  );
  assert.throws(
    () => normaliseRecurringSnapshotDatabaseUrl(BASE.replace(/^mysql:/, "https:")),
    /DATABASE_URL_SCHEME_REJECTED/,
  );
  assert.throws(
    () => normaliseRecurringSnapshotDatabaseUrl("not a url"),
    /DATABASE_URL_PARSE_FAILED/,
  );
});

test("keeps a single narrow public policy", () => {
  assert.deepEqual(RECURRING_SNAPSHOT_DATABASE_URL_POLICY, {
    policyVersion: 1,
    acceptedShapes: ["no_query", "single_ignored_ssl"],
    allowedIgnoredQueryKeys: ["ssl"],
    maxRawUrlBytes: 4096,
  });
});
