import { describe, expect, it } from "vitest";
import { FP_PUBLIC_EVIDENCE_METHOD_VERSION } from "../shared/fullPotentialPublicEvidence";
import type { FullPotentialPublicObservationRecord } from "../shared/fullPotentialPublicDraftPack";
import {
  assertFullPotentialReconciliationComplete,
  reconcileFullPotentialPublicBuyers,
  type FullPotentialReconciliationAccount,
  type FullPotentialReconciliationAlias,
} from "../shared/fullPotentialAccountReconciliation";

function observation(
  overrides: Partial<FullPotentialPublicObservationRecord> = {},
): FullPotentialPublicObservationRecord {
  return {
    recordKey: "rental:kerrs-hire:public-core-v1",
    commercialPoolKey: "buyer:kerrs-hire:rental-portable-air",
    buyerAccountKey: "kerrs-hire-au",
    buyerName: "Kerr's Hire",
    buyerSegment: "rental_hire",
    application: "rental portable-air fleet replacement and refresh",
    productFamily: "other",
    productCell: "rental_portable_air_blended",
    countingTreatment: "buyer_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "fleet_replacement",
    evidenceGrade: "B",
    sourceName: "Public catalogue",
    sourceUrl: "https://example.com/public-catalogue",
    observedAt: "2026-08-21",
    publicObservation: "The public catalogue lists several compressor bands.",
    inference: "A transparent band is used without asserting an exact fleet count.",
    modelBand: "P2",
    addressabilityStatus: "addressable_now",
    qualificationGates: [],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
    ...overrides,
  };
}

function account(
  overrides: Partial<FullPotentialReconciliationAccount> = {},
): FullPotentialReconciliationAccount {
  return {
    id: 101,
    stableKey: "kerrs-hire|account|au|vic|direct_ape",
    canonicalName: "Kerrs Hire Pty Ltd",
    displayName: "Kerrs Hire",
    parentGroup: null,
    rowClass: "account",
    relationshipType: "standalone",
    recordStatus: "active",
    countsTowardPotential: true,
    mergedIntoAccountId: null,
    country: "AU",
    routeToMarket: "direct_ape",
    ...overrides,
  };
}

describe("Full Potential public buyer reconciliation", () => {
  it("matches punctuation and legal-suffix variations to one eligible account", () => {
    const result = reconcileFullPotentialPublicBuyers(
      [observation()],
      [account()],
      [],
    );
    expect(result).toMatchObject({
      buyerCountingCount: 1,
      matchedCount: 1,
      unmatchedCount: 0,
      ambiguousCount: 0,
    });
    expect(result.results[0]).toMatchObject({
      disposition: "matched",
      matchedAccountId: 101,
      matchedStableKey: "kerrs-hire|account|au|vic|direct_ape",
    });
    expect(() => assertFullPotentialReconciliationComplete(result)).not.toThrow();
  });

  it("uses a verified alias when canonical names differ", () => {
    const aliases: FullPotentialReconciliationAlias[] = [{
      accountId: 202,
      aliasName: "Onsite Rental Group",
      aliasType: "trading_name",
      confidenceLevel: "high",
    }];
    const result = reconcileFullPotentialPublicBuyers(
      [observation({
        recordKey: "rental:onsite-rentals:public-core-v1",
        buyerAccountKey: "onsite-rentals-au",
        buyerName: "Onsite Rental Group",
      })],
      [account({
        id: 202,
        stableKey: "onsite|account|au|national|direct_ape",
        canonicalName: "On Site Group Holdings",
        displayName: "On Site",
      })],
      aliases,
    );
    expect(result.results[0]).toMatchObject({
      disposition: "matched",
      matchedAccountId: 202,
    });
    expect(result.results[0].candidates[0].matchedOn).toContain(
      "alias:trading_name:exact-buyer-name",
    );
  });

  it("excludes context, non-counting, merged and non-Australian rows", () => {
    const result = reconcileFullPotentialPublicBuyers(
      [observation()],
      [
        account({ id: 1, rowClass: "site_context" }),
        account({ id: 2, countsTowardPotential: false }),
        account({ id: 3, recordStatus: "merged", mergedIntoAccountId: 101 }),
        account({ id: 4, country: "NZ" }),
      ],
      [],
    );
    expect(result.results[0]).toMatchObject({
      disposition: "unmatched",
      matchedAccountId: null,
    });
    expect(() => assertFullPotentialReconciliationComplete(result))
      .toThrow("1 unmatched, 0 ambiguous");
  });

  it("returns ambiguous when two eligible records share the same top identity", () => {
    const result = reconcileFullPotentialPublicBuyers(
      [observation()],
      [
        account({ id: 101, stableKey: "kerrs-hire|account|au|vic|direct_ape" }),
        account({ id: 102, stableKey: "kerrs-hire|account|au|vic|manual-review" }),
      ],
      [],
    );
    expect(result.results[0]).toMatchObject({
      disposition: "ambiguous",
      matchedAccountId: null,
    });
    expect(result.results[0].candidates).toHaveLength(2);
    expect(() => assertFullPotentialReconciliationComplete(result))
      .toThrow("0 unmatched, 1 ambiguous");
  });

  it("does not auto-match weak containment alone", () => {
    const result = reconcileFullPotentialPublicBuyers(
      [observation({
        buyerAccountKey: "master-hire-au",
        buyerName: "Master Hire",
      })],
      [account({
        id: 303,
        stableKey: "master-hire-queensland|account|au|qld|direct_ape",
        canonicalName: "Master Hire Queensland Equipment Division",
        displayName: null,
      })],
      [],
    );
    expect(result.results[0]).toMatchObject({
      disposition: "ambiguous",
      matchedAccountId: null,
    });
    expect(result.results[0].reason).toContain("below the automatic-match threshold");
  });

  it("keeps non-counting application records outside account targeting", () => {
    const result = reconcileFullPotentialPublicBuyers(
      [observation({
        recordKey: "overlay:rental:temporary-electric",
        countingTreatment: "application_overlay_non_counting",
        commercialPoolKey: null,
        buyerAccountKey: null,
        buyerName: null,
      })],
      [],
      [],
    );
    expect(result).toMatchObject({
      buyerCountingCount: 0,
      nonCountingCount: 1,
    });
    expect(result.results[0].disposition).toBe("not_buyer_counting");
    expect(() => assertFullPotentialReconciliationComplete(result)).not.toThrow();
  });

  it("allows one buyer identity to carry multiple distinct product pools on one account", () => {
    const result = reconcileFullPotentialPublicBuyers(
      [
        observation(),
        observation({
          recordKey: "rental:kerrs-hire:ts2-electric-adoption",
          commercialPoolKey: "buyer:kerrs-hire:ts2-electric-adoption",
          productFamily: "e_air",
          productCell: "TS2_specialist_rental_electric",
          application: "incremental medium electric rental-fleet adoption",
          scenarioBasis: "adoption_positions",
        }),
        observation({
          recordKey: "rental:kerrs-hire:ts4-electric-adoption",
          commercialPoolKey: "buyer:kerrs-hire:ts4-electric-adoption",
          productFamily: "e_air",
          productCell: "TS4_specialist_rental_electric",
          application: "incremental high-pressure electric rental-fleet adoption",
          scenarioBasis: "adoption_positions",
        }),
      ],
      [account()],
      [],
    );
    expect(result.matchedCount).toBe(3);
    expect(result.results.every(row => row.matchedAccountId === 101)).toBe(true);
    expect(() => assertFullPotentialReconciliationComplete(result)).not.toThrow();
  });

  it("fails when distinct public buyer identities map to one counting account", () => {
    const result = reconcileFullPotentialPublicBuyers(
      [
        observation(),
        observation({
          recordKey: "rental:kerrs-equipment:public-core-v1",
          commercialPoolKey: "buyer:kerrs-equipment:rental-portable-air",
          buyerAccountKey: "kerrs-equipment-au",
          buyerName: "Kerrs Hire",
        }),
      ],
      [account()],
      [],
    );
    expect(result.matchedCount).toBe(2);
    expect(() => assertFullPotentialReconciliationComplete(result))
      .toThrow("distinct public buyer identities to counting account 101");
  });

  it("fails when one public buyer identity maps to multiple counting accounts", () => {
    const summary = {
      recordCount: 2,
      buyerCountingCount: 2,
      matchedCount: 2,
      unmatchedCount: 0,
      ambiguousCount: 0,
      nonCountingCount: 0,
      results: [
        {
          recordKey: "one",
          buyerAccountKey: "shared-buyer-au",
          buyerName: "Shared Buyer",
          disposition: "matched" as const,
          matchedAccountId: 101,
          matchedStableKey: "shared|one",
          candidates: [],
          reason: "test",
        },
        {
          recordKey: "two",
          buyerAccountKey: "shared-buyer-au",
          buyerName: "Shared Buyer",
          disposition: "matched" as const,
          matchedAccountId: 202,
          matchedStableKey: "shared|two",
          candidates: [],
          reason: "test",
        },
      ],
    };
    expect(() => assertFullPotentialReconciliationComplete(summary))
      .toThrow("maps buyer shared-buyer-au to multiple counting accounts");
  });
});
