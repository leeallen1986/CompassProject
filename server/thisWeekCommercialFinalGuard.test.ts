import { describe, expect, it } from "vitest";
import { shouldFailClosedLegacyManagedName } from "./thisWeekCommercialFinalGuard";
import type { PortableAirCommercialPolicyResult } from "./portableAirCommercialPolicy";

function truth(override: Partial<PortableAirCommercialPolicyResult> = {}): PortableAirCommercialPolicyResult {
  return {
    application: "General compressed-air requirement",
    airFit: "Medium",
    opportunityType: "temporary_plant_air",
    bestProductAngle: "Compressor",
    routeStatus: "direct_proven",
    channel: "direct",
    timingStatus: "actionable",
    buyerStatus: "package_buyer_ready",
    recommendedAction: "view_best",
    actionReady: true,
    recordedPackageHolders: ["Awarded Contractor"],
    packageMatchedNamedBuyerCount: 1,
    packageMatchedSafeBuyerCount: 1,
    preferredBuyerContactId: 9001,
    whyNow: "Direct route.",
    routeToBuy: "Package buyer ready.",
    bestNextMove: "Proceed.",
    reasonCodes: ["route:direct_proven"],
    ownershipStatus: "owned",
    channelPolicy: "direct",
    managedAccount: null,
    managedAccountOwner: null,
    territoryOwner: "Paul Lueth",
    nitrogenCollaboration: null,
    ...override,
  };
}

function evidence(override: Record<string, unknown> = {}) {
  return {
    name: "Coates mentioned in project notes",
    overview: "General construction requiring portable air.",
    opportunityRoute: "Direct CAPEX",
    equipmentSignals: ["portable compressor"],
    detectedActivities: [],
    managedAccount: null,
    truth: truth(),
    ...override,
  };
}

describe("Issue #109 legacy managed-name guard", () => {
  it("rejects a project-name-only Coates direct signal", () => {
    expect(shouldFailClosedLegacyManagedName(evidence())).toBe(true);
  });

  it("does not block a structured Coates managed account", () => {
    expect(shouldFailClosedLegacyManagedName(evidence({ managedAccount: "Coates" }))).toBe(false);
  });

  it("does not block independently proven >600 CFM evidence", () => {
    expect(shouldFailClosedLegacyManagedName(evidence({
      truth: truth({ reasonCodes: ["route:direct_proven", "evidence:cfm:1200"] }),
    }))).toBe(false);
  });

  it("does not block an independently direct specialty family", () => {
    expect(shouldFailClosedLegacyManagedName(evidence({
      truth: truth({ opportunityType: "high_pressure_booster", bestProductAngle: "Booster" }),
    }))).toBe(false);
  });

  it("does not block independently proven RC drilling", () => {
    expect(shouldFailClosedLegacyManagedName(evidence({
      overview: "RC drilling campaign requires portable air.",
      truth: truth({ opportunityType: "drilling_blasting" }),
    }))).toBe(false);
  });
});
