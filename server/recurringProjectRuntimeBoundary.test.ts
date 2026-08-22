import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Issue #132 first-release runtime boundary", () => {
  it("does not wire recurring-project writes into the application router", () => {
    const routerSource = source("server/routers.ts");
    expect(routerSource).not.toContain("recurringProjectProgrammes");
    expect(routerSource).not.toContain("recurringProjectOccurrences");
    expect(routerSource).not.toContain("recurring-project-preview");
  });

  it("does not add recurring-project mutations to the shared database service", () => {
    const dbSource = source("server/db.ts");
    expect(dbSource).not.toContain("recurringProjectProgrammes");
    expect(dbSource).not.toContain("recurringProjectOccurrences");
    expect(dbSource).not.toContain("createRecurring");
    expect(dbSource).not.toContain("updateRecurring");
  });

  it("keeps the current weekly page unchanged in this source release", () => {
    const weeklySource = source("client/src/pages/ThisWeek.tsx");
    expect(weeklySource).not.toContain("recurringProjectProgrammes");
    expect(weeklySource).not.toContain("recurringProjectOccurrences");
    expect(weeklySource).not.toContain("recurring_project_window");
  });

  it("keeps recurring weekly integration as a read-only projection", () => {
    const projectionSource = source("server/recurringProjectWeeklyProjection.ts");
    expect(projectionSource).toContain("Read-only adapter for the existing weekly page");
    expect(projectionSource).toContain("durableActionsCreated: 0");
    expect(projectionSource).toContain("projectActionsCreated: 0");
    expect(projectionSource).toContain("fullPotentialActionsCreated: 0");
    expect(projectionSource).not.toContain("getDb(");
  });
});
