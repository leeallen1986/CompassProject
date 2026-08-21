import { describe, expect, it } from "vitest";
import type { FullPotentialSeptemberManagementView } from "../shared/fullPotentialManagementView";
import { assessFullPotentialManagementReadiness } from "../shared/fullPotentialManagementReadiness";

function view(
  overrides: Partial<FullPotentialSeptemberManagementView> = {},
): FullPotentialSeptemberManagementView {
  return {
    methodologyVersion: "fp-public-v1",
    generatedFromRecordCount: 25,
    countingRecordCount: 25,
    nonCountingRecordCount: 0,
    headline: {
      namedEvidencedCore: { lowAud: 10, baseAud: 20, highAud: 30 },
      regionalLongTail: { lowAud: 0, baseAud: 0, highAud: 0 },
      unobservedAllowance: { lowAud: 0, baseAud: 0, highAud: 0 },
      total: { lowAud: 10, baseAud: 20, highAud: 30 },
    },
    addressability: {
      addressableNow: { lowAud: 10, baseAud: 20, highAud: 30 },
      conditional: { lowAud: 0, baseAud: 0, highAud: 0 },
      portfolioGapRecordCount: 0,
      excludedRecordCount: 0,
    },
    confidence: [],
    buyerSegments: [{
      key: "rental_hire",
      label: "Rental Hire",
      recordCount: 25,
      lowAud: 10,
      baseAud: 20,
      highAud: 30,
      shareOfBasePct: 100,
      currentRevenueAud: null,
      currentRevenuePeriod: null,
      currentRevenueSourceReference: null,
      remainingBasePotentialAud: null,
    }],
    productCells: [],
    qualificationGaps: [],
    reconciliation: {
      buyerSegmentBaseAud: 20,
      headlineBaseAud: 20,
      differenceAud: 0,
      reconciled: true,
    },
    governanceNotes: [],
    ...overrides,
  };
}

describe("Full Potential management readiness", () => {
  it("allows the meeting headline to proceed while aggregate Rental revenue is pending", () => {
    const readiness = assessFullPotentialManagementReadiness(view(), {
      expectedCurrentRevenueSegments: ["rental_hire"],
      planningStatus: "provisional",
      localisationCostStatus: "tbc",
      accountReconciliationStatus: "not_run",
    });

    expect(readiness).toMatchObject({
      meetingStatus: "ready_with_declared_gaps",
      headlineAvailable: true,
      currentVsPotentialGapAvailable: false,
      draftImportReady: false,
      missingCurrentRevenueSegments: ["rental_hire"],
    });
    expect(readiness.dataGaps.map(gap => gap.key)).toEqual([
      "aggregate_current_revenue_pending",
      "planning_values_provisional",
      "localisation_cost_tbc",
      "canonical_account_reconciliation_incomplete",
    ]);
    expect(readiness.dataGaps.every(gap => gap.blocksHeadline === false)).toBe(true);
  });

  it("never converts missing current revenue to zero or a false remaining-potential result", () => {
    const readiness = assessFullPotentialManagementReadiness(view(), {
      expectedCurrentRevenueSegments: ["rental_hire"],
      planningStatus: "reviewed",
      localisationCostStatus: "estimated",
      accountReconciliationStatus: "complete",
    });
    expect(readiness.currentVsPotentialGapAvailable).toBe(false);
    expect(view().buyerSegments[0].currentRevenueAud).toBeNull();
    expect(view().buyerSegments[0].remainingBasePotentialAud).toBeNull();
  });

  it("becomes fully ready when aggregate revenue and gating inputs are supplied", () => {
    const readyView = view({
      buyerSegments: [{
        ...view().buyerSegments[0],
        currentRevenueAud: 5,
        currentRevenuePeriod: "rolling 12 months",
        currentRevenueSourceReference: "aggregate-rental-ledger-v1",
        remainingBasePotentialAud: 15,
      }],
    });
    const readiness = assessFullPotentialManagementReadiness(readyView, {
      expectedCurrentRevenueSegments: ["rental_hire"],
      planningStatus: "approved",
      localisationCostStatus: "costed",
      accountReconciliationStatus: "complete",
    });
    expect(readiness).toMatchObject({
      meetingStatus: "ready",
      headlineAvailable: true,
      currentVsPotentialGapAvailable: true,
      draftImportReady: true,
      missingCurrentRevenueSegments: [],
      dataGaps: [],
    });
  });

  it("blocks only when the meeting is made dependent on a live deployment", () => {
    const readiness = assessFullPotentialManagementReadiness(view(), {
      expectedCurrentRevenueSegments: [],
      planningStatus: "reviewed",
      localisationCostStatus: "estimated",
      accountReconciliationStatus: "complete",
      liveDeploymentRequired: true,
    });
    expect(readiness).toMatchObject({
      meetingStatus: "blocked",
      headlineAvailable: false,
    });
    expect(readiness.dataGaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "live_deployment_dependency",
        severity: "blocker",
        blocksHeadline: true,
      }),
    ]));
  });
});
