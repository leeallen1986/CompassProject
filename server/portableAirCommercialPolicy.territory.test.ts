import { describe, expect, it } from "vitest";
import type { PortableAirCommercialTruth } from "./thisWeekCommercialTruth";
import {
  applyPortableAirRepPolicy,
  repOwnsState,
  resolveAustralianState,
  territoryOwnerForState,
  type PortableAirCommercialPolicyProject,
} from "./portableAirCommercialPolicy";

function project(override: Partial<PortableAirCommercialPolicyProject> = {}): PortableAirCommercialPolicyProject {
  return {
    name: "Project Atlas", owner: "Principal Co", matchedAccountPrior: null,
    location: "NSW", overview: "Compressed-air requirement.", opportunityRoute: "Direct CAPEX",
    equipmentSignals: ["portable compressor"], detectedActivities: [], ...override,
  };
}

function truth(override: Partial<PortableAirCommercialTruth> = {}): PortableAirCommercialTruth {
  return {
    application: "General compressed-air requirement", airFit: "Medium", opportunityType: "temporary_plant_air",
    bestProductAngle: "Compressor", routeStatus: "confirm_product_scope", channel: "monitor",
    timingStatus: "actionable", buyerStatus: "map_package_holder", recommendedAction: "confirm_product_scope",
    actionReady: false, recordedPackageHolders: [], packageMatchedNamedBuyerCount: 0,
    packageMatchedSafeBuyerCount: 0, preferredBuyerContactId: null, whyNow: "Confirm scope.",
    routeToBuy: "Confirm route.", bestNextMove: "Confirm scope.",
    reasonCodes: ["route:confirm_product_scope", "buyer:map_package_holder"], ...override,
  };
}

describe("Issue #109 territory ownership", () => {
  it("resolves Australian state names/codes", () => {
    expect(resolveAustralianState("Perth, WA")).toBe("WA");
    expect(resolveAustralianState("Queensland")).toBe("QLD");
    expect(resolveAustralianState("Sydney, NSW")).toBe("NSW");
    expect(resolveAustralianState("Victoria")).toBe("VIC");
    expect(resolveAustralianState("South Australia")).toBe("SA");
    expect(resolveAustralianState("Tasmania")).toBe("TAS");
    expect(resolveAustralianState("Northern Territory")).toBe("NT");
    expect(resolveAustralianState("Australia")).toBeNull();
  });

  it("maps ownership exactly", () => {
    expect(territoryOwnerForState("WA")).toBe("Ryan Pemberton");
    expect(territoryOwnerForState("QLD")).toBe("Paul Lueth");
    expect(territoryOwnerForState("NSW")).toBe("Paul Lueth");
    expect(territoryOwnerForState("VIC")).toBe("Dan Day");
    expect(territoryOwnerForState("SA")).toBe("Dan Day");
    expect(territoryOwnerForState("TAS")).toBe("Dan Day");
    expect(territoryOwnerForState("NT")).toBe("Dan Day");
    expect(repOwnsState("Ryan Pemberton", "WA")).toBe(true);
    expect(repOwnsState("Paul Lueth", "WA")).toBe(false);
  });

  it("keeps ordinary projects with their owner", () => {
    expect(applyPortableAirRepPolicy({ repName: "Ryan Pemberton", project: project({ location: "WA" }), truth: truth() }).ownershipStatus).toBe("owned");
    expect(applyPortableAirRepPolicy({ repName: "Paul Lueth", project: project({ location: "QLD" }), truth: truth() }).ownershipStatus).toBe("owned");
    expect(applyPortableAirRepPolicy({ repName: "Dan Day", project: project({ location: "VIC" }), truth: truth() }).ownershipStatus).toBe("owned");
  });

  it("blocks a wrong-territory primary CTA", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Paul Lueth", project: project({ location: "WA" }),
      truth: truth({ routeStatus: "direct_proven", channel: "direct", buyerStatus: "package_buyer_ready",
        recommendedAction: "view_best", actionReady: true, recordedPackageHolders: ["Awarded Contractor"],
        packageMatchedNamedBuyerCount: 1, packageMatchedSafeBuyerCount: 1, preferredBuyerContactId: 101 }),
    });
    expect(result.routeStatus).toBe("territory_referral");
    expect(result.recommendedAction).toBe("refer_territory_owner");
    expect(result.territoryOwner).toBe("Ryan Pemberton");
    expect(result.actionReady).toBe(false);
    expect(result.preferredBuyerContactId).toBeNull();
  });

  it("fails unresolved territory closed", () => {
    const result = applyPortableAirRepPolicy({ repName: "Paul Lueth", project: project({ location: "Australia" }), truth: truth() });
    expect(result.routeStatus).toBe("territory_unresolved");
    expect(result.recommendedAction).toBe("confirm_territory");
    expect(result.actionReady).toBe(false);
  });
});
