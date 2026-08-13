import type {
  PortableAirCommercialAction,
  PortableAirCommercialTruth,
  PortableAirRouteStatus,
} from "./thisWeekCommercialTruth";

export type CommercialTruthRep = "Ryan Pemberton" | "Paul Lueth" | "Dan Day";

export type PortableAirPolicyAction =
  | PortableAirCommercialAction
  | "route_via_dealer"
  | "refer_managed_account"
  | "refer_territory_owner"
  | "specialist_support_only"
  | "confirm_territory";

export type PortableAirPolicyRouteStatus =
  | PortableAirRouteStatus
  | "channel_cp_dealer"
  | "managed_account_referral"
  | "territory_referral"
  | "specialist_support"
  | "territory_unresolved";

export type CommercialOwnershipStatus =
  | "owned"
  | "managed_account_other_rep"
  | "territory_other_rep"
  | "specialist_support_only"
  | "territory_unresolved";

export type CommercialChannelPolicy =
  | "direct"
  | "direct_key_account"
  | "cea"
  | "cp_dealer"
  | "monitor";

export type NitrogenCollaboration = "dan_specialist_support" | null;
export type AustralianState = "WA" | "QLD" | "NSW" | "VIC" | "SA" | "TAS" | "NT";
export type ManagedPortableAirAccount = "Coates" | "EPSA";

export interface PortableAirCommercialPolicyProject {
  name: string;
  owner: string;
  matchedAccountPrior?: string | null;
  location: string;
  overview: string | null;
  opportunityRoute: string;
  equipmentSignals: string[] | null;
  detectedActivities: string[];
}

export interface PortableAirCommercialPolicyResult
  extends Omit<PortableAirCommercialTruth, "recommendedAction" | "routeStatus"> {
  recommendedAction: PortableAirPolicyAction;
  routeStatus: PortableAirPolicyRouteStatus;
  ownershipStatus: CommercialOwnershipStatus;
  channelPolicy: CommercialChannelPolicy;
  managedAccount: ManagedPortableAirAccount | null;
  managedAccountOwner: CommercialTruthRep | null;
  territoryOwner: CommercialTruthRep | null;
  nitrogenCollaboration: NitrogenCollaboration;
}

const ENABLED_REPS = new Map<string, CommercialTruthRep>([
  ["ryan pemberton", "Ryan Pemberton"],
  ["paul lueth", "Paul Lueth"],
  ["dan day", "Dan Day"],
]);

const REP_TERRITORIES: Record<CommercialTruthRep, readonly AustralianState[]> = {
  "Ryan Pemberton": ["WA"],
  "Paul Lueth": ["QLD", "NSW"],
  "Dan Day": ["VIC", "SA", "TAS", "NT"],
};

function normaliseName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normaliseOrganisation(value: string | null | undefined): string {
  return normaliseName(value)
    .replace(/&/g, " and ")
    .replace(/\b(pty|ltd|limited|inc|corp|corporation|group)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function commercialTruthRepName(
  value: string | null | undefined,
): CommercialTruthRep | null {
  return ENABLED_REPS.get(normaliseName(value)) ?? null;
}

export function isCommercialTruthEnabledRep(
  value: string | null | undefined,
): boolean {
  return commercialTruthRepName(value) !== null;
}

const CFM_PATTERN = /(?<![\d,])((?:\d{1,3}(?:,\d{3})+)|\d{2,5})\s*\+?\s*(?:cfm|cubic\s+feet\s+per\s+minute)\b/gi;

/** Parse common commercial CFM notation without degrading `1,200 CFM` to `200 CFM`. */
export function extractCfmValues(value: string | null | undefined): number[] {
  if (!value) return [];
  return Array.from(value.matchAll(CFM_PATTERN))
    .map(match => Number(match[1].replace(/,/g, "")))
    .filter(cfm => Number.isFinite(cfm) && cfm >= 50);
}

function projectText(project: PortableAirCommercialPolicyProject): string {
  return [
    project.name,
    project.owner,
    project.overview ?? "",
    project.opportunityRoute,
    ...(project.equipmentSignals ?? []),
    ...project.detectedActivities,
  ].join(" ");
}

export function resolveAustralianState(location: string | null | undefined): AustralianState | null {
  const value = location ?? "";
  if (/\bWA\b|\bWestern Australia\b/i.test(value)) return "WA";
  if (/\bQLD\b|\bQueensland\b/i.test(value)) return "QLD";
  if (/\bNSW\b|\bNew South Wales\b/i.test(value)) return "NSW";
  if (/\bVIC\b|\bVictoria\b/i.test(value)) return "VIC";
  if (/\bSA\b|\bSouth Australia\b/i.test(value)) return "SA";
  if (/\bTAS\b|\bTasmania\b/i.test(value)) return "TAS";
  if (/\bNT\b|\bNorthern Territory\b/i.test(value)) return "NT";
  return null;
}

export function territoryOwnerForState(state: AustralianState | null): CommercialTruthRep | null {
  if (state === "WA") return "Ryan Pemberton";
  if (state === "QLD" || state === "NSW") return "Paul Lueth";
  if (state === "VIC" || state === "SA" || state === "TAS" || state === "NT") return "Dan Day";
  return null;
}

export function repOwnsState(rep: CommercialTruthRep, state: AustralianState): boolean {
  return REP_TERRITORIES[rep].includes(state);
}

function managedAccount(project: PortableAirCommercialPolicyProject): {
  account: ManagedPortableAirAccount;
  owner: CommercialTruthRep;
} | null {
  // Only structured account/owner fields can establish a managed account.
  // Project names, contractor text, overview and equipment signals are deliberately excluded.
  const accountText = [project.matchedAccountPrior ?? "", project.owner].join(" ");
  if (/\bcoates(?:\s+hire)?\b/i.test(accountText)) {
    return { account: "Coates", owner: "Ryan Pemberton" };
  }
  if (/\bepsa\b|\benergy\s+power\s+systems\s+australia\b/i.test(accountText)) {
    return { account: "EPSA", owner: "Dan Day" };
  }
  return null;
}

export function organisationMatchesManagedAccount(
  account: ManagedPortableAirAccount,
  organisation: string | null | undefined,
): boolean {
  const value = normaliseOrganisation(organisation);
  if (!value) return false;
  if (account === "Coates") return /\bcoates(?:\s+hire)?\b/.test(value);
  return value === "epsa" || /\benergy power systems australia\b/.test(value);
}

export function hasExplicitCpDealerEvidence(
  project: PortableAirCommercialPolicyProject,
): boolean {
  const text = projectText(project);
  return /\bchicago\s+pneumatic\b|\bcp\s+(?:portable\s+air|compressor|small\s+air)\b|\bu[-\s]?(?:75|110|190)\b/i.test(text);
}

function isNitrogen(
  truth: Pick<PortableAirCommercialTruth, "opportunityType" | "application" | "bestProductAngle">,
): boolean {
  return truth.opportunityType === "purging_inerting"
    || /nitrogen/i.test(truth.application)
    || /\bn2\b|nitrogen/i.test(truth.bestProductAngle);
}

function actionForDirectRoute(
  truth: Pick<PortableAirCommercialTruth, "timingStatus" | "buyerStatus">,
): PortableAirCommercialAction {
  if (truth.timingStatus === "monitor_next_program") return "monitor_next_program";
  if (truth.buyerStatus === "map_package_holder") return "map_package_holder";
  if (truth.buyerStatus === "validate_buyer") return "validate_contacts";
  if (truth.buyerStatus === "find_buyer") return "find_contacts";
  return "view_best";
}

function channelPolicyForRoute(routeStatus: PortableAirRouteStatus): CommercialChannelPolicy {
  if (routeStatus === "direct_proven") return "direct";
  if (routeStatus === "channel_cea") return "cea";
  return "monitor";
}

function replaceReasonCode(
  reasonCodes: readonly string[],
  prefix: string,
  replacement: string,
): string[] {
  return [...reasonCodes.filter(code => !code.startsWith(prefix)), replacement];
}

function directRouteToBuy(truth: PortableAirCommercialPolicyResult): string {
  const holders = truth.recordedPackageHolders.join(" / ");
  if (truth.buyerStatus === "map_package_holder") {
    return "Map the awarded contractor/JV/package holder; principal is referral only";
  }
  if (truth.buyerStatus === "validate_buyer") {
    return `Recorded package holder: ${holders}; validate the matched buyer mailbox`;
  }
  if (truth.buyerStatus === "find_buyer") {
    return `Recorded package holder: ${holders}; find plant/fleet/procurement/technical buyer`;
  }
  return `Recorded package holder: ${holders}; package-matched buyer ready`;
}

function directBestNextMove(action: PortableAirCommercialAction): string {
  if (action === "monitor_next_program") {
    return "Monitor for the next drilling/program package or a new procurement trigger.";
  }
  if (action === "map_package_holder") {
    return "Confirm the awarded contractor/JV and the package that will procure or hire the equipment.";
  }
  if (action === "validate_contacts") {
    return "Validate the package-holder-side buyer before outreach.";
  }
  if (action === "find_contacts") {
    return "Find an exact-linked plant/fleet/procurement/technical buyer at the recorded package holder.";
  }
  return "Proceed with confirmation-first outreach to the package-matched safe buyer.";
}

function makeDirect(
  truth: PortableAirCommercialPolicyResult,
  evidenceReason: string,
  channelPolicy: "direct" | "direct_key_account",
): PortableAirCommercialPolicyResult {
  const recommendedAction = actionForDirectRoute(truth);
  return {
    ...truth,
    routeStatus: "direct_proven",
    channel: "direct",
    channelPolicy,
    recommendedAction,
    actionReady: recommendedAction === "view_best",
    whyNow: recommendedAction === "view_best"
      ? "A direct Portable Air route, recorded package holder and package-matched safe buyer are aligned for action."
      : "A direct Portable Air route is proven, but the buying package or buyer path still needs to be completed before outreach.",
    routeToBuy: directRouteToBuy(truth),
    bestNextMove: directBestNextMove(recommendedAction),
    reasonCodes: [
      ...replaceReasonCode(truth.reasonCodes, "route:", "route:direct_proven"),
      evidenceReason,
    ],
  };
}

function makeCea(
  truth: PortableAirCommercialPolicyResult,
  evidenceReason?: string,
): PortableAirCommercialPolicyResult {
  return {
    ...truth,
    routeStatus: "channel_cea",
    channel: "monitor",
    channelPolicy: "cea",
    recommendedAction: "route_via_cea",
    actionReady: false,
    preferredBuyerContactId: null,
    whyNow: "The recorded compressor duty is at or below 600 cfm, so the opportunity belongs in the CEA channel unless a managed-account exception applies.",
    routeToBuy: "CEA channel (<600 cfm)",
    bestNextMove: "Route through CEA; keep the territory rep as intelligence/support unless a documented managed-account exception applies.",
    reasonCodes: [
      ...replaceReasonCode(truth.reasonCodes, "route:", "route:channel_cea"),
      ...(evidenceReason ? [evidenceReason] : []),
    ],
  };
}

export function applyPortableAirRepPolicy(options: {
  repName: string | null | undefined;
  project: PortableAirCommercialPolicyProject;
  truth: PortableAirCommercialTruth;
}): PortableAirCommercialPolicyResult {
  const rep = commercialTruthRepName(options.repName);
  const account = managedAccount(options.project);
  const state = resolveAustralianState(options.project.location);
  const territoryOwner = territoryOwnerForState(state);
  let result: PortableAirCommercialPolicyResult = {
    ...options.truth,
    routeStatus: options.truth.routeStatus,
    recommendedAction: options.truth.recommendedAction,
    ownershipStatus: "owned",
    channelPolicy: channelPolicyForRoute(options.truth.routeStatus),
    managedAccount: account?.account ?? null,
    managedAccountOwner: account?.owner ?? null,
    territoryOwner,
    nitrogenCollaboration: null,
  };

  // A nationally managed account remains visible to another rep as intelligence,
  // but must never create that rep's primary CTA or action-ready count.
  if (account && rep !== account.owner) {
    return {
      ...result,
      routeStatus: "managed_account_referral",
      recommendedAction: "refer_managed_account",
      ownershipStatus: "managed_account_other_rep",
      channel: "monitor",
      channelPolicy: "monitor",
      actionReady: false,
      preferredBuyerContactId: null,
      whyNow: `${account.account} is a nationally managed direct key account owned by ${account.owner}.`,
      routeToBuy: `Managed account — ${account.owner}`,
      bestNextMove: `Hand the project to ${account.owner}; keep local intelligence visible but do not create a primary outreach CTA.`,
      reasonCodes: [
        ...result.reasonCodes,
        `ownership:managed_account:${account.account.toLowerCase()}:${normaliseName(account.owner)}`,
      ],
    };
  }

  // QLD/NSW nitrogen is Paul's territory with Dan as specialist support, unless
  // Dan owns the project through the EPSA national managed-account exception.
  if (
    !account
    && rep === "Dan Day"
    && (state === "QLD" || state === "NSW")
    && isNitrogen(result)
  ) {
    return {
      ...result,
      routeStatus: "specialist_support",
      recommendedAction: "specialist_support_only",
      ownershipStatus: "specialist_support_only",
      channel: "monitor",
      channelPolicy: "monitor",
      actionReady: false,
      preferredBuyerContactId: null,
      nitrogenCollaboration: "dan_specialist_support",
      whyNow: "This QLD/NSW nitrogen opportunity remains owned by Paul Lueth, with Dan Day providing specialist support.",
      routeToBuy: "Paul Lueth territory ownership with Dan Day nitrogen specialist support",
      bestNextMove: "Support Paul on the nitrogen application; do not create a separate Dan-owned primary CTA.",
      reasonCodes: [
        ...result.reasonCodes,
        "collaboration:dan_specialist_support",
        "ownership:paul_territory_dan_support",
      ],
    };
  }

  // Managed-account owners have a national exception to normal territory and
  // CEA/CP routing, but only when Portable Air relevance is already meaningful.
  if (
    account
    && rep === account.owner
    && result.airFit !== "None"
    && result.airFit !== "Low"
  ) {
    result = makeDirect(
      result,
      `ownership:key_account:${account.account.toLowerCase()}`,
      "direct_key_account",
    );
  }

  // Ordinary projects must belong to the rep's configured state. Unknown state
  // fails closed rather than creating a cross-territory primary action.
  if (!account && rep) {
    if (!state || !territoryOwner) {
      return {
        ...result,
        routeStatus: "territory_unresolved",
        recommendedAction: "confirm_territory",
        ownershipStatus: "territory_unresolved",
        channel: "monitor",
        channelPolicy: "monitor",
        actionReady: false,
        preferredBuyerContactId: null,
        whyNow: "The project state cannot be resolved confidently enough to assign a Portable Air sales owner.",
        routeToBuy: "Confirm Australian state / territory ownership before creating a primary CTA",
        bestNextMove: "Confirm the project state, then re-run the territory and route policy.",
        reasonCodes: [...result.reasonCodes, "ownership:territory_unresolved"],
      };
    }

    if (!repOwnsState(rep, state)) {
      return {
        ...result,
        routeStatus: "territory_referral",
        recommendedAction: "refer_territory_owner",
        ownershipStatus: "territory_other_rep",
        channel: "monitor",
        channelPolicy: "monitor",
        actionReady: false,
        preferredBuyerContactId: null,
        whyNow: `${state} Portable Air ownership belongs to ${territoryOwner}.`,
        routeToBuy: `Territory owner — ${territoryOwner}`,
        bestNextMove: `Hand the project to ${territoryOwner}; retain intelligence/support only if collaboration is required.`,
        reasonCodes: [...result.reasonCodes, `ownership:territory:${state.toLowerCase()}:${normaliseName(territoryOwner)}`],
      };
    }
  }

  // Correct the known CFM notation gap for the three enabled reps. This is a
  // universal product-capacity rule: the same evidence is interpreted identically
  // regardless of which enabled rep owns the project.
  const cfmValues = extractCfmValues(projectText(options.project));
  const largestCfm = cfmValues.length > 0 ? Math.max(...cfmValues) : null;
  if (largestCfm !== null && largestCfm > 600) {
    result = makeDirect(
      {
        ...result,
        airFit: result.airFit === "None" || result.airFit === "Low" ? "Medium" : result.airFit,
        opportunityType: result.opportunityType === "none" ? "large_air" : result.opportunityType,
        bestProductAngle: result.bestProductAngle === "Monitor" ? "Compressor" : result.bestProductAngle,
      },
      `evidence:cfm:${largestCfm}`,
      account ? "direct_key_account" : "direct",
    );
  } else if (
    cfmValues.length > 0
    && cfmValues.every(value => value <= 600)
    && result.routeStatus !== "direct_proven"
  ) {
    result = makeCea(
      {
        ...result,
        airFit: result.airFit === "None" || result.airFit === "Low" ? "Medium" : result.airFit,
        opportunityType: result.opportunityType === "none" ? "small_medium_air" : result.opportunityType,
        bestProductAngle: result.bestProductAngle === "Monitor" ? "Compressor" : result.bestProductAngle,
      },
      `evidence:cfm:${Math.max(...cfmValues)}`,
    );
  } else if (result.routeStatus === "channel_cea") {
    result = makeCea(result);
  }

  // Explicit CP / Chicago Pneumatic demand stays in the dealer lane unless the
  // documented managed-account exception above applies.
  if (!account && hasExplicitCpDealerEvidence(options.project)) {
    return {
      ...result,
      routeStatus: "channel_cp_dealer",
      recommendedAction: "route_via_dealer",
      channel: "monitor",
      channelPolicy: "cp_dealer",
      actionReady: false,
      preferredBuyerContactId: null,
      whyNow: "The recorded product evidence points to the Chicago Pneumatic / dealer lane rather than a direct Atlas Portable Air CTA.",
      routeToBuy: "CP / dealer channel",
      bestNextMove: "Route through the appropriate CP/dealer channel; keep the Atlas rep in support only where needed.",
      reasonCodes: [
        ...replaceReasonCode(result.reasonCodes, "route:", "route:cp_dealer"),
        "channel:cp_dealer",
      ],
    };
  }

  if (
    rep === "Paul Lueth"
    && (state === "QLD" || state === "NSW")
    && isNitrogen(result)
  ) {
    return {
      ...result,
      nitrogenCollaboration: "dan_specialist_support",
      bestNextMove: `${result.bestNextMove} Coordinate the nitrogen package with Dan Day as specialist support while Paul retains account ownership.`,
      reasonCodes: [...result.reasonCodes, "collaboration:dan_specialist_support"],
    };
  }

  return result;
}
