import { describe, expect, it } from "vitest";
import type { ProjectBuyerRoute } from "./projectBuyerRoute";
import {
  isUsablePackageOrganisation,
  resolvePortableAirCommercialTruth,
  type PortableAirCommercialTruthInput,
} from "./thisWeekCommercialTruth";

function contact(options: {
  id?: number;
  company?: string;
  safe?: boolean;
  lane?: "principal" | "contractor" | "commercial" | "technical" | "referral" | "unknown";
} = {}): ProjectBuyerRoute["contacts"][number] {
  const safe = options.safe ?? true;
  return {
    contactId: options.id ?? 2001,
    name: "Alex Buyer",
    title: "Plant & Equipment Manager",
    organisation: {
      recordedName: options.company ?? "Contractor Co",
      evidenceState: "not_recorded",
    },
    lane: {
      value: options.lane ?? "contractor",
      basis: "inferred",
    },
    storedTrustTier: safe ? "send_ready" : "named_unverified",
    effectiveTrustTier: safe ? "send_ready" : "named_unverified",
    effectivelySendReady: safe,
    eligibilityReasons: [],
    email: {
      value: safe ? "alex@example.com" : null,
      state: safe ? "verified" : "unverified",
    },
    linkedin: { profileUrl: null, searchUrl: null },
    source: {
      type: "apollo",
      url: null,
      evidenceMeaning: "identity_discovery_not_employment_proof",
    },
    lastChecked: { at: null, basis: "not_recorded" },
    projectLink: {
      exactPersistedLink: true,
      relevance: "primary",
      linkedAt: null,
      externalEvidenceState: "not_recorded",
    },
    whyRelevant: {
      text: "Project-linked equipment buyer.",
      evidenceState: "inferred",
    },
  };
}

function holder(
  organisation = "Contractor Co",
  evidenceState: ProjectBuyerRoute["packageHolders"][number]["evidenceState"] = "recorded_unverified",
): ProjectBuyerRoute["packageHolders"][number] {
  return {
    organisation,
    organisationType: "organisation",
    recordedRole: "contractor",
    recordedStatus: evidenceState === "inferred" ? "predicted" : "confirmed",
    packageScope: "Construction package",
    evidenceState,
    ingestionSources: ["project_record"],
  };
}

function dossier(options: {
  packageHolders?: ProjectBuyerRoute["packageHolders"];
  contacts?: ProjectBuyerRoute["contacts"];
} = {}): ProjectBuyerRoute {
  return {
    projectId: 1001,
    principal: {
      organisation: "Principal Co",
      role: "principal",
      evidenceState: "recorded_unverified",
      buyerMeaning: "referral_and_package_confirmation_not_assumed_purchaser",
    },
    projectLevelSources: [],
    packageHolders: options.packageHolders ?? [holder()],
    likelyEquipmentBuyer: {
      organisation: null,
      functions: ["plant_equipment_fleet", "procurement_commercial"],
      statement: "Contractor-side buying route.",
      evidenceState: "inferred",
    },
    principalValue: {
      statement: "Use principal for referral and package confirmation.",
      evidenceState: "inferred",
    },
    unmappedScopes: [],
    contacts: options.contacts ?? [contact()],
    gaps: [],
  };
}

function input(
  override: Partial<PortableAirCommercialTruthInput["project"]> = {},
  options: {
    dossier?: ProjectBuyerRoute | null;
    lane?: Partial<PortableAirCommercialTruthInput["lane"]>;
  } = {},
): PortableAirCommercialTruthInput {
  return {
    project: {
      name: "Project Atlas",
      owner: "Principal Co",
      stage: "Construction",
      overview: "Large project with compressed air requirement.",
      opportunityRoute: "Direct CAPEX",
      equipmentSignals: ["portable compressor"],
      detectedActivities: [],
      ...override,
    },
    lane: {
      airFit: "Medium",
      opportunityType: "temporary_plant_air",
      bestProductAngle: "Compressor",
      channel: "direct",
      ...options.lane,
    },
    dossier: options.dossier === undefined ? dossier() : options.dossier,
  };
}

describe("Issue #106 application precedence", () => {
  it("treats GAWSS-style pipeline construction as pipeline work, not RC drilling", () => {
    const result = resolvePortableAirCommercialTruth(input({
      name: "Goldfields and Agricultural Water Supply",
      overview: "Pipeline upgrade with trenching, excavation, drilling and blasting along the water main.",
      equipmentSignals: ["portable compressor"],
    }));

    expect(result.application).toBe("Pipeline construction / excavation air");
    expect(result.opportunityType).toBe("pipeline_construction");
    expect(result.routeStatus).toBe("confirm_product_scope");
  });

  it("prefers nitrogen commissioning over generic drilling on Scarborough-style gas work", () => {
    const result = resolvePortableAirCommercialTruth(input({
      name: "Scarborough Gas Project",
      overview: "Offshore gas processing and pipeline commissioning package with nitrogen purge and drilling support.",
      equipmentSignals: ["nitrogen membrane", "portable compressor"],
    }));

    expect(result.application).toBe("Nitrogen purging / inerting / commissioning");
    expect(result.bestProductAngle).toBe("N2 Membrane");
    expect(result.routeStatus).toBe("direct_proven");
  });

  it("prefers booster evidence over drilling tokens", () => {
    const result = resolvePortableAirCommercialTruth(input({
      name: "Scarborough Energy Project",
      overview: "Gas processing commissioning with high-pressure testing and booster compressor support; drilling also referenced.",
    }));

    expect(result.application).toBe("High-pressure booster / pressure testing");
    expect(result.bestProductAngle).toBe("Booster");
    expect(result.routeStatus).toBe("direct_proven");
  });
});

describe("Issue #106 direct-vs-channel boundary", () => {
  it("fails generic Kwinana-style construction air to confirm_product_scope", () => {
    const result = resolvePortableAirCommercialTruth(input({
      name: "Kwinana Freeway Upgrade",
      overview: "Civil construction works requiring portable compressor support.",
    }));

    expect(result.routeStatus).toBe("confirm_product_scope");
    expect(result.recommendedAction).toBe("confirm_product_scope");
    expect(result.actionReady).toBe(false);
  });

  it("does not let a generic solar construction signal become direct", () => {
    const result = resolvePortableAirCommercialTruth(input({
      name: "Yindjibarndi Energy Solar Project",
      overview: "Solar project construction with general portable compressor requirement.",
      equipmentSignals: ["portable compressor"],
    }));

    expect(result.routeStatus).toBe("confirm_product_scope");
    expect(result.actionReady).toBe(false);
  });

  it("asserts direct only when explicit capacity exceeds 600 cfm", () => {
    const result = resolvePortableAirCommercialTruth(input({
      overview: "Construction package requires a 900 CFM portable compressor.",
    }));

    expect(result.routeStatus).toBe("direct_proven");
  });

  it("routes explicit 400 cfm demand via CEA", () => {
    const result = resolvePortableAirCommercialTruth(input({
      overview: "Construction package requires a 400 CFM portable compressor.",
    }));

    expect(result.routeStatus).toBe("channel_cea");
    expect(result.recommendedAction).toBe("route_via_cea");
    expect(result.actionReady).toBe(false);
  });

  it("keeps Coates as an explicit direct key-account exception", () => {
    const result = resolvePortableAirCommercialTruth(input({
      name: "Coates fleet replacement",
      owner: "Coates",
      overview: "Portable compressor fleet replacement; duty still being confirmed.",
    }));

    expect(result.routeStatus).toBe("direct_proven");
  });
});

describe("Issue #106 timing and buyer route", () => {
  it("moves completed British Hill-style drilling to monitor until the next program is evidenced", () => {
    const result = resolvePortableAirCommercialTruth(input({
      name: "British Hill Gold Project",
      stage: "Exploration",
      overview: "Exploration drilling completed. Mineral Resource Estimate upgrade pending.",
      equipmentSignals: ["RC drilling"],
    }));

    expect(result.timingStatus).toBe("monitor_next_program");
    expect(result.recommendedAction).toBe("monitor_next_program");
    expect(result.actionReady).toBe(false);
  });

  it("ignores malformed contractor/article text as a package holder", () => {
    const malformed = dossier({
      packageHolders: [holder("https://example.com/article?contractor=Acme")],
      contacts: [contact({ company: "Acme" })],
    });
    const result = resolvePortableAirCommercialTruth(input({
      overview: "RC drilling campaign requires large compressor support.",
      equipmentSignals: ["RC drilling"],
    }, { dossier: malformed }));

    expect(isUsablePackageOrganisation("https://example.com/article?contractor=Acme")).toBe(false);
    expect(result.recordedPackageHolders).toEqual([]);
    expect(result.buyerStatus).toBe("map_package_holder");
    expect(result.recommendedAction).toBe("map_package_holder");
  });

  it("does not accept a safe buyer at the wrong organisation", () => {
    const wrongOrg = dossier({
      packageHolders: [holder("Awarded Contractor")],
      contacts: [contact({ company: "Other Contractor", safe: true })],
    });
    const result = resolvePortableAirCommercialTruth(input({
      overview: "RC drilling campaign requires large compressor support.",
      equipmentSignals: ["RC drilling"],
    }, { dossier: wrongOrg }));

    expect(result.routeStatus).toBe("direct_proven");
    expect(result.packageMatchedSafeBuyerCount).toBe(0);
    expect(result.buyerStatus).toBe("find_buyer");
    expect(result.actionReady).toBe(false);
  });

  it("routes a matched but unverified package buyer to validation", () => {
    const unverified = dossier({ contacts: [contact({ safe: false })] });
    const result = resolvePortableAirCommercialTruth(input({
      overview: "RC drilling campaign requires large compressor support.",
      equipmentSignals: ["RC drilling"],
    }, { dossier: unverified }));

    expect(result.routeStatus).toBe("direct_proven");
    expect(result.buyerStatus).toBe("validate_buyer");
    expect(result.recommendedAction).toBe("validate_contacts");
    expect(result.actionReady).toBe(false);
  });

  it("allows action only for a matched safe buyer on a proven direct route", () => {
    const ready = resolvePortableAirCommercialTruth(input({
      overview: "RC drilling campaign requires large compressor support.",
      equipmentSignals: ["RC drilling"],
    }));

    expect(ready.routeStatus).toBe("direct_proven");
    expect(ready.buyerStatus).toBe("package_buyer_ready");
    expect(ready.recommendedAction).toBe("view_best");
    expect(ready.actionReady).toBe(true);
  });
});
