import { describe, expect, it } from "vitest";
import {
  FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  type FullPotentialPublicEvidenceRecord,
} from "../shared/fullPotentialPublicEvidence";
import {
  assertFullPotentialPrivatePlanningEnvelope,
  toFullPotentialPrivatePlanningAssumptions,
} from "../shared/fullPotentialPrivatePlanning";

function countingRecord(): FullPotentialPublicEvidenceRecord {
  return {
    recordKey: "ts4:private-planning-test",
    commercialPoolKey: "buyer:test:ts4",
    buyerAccountKey: "test-buyer",
    buyerName: "Test Buyer",
    buyerSegment: "rental_hire",
    application: "powered high-pressure project air",
    productFamily: "e_air",
    productCell: "TS4_20_25_bar",
    countingTreatment: "buyer_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "adoption_positions",
    scenarios: {
      low: {
        adoptionPositions: 1,
        averageSellingPriceAud: 100,
        addressableSharePct: 50,
      },
      base: {
        adoptionPositions: 2,
        averageSellingPriceAud: 200,
        addressableSharePct: 60,
      },
      high: {
        adoptionPositions: 3,
        averageSellingPriceAud: 300,
        addressableSharePct: 70,
      },
    },
    evidenceGrade: "C",
    sourceName: "Public test source",
    sourceUrl: "https://example.com/public-test-source",
    observedAt: "2026-08-21",
    publicObservation: "A public source shows relevant high-pressure equipment demand.",
    inference: "A synthetic adoption range is used only to validate the calculation contract.",
    modelBand: "TS4-TEST",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: ["Confirm local package scope before final approval."],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  };
}

describe("Full Potential private planning-value provenance", () => {
  it("attaches an opaque private value-set reference without exposing a price ladder", () => {
    const assumptions = toFullPotentialPrivatePlanningAssumptions({
      record: countingRecord(),
      planningValueSetRef: "electric-planning-2026-08-v1",
      planningValueBasis: "machine_only",
      localisationUpliftStatus: "excluded_tbc",
    });

    expect(assumptions).toMatchObject({
      publicEvidenceRecordKey: "ts4:private-planning-test",
      planningValueSetRef: "electric-planning-2026-08-v1",
      planningValueBasis: "machine_only",
      localisationUpliftStatus: "excluded_tbc",
    });
    expect(JSON.stringify(assumptions)).not.toContain("$80");
    expect(JSON.stringify(assumptions)).not.toContain("220000");
  });

  it("rejects a non-opaque reference that could expose commercial detail", () => {
    expect(() => assertFullPotentialPrivatePlanningEnvelope({
      record: countingRecord(),
      planningValueSetRef: "AUD 80k to 220k current pricing",
      planningValueBasis: "machine_only",
      localisationUpliftStatus: "excluded_tbc",
    })).toThrow("opaque non-sensitive reference");
  });

  it("rejects inconsistent machine-only localisation treatment", () => {
    expect(() => assertFullPotentialPrivatePlanningEnvelope({
      record: countingRecord(),
      planningValueSetRef: "electric-planning-v1",
      planningValueBasis: "machine_only",
      localisationUpliftStatus: "included",
    })).toThrow("machine_only planning values cannot claim localisation uplift is included");
  });

  it("rejects package values that leave localisation uplift unresolved", () => {
    expect(() => assertFullPotentialPrivatePlanningEnvelope({
      record: countingRecord(),
      planningValueSetRef: "electric-package-planning-v1",
      planningValueBasis: "locally_deployable_package",
      localisationUpliftStatus: "excluded_tbc",
    })).toThrow("locally_deployable_package values cannot exclude");
  });

  it("does not permit private monetary assumptions on a non-counting overlay", () => {
    const record = countingRecord();
    record.countingTreatment = "application_overlay_non_counting";
    record.scenarios = null;

    expect(() => assertFullPotentialPrivatePlanningEnvelope({
      record,
      planningValueSetRef: "electric-planning-v1",
      planningValueBasis: "machine_only",
      localisationUpliftStatus: "excluded_tbc",
    })).toThrow("buyer_counting records");
  });
});
