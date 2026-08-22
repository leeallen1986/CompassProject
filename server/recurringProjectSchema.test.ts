import { readFileSync } from "node:fs";
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  RECURRING_PROJECT_RUNTIME_WRITES_ENABLED,
  RECURRING_PROJECT_SCHEMA_VERSION,
  recurringProjectAuditEvents,
  recurringProjectOccurrenceProjects,
  recurringProjectOccurrences,
  recurringProjectProgrammes,
  recurringProjectRecommendationDecisions,
} from "../drizzle/recurringProjectSchema";

describe("Issue #132 recurring project schema", () => {
  it("defines versioned programme, occurrence, link, decision and audit tables", () => {
    expect(RECURRING_PROJECT_SCHEMA_VERSION).toBe(1);
    expect(getTableName(recurringProjectProgrammes)).toBe("recurringProjectProgrammes");
    expect(getTableName(recurringProjectOccurrences)).toBe("recurringProjectOccurrences");
    expect(getTableName(recurringProjectOccurrenceProjects)).toBe("recurringProjectOccurrenceProjects");
    expect(getTableName(recurringProjectRecommendationDecisions)).toBe("recurringProjectRecommendationDecisions");
    expect(getTableName(recurringProjectAuditEvents)).toBe("recurringProjectAuditEvents");
  });

  it("keeps runtime writes disabled in the first source release", () => {
    expect(RECURRING_PROJECT_RUNTIME_WRITES_ENABLED).toBe(false);
  });

  it("contains the fields needed to preserve history and link Full Potential context", () => {
    expect(recurringProjectProgrammes).toHaveProperty("programmeKey");
    expect(recurringProjectProgrammes).toHaveProperty("fullPotentialAccountId");
    expect(recurringProjectProgrammes).toHaveProperty("nextExpectedWindowStart");
    expect(recurringProjectOccurrences).toHaveProperty("priorOccurrenceId");
    expect(recurringProjectOccurrences).toHaveProperty("canonicalProjectId");
    expect(recurringProjectOccurrences).toHaveProperty("scopeFingerprint");
    expect(recurringProjectOccurrenceProjects).toHaveProperty("projectId");
    expect(recurringProjectRecommendationDecisions).toHaveProperty("createdFullPotentialActionId");
    expect(recurringProjectAuditEvents).toHaveProperty("beforeState");
    expect(recurringProjectAuditEvents).toHaveProperty("afterState");
  });

  it("registers the schema with drizzle without creating a migration or deployment", () => {
    const config = readFileSync("drizzle.config.ts", "utf8");
    expect(config).toContain("./drizzle/recurringProjectSchema.ts");
    expect(config).not.toContain("migrate(");
  });

  it("declares database-enforced project and occurrence identity constraints", () => {
    const source = readFileSync("drizzle/recurringProjectSchema.ts", "utf8");
    expect(source).toContain('uniqueIndex("recurringProgramme_key_uq")');
    expect(source).toContain('uniqueIndex("recurringOccurrence_key_uq")');
    expect(source).toContain('uniqueIndex("recurringOccurrenceProject_project_uq")');
    expect(source).toContain('uniqueIndex("recurringRecommendation_user_uq")');
    expect(source).toContain("one project cannot belong to\n * several recurring occurrences");
  });
});
