import { describe, expect, it } from "vitest";
import {
  RECURRING_PROJECT_SNAPSHOT_MAX_ROWS,
  RECURRING_PROJECT_SNAPSHOT_SQL,
  assertRecurringSnapshotBounds,
  assertSelectOnlyGrantProfile,
  assertSnapshotSqlManifest,
  buildRecurringProjectSnapshotDocument,
  canonicalSha256,
} from "./recurringProjectSnapshotSafety";

function projectRow(id: number, name = `Annual Shutdown ${2024 + id}`) {
  return {
    id,
    reportId: 7,
    projectKey: `project-${id}`,
    name,
    location: "Example Mine, WA",
    owner: "Example Mining",
    sector: "mining",
    stage: "Planning",
    stageCode: "planning",
    lifecycleStatus: "active",
    projectType: "opportunity",
    productLane: "portable_air",
    sourcePurpose: "project_signal",
    tenderNumber: null,
    tenderCloseDate: "2026-10-01 00:00:00",
    timeline: "Shutdown planning",
    completion: null,
    sources: JSON.stringify([
      {
        label: "Public project page",
        url: "https://example.com/project?private-token=discarded#section",
        date: "2026-05-01",
      },
    ]),
    duplicateClusterId: null,
    mergedIntoId: null,
    duplicateDismissed: 0,
    suppressed: 0,
    projectCountry: "AU",
    projectState: "WA",
    sourceLastSeenAt: "2026-08-20 03:04:05",
    lastActivityAt: "2026-08-20 03:04:05",
    createdAt: "2026-08-01 01:02:03",
    updatedAt: "2026-08-20 03:04:05",
  };
}

function grantRows(...grants: string[]) {
  return grants.map(grant => ({ "Grants for snapshot_reader@%": grant }));
}

describe("Issue #135 recurring project snapshot safety", () => {
  it("locks the SQL executor to fixed SELECT and SHOW statements", () => {
    expect(assertSnapshotSqlManifest()).toMatchObject({
      passed: true,
      statementCount: 5,
    });
    expect(RECURRING_PROJECT_SNAPSHOT_SQL.PROJECT_ROWS.sql).toMatch(/^SELECT /);
    expect(RECURRING_PROJECT_SNAPSHOT_SQL.PROJECT_ROWS.sql).not.toContain(";");
    expect(RECURRING_PROJECT_SNAPSHOT_SQL.PROJECT_ROWS.sql).not.toMatch(
      /\b(?:INSERT|DELETE|REPLACE|TRUNCATE|DROP|ALTER)\b/i,
    );
  });

  it("accepts a database-scoped SELECT-only account without exposing grant text", () => {
    const profile = assertSelectOnlyGrantProfile(
      grantRows(
        "GRANT USAGE ON *.* TO `snapshot_reader`@`%`",
        "GRANT SELECT ON `issue135_schema`.* TO `snapshot_reader`@`%`",
      ),
      "issue135_schema",
    );
    expect(profile).toEqual({
      matched: true,
      classification: "select_only",
      grantCount: 2,
      grantProfileSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(profile)).not.toContain("snapshot_reader");
  });

  it("fails closed for write, grant-option, role and all-privilege profiles", () => {
    const rejected = [
      grantRows(
        "GRANT USAGE ON *.* TO `writer`@`%`",
        "GRANT SELECT, INSERT ON `issue135_schema`.* TO `writer`@`%`",
      ),
      grantRows(
        "GRANT USAGE ON *.* TO `writer`@`%`",
        "GRANT SELECT ON `issue135_schema`.* TO `writer`@`%` WITH GRANT OPTION",
      ),
      grantRows("GRANT `writer_role`@`%` TO `writer`@`%`"),
      grantRows("GRANT ALL PRIVILEGES ON *.* TO `root`@`%`"),
    ];
    for (const rows of rejected) {
      expect(() => assertSelectOnlyGrantProfile(rows, "issue135_schema")).toThrow(
        /SNAPSHOT_GRANT_PROFILE_NOT_SELECT_ONLY|SNAPSHOT_GRANT_COUNT_REJECTED/,
      );
    }
  });

  it("requires explicit bounded project IDs and a hard maximum row ceiling", () => {
    expect(
      assertRecurringSnapshotBounds({
        fromProjectId: 1,
        toProjectId: 10_000,
        maximumRows: 5_000,
      }),
    ).toEqual({ fromProjectId: 1, toProjectId: 10_000, maximumRows: 5_000 });
    expect(() =>
      assertRecurringSnapshotBounds({
        fromProjectId: 10,
        toProjectId: 1,
        maximumRows: 10,
      }),
    ).toThrow("SNAPSHOT_PROJECT_ID_RANGE_INVALID");
    expect(() =>
      assertRecurringSnapshotBounds({
        fromProjectId: 1,
        toProjectId: 10,
        maximumRows: RECURRING_PROJECT_SNAPSHOT_MAX_ROWS + 1,
      }),
    ).toThrow("SNAPSHOT_MAXIMUM_ROWS_INVALID");
  });

  it("normalises only the bounded non-contact project projection", () => {
    const snapshot = buildRecurringProjectSnapshotDocument({
      sourceSha: "a".repeat(40),
      bounds: { fromProjectId: 1, toProjectId: 5, maximumRows: 5 },
      rows: [projectRow(2), projectRow(1)],
    });
    expect(snapshot.projects.map(project => project.id)).toEqual([1, 2]);
    expect(snapshot.projects[0].sources[0].url).toBe("https://example.com/project");
    expect(snapshot.projects[0].createdAt).toBe("2026-08-01T01:02:03.000Z");

    const forbiddenKeys = new Set([
      "email",
      "phone",
      "mobilePhone",
      "crmId",
      "crmAccountId",
      "contactName",
      "contactId",
      "password",
    ]);
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        expect(forbiddenKeys.has(key)).toBe(false);
        visit(child);
      }
    };
    visit(snapshot);
  });

  it("retains a public source while omitting its malformed optional date", () => {
    const row = projectRow(1);
    row.sources = JSON.stringify([
      {
        label: "Public project page",
        url: "https://example.com/project",
        date: "not a parseable date",
      },
    ]);
    const snapshot = buildRecurringProjectSnapshotDocument({
      sourceSha: "d".repeat(40),
      bounds: { fromProjectId: 1, toProjectId: 1, maximumRows: 1 },
      rows: [row],
    });
    expect(snapshot.projects[0].sources).toEqual([
      {
        label: "Public project page",
        url: "https://example.com/project",
        date: null,
      },
    ]);
  });

  it("produces the same canonical snapshot hash regardless of input row order", () => {
    const base = {
      sourceSha: "b".repeat(40),
      bounds: { fromProjectId: 1, toProjectId: 3, maximumRows: 3 },
    };
    const first = buildRecurringProjectSnapshotDocument({
      ...base,
      rows: [projectRow(1), projectRow(2), projectRow(3)],
    });
    const second = buildRecurringProjectSnapshotDocument({
      ...base,
      rows: [projectRow(3), projectRow(1), projectRow(2)],
    });
    expect(canonicalSha256(first)).toBe(canonicalSha256(second));
  });
});
