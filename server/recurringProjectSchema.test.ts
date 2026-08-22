import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RECURRING_PROJECT_MIGRATION_INCLUDED,
  RECURRING_PROJECT_RUNTIME_WRITES_ENABLED,
  RECURRING_PROJECT_SCHEMA_CONTRACT,
  RECURRING_PROJECT_SCHEMA_CONTRACT_VERSION,
  assertRecurringProjectSchemaContract,
} from "../shared/recurringProjectSchemaContract";

describe("Issue #132 recurring project schema contract", () => {
  it("defines a versioned migration-neutral five-table contract", () => {
    expect(RECURRING_PROJECT_SCHEMA_CONTRACT_VERSION).toBe(1);
    expect(RECURRING_PROJECT_SCHEMA_CONTRACT).toMatchObject({
      version: 1,
      migrationIncluded: false,
      runtimeWritesEnabled: false,
    });
    expect(Object.values(RECURRING_PROJECT_SCHEMA_CONTRACT.tables).map(table => table.name))
      .toEqual([
        "recurringProjectProgrammes",
        "recurringProjectOccurrences",
        "recurringProjectOccurrenceProjects",
        "recurringProjectRecommendationDecisions",
        "recurringProjectAuditEvents",
      ]);
    expect(() => assertRecurringProjectSchemaContract()).not.toThrow();
  });

  it("keeps migration and runtime writes disabled", () => {
    expect(RECURRING_PROJECT_MIGRATION_INCLUDED).toBe(false);
    expect(RECURRING_PROJECT_RUNTIME_WRITES_ENABLED).toBe(false);
  });

  it("contains the fields needed to preserve history and link Full Potential context", () => {
    const { programmes, occurrences, occurrenceProjects, recommendationDecisions, auditEvents } =
      RECURRING_PROJECT_SCHEMA_CONTRACT.tables;
    expect(programmes.columns.map(column => column.name)).toEqual(expect.arrayContaining([
      "programmeKey",
      "fullPotentialAccountId",
      "nextExpectedWindowStart",
      "usualLeadTimeDays",
    ]));
    expect(occurrences.columns.map(column => column.name)).toEqual(expect.arrayContaining([
      "priorOccurrenceId",
      "canonicalProjectId",
      "scopeFingerprint",
      "sourceFingerprint",
    ]));
    expect(occurrenceProjects.columns.map(column => column.name)).toContain("projectId");
    expect(recommendationDecisions.columns.map(column => column.name)).toEqual(expect.arrayContaining([
      "createdProjectActionId",
      "createdFullPotentialActionId",
    ]));
    expect(auditEvents.columns.map(column => column.name)).toEqual(expect.arrayContaining([
      "beforeState",
      "afterState",
      "reason",
    ]));
  });

  it("declares the future database identity constraints without changing drizzle artifacts", () => {
    const { programmes, occurrences, occurrenceProjects, recommendationDecisions } =
      RECURRING_PROJECT_SCHEMA_CONTRACT.tables;
    expect(programmes.uniqueConstraints).toContainEqual(expect.objectContaining({
      name: "recurringProgramme_key_uq",
      columns: ["programmeKey"],
    }));
    expect(occurrences.uniqueConstraints).toContainEqual(expect.objectContaining({
      name: "recurringOccurrence_key_uq",
      columns: ["occurrenceKey"],
    }));
    expect(occurrenceProjects.uniqueConstraints).toContainEqual(expect.objectContaining({
      name: "recurringOccurrenceProject_project_uq",
      columns: ["projectId"],
    }));
    expect(recommendationDecisions.uniqueConstraints).toContainEqual(expect.objectContaining({
      name: "recurringRecommendation_user_uq",
      columns: ["recommendationKey", "userId"],
    }));

    expect(existsSync("drizzle/recurringProjectSchema.ts")).toBe(false);
    const config = readFileSync("drizzle.config.ts", "utf8");
    expect(config).not.toContain("recurringProjectSchema");
  });

  it("requires one recurring occurrence per preserved project", () => {
    const projectConstraint = RECURRING_PROJECT_SCHEMA_CONTRACT.tables.occurrenceProjects
      .uniqueConstraints.find(row => row.name === "recurringOccurrenceProject_project_uq");
    expect(projectConstraint).toMatchObject({
      columns: ["projectId"],
      reason: "A project can belong to exactly one recurring occurrence.",
    });
  });
});
