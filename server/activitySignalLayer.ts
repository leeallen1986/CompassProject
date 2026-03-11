/**
 * Activity Signal Layer
 *
 * Shifts business-line scoring from "which products match this sector?" to
 * "what activities are happening on the site?"
 *
 * Three-stage pipeline:
 * 1. DETECT — scan project text for site-activity keywords
 * 2. MAP — translate detected activities into equipment relevance scores
 * 3. ADJUST — apply stage weighting and environmental signal boosting
 *
 * The output is a set of score modifiers that are injected into the LLM
 * prompt and also applied as deterministic post-LLM adjustments.
 */

import type { ScoringDimension } from "./businessLineScoring";

// ── Activity Definitions ──

export const SITE_ACTIVITIES = [
  "drilling",
  "blasting",
  "tunnelling",
  "excavation",
  "trenching",
  "dewatering",
  "piling",
  "shotcrete",
  "sandblasting",
  "demolition",
  "crushing",
  "screening",
  "conveying",
  "pipeline_construction",
  "pipeline_hydrotest",
  "pipeline_purge",
  "welding",
  "shutdown_maintenance",
  "turnaround",
  "remote_construction",
  "temporary_camp",
  "mine_development",
  "open_pit_mining",
  "underground_mining",
  "quarry_operations",
  "dam_construction",
  "road_construction",
  "rail_construction",
  "bridge_construction",
  "port_construction",
  "water_treatment",
  "desalination",
  "renewable_energy_install",
  "substation_construction",
  "transmission_line",
  "gas_processing",
  "well_completion",
  "well_testing",
  "mineral_processing",
  "concrete_works",
  "earthmoving",
  "grading",
  "compaction",
] as const;

export type SiteActivity = (typeof SITE_ACTIVITIES)[number];

// ── Activity Detection Keywords ──
// Each activity maps to an array of keyword patterns to search for in project text.
// Patterns are checked with word-boundary-aware matching.

const ACTIVITY_KEYWORDS: Record<SiteActivity, string[]> = {
  drilling: [
    "drilling", "drill program", "drill rig", "drill campaign",
    "exploration drilling", "production drilling", "diamond drilling",
    "rc drilling", "reverse circulation", "rotary drilling", "drill and blast",
    "bore hole", "borehole",
  ],
  blasting: [
    "blasting", "blast", "explosives", "detonation", "drill and blast",
    "controlled blasting", "rock breaking",
  ],
  tunnelling: [
    "tunnel", "tunnelling", "tunneling", "tbm", "tunnel boring",
    "underground excavation", "shaft sinking", "decline development",
    "portal", "adit", "crosscut",
  ],
  excavation: [
    "excavation", "excavate", "earthworks", "bulk earthworks",
    "cut and fill", "mass excavation", "foundation excavation",
    "basement excavation", "trench excavation",
  ],
  trenching: [
    "trenching", "trench", "pipeline trench", "cable trench",
    "utility trench", "service trench",
  ],
  dewatering: [
    "dewatering", "dewater", "groundwater", "water table",
    "wellpoint", "sump pump", "water management", "water ingress",
    "seepage", "aquifer", "water inflow",
  ],
  piling: [
    "piling", "pile driving", "bored pile", "driven pile",
    "sheet pile", "foundation pile", "micropile", "screw pile",
  ],
  shotcrete: [
    "shotcrete", "gunite", "sprayed concrete", "fibre reinforced shotcrete",
    "ground support", "rock bolting and shotcrete",
  ],
  sandblasting: [
    "sandblasting", "abrasive blasting", "surface preparation",
    "blast cleaning", "grit blasting", "shot blasting",
  ],
  demolition: [
    "demolition", "demolish", "deconstruction", "dismantling",
    "wrecking", "strip out",
  ],
  crushing: [
    "crushing", "crusher", "jaw crusher", "cone crusher",
    "impact crusher", "primary crushing", "secondary crushing",
  ],
  screening: [
    "screening", "screen", "vibrating screen", "scalping screen",
  ],
  conveying: [
    "conveyor", "conveying", "overland conveyor", "belt conveyor",
  ],
  pipeline_construction: [
    "pipeline construction", "pipeline install", "pipe laying",
    "pipeline welding", "pipeline route", "gas pipeline",
    "water pipeline", "oil pipeline", "slurry pipeline",
  ],
  pipeline_hydrotest: [
    "hydrotest", "hydrostatic test", "pressure test pipeline",
    "pipeline testing", "pipeline commissioning",
  ],
  pipeline_purge: [
    "pipeline purge", "nitrogen purge", "pigging", "pipeline cleaning",
    "inerting", "blanketing", "gas purge",
  ],
  welding: [
    "welding", "weld", "fabrication", "steel fabrication",
    "structural steel", "pipe welding",
  ],
  shutdown_maintenance: [
    "shutdown", "turnaround", "outage", "planned maintenance",
    "major overhaul", "plant shutdown", "refinery shutdown",
    "maintenance shutdown",
  ],
  turnaround: [
    "turnaround", "plant turnaround", "refinery turnaround",
    "shutdown turnaround",
  ],
  remote_construction: [
    "remote site", "remote location", "fly in fly out", "fifo",
    "remote camp", "off-grid", "isolated site", "remote area",
    "outback", "remote community",
  ],
  temporary_camp: [
    "temporary camp", "construction camp", "accommodation village",
    "workers camp", "man camp", "temporary accommodation",
  ],
  mine_development: [
    "mine development", "new mine", "mine construction",
    "mine expansion", "greenfield mine", "brownfield mine",
    "mine site", "mining project",
  ],
  open_pit_mining: [
    "open pit", "open cut", "surface mining", "strip mining",
    "open pit mine", "open cast",
  ],
  underground_mining: [
    "underground mine", "underground mining", "sublevel",
    "longwall", "room and pillar", "block cave", "sublevel caving",
    "decline", "shaft", "underground development",
  ],
  quarry_operations: [
    "quarry", "quarrying", "aggregate", "sand and gravel",
    "limestone quarry", "granite quarry",
  ],
  dam_construction: [
    "dam construction", "dam wall", "tailings dam", "embankment dam",
    "spillway", "reservoir", "water storage",
  ],
  road_construction: [
    "road construction", "highway", "road upgrade", "road widening",
    "road seal", "bitumen", "asphalt", "pavement",
  ],
  rail_construction: [
    "rail construction", "railway", "rail line", "rail spur",
    "rail corridor", "rail extension", "heavy haul rail",
  ],
  bridge_construction: [
    "bridge construction", "bridge", "overpass", "viaduct",
    "river crossing", "bridge deck",
  ],
  port_construction: [
    "port construction", "wharf", "jetty", "berth", "port expansion",
    "marine terminal", "bulk terminal", "container terminal",
  ],
  water_treatment: [
    "water treatment", "wastewater", "sewage treatment",
    "water recycling", "effluent treatment", "water purification",
  ],
  desalination: [
    "desalination", "desalination plant", "reverse osmosis",
    "seawater treatment",
  ],
  renewable_energy_install: [
    "solar farm", "wind farm", "solar install", "wind turbine",
    "renewable energy", "photovoltaic", "solar panel",
    "wind energy", "battery storage", "solar power",
  ],
  substation_construction: [
    "substation", "switchyard", "transformer", "electrical substation",
    "power substation",
  ],
  transmission_line: [
    "transmission line", "powerline", "power line", "overhead line",
    "high voltage", "transmission tower",
  ],
  gas_processing: [
    "gas processing", "gas plant", "lng", "gas compression",
    "gas treatment", "gas separation", "cng", "lpg plant",
  ],
  well_completion: [
    "well completion", "completions", "casing", "cementing",
    "perforation", "well stimulation", "fracking", "fracturing",
  ],
  well_testing: [
    "well testing", "well test", "flow testing", "production testing",
    "well evaluation",
  ],
  mineral_processing: [
    "mineral processing", "processing plant", "concentrator",
    "flotation", "leaching", "heap leach", "cil", "smelter",
    "refinery", "beneficiation", "comminution", "grinding",
  ],
  concrete_works: [
    "concrete", "concrete pour", "concrete batch", "precast",
    "ready mix", "formwork", "rebar",
  ],
  earthmoving: [
    "earthmoving", "earth moving", "bulk earth", "site preparation",
    "land clearing", "site clearing",
  ],
  grading: [
    "grading", "levelling", "leveling", "site grading",
  ],
  compaction: [
    "compaction", "compacting", "roller", "vibration compaction",
  ],
};

// ── Environmental Signal Keywords ──
// These boost dewatering/pump scores when detected

export const ENVIRONMENTAL_SIGNALS = [
  "groundwater", "water table", "aquifer", "seepage", "water ingress",
  "flood", "flooding", "drainage", "water management", "wet conditions",
  "high water", "water inflow", "saturated", "waterlogged",
  "below water table", "pit water", "mine water", "process water",
  "stormwater", "runoff", "effluent", "tailings water",
  "river diversion", "creek crossing", "wetland",
] as const;

// ── Stage Weighting ──

export type StageWeight = "boost" | "neutral" | "reduce";

const STAGE_WEIGHTS: Record<string, StageWeight> = {
  // Boost — active site work
  construction: "boost",
  mobilisation: "boost",
  commissioning: "boost",
  execution: "boost",
  production: "boost",
  operational: "boost",
  "under construction": "boost",

  // Neutral — design/approval
  "detailed design": "neutral",
  feed: "neutral",
  approval: "neutral",
  "front end engineering": "neutral",
  procurement: "neutral",
  tender: "neutral",
  awarded: "neutral",
  "pre-construction": "neutral",

  // Reduce — early stage
  exploration: "reduce",
  feasibility: "reduce",
  "pre-feasibility": "reduce",
  "definitive feasibility": "reduce",
  conceptual: "reduce",
  scoping: "reduce",
  planning: "reduce",
  "environmental assessment": "reduce",
  "early planning": "reduce",
  announced: "reduce",
  proposed: "reduce",
};

/**
 * Determine stage weight from a free-text stage field.
 */
export function getStageWeight(stage: string | null | undefined): StageWeight {
  if (!stage) return "neutral";
  const lower = stage.toLowerCase().trim();

  // Exact match first
  if (STAGE_WEIGHTS[lower]) return STAGE_WEIGHTS[lower];

  // Partial match
  for (const [key, weight] of Object.entries(STAGE_WEIGHTS)) {
    if (lower.includes(key)) return weight;
  }

  return "neutral";
}

// ── Activity-to-Equipment Scoring Matrix ──
// Each activity maps to a set of equipment relevance multipliers (0.0 to 1.0).
// These represent the inherent need for each equipment type given the activity.

type EquipmentRelevance = Partial<Record<ScoringDimension, number>>;

const ACTIVITY_EQUIPMENT_MAP: Record<SiteActivity, EquipmentRelevance> = {
  drilling: {
    "Portable Air": 0.95,
    "Generators": 0.6,
    "PAL": 0.6,
    "Pump/Dewatering": 0.4,
    "Service Potential": 0.7,
    "Rental Influence": 0.7,
  },
  blasting: {
    "Portable Air": 0.85,
    "Nitrogen": 0.5,
    "Service Potential": 0.5,
    "Rental Influence": 0.6,
  },
  tunnelling: {
    "Portable Air": 0.95,
    "Pump/Dewatering": 0.75,
    "Generators": 0.7,
    "PAL": 0.7,
    "Booster": 0.4,
    "Service Potential": 0.8,
    "Rental Influence": 0.7,
  },
  excavation: {
    "Pump/Dewatering": 0.7,
    "Portable Air": 0.3,
    "Generators": 0.4,
    "PAL": 0.4,
    "Rental Influence": 0.5,
  },
  trenching: {
    "Pump/Dewatering": 0.75,
    "Portable Air": 0.3,
    "Generators": 0.3,
    "PAL": 0.3,
    "Rental Influence": 0.5,
  },
  dewatering: {
    "Pump/Dewatering": 0.95,
    "Generators": 0.5,
    "PAL": 0.4,
    "Service Potential": 0.7,
    "Rental Influence": 0.7,
  },
  piling: {
    "Portable Air": 0.4,
    "Generators": 0.5,
    "PAL": 0.5,
    "Pump/Dewatering": 0.3,
    "Rental Influence": 0.5,
  },
  shotcrete: {
    "Portable Air": 0.9,
    "Generators": 0.4,
    "Service Potential": 0.6,
    "Rental Influence": 0.6,
  },
  sandblasting: {
    "Portable Air": 0.9,
    "Booster": 0.5,
    "Service Potential": 0.5,
    "Rental Influence": 0.6,
  },
  demolition: {
    "Portable Air": 0.7,
    "Generators": 0.4,
    "PAL": 0.4,
    "Pump/Dewatering": 0.3,
    "Rental Influence": 0.7,
  },
  crushing: {
    "Portable Air": 0.5,
    "Generators": 0.6,
    "PAL": 0.5,
    "Service Potential": 0.5,
  },
  screening: {
    "Generators": 0.4,
    "PAL": 0.3,
  },
  conveying: {
    "Generators": 0.4,
    "PAL": 0.3,
  },
  pipeline_construction: {
    "Portable Air": 0.6,
    "Generators": 0.7,
    "PAL": 0.6,
    "Pump/Dewatering": 0.5,
    "Nitrogen": 0.6,
    "Booster": 0.6,
    "Service Potential": 0.6,
    "Rental Influence": 0.7,
  },
  pipeline_hydrotest: {
    "Nitrogen": 0.9,
    "Booster": 0.9,
    "Portable Air": 0.3,
    "Generators": 0.5,
    "Service Potential": 0.5,
  },
  pipeline_purge: {
    "Nitrogen": 0.95,
    "Booster": 0.7,
    "Portable Air": 0.2,
  },
  welding: {
    "Generators": 0.6,
    "PAL": 0.4,
    "Portable Air": 0.3,
  },
  shutdown_maintenance: {
    "Portable Air": 0.7,
    "Generators": 0.7,
    "PAL": 0.6,
    "Nitrogen": 0.5,
    "Booster": 0.4,
    "Service Potential": 0.8,
    "Rental Influence": 0.9,
  },
  turnaround: {
    "Portable Air": 0.7,
    "Generators": 0.7,
    "PAL": 0.6,
    "Nitrogen": 0.5,
    "Booster": 0.4,
    "Service Potential": 0.8,
    "Rental Influence": 0.9,
  },
  remote_construction: {
    "Generators": 0.85,
    "PAL": 0.85,
    "BESS": 0.6,
    "Portable Air": 0.5,
    "Pump/Dewatering": 0.4,
    "Service Potential": 0.7,
    "Rental Influence": 0.6,
  },
  temporary_camp: {
    "Generators": 0.8,
    "PAL": 0.8,
    "BESS": 0.5,
    "Rental Influence": 0.7,
  },
  mine_development: {
    "Portable Air": 0.8,
    "Generators": 0.7,
    "PAL": 0.7,
    "Pump/Dewatering": 0.6,
    "BESS": 0.4,
    "Service Potential": 0.8,
    "Rental Influence": 0.6,
  },
  open_pit_mining: {
    "Portable Air": 0.85,
    "Pump/Dewatering": 0.7,
    "Generators": 0.6,
    "PAL": 0.6,
    "Service Potential": 0.8,
    "Rental Influence": 0.5,
  },
  underground_mining: {
    "Portable Air": 0.95,
    "Pump/Dewatering": 0.8,
    "Generators": 0.7,
    "PAL": 0.7,
    "Booster": 0.4,
    "Service Potential": 0.9,
    "Rental Influence": 0.5,
  },
  quarry_operations: {
    "Portable Air": 0.8,
    "Generators": 0.5,
    "PAL": 0.5,
    "Pump/Dewatering": 0.4,
    "Service Potential": 0.6,
  },
  dam_construction: {
    "Pump/Dewatering": 0.85,
    "Generators": 0.6,
    "PAL": 0.6,
    "Portable Air": 0.4,
    "Service Potential": 0.5,
    "Rental Influence": 0.6,
  },
  road_construction: {
    "Generators": 0.4,
    "PAL": 0.5,
    "Portable Air": 0.3,
    "Rental Influence": 0.5,
  },
  rail_construction: {
    "Generators": 0.5,
    "PAL": 0.5,
    "Portable Air": 0.4,
    "Pump/Dewatering": 0.3,
    "Rental Influence": 0.5,
  },
  bridge_construction: {
    "Generators": 0.5,
    "PAL": 0.5,
    "Portable Air": 0.4,
    "Pump/Dewatering": 0.5,
    "Rental Influence": 0.5,
  },
  port_construction: {
    "Pump/Dewatering": 0.7,
    "Generators": 0.6,
    "PAL": 0.6,
    "Portable Air": 0.4,
    "Rental Influence": 0.5,
  },
  water_treatment: {
    "Pump/Dewatering": 0.7,
    "Generators": 0.5,
    "Portable Air": 0.2,
  },
  desalination: {
    "Pump/Dewatering": 0.6,
    "Generators": 0.6,
    "BESS": 0.4,
    "Portable Air": 0.1,
  },
  renewable_energy_install: {
    "BESS": 0.8,
    "Generators": 0.4,
    "PAL": 0.4,
    "Portable Air": 0.15,
    "Rental Influence": 0.4,
  },
  substation_construction: {
    "Generators": 0.5,
    "PAL": 0.4,
    "Portable Air": 0.2,
  },
  transmission_line: {
    "Generators": 0.4,
    "PAL": 0.4,
    "Portable Air": 0.15,
  },
  gas_processing: {
    "Nitrogen": 0.7,
    "Booster": 0.7,
    "Generators": 0.6,
    "Portable Air": 0.4,
    "Service Potential": 0.7,
  },
  well_completion: {
    "Nitrogen": 0.8,
    "Booster": 0.8,
    "Portable Air": 0.5,
    "Generators": 0.5,
    "Service Potential": 0.6,
  },
  well_testing: {
    "Booster": 0.85,
    "Nitrogen": 0.6,
    "Generators": 0.5,
    "Portable Air": 0.4,
  },
  mineral_processing: {
    "Generators": 0.6,
    "Portable Air": 0.4,
    "Pump/Dewatering": 0.5,
    "Service Potential": 0.7,
  },
  concrete_works: {
    "Portable Air": 0.4,
    "Generators": 0.5,
    "PAL": 0.4,
  },
  earthmoving: {
    "Generators": 0.4,
    "PAL": 0.4,
    "Pump/Dewatering": 0.3,
    "Portable Air": 0.2,
  },
  grading: {
    "Generators": 0.3,
    "PAL": 0.3,
  },
  compaction: {
    "Generators": 0.3,
    "PAL": 0.3,
  },
};

// ── Stage Multipliers ──

const STAGE_MULTIPLIERS: Record<StageWeight, number> = {
  boost: 1.15,    // +15% for active construction
  neutral: 1.0,
  reduce: 0.65,   // -35% for early-stage
};

// ── Core Detection Function ──

export interface DetectedActivity {
  activity: SiteActivity;
  confidence: "high" | "medium";
  matchedKeywords: string[];
}

/**
 * Detect site activities from project text (name + overview + equipment signals).
 * Returns activities sorted by confidence (high first) then alphabetically.
 */
export function detectActivities(
  projectName: string,
  overview: string | null | undefined,
  equipmentSignals: string[] | null | undefined,
  sector?: string | null,
): DetectedActivity[] {
  const text = [
    projectName || "",
    overview || "",
    (equipmentSignals || []).join(" "),
    sector || "",
  ]
    .join(" ")
    .toLowerCase();

  const detected: DetectedActivity[] = [];

  for (const activity of SITE_ACTIVITIES) {
    const keywords = ACTIVITY_KEYWORDS[activity];
    const matched: string[] = [];

    for (const kw of keywords) {
      // Use word-boundary matching for short keywords, includes for longer ones
      if (kw.length <= 4) {
        const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (re.test(text)) matched.push(kw);
      } else {
        if (text.includes(kw)) matched.push(kw);
      }
    }

    if (matched.length > 0) {
      detected.push({
        activity,
        confidence: matched.length >= 2 ? "high" : "medium",
        matchedKeywords: matched,
      });
    }
  }

  // Sort: high confidence first, then alphabetically
  detected.sort((a, b) => {
    if (a.confidence !== b.confidence) {
      return a.confidence === "high" ? -1 : 1;
    }
    return a.activity.localeCompare(b.activity);
  });

  return detected;
}

/**
 * Detect environmental signals that boost dewatering/pump scores.
 */
export function detectEnvironmentalSignals(
  projectName: string,
  overview: string | null | undefined,
  equipmentSignals: string[] | null | undefined,
): string[] {
  const text = [
    projectName || "",
    overview || "",
    (equipmentSignals || []).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  const found: string[] = [];
  for (const signal of ENVIRONMENTAL_SIGNALS) {
    if (text.includes(signal)) {
      found.push(signal);
    }
  }
  return found;
}

// ── Score Modifier Computation ──

export interface ActivityScoreModifiers {
  /** Detected site activities */
  activities: DetectedActivity[];
  /** Environmental signals found */
  environmentalSignals: string[];
  /** Stage weight classification */
  stageWeight: StageWeight;
  /** Per-dimension score adjustments (-100 to +100) */
  adjustments: Record<ScoringDimension, number>;
  /** Human-readable summary for LLM prompt injection */
  promptSummary: string;
}

/**
 * Compute score modifiers for a project based on detected activities,
 * environmental signals, and stage weighting.
 */
export function computeScoreModifiers(
  projectName: string,
  overview: string | null | undefined,
  equipmentSignals: string[] | null | undefined,
  stage: string | null | undefined,
  sector?: string | null,
): ActivityScoreModifiers {
  const activities = detectActivities(projectName, overview, equipmentSignals, sector);
  const environmentalSignals = detectEnvironmentalSignals(projectName, overview, equipmentSignals);
  const stageWeight = getStageWeight(stage);
  const stageMultiplier = STAGE_MULTIPLIERS[stageWeight];

  // Aggregate equipment relevance from all detected activities
  const rawScores: Record<string, number> = {};
  const dimensions: ScoringDimension[] = [
    "Portable Air", "PAL", "BESS", "Pump/Dewatering",
    "Generators", "Nitrogen", "Booster", "Service Potential", "Rental Influence",
  ];

  for (const dim of dimensions) {
    rawScores[dim] = 0;
  }

  // For each detected activity, take the MAX relevance per dimension
  // (not sum — we want the strongest signal, not cumulative)
  for (const det of activities) {
    const equipMap = ACTIVITY_EQUIPMENT_MAP[det.activity];
    const confidenceBoost = det.confidence === "high" ? 1.0 : 0.85;

    for (const dim of dimensions) {
      const relevance = equipMap[dim] || 0;
      const adjusted = relevance * confidenceBoost;
      rawScores[dim] = Math.max(rawScores[dim]!, adjusted);
    }
  }

  // Apply environmental signal boosting for dewatering
  if (environmentalSignals.length > 0) {
    const envBoost = Math.min(0.3, environmentalSignals.length * 0.1); // up to +30%
    rawScores["Pump/Dewatering"] = Math.min(1.0, (rawScores["Pump/Dewatering"] || 0) + envBoost);
  }

  // Apply stage weighting
  for (const dim of dimensions) {
    rawScores[dim] = rawScores[dim]! * stageMultiplier;
  }

  // Convert to score adjustments (-100 to +100 scale)
  // Positive = boost, negative = reduce
  // The adjustment is relative to a "neutral" baseline of 0.5
  const adjustments = {} as Record<ScoringDimension, number>;
  for (const dim of dimensions) {
    const raw = rawScores[dim] || 0;
    // Convert 0-1 relevance to -30 to +30 adjustment range
    // 0.0 relevance → -15 (slight penalty for no activity signal)
    // 0.5 relevance → 0 (neutral)
    // 1.0 relevance → +15 (strong boost)
    if (activities.length === 0) {
      // No activities detected — no adjustments
      adjustments[dim] = 0;
    } else {
      adjustments[dim] = Math.round((raw - 0.5) * 30);
    }
  }

  // Build prompt summary
  const promptSummary = buildPromptSummary(activities, environmentalSignals, stageWeight);

  return {
    activities,
    environmentalSignals,
    stageWeight,
    adjustments,
    promptSummary,
  };
}

/**
 * Apply activity-based score adjustments to LLM-generated scores.
 * Clamps results to 0-100.
 */
export function applyScoreAdjustments(
  llmScores: Array<{ dimension: ScoringDimension; score: number; explanation: string }>,
  modifiers: ActivityScoreModifiers,
): Array<{ dimension: ScoringDimension; score: number; explanation: string }> {
  return llmScores.map(s => {
    const adj = modifiers.adjustments[s.dimension] || 0;
    const newScore = Math.max(0, Math.min(100, s.score + adj));

    // Append activity context to explanation if significant adjustment
    let explanation = s.explanation;
    if (Math.abs(adj) >= 5) {
      const direction = adj > 0 ? "boosted" : "reduced";
      const reason = adj > 0
        ? `Activity signals (${modifiers.activities.map(a => a.activity.replace(/_/g, " ")).slice(0, 3).join(", ")}) ${direction} score by ${Math.abs(adj)}.`
        : `${modifiers.stageWeight === "reduce" ? "Early-stage project" : "No matching activities"} ${direction} score by ${Math.abs(adj)}.`;
      explanation = `${explanation} [${reason}]`;
    }

    return {
      dimension: s.dimension,
      score: newScore,
      explanation,
    };
  });
}

// ── Prompt Summary Builder ──

function buildPromptSummary(
  activities: DetectedActivity[],
  envSignals: string[],
  stageWeight: StageWeight,
): string {
  const parts: string[] = [];

  if (activities.length > 0) {
    const highConf = activities.filter(a => a.confidence === "high");
    const medConf = activities.filter(a => a.confidence === "medium");

    if (highConf.length > 0) {
      parts.push(
        `CONFIRMED SITE ACTIVITIES: ${highConf.map(a => a.activity.replace(/_/g, " ")).join(", ")}`
      );
    }
    if (medConf.length > 0) {
      parts.push(
        `LIKELY SITE ACTIVITIES: ${medConf.map(a => a.activity.replace(/_/g, " ")).join(", ")}`
      );
    }
  } else {
    parts.push("NO SPECIFIC SITE ACTIVITIES DETECTED from project description.");
  }

  if (envSignals.length > 0) {
    parts.push(
      `ENVIRONMENTAL SIGNALS (boost dewatering): ${envSignals.join(", ")}`
    );
  }

  if (stageWeight === "reduce") {
    parts.push(
      "STAGE WARNING: This is an early-stage project (exploration/feasibility). Reduce equipment scores — site activities are not yet confirmed. Portable Air should only score high if drilling/tunnelling/blasting is explicitly mentioned."
    );
  } else if (stageWeight === "boost") {
    parts.push(
      "STAGE BOOST: This project is in active construction/execution. Equipment needs are confirmed and imminent."
    );
  }

  return parts.join("\n");
}
