import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);
const testEnvironment = loadEnv("test", templateRoot, "");

/**
 * Tests never inherit DATABASE_URL. They receive only TEST_DATABASE_URL from
 * the shell, .env.test, or .env.test.local. When none is supplied, database-
 * backed tests fail closed while pure unit tests remain runnable.
 */
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL?.trim() ||
  testEnvironment.TEST_DATABASE_URL?.trim() ||
  "";

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/**/*.test.ts",
      "client/**/*.spec.ts",
    ],
    setupFiles: ["server/testSetup.ts"],
    env: {
      TEST_DATABASE_URL: testDatabaseUrl,
      DATABASE_URL: testDatabaseUrl,
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
