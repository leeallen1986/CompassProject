const SAFE_TEST_DATABASE_NAME = /(^|[_-])(test|testing|ci)([_-]|$)/i;

export interface TestDatabaseSafetyResult {
  databaseUrl: string;
  databaseName: string | null;
}

/**
 * Resolve the only database URL that tests are allowed to use.
 *
 * Production DATABASE_URL is deliberately ignored. Database-backed tests must
 * receive TEST_DATABASE_URL, and the selected database name must clearly be a
 * test/CI database. Unit tests can run without a database; in that case an
 * empty DATABASE_URL is returned so application code cannot fall back to the
 * production value loaded from .env.
 */
export function resolveTestDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): TestDatabaseSafetyResult {
  const raw = environment.TEST_DATABASE_URL?.trim() ?? "";

  if (!raw) {
    return {
      databaseUrl: "",
      databaseName: null,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      "TEST_DATABASE_URL must be a valid database URL. Tests will not use DATABASE_URL.",
    );
  }

  if (!/^mysql(?:2)?:$/i.test(parsed.protocol)) {
    throw new Error(
      `TEST_DATABASE_URL must use mysql:// or mysql2://, received ${parsed.protocol}`,
    );
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName) {
    throw new Error("TEST_DATABASE_URL must include an explicit database name.");
  }

  if (!SAFE_TEST_DATABASE_NAME.test(databaseName)) {
    throw new Error(
      "Refusing database-backed tests: the TEST_DATABASE_URL database name must contain " +
        "a standalone test, testing, or ci marker.",
    );
  }

  return {
    databaseUrl: raw,
    databaseName,
  };
}

export function applyTestDatabaseSafety(
  environment: NodeJS.ProcessEnv = process.env,
): TestDatabaseSafetyResult {
  const resolved = resolveTestDatabaseUrl(environment);

  // Always overwrite DATABASE_URL. This prevents Vite/Vitest or dotenv from
  // leaking the production .env value into test modules.
  environment.DATABASE_URL = resolved.databaseUrl;
  return resolved;
}
