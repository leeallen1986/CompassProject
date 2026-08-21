import { describe, expect, it } from "vitest";
import { FP_PUBLIC_EVIDENCE_METHOD_VERSION } from "../shared/fullPotentialPublicEvidence";
import type { FullPotentialPublicObservationRecord } from "../shared/fullPotentialPublicDraftPack";
import {
  assertFullPotentialReconciliationComplete,
  reconcileFullPotentialPublicBuyers,
} from "../shared/fullPotentialAccountReconciliation";
import {
  buildFullPotentialAccountReconciliationReport,
  verifyFullPotentialAccountReconciliationReport,
} from "./fullPotentialAccountReconciliationReport";

function allowance(): FullPotentialPublicObservationRecord {
  return {
    recordKey: "allowance:ts4:direct-powered-projects",
    commercialPoolKey: "allowance:ts4:direct-powered-projects",
    buyerAccountKey: "ts4-direct-powered-project-allowance",
    buyerName: "TS4 direct powered-project allowance",
    buyerSegment: "mining_direct",
    application: "direct powered-site high-pressure electric adoption",
    productFamily: "e_air",
    productCell: "TS4_direct_powered_project_allowance",
    countingTreatment: "buyer_counting",
    valueClass: "unobserved_allowance",
    scenarioBasis: "adoption_positions",
    evidenceGrade: "C",
    sourceName: "Example public application source",
    sourceUrl: "https://example.com/public-high-pressure-applications",
    observedAt: "2026-08-21",
    publicObservation: "Public sources show high-pressure demand on powered projects.",
    inference: "A separately labelled allowance remains management-only until replaced by named buyers.",
    modelBand: "TS4-DIRECT-ALLOWANCE",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: ["Replace the allowance with named public buyers before import."],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  };
}

function namedBuyer(): FullPotentialPublicObservationRecord {
  return {
    ...allowance(),
    recordKey: "rental:example:portable-air",
    commercialPoolKey: "buyer:example:rental-portable-air",
    buyerAccountKey: "example-rental-au",
    buyerName: "Example Rental",
    buyerSegment: "rental_hire",
    application: "rental fleet replacement",
    productFamily: "other",
    productCell: "rental_portable_air_blended",
    valueClass: "named_evidenced_core",
    scenarioBasis: "fleet_replacement",
    evidenceGrade: "B",
    modelBand: "P2",
    addressabilityStatus: "addressable_now",
    qualificationGates: [],
  };
}

const account = {
  id: 101,
  stableKey: "example-rental|account|au|national|direct_ape",
  canonicalName: "Example Rental Pty Ltd",
  displayName: "Example Rental",
  parentGroup: null,
  rowClass: "account" as const,
  relationshipType: "standalone",
  recordStatus: "active" as const,
  countsTowardPotential: true,
  mergedIntoAccountId: null,
  country: "AU",
  routeToMarket: "direct_ape",
};

describe("Full Potential allowance reconciliation boundary", () => {
  it("classifies an unobserved monetary allowance as management-only", () => {
    const summary = reconcileFullPotentialPublicBuyers([allowance()], [], []);
    expect(summary).toMatchObject({
      recordCount: 1,
      buyerCountingCount: 0,
      matchedCount: 0,
      unmatchedCount: 0,
      ambiguousCount: 0,
      nonCountingCount: 1,
    });
    expect(summary.results[0]).toMatchObject({
      disposition: "not_buyer_counting",
      matchedAccountId: null,
    });
    expect(summary.results[0].reason).toContain("management-only");
    expect(() => assertFullPotentialReconciliationComplete(summary)).not.toThrow();
  });

  it("does not require an account target for the allowance in a complete report", () => {
    const report = buildFullPotentialAccountReconciliationReport(
      [namedBuyer(), allowance()],
      {
        snapshotRef: "reconciliation-allowance-test-v1",
        capturedAt: "2026-08-21T00:00:00.000Z",
        accounts: [account],
        aliases: [],
      },
    );

    expect(report).toMatchObject({
      publicRecordCount: 2,
      requiredBuyerIdentityCount: 1,
      completeForDraftImport: true,
    });
    expect(report.importTargets).toHaveLength(1);
    expect(report.importTargets[0]).toMatchObject({
      buyerAccountKey: "example-rental-au",
      accountId: 101,
    });
    expect(report.summary.nonCountingCount).toBe(1);
    expect(() => verifyFullPotentialAccountReconciliationReport(report)).not.toThrow();
  });
});
