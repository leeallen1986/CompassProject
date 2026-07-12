import { describe, expect, it } from "vitest";
import {
  applyTestDatabaseSafety,
  resolveTestDatabaseUrl,
} from "./testDatabaseSafety";

describe("test database safety", () => {
  it("clears DATABASE_URL when no TEST_DATABASE_URL is supplied", () => {
    const env: NodeJS.ProcessEnv = {
      DATABASE_URL: "mysql://user:pass@prod.example.com/compass",
    };

    const result = applyTestDatabaseSafety(env);

    expect(result.databaseUrl).toBe("");
    expect(result.databaseName).toBeNull();
    expect(env.DATABASE_URL).toBe("");
  });

  it("accepts an explicit test database and overwrites DATABASE_URL", () => {
    const testUrl =
      "mysql://user:pass@test.example.com/compass_test";
    const env: NodeJS.ProcessEnv = {
      DATABASE_URL: "mysql://user:pass@prod.example.com/compass",
      TEST_DATABASE_URL: testUrl,
    };

    const result = applyTestDatabaseSafety(env);

    expect(result.databaseUrl).toBe(testUrl);
    expect(result.databaseName).toBe("compass_test");
    expect(env.DATABASE_URL).toBe(testUrl);
  });

  it.each([
    "mysql://user:pass@prod.example.com/compass",
    "mysql://user:pass@prod.example.com/production",
    "mysql://user:pass@prod.example.com/compass_live",
  ])("rejects a non-test database name: %s", url => {
    expect(() =>
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: url }),
    ).toThrow(/test, testing, or ci marker/i);
  });

  it.each([
    "mysql://user:pass@test.example.com/test",
    "mysql://user:pass@test.example.com/compass-testing",
    "mysql://user:pass@test.example.com/ci_compass",
    "mysql2://user:pass@test.example.com/compass_ci_01",
  ])("accepts an explicitly named test database: %s", url => {
    expect(
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: url })
        .databaseUrl,
    ).toBe(url);
  });

  it("rejects a URL without an explicit database name", () => {
    expect(() =>
      resolveTestDatabaseUrl({
        TEST_DATABASE_URL: "mysql://user:pass@test.example.com",
      }),
    ).toThrow(/explicit database name/i);
  });

  it("rejects non-MySQL protocols", () => {
    expect(() =>
      resolveTestDatabaseUrl({
        TEST_DATABASE_URL:
          "postgres://user:pass@test.example.com/compass_test",
      }),
    ).toThrow(/mysql/i);
  });
});
