import { describe, expect, it } from "vitest";
import {
  activeClaimForLine,
  approvedModelLines,
  buildPilotSnapshot,
  calculatePilotSummary,
  createPursuitDraft,
  nextPilotStep,
  pursuitDraftErrors,
  type PilotPipelineClaim,
} from "./fullPotentialPilot";
import type {
  CommercialModelLine,
  CommercialWorkspace,
} from "./fullPotentialCommercialModel";

function workspace(overrides: Partial<CommercialWorkspace> = {}): CommercialWorkspace {
  const approvedModel = {
    id: 11,
    modelKey: "fp-model:272:v1",
    accountId: 272,
    versionNumber: 1,
    status: "approved" as const,
    methodologyVersion: "fp-v1",
    currentRevenueAud: "100000.00",
    totalPotentialAud: "500000.00",
    remainingPotentialAud: "400000.00",
    confidenceLevel: "medium" as const,
    assumptionsSummary: "Customer and channel evidence support a large-air fleet replacement pursuit.",
    createdBy: 1,
    createdByName: "Test User",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const line: CommercialModelLine = {
    id: 21,
    lineKey: "fp-line:11:portable_air_large:rental-fleet",
    modelId: 11,
    accountId: 272,
    productFamily: "portable_air_large",
    application: "Large-air rental fleet",
    routeToMarket: "direct_ape",
    currentSupplier: "Competitor",
    currentRevenueAud: "100000.00",
    knownAtlasFleetUnits: 2,
    estimatedTotalFleetUnits: 20,
    replacementCycleYears: "5.00",
    annualReplacementUnits: "4.00",
    averageSellingPriceAud: "150000.00",
    addressableSharePct: "25.00",
    equipmentPotentialAud: "150000.00",
    specialtyPotentialAud: "50000.00",
    linePotentialAud: "200000.00",
    replacementCycleSource: "Customer discovery",
    assumptions: null,
    confidenceLevel: "medium",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    account: {
      id: 272,
      canonicalName: "United Rentals",
      displayName: "United Rentals",
      rowClass: "account",
      routeToMarket: "direct_ape",
      fpStatus: "active_target",
      relationshipType: "standalone",
      recordStatus: "active",
      countsTowardPotential: true,
      currentRevenueAud: "100000.00",
      fullPotentialAud: "500000.00",
      remainingPotentialAud: "400000.00",
    },
    aliases: [],
    children: [],
    models: [approvedModel],
    latestModel: approvedModel,
    approvedModel,
    lines: [line],
    evidence: [
      {
        id: 31,
        accountId: 272,
        productFamily: "portable_air_large",
        evidenceType: "customer_discovery",
        title: "Fleet discussion",
        summary: "Customer confirmed fleet and replacement timing.",
        sourceName: "Customer discovery",
        confidenceLevel: "medium",
        status: "verified",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    evidenceLinks: [{ id: 41, modelId: 11, modelLineId: 21, evidenceId: 31 }],
    reviews: [],
    ...overrides,
  };
}

function claim(overrides: Partial<PilotPipelineClaim> = {}): PilotPipelineClaim {
  return {
    id: 51,
    userId: 1,
    sourceType: "full_potential",
    sourceAccountId: 272,
    productFamily: "portable_air_large",
    application: "Large-air rental fleet",
    commercialHypothesis: "Evidence-backed replacement pursuit",
    status: "identified",
    estimatedValueAud: "200000.00",
    nextAction: "Validate buying path",
    nextActionDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Full Potential top-five pilot helpers", () => {
  it("selects positive lines from the approved model only", () => {
    const data = workspace({
      lines: [
        workspace().lines[0],
        {
          ...workspace().lines[0],
          id: 22,
          modelId: 12,
          lineKey: "other-model-line",
        },
        {
          ...workspace().lines[0],
          id: 23,
          lineKey: "zero-line",
          linePotentialAud: "0.00",
        },
      ],
    });

    expect(approvedModelLines(data).map(line => line.id)).toEqual([21]);
  });

  it("detects an active claim for the same product family and application", () => {
    const line = workspace().lines[0];
    expect(activeClaimForLine([claim()], line)?.id).toBe(51);
    expect(activeClaimForLine([claim({ status: "lost" })], line)).toBeNull();
    expect(activeClaimForLine([claim({ application: "Different application" })], line)).toBeNull();
  });

  it("progresses the next step from evidence to model to pursuit to C4C handoff", () => {
    const noEvidence = workspace({ evidence: [], approvedModel: null, latestModel: null, models: [], lines: [] });
    expect(nextPilotStep(noEvidence, [])).toMatch(/capture the first/i);

    const approved = workspace();
    expect(nextPilotStep(approved, [])).toMatch(/start one attributed/i);
    expect(nextPilotStep(approved, [claim()])).toMatch(/first customer validation/i);
    expect(nextPilotStep(approved, [claim({ status: "qualified" })])).toMatch(/C4C/i);
  });

  it("builds account and cohort summaries from attributed pursuits", () => {
    const first = buildPilotSnapshot(272, workspace(), [claim({ status: "qualified" })]);
    const second = buildPilotSnapshot(415, null, []);
    const summary = calculatePilotSummary([first, second]);

    expect(first.approvedModel).toBe(true);
    expect(first.progressedClaimCount).toBe(1);
    expect(first.attributedValueAud).toBe(200000);
    expect(summary.loadedAccounts).toBe(1);
    expect(summary.approvedModels).toBe(1);
    expect(summary.attributedPursuits).toBe(1);
    expect(summary.attributedValueAud).toBe(200000);
  });

  it("prefills a pursuit only from the approved model and line", () => {
    const data = workspace();
    const draft = createPursuitDraft(data, data.lines[0]);

    expect(draft.productFamily).toBe("portable_air_large");
    expect(draft.application).toBe("Large-air rental fleet");
    expect(draft.commercialHypothesis).toContain("large-air fleet replacement");
    expect(draft.estimatedValueAud).toBe("200000.00");
    expect(draft.notes).toContain("fp-model:272:v1");
  });

  it("requires a target person or role and explicit CRM-boundary confirmation", () => {
    const data = workspace();
    const draft = createPursuitDraft(data, data.lines[0]);
    draft.nextAction = "Validate the fleet requirement";
    draft.nextActionDate = "2026-08-01";

    expect(pursuitDraftErrors(draft)).toContain("Add a customer contact name or the target customer role");
    expect(pursuitDraftErrors(draft).some(error => error.includes("not creating the formal C4C opportunity"))).toBe(true);

    draft.contactRole = "National Fleet Manager";
    draft.confirmed = true;
    expect(pursuitDraftErrors(draft)).toEqual([]);
  });

  it("excludes lost and not-relevant claims from attributed value", () => {
    const snapshot = buildPilotSnapshot(272, workspace(), [
      claim({ id: 1, status: "identified", estimatedValueAud: "100000" }),
      claim({ id: 2, status: "lost", estimatedValueAud: "200000" }),
      claim({ id: 3, status: "not_relevant", estimatedValueAud: "300000" }),
    ]);

    expect(snapshot.attributedClaimCount).toBe(3);
    expect(snapshot.attributedValueAud).toBe(100000);
  });
});
