import { applyTestDatabaseSafety } from "./testDatabaseSafety";

/**
 * Runs before every Vitest file. It intentionally clears DATABASE_URL unless a
 * separately supplied TEST_DATABASE_URL passes the safety checks.
 */
applyTestDatabaseSafety(process.env);
