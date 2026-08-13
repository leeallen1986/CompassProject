import type { ProjectBuyerRoute } from "./projectBuyerRoute";

export type PortableAirRouteStatus =
  | "direct_proven"
  | "confirm_product_scope"
  | "channel_cea"
  | "not_relevant";

export type PortableAirTimingStatus = "actionable" | "monitor_next_program";

export type PortableAirBuyerStatus =
  | "package_buyer_ready"
  | "validate_buyer"
  | "find_buyer"
  | "map_package_holder";

export type PortableAirCommercialAction =
  | "view_best"
  | "validate_contacts"
  | "find_contacts"
  | "map_package_holder"
  | "confirm_product_scope"
  | "monitor_next_program"
  | "route_via_cea";

export interface PortableAirCommercialTruthInput {
  project: {
    name: string;
    owner: string;
    stage: string | null;
    overview: string | null;
    opportunityRoute: string;
    equipmentSignals: string[] | null;
    detectedActivities?: string[];
  };
  lane: {
    airFit: "High" | "Medium" | "Low" | "None";
    opportunityType: string;
    bestProductAngle: string;
    channel: "direct" | "rental" | "crosssell" | "monitor";
  };
  dossier: ProjectBuyerRoute | null;
}

export interface PortableAirCommercialTruth {
  application: string;
  airFit: "High" | "Medium" | "Low" | "None";
  opportunityType: string;
  bestProductAngle: string;
  routeStatus: PortableAirRouteStatus;
  channel: "direct" | "monitor";
  timingStatus: PortableAirTimingStatus;
  buyerStatus: PortableAirBuyerStatus;
  recommendedAction: PortableAirCommercialAction;
  actionReady: boolean;
  recordedPackageHolders: string[];
  packageMatchedNamedBuyerCount: number;
  packageMatchedSafeBuyerCount: number;
  preferredBuyerContactId: number | null;
  whyNow: string;
  routeToBuy: string;
  bestNextMove: string;
  reasonCodes: string[];
}

const BUYER_LANES = new Set(["contractor", "commercial", "technical"]);
const PACKAGE_HOLDER_ROLES = new Set(["epc", "contractor", "subcontractor"]);
const GENERIC_ORGANISATION = /^(unknown|various|multiple|none|pending|tba|tbc|tbd|n\/?a|not specified|to be confirmed|not yet awarded|to be appointed|-+)$/i;

function normalise(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(pty|ltd|limited|inc|corp|corporation|group|australia)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isUsablePackageOrganisation(value: string | null | undefined): boolean {
  const compact = (value ?? "").trim().replace(/\s+/g, " ");
  if (!compact || compact.length < 2 || compact.length > 120) return false;
  if (GENERIC_ORGANISATION.test(compact)) return false;
  if (/https?:\/\/|www\.|<[^>]+>|href\s*=|\{\s*"|\}\s*$/i.test(compact)) return false;
  if ((compact.match(/[.!?]/g) ?? []).length >= 2) return false;
  if (compact.split(/\s+/).length > 14) return false;
  return /[a-z]/i.test(compact);
}

function isRecordedBuyingPackageHolder(
  holder: ProjectBuyerRoute["packageHolders"][number],
): boolean {
  if (holder.evidenceState !== "recorded_unverified") return false;
  if (!isUsablePackageOrganisation(holder.organisation)) return false;

  const role = (holder.recordedRole ?? "").trim().toLowerCase();
  const status = (holder.recordedStatus ?? "").trim().toLowerCase();
  const scope = (holder.packageScope ?? "").trim().toLowerCase();

  // A supplier/vendor record is useful project context, but it is not evidence
  // that the organisation owns the package that will procure/hire Portable Air.
  if (/\b(supplier|vendor|material supplier|service provider|consultant|advisor)\b/i.test(status)) {
    return false;
  }
  if (/\b(supplied|supplies|supply of|materials? supply|rock supply)\b/i.test(scope)) {
    return false;
  }

  // Exact contractorProjectLinks already carry a recorded buying-side role.
  if (PACKAGE_HOLDER_ROLES.has(role)) return true;

  // Free-form project contractor rows do not always carry a role. In that case,
  // require both an awarded/appointed/confirmed status and scope text that actually
  // describes a contract/package. A generic "confirmed via source" record is not enough.
  if (role) return false;
  if (!/\b(awarded|appointed|contracted|confirmed)\b/i.test(status)) return false;
  return /\b(contract|epc|construction|civil works?|installation|drilling|commissioning|package|subcontract)\b/i.test(scope);
}

function combinedText(input: PortableAirCommercialTruthInput): string {
  return [
    input.project.name,
    input.project.overview ?? "",
    input.project.stage ?? "",
    input.project.opportunityRoute,
    ...(input.project.equipmentSignals ?? []),
    ...(input.project.detectedActivities ?? []),
  ].join(" ").toLowerCase();
}

function containsAny(text: string, values: readonly string[]): boolean {
  return values.some(value => text.includes(value));
}

function cfmValues(text: string): number[] {
  const matches = text.matchAll(/\b(\d{2,4}(?:,\d{3})?)\s*(?:cfm|cubic\s+feet\s+per\s+minute)\b/gi);
  return Array.from(matches)
    .map(match => Number(match[1].replace(/,/g, "")))
    .filter(value => Number.isFinite(value));
}

function classifyApplication(text: string, lane: PortableAirCommercialTruthInput["lane"]): {
  application: string;
  airFit: PortableAirCommercialTruth["airFit"];
  opportunityType: string;
  bestProductAngle: string;
} {
  const hasNitrogen = containsAny(text, ["nitrogen", "n2 membrane", "nitrogen membrane", "inerting", "nitrogen purge"]);
  const hasBooster = containsAny(text, ["booster compressor", "gas booster", "air booster", "pressure booster", "high-pressure testing", "high pressure testing"]);
  const hasPipeline = containsAny(text, ["pipeline", "pipe line", "gas line", "water main"]);
  const hasPipelineTesting = containsAny(text, ["pipeline testing", "pressure testing", "hydrotest", "hydrostatic", "pigging", "pipeline integrity", "pneumatic test"]);
  const hasDrying = containsAny(text, ["pipeline drying", "pipe drying", "dry-out", "dryout", "pre-commissioning", "pre commissioning", "dewatering pipeline", "pipeline dewatering", "dew point"]);
  const hasCommissioning = containsAny(text, ["commissioning", "pre-commissioning", "pre commissioning", "start-up", "startup"]);
  const hasGasProcessing = containsAny(text, ["gas processing", "lng", "gas plant", "gas facility", "offshore gas", "fpso"]);
  const hasPipelineConstruction = hasPipeline && containsAny(text, ["construction", "upgrade", "excavation", "trench", "trenching", "civil", "installation", "blasting", "drilling"]);
  const hasHighDemandDrilling = containsAny(text, [
    "reverse circulation", "rc drilling", "rc drill", "aircore", "air core", "down-the-hole", "down the hole", "dth",
    "blast-hole", "blast hole", "blasthole", "exploration drilling", "drill rig", "drilling campaign", "drill test",
  ]);
  const hasAbrasiveBlasting = containsAny(text, ["abrasive blasting", "sandblast", "sand blasting", "grit blast", "surface preparation"]);
  const hasShutdown = containsAny(text, ["shutdown", "turnaround", "temporary plant air", "plant air", "instrument air"]);
  const hasDecommissioning = containsAny(text, ["decommissioning", "decommission", "demolition"]);
  const hasElectric = containsAny(text, ["e-air", "electric compressor", "electric portable", "fixed speed", "1000v", "1000 v", "underground electric"]);

  if (hasNitrogen && (hasPipeline || hasCommissioning || hasGasProcessing)) {
    return { application: "Nitrogen purging / inerting / commissioning", airFit: "High", opportunityType: "purging_inerting", bestProductAngle: "N2 Membrane" };
  }
  if (hasBooster) {
    return { application: "High-pressure booster / pressure testing", airFit: "High", opportunityType: "high_pressure_booster", bestProductAngle: "Booster" };
  }
  if (hasPipeline && (hasPipelineTesting || hasDrying || hasCommissioning)) {
    return { application: "Pipeline testing / drying / commissioning", airFit: "High", opportunityType: "pipeline_testing", bestProductAngle: hasDrying ? "Package" : "Compressor" };
  }
  if (hasGasProcessing && hasCommissioning) {
    return { application: "Gas processing / plant commissioning", airFit: "High", opportunityType: "specialty_air_package", bestProductAngle: "Package" };
  }
  if (hasPipelineConstruction) {
    return { application: "Pipeline construction / excavation air", airFit: "Medium", opportunityType: "pipeline_construction", bestProductAngle: "Compressor" };
  }
  if (hasElectric) {
    return { application: "Electric portable air / fixed-speed", airFit: "High", opportunityType: "electric_portable_air", bestProductAngle: "Compressor" };
  }
  if (hasHighDemandDrilling) {
    return { application: "RC / Aircore / DTH drilling", airFit: "High", opportunityType: "drilling_blasting", bestProductAngle: "Compressor" };
  }
  if (hasAbrasiveBlasting) {
    return { application: "Abrasive blasting / coatings", airFit: "High", opportunityType: "abrasive_blasting", bestProductAngle: "Compressor" };
  }
  if (hasShutdown) {
    return { application: "Shutdown / temporary plant air", airFit: lane.airFit === "High" ? "High" : "Medium", opportunityType: "shutdown_commissioning", bestProductAngle: lane.bestProductAngle === "Dryer" ? "Package" : "Compressor" };
  }
  if (hasDecommissioning) {
    return { application: "Decommissioning — confirm compressed-air package", airFit: lane.airFit === "None" ? "Low" : lane.airFit, opportunityType: "decommissioning_scope", bestProductAngle: lane.bestProductAngle === "Monitor" ? "Compressor" : lane.bestProductAngle };
  }

  return {
    application: lane.opportunityType === "none" ? "Portable Air application not proven" : "General compressed-air requirement",
    airFit: lane.airFit,
    opportunityType: lane.opportunityType,
    bestProductAngle: lane.bestProductAngle,
  };
}

function completedProgramWithoutNextTrigger(text: string): boolean {
  const completed = /\b(drilling|exploration|drill(?:ing)?\s+program|campaign)\s+(?:is\s+)?(?:complete|completed|finished|concluded)\b/i.test(text)
    || /\bcompleted\s+(?:the\s+)?(?:exploration|drilling|drill(?:ing)?\s+program|campaign)\b/i.test(text);
  if (!completed) return false;

  const nextTrigger = /\b(new|next|follow[- ]?up|phase\s+\d+)\s+(?:exploration\s+)?drill(?:ing)?\b|\bdrilling\s+(?:to\s+commence|commences|underway|scheduled|planned|awarded|mobilis|mobiliz)|\b(?:tender|procurement|rfq|rft)\b/i.test(text);
  return !nextTrigger;
}

function routeStatus(
  input: PortableAirCommercialTruthInput,
  text: string,
  application: ReturnType<typeof classifyApplication>,
): PortableAirRouteStatus {
  if (application.airFit === "None") return "not_relevant";

  const ownerAndName = `${input.project.owner} ${input.project.name}`.toLowerCase();
  const directKeyAccount = /\bcoates\b/i.test(ownerAndName);
  if (directKeyAccount) return "direct_proven";

  const values = cfmValues(text);
  if (values.some(value => value > 600)) return "direct_proven";

  const specialtyDirect = new Set([
    "high_pressure_booster",
    "pipeline_testing",
    "purging_inerting",
    "specialty_air_package",
    "air_treatment",
    "electric_portable_air",
  ]);
  if (specialtyDirect.has(application.opportunityType)) return "direct_proven";

  const explicitHighDemandDrilling = application.opportunityType === "drilling_blasting"
    && containsAny(text, ["reverse circulation", "rc drill", "rc drilling", "aircore", "air core", "dth", "down-the-hole", "blast-hole", "blasthole", "drill rig", "drilling campaign"]);
  if (explicitHighDemandDrilling) return "direct_proven";

  if (values.length > 0 && values.every(value => value <= 600)) return "channel_cea";

  if (application.airFit === "Low") return "not_relevant";
  return "confirm_product_scope";
}

function recordedPackageHolders(dossier: ProjectBuyerRoute | null): string[] {
  if (!dossier) return [];
  return Array.from(new Set(
    dossier.packageHolders
      .filter(isRecordedBuyingPackageHolder)
      .map(holder => holder.organisation.trim()),
  ));
}

function buyerState(dossier: ProjectBuyerRoute | null, holders: string[]) {
  const holderNames = new Set(holders.map(normalise).filter(Boolean));
  if (!dossier || holderNames.size === 0) {
    return {
      status: "map_package_holder" as const,
      named: [] as ProjectBuyerRoute["contacts"],
      safe: [] as ProjectBuyerRoute["contacts"],
    };
  }

  const named = dossier.contacts.filter(contact =>
    contact.effectiveTrustTier !== "llm_inferred"
    && BUYER_LANES.has(contact.lane.value)
    && holderNames.has(normalise(contact.organisation.recordedName)),
  );
  const safe = named.filter(contact => contact.effectivelySendReady);

  return {
    status: safe.length > 0
      ? "package_buyer_ready" as const
      : named.length > 0
        ? "validate_buyer" as const
        : "find_buyer" as const,
    named,
    safe,
  };
}

export function resolvePortableAirCommercialTruth(
  input: PortableAirCommercialTruthInput,
): PortableAirCommercialTruth {
  const text = combinedText(input);
  const application = classifyApplication(text, input.lane);
  const route = routeStatus(input, text, application);
  const timingStatus: PortableAirTimingStatus = completedProgramWithoutNextTrigger(text)
    ? "monitor_next_program"
    : "actionable";
  const holders = recordedPackageHolders(input.dossier);
  const buyers = buyerState(input.dossier, holders);

  let recommendedAction: PortableAirCommercialAction;
  if (timingStatus === "monitor_next_program") recommendedAction = "monitor_next_program";
  else if (route === "channel_cea") recommendedAction = "route_via_cea";
  else if (route === "confirm_product_scope") recommendedAction = "confirm_product_scope";
  else if (route === "not_relevant") recommendedAction = "monitor_next_program";
  else if (buyers.status === "map_package_holder") recommendedAction = "map_package_holder";
  else if (buyers.status === "validate_buyer") recommendedAction = "validate_contacts";
  else if (buyers.status === "find_buyer") recommendedAction = "find_contacts";
  else recommendedAction = "view_best";

  const actionReady = route === "direct_proven"
    && timingStatus === "actionable"
    && buyers.status === "package_buyer_ready";

  const reasonCodes: string[] = [
    `application:${application.opportunityType}`,
    `route:${route}`,
    `timing:${timingStatus}`,
    `buyer:${buyers.status}`,
  ];

  const whyNow = timingStatus === "monitor_next_program"
    ? "The current drilling/exploration program is recorded as complete and no next equipment package is yet evidenced."
    : route === "confirm_product_scope"
      ? "The project has a credible compressed-air use case, but the compressor family/capacity is not yet strong enough to assert a direct >600 cfm opportunity."
      : route === "channel_cea"
        ? "The recorded compressor duty is at or below 600 cfm, so the opportunity should route through the CEA channel unless a key-account exception applies."
        : actionReady
          ? "A direct Portable Air application, recorded package holder and package-matched safe buyer are aligned for action."
          : "The project has a direct Portable Air use case, but the package/buyer route still needs to be completed before outreach.";

  const routeToBuy = route === "channel_cea"
    ? "CEA channel (<600 cfm)"
    : route === "confirm_product_scope"
      ? "Confirm cfm / pressure / product family before assigning direct vs CEA"
      : buyers.status === "map_package_holder"
        ? "Map the awarded contractor/JV/package holder; principal is referral only"
        : buyers.status === "validate_buyer"
          ? `Recorded package holder: ${holders.join(" / ")}; validate the matched buyer mailbox`
          : buyers.status === "find_buyer"
            ? `Recorded package holder: ${holders.join(" / ")}; find plant/fleet/procurement/technical buyer`
            : `Recorded package holder: ${holders.join(" / ")}; package-matched buyer ready`;

  const bestNextMove = recommendedAction === "monitor_next_program"
    ? "Monitor for the next drilling/program package or a new procurement trigger."
    : recommendedAction === "route_via_cea"
      ? "Route through CEA; keep Ryan as intelligence/support unless a direct key-account exception applies."
      : recommendedAction === "confirm_product_scope"
        ? "Confirm required cfm, pressure and application; only classify as direct once >600 cfm or a specialty/electric family is evidenced."
        : recommendedAction === "map_package_holder"
          ? "Confirm the awarded contractor/JV and the package that will procure or hire the equipment."
          : recommendedAction === "validate_contacts"
            ? "Validate the package-holder-side buyer before outreach."
            : recommendedAction === "find_contacts"
              ? "Find an exact-linked plant/fleet/procurement/technical buyer at the recorded package holder."
              : "Proceed with confirmation-first outreach to the package-matched safe buyer.";

  return {
    application: application.application,
    airFit: application.airFit,
    opportunityType: application.opportunityType,
    bestProductAngle: application.bestProductAngle,
    routeStatus: route,
    channel: route === "direct_proven" ? "direct" : "monitor",
    timingStatus,
    buyerStatus: buyers.status,
    recommendedAction,
    actionReady,
    recordedPackageHolders: holders,
    packageMatchedNamedBuyerCount: buyers.named.length,
    packageMatchedSafeBuyerCount: buyers.safe.length,
    preferredBuyerContactId: buyers.safe[0]?.contactId ?? buyers.named[0]?.contactId ?? null,
    whyNow,
    routeToBuy,
    bestNextMove,
    reasonCodes,
  };
}
