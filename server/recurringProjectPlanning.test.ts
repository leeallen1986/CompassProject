import { describe, expect, it } from "vitest";
import type {
  RecurringOccurrenceContract,
  RecurringProgrammeContract,
} from "../shared/recurringProjectContract";
import {
  buildRecurringProjectPlanningManifest,
  verifyRecurringProjectPlanningManifest,
} from "./recurringProjectPlanning";

function programme(): RecurringProgrammeContract {
  return {
    programmeKey: "acme-mine:annual-shutdown",
    programmeName: "Acme Mine annual shutdown",
    recurrenceType: "annual",
    status: "active",
    buyerName: "Acme Mining",
    siteName: "Acme Mine",
    fullPotentialAccountId: 123,
    routeToMarket: "direct_ape",
    ownerName: "Example Rep",
    usualLeadTimeDays: 90,
    productFamilies: ["portable_air_large"],
    applicationTags: ["shutdown_turnaround"],
    confidenceLevel: "high",
  };
}

function occurrence(overrides: Partial<RecurringOccurrenceContract> = {}): RecurringOccurrenceContract {
  return {
    occurrenceKey: "acme-mine:annual-shutdown:2026:primary",
    programmeKey: "acme-mine:annual-shutdown",
    cycleLabel: "2026",
    packageKey: "primary",
    status: "anticipated",
    anticipatedWindow: { startDate: "2026-10-01", endDate: "2026-10-21" },
    confirmedWindow: null,
    canonicalProjectId: 456,
    priorOccurrenceKey: null,
    scopeFingerprint: "scope-v1",
    sourceFingerprint: "source-v1",
    ...overrides,
  };
}

function input() {
  return {
    generatedAt: "2026-08-22T01:00:00.000Z",
    generatedByRef: "issue132-review-v1",
    sourceSnapshotRef: "project-snapshot-v1",
    programmeId: 1,
    occurrenceId: 2,
    programme: programme(),
    existingOccurrences: [] as RecurringOccurrenceContract[],
    candidateOccurrence: occurrence(),
    existingProjectLinks: [],
    proposedProjectLinks: [{
      projectId: 456,
      occurrenceKey: "acme-mine:annual-shutdown:2026:primary",
      relationshipType: "canonical" as const,
      reason: "Public project row selected as the canonical occurrence record.",
    }],
    asOfDate: "2026-08-22",
    accountId: 123,
    signalId: 789,
    fullPotentialContext: {
      accountName: "Acme Mining",
      productFamily: "Large Air",
    },
  };
}

describe("Issue #132 recurring project planning manifest", () => {
  it("builds a deterministic preview-only create manifest", () => {
    const first = buildRecurringProjectPlanningManifest(input());
    const second = buildRecurringProjectPlanningManifest(input());
    expect(first.manifestSha256).toBe(second.manifestSha256);
    expect(first).toMatchObject({
      mode: "preview_only_no_writes",
      programmeOperation: "reference_existing",
      occurrenceProposal: {
        operation: "create",
        targetOccurrenceKey: null,
      },
      projectLinkProposals: [{
        projectId: 456,
        relationshipType: "canonical",
      }],
      weeklyRecommendation: {
        accountId: 123,
        projectId: 456,
        signalId: 789,
        requiresUserAcceptance: true,
        durableActionCreated: false,
        countingTreatment: "application_overlay_non_counting",
        fullPotentialMonetaryImpactAud: 0,
      },
      invariants: {
        databaseConnections: 0,
        databaseWrites: 0,
        projectDateMutations: 0,
        projectDeletes: 0,
        projectMerges: 0,
        fullPotentialMonetaryMutations: 0,
        durableActionsCreated: 0,
        crmC4cMutations: 0,
        providerCalls: 0,
        pipelineInvocations: 0,
      },
    });
    expect(() => verifyRecurringProjectPlanningManifest(first)).not.toThrow();
  });

  it("emits no write proposal for an unchanged repeated source", () => {
    const current = occurrence();
    const manifest = buildRecurringProjectPlanningManifest({
      ...input(),
      existingOccurrences: [current],
    });
    expect(manifest.occurrenceProposal.operation).toBe("none");
    expect(manifest.occurrenceProposal.reason).toContain("no material change");
  });

  it("previews an audited update for changed dates in the same cycle", () => {
    const current = occurrence();
    const manifest = buildRecurringProjectPlanningManifest({
      ...input(),
      existingOccurrences: [current],
      candidateOccurrence: occurrence({
        status: "confirmed",
        confirmedWindow: { startDate: "2026-10-03", endDate: "2026-10-18" },
        sourceFingerprint: "source-v2",
      }),
    });
    expect(manifest.occurrenceProposal).toMatchObject({
      operation: "update",
      targetOccurrenceKey: current.occurrenceKey,
    });
    expect(manifest.invariants.projectDateMutations).toBe(0);
  });

  it("fails closed when a project is already linked to another occurrence", () => {
    expect(() => buildRecurringProjectPlanningManifest({
      ...input(),
      existingProjectLinks: [{
        projectId: 456,
        occurrenceKey: "another-programme:2026:primary",
        relationshipType: "canonical",
      }],
    })).toThrow("already linked to occurrence another-programme:2026:primary");
  });

  it("allows several preserved source projects but only one canonical project", () => {
    const manifest = buildRecurringProjectPlanningManifest({
      ...input(),
      proposedProjectLinks: [
        input().proposedProjectLinks[0],
        {
          projectId: 457,
          occurrenceKey: "acme-mine:annual-shutdown:2026:primary",
          relationshipType: "historic_duplicate",
          reason: "Historic duplicate retained as supporting evidence.",
        },
      ],
    });
    expect(manifest.projectLinkProposals).toHaveLength(2);

    expect(() => buildRecurringProjectPlanningManifest({
      ...input(),
      proposedProjectLinks: [
        input().proposedProjectLinks[0],
        {
          projectId: 457,
          occurrenceKey: "acme-mine:annual-shutdown:2026:primary",
          relationshipType: "canonical",
          reason: "Invalid second canonical project.",
        },
      ],
    })).toThrow("more than one canonical project");
  });

  it("blocks automatic links for a materially different package", () => {
    const current = occurrence();
    const candidate = occurrence({
      occurrenceKey: "acme-mine:annual-shutdown:2026:secondary",
      packageKey: "secondary",
      scopeFingerprint: "scope-secondary",
    });
    const manifest = buildRecurringProjectPlanningManifest({
      ...input(),
      existingOccurrences: [current],
      candidateOccurrence: candidate,
      proposedProjectLinks: [{
        projectId: 458,
        occurrenceKey: candidate.occurrenceKey,
        relationshipType: "canonical",
        reason: "Candidate secondary package.",
      }],
    });
    expect(manifest.occurrenceProposal.operation).toBe("manual_review");
    expect(manifest.projectLinkProposals).toEqual([]);
    expect(manifest.weeklyRecommendation).toBeNull();
  });

  it("detects tampering and side-effect drift", () => {
    const manifest = buildRecurringProjectPlanningManifest(input());
    expect(() => verifyRecurringProjectPlanningManifest({
      ...manifest,
      generatedByRef: "changed-ref",
    })).toThrow("SHA-256 mismatch");

    const unsafe = structuredClone(manifest);
    unsafe.invariants.databaseWrites = 1 as never;
    expect(() => verifyRecurringProjectPlanningManifest(unsafe)).toThrow();
  });
});
