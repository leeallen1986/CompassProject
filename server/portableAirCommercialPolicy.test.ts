import { describe, expect, it } from "vitest";
import type { PortableAirCommercialTruth } from "./thisWeekCommercialTruth";
import {
  applyPortableAirRepPolicy,
  commercialTruthRepName,
  extractCfmValues,
  hasExplicitCpDealerEvidence,
  isCommercialTruthEnabledRep,
  type PortableAirCommercialPolicyProject,
} from "./portableAirCommercialPolicy";

function project(
  override: Partial<PortableAirCommercialPolicyProject> = {},
): PortableAirCommercialPolicyProject {
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

function truth(
  override: Partial<PortableAirCommercialTruth> = {},
): PortableAirCommercialTruth {
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
    reasonCodes: [
      "application:temporary_plant_air",
      "route:confirm_product_scope",
      "timing:actionable",
      "buyer:map_package_holder",
    ],
    ...override,
  };
}

describe("Issue #109 CFM evidence", () => {
  it("parses standard, plus-suffix and thousands-separator forms", () => {
    const cases: Array<[string, number]> = [
      ["1200 CFM", 1200],
      ["1200+ CFM", 1200],
      ["1,200 CFM", 1200],
      ["1,200+ CFM", 1200],
      ["1000+ CFM", 1000],
      ["900 CFM", 900],
      ["400 CFM", 400],
    ];

    for (const [value, expected] of cases) {
      expect(extractCfmValues(value)).toEqual([expected]);
    }
  });

  it("never degrades 1,200 CFM into a false 200 CFM match", () => {
    expect(extractCfmValues("1,200 CFM diesel compressor")).toEqual([1200]);
  });

  it("promotes Sydney Metro-style 1200+ CFM evidence to a direct route only", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Paul Lueth",
      project: project({
        name: "Sydney Metro — City & Southwest",
        equipmentSignals: ["High-volume compressed air (1200+ CFM)"],
      }),
      truth: truth(),
    });

    expect(result.routeStatus).toBe("direct_proven");
    expect(result.recommendedAction).toBe("map_package_holder");
    expect(result.actionReady).toBe(false);
  });

  it("promotes Snowy-style 1,000+ CFM evidence without bypassing buyer gates", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Paul Lueth",
      project: project({
        name: "Snowy 2.0",
        equipmentSignals: ["Tunnel works require 1,000+ CFM"],
      }),
      truth: truth({ buyerStatus: "find_buyer", recordedPackageHolders: ["Future Generation JV"] }),
    });

    expect(result.routeStatus).toBe("direct_proven");
    expect(result.recommendedAction).toBe("find_contacts");
    expect(result.actionReady).toBe(false);
  });

  it("routes explicit 400 CFM generic demand to CEA", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Paul Lueth",
      project: project({ equipmentSignals: ["400 CFM portable compressor"] }),
      truth: truth(),
    });

    expect(result.routeStatus).toBe("channel_cea");
    expect(result.channelPolicy).toBe("cea");
    expect(result.recommendedAction).toBe("route_via_cea");
    expect(result.actionReady).toBe(false);
    expect(result.preferredBuyerContactId).toBeNull();
  });

  it("keeps generic High/drilling_blasting fail closed without stronger evidence", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Dan Day",
      project: project({
        location: "NT, Australia",
        equipmentSignals: ["Portable air for drilling and blasting"],
      }),
      truth: truth({
        application: "General compressed-air requirement",
        airFit: "High",
        opportunityType: "drilling_blasting",
        routeStatus: "confirm_product_scope",
      }),
    });

    expect(result.routeStatus).toBe("confirm_product_scope");
    expect(result.recommendedAction).toBe("confirm_product_scope");
  });
});

describe("Issue #109 managed accounts", () => {
  const readyBuyer = truth({
    routeStatus: "channel_cea",
    buyerStatus: "package_buyer_ready",
    recommendedAction: "route_via_cea",
    recordedPackageHolders: ["Coates"],
    packageMatchedNamedBuyerCount: 1,
    packageMatchedSafeBuyerCount: 1,
    preferredBuyerContactId: 2001,
  });

  it("keeps Coates nationally direct for Ryan", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Ryan Pemberton",
      project: project({ name: "Coates fleet replacement", owner: "Coates" }),
      truth: readyBuyer,
    });

    expect(result.managedAccount).toBe("Coates");
    expect(result.managedAccountOwner).toBe("Ryan Pemberton");
    expect(result.channelPolicy).toBe("direct_key_account");
    expect(result.routeStatus).toBe("direct_proven");
    expect(result.recommendedAction).toBe("view_best");
    expect(result.actionReady).toBe(true);
  });

  it("blocks a Coates primary CTA for Paul and points to Ryan", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Paul Lueth",
      project: project({ name: "Coates fleet replacement", owner: "Coates" }),
      truth: readyBuyer,
    });

    expect(result.routeStatus).toBe("managed_account_referral");
    expect(result.recommendedAction).toBe("refer_managed_account");
    expect(result.managedAccountOwner).toBe("Ryan Pemberton");
    expect(result.actionReady).toBe(false);
    expect(result.preferredBuyerContactId).toBeNull();
  });

  it("keeps EPSA nationally direct for Dan and blocks Ryan/Paul", () => {
    const dan = applyPortableAirRepPolicy({
      repName: "Dan Day",
      project: project({ name: "EPSA fleet project", owner: "Energy Power Systems Australia" }),
      truth: readyBuyer,
    });
    const paul = applyPortableAirRepPolicy({
      repName: "Paul Lueth",
      project: project({ name: "EPSA fleet project", owner: "EPSA" }),
      truth: readyBuyer,
    });

    expect(dan.managedAccount).toBe("EPSA");
    expect(dan.channelPolicy).toBe("direct_key_account");
    expect(dan.routeStatus).toBe("direct_proven");
    expect(paul.recommendedAction).toBe("refer_managed_account");
    expect(paul.managedAccountOwner).toBe("Dan Day");
    expect(paul.actionReady).toBe(false);
  });

  it("does not turn a supplier mention into a managed customer account", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Paul Lueth",
      project: project({
        owner: "Principal Co",
        name: "Road Upgrade",
        overview: "Coates supplied equipment to a subcontractor.",
      }),
      truth: truth(),
    });

    expect(result.managedAccount).toBeNull();
    expect(result.recommendedAction).toBe("confirm_product_scope");
  });

  it("does not manufacture direct relevance for a Low/None managed-account record", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Ryan Pemberton",
      project: project({ name: "Coates unrelated record", owner: "Coates" }),
      truth: truth({
        application: "Portable Air application not proven",
        airFit: "None",
        opportunityType: "none",
        routeStatus: "not_relevant",
        recommendedAction: "monitor_next_program",
      }),
    });

    expect(result.routeStatus).toBe("not_relevant");
    expect(result.actionReady).toBe(false);
  });
});

describe("Issue #109 nitrogen collaboration", () => {
  const nitrogenReady = truth({
    application: "Nitrogen purging / inerting / commissioning",
    airFit: "High",
    opportunityType: "purging_inerting",
    bestProductAngle: "N2 Membrane",
    routeStatus: "direct_proven",
    channel: "direct",
    buyerStatus: "package_buyer_ready",
    recommendedAction: "view_best",
    actionReady: true,
    recordedPackageHolders: ["Awarded Contractor"],
    packageMatchedNamedBuyerCount: 1,
    packageMatchedSafeBuyerCount: 1,
    preferredBuyerContactId: 3001,
  });

  it("keeps Paul as QLD/NSW owner and adds Dan specialist support", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Paul Lueth",
      project: project({ location: "QLD, Australia" }),
      truth: nitrogenReady,
    });

    expect(result.ownershipStatus).toBe("owned");
    expect(result.nitrogenCollaboration).toBe("dan_specialist_support");
    expect(result.recommendedAction).toBe("view_best");
    expect(result.actionReady).toBe(true);
    expect(result.bestNextMove).toContain("Dan Day");
  });

  it("makes Dan support-only for ordinary QLD/NSW nitrogen", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Dan Day",
      project: project({ location: "NSW, Australia" }),
      truth: nitrogenReady,
    });

    expect(result.routeStatus).toBe("specialist_support");
    expect(result.ownershipStatus).toBe("specialist_support_only");
    expect(result.recommendedAction).toBe("specialist_support_only");
    expect(result.actionReady).toBe(false);
    expect(result.preferredBuyerContactId).toBeNull();
  });

  it("keeps Dan as normal owner for VIC nitrogen", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Dan Day",
      project: project({ location: "VIC, Australia" }),
      truth: nitrogenReady,
    });

    expect(result.ownershipStatus).toBe("owned");
    expect(result.nitrogenCollaboration).toBeNull();
    expect(result.recommendedAction).toBe("view_best");
  });

  it("keeps QLD EPSA nitrogen as Dan's managed account exception", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Dan Day",
      project: project({
        name: "EPSA nitrogen package",
        owner: "Energy Power Systems Australia",
        location: "QLD, Australia",
      }),
      truth: nitrogenReady,
    });

    expect(result.managedAccount).toBe("EPSA");
    expect(result.channelPolicy).toBe("direct_key_account");
    expect(result.ownershipStatus).toBe("owned");
    expect(result.recommendedAction).toBe("view_best");
  });
});

describe("Issue #109 CP/dealer policy", () => {
  it("recognises explicit CP wording and known U75/U110/U190 models only", () => {
    expect(hasExplicitCpDealerEvidence(project({ overview: "Chicago Pneumatic portable compressor" }))).toBe(true);
    expect(hasExplicitCpDealerEvidence(project({ overview: "CP portable air unit" }))).toBe(true);
    expect(hasExplicitCpDealerEvidence(project({ overview: "U75 fleet" }))).toBe(true);
    expect(hasExplicitCpDealerEvidence(project({ overview: "U-110 and U190 fleet" }))).toBe(true);
    expect(hasExplicitCpDealerEvidence(project({ overview: "CP rail crossing project" }))).toBe(false);
    expect(hasExplicitCpDealerEvidence(project({ overview: "The CP was completed" }))).toBe(false);
  });

  it("routes explicit CP demand via dealer even when 900 CFM would otherwise be direct", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Paul Lueth",
      project: project({
        overview: "Chicago Pneumatic portable compressor",
        equipmentSignals: ["900 CFM"],
      }),
      truth: truth(),
    });

    expect(result.routeStatus).toBe("channel_cp_dealer");
    expect(result.channelPolicy).toBe("cp_dealer");
    expect(result.recommendedAction).toBe("route_via_dealer");
    expect(result.actionReady).toBe(false);
  });

  it("lets a documented Coates managed-account exception outrank CP dealer routing", () => {
    const result = applyPortableAirRepPolicy({
      repName: "Ryan Pemberton",
      project: project({
        name: "Coates CP fleet replacement",
        owner: "Coates",
        overview: "Chicago Pneumatic portable compressor fleet",
      }),
      truth: truth({ buyerStatus: "map_package_holder" }),
    });

    expect(result.channelPolicy).toBe("direct_key_account");
    expect(result.routeStatus).toBe("direct_proven");
    expect(result.recommendedAction).toBe("map_package_holder");
  });
});

describe("Issue #109 enablement", () => {
  it("enables the policy for Ryan, Paul and Dan only", () => {
    expect(commercialTruthRepName("Ryan Pemberton")).toBe("Ryan Pemberton");
    expect(commercialTruthRepName(" paul lueth ")).toBe("Paul Lueth");
    expect(commercialTruthRepName("DAN DAY")).toBe("Dan Day");
    expect(isCommercialTruthEnabledRep("Ryan Pemberton")).toBe(true);
    expect(isCommercialTruthEnabledRep("Paul Lueth")).toBe(true);
    expect(isCommercialTruthEnabledRep("Dan Day")).toBe(true);
    expect(isCommercialTruthEnabledRep("Leo Williams")).toBe(false);
    expect(isCommercialTruthEnabledRep(null)).toBe(false);
  });
});
