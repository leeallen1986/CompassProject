import { describe, expect, it } from "vitest";
import {
  calculateModelLinePreview,
  lineEvidenceIds,
  modelApprovalReadiness,
  modelEligibilityReasons,
  modelLineValidationErrors,
  modelSubmissionReadiness,
  type CommercialAccount,
  type CommercialEvidence,
  type CommercialModel,
  type CommercialModelLine,
  type ModelLineDraftPayload,
} from "./fullPotentialCommercialModel";

function line(overrides: Partial<CommercialModelLine> = {}): CommercialModelLine {
  return {
    id: 11,
    lineKey: "line-11",
    modelId: 5,
    accountId: 1,
    productFamily: "portable_air_large",
    application: "Large air rental fleet",
    routeToMarket: "direct_ape",
    linePotentialAud: "750000.00",
    confidenceLevel: "medium",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function model(overrides: Partial<CommercialModel> = {}): CommercialModel {
  return {
    id: 5,
    modelKey: "model-5",
    accountId: 1,
    versionNumber: 1,
    status: "draft",
    methodologyVersion: "fp-v1",
    confidenceLevel: "medium",
    createdBy: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("commercial model UI helpers", () => {
  it("mirrors the server replacement-cycle calculation", () => {
    const preview = calculateModelLinePreview({
      estimatedTotalFleetUnits: "100",
      replacementCycleYears: "5",
      averageSellingPriceAud: "150000",
      addressableSharePct: "25",
    });

    expect(preview.annualReplacementUnits).toBe(20);
    expect(preview.equipmentPotentialAud).toBe(750000);
    expect(preview.linePotentialAud).toBe(750000);
  });

  it("uses an explicit annual replacement estimate and adds specialty potential", () => {
    const preview = calculateModelLinePreview({
      estimatedTotalFleetUnits: "1000",
      replacementCycleYears: "2",
      annualReplacementUnits: "12.5",
      averageSellingPriceAud: "150000",
      addressableSharePct: "25",
      specialtyPotentialAud: "125000",
    });

    expect(preview.annualReplacementUnits).toBe(12.5);
    expect(preview.equipmentPotentialAud).toBe(468750);
    expect(preview.linePotentialAud).toBe(593750);
  });

  it("does not display invented equipment potential when inputs are incomplete", () => {
    const preview = calculateModelLinePreview({
      estimatedTotalFleetUnits: "100",
      replacementCycleYears: "5",
      averageSellingPriceAud: "",
      addressableSharePct: "25",
    });

    expect(preview.equipmentPotentialAud).toBe(0);
    expect(preview.linePotentialAud).toBe(0);
  });

  it("reports model-line evidence and confidence gaps before save", () => {
    const input: ModelLineDraftPayload = {
      modelId: 5,
      productFamily: "portable_air_large",
      application: "Large air rental fleet",
      routeToMarket: "direct_ape",
      addressableSharePct: "101",
      confidenceLevel: "unknown",
      evidenceIds: [],
    };

    expect(modelLineValidationErrors(input)).toEqual([
      "Addressable share must be between 0 and 100",
      "Choose a confidence level before submission",
      "Link at least one evidence record",
    ]);
  });

  it("keeps merged and non-counting account rows out of new models", () => {
    const account = {
      id: 1,
      canonicalName: "Duplicate account",
      rowClass: "account",
      routeToMarket: "direct_ape",
      fpStatus: "develop",
      relationshipType: "duplicate",
      recordStatus: "merged",
      countsTowardPotential: false,
    } as CommercialAccount;

    expect(modelEligibilityReasons(account)).toEqual([
      "This record is excluded from potential counting",
      "Record status is merged",
    ]);
  });

  it("requires positive, evidenced lines before model submission", () => {
    const result = modelSubmissionReadiness(
      model(),
      [line({ linePotentialAud: "0.00", confidenceLevel: "unknown" })],
      [],
    );

    expect(result.ready).toBe(false);
    expect(result.issues).toHaveLength(3);
  });

  it("requires verified evidence for manager approval", () => {
    const links = [{ id: 1, modelId: 5, modelLineId: 11, evidenceId: 21 }];
    const evidence = [{
      id: 21,
      accountId: 1,
      evidenceType: "customer_discovery",
      title: "Fleet evidence",
      summary: "Customer supplied fleet estimate",
      confidenceLevel: "medium",
      status: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
    }] as CommercialEvidence[];

    expect(lineEvidenceIds(11, links)).toEqual([21]);
    expect(modelApprovalReadiness(model({ status: "submitted" }), [line()], links, evidence).ready)
      .toBe(false);

    evidence[0].status = "verified";
    expect(modelApprovalReadiness(model({ status: "submitted" }), [line()], links, evidence).ready)
      .toBe(true);
  });
});
