import { describe, expect, it } from "vitest";
import type { PortableAirCommercialTruth } from "./thisWeekCommercialTruth";
import {
  applyPortableAirRepPolicy,
  commercialTruthRepName,
  extractCfmValues,
  hasExplicitCpDealerEvidence,
  isCommercialTruthEnabledRep,
  organisationMatchesManagedAccount,
  type PortableAirCommercialPolicyProject,
} from "./portableAirCommercialPolicy";

function project(override: Partial<PortableAirCommercialPolicyProject> = {}): PortableAirCommercialPolicyProject {
  return {
    name: "Project Atlas",
    owner: "Principal Co",
    matchedAccountPrior: null,
    location: "NSW, Australia",
    overview: "Credible temporary compressed-air requirement.",
    opportunityRoute: "Direct CAPEX",
    equipmentSignals: ["portable compressor"],
    detectedActivities: [],
    ...override,
  };
}

function truth(override: Partial<PortableAirCommercialTruth> = {}): PortableAirCommercialTruth {
  return {
    application: "General compressed-air requirement",
    airFit: "Medium",
    opportunityType: "temporary_plant_air",
    bestProductAngle: "Compressor",
    routeStatus: "confirm_product_scope",
    channel: "monitor",
    timingStatus: "actionable",
    buyerStatus: "map_package_holder",
    recommendedAction: "confirm_product_scope",
    actionReady: false,
    recordedPackageHolders: [],
    packageMatchedNamedBuyerCount: 0,
    packageMatchedSafeBuyerCount: 0,
    preferredBuyerContactId: null,
    whyNow: "Product scope needs confirmation.",
    routeToBuy: "Confirm direct vs channel route.",
    bestNextMove: "Confirm cfm, pressure and product family.",
    reasonCodes: ["application:temporary_plant_air", "route:confirm_product_scope", "timing:actionable", "buyer:map_package_holder"],
    ...override,
  };
}

describe("Issue #109 capacity and channel policy", () => {
  it("parses CFM notation without degrading 1,200 to 200", () => {
    expect(extractCfmValues("1200 CFM")).toEqual([1200]);
    expect(extractCfmValues("1200+ CFM")).toEqual([1200]);
    expect(extractCfmValues("1,200 CFM")).toEqual([1200]);
    expect(extractCfmValues("1,200+ CFM")).toEqual([1200]);
    expect(extractCfmValues("400 CFM")).toEqual([400]);
  });

  it("uses the same >600 CFM rule for Ryan, Paul and Dan", () => {
    const cases = [
      ["Ryan Pemberton", "WA"],
      ["Paul Lueth", "QLD"],
      ["Dan Day", "VIC"],
    ] as const;
    for (const [repName, location] of cases) {
      const result = applyPortableAirRepPolicy({
        repName,
        project: project({ location, equipmentSignals: ["1,200+ CFM portable compressor"] }),
        truth: truth(),
      });
      expect(result.routeStatus).toBe("direct_proven");
      expect(result.recommendedAction).toBe("map_package_holder");
      expect(result.actionReady).toBe(false);
    }
  });

  it("routes explicit <=600 CFM demand through CEA", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Paul Lueth",
      project: project({ location: "NSW", equipmentSignals: ["400 CFM portable compressor"] }),
      truth: truth(),
    });
    expect(result.routeStatus).toBe("channel_cea");
    expect(result.channelPolicy).toBe("cea");
    expect(result.recommendedAction).toBe("route_via_cea");
    expect(result.actionReady).toBe(false);
  });

  it("keeps generic drilling/blasting fail closed without stronger direct evidence", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Dan Day",
      project: project({ location: "NT", equipmentSignals: ["Portable air for drilling and blasting"] }),
      truth: truth({ airFit: "High", opportunityType: "drilling_blasting" }),
    });
    expect(result.routeStatus).toBe("confirm_product_scope");
    expect(result.actionReady).toBe(false);
  });

  it("routes explicit CP evidence through the dealer even with 900 CFM", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Paul Lueth",
      project: project({ location: "NSW", overview: "Chicago Pneumatic portable compressor", equipmentSignals: ["900 CFM"] }),
      truth: truth(),
    });
    expect(hasExplicitCpDealerEvidence(project({ overview: "CP portable air unit" }))).toBe(true);
    expect(hasExplicitCpDealerEvidence(project({ overview: "CP rail crossing project" }))).toBe(false);
    expect(result.routeStatus).toBe("channel_cp_dealer");
    expect(result.channelPolicy).toBe("cp_dealer");
    expect(result.recommendedAction).toBe("route_via_dealer");
    expect(result.actionReady).toBe(false);
  });
});

describe("Issue #109 managed accounts", () => {
  const coatesReady = truth({
    routeStatus: "channel_cea",
    buyerStatus: "package_buyer_ready",
    recommendedAction: "route_via_cea",
    recordedPackageHolders: ["Coates"],
    packageMatchedNamedBuyerCount: 1,
    packageMatchedSafeBuyerCount: 1,
    preferredBuyerContactId: 2001,
  });

  it("keeps Coates national/direct for Ryan and blocks Paul", () => {
    const ryan = applyPortableAirRepPolicy({ repName: "Ryan Pemberton", project: project({ owner: "Coates", location: "QLD" }), truth: coatesReady });
    const paul = applyPortableAirRepPolicy({ repName: "Paul Lueth", project: project({ owner: "Coates", location: "QLD" }), truth: coatesReady });
    expect(ryan.managedAccount).toBe("Coates");
    expect(ryan.channelPolicy).toBe("direct_key_account");
    expect(ryan.routeStatus).toBe("direct_proven");
    expect(paul.recommendedAction).toBe("refer_managed_account");
    expect(paul.managedAccountOwner).toBe("Ryan Pemberton");
    expect(paul.actionReady).toBe(false);
  });

  it("keeps EPSA national/direct for Dan and blocks Paul", () => {
    const epsaReady = truth({ ...coatesReady, recordedPackageHolders: ["Energy Power Systems Australia"] });
    const dan = applyPortableAirRepPolicy({ repName: "Dan Day", project: project({ owner: "Energy Power Systems Australia", location: "WA" }), truth: epsaReady });
    const paul = applyPortableAirRepPolicy({ repName: "Paul Lueth", project: project({ owner: "EPSA", location: "NSW" }), truth: epsaReady });
    expect(dan.managedAccount).toBe("EPSA");
    expect(dan.channelPolicy).toBe("direct_key_account");
    expect(paul.recommendedAction).toBe("refer_managed_account");
    expect(paul.managedAccountOwner).toBe("Dan Day");
  });

  it("uses structured account evidence only, not supplier/project-name text", () => {
    const overviewMention = applyPortableAirRepPolicy({
      repName: "Paul Lueth",
      project: project({ owner: "Principal Co", name: "Road Upgrade", location: "NSW", overview: "Coates supplied equipment to a subcontractor." }),
      truth: truth(),
    });
    const nameMention = applyPortableAirRepPolicy({
      repName: "Paul Lueth",
      project: project({ owner: "Principal Co", name: "Coates mentioned in notes", location: "NSW" }),
      truth: truth(),
    });
    expect(overviewMention.managedAccount).toBeNull();
    expect(nameMention.managedAccount).toBeNull();
  });

  it("matches only the managed buying organisations", () => {
    expect(organisationMatchesManagedAccount("Coates", "Coates Hire Pty Ltd")).toBe(true);
    expect(organisationMatchesManagedAccount("Coates", "Other Contractor")).toBe(false);
    expect(organisationMatchesManagedAccount("EPSA", "EPSA")).toBe(true);
    expect(organisationMatchesManagedAccount("EPSA", "Energy Power Systems Australia Pty Ltd")).toBe(true);
    expect(organisationMatchesManagedAccount("EPSA", "Energy Power Systems NZ")).toBe(false);
  });
});

describe("Issue #109 enablement", () => {
  it("enables only Ryan, Paul and Dan", () => {
    expect(commercialTruthRepName("Ryan Pemberton")).toBe("Ryan Pemberton");
    expect(commercialTruthRepName(" paul lueth ")).toBe("Paul Lueth");
    expect(commercialTruthRepName("DAN DAY")).toBe("Dan Day");
    expect(isCommercialTruthEnabledRep("Ryan Pemberton")).toBe(true);
    expect(isCommercialTruthEnabledRep("Paul Lueth")).toBe(true);
    expect(isCommercialTruthEnabledRep("Dan Day")).toBe(true);
    expect(isCommercialTruthEnabledRep("Leo Williams")).toBe(false);
  });
});
