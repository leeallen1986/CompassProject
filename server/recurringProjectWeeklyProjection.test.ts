import { describe, expect, it } from "vitest";
import type { RecurringWeeklyRecommendation } from "../shared/recurringProjectContract";
import { projectRecurringRecommendationsForWeek } from "./recurringProjectWeeklyProjection";

function recommendation(
  overrides: Partial<RecurringWeeklyRecommendation> = {},
): RecurringWeeklyRecommendation {
  return {
    recommendationKey: "recurring:1:2:123:789",
    programmeId: 1,
    occurrenceId: 2,
    accountId: 123,
    projectId: 456,
    signalId: 789,
    programmeName: "Acme Mine annual shutdown",
    cycleLabel: "2026",
    nextExpectedWindow: { startDate: "2026-10-01", endDate: "2026-10-21" },
    whyNow: "The programme has entered its planning window.",
    recommendedAction: "Confirm timing, compressed-air requirement and route to buy.",
    urgency: "high",
    dueDate: "2026-09-05",
    requiresUserAcceptance: true,
    durableActionCreated: false,
    countingTreatment: "application_overlay_non_counting",
    fullPotentialMonetaryImpactAud: 0,
    ...overrides,
  };
}

describe("Issue #132 recurring weekly projection", () => {
  it("projects recurrence, signal and Full Potential account context without creating an action", () => {
    const result = projectRecurringRecommendationsForWeek({
      userId: 10,
      asOfDate: "2026-08-22",
      recommendations: [recommendation()],
      decisions: [],
      projects: [{ projectId: 456, projectName: "Acme Shutdown 2026" }],
    });
    expect(result.projectedActions).toEqual([expect.objectContaining({
      type: "recurring_project_window",
      actionKey: "recurring:1:2:123:789",
      projectId: 456,
      projectName: "Acme Shutdown 2026",
      accountId: 123,
      signalId: 789,
      requiresUserAcceptance: true,
      durableActionCreated: false,
      fullPotentialMonetaryImpactAud: 0,
    })]);
    expect(result.invariants).toEqual({
      durableActionsCreated: 0,
      projectActionsCreated: 0,
      fullPotentialActionsCreated: 0,
      fullPotentialMonetaryMutations: 0,
    });
  });

  it("deduplicates projected actions", () => {
    const result = projectRecurringRecommendationsForWeek({
      userId: 10,
      asOfDate: "2026-08-22",
      recommendations: [recommendation(), recommendation()],
      decisions: [],
      projects: [],
    });
    expect(result.projectedActions).toHaveLength(1);
    expect(result.suppressed).toContainEqual({
      recommendationKey: "recurring:1:2:123:789",
      reason: "duplicate",
    });
  });

  it("suppresses accepted, rejected and currently deferred recommendations", () => {
    for (const decision of ["accepted", "not_relevant", "dismissed"] as const) {
      const result = projectRecurringRecommendationsForWeek({
        userId: 10,
        asOfDate: "2026-08-22",
        recommendations: [recommendation()],
        decisions: [{ recommendationKey: recommendation().recommendationKey, userId: 10, decision }],
        projects: [],
      });
      expect(result.projectedActions).toEqual([]);
      expect(result.suppressed[0].reason).toBe("already_decided");
    }

    const deferred = projectRecurringRecommendationsForWeek({
      userId: 10,
      asOfDate: "2026-08-22",
      recommendations: [recommendation()],
      decisions: [{
        recommendationKey: recommendation().recommendationKey,
        userId: 10,
        decision: "deferred",
        deferredUntil: "2026-09-15",
      }],
      projects: [],
    });
    expect(deferred.projectedActions).toEqual([]);
    expect(deferred.suppressed[0].reason).toBe("deferred");
  });

  it("re-presents a deferred recommendation after its date", () => {
    const result = projectRecurringRecommendationsForWeek({
      userId: 10,
      asOfDate: "2026-09-16",
      recommendations: [recommendation()],
      decisions: [{
        recommendationKey: recommendation().recommendationKey,
        userId: 10,
        decision: "deferred",
        deferredUntil: "2026-09-15",
      }],
      projects: [],
    });
    expect(result.projectedActions).toHaveLength(1);
  });

  it("requires a linked project or Full Potential account", () => {
    const result = projectRecurringRecommendationsForWeek({
      userId: 10,
      asOfDate: "2026-08-22",
      recommendations: [recommendation({ projectId: null, accountId: null })],
      decisions: [],
      projects: [],
    });
    expect(result.projectedActions).toEqual([]);
    expect(result.suppressed[0].reason).toBe("missing_account_and_project");
  });

  it("rejects a recommendation that violates the acceptance-only contract", () => {
    expect(() => projectRecurringRecommendationsForWeek({
      userId: 10,
      asOfDate: "2026-08-22",
      recommendations: [recommendation({ durableActionCreated: true as never })],
      decisions: [],
      projects: [],
    })).toThrow("violates the projection-only contract");
  });

  it("orders urgent recommendations before high and medium", () => {
    const result = projectRecurringRecommendationsForWeek({
      userId: 10,
      asOfDate: "2026-08-22",
      recommendations: [
        recommendation({ recommendationKey: "medium", urgency: "medium", projectId: 1 }),
        recommendation({ recommendationKey: "urgent", urgency: "urgent", projectId: 2 }),
        recommendation({ recommendationKey: "high", urgency: "high", projectId: 3 }),
      ],
      decisions: [],
      projects: [],
    });
    expect(result.projectedActions.map(row => row.actionKey)).toEqual(["urgent", "high", "medium"]);
  });
});
