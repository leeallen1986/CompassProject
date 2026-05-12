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
 *   3. Selling-motion channel     — Direct sale / Cross-sell / Adjacent / Monitor / Low fit
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

/**
 * GLOBAL RULE: This platform is for direct-sale reps only.
 * 'rental' is kept as an internal classification signal only — it is NEVER shown to reps
 * and is ALWAYS suppressed from Must Act and Closing Soon.
 */
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

/**
 * Three-family compressed air + specialty air opportunity classification.
 * Covers all Atlas Copco PT portable air products:
 *   Family 1 — Core Portable Air: drilling, blasting, piling, waterwell, pneumatic civils, temporary plant air
 *   Family 2 — Air Treatment / Quality: dryers, aftercoolers, instrument air, moisture-sensitive commissioning
 *   Family 3 — Specialty Air / Gas: N2 membrane, pipeline testing, purging, inerting, dry-out, booster, high-pressure testing
 */
export type AirFitLevel = "High" | "Medium" | "Low" | "None";
export type AirOpportunityType =
  | "drilling_blasting"          // DTH, RC, core, blast-hole, waterwell
  | "piling_civils"              // piling, pneumatic-tool-heavy civils
  | "shutdown_commissioning"     // shutdown, turnaround, plant commissioning
  | "abrasive_blasting"          // surface prep, coating, painting
  | "temporary_plant_air"        // temporary process/instrument air supply
  | "air_treatment"              // dryers, aftercoolers, instrument air quality
  | "pipeline_testing"           // hydrotest, pressure test, leak test, line drying
  | "purging_inerting"           // N2 purge, inerting, dry-out, pre-commissioning
  | "high_pressure_booster"      // booster compressor, high-pressure testing
  | "specialty_air_package"      // combined specialty air / N2 membrane package
  | "generic_construction"       // construction with likely but unconfirmed air demand
  | "none";                      // no credible air opportunity
export type BestProductAngle =
  | "Compressor"                 // Core portable air compressor (XAS, XATS, XAVS)
  | "Dryer"                      // Refrigerant or desiccant dryer
  | "N2 Membrane"                // Nitrogen membrane system
  | "Booster"                    // High-pressure booster compressor
  | "Package"                    // Combined compressor + dryer / N2 / booster package
  | "Monitor";                   // No clear product angle yet
export interface AirOpportunityClassification {
  /** Overall air fit level for this project */
  airFit: AirFitLevel;
  /** Primary opportunity type */
  opportunityType: AirOpportunityType;
  /** Best product angle for this project */
  bestProductAngle: BestProductAngle;
}
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
  /** Three-family air opportunity classification */
  airFit: AirFitLevel;
  /** Primary air opportunity type */
  opportunityType: AirOpportunityType;
  /** Best product angle for this project */
  bestProductAngle: BestProductAngle;
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
   * Values: direct | rental (internal suppression signal only) | crosssell | monitor
   */
  channel: SellingMotion;
  /**
   * Machine-readable reason codes explaining the score.
   * Used for explainability in digest and dashboard.
   */
  reasonCodes: string[];
  /**
   * Account-prior scoring boost applied for pump-lane projects
   * when the project's owner/contractor matches a priority account.
   * 0 if no match or non-pump lane.
   */
  accountPriorBoost?: number;
  /**
   * Pump-specific action mode. Only populated for pump-lane projects.
   * Determines what the rep should do next and what card layout to show.
   */
  pumpActionMode?: 'direct_pursue' | 'map_package' | 'find_site_contact' | 'watch_incumbent' | 'account_nurture' | 'reference_only';
  /**
   * Matched account-prior canonical name, if any.
   */
  matchedAccountPrior?: string | null;
}

// ── Keyword lists for lane opportunity scoring (Part B) ──

// ── Family 1: Core Portable Air ──
const PORTABLE_AIR_BOOST_KEYWORDS = [
  // Drilling / exploration — strongest signal
  "mining", "drill", "drilling", "blast", "blasting", "tunnell", "tunnel",
  "rock drill", "percussion", "quarry", "quarrying", "exploration drilling",
  "rotary drill", "drill rig", "borehole", "water bore", "aircore", "air core",
  "dth", "down-the-hole", "down the hole", "rc drill", "reverse circulation",
  "core drill", "core drilling", "waterwell", "water well", "groundwater bore",
  "blast hole", "blasthole", "open pit", "open cut", "underground mine",
  "mine development", "shaft sinking", "raise bore", "raise boring",
  // Piling / civils with pneumatic demand
  "piling", "pile driving", "driven pile", "bored pile", "cfa pile",
  "micropile", "micro-pile", "sheet pile", "sheet piling",
  "pneumatic-tool", "pneumatic tool", "jackhammer", "rock breaking",
  "shotcrete", "concrete spraying",
  // Abrasive blasting / surface prep
  "abrasive blast", "sandblast", "grit blast", "shot blast",
  "abrasive blasting", "surface preparation", "coating", "painting",
  // Shutdown / plant operations / temporary plant air
  "shutdown", "turnaround", "plant air", "instrument air",
  "process air", "commissioning air", "temporary plant air",
  "tie-in", "hydrostatic test", "pigging",
  // Compressor / equipment procurement
  "compressed air", "compressor", "xas", "xats", "xavs", "xrhs",
  "contractor fleet", "fleet replacement", "fleet displacement",
  "equipment supply", "equipment procurement",
  // Boring / HDD
  "bore", "boring", "horizontal directional", "hdd",
  // Remote / FIFO sites
  "remote site", "off-grid", "fly-in fly-out", "fifo", "camp",
  // Oil & gas — strong portable air demand
  "oil field", "gas field", "lng", "lng plant", "pipeline", "offshore",
  "fpso", "refinery", "petrochemical", "gas processing", "lng terminal",
  "gas plant",
  // Mining / mineral processing
  "mineral processing", "ore processing", "concentrator", "smelter",
  "gold mine", "gold project", "iron ore", "copper mine", "nickel mine",
  "coal mine", "bauxite", "lithium mine",
  // Naval / defence
  "naval", "frigate", "destroyer", "submarine", "naval vessel", "warship",
  "military base", "defence facility", "shipyard",
  // Port / heavy industrial
  "port development", "berth", "jetty", "wharf", "bulk terminal",
  "power station", "power plant", "gas turbine", "diesel generation",
  "decommissioning", "demolition",
];

// ── Family 2: Air Treatment / Quality ──
const AIR_TREATMENT_BOOST_KEYWORDS = [
  // Dryers / aftercoolers / moisture control
  "dryer", "air dryer", "refrigerant dryer", "desiccant dryer",
  "aftercooler", "after-cooler", "moisture separator", "moisture trap",
  "line drying", "line dry", "pipe drying", "pipeline drying",
  "dry air", "clean air", "clean dry air", "dry compressed air",
  // Instrument air / process air quality
  "instrument air", "instrument-air", "instrument quality air",
  "process air quality", "instrument air backup", "instrument air system",
  "control air", "control valve air", "pneumatic control",
  // Moisture-sensitive commissioning / testing
  "moisture-sensitive", "moisture sensitive", "dew point",
  "dew-point testing", "dew point specification", "low dew point",
  "oil-free air", "oil free air", "class 1 air", "iso 8573",
  // Filtration / air quality
  "coalescing filter", "particulate filter", "air filtration",
  "compressed air quality", "air purity",
];

// ── Family 3: Specialty Air / Gas ──
const SPECIALTY_AIR_BOOST_KEYWORDS = [
  // Nitrogen membrane / N2 systems
  "nitrogen", "n2 membrane", "nitrogen membrane", "nitrogen generator",
  "nitrogen purge", "nitrogen blanket", "nitrogen inerting",
  "inert gas", "inert atmosphere",
  // Pipeline pressure testing / leak testing
  "pipeline testing", "pipeline pressure test", "pipeline commissioning",
  "hydrostatic testing", "hydrotest", "hydro-test", "pressure testing",
  "leak testing", "leak test", "pressure test", "pneumatic test",
  "line testing", "pipeline integrity", "pipeline inspection",
  // Purging / inerting
  "purging", "purge", "inerting", "inert", "gas purge",
  "pipeline purge", "vessel purge", "tank purge", "line purge",
  // Dry-out / pre-commissioning
  "dry-out", "dryout", "dry out", "pre-commissioning", "pre commissioning",
  "dewatering pipeline", "pipeline dewatering", "pipeline dry-out",
  "vessel dry-out", "tank dry-out", "equipment dry-out",
  // High-pressure testing / booster
  "high pressure", "high-pressure", "booster compressor", "booster pump",
  "pressure booster", "gas booster", "air booster",
  "high pressure testing", "high-pressure test",
  // Shutdown / commissioning packages
  "commissioning", "pre-commissioning", "gas commissioning",
  "shutdown package", "turnaround package", "maintenance package",
  "plant commissioning", "facility commissioning",
  // Temporary instrument / process air
  "temporary instrument air", "temporary process air",
  "process air supply", "instrument air supply",
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
    project.name ?? "",
    project.overview ?? "",
    project.sector ?? "",
    project.stage ?? "",
    project.opportunityRoute ?? "",
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

// ── Part B.2: Three-family air opportunity classification ──

/**
 * Classify a project into the three-family portable air opportunity model.
 * Returns airFit, opportunityType, and bestProductAngle for display in digest cards and UI.
 *
 * Family 1 — Core Portable Air: drilling, blasting, piling, waterwell, pneumatic civils, temporary plant air
 * Family 2 — Air Treatment / Quality: dryers, aftercoolers, instrument air, moisture-sensitive commissioning
 * Family 3 — Specialty Air / Gas: N2 membrane, pipeline testing, purging, inerting, dry-out, booster
 */
export function classifyAirOpportunity(
  project: {
    name: string;
    overview: string | null;
    sector: string;
    stage: string | null;
    opportunityRoute: string;
    equipmentSignals?: string[] | null;
  },
): AirOpportunityClassification {
  const text = projectText(project).toLowerCase();

  // ── Family 3 signals (Specialty Air / Gas) — check first as most specific ──
  const specialtyMatches = SPECIALTY_AIR_BOOST_KEYWORDS.filter(kw => text.includes(kw));
  const hasNitrogen = ["nitrogen", "n2 membrane", "nitrogen membrane", "nitrogen generator", "nitrogen purge", "nitrogen blanket", "nitrogen inerting", "inert gas"].some(kw => text.includes(kw));
  const hasPipelineTest = ["pipeline testing", "pipeline pressure test", "hydrostatic testing", "hydrotest", "hydro-test", "pressure testing", "leak testing", "leak test", "pressure test", "pneumatic test", "line testing"].some(kw => text.includes(kw));
  const hasPurging = ["purging", "purge", "inerting", "inert", "gas purge", "pipeline purge", "vessel purge", "tank purge", "line purge"].some(kw => text.includes(kw));
  const hasDryOut = ["dry-out", "dryout", "dry out", "pre-commissioning", "pre commissioning", "dewatering pipeline", "pipeline dewatering", "pipeline dry-out", "vessel dry-out", "tank dry-out"].some(kw => text.includes(kw));
  const hasBooster = ["booster compressor", "booster pump", "pressure booster", "gas booster", "air booster", "high pressure testing", "high-pressure test"].some(kw => text.includes(kw));

  // ── Family 2 signals (Air Treatment / Quality) ──
  const airTreatmentMatches = AIR_TREATMENT_BOOST_KEYWORDS.filter(kw => text.includes(kw));
  const hasDryer = ["dryer", "air dryer", "refrigerant dryer", "desiccant dryer", "aftercooler", "after-cooler", "moisture separator", "moisture trap", "line drying", "pipe drying", "pipeline drying", "air drying", "drying of pipeline", "drying of pipe"].some(kw => text.includes(kw));
  const hasInstrumentAir = ["instrument air", "instrument-air", "instrument quality air", "control air", "control valve air"].some(kw => text.includes(kw));
  const hasMoistureSensitive = ["moisture-sensitive", "moisture sensitive", "dew point", "dew-point testing", "oil-free air", "oil free air", "iso 8573"].some(kw => text.includes(kw));

  // ── Family 1 signals (Core Portable Air) ──
  const hasDrilling = ["drilling", "blast hole", "blasthole", "exploration drilling", "rotary drill", "rock drill", "drill rig", "borehole", "water bore", "aircore", "air core", "dth", "down-the-hole", "rc drill", "waterwell", "water well", "groundwater bore", "shaft sinking", "raise bore"].some(kw => text.includes(kw));
  const hasPiling = ["piling", "pile driving", "driven pile", "bored pile", "cfa pile", "micropile", "sheet pile", "sheet piling", "pneumatic-tool", "pneumatic tool", "jackhammer", "rock breaking"].some(kw => text.includes(kw));
  const hasShutdown = ["shutdown", "turnaround", "plant air", "commissioning air", "temporary plant air", "tie-in", "pigging"].some(kw => text.includes(kw));
  const hasBlasting = ["abrasive blast", "sandblast", "grit blast", "shot blast", "abrasive blasting", "surface preparation"].some(kw => text.includes(kw));
  const hasCompressor = ["compressed air", "compressor", "xas", "xats", "xavs", "xrhs", "contractor fleet", "fleet replacement"].some(kw => text.includes(kw));
  const hasIndustrialSite = ["mining", "oil field", "gas field", "lng", "fpso", "refinery", "petrochemical", "offshore", "naval", "shipyard", "military base"].some(kw => text.includes(kw));

  // ── Determine opportunity type and product angle ──

  // Priority order: most specific / highest-value first

  // Family 3: Specialty Air — multiple signals = package
  const specialtyCount = [hasNitrogen, hasPipelineTest, hasPurging, hasDryOut, hasBooster].filter(Boolean).length;
  if (specialtyCount >= 2) {
    return { airFit: "High", opportunityType: "specialty_air_package", bestProductAngle: "Package" };
  }
  if (hasBooster) {
    return { airFit: "High", opportunityType: "high_pressure_booster", bestProductAngle: "Booster" };
  }
  if (hasNitrogen && (hasPurging || hasDryOut)) {
    return { airFit: "High", opportunityType: "purging_inerting", bestProductAngle: "N2 Membrane" };
  }
  if (hasPipelineTest && (hasDryOut || hasDryer)) {
    return { airFit: "High", opportunityType: "pipeline_testing", bestProductAngle: "Package" };
  }
  if (hasPipelineTest) {
    return { airFit: "High", opportunityType: "pipeline_testing", bestProductAngle: "Compressor" };
  }
  if (hasPurging || hasDryOut) {
    return { airFit: "High", opportunityType: "purging_inerting", bestProductAngle: hasNitrogen ? "N2 Membrane" : "Compressor" };
  }
  if (hasNitrogen) {
    return { airFit: "High", opportunityType: "purging_inerting", bestProductAngle: "N2 Membrane" };
  }

  // Family 2: Air Treatment — dryer / instrument air / moisture-sensitive
  if (hasDryer && hasInstrumentAir) {
    return { airFit: "High", opportunityType: "air_treatment", bestProductAngle: "Package" };
  }
  if (hasDryer) {
    return { airFit: "High", opportunityType: "air_treatment", bestProductAngle: "Dryer" };
  }
  if (hasInstrumentAir || hasMoistureSensitive) {
    return { airFit: "Medium", opportunityType: "air_treatment", bestProductAngle: "Dryer" };
  }

  // Family 1: Core Portable Air
  if (hasDrilling) {
    return { airFit: "High", opportunityType: "drilling_blasting", bestProductAngle: "Compressor" };
  }
  if (hasBlasting) {
    return { airFit: "High", opportunityType: "abrasive_blasting", bestProductAngle: "Compressor" };
  }
  if (hasShutdown && hasCompressor) {
    return { airFit: "High", opportunityType: "shutdown_commissioning", bestProductAngle: "Compressor" };
  }
  if (hasShutdown) {
    return { airFit: "Medium", opportunityType: "shutdown_commissioning", bestProductAngle: "Compressor" };
  }
  if (hasPiling) {
    return { airFit: "Medium", opportunityType: "piling_civils", bestProductAngle: "Compressor" };
  }
  if (hasCompressor) {
    return { airFit: "Medium", opportunityType: "temporary_plant_air", bestProductAngle: "Compressor" };
  }
  if (hasIndustrialSite) {
    return { airFit: "Low", opportunityType: "generic_construction", bestProductAngle: "Monitor" };
  }

  // No credible air signal
  return { airFit: "None", opportunityType: "none", bestProductAngle: "Monitor" };
}

// ── Part A.2b: Portable Air Opportunity Gate ──

/**
 * PORTABLE AIR OPPORTUNITY GATE
 * ================================
 * Hard pre-filter applied before any project enters a rep's digest pool.
 * Replaces the old "territory project ranking" approach with
 * "portable-air-opportunity gating + ranking".
 *
 * A project MUST pass this gate to appear in Must Act or Closing Soon.
 * Projects that fail the gate are demoted to monitor_only (Waiting on Contact
 * Discovery) or suppressed entirely, depending on the failure reason.
 *
 * POSITIVE SIGNALS (any one is sufficient to pass):
 *   - drilling / blast-hole / exploration / mine development
 *   - commissioning / tie-in / shutdown / temporary plant air
 *   - abrasive blasting / coating / pneumatic-tool-heavy work
 *   - contractor fleet replacement / direct compressor procurement
 *   - remote site temporary air need
 *   - explicit compressor / portable air use case
 *   - contractor-side route-to-buy with a real project package
 *
 * NEGATIVE SIGNALS (any one causes suppression):
 *   - schools / education facilities
 *   - health / community / aged care / hospital facilities
 *   - generic building works (residential, commercial fit-out)
 *   - wind / battery / solar / desal / utility projects with NO explicit compressor package
 *   - government-owner-only with weak contractor path
 *   - closing-soon tenders with weak equipment signal
 *
 * Returns:
 *   { pass: true }  — project may enter the digest pool
 *   { pass: false, reason: string, suppressionLevel: 'suppress' | 'monitor_only' }
 */
export function portableAirOpportunityGate(
  project: {
    name: string;
    overview: string | null;
    sector: string;
    stage: string | null;
    opportunityRoute: string;
    owner: string;
    equipmentSignals?: string[] | null;
  },
  portableAirScore: number,
): { pass: true } | { pass: false; reason: string; suppressionLevel: 'suppress' | 'monitor_only' } {
  // IMPORTANT: equipmentSignals are AI-inferred and often contain generic guesses
  // (e.g. "portable air compressors" for a wind farm). For the gate, we use a
  // RESTRICTED text that excludes equipmentSignals for renewable-energy projects.
  // This prevents AI equipment guesses from rescuing fundamentally irrelevant projects.
  const textWithEquipment = [
    project.name,
    project.overview ?? "",
    project.opportunityRoute ?? "",
    (project.equipmentSignals ?? []).join(" "),
  ].join(" ").toLowerCase();
  const textWithoutEquipment = [
    project.name,
    project.overview ?? "",
    project.opportunityRoute ?? "",
  ].join(" ").toLowerCase();
  const nameText = (project.name ?? "").toLowerCase();
  const ownerText = (project.owner ?? "").toLowerCase();
  const sectorLower = (project.sector ?? "").toLowerCase();

  // Detect renewable-energy project types where AI equipment signals are unreliable
  const isRenewableEnergyProject = [
    /\b(wind farm|wind turbine|wind energy|offshore wind|onshore wind)\b/i,
    /\b(solar farm|solar park|photovoltaic|pv farm|solar generation)\b/i,
    /\b(battery storage|bess|grid.?scale battery|utility battery|battery energy storage)\b/i,
    /\b(green hydrogen|hydrogen facility|hydrogen plant|green steel|renewable energy project)\b/i,
  ].some(re => re.test(textWithoutEquipment));

  // For renewable-energy projects: use text WITHOUT equipment signals for override checks
  // For all other projects: use full text including equipment signals
  const text = isRenewableEnergyProject ? textWithoutEquipment : textWithEquipment;

  // ── Hard suppression: negative signals ──
  // These project types have no credible portable air direct-sale path.
  // IMPORTANT: Education/health patterns only fire if the project NAME contains the keyword,
  // not just the overview (avoids false positives where a university is a research partner
  // on a mining project, or a hospital is mentioned as a nearby landmark).
  const hardSuppressPatterns: Array<[RegExp, string]> = [
    // Education: check name only — a mining project can mention Curtin University as a partner
    [/\b(school|primary school|high school|secondary school|tafe|childcare|kindergarten|early learning centre)\b/, "education facility — no portable air demand"],
    // University/college: only suppress if name contains it (not just overview)
    // We check nameText separately below
    [/\b(hospital|aged care|nursing home|medical centre|community health|mental health facility|ambulance station)\b/, "health/community facility — no portable air demand"],
    [/\b(residential|apartment|townhouse|housing estate|retirement village|social housing|affordable housing)\b/, "residential development — no portable air demand"],
    [/\b(community centre|recreation centre|sports centre|library|museum|art gallery|cultural centre|civic centre)\b/, "community/civic facility — no portable air demand"],
    // Sports / recreation venues — lighting upgrades, pool pumps, HVAC, fitout have no portable air path
    [/\b(arena|stadium|velodrome|aquatic centre|swimming pool|sports complex|oval upgrade|grandstand)\b/, "sports/recreation venue — no portable air demand"],
    // Pool pump / HVAC / electrical upgrades at non-industrial sites
    [/\b(pool pump|pump upgrade|lighting upgrade|hvac upgrade|electrical upgrade|control system upgrade)\b.*\b(centre|arena|stadium|pool|oval|school|hospital|council|government)\b/, "non-industrial facility upgrade — no portable air demand"],
    [/\b(centre|arena|stadium|pool|oval|school|hospital|council|government)\b.*\b(pool pump|pump upgrade|lighting upgrade|hvac upgrade|electrical upgrade)\b/, "non-industrial facility upgrade — no portable air demand"],
    // Landscaping, golf courses, parks, irrigation — no portable air demand
    [/\b(golf course|golf club|bowling green|cricket oval|sports field|playing field|park upgrade|park development|landscaping|irrigation system|irrigation upgrade)\b/, "landscaping/recreation facility — no portable air demand"],
    // Bus depots, fuel tanks, small civil works — no direct portable air path
    [/\b(bus depot|bus terminal|bus interchange|fuel tank|diesel tank|petrol station|service station)\b/, "transport/fuel facility — no portable air demand"],
    // Council/government minor works — footpaths, kerbs, drains, parks, playgrounds
    [/\b(footpath|kerb|kerbing|drainage upgrade|stormwater|playground|dog park|skate park)\b/, "minor council works — no portable air demand"],
    // Correctional / justice facilities — prison cell replacement, court fitout, etc.
    [/\b(prison|correctional|gaol|jail|remand centre|detention centre|court house|courthouse|police station)\b/, "correctional/justice facility — no direct portable air path"],
    // Professional services / consulting tenders — hydrogeologist, engineer, consultant, auditor
    [/^(hydrogeologist|geologist|engineer|consultant|auditor|inspector|surveyor|planner|architect)\b/i, "professional services tender — no equipment demand"],
    [/\b(provision of (hydrogeological|geological|engineering|consulting|professional) services|professional services for|consulting services for|engineering services for)\b/i, "professional services tender — no equipment demand"],
    // Office fitouts, refurbishments, alterations — government and commercial building works
    // These are never direct-sale portable air opportunities; AI scraper adds generic equipment signals
    [/\b(office (refurbishment|fitout|fit.?out|alteration|renovation|upgrade|fit out)s?)\b/i, "office fitout/refurbishment — no portable air demand"],
    [/\b(fit.?out (alteration|upgrade|renovation|works?))\b/i, "fitout works — no portable air demand"],
    [/\b(building (refurbishment|fitout|fit.?out|alteration|renovation))\b/i, "building refurbishment — no portable air demand"],
    // School / education HVAC, cooling, mechanical services — no portable air demand
    [/\b(cooling schools|school cooling|school hvac|school mechanical|school air conditioning|school maintenance)\b/i, "school HVAC/maintenance — no portable air demand"],
    [/\b(mechanical services.{0,30}school|school.{0,30}mechanical services)\b/i, "school mechanical services — no portable air demand"],
    // Residential demolition — small residential lot demolition is not a portable air opportunity
    // (Industrial/mine demolition is handled by the positive signal list)
    [/\b(demolition.{0,50}(lot|deposited plan|dp \d|residential|house|dwelling|property))\b/i, "residential lot demolition — no portable air demand"],
    [/\b((lot|deposited plan|dp \d|residential|house|dwelling).{0,50}demolition)\b/i, "residential lot demolition — no portable air demand"],
  ];
  for (const [pattern, reason] of hardSuppressPatterns) {
    if (pattern.test(text)) {
      return { pass: false, reason, suppressionLevel: 'suppress' };
    }
  }
  // University/college: only suppress if the project NAME itself is a university/college project
  // (not just because a university is mentioned as a partner in the overview)
  if (/\b(university|college)\b/.test(nameText)) {
    return { pass: false, reason: 'university/college project — no portable air demand', suppressionLevel: 'suppress' };
  }
  // Health facility: also check name for 'health' to catch 'Osborne Park Health Campus' etc.
  if (/\b(health campus|health precinct|health hub|health facility|medical campus)\b/.test(nameText)) {
    return { pass: false, reason: 'health campus/precinct — no portable air demand', suppressionLevel: 'suppress' };
  }

  // ── Hard suppression: property developer owners with no construction contractor ──
  // These owners build residential/retail/commercial assets — no portable air path.
  const propertyDeveloperOwners = [
    "stockland", "mirvac", "lendlease", "scentre", "vicinity", "dexus",
    "charter hall", "goodman group", "frasers property", "cromwell",
  ];
  if (propertyDeveloperOwners.some(dev => ownerText.includes(dev))) {
    // Allow if there is an explicit compressor or mining/industrial signal
    const hasIndustrialOverride = [
      "compressor", "portable air", "drilling", "mining", "oil", "gas",
      "pipeline", "commissioning", "shutdown", "blast", "pneumatic",
    ].some(kw => text.includes(kw));
    if (!hasIndustrialOverride) {
      return { pass: false, reason: `property developer owner (${project.owner}) — no industrial portable air path`, suppressionLevel: 'suppress' };
    }
  }

  // ── Hard suppression: anonymous / generic scraper artefacts ──
  // Projects with generic names and no real identifying information are scraper artefacts.
  // The AI fills their overviews with generic equipment guesses that game the keyword gate.
  // Pattern: name is a generic category label with no company, location, or project name.
  const genericNamePatterns = [
    /^(commercial development|residential development|industrial development|mixed.?use development)$/i,
    /^(infrastructure project|construction project|development project|building project)$/i,
    /^(iron ore project \(unnamed\)|unnamed project|project \(unnamed\)|tbc|unknown project)$/i,
    /^(road project|rail project|port project|pipeline project|energy project)$/i,
  ];
  // Also suppress internal quote reference codes (QR1, QR2, QR3, WK QR4, etc.)
  // These are facilities management tender portal artefacts, not real projects.
  const internalRefCodePattern = /^(qr\d+|wk\s+qr\d+|quote request|qr\s+\d+)\b/i;
  if (internalRefCodePattern.test(nameText.trim())) {
    return { pass: false, reason: 'internal quote reference code — facilities management artefact, not a real project', suppressionLevel: 'suppress' };
  }
  if (genericNamePatterns.some(re => re.test(nameText.trim()))) {
    return { pass: false, reason: 'anonymous/generic scraper artefact — no real project identity', suppressionLevel: 'suppress' };
  }

  // ── Hard suppression: programme / framework wrappers ──
  // These are not real projects — they are policy lists, framework agreements, or
  // partnering arrangements with no specific construction activity.
  const programmeWrapperPatterns: Array<[RegExp, string]> = [
    [/\b(infrastructure priority list|priority list|ipl)\b/, "programme/priority list wrapper — not a real project"],
    [/\b(long.?term partner(ing)? agreement|partnering agreement|framework agreement|master services agreement|msa)\b/, "framework/partnering agreement — not a project with equipment demand"],
    [/\b(seismic survey|geophysical survey|aeromagnetic survey|gravity survey)\b/, "seismic/geophysical survey — no drilling or compressor demand"],
    [/\b(research facility|research centre|innovation hub|technology hub|energy research)\b/, "research/innovation facility — no portable air demand"],
    [/\b(rare earth.{0,30}(partnership|agreement|framework)|partnership.{0,30}rare earth)\b/, "rare earth partnership/framework — not a project with equipment demand"],
  ];
  for (const [pattern, reason] of programmeWrapperPatterns) {
    if (pattern.test(text)) {
      return { pass: false, reason, suppressionLevel: 'suppress' };
    }
  }

  // ── Soft suppression: weak-signal categories ──
  // These project types are only relevant if there is an explicit compressor/equipment signal.
  const weakSignalPatterns: Array<[RegExp, string]> = [
    [/\b(wind farm|wind turbine|wind energy|offshore wind|onshore wind)\b/, "wind project — no explicit compressor package"],
    [/\b(battery storage|bess|grid-scale battery|utility battery|battery energy storage)\b/, "battery storage — no explicit compressor package"],
    [/\b(desalination|desal plant|water treatment|wastewater treatment|sewage treatment)\b/, "desal/water treatment — no explicit compressor package"],
    [/\b(solar farm|solar park|photovoltaic|pv farm|solar generation)\b/, "solar farm — no explicit compressor package"],
    [/\b(road upgrade|road widening|highway upgrade|intersection upgrade|footpath|footbridge|pedestrian bridge)\b/, "minor civil works — no portable air demand"],
    // Fitout/refurb: only suppress if NOT a mine or industrial site
    [/\b(office fitout|commercial fitout|retail fitout|fit-out|fitout)\b/, "commercial fitout — no portable air demand"],
    // Green steel / hydrogen / renewable energy projects without explicit compressor
    [/\b(green steel|hydrogen plant|hydrogen facility|green hydrogen|renewable energy project)\b/, "green energy project — no explicit compressor package"],
  ];

  // Explicit compressor/portable air override: if any of these are present in the project
  // name/overview/opportunityRoute, the weak-signal suppression is overridden.
  //
  // CRITICAL ARCHITECTURE NOTE:
  // The AI scraper adds "portable air compressors" to equipmentSignals for EVERY construction
  // project (schools, golf courses, office fitouts, etc.) because it infers that construction
  // uses compressed air. This makes equipmentSignals an unreliable override signal for
  // infrastructure sector projects.
  //
  // Rule: for infrastructure sector projects, the override ONLY fires on name/overview text.
  //       For industrial sectors (mining, oil_gas, energy, defence), equipment signals can override.
  const explicitCompressorSignals = [
    "compressor", "portable air", "air compressor", "cfm", "psi",
    "pneumatic", "abrasive blast", "sandblast", "grit blast", "shot blast",
    "drilling", "blast hole", "blasthole", "exploration drilling", "rotary drill",
    "rock drill", "drill rig", "borehole", "water bore", "aircore", "air core",
    "shutdown", "turnaround", "plant air", "instrument air", "process air",
    "commissioning air", "tie-in", "hydrostatic test", "pigging",
    "contractor fleet", "fleet replacement", "equipment supply",
  ];
  const industrialSectors = ["mining", "oil_gas", "energy", "defence"];
  const isInfrastructureSector = (project.sector || "").toLowerCase() === "infrastructure";
  // For infrastructure projects: only check name/overview/opportunityRoute (not equipment signals)
  // For industrial projects: check full text including equipment signals
  const textForCompressorCheck = isInfrastructureSector ? textWithoutEquipment : text;
  const hasExplicitCompressorSignal = explicitCompressorSignals.some(kw => textForCompressorCheck.includes(kw));

  for (const [pattern, reason] of weakSignalPatterns) {
    if (pattern.test(text) && !hasExplicitCompressorSignal) {
      return { pass: false, reason, suppressionLevel: 'monitor_only' };
    }
  }

  // ── Lane score gate ──
  // If the portable air lane score is very low AND there are no explicit signals, suppress.
  if (portableAirScore < 15 && !hasExplicitCompressorSignal) {
    return { pass: false, reason: `low portable air lane score (${portableAirScore}) with no explicit compressor signal`, suppressionLevel: 'monitor_only' };
  }

  // ── Positive signal check ──
  // IMPORTANT: "construction", "civil", "infrastructure", "rail", "port" are intentionally
  // NOT in this list — they are too generic and let property/civic projects through.
  // Only include signals that indicate a real portable air use case.
  const positiveSignals = [
    // Drilling / exploration — strongest signal
    "drilling", "blast hole", "blasthole", "exploration drilling", "rotary drill",
    "rock drill", "drill rig", "borehole", "water bore", "aircore", "air core",
    "exploration", "mine development", "underground mine", "open pit", "open cut",
    "quarrying", "tunnelling", "tunneling", "shaft sinking",
    // Commissioning / shutdown / plant operations
    "commissioning", "tie-in", "shutdown", "turnaround", "plant air", "instrument air",
    "process air", "commissioning air", "hydrostatic test", "pigging",
    // Abrasive blasting / surface prep
    "abrasive blast", "sandblast", "grit blast", "shot blast", "coating", "painting",
    // Explicit equipment
    "pneumatic", "compressor", "portable air", "air compressor", "cfm", "psi",
    // Contractor fleet / procurement
    "contractor fleet", "fleet replacement", "equipment supply", "equipment procurement",
    // Remote / FIFO sites
    "remote site", "off-grid", "fly-in fly-out", "fifo", "camp",
    // Oil & gas — strong portable air demand
    "oil field", "gas field", "lng", "lng plant", "pipeline", "offshore",
    "fpso", "refinery", "petrochemical", "gas processing", "lng terminal",
    "gas power", "gas generation", "gas plant",
    // Mining / mineral processing
    "mining", "mineral processing", "ore processing", "concentrator", "smelter",
    "gold mine", "gold project", "iron ore", "copper mine", "nickel mine",
    "coal mine", "bauxite", "lithium mine",
    // Naval / defence — direct equipment procurement
    "naval", "frigate", "destroyer", "submarine", "naval vessel", "warship",
    "military base", "defence facility", "shipyard",
    // Port / heavy industrial — only where equipment is needed
    "port development", "berth", "jetty", "wharf", "bulk terminal",
    "power station", "power plant", "gas turbine", "diesel generation",
    "decommissioning", "demolition",
  ];
  // For infrastructure projects: positive signals must appear in name/overview, not just equipment signals
  const textForPositiveCheck = isInfrastructureSector ? textWithoutEquipment : text;
  const hasPositiveSignal = positiveSignals.some(kw => textForPositiveCheck.includes(kw));

  // If portable air lane score is strong, pass — BUT NOT for renewable energy projects.
  // Wind farms, solar farms, BESS, and green hydrogen projects can have high AI-scored
  // Portable Air scores because the AI sees "construction" and infers compressor demand.
  // These must still pass the keyword gate to prevent false positives.
  if (portableAirScore >= 40 && !isRenewableEnergyProject) return { pass: true };

  // If explicit compressor signal, always pass.
  if (hasExplicitCompressorSignal) return { pass: true };

  // If positive signal present and lane score is at least moderate, pass.
  if (hasPositiveSignal && portableAirScore >= 20) return { pass: true };

  // Sector-based pass: mining, oil_gas, defence always have credible portable air path
  // BUT only if there is at least one positive signal (sector alone is not enough).
  const highValueSectors = ["mining", "oil_gas", "defence"];
  if (highValueSectors.includes((project.sector || "").toLowerCase()) && hasPositiveSignal) return { pass: true };

  // Default: insufficient signal — demote to monitor_only
  return {
    pass: false,
    reason: `insufficient portable air opportunity signal (lane score ${portableAirScore}, no positive keywords)`,
    suppressionLevel: 'monitor_only',
  };
}

// ── Part A.2b: PAL / BESS Opportunity Gate ──
// Used for reps assigned to PAL and/or BESS business lines.
// A project only enters Must Act / Closing Soon / Waiting for PAL/BESS reps
// if it has explicit package-level evidence of:
//   - BESS / battery storage / hybrid power / microgrid / temporary power
//   - PAL / elevated access / shutdown access / working at height
//   - Remote site power constraint / off-grid / island mode
//   - Energisation / commissioning power / construction power
//   - Lighting towers (explicit site lighting for construction)
// Broad civils, road, rail, and generic large projects are suppressed unless
// they contain one of the above explicit signals.

export function palBessOpportunityGate(
  project: {
    name: string;
    overview: string | null;
    sector: string | null;
    opportunityRoute: string | null;
    equipmentSignals?: string[] | null;
    stage?: string | null;
    priority?: string | null;
  },
): { pass: true; reason: string } | { pass: false; reason: string; suppressionLevel: 'suppress' | 'monitor_only' } {
  const nameText = (project.name ?? "").toLowerCase();
  const overviewText = (project.overview ?? "").toLowerCase();
  const routeText = (project.opportunityRoute ?? "").toLowerCase();
  const sectorLower = (project.sector ?? "").toLowerCase();

  // ── OPEX/Monitor route suppression ──
  // Projects with opportunityRoute=OPEX/Monitor are watch items, not actionable.
  // BUT: hot/warm projects with a strong stage (contract awarded, construction) may have been
  // miscategorised by the AI scraper — override the suppression for those.
  const priorityLower = (project.priority ?? "").toLowerCase();
  const stageLower = (project.stage ?? "").toLowerCase();
  const isStrongStage = /contract awarded|under construction|construction commenced|construction started|commissioning|operational/.test(stageLower);
  const isHotOrWarm = priorityLower === 'hot' || priorityLower === 'warm';
  if (/^opex/i.test(project.opportunityRoute ?? "") && !(isHotOrWarm && isStrongStage)) {
    return { pass: false, reason: "opex_monitor_route: project is OPEX/Monitor watch item, not actionable", suppressionLevel: 'monitor_only' };
  }

  // For PAL/BESS: equipment signals are AI-inferred and unreliable for infrastructure.
  // Only use equipment signals for industrial sectors (energy, mining, oil_gas, defence).
  const isIndustrialSector = ["energy", "mining", "oil_gas", "defence"].includes(sectorLower);
  const equipRaw = Array.isArray(project.equipmentSignals)
    ? (project.equipmentSignals as string[]).join(" ")
    : String(project.equipmentSignals ?? "");
  const equipText = isIndustrialSector ? equipRaw.toLowerCase() : "";
  const combined = `${nameText} ${overviewText} ${routeText} ${equipText}`;

  // ── Hard suppression: broad civils / road / rail / generic infrastructure ──
  // These project types have no credible PAL/BESS direct-sale path unless they
  // explicitly mention temporary power, BESS, or elevated access.
  const hardSuppressPatterns: Array<[RegExp, string]> = [
    [/\b(highway|motorway|freeway|expressway|arterial road|road upgrade|road widening|road construction|road safety|road improvement)\b/, "road/highway project — no PAL/BESS demand without explicit temporary power"],
    [/\b(inland rail|rail corridor|rail upgrade|rail duplication|rail extension|rail line|railway|signalling upgrade|level crossing|train station|bus rapid transit)\b/, "rail/transit project — no PAL/BESS demand without explicit temporary power"],
    [/\b(school|primary school|high school|secondary school|tafe|childcare|kindergarten|early learning)\b/, "education facility — no PAL/BESS demand"],
    [/\b(hospital|aged care|nursing home|medical centre|community health|mental health facility)\b/, "health facility — no PAL/BESS demand"],
    [/\b(residential|apartment|townhouse|housing estate|retirement village|social housing|affordable housing)\b/, "residential development — no PAL/BESS demand"],
    [/\b(community centre|recreation centre|sports centre|library|museum|art gallery|cultural centre|civic centre|council building)\b/, "community/civic facility — no PAL/BESS demand"],
    [/\b(golf course|golf club|bowling green|cricket oval|sports field|playing field|park upgrade|park development|landscaping|irrigation system)\b/, "landscaping/recreation — no PAL/BESS demand"],
    [/\b(bus depot|bus terminal|fuel tank|diesel tank|petrol station|service station)\b/, "transport/fuel facility — no PAL/BESS demand"],
    [/\b(office fitout|office refurbishment|office upgrade|fitout|fit-out|tenancy improvement)\b/, "office fitout — no PAL/BESS demand"],
    [/\b(correctional|prison|detention centre|remand centre|youth justice)\b/, "correctional facility — no PAL/BESS demand"],
    [/\b(water main|sewer|sewage|stormwater|drainage upgrade|culvert|kerb and gutter)\b/, "civil drainage/water main — no PAL/BESS demand"],
    [/\b(seismic survey|geophysical survey|geotechnical investigation|hydrogeologist|concept design report|feasibility study only|market study|scoping study)\b/, "survey/study only — no PAL/BESS demand"],
    [/\b(framework agreement|partnering agreement|standing offer|panel contract|master services agreement|msa|preferred supplier)\b/, "framework/panel contract — not a project"],
    [/\b(infrastructure priority list|priority list|programme wrapper|program wrapper)\b/, "programme wrapper — not a specific project"],
    [/\b(energy target|storage target|renewable target|emissions target|climate target|net zero target|policy target|government target|state target|national target)\b/, "policy/target document — not a specific project"],
    [/\b(energy strategy|storage strategy|renewable strategy|energy plan|storage plan|grid plan|transition plan|roadmap|action plan|discussion paper|consultation paper)\b/, "strategy/plan document — not a specific project"],
    [/\b(proof of concept|proof-of-concept|poc project|pilot program|demonstration project|research project|innovation hub|innovation centre|innovation precinct)\b/, "proof-of-concept/research — not a commercial project"],
  ];

  // Check hard suppress against project name only (not overview) to avoid false positives
  // where a mining project mentions a nearby road or school.
  for (const [pattern, reason] of hardSuppressPatterns) {
    if (pattern.test(nameText)) {
      return { pass: false, reason: `hard_suppress: ${reason}`, suppressionLevel: 'suppress' };
    }
  }

  // ── Positive PAL/BESS signals — explicit package-level evidence ──
  const palBessPositiveSignals: string[] = [
    // BESS / battery storage / hybrid power
    "bess", "battery energy storage", "battery storage system", "battery storage",
    "energy storage system", "grid-scale storage", "grid scale storage",
    "hybrid power", "hybrid power plant", "hybrid power system",
    "microgrid", "micro-grid", "virtual power plant", "vpp",
    "pumped hydro", "pumped storage", "pumped-storage",
    "grid stabilisation", "frequency regulation", "frequency control",
    "renewable integration", "solar storage", "wind storage",
    "behind the meter", "behind-the-meter",
    // PAL / elevated access / working at height
    "pal", "portable access", "elevated access", "elevated work platform", "ewp",
    "boom lift", "scissor lift", "mast lift", "knuckle boom",
    "temporary access platform", "access platform", "working at height",
    "shutdown access", "maintenance access platform", "turnaround access",
    "height access", "aerial work platform", "awp",
    // Temporary power / remote site power
    "temporary power", "temp power", "temporary electricity",
    "standby power", "backup power", "emergency power",
    "mobile power", "power station", "diesel power station",
    "remote power", "off-grid power", "off grid power", "island power",
    "power supply solution", "power as a service", "paas",
    "generator hire", "generator rental", "diesel generator",
    "gas generator", "gas genset", "genset",
    // Energisation / commissioning
    "energisation", "energize", "energise", "commissioning power",
    "temporary plant power", "construction power", "site power",
    "first power", "power-on", "power on date", "pre-commissioning",
    // Lighting towers
    "lighting tower", "light tower", "temporary lighting", "site lighting",
    "construction lighting", "floodlight", "flood light",
    // Remote / mine site / offshore
    "remote site", "mine site power", "camp power", "accommodation power",
    "fly-in fly-out", "fifo", "offshore platform", "offshore power",
    "island mode", "black start", "black-start",
    // Shutdown / turnaround / maintenance outage
    "shutdown", "turnaround", "planned outage", "maintenance outage",
    "overhaul", "planned maintenance", "major maintenance",
    // Specific BESS / PAL project types
    "battery project", "storage project", "energy storage project",
    "renewable energy storage", "large-scale battery", "large scale battery",
    "grid battery", "utility-scale battery", "utility scale battery",
    "standalone power system", "saps", "community battery",
    "hydrogen storage", "green hydrogen", "hydrogen plant",
    "hydrogen project", "electrolyser", "electrolysis",
  ];

  // Check positive signals in combined text
  const foundSignals: string[] = [];
  for (const signal of palBessPositiveSignals) {
    if (combined.includes(signal)) {
      foundSignals.push(signal);
    }
  }

  if (foundSignals.length > 0) {
    return {
      pass: true,
      reason: `positive_signals: ${foundSignals.slice(0, 3).join(", ")}`,
    };
  }

  // No positive signals — monitor only
  return {
    pass: false,
    reason: "no_pal_bess_signal: no explicit PAL/BESS package-level evidence in name, overview, or route",
    suppressionLevel: 'monitor_only',
  };
}

// ── Part A.2c: Pump / Dewatering Opportunity Gate ──
// Used for reps assigned to Pump/Dewatering business line.
// A project only enters Must Act / Closing Soon for pump reps if it has
// explicit water/dewatering/pumping signal.

export function pumpOpportunityGate(
  project: {
    name: string;
    overview: string | null;
    sector: string | null;
    opportunityRoute: string | null;
    equipmentSignals?: string[] | null;
    stage?: string | null;
    priority?: string | null;
  },
): { pass: true; reason: string } | { pass: false; reason: string; suppressionLevel: 'suppress' | 'monitor_only' } {
  const nameText = (project.name ?? "").toLowerCase();
  const overviewText = (project.overview ?? "").toLowerCase();
  const routeText = (project.opportunityRoute ?? "").toLowerCase();
  const sectorLower = (project.sector ?? "").toLowerCase();

  // For pump: equipment signals are AI-inferred and can be noisy for generic infrastructure.
  // Trust equipment signals when: (a) sector is industrial, OR (b) project text has water/excavation context.
  // This prevents generic road/transit/data-centre projects from passing just because AI tagged "Dewatering Pumps".
  const equipRaw = Array.isArray(project.equipmentSignals)
    ? (project.equipmentSignals as string[]).join(" ")
    : String(project.equipmentSignals ?? "");
  const equipLower = equipRaw.toLowerCase();
  const isIndustrialSector = ["energy", "mining", "oil_gas", "defence"].includes(sectorLower);
  const textForContext = `${nameText} ${overviewText} ${routeText}`;
  const hasWaterContext = /water|basin|dam|sewer|marine|flood|underground|excavat|tunnel|dredg|bore|aquifer|dewater|pump station|wet works|cofferdam|trench/.test(textForContext);
  const equipText = (isIndustrialSector || hasWaterContext) ? equipLower : "";
  const combined = `${nameText} ${overviewText} ${routeText} ${equipText}`;

  // ── Hard suppression: same noise categories as PA gate ──
  const hardSuppressPatterns: Array<[RegExp, string]> = [
    [/\b(school|primary school|high school|secondary school|tafe|childcare|kindergarten|early learning)\b/, "education facility — no pump demand"],
    [/\b(hospital|health campus|renal unit|aged care|nursing home|medical centre|community health|mental health facility)\b/, "health facility — no pump demand"],
    [/\b(residential|apartment|townhouse|housing estate|retirement village|social housing|affordable housing)\b/, "residential development — no pump demand"],
    [/\b(community centre|recreation centre|sports centre|library|museum|art gallery|cultural centre|civic centre|council building)\b/, "community/civic facility — no pump demand"],
    [/\b(golf course|golf club|bowling green|cricket oval|sports field|playing field|park upgrade|park development|landscaping)\b/, "recreation — no pump demand"],
    [/\b(office fitout|office refurbishment|office upgrade|fitout|fit-out|tenancy improvement)\b/, "office fitout — no pump demand"],
    [/\b(correctional|prison|detention centre|remand centre|youth justice|police station)\b/, "correctional/justice — no pump demand"],
    [/\b(seismic survey|geophysical survey|geotechnical investigation|feasibility study only|market study|scoping study)\b/, "survey/study only — no pump demand"],
    [/\b(framework agreement|partnering agreement|standing offer|panel contract|master services agreement|msa)\b/, "framework/panel contract — not a project"],
    [/\b(bus depot|bus terminal|fuel tank|diesel tank|petrol station|service station)\b/, "transport/fuel facility — no pump demand"],
    [/\b(footpath|kerb|kerbing|playground|dog park|skate park)\b/, "minor council works — no pump demand"],
  ];

  for (const [pattern, reason] of hardSuppressPatterns) {
    if (pattern.test(nameText)) {
      return { pass: false, reason: `hard_suppress: ${reason}`, suppressionLevel: 'suppress' };
    }
  }

  // ── Positive pump/dewatering signals ──
  // Tier 1: Strong signals — substring match is safe (multi-word or unambiguous)
  const strongPumpSignals: string[] = [
    "dewater", "dewatering", "mine dewatering", "groundwater",
    "water management", "water handling", "water treatment",
    "process water", "slurry", "tailings", "tailings dam", "tailing storage",
    "submersible", "wellpoint", "sump pump", "pumping station",
    "water table", "seepage", "cofferdam", "dredg", "dredging",
    "water main", "sewer", "wastewater",
    "desalin", "desalination", "wet works",
    "weda", "sludge", "effluent", "bore field",
    "aquifer", "water bore", "water supply", "raw water",
    "settling pond", "evaporation pond", "leach pad",
    "site drainage", "mine drainage", "acid mine drainage",
    "water infrastructure", "offshore pipeline",
  ];
  // Tier 2: Moderate signals — use regex word boundaries to avoid false positives
  const moderatePumpPatterns: Array<[RegExp, string]> = [
    [/\b(pump|pumps|pumping)\b/, "pump"],
    [/\b(dam|dams)\b(?!ag)/, "dam"],  // 'dam' but not 'damage'
    [/\bflood(ing|plain|water)?\b/, "flood"],
    [/\breservoir\b/, "reservoir"],
    [/\birrigation\b/, "irrigation"],
    [/\bdrainage\b/, "drainage"],
    [/\btrench(ing)?\b/, "trench"],
    [/\bborehole\b/, "borehole"],
    [/\bsump\b/, "sump"],
    [/\bmarine (construct|piling|dredg|works|install)/, "marine works"],
    [/\bopen (cut|pit) min/, "open cut/pit mine"],
    [/\bunderground min(e|ing)\b/, "underground mine"],
    [/\bmine develop/, "mine development"],
    [/\bexcavat(e|ion|ing)\b.{0,40}\b(water|wet|ground|below|deep)/, "excavation+water"],
  ];

  const foundSignals: string[] = [];
  for (const signal of strongPumpSignals) {
    if (combined.includes(signal)) {
      foundSignals.push(signal);
    }
  }
  for (const [pattern, label] of moderatePumpPatterns) {
    if (pattern.test(combined)) {
      foundSignals.push(label);
    }
  }

  if (foundSignals.length > 0) {
    return {
      pass: true,
      reason: `positive_signals: ${foundSignals.slice(0, 3).join(", ")}`,
    };
  }

  // No positive signals — monitor only
  return {
    pass: false,
    reason: "no_pump_signal: no explicit water/dewatering/pumping evidence in name, overview, or route",
    suppressionLevel: 'monitor_only',
  };
}

/**
 * Universal lane opportunity gate — dispatches to the correct gate based on user's primary dimension.
 * Returns true if the project passes the gate for the user's lane.
 * Used by Closing Soon and Find Contacts sections to suppress noise.
 */
export function laneOpportunityGate(
  project: {
    name: string;
    overview: string | null;
    sector: string;
    stage: string | null;
    opportunityRoute: string;
    owner: string;
    equipmentSignals?: string[] | null;
    priority?: string | null;
  },
  primaryDimension: string,
  portableAirScore?: number,
): { pass: boolean; reason: string } {
  const dim = primaryDimension.toLowerCase();

  if (dim.includes("portable air")) {
    const result = portableAirOpportunityGate(project, portableAirScore ?? 0);
    return { pass: result.pass, reason: result.pass ? "PA gate passed" : (result as any).reason };
  }

  if (dim.includes("pump") || dim.includes("dewatering") || dim.includes("flow")) {
    const result = pumpOpportunityGate(project);
    return { pass: result.pass, reason: result.pass ? (result as any).reason : (result as any).reason };
  }

  if (dim.includes("pal") || dim.includes("bess") || dim.includes("generator")) {
    const result = palBessOpportunityGate(project);
    return { pass: result.pass, reason: result.pass ? (result as any).reason : (result as any).reason };
  }

  // For other dimensions (Nitrogen, Booster, Service Potential, Rental Influence, etc.)
  // Use the PA gate as a general industrial relevance filter
  const result = portableAirOpportunityGate(project, portableAirScore ?? 0);
  return { pass: result.pass, reason: result.pass ? "general industrial gate passed" : (result as any).reason };
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

  // ── Selling motion classification ──
  // ARCHITECTURE NOTE: The `Rental Influence` BL score is used as a SECONDARY signal only.
  // Analysis shows the AI scoring engine assigns high rental influence (55–95) to almost every
  // project regardless of actual rental signal, making it an unreliable primary classifier.
  // Keyword signals and project type are the primary drivers; BL score is a tiebreaker.

  // Strong rental keywords: explicit short-duration / shutdown / hire signals
  const strongRentalSignals = ["shutdown", "turnaround", "short-term", "hire", "rental", "temporary", "wet hire", "dry hire"];
  // CAPEX / direct-sale keywords: explicit procurement / purchase / award signals
  const capexSignals = ["capex", "purchase", "procurement", "supply", "contract award", "awarded", "epc", "lump sum", "fixed price", "design and construct", "d&c"];
  const hasStrongRentalSignal = strongRentalSignals.some(kw => text.includes(kw));
  const hasCapexSignal = capexSignals.some(kw => text.includes(kw));

  // 1. Strong CAPEX signal + strong lane → direct (overrides rental BL score)
  if (hasCapexSignal && maxLaneScore >= 55) return "direct";

  // 2. Explicit rental keyword + no CAPEX signal → rental
  if (hasStrongRentalSignal && !hasCapexSignal) return "rental";

  // 3. BL rental score is very high (≥80) AND no CAPEX signal → rental
  //    Threshold raised from 55 to 80 because the BL scorer inflates rental scores globally.
  if (rentalScore >= 80 && !hasCapexSignal) return "rental";

  // 4. Cross-sell: secondary lane signal is strong but primary lane is moderate
  if (laneScores.secondaryLane && laneScores.multiLane >= 40 && maxLaneScore < 55) return "crosssell";

  // 5. Default: direct if strong lane signal, crosssell if moderate
  if (maxLaneScore >= 55) return "direct";
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
    // GLOBAL RULE: rental projects are suppressed from rep-facing digest.
    // This path is only reached in internal scoring — never shown to reps.
    return `Monitor — equipment hire path (not direct-sale)`;
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

/**
 * GLOBAL RULE: This platform is for direct-sale reps only.
 * Channel labels shown to reps use the new taxonomy:
 *   Direct sale | Cross-sell / Adjacent | Monitor | Low fit
 *
 * 'rental' is an internal suppression signal only — it maps to 'Low fit' if somehow shown.
 * Projects classified as rental are suppressed by the Portable Air Opportunity Gate before display.
 */
export function getChannelLabel(motion: SellingMotion): string {
  switch (motion) {
    case "direct":    return "Direct sale";
    case "rental":    return "Low fit";        // internal signal — suppressed by gate before display
    case "crosssell": return "Cross-sell / Adjacent";
    case "monitor":   return "Monitor";
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
    /**
   * Sales-motion profile for this rep.
   * GLOBAL RULE: All reps are direct_only. rental_led has been removed.
   * direct_only  — rental-channel projects get −25 pts and are suppressed from Must Act/Closing Soon
   * mixed        — direct + adjacent motions valid; rental still suppressed globally
   */
    salesMotion?: "direct_only" | "mixed" | null;
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
  /** Optional account-prior match for pump-lane scoring boost */
  accountPriorMatch?: { canonicalName: string; priorityLevel: string; } | null,
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
  if (sellingMotion === "direct") routeToBuyScore += 20;
  // NOTE: rental sellingMotion no longer contributes to routeToBuyScore — it is suppressed globally.
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
    const projSector = (project.sector || "").toLowerCase();
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

  // ── Sales-motion channel alignment penalty / bonus ──
  // GLOBAL RULE: This platform is for direct-sale reps only.
  // rental-channel projects are penalised heavily and suppressed from Must Act / Closing Soon.
  // direct_only (all reps) + rental channel → −25 pts AND flagged for digest suppression
  // direct_only (all reps) + direct channel → +10 pts (reward confirmed CAPEX signal)
  // mixed rep + rental channel              → −20 pts (still suppressed from Must Act)
  // mixed rep + direct channel              → +5 pts
  let salesMotionAdjustment = 0;
  const salesMotion = profile.salesMotion ?? "direct_only"; // default is now direct_only
  if (salesMotion === "direct_only") {
    if (sellingMotion === "rental")  salesMotionAdjustment = -25; // heavy penalty + suppression
    if (sellingMotion === "direct")  salesMotionAdjustment = +10;
  } else {
    // mixed
    if (sellingMotion === "rental")  salesMotionAdjustment = -20; // still suppressed
    if (sellingMotion === "direct")  salesMotionAdjustment = +5;
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(rawFinal + salesMotionAdjustment)));

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

  // ── Three-family air opportunity classification ──
  const airClassification = classifyAirOpportunity(project);

  // ── Specialty-air signal score boost ──
  // Projects with explicit Package / N2 Membrane / Booster angles are high-value specialty
  // opportunities that are often under-scored because they lack contacts or have warm priority.
  // Apply a +15 pt boost so they compete with generic hot mining/civils projects.
  // Only applies for PA-assigned reps; capped at 100.
  const isSpecialtyAirAngle =
    airClassification.bestProductAngle === 'Package' ||
    airClassification.bestProductAngle === 'N2 Membrane' ||
    airClassification.bestProductAngle === 'Booster';
  const isPortableAirRep = assignedBLs.some(bl => BL_TO_LANE_KEY[bl] === 'portableAir');
  const specialtyAirBoost = isSpecialtyAirAngle && isPortableAirRep ? 15 : 0;
  // ── Account-prior boost (Pump/Flow lane) ──
  // When a project's owner/contractor matches a priority account in the account-prior library,
  // apply a scoring boost. A-priority: +20, B-priority: +12, C-priority: +5.
  const isPumpRep = assignedBLs.some(bl => BL_TO_LANE_KEY[bl] === 'pump');
  let accountPriorBoostVal = 0;
  if (isPumpRep && accountPriorMatch) {
    const pl = (accountPriorMatch.priorityLevel || '').toLowerCase();
    if (pl.startsWith('a')) accountPriorBoostVal = 20;
    else if (pl.startsWith('b')) accountPriorBoostVal = 12;
    else if (pl.startsWith('c')) accountPriorBoostVal = 5;
  }
  const finalScoreWithBoost = Math.max(0, Math.min(100, finalScore + specialtyAirBoost + accountPriorBoostVal));

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
  if (salesMotionAdjustment < 0) reasonCodes.push(`sales_motion_penalty_${Math.abs(salesMotionAdjustment)}`);
  if (salesMotionAdjustment > 0) reasonCodes.push(`sales_motion_bonus_${salesMotionAdjustment}`);
  if (baseScore.breakdown.strategicAccountFit > 0) reasonCodes.push("strategic_account");
  if (sendReadyContacts.length > 0) reasonCodes.push("send_ready_contact");
  else if (namedContacts.length > 0) reasonCodes.push("named_contact_only");
  else reasonCodes.push("no_contacts");
  if (hasContractor) reasonCodes.push("contractor_known");
  if (laneSuppressed) reasonCodes.push("suppressed_all_lanes_weak");
  else if (primaryWeak && !laneSuppressed) reasonCodes.push("monitor_primary_lane_weak");

  if (isSpecialtyAirAngle && isPortableAirRep && specialtyAirBoost > 0) {
    reasonCodes.push(`specialty_air_boost_${specialtyAirBoost}`);
  }
  if (accountPriorBoostVal > 0) {
    reasonCodes.push(`account_prior_boost_${accountPriorBoostVal}`);
  }

  // ── Pump action mode (Part B of Pump/Flow redesign) ──
  // Only computed for pump-lane reps. Determines the card layout and CTA.
  let pumpActionMode: LaneScoredProject['pumpActionMode'] = undefined;
  if (isPumpRep) {
    const projStage = (project.stage || '').toLowerCase();
    const hasPumpContact = contacts.some(c =>
      c.contactTrustTier === 'send_ready' &&
      (c.roleRelevance === 'high' || c.roleRelevance === 'medium')
    );
    const isAwarded = ['awarded', 'construction'].some(s => projStage.includes(s));
    const hasContractorInfo = !!(project.contractors && (project.contractors as unknown[]).length > 0);
    const overviewLower = (project.overview || '').toLowerCase();
    const isEarlyStage = ['feasibility', 'exploration', 'scoping', 'concept'].some(s => projStage.includes(s));
    const hasPumpWaterContext = /water|dewater|pump|excavat|tunnel|marine|dredg|flood|sewer|dam|bore|wellpoint|cofferdam|trench|slurry/.test(overviewLower);

    if (laneScores.pump >= 60 && hasPumpContact && !isEarlyStage) {
      pumpActionMode = 'direct_pursue';
    } else if (isAwarded && hasContractorInfo && hasPumpWaterContext) {
      pumpActionMode = 'map_package';
    } else if (laneScores.pump >= 40 && !hasPumpContact && !isEarlyStage) {
      pumpActionMode = 'find_site_contact';
    } else if (accountPriorMatch && !hasPumpContact && !isAwarded) {
      pumpActionMode = 'account_nurture';
    } else if (isEarlyStage || laneScores.pump < 30) {
      pumpActionMode = 'reference_only';
    } else {
      pumpActionMode = 'find_site_contact'; // default fallback for pump
    }
  }

  return {
    finalScore: finalScoreWithBoost,
    finalScoreWithTieBreaker: finalScoreWithBoost, // caller applies tie-breaker via applyTieBreaker()
    baseScore,
    laneScores,
    primaryLaneScore,
    sellingMotion,
    channel: sellingMotion, // deterministic enum alias (guardrail 5)
    laneSuppressed,
    laneFitLabel,
    airFit: airClassification.airFit,
    opportunityType: airClassification.opportunityType,
    bestProductAngle: airClassification.bestProductAngle,
    whyNow,
    routeToBuy,
    bestNextMove,
    channelLabel,
    reasonCodes,
    accountPriorBoost: accountPriorBoostVal,
    pumpActionMode,
    matchedAccountPrior: accountPriorMatch?.canonicalName ?? null,
  };
}

// ── Tie-breaker application (guardrail 4) ──

/**
 * Apply the mlRanker feedback boost as a tie-breaker.
 * Capped to ±5 pts — does not change ranking order unless scores are within 5 pts.
 * Call this AFTER computePerUserFinalScore(), using getFeedbackBoostForProjects() from mlRanker.
 */
/**
 * Check if the given business lines include a pump/dewatering lane.
 * Use this to pass isPumpLane to selectProjectContact.
 */
export function isPumpLaneRep(assignedBusinessLines: string[]): boolean {
  return assignedBusinessLines.some(bl => BL_TO_LANE_KEY[bl] === 'pump');
}

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

/**
 * Compute pumpActionMode for a single project without the full lane scoring pipeline.
 * Used by projectLifecycle.byId to show the badge on the detail page.
 * Mirrors the logic in computePerUserFinalScore but only needs the project + contacts + BL scores.
 */
export function computePumpActionMode(
  project: { stage: string | null; overview: string | null; contractors: unknown },
  contacts: { contactTrustTier: string | null; roleRelevance: string | null }[],
  pumpBLScore: number,
  accountPriorMatch: string | null,
): LaneScoredProject['pumpActionMode'] {
  const projStage = (project.stage || '').toLowerCase();
  const hasPumpContact = contacts.some(c =>
    c.contactTrustTier === 'send_ready' &&
    (c.roleRelevance === 'high' || c.roleRelevance === 'medium')
  );
  const isAwarded = ['awarded', 'construction'].some(s => projStage.includes(s));
  const hasContractorInfo = !!(project.contractors && (project.contractors as unknown[]).length > 0);
  const overviewLower = (project.overview || '').toLowerCase();
  const isEarlyStage = ['feasibility', 'exploration', 'scoping', 'concept'].some(s => projStage.includes(s));
  const hasPumpWaterContext = /water|dewater|pump|excavat|tunnel|marine|dredg|flood|sewer|dam|bore|wellpoint|cofferdam|trench|slurry/.test(overviewLower);

  if (pumpBLScore >= 60 && hasPumpContact && !isEarlyStage) return 'direct_pursue';
  if (isAwarded && hasContractorInfo && hasPumpWaterContext) return 'map_package';
  if (pumpBLScore >= 40 && !hasPumpContact && !isEarlyStage) return 'find_site_contact';
  if (accountPriorMatch && !hasPumpContact && !isAwarded) return 'account_nurture';
  if (isEarlyStage || pumpBLScore < 30) return 'reference_only';
  return 'find_site_contact'; // default fallback for pump
}
