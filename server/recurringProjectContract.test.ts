import { describe, expect, it } from "vitest";
import {
  assertRecurringOccurrenceContract,
  assertRecurringProgrammeContract,
  buildRecurringOccurrenceKey,
  buildRecurringProgrammeKey,
  buildRecurringWeeklyRecommendation,
  classifyRecurringOccurrenceCandidate,
  deriveRecurringCycleLabel,
  planNextRecurringWindow,
  type RecurringOccurrenceContract,
  type RecurringProgrammeContract,
} from "../shared/recurringProjectContract";

function programme(overrides: Partial<RecurringProgrammeContract> = {}): RecurringProgrammeContract {
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
    productFamilies: ["portable_air_large", "e_air"],
    applicationTags: ["shutdown_turnaround"],
    confidenceLevel: "high",
    ...overrides,
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
    priorOccurrenceKey: "acme-mine:annual-shutdown:2025:primary",
    scopeFingerprint: "scope-v1",
    sourceFingerprint: "source-v1",
    ...overrides,
  };
}

describe("Issue #132 recurring project contract", () => {
  it("creates stable programme and occurrence identities", () => {
    const programmeKey = buildRecurringProgrammeKey({
      buyerName: "Acme Mining Pty Ltd",
      siteName: "Acme Mine",
      programmeName: "Annual Shutdown",
    });
    expect(programmeKey).toBe("acme-mining-pty-ltd:acme-mine:annual-shutdown");
    expect(deriveRecurringCycleLabel("annual", "2026-10-01")).toBe("2026");
    expect(deriveRecurringCycleLabel("quarterly", "2026-10-01")).toBe("2026-Q4");
    expect(deriveRecurringCycleLabel("monthly", "2026-10-01")).toBe("2026-10");
    expect(buildRecurringOccurrenceKey({
      programmeKey,
      recurrenceType: "annual",
      startDate: "2026-10-01",
      packageKey: "Primary Air Package",
    })).toBe(`${programmeKey}:2026:primary-air-package`);
  });

  it("requires explicit labels and windows for irregular or rolling recurrence", () => {
    expect(() => deriveRecurringCycleLabel("irregular", "2026-10-01"))
      .toThrow("irregular recurrence requires an explicit cycle label");
    expect(() => planNextRecurringWindow({
      recurrenceType: "rolling",
      currentWindow: { startDate: "2026-10-01", endDate: "2026-10-21" },
    })).toThrow("rolling recurrence requires an explicit next window");
  });

  it("plans a new annual cycle without mutating the prior occurrence", () => {
    const prior = occurrence();
    const snapshot = structuredClone(prior);
    const nextWindow = planNextRecurringWindow({
      recurrenceType: "annual",
      currentWindow: prior.anticipatedWindow,
    });
    expect(nextWindow).toEqual({ startDate: "2027-10-01", endDate: "2027-10-21" });
    expect(prior).toEqual(snapshot);
  });

  it("handles month-end rollover deterministically", () => {
    expect(planNextRecurringWindow({
      recurrenceType: "monthly",
      currentWindow: { startDate: "2026-01-31", endDate: "2026-02-02" },
    })).toEqual({ startDate: "2026-02-28", endDate: "2026-03-02" });
  });

  it("updates one occurrence for the same programme, cycle and package", () => {
    const existing = occurrence();
    expect(classifyRecurringOccurrenceCandidate({
      existingOccurrences: [existing],
      candidate: occurrence(),
    })).toMatchObject({ decision: "no_change", targetOccurrenceKey: existing.occurrenceKey });

    expect(classifyRecurringOccurrenceCandidate({
      existingOccurrences: [existing],
      candidate: occurrence({
        status: "confirmed",
        confirmedWindow: { startDate: "2026-10-03", endDate: "2026-10-18" },
        sourceFingerprint: "source-v2",
      }),
    })).toMatchObject({
      decision: "update_existing_occurrence",
      targetOccurrenceKey: existing.occurrenceKey,
    });
  });

  it("never overwrites a materially different package in the same cycle", () => {
    const existing = occurrence();
    const candidate = occurrence({
      occurrenceKey: "acme-mine:annual-shutdown:2026:secondary-air-package",
      packageKey: "secondary-air-package",
      scopeFingerprint: "scope-secondary",
    });
    expect(classifyRecurringOccurrenceCandidate({
      existingOccurrences: [existing],
      candidate,
    })).toMatchObject({
      decision: "manual_review_separate_package",
      targetOccurrenceKey: existing.occurrenceKey,
    });
  });

  it("creates a new occurrence for a new cycle and preserves history", () => {
    const prior = occurrence();
    const next = occurrence({
      occurrenceKey: "acme-mine:annual-shutdown:2027:primary",
      cycleLabel: "2027",
      anticipatedWindow: { startDate: "2027-10-01", endDate: "2027-10-21" },
      priorOccurrenceKey: prior.occurrenceKey,
      canonicalProjectId: null,
      sourceFingerprint: "source-2027",
    });
    expect(classifyRecurringOccurrenceCandidate({
      existingOccurrences: [prior],
      candidate: next,
    })).toMatchObject({ decision: "create_new_occurrence", targetOccurrenceKey: null });
  });

  it("creates a weekly recommendation only inside the planning window", () => {
    const recommendation = buildRecurringWeeklyRecommendation({
      programmeId: 1,
      occurrenceId: 2,
      programme: programme(),
      occurrence: occurrence(),
      asOfDate: "2026-08-22",
      accountId: 123,
      projectId: 456,
      signalId: 789,
      fullPotentialContext: {
        accountName: "Acme Mining",
        productFamily: "Large Air / E-Air",
      },
    });
    expect(recommendation).toMatchObject({
      recommendationKey: "recurring:1:2:123:789",
      accountId: 123,
      projectId: 456,
      signalId: 789,
      requiresUserAcceptance: true,
      durableActionCreated: false,
      countingTreatment: "application_overlay_non_counting",
      fullPotentialMonetaryImpactAud: 0,
    });
    expect(recommendation?.whyNow).toContain("planning window");
    expect(recommendation?.recommendedAction).toContain("Acme Mining");

    expect(buildRecurringWeeklyRecommendation({
      programmeId: 1,
      occurrenceId: 2,
      programme: programme(),
      occurrence: occurrence(),
      asOfDate: "2026-01-01",
    })).toBeNull();
  });

  it("does not suggest completed, cancelled or superseded occurrences", () => {
    for (const status of ["completed", "cancelled", "superseded"] as const) {
      expect(buildRecurringWeeklyRecommendation({
        programmeId: 1,
        occurrenceId: 2,
        programme: programme(),
        occurrence: occurrence({ status }),
        asOfDate: "2026-08-22",
      })).toBeNull();
    }
  });

  it("validates core programme and occurrence invariants", () => {
    expect(() => assertRecurringProgrammeContract(programme())).not.toThrow();
    expect(() => assertRecurringOccurrenceContract(occurrence())).not.toThrow();
    expect(() => assertRecurringProgrammeContract(programme({ usualLeadTimeDays: 999 })))
      .toThrow("usualLeadTimeDays");
    expect(() => assertRecurringOccurrenceContract(occurrence({
      anticipatedWindow: { startDate: "2026-10-21", endDate: "2026-10-01" },
    }))).toThrow("end date must not precede start date");
  });
});
