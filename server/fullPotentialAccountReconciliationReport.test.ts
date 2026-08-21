import { describe, expect, it } from "vitest";
import { FP_PUBLIC_EVIDENCE_METHOD_VERSION } from "../shared/fullPotentialPublicEvidence";
import type { FullPotentialPublicObservationRecord } from "../shared/fullPotentialPublicDraftPack";
import {
  buildFullPotentialAccountReconciliationReport,
  verifyFullPotentialAccountReconciliationReport,
  type FullPotentialAccountSnapshot,
} from "./fullPotentialAccountReconciliationReport";

function record(overrides: Partial<FullPotentialPublicObservationRecord> = {}): FullPotentialPublicObservationRecord {
  return {
    recordKey: "rental:example:public-core-v1",
    commercialPoolKey: "buyer:example:rental-portable-air",
    buyerAccountKey: "example-rental-au",
    buyerName: "Example Rental",
    buyerSegment: "rental_hire",
    application: "rental portable-air fleet replacement and refresh",
    productFamily: "other",
    productCell: "rental_portable_air_blended",
    countingTreatment: "buyer_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "fleet_replacement",
    evidenceGrade: "B",
    sourceName: "Example public catalogue",
    sourceUrl: "https://example.com/public-catalogue",
    observedAt: "2026-08-21",
    publicObservation: "The public catalogue lists several portable compressor bands.",
    inference: "A transparent band is used without asserting an exact customer fleet count.",
    modelBand: "P3",
    addressabilityStatus: "addressable_now",
    qualificationGates: [],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
    ...overrides,
  };
}

function snapshot(overrides: Partial<FullPotentialAccountSnapshot> = {}): FullPotentialAccountSnapshot {
  return {
    snapshotRef: "prod-readonly-test-v1",
    capturedAt: "2026-08-21T13:00:00.000Z",
    accounts: [{
      id: 101,
      stableKey: "example-rental|account|au|national|direct_ape",
      canonicalName: "Example Rental Pty Ltd",
      displayName: "Example Rental",
      parentGroup: null,
      rowClass: "account",
      relationshipType: "standalone",
      recordStatus: "active",
      countsTowardPotential: true,
      mergedIntoAccountId: null,
      country: "AU",
      routeToMarket: "direct_ape",
    }],
    aliases: [],
    ...overrides,
  };
}

describe("Full Potential offline reconciliation report", () => {
  it("builds a deterministic complete read-only account-target report", () => {
    const first = buildFullPotentialAccountReconciliationReport([record()], snapshot());
    const second = buildFullPotentialAccountReconciliationReport([record()], snapshot());

    expect(first.reportSha256).toBe(second.reportSha256);
    expect(first).toMatchObject({
      version: 1,
      snapshotRef: "prod-readonly-test-v1",
      publicRecordCount: 1,
      requiredBuyerIdentityCount: 1,
      completeForDraftImport: true,
      unresolvedRecordKeys: [],
      summary: {
        buyerCountingCount: 1,
        matchedCount: 1,
        unmatchedCount: 0,
        ambiguousCount: 0,
      },
      invariants: {
        databaseConnections: 0,
        databaseWrites: 0,
        accountMutations: 0,
        crmWrites: 0,
        providerCalls: 0,
        pipelineInvocations: 0,
      },
    });
    expect(first.importTargets).toEqual([{
      buyerAccountKey: "example-rental-au",
      accountId: 101,
      stableKey: "example-rental|account|au|national|direct_ape",
      routeToMarket: "direct_ape",
      countsTowardPotential: true,
      recordStatus: "active",
      rowClass: "account",
    }]);
    expect(() => verifyFullPotentialAccountReconciliationReport(first)).not.toThrow();
  });

  it("reports unmatched and ambiguous rows without inventing a target", () => {
    const unmatched = buildFullPotentialAccountReconciliationReport(
      [record({ buyerName: "Different Rental", buyerAccountKey: "different-rental-au" })],
      snapshot(),
    );
    expect(unmatched).toMatchObject({
      completeForDraftImport: false,
      unresolvedRecordKeys: ["rental:example:public-core-v1"],
      importTargets: [],
      summary: { unmatchedCount: 1, ambiguousCount: 0 },
    });

    const ambiguous = buildFullPotentialAccountReconciliationReport(
      [record()],
      snapshot({
        accounts: [
          ...snapshot().accounts,
          {
            ...snapshot().accounts[0],
            id: 102,
            stableKey: "example-rental|account|au|national|manual_review",
            routeToMarket: "manual_review",
          },
        ],
      }),
    );
    expect(ambiguous).toMatchObject({
      completeForDraftImport: false,
      unresolvedRecordKeys: ["rental:example:public-core-v1"],
      importTargets: [],
      summary: { unmatchedCount: 0, ambiguousCount: 1 },
    });
  });

  it("allows distinct commercial pools for one public buyer identity to share one canonical target", () => {
    const report = buildFullPotentialAccountReconciliationReport([
      record(),
      record({
        recordKey: "rental:example:ts2-adoption",
        commercialPoolKey: "buyer:example:ts2-adoption",
        productFamily: "e_air",
        productCell: "TS2_specialist_rental_electric",
        scenarioBasis: "adoption_positions",
      }),
    ], snapshot());

    expect(report).toMatchObject({
      requiredBuyerIdentityCount: 1,
      completeForDraftImport: true,
      summary: { buyerCountingCount: 2, matchedCount: 2 },
    });
    expect(report.importTargets).toHaveLength(1);
    expect(() => verifyFullPotentialAccountReconciliationReport(report)).not.toThrow();
  });

  it("rejects malformed snapshots and tampered reports", () => {
    expect(() => buildFullPotentialAccountReconciliationReport([record()], snapshot({
      snapshotRef: "contains a space",
    }))).toThrow("snapshotRef must be an opaque non-sensitive reference");

    expect(() => buildFullPotentialAccountReconciliationReport([record()], snapshot({
      aliases: [{ accountId: 999, aliasName: "Missing" }],
    }))).toThrow("Alias references missing snapshot account 999");

    const report = buildFullPotentialAccountReconciliationReport([record()], snapshot());
    expect(() => verifyFullPotentialAccountReconciliationReport({
      ...report,
      snapshotRef: "changed-ref",
    })).toThrow("SHA-256 mismatch");
  });
});
