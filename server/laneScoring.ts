/**
 * Lane-Specific Scoring Architecture
 * ====================================
 * Single source of truth for all lane-aware ranking logic across the weekly
 * digest and the dashboard "This Week" view.
 *
 * Architecture (Part A of the spec):
 *   1. Shared base score          — territory fit, project heat, stage timing,
 *                                   route-to-buy clarity, contact quality,
 *                                   strategic account fit
 *   2. Lane-specific opportunity  — portableAirOpportunityScore, pumpOpportunityScore,
 *                                   palOpportunityScore, bessOpportunityScore,
 *                                   multiLaneOpportunityScore
 *   3. Selling-motion channel     — Direct / Rental / Cross-sell / Monitor
 *   4. Per-user final score       — combines all dimensions using the user's
 *                                   territory, BL assignment, lane focus, sector,
 *                                   key accounts, buyer role, and actionability
 *
 * Suppression rule:
 *   Projects with a lane opportunity score < LANE_SUPPRESS_THRESHOLD for the
 *   user's primary lane are demoted to "monitor_only" regardless of heat/tier.
 *   This prevents generic hot projects from polluting a rep's lane-specific brief.
 */

import type { DimensionScore } from "./businessLineScoring";

// ── Suppression / visibility thresholds ──
// A project is only fully suppressed when ALL three conditions are met:
//   1. Primary lane score < LANE_SUPPRESS_THRESHOLD
//   2. Secondary / cross-sell score < LANE_CROSSSELL_THRESHOLD
//   3. Actionability score < LANE_ACTIONABILITY_THRESHOLD
// Otherwise it is demoted to monitor_only, not suppressed.
export const LANE_SUPPRESS_THRESHOLD = 20;
export const LANE_CROSSSELL_THRESHOLD = 25;
export const LANE_ACTIONABILITY_THRESHOLD = 30;

// ── Types ──

export type SellingMotion = "direct" | "rental" | "crosssell" | "monitor";

export interface LaneOpportunityScores {
  /** Portable Air: drilling, blasting, tunnelling, mining, shutdown, pipeline air */
  portableAir: number;
  /** Pump/Dewatering: excavation, groundwater, mine dewatering, marine, slurry */
  pump: number;
  /** PAL: temporary power, lighting, remote site, shutdown access */
  pal: number;
  /** BESS: remote power, hybrid, microgrid, electrification, commissioning */
  bess: number;
  /**
   * Multi-lane PT: blended score when multiple lanes apply.
   * Also carries primaryLane and secondaryLane for display.
   */
  multiLane: number;
  primaryLane: string | null;
  secondaryLane: string | null;
  crossSellFit: number; // 0-100
}

export interface SharedBaseScore {
  /** 0-100 */
  total: number;
  breakdown: {
    territoryFit: number;       // 0-20
    projectHeat: number;        // 0-15
    stageTiming: number;        // 0-15
    routeToBuyClarity: number;  // 0-15
    contactQuality: number;     // 0-20
    strategicAccountFit: number; // 0-15
  };
}

/**
 * Visibility tier returned by classifyVisibility().
 * Separates scoring from section assignment.
 */
export type VisibilityTier =
  | "must_act_candidate"
  | "watchlist_candidate"
  | "monitor_only"
  | "suppress";

export interface LaneScoredProject {
  /** Combined final score 0-100 used for sorting */
  finalScore: number;
  /** Final score after optional mlRanker tie-breaker boost (±5 pts) */
  finalScoreWithTieBreaker: number;
  /** Shared base score breakdown */
  baseScore: SharedBaseScore;
  /** Lane opportunity scores */
  laneScores: LaneOpportunityScores;
  /** The lane opportunity score for the user's primary assigned lane (0-100) */
  primaryLaneScore: number;
  /** Selling-motion classification */
  sellingMotion: SellingMotion;
  /**
   * @deprecated Use classifyVisibility() instead.
   * Kept for backward compat — true only when suppress tier is assigned.
   */
  laneSuppressed: boolean;
  /** Human-readable lane fit label for card display */
  laneFitLabel: "High" | "Medium" | "Low" | "Not relevant";
  /** Why this project is actionable now (1-2 sentences) */
  whyNow: string;
  /** Route-to-buy description */
  routeToBuy: string;
  /** Best next move for the rep */
  bestNextMove: string;
  /** Channel label for card display */
  channelLabel: string;
  /**
   * Deterministic channel enum for programmatic use.
   * Values: direct | rental | crosssell | monitor
   */
  channel: SellingMotion;
  /**
   * Machine-readable reason codes explaining the score.
   * Used for explainability in digest and dashboard.
   */
  reasonCodes: string[];
}

// ── Keyword lists for lane opportunity scoring (Part B) ──

const PORTABLE_AIR_BOOST_KEYWORDS = [
  "mining", "drill", "drilling", "blast", "blasting", "tunnell", "tunnel",
  "shutdown", "turnaround", "pipeline commissioning", "gas commissioning",
  "temporary plant air", "pneumatic", "shotcrete", "underground",
  "rock drill", "percussion", "quarry", "quarrying", "exploration drilling",
  "contractor fleet", "fleet replacement", "fleet displacement",
  "compressed air", "compressor", "xas", "xats", "xavs", "xrhs",
  "bore", "boring", "horizontal directional", "hdd",
];

const PORTABLE_AIR_PENALTY_KEYWORDS = [
  "social housing", "community centre", "school", "hospital", "aged care",
  "policy", "funding announcement", "grant", "subsidy",
  "government-only", "no contractor", "residential",
  "office building", "commercial fitout", "retail fitout",
  "park", "playground", "streetscape",
];

const PUMP_BOOST_KEYWORDS = [
  "desalin", "dewater", "dewatering", "excavat", "groundwater",
  "site drainage", "drainage", "mine dewater", "marine", "trench", "trenching",
  "wet works", "water infrastructure", "water treatment", "process water",
  "slurry", "tailings", "flood", "dam", "reservoir", "irrigation",
  "submersible", "wellpoint", "borehole", "sump", "pump", "pumping",
  "water handling", "water management", "seepage", "water table",
  "cofferdam", "dredg", "dredging", "offshore pipeline",
  "pas ", "weda", "water main", "sewer", "wastewater",
];

const PUMP_PENALTY_KEYWORDS = [
  "dry project", "no fluid", "no water", "arid", "desert",
  "generic building", "office", "retail", "commercial fitout",
  "social housing", "residential", "school", "hospital",
];

const PAL_BOOST_KEYWORDS = [
  "shutdown", "turnaround", "maintenance", "industrial maintenance",
  "temporary lighting", "site lighting", "temporary power",
  "remote site", "access", "scaffolding", "elevated work platform",
  "major infrastructure", "construction camp", "camp power",
  "generator", "lighting tower", "hilight", "qas", "qes",
  "temporary site", "mobile power", "portable power",
  "night shift", "24 hour", "extended hours",
];

const BESS_BOOST_KEYWORDS = [
  "remote power", "hybrid power", "battery storage", "bess",
  "microgrid", "micro-grid", "electrification", "energy transition",
  "renewable", "solar hybrid", "wind hybrid", "off-grid",
  "temporary power substitution", "grid constraint", "peak shaving",
  "commissioning", "mine electrification", "zero emission",
  "zernergi", "zenergi", "energy storage", "esg power",
  "standalone power", "backup power", "critical power",
];

// ── Helpers ──

function countKeywordMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter(kw => lower.includes(kw)).length;
}

function scoreFromKeywords(
  text: string,
  boostKeywords: string[],
  penaltyKeywords: string[],
  baselineBLScore: number, // 0-100 from LLM scoring
): number {
  const boosts = countKeywordMatches(text, boostKeywords);
  const penalties = countKeywordMatches(text, penaltyKeywords);

  // Start from the LLM BL score as the anchor (it has the richest signal)
  let score = baselineBLScore;

  // Keyword boosts: +4 per match, capped at +20
  score += Math.min(boosts * 4, 20);

  // Keyword penalties: -8 per match, capped at -30
  score -= Math.min(penalties * 8, 30);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function projectText(project: {
  name: string;
  overview: string | null;
  sector: string;
  stage: string | null;
  opportunityRoute: string;
  equipmentSignals?: string[] | null;
}): string {
  return [
    project.name,
    project.overview ?? "",
    project.sector,
    project.stage ?? "",
    project.opportunityRoute,
    (project.equipmentSignals ?? []).join(" "),
  ].join(" ");
}

// ── Part B: Lane-specific opportunity scores ──

export function computeLaneOpportunityScores(
  project: {
    name: string;
    overview: string | null;
    sector: string;
    stage: string | null;
    opportunityRoute: string;
    equipmentSignals?: string[] | null;
  },
  blScores: DimensionScore[],
): LaneOpportunityScores {
  const text = projectText(project);

  const blMap: Record<string, number> = {};
  for (const s of blScores) blMap[s.dimension] = s.score;

  // ── Portable Air ──
  const portableAir = scoreFromKeywords(
    text,
    PORTABLE_AIR_BOOST_KEYWORDS,
    PORTABLE_AIR_PENALTY_KEYWORDS,
    blMap["Portable Air"] ?? 0,
  );

  // ── Pump/Dewatering ──
  // Accept multiple BL name variants from the DB
  const pumpBLScore = blMap["Dewatering Pumps"] ?? blMap["Pump/Dewatering"] ?? blMap["Pump (Flow)"] ?? blMap["Pumps"] ?? 0;
  const pump = scoreFromKeywords(
    text,
    PUMP_BOOST_KEYWORDS,
    PUMP_PENALTY_KEYWORDS,
    pumpBLScore,
  );

  // ── PAL (Power & Light) ──
  const pal = scoreFromKeywords(
    text,
    PAL_BOOST_KEYWORDS,
    [], // no specific penalties for PAL
    Math.max(blMap["PAL"] ?? 0, blMap["Generators"] ?? 0),
  );

  // ── BESS ──
  const bess = scoreFromKeywords(
    text,
    BESS_BOOST_KEYWORDS,
    [], // no specific penalties for BESS
    blMap["BESS"] ?? 0,
  );

  // ── Multi-lane PT ──
  // Identify the top two lanes and compute a blended score
  const laneMap: Record<string, number> = {
    "Portable Air": portableAir,
    "Pump/Dewatering": pump,
    "PAL": pal,
    "BESS": bess,
  };
  const sortedLanes = Object.entries(laneMap).sort((a, b) => b[1] - a[1]);
  const [topLane, secondLane] = sortedLanes;
  const primaryLane = topLane?.[0] ?? null;
  const secondaryLane = secondLane && secondLane[1] >= 25 ? secondLane[0] : null;
  const multiLane = secondaryLane
    ? Math.round(0.6 * (topLane?.[1] ?? 0) + 0.4 * (secondLane?.[1] ?? 0))
    : topLane?.[1] ?? 0;

  // ── Cross-sell fit ──
  // The cross-sell fit for a given rep is the max of all non-primary lane scores.
  // This correctly captures: a Pump rep on a drilling project has high cross-sell fit
  // because the portableAir score is high.
  // We compute this in computePerUserFinalScore() where we know the user's primary lane.
  // Here we store the max of all secondary lanes as a general cross-sell signal.
  const allLaneScores = [portableAir, pump, pal, bess];
  const topLaneScore = Math.max(...allLaneScores);
  const secondLaneScores = allLaneScores.filter(s => s < topLaneScore);
  const crossSellFit = secondLaneScores.length > 0 ? Math.max(...secondLaneScores) : 0;

  return {
    portableAir,
    pump,
    pal,
    bess,
    multiLane,
    primaryLane,
    secondaryLane,
    crossSellFit,
  };
}

// ── Part A.3: Selling-motion / channel classifier ──

export function classifySellingMotion(
  project: {
    name: string;
    overview: string | null;
    sector: string;
    stage: string | null;
    opportunityRoute: string;
    equipmentSignals?: string[] | null;
  },
  blScores: DimensionScore[],
  laneScores: LaneOpportunityScores,
): SellingMotion {
  const blMap: Record<string, number> = {};
  for (const s of blScores) blMap[s.dimension] = s.score;

  const rentalScore = blMap["Rental Influence"] ?? 0;
  const text = projectText(project).toLowerCase();

  // Monitor: no meaningful lane signal
  const maxLaneScore = Math.max(laneScores.portableAir, laneScores.pump, laneScores.pal, laneScores.bess);
  if (maxLaneScore < 20) return "monitor";

  // Rental-led: high rental influence score OR short-duration / shutdown / hire signals
  const rentalSignals = ["shutdown", "turnaround", "short-term", "hire", "rental", "opex", "temporary", "mobilisation", "mobilization", "contract mining"];
  const hasRentalSignal = rentalSignals.some(kw => text.includes(kw));
  if (rentalScore >= 55 || (rentalScore >= 35 && hasRentalSignal)) return "rental";

  // Cross-sell: secondary lane signal is strong but primary lane is moderate
  if (laneScores.secondaryLane && laneScores.multiLane >= 40 && maxLaneScore < 55) return "crosssell";

  // Direct sale: strong primary lane signal, CAPEX indicators
  const capexSignals = ["capex", "purchase", "procurement", "supply", "contract award", "awarded", "epc", "lump sum", "fixed price"];
  const hasCapexSignal = capexSignals.some(kw => text.includes(kw));
  if (maxLaneScore >= 55 && hasCapexSignal) return "direct";

  // Default: direct if strong lane signal, rental if moderate with rental context
  if (maxLaneScore >= 55) return "direct";
  if (hasRentalSignal) return "rental";
  return "crosssell";
}

// ── Part A.1: Shared base score ──

const STAGE_TIMING_MAP: Record<string, string[]> = {
  early_signal:       ["planning", "feasibility", "study", "announcement", "early", "concept", "pre-feasibility", "scoping"],
  tender_live:        ["tender", "rfq", "rfp", "eoi", "bid", "procurement", "expression of interest"],
  awarded_mobilizing: ["awarded", "mobilizing", "mobilisation", "construction", "execution", "active", "underway", "commenced"],
  commissioning:      ["commissioning", "startup", "start-up", "handover", "testing"],
  operations:         ["operations", "production", "operating", "operational", "mro", "shutdown", "maintenance"],
};

const STATE_KEYWORDS: Record<string, string[]> = {
  WA:  ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha", "port hedland", "newman", "geraldton", "bunbury", "broome", "norseman", "murchison", "kwinana"],
  QLD: ["queensland", "qld", "brisbane", "townsville", "mackay", "gladstone", "rockhampton", "cairns", "bowen basin", "moranbah", "emerald"],
  NSW: ["new south wales", "nsw", "sydney", "newcastle", "hunter valley", "wollongong", "broken hill", "orange", "dubbo", "mudgee", "goulburn"],
  VIC: ["victoria", "vic", "melbourne", "geelong", "ballarat", "bendigo", "latrobe"],
  SA:  ["south australia", "sa", "adelaide", "olympic dam", "whyalla", "port augusta"],
  NT:  ["northern territory", "nt", "darwin", "alice springs", "tennant creek", "katherine"],
  TAS: ["tasmania", "tas", "hobart", "launceston"],
  ACT: ["australian capital territory", "act", "canberra"],
};

function locationMatchesTerritories(location: string, territories: string[]): boolean {
  const loc = location.toLowerCase();
  return territories.some(t => {
    if (t.toUpperCase() === "NATIONAL") return true;
    const keywords = STATE_KEYWORDS[t.toUpperCase()] || [t.toLowerCase()];
    return keywords.some(kw => {
      if (kw.length <= 3) {
        const re = new RegExp(`(?:^|[\\s,;/|()\\-])${kw}(?:$|[\\s,;/|()\\-])`, "i");
        return re.test(loc);
      }
      return loc.includes(kw);
    });
  });
}

export function computeSharedBaseScore(
  project: {
    name: string;
    location: string;
    priority: string;
    sector: string;
    stage: string | null;
    opportunityRoute: string;
    isNew: boolean;
    owner: string;
    value: string;
  },
  profile: {
    territories?: string[] | null;
    sectorFocus?: string[] | null;
    stageTiming?: string[] | null;
    keyAccounts?: string[] | null;
  },
  contactQualityScore: number, // 0-100: caller provides based on trust tier / count
  routeToBuyScore: number,     // 0-100: caller provides based on contractor known / opportunity route
): SharedBaseScore {
  const breakdown = {
    territoryFit: 0,
    projectHeat: 0,
    stageTiming: 0,
    routeToBuyClarity: 0,
    contactQuality: 0,
    strategicAccountFit: 0,
  };

  // ── 1. Territory fit (0-20) ──
  const territories = profile.territories || [];
  if (territories.length === 0 || territories.some(t => t.toUpperCase() === "NATIONAL")) {
    breakdown.territoryFit = 12; // National reps: moderate base
  } else if (locationMatchesTerritories(project.location, territories)) {
    breakdown.territoryFit = 20;
  } else {
    breakdown.territoryFit = 0; // Hard miss — will be excluded upstream anyway
  }

  // ── 2. Project heat (0-15) ──
  breakdown.projectHeat = project.priority === "hot" ? 15
    : project.priority === "warm" ? 9
    : project.isNew ? 5
    : 3;

  // ── 3. Stage timing (0-15) ──
  const stagePref = (profile.stageTiming || []).map(s => s.toLowerCase());
  const projStage = (project.stage || "").toLowerCase();
  if (stagePref.length > 0) {
    const [firstPref, ...restPrefs] = stagePref;
    const firstAliases = STAGE_TIMING_MAP[firstPref] || [firstPref];
    if (firstAliases.some(a => projStage.includes(a))) {
      breakdown.stageTiming = 15;
    } else {
      for (const pref of restPrefs) {
        const aliases = STAGE_TIMING_MAP[pref] || [pref];
        if (aliases.some(a => projStage.includes(a))) {
          breakdown.stageTiming = 8;
          break;
        }
      }
    }
  } else {
    // No stage preference: give partial credit for active stages
    const activeAliases = STAGE_TIMING_MAP["awarded_mobilizing"] || [];
    const tenderAliases = STAGE_TIMING_MAP["tender_live"] || [];
    if (activeAliases.some(a => projStage.includes(a))) breakdown.stageTiming = 10;
    else if (tenderAliases.some(a => projStage.includes(a))) breakdown.stageTiming = 8;
    else breakdown.stageTiming = 4;
  }

  // ── 4. Route-to-buy clarity (0-15) ──
  breakdown.routeToBuyClarity = Math.round((routeToBuyScore / 100) * 15);

  // ── 5. Contact quality / actionability (0-20) ──
  breakdown.contactQuality = Math.round((contactQualityScore / 100) * 20);

  // ── 6. Strategic account fit (0-15) ──
  if (profile.keyAccounts && profile.keyAccounts.length > 0) {
    const accounts = profile.keyAccounts.map(a => a.toLowerCase());
    const ownerLower = (project.owner || "").toLowerCase();
    const nameLower = project.name.toLowerCase();
    const isStrategic = accounts.some(a => a.length > 3 && (ownerLower.includes(a) || nameLower.includes(a)));
    breakdown.strategicAccountFit = isStrategic ? 15 : 0;
  }

  const total = Math.max(0, Math.min(100,
    breakdown.territoryFit +
    breakdown.projectHeat +
    breakdown.stageTiming +
    breakdown.routeToBuyClarity +
    breakdown.contactQuality +
    breakdown.strategicAccountFit
  ));

  return { total, breakdown };
}

// ── BL name → lane key mapping ──

const BL_TO_LANE_KEY: Record<string, keyof Pick<LaneOpportunityScores, "portableAir" | "pump" | "pal" | "bess">> = {
  // Portable Air variants
  "Portable Air":         "portableAir",
  "Portable Air (PA)":    "portableAir",
  "PA":                   "portableAir",
  // Pump / Dewatering variants — MUST cover the actual DB enum value
  "Dewatering Pumps":     "pump",
  "Pump/Dewatering":      "pump",
  "Pump (Flow)":          "pump",
  "Pumps":                "pump",
  "Pump":                 "pump",
  "Dewatering":           "pump",
  // PAL / Power & Light variants
  "PAL":                  "pal",
  "Generators":           "pal",
  "Power & Light":        "pal",
  "Power and Light":      "pal",
  "Lighting":             "pal",
  // BESS variants
  "BESS":                 "bess",
  "Battery Energy Storage": "bess",
  "Battery Storage":      "bess",
  // Nitrogen and Booster map to portableAir (compressed gas family)
  "Nitrogen":             "portableAir",
  "Booster":              "portableAir",
  "Nitrogen & Booster":   "portableAir",
  // Service maps to portableAir as the closest lane
  "Service":              "portableAir",
  "Service Potential":    "portableAir",
  // Rental maps to the rep's primary product lane — use portableAir as default
  "Rental":               "portableAir",
  "Rental Influence":     "portableAir",
};

/** Get the primary lane opportunity score for the user's assigned business lines */
export function getPrimaryLaneScore(
  assignedBusinessLines: string[],
  laneScores: LaneOpportunityScores,
): number {
  if (assignedBusinessLines.length === 0) return laneScores.multiLane;

  let maxScore = 0;
  for (const bl of assignedBusinessLines) {
    const key = BL_TO_LANE_KEY[bl];
    if (key) {
      const s = laneScores[key] as number;
      if (s > maxScore) maxScore = s;
    }
  }
  // Multi-lane reps (multiple BLs): use multiLane if no single lane dominates
  if (assignedBusinessLines.length > 1 && maxScore < 40) {
    return Math.max(maxScore, laneScores.multiLane);
  }
  return maxScore;
}

// ── Lane fit label ──

export function getLaneFitLabel(primaryLaneScore: number): "High" | "Medium" | "Low" | "Not relevant" {
  if (primaryLaneScore >= 60) return "High";
  if (primaryLaneScore >= 35) return "Medium";
  if (primaryLaneScore >= LANE_SUPPRESS_THRESHOLD) return "Low";
  return "Not relevant";
}

// ── Why now / Route-to-buy / Best next move generators ──

export function generateWhyNow(
  project: {
    name: string;
    overview: string | null;
    stage: string | null;
    priority: string;
    isNew: boolean;
    opportunityRoute: string;
  },
  laneScores: LaneOpportunityScores,
  assignedBusinessLines: string[],
): string {
  const parts: string[] = [];

  // Stage signal
  const stage = (project.stage || "").toLowerCase();
  if (STAGE_TIMING_MAP["tender_live"]?.some(a => stage.includes(a))) {
    parts.push("Live tender — decision window open");
  } else if (STAGE_TIMING_MAP["awarded_mobilizing"]?.some(a => stage.includes(a))) {
    parts.push("Awarded and mobilising — equipment decisions imminent");
  } else if (STAGE_TIMING_MAP["commissioning"]?.some(a => stage.includes(a))) {
    parts.push("Commissioning phase — final equipment procurement");
  }

  // Heat signal
  if (project.priority === "hot") parts.push("High-priority opportunity");
  else if (project.isNew) parts.push("New this week");

  // Lane signal
  const primaryLaneScore = getPrimaryLaneScore(assignedBusinessLines, laneScores);
  if (primaryLaneScore >= 60) {
    const topLane = laneScores.primaryLane ?? assignedBusinessLines[0] ?? "your lane";
    parts.push(`Strong ${topLane} fit`);
  } else if (laneScores.secondaryLane) {
    parts.push(`${laneScores.primaryLane ?? "PT"} + ${laneScores.secondaryLane} cross-sell`);
  }

  // Overview snippet if nothing else
  if (parts.length === 0 && project.overview) {
    const snippet = project.overview.replace(/\s+/g, " ").trim().substring(0, 80);
    parts.push(snippet + (project.overview.length > 80 ? "…" : ""));
  }

  return parts.slice(0, 2).join(". ") + (parts.length > 0 ? "." : "");
}

export function generateRouteToBuy(
  project: {
    opportunityRoute: string;
    stage: string | null;
    sector: string;
  },
  sellingMotion: SellingMotion,
  hasContractor: boolean,
): string {
  const route = project.opportunityRoute || "";

  if (sellingMotion === "direct") {
    if (hasContractor) return `Direct sale via contractor — ${route || "equipment supply"}`;
    return `Direct sale — ${route || "equipment supply to owner/EPC"}`;
  }
  if (sellingMotion === "rental") {
    return `Rental-led — ${route || "short-term hire opportunity"}`;
  }
  if (sellingMotion === "crosssell") {
    return `Cross-sell — ${route || "secondary PT lane opportunity"}`;
  }
  return `Monitor — ${route || "no clear route to buy yet"}`;
}

export function generateBestNextMove(
  sellingMotion: SellingMotion,
  laneFitLabel: "High" | "Medium" | "Low" | "Not relevant",
  hasContact: boolean,
  contactName: string | null,
  contactTitle: string | null,
  hasContractor: boolean,
): string {
  if (laneFitLabel === "Not relevant") {
    return "Monitor only — not a fit for your lane";
  }

  if (sellingMotion === "monitor") {
    return "Watch for stage changes — no action required yet";
  }

  if (!hasContact && !hasContractor) {
    return "Run stakeholder discovery — no contacts found yet";
  }

  if (hasContact && contactName) {
    const role = contactTitle ? ` (${contactTitle})` : "";
    return `Reach out to ${contactName}${role} — highest-relevance contact`;
  }

  if (hasContractor) {
    return "Contact the contractor directly — procurement contact needed";
  }

  return "Review project card and identify the right contact path";
}

// ── Channel label ──

export function getChannelLabel(motion: SellingMotion): string {
  switch (motion) {
    case "direct":    return "Direct sale likely";
    case "rental":    return "Rental-led";
    case "crosssell": return "Cross-sell";
    case "monitor":   return "Monitor only";
  }
}

// ── Part A.4: Per-user final score ──

/**
 * Compute the complete lane-aware score for a single project against a user profile.
 *
 * WEIGHTS:
 *   Shared base score (territory + heat + stage + route + contact + account) — up to 100
 *   Primary lane opportunity score (lane-specific boost/penalty)             — up to 100
 *
 * Final score = 0.45 * baseScore + 0.55 * primaryLaneScore
 *
 * Suppression: if primaryLaneScore < LANE_SUPPRESS_THRESHOLD, laneSuppressed = true.
 * Suppressed projects are demoted to monitor_only in digest section assignment.
 */
export function computePerUserFinalScore(
  project: {
    id?: number;
    name: string;
    location: string;
    priority: string;
    sector: string;
    stage: string | null;
    opportunityRoute: string;
    isNew: boolean;
    owner: string;
    value: string;
    overview: string | null;
    equipmentSignals?: string[] | null;
    contractors?: unknown;
  },
  profile: {
    territories?: string[] | null;
    assignedBusinessLines?: string[] | null;
    sectorFocus?: string[] | null;
    stageTiming?: string[] | null;
    keyAccounts?: string[] | null;
    buyerRoles?: string[] | null;
    customerTypes?: string[] | null;
  },
  blScores: DimensionScore[],
  contacts: Array<{
    contactTrustTier?: string | null;
    roleRelevance?: string | null;
    name?: string;
    title?: string;
    email?: string | null;
    linkedin?: string | null;
  }>,
): LaneScoredProject {
  const assignedBLs = (profile.assignedBusinessLines || []);

  // ── Lane opportunity scores ──
  const laneScores = computeLaneOpportunityScores(project, blScores);

  // ── Selling motion ──
  const sellingMotion = classifySellingMotion(project, blScores, laneScores);

  // ── Contact quality score (0-100) for shared base ──
  const sendReadyContacts = contacts.filter(c =>
    c.contactTrustTier === "send_ready" &&
    (c.roleRelevance === "high" || c.roleRelevance === "medium")
  );
  const namedContacts = contacts.filter(c => c.contactTrustTier === "named_unverified");
  let contactQualityScore = 0;
  if (sendReadyContacts.length > 0) contactQualityScore = 100;
  else if (namedContacts.length > 0) contactQualityScore = 40;

  // ── Route-to-buy clarity score (0-100) ──
  const hasContractor = !!(project.contractors && (project.contractors as unknown[]).length > 0);
  const routeText = (project.opportunityRoute || "").toLowerCase();
  let routeToBuyScore = 0;
  if (hasContractor) routeToBuyScore += 50;
  if (routeText && routeText !== "unknown" && routeText.length > 3) routeToBuyScore += 30;
  if (sellingMotion === "direct" || sellingMotion === "rental") routeToBuyScore += 20;
  routeToBuyScore = Math.min(100, routeToBuyScore);

  // ── Shared base score ──
  const baseScore = computeSharedBaseScore(project, profile, contactQualityScore, routeToBuyScore);

  // ── Primary lane score ──
  const primaryLaneScore = getPrimaryLaneScore(assignedBLs, laneScores);

  // ── Sector fit bonus (applied to base for non-BL users) ──
  let sectorBonus = 0;
  const effectiveSectors = (profile.sectorFocus && profile.sectorFocus.length > 0)
    ? profile.sectorFocus
    : [];
  if (effectiveSectors.length > 0) {
    const projSector = project.sector.toLowerCase();
    const sectorAliases: Record<string, string[]> = {
      mining:         ["mining", "exploration", "development", "production", "shutdown"],
      oil_gas:        ["oil_gas", "oil", "gas", "lng", "fpso", "offshore"],
      infrastructure: ["infrastructure", "rail", "road", "port", "construction", "water"],
      energy:         ["energy", "renewable", "solar", "wind", "hydrogen", "bess"],
      defence:        ["defence", "defense", "military", "naval"],
    };
    const matched = effectiveSectors.some(s => {
      const aliases = sectorAliases[s.toLowerCase()] || [s.toLowerCase()];
      return aliases.some(a => projSector.includes(a));
    });
    sectorBonus = matched ? 8 : 0;
  }

  // ── Final score ──
  const rawFinal = 0.45 * (baseScore.total + sectorBonus) + 0.55 * primaryLaneScore;
  const finalScore = Math.max(0, Math.min(100, Math.round(rawFinal)));

  // ── Suppression (nuanced — guardrail 3) ──
  // Only suppress if primary AND secondary/crosssell are both weak AND actionability is low.
  // Otherwise demote to monitor_only instead.
  //
  // Cross-sell score is computed relative to the user's primary lane:
  // it is the max of all non-primary lane scores.
  // Example: a Pump rep on a drilling project has crossSellScore = portableAir score (85).
  const primaryLaneKey = assignedBLs.length > 0 ? BL_TO_LANE_KEY[assignedBLs[0]] : null;
  const allLaneValues: Record<string, number> = {
    portableAir: laneScores.portableAir,
    pump: laneScores.pump,
    pal: laneScores.pal,
    bess: laneScores.bess,
  };
  const nonPrimaryScores = Object.entries(allLaneValues)
    .filter(([key]) => key !== primaryLaneKey)
    .map(([, v]) => v);
  const crossSellScore = nonPrimaryScores.length > 0 ? Math.max(...nonPrimaryScores) : laneScores.crossSellFit;
  const actionabilityScore = baseScore.breakdown.contactQuality + baseScore.breakdown.routeToBuyClarity;
  const primaryWeak = primaryLaneScore < LANE_SUPPRESS_THRESHOLD;
  const crossSellWeak = crossSellScore < LANE_CROSSSELL_THRESHOLD;
  const actionabilityLow = actionabilityScore < LANE_ACTIONABILITY_THRESHOLD;
  const laneSuppressed = assignedBLs.length > 0 && primaryWeak && crossSellWeak && actionabilityLow;

  // ── Lane fit label ──
  const laneFitLabel = getLaneFitLabel(primaryLaneScore);

  // ── Best contact for display ──
  const bestContact = sendReadyContacts[0] ?? namedContacts[0] ?? null;
  const hasContact = bestContact !== null;

  // ── Narrative fields ──
  const whyNow = generateWhyNow(project, laneScores, assignedBLs);
  const routeToBuy = generateRouteToBuy(project, sellingMotion, hasContractor);
  const bestNextMove = generateBestNextMove(
    sellingMotion,
    laneFitLabel,
    hasContact,
    bestContact?.name ?? null,
    bestContact?.title ?? null,
    hasContractor,
  );
  const channelLabel = getChannelLabel(sellingMotion);

  // ── Reason codes (explainability — guardrail 6) ──
  const reasonCodes: string[] = [];
  if (baseScore.breakdown.territoryFit === 20) reasonCodes.push("territory_match");
  else if (baseScore.breakdown.territoryFit === 0) reasonCodes.push("territory_miss");
  if (project.priority === "hot") reasonCodes.push("hot_priority");
  else if (project.priority === "warm") reasonCodes.push("warm_priority");
  if (primaryLaneScore >= 60) reasonCodes.push("high_lane_fit");
  else if (primaryLaneScore >= 35) reasonCodes.push("medium_lane_fit");
  else if (primaryLaneScore < LANE_SUPPRESS_THRESHOLD) reasonCodes.push("low_lane_fit");
  if (laneScores.secondaryLane) reasonCodes.push(`crosssell_${(laneScores.secondaryLane ?? "").toLowerCase().replace(/[^a-z]/g, "_")}`);
  if (sellingMotion === "rental") reasonCodes.push("rental_signal");
  if (sellingMotion === "direct") reasonCodes.push("direct_capex_signal");
  if (baseScore.breakdown.strategicAccountFit > 0) reasonCodes.push("strategic_account");
  if (sendReadyContacts.length > 0) reasonCodes.push("send_ready_contact");
  else if (namedContacts.length > 0) reasonCodes.push("named_contact_only");
  else reasonCodes.push("no_contacts");
  if (hasContractor) reasonCodes.push("contractor_known");
  if (laneSuppressed) reasonCodes.push("suppressed_all_lanes_weak");
  else if (primaryWeak && !laneSuppressed) reasonCodes.push("monitor_primary_lane_weak");

  return {
    finalScore,
    finalScoreWithTieBreaker: finalScore, // caller applies tie-breaker via applyTieBreaker()
    baseScore,
    laneScores,
    primaryLaneScore,
    sellingMotion,
    channel: sellingMotion, // deterministic enum alias (guardrail 5)
    laneSuppressed,
    laneFitLabel,
    whyNow,
    routeToBuy,
    bestNextMove,
    channelLabel,
    reasonCodes,
  };
}

// ── Tie-breaker application (guardrail 4) ──

/**
 * Apply the mlRanker feedback boost as a tie-breaker.
 * Capped to ±5 pts — does not change ranking order unless scores are within 5 pts.
 * Call this AFTER computePerUserFinalScore(), using getFeedbackBoostForProjects() from mlRanker.
 */
export function applyTieBreaker(
  scored: LaneScoredProject,
  feedbackBoost: number, // ±5 from getFeedbackBoostForProjects()
): LaneScoredProject {
  const capped = Math.max(-5, Math.min(5, feedbackBoost));
  return {
    ...scored,
    finalScoreWithTieBreaker: Math.max(0, Math.min(100, scored.finalScore + capped)),
  };
}

// ── Visibility classifier (guardrail 2) ──

/**
 * Classify a scored project into a visibility tier.
 * This is separate from scoring — scoring is deterministic, visibility is a policy decision.
 *
 * Tiers:
 *   must_act_candidate  — high final score, not suppressed, actionable
 *   watchlist_candidate — moderate score or low actionability
 *   monitor_only        — primary lane weak but cross-sell or actionability saves it
 *   suppress            — all three suppression conditions met
 */
export function classifyVisibility(
  scored: LaneScoredProject,
  hasAssignedBLs: boolean,
): VisibilityTier {
  // Hard suppress: all three conditions met (guardrail 3)
  if (scored.laneSuppressed) return "suppress";

  // Monitor only: primary lane weak but not fully suppressed
  const primaryWeak = scored.primaryLaneScore < LANE_SUPPRESS_THRESHOLD;
  if (primaryWeak) return "monitor_only";

  // Monitor only: selling motion is monitor
  if (scored.sellingMotion === "monitor") return "monitor_only";

  // Must act: high final score with send-ready contact or strong lane fit
  const hasSendReadyContact = scored.reasonCodes.includes("send_ready_contact");
  const highLaneFit = scored.laneFitLabel === "High";
  if (scored.finalScoreWithTieBreaker >= 60 && (hasSendReadyContact || highLaneFit)) {
    return "must_act_candidate";
  }

  // Must act: hot priority + territory match + medium+ lane fit
  if (
    scored.reasonCodes.includes("hot_priority") &&
    scored.reasonCodes.includes("territory_match") &&
    scored.primaryLaneScore >= 35
  ) {
    return "must_act_candidate";
  }

  // Watchlist: everything else that is not suppressed or monitor
  return "watchlist_candidate";
}
