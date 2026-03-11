/**
 * Tests for the Activity Signal Layer
 *
 * Covers:
 * - Activity detection from project text
 * - Environmental signal detection
 * - Stage weight classification
 * - Score modifier computation
 * - Post-LLM score adjustments
 * - Edge cases and integration scenarios
 */

import { describe, it, expect } from "vitest";
import {
  detectActivities,
  detectEnvironmentalSignals,
  getStageWeight,
  computeScoreModifiers,
  applyScoreAdjustments,
  type DetectedActivity,
} from "./activitySignalLayer";
import type { ScoringDimension } from "./businessLineScoring";

// ── Activity Detection Tests ──

describe("detectActivities", () => {
  it("detects drilling from project name", () => {
    const result = detectActivities("BHP Drilling Campaign 2026", null, null);
    const activities = result.map(a => a.activity);
    expect(activities).toContain("drilling");
  });

  it("detects tunnelling from overview text", () => {
    const result = detectActivities(
      "Metro Extension Project",
      "The project involves tunnel boring machine operations through sandstone for 12km of new rail tunnel.",
      null,
    );
    const activities = result.map(a => a.activity);
    expect(activities).toContain("tunnelling");
  });

  it("detects multiple activities from a complex project", () => {
    const result = detectActivities(
      "Gold Mine Development",
      "Underground mining development with decline access, drill and blast operations, and dewatering requirements due to high water table.",
      ["compressor", "dewatering pump"],
    );
    const activities = result.map(a => a.activity);
    expect(activities).toContain("drilling");
    expect(activities).toContain("blasting");
    expect(activities).toContain("underground_mining");
    expect(activities).toContain("dewatering");
  });

  it("detects pipeline activities", () => {
    const result = detectActivities(
      "Northern Gas Pipeline",
      "Pipeline construction including welding, hydrotest, and nitrogen purge operations.",
      null,
    );
    const activities = result.map(a => a.activity);
    expect(activities).toContain("pipeline_construction");
    expect(activities).toContain("pipeline_hydrotest");
    expect(activities).toContain("pipeline_purge");
    expect(activities).toContain("welding");
  });

  it("detects shutdown/turnaround activities", () => {
    const result = detectActivities(
      "Refinery Turnaround",
      "Major planned maintenance shutdown of the refinery including equipment overhaul.",
      null,
    );
    const activities = result.map(a => a.activity);
    expect(activities).toContain("shutdown_maintenance");
    expect(activities).toContain("turnaround");
  });

  it("detects remote construction signals", () => {
    const result = detectActivities(
      "Remote Camp Construction",
      "Fly in fly out construction of accommodation village at remote site in the Pilbara.",
      null,
    );
    const activities = result.map(a => a.activity);
    expect(activities).toContain("remote_construction");
    expect(activities).toContain("temporary_camp");
  });

  it("detects renewable energy activities", () => {
    const result = detectActivities(
      "Solar Farm Development",
      "Construction of 200MW solar farm with battery storage and substation.",
      null,
    );
    const activities = result.map(a => a.activity);
    expect(activities).toContain("renewable_energy_install");
    expect(activities).toContain("substation_construction");
  });

  it("returns empty array when no activities detected", () => {
    const result = detectActivities(
      "Corporate Office Lease",
      "Renewal of office lease in Sydney CBD.",
      null,
    );
    expect(result).toHaveLength(0);
  });

  it("assigns high confidence when multiple keywords match", () => {
    const result = detectActivities(
      "Underground Mine Expansion",
      "Underground mining development with decline and shaft sinking operations.",
      null,
    );
    const underground = result.find(a => a.activity === "underground_mining");
    expect(underground).toBeDefined();
    expect(underground!.confidence).toBe("high");
    expect(underground!.matchedKeywords.length).toBeGreaterThanOrEqual(2);
  });

  it("assigns medium confidence for single keyword match", () => {
    const result = detectActivities(
      "Infrastructure Project",
      "The project will require some compaction work.",
      null,
    );
    const compaction = result.find(a => a.activity === "compaction");
    expect(compaction).toBeDefined();
    expect(compaction!.confidence).toBe("medium");
  });

  it("sorts high confidence before medium confidence", () => {
    const result = detectActivities(
      "Mine Development",
      "Underground mining with decline development, shaft sinking, and some grading work.",
      null,
    );
    // underground_mining should have high confidence (multiple keywords)
    // grading should have medium confidence (single keyword)
    const ugIdx = result.findIndex(a => a.activity === "underground_mining");
    const grIdx = result.findIndex(a => a.activity === "grading");
    if (ugIdx >= 0 && grIdx >= 0) {
      expect(ugIdx).toBeLessThan(grIdx);
    }
  });

  it("detects activities from equipment signals array", () => {
    const result = detectActivities(
      "Construction Project",
      null,
      ["drilling rig", "dewatering pump", "shotcrete machine"],
    );
    const activities = result.map(a => a.activity);
    expect(activities).toContain("drilling");
    expect(activities).toContain("dewatering");
    expect(activities).toContain("shotcrete");
  });

  it("detects quarry operations", () => {
    const result = detectActivities(
      "Limestone Quarry Expansion",
      "Expansion of aggregate quarry with new crusher installation.",
      null,
    );
    const activities = result.map(a => a.activity);
    expect(activities).toContain("quarry_operations");
    expect(activities).toContain("crushing");
  });

  it("detects dam construction", () => {
    const result = detectActivities(
      "Tailings Dam Upgrade",
      "Construction of new tailings dam embankment with spillway upgrade.",
      null,
    );
    const activities = result.map(a => a.activity);
    expect(activities).toContain("dam_construction");
  });

  it("detects well completion and testing", () => {
    const result = detectActivities(
      "Gas Well Program",
      "Well completion and flow testing operations for new gas wells.",
      null,
    );
    const activities = result.map(a => a.activity);
    expect(activities).toContain("well_completion");
    expect(activities).toContain("well_testing");
  });

  it("uses word-boundary matching for short keywords like 'tbm'", () => {
    const result = detectActivities(
      "Metro Tunnel Project",
      "Two TBM machines will be used for the tunnel construction.",
      null,
    );
    const activities = result.map(a => a.activity);
    expect(activities).toContain("tunnelling");
  });

  it("detects sector as additional signal", () => {
    const result = detectActivities(
      "New Mining Project",
      "A new mine site development project.",
      null,
      "mining",
    );
    // "mine site" in overview should match mine_development keywords
    const activities = result.map(a => a.activity);
    expect(activities).toContain("mine_development");
  });
});

// ── Environmental Signal Tests ──

describe("detectEnvironmentalSignals", () => {
  it("detects groundwater signals", () => {
    const result = detectEnvironmentalSignals(
      "Mine Project",
      "High groundwater table requires extensive dewatering. Water table is at 5m depth.",
      null,
    );
    expect(result).toContain("groundwater");
    expect(result).toContain("water table");
  });

  it("detects drainage and seepage", () => {
    const result = detectEnvironmentalSignals(
      "Tunnel Project",
      "Significant seepage expected during excavation. Drainage management plan required.",
      null,
    );
    expect(result).toContain("seepage");
    expect(result).toContain("drainage");
  });

  it("returns empty for projects without water signals", () => {
    const result = detectEnvironmentalSignals(
      "Solar Farm",
      "Grid-connected solar installation on flat desert land.",
      null,
    );
    expect(result).toHaveLength(0);
  });

  it("detects signals from equipment signals array", () => {
    const result = detectEnvironmentalSignals(
      "Construction",
      null,
      ["dewatering pump for groundwater management"],
    );
    expect(result).toContain("groundwater");
  });

  it("detects multiple environmental signals", () => {
    const result = detectEnvironmentalSignals(
      "Dam Construction",
      "The project faces challenges with high water table, significant seepage, and requires river diversion and stormwater management.",
      null,
    );
    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Stage Weight Tests ──

describe("getStageWeight", () => {
  it("returns 'boost' for construction stage", () => {
    expect(getStageWeight("Construction")).toBe("boost");
  });

  it("returns 'boost' for mobilisation", () => {
    expect(getStageWeight("Mobilisation")).toBe("boost");
  });

  it("returns 'boost' for execution", () => {
    expect(getStageWeight("Execution")).toBe("boost");
  });

  it("returns 'reduce' for exploration", () => {
    expect(getStageWeight("Exploration")).toBe("reduce");
  });

  it("returns 'reduce' for feasibility", () => {
    expect(getStageWeight("Feasibility Study")).toBe("reduce");
  });

  it("returns 'reduce' for pre-feasibility", () => {
    expect(getStageWeight("Pre-Feasibility")).toBe("reduce");
  });

  it("returns 'reduce' for conceptual", () => {
    expect(getStageWeight("Conceptual Study")).toBe("reduce");
  });

  it("returns 'neutral' for FEED", () => {
    expect(getStageWeight("FEED")).toBe("neutral");
  });

  it("returns 'neutral' for detailed design", () => {
    expect(getStageWeight("Detailed Design")).toBe("neutral");
  });

  it("returns 'neutral' for tender", () => {
    expect(getStageWeight("Tender")).toBe("neutral");
  });

  it("returns 'neutral' for null/undefined", () => {
    expect(getStageWeight(null)).toBe("neutral");
    expect(getStageWeight(undefined)).toBe("neutral");
  });

  it("returns 'neutral' for unknown stages", () => {
    expect(getStageWeight("Unknown Stage XYZ")).toBe("neutral");
  });

  it("handles partial match for 'under construction'", () => {
    expect(getStageWeight("Currently under construction")).toBe("boost");
  });
});

// ── Score Modifier Computation Tests ──

describe("computeScoreModifiers", () => {
  it("boosts Portable Air for drilling projects", () => {
    const mods = computeScoreModifiers(
      "Drilling Campaign",
      "Diamond drilling program for mineral exploration.",
      null,
      "Construction",
    );
    expect(mods.adjustments["Portable Air"]).toBeGreaterThan(0);
    expect(mods.activities.some(a => a.activity === "drilling")).toBe(true);
  });

  it("boosts Pump/Dewatering for excavation with groundwater", () => {
    const mods = computeScoreModifiers(
      "Basement Excavation",
      "Deep basement excavation with high groundwater table requiring dewatering.",
      null,
      "Construction",
    );
    expect(mods.adjustments["Pump/Dewatering"]).toBeGreaterThan(0);
    expect(mods.environmentalSignals.length).toBeGreaterThan(0);
  });

  it("boosts Nitrogen and Booster for pipeline hydrotest", () => {
    const mods = computeScoreModifiers(
      "Pipeline Commissioning",
      "Hydrotest and nitrogen purge of 200km gas pipeline.",
      null,
      "Construction",
    );
    expect(mods.adjustments["Nitrogen"]).toBeGreaterThan(0);
    expect(mods.adjustments["Booster"]).toBeGreaterThan(0);
  });

  it("reduces scores for early-stage projects", () => {
    const mods = computeScoreModifiers(
      "Mine Feasibility Study",
      "Pre-feasibility study for new gold mine development.",
      null,
      "Feasibility",
    );
    expect(mods.stageWeight).toBe("reduce");
    // Even though mine_development is detected, scores should be reduced
    if (mods.activities.length > 0) {
      // The stage reduction should temper the activity boost
      const portableAir = mods.adjustments["Portable Air"];
      // With reduce multiplier (0.65), scores should be lower
      expect(portableAir).toBeLessThan(15);
    }
  });

  it("does not boost Portable Air for renewable energy without drilling", () => {
    const mods = computeScoreModifiers(
      "Solar Farm Construction",
      "Grid-connected 500MW solar farm with battery storage installation.",
      null,
      "Construction",
    );
    // Portable Air should have low or negative adjustment
    expect(mods.adjustments["Portable Air"]).toBeLessThanOrEqual(0);
    // BESS should be boosted
    expect(mods.adjustments["BESS"]).toBeGreaterThan(0);
  });

  it("returns zero adjustments when no activities detected", () => {
    const mods = computeScoreModifiers(
      "Office Building",
      "Commercial office tower in CBD.",
      null,
      "Planning",
    );
    expect(mods.activities).toHaveLength(0);
    expect(mods.adjustments["Portable Air"]).toBe(0);
    expect(mods.adjustments["Pump/Dewatering"]).toBe(0);
  });

  it("generates prompt summary with confirmed activities", () => {
    const mods = computeScoreModifiers(
      "Underground Mine",
      "Underground mining with decline development and shaft sinking.",
      null,
      "Construction",
    );
    expect(mods.promptSummary).toContain("CONFIRMED SITE ACTIVITIES");
    expect(mods.promptSummary).toContain("underground mining");
  });

  it("generates prompt summary with stage warning for early projects", () => {
    const mods = computeScoreModifiers(
      "Exploration Project",
      "Exploration drilling program.",
      null,
      "Exploration",
    );
    expect(mods.promptSummary).toContain("STAGE WARNING");
  });

  it("generates prompt summary with stage boost for construction", () => {
    const mods = computeScoreModifiers(
      "Mine Construction",
      "Active construction of processing plant.",
      null,
      "Construction",
    );
    expect(mods.promptSummary).toContain("STAGE BOOST");
  });

  it("environmental signals boost dewatering even without explicit dewatering activity", () => {
    const mods = computeScoreModifiers(
      "Tunnel Project",
      "Tunnel construction through saturated ground with significant water ingress expected.",
      null,
      "Construction",
    );
    // Environmental signals should boost dewatering
    expect(mods.environmentalSignals.length).toBeGreaterThan(0);
    expect(mods.adjustments["Pump/Dewatering"]).toBeGreaterThan(0);
  });
});

// ── Score Adjustment Tests ──

describe("applyScoreAdjustments", () => {
  const baseDimensions: ScoringDimension[] = [
    "Portable Air", "PAL", "BESS", "Pump/Dewatering",
    "Generators", "Nitrogen", "Booster", "Service Potential", "Rental Influence",
  ];

  function makeLLMScores(overrides: Partial<Record<ScoringDimension, number>> = {}) {
    return baseDimensions.map(dim => ({
      dimension: dim,
      score: overrides[dim] ?? 50,
      explanation: `LLM scored ${dim}`,
    }));
  }

  it("boosts drilling project Portable Air score", () => {
    const mods = computeScoreModifiers(
      "Drilling Program",
      "Diamond drilling campaign for gold exploration.",
      null,
      "Construction",
    );
    const llmScores = makeLLMScores({ "Portable Air": 60 });
    const adjusted = applyScoreAdjustments(llmScores, mods);
    const pa = adjusted.find(s => s.dimension === "Portable Air")!;
    expect(pa.score).toBeGreaterThan(60);
  });

  it("reduces early-stage project scores", () => {
    const mods = computeScoreModifiers(
      "Exploration Drilling",
      "Exploration drilling program.",
      null,
      "Exploration",
    );
    const llmScores = makeLLMScores({ "Portable Air": 70 });
    const adjusted = applyScoreAdjustments(llmScores, mods);
    const pa = adjusted.find(s => s.dimension === "Portable Air")!;
    // Stage reduction should temper the score
    // The drilling activity boosts, but the exploration stage reduces
    expect(pa.score).toBeLessThanOrEqual(80);
  });

  it("clamps scores to 0-100 range", () => {
    const mods = computeScoreModifiers(
      "Underground Mining Drilling Tunnelling",
      "Underground mining with drilling, tunnelling, blasting, and shotcrete.",
      null,
      "Construction",
    );
    const llmScores = makeLLMScores({ "Portable Air": 95 });
    const adjusted = applyScoreAdjustments(llmScores, mods);
    const pa = adjusted.find(s => s.dimension === "Portable Air")!;
    expect(pa.score).toBeLessThanOrEqual(100);
    expect(pa.score).toBeGreaterThanOrEqual(0);
  });

  it("does not modify scores when no activities detected", () => {
    const mods = computeScoreModifiers(
      "Office Building",
      "Commercial office tower.",
      null,
      "Planning",
    );
    const llmScores = makeLLMScores({ "Portable Air": 50 });
    const adjusted = applyScoreAdjustments(llmScores, mods);
    const pa = adjusted.find(s => s.dimension === "Portable Air")!;
    expect(pa.score).toBe(50); // No adjustment
  });

  it("adds activity context to explanation for significant adjustments", () => {
    const mods = computeScoreModifiers(
      "Drilling Campaign",
      "Major drilling program with multiple rigs.",
      null,
      "Construction",
    );
    const llmScores = makeLLMScores({ "Portable Air": 60 });
    const adjusted = applyScoreAdjustments(llmScores, mods);
    const pa = adjusted.find(s => s.dimension === "Portable Air")!;
    if (Math.abs(mods.adjustments["Portable Air"]) >= 5) {
      expect(pa.explanation).toContain("[");
    }
  });

  it("boosts dewatering for tunnel project with water signals", () => {
    const mods = computeScoreModifiers(
      "Rail Tunnel",
      "Tunnel construction through areas with high groundwater and seepage.",
      null,
      "Construction",
    );
    const llmScores = makeLLMScores({ "Pump/Dewatering": 40 });
    const adjusted = applyScoreAdjustments(llmScores, mods);
    const dw = adjusted.find(s => s.dimension === "Pump/Dewatering")!;
    expect(dw.score).toBeGreaterThan(40);
  });

  it("keeps Portable Air moderate for solar farm", () => {
    const mods = computeScoreModifiers(
      "Solar Farm",
      "200MW solar farm with battery storage.",
      null,
      "Construction",
    );
    const llmScores = makeLLMScores({ "Portable Air": 50 });
    const adjusted = applyScoreAdjustments(llmScores, mods);
    const pa = adjusted.find(s => s.dimension === "Portable Air")!;
    // Should be reduced or unchanged — no compressed air activities
    expect(pa.score).toBeLessThanOrEqual(50);
  });
});

// ── Integration Scenario Tests ──

describe("Activity Signal Layer — real-world scenarios", () => {
  it("underground gold mine: high Portable Air, high Dewatering", () => {
    const mods = computeScoreModifiers(
      "Cadia East Underground Expansion",
      "Underground gold mine expansion with sublevel caving, decline development, drill and blast operations. High groundwater inflow requiring extensive dewatering.",
      ["compressor", "dewatering pump", "ventilation"],
      "Construction",
    );
    expect(mods.adjustments["Portable Air"]).toBeGreaterThan(0);
    expect(mods.adjustments["Pump/Dewatering"]).toBeGreaterThan(0);
    expect(mods.stageWeight).toBe("boost");
  });

  it("gas pipeline: high Nitrogen, high Booster, moderate Portable Air", () => {
    const mods = computeScoreModifiers(
      "Northern Gas Pipeline Stage 2",
      "622km gas pipeline construction including pipe laying, welding, hydrotest, and nitrogen purge.",
      null,
      "Construction",
    );
    expect(mods.adjustments["Nitrogen"]).toBeGreaterThan(0);
    expect(mods.adjustments["Booster"]).toBeGreaterThan(0);
    // Portable Air should be moderate (pipeline construction has some, but not dominant)
    expect(mods.adjustments["Portable Air"]).toBeLessThan(mods.adjustments["Nitrogen"]);
  });

  it("wind farm: high BESS, low Portable Air", () => {
    const mods = computeScoreModifiers(
      "MacIntyre Wind Farm",
      "Construction of 923MW wind farm with 180 wind turbines and battery storage system.",
      null,
      "Construction",
    );
    expect(mods.adjustments["BESS"]).toBeGreaterThan(0);
    expect(mods.adjustments["Portable Air"]).toBeLessThanOrEqual(0);
  });

  it("refinery shutdown: high Rental, high Service", () => {
    const mods = computeScoreModifiers(
      "Kwinana Refinery Turnaround",
      "Major planned shutdown turnaround of refinery units including equipment overhaul and maintenance.",
      null,
      "Execution",
    );
    expect(mods.adjustments["Rental Influence"]).toBeGreaterThan(0);
    expect(mods.adjustments["Service Potential"]).toBeGreaterThan(0);
  });

  it("early-stage exploration: all scores reduced", () => {
    const mods = computeScoreModifiers(
      "Greenfield Exploration",
      "Early-stage exploration drilling to assess mineral potential.",
      null,
      "Exploration",
    );
    expect(mods.stageWeight).toBe("reduce");
    // Drilling is detected but stage reduces the boost
    const paAdj = mods.adjustments["Portable Air"];
    // Should be less than what a construction-stage drilling project would get
    const constructionMods = computeScoreModifiers(
      "Greenfield Drilling",
      "Active drilling program.",
      null,
      "Construction",
    );
    expect(paAdj).toBeLessThan(constructionMods.adjustments["Portable Air"]);
  });

  it("dam construction: high Dewatering, moderate Portable Air", () => {
    const mods = computeScoreModifiers(
      "Tailings Storage Facility",
      "Construction of new tailings dam with embankment wall and spillway. Significant groundwater management required.",
      null,
      "Construction",
    );
    expect(mods.adjustments["Pump/Dewatering"]).toBeGreaterThan(0);
    expect(mods.adjustments["Pump/Dewatering"]).toBeGreaterThan(mods.adjustments["Portable Air"]);
  });

  it("remote mine camp: high Generators, high PAL", () => {
    const mods = computeScoreModifiers(
      "Remote Mining Camp",
      "Fly in fly out accommodation village construction at remote site in the Pilbara.",
      null,
      "Construction",
    );
    expect(mods.adjustments["Generators"]).toBeGreaterThan(0);
    expect(mods.adjustments["PAL"]).toBeGreaterThan(0);
  });
});
