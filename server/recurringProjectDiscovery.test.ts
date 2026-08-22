import { describe, expect, it } from "vitest";
import type {
  RecurringProjectSnapshotDocument,
  RecurringProjectSnapshotRow,
} from "@shared/recurringProjectDiscoveryContract";
import {
  buildRecurringDiscoveryReviewPackage,
  deriveRecurringCycleLabel,
  deriveRecurringPackageKey,
  deriveRecurringProgrammeCore,
} from "./recurringProjectDiscovery";
import { canonicalSha256 } from "./recurringProjectSnapshotSafety";

function project(
  id: number,
  name: string,
  overrides: Partial<RecurringProjectSnapshotRow> = {},
): RecurringProjectSnapshotRow {
  return {
    id,
    reportId: 100 + id,
    projectKey: `project-${id}`,
    name,
    location: "Example Mine, Pilbara WA",
    owner: "Example Mining",
    sector: "mining",
    stage: "Planning",
    stageCode: "planning",
    lifecycleStatus: "active",
    projectType: "opportunity",
    productLane: "portable_air",
    sourcePurpose: "project_signal",
    tenderNumber: null,
    tenderCloseDate: null,
    timeline: null,
    completion: null,
    sources: [{ label: `Public source ${id}`, url: null, date: null }],
    duplicateClusterId: null,
    mergedIntoId: null,
    duplicateDismissed: false,
    suppressed: false,
    projectCountry: "AU",
    projectState: "WA",
    sourceLastSeenAt: "2026-08-20T00:00:00.000Z",
    lastActivityAt: "2026-08-20T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function snapshot(projects: RecurringProjectSnapshotRow[]): RecurringProjectSnapshotDocument {
  const ordered = [...projects].sort((left, right) => left.id - right.id);
  return {
    version: 1,
    mode: "read_only_project_snapshot",
    sourceSha: "c".repeat(40),
    snapshotRef: "recurring-project-snapshot-v1:synthetic",
    rowBounds: {
      fromProjectId: Math.min(...ordered.map(row => row.id)),
      toProjectId: Math.max(...ordered.map(row => row.id)),
      maximumRows: 100,
    },
    projects: ordered,
  };
}

function review(projects: RecurringProjectSnapshotRow[]) {
  const document = snapshot(projects);
  return buildRecurringDiscoveryReviewPackage({
    snapshot: document,
    snapshotSha256: canonicalSha256(document),
  });
}

describe("Issue #135 recurring project discovery", () => {
  it("extracts deterministic cycle, programme and package identities", () => {
    const row = project(
      1,
      "West Plant Annual Shutdown 2026 Q3 Train 2 Package B",
    );
    expect(deriveRecurringCycleLabel(row)).toEqual({
      cycleLabel: "2026-Q3",
      evidenceCodes: ["explicit_quarter_cycle"],
    });
    expect(deriveRecurringProgrammeCore(row.name)).toBe("west plant shutdown");
    expect(deriveRecurringPackageKey(row.name)).toBe("package-b+train-2");
  });

  it("does not treat public-source observation years as the commercial cycle", () => {
    const row = project(2, "West Plant Annual Shutdown 2025", {
      sources: [
        {
          label: "Public shutdown notice published 2026",
          url: null,
          date: "2026-08-20",
        },
      ],
    });
    expect(deriveRecurringCycleLabel(row)).toEqual({
      cycleLabel: "2025",
      evidenceCodes: ["explicit_year_cycle"],
    });
  });

  it("classifies distinct explicit cycles as a likely recurring programme", () => {
    const result = review([
      project(1, "Example Mine Annual Shutdown 2024"),
      project(2, "Example Mine Annual Shutdown 2025"),
      project(3, "Example Mine Annual Shutdown 2026"),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      classification: "likely_recurring_programme",
      confidence: "high",
      projectIds: [1, 2, 3],
      cycleLabels: ["2024", "2025", "2026"],
      packageKeys: ["primary"],
      manualReviewRequired: true,
      countingTreatment: "application_overlay_non_counting",
      fullPotentialMonetaryImpactAud: 0,
    });
  });

  it("keeps same-cycle repeats in duplicate review rather than creating a new occurrence", () => {
    const result = review([
      project(10, "Example Fleet Tender 2026", {
        duplicateClusterId: "duplicate-cluster-1",
      }),
      project(11, "Example Fleet Tender 2026", {
        duplicateClusterId: "duplicate-cluster-1",
        sourcePurpose: "live_tender",
      }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      classification: "same_cycle_duplicate_review",
      confidence: "high",
      cycleLabels: ["2026"],
      projectIds: [10, 11],
    });
    expect(result.groups[0].evidenceCodes).toContain("shared_duplicate_cluster");
  });

  it("does not assign an unknown-cycle record to the one observed cycle", () => {
    const result = review([
      project(12, "Example Fleet Tender 2026"),
      project(13, "Example Fleet Tender"),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      classification: "insufficient_evidence",
      confidence: "low",
      cycleLabels: ["2026"],
      projectIds: [12, 13],
    });
    expect(result.groups[0].evidenceCodes).toContain("partial_cycle_evidence");
  });

  it("separates materially different packages inside the same programme and cycle", () => {
    const result = review([
      project(20, "LNG Turnaround 2026 Train 1 Package A", {
        location: "Example LNG Plant, Karratha WA",
        owner: "Example LNG",
      }),
      project(21, "LNG Turnaround 2026 Train 2 Package B", {
        location: "Example LNG Plant, Karratha WA",
        owner: "Example LNG",
      }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      classification: "materially_different_package_review",
      confidence: "medium",
      cycleLabels: ["2026"],
      packageKeys: ["package-a+train-1", "package-b+train-2"],
      projectIds: [20, 21],
    });
  });

  it("does not invent recurrence when cadence and cycle evidence are absent", () => {
    const result = review([
      project(30, "Regional Infrastructure Programme", {
        owner: "Example Authority",
        location: "Regional Water Network, NSW",
        projectState: "NSW",
      }),
      project(31, "Regional Infrastructure Programme", {
        owner: "Example Authority",
        location: "Regional Water Network, NSW",
        projectState: "NSW",
        sourcePurpose: "forward_plan",
      }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      classification: "insufficient_evidence",
      confidence: "low",
      cycleLabels: [],
      manualReviewRequired: true,
    });
  });

  it("does not collapse separate sites merely because they share an owner and state", () => {
    const result = review([
      project(40, "Annual Shutdown 2025", {
        location: "North Mine, Pilbara WA",
      }),
      project(41, "Annual Shutdown 2026", {
        location: "South Mine, Goldfields WA",
      }),
    ]);
    expect(result.groups).toHaveLength(0);
    expect(result.projects).toHaveLength(0);
  });

  it("is deterministic across input order and records zero commercial side effects", () => {
    const rows = [
      project(50, "Drilling Campaign 2025"),
      project(51, "Drilling Campaign 2026"),
    ];
    const first = review(rows);
    const second = review([...rows].reverse());
    expect(canonicalSha256(first)).toBe(canonicalSha256(second));
    expect(first.summary).toMatchObject({
      mode: "review_only_no_writes",
      manualReviewRequired: true,
      completeForBackfillApply: false,
      safety: {
        databaseConnections: 0,
        databaseWrites: 0,
        projectDateMutations: 0,
        projectMerges: 0,
        projectDeletions: 0,
        recurringProgrammesCreated: 0,
        recurringOccurrencesCreated: 0,
        recurringProjectLinksCreated: 0,
        projectActionsCreated: 0,
        fullPotentialActionsCreated: 0,
        fullPotentialMonetaryMutations: 0,
        crmC4cMutations: 0,
        providerCalls: 0,
        pipelineInvocations: 0,
        deployments: 0,
      },
    });
  });
});
