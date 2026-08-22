import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RECURRING_PROJECT_SNAPSHOT_SQL,
  assertSnapshotSqlManifest,
} from "./recurringProjectSnapshotSafety";

const snapshotTool = readFileSync(
  "scripts/recurring-project-snapshot.mjs",
  "utf8",
);
const previewTool = readFileSync(
  "scripts/recurring-project-backfill-preview.ts",
  "utf8",
);
const databaseUrlCore = readFileSync(
  "scripts/issue86-phase2a-preflight-core.mjs",
  "utf8",
);
const discoveryService = readFileSync(
  "server/recurringProjectDiscovery.ts",
  "utf8",
);
const schemaContract = readFileSync(
  "shared/recurringProjectSchemaContract.ts",
  "utf8",
);
const drizzleConfig = readFileSync("drizzle.config.ts", "utf8");
const weeklyPage = readFileSync("client/src/pages/ThisWeek.tsx", "utf8");

function rejectRuntimeTokens(source: string): void {
  expect(source).not.toMatch(
    /\b(?:runDailyPipeline|runWeeklyPipeline|callDataApi|openai|gemini|apolloPeopleSearch|createPipelineClaim|createFpPipelineClaim)\b/,
  );
}

describe("Issue #135 migration-neutral runtime boundary", () => {
  it("keeps the physical recurring schema and runtime writes disabled", () => {
    expect(schemaContract).toContain(
      "RECURRING_PROJECT_MIGRATION_INCLUDED = false",
    );
    expect(schemaContract).toContain(
      "RECURRING_PROJECT_RUNTIME_WRITES_ENABLED = false",
    );
    expect(drizzleConfig).not.toContain("recurringProjectSchema");
  });

  it("contains no migration artifact or migration/apply command", () => {
    expect(snapshotTool).not.toMatch(/drizzle-kit|\bmigrate\b|\bdb:push\b/);
    expect(previewTool).not.toMatch(/drizzle-kit|\bmigrate\b|\bdb:push\b/);
    expect(discoveryService).not.toMatch(/drizzle-kit|\bmigrate\b|\bdb:push\b/);
  });

  it("permits only the fixed SELECT/SHOW snapshot statements", () => {
    expect(assertSnapshotSqlManifest()).toMatchObject({ passed: true });
    for (const statement of Object.values(RECURRING_PROJECT_SNAPSHOT_SQL)) {
      expect(statement.method).toBe("query");
      expect(statement.sql).toMatch(/^(?:SELECT|SHOW)\b/);
      expect(statement.sql).not.toContain(";");
    }
    expect(databaseUrlCore).toContain("multipleStatements: false");
    expect(snapshotTool).toContain("assertSelectOnlyGrantProfile");
    expect(snapshotTool).toContain(
      "RECURRING_SNAPSHOT_ALLOW_INSECURE_LOCALHOST",
    );
  });

  it("does not import the application database, providers or ingestion pipeline", () => {
    expect(snapshotTool).not.toMatch(/from ["']\.\.\/server\/db["']/);
    expect(previewTool).not.toMatch(/from ["']\.\.\/server\/db["']/);
    expect(discoveryService).not.toMatch(/from ["']\.\/db["']/);
    rejectRuntimeTokens(snapshotTool);
    rejectRuntimeTokens(previewTool);
    rejectRuntimeTokens(discoveryService);
  });

  it("records zero project, action, Full Potential, CRM and provider effects", () => {
    for (const required of [
      "databaseWrites: 0",
      "projectDateMutations: 0",
      "projectMerges: 0",
      "projectDeletions: 0",
      "recurringProgrammesCreated: 0",
      "recurringOccurrencesCreated: 0",
      "recurringProjectLinksCreated: 0",
      "projectActionsCreated: 0",
      "fullPotentialActionsCreated: 0",
      "fullPotentialMonetaryMutations: 0",
      "crmC4cMutations: 0",
      "providerCalls: 0",
      "pipelineInvocations: 0",
      "deployments: 0",
    ]) {
      expect(discoveryService).toContain(required);
    }
  });

  it("does not change the current weekly sales UI in this phase", () => {
    expect(weeklyPage).not.toContain("recurringProjectDiscovery");
    expect(weeklyPage).not.toContain("recurring_project_window");
  });
});
