/**
 * PT Capital Sales Sprint — Vitest Test Suite
 *
 * Covers:
 *  1. classifyProductLaneFromScores — all 5 lane outputs + null
 *  2. normalizeStageCode — key patterns for stageCode normalisation
 *  3. Email digest lane grouping logic (pure function simulation)
 *  4. Contact-discovery-needed state (hasNoContacts flag)
 */

import { describe, it, expect } from "vitest";
import { classifyProductLaneFromScores, DIMENSION_TO_LANE, normalizeStageCode } from "./db";

// ─────────────────────────────────────────────────────────────────────────────
// 1. DIMENSION_TO_LANE map
// ─────────────────────────────────────────────────────────────────────────────

describe("DIMENSION_TO_LANE", () => {
  it("maps Portable Air → portable_air", () => {
    expect(DIMENSION_TO_LANE["Portable Air"]).toBe("portable_air");
  });

  it("maps Pump/Dewatering → pumps", () => {
    expect(DIMENSION_TO_LANE["Pump/Dewatering"]).toBe("pumps");
  });

  it("maps Generators → pal", () => {
    expect(DIMENSION_TO_LANE["Generators"]).toBe("pal");
  });

  it("maps BESS → bess", () => {
    expect(DIMENSION_TO_LANE["BESS"]).toBe("bess");
  });

  it("does not map non-PT dimensions", () => {
    expect(DIMENSION_TO_LANE["Service Potential"]).toBeUndefined();
    expect(DIMENSION_TO_LANE["Rental Influence"]).toBeUndefined();
    expect(DIMENSION_TO_LANE["Booster"]).toBeUndefined();
    expect(DIMENSION_TO_LANE["Nitrogen"]).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. classifyProductLaneFromScores
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyProductLaneFromScores", () => {
  // ── Null / unclassifiable ──────────────────────────────────────────────────

  it("returns null when no PT dimension scores are present", () => {
    expect(classifyProductLaneFromScores({})).toBeNull();
  });

  it("returns null when all PT dimension scores are below 30", () => {
    expect(classifyProductLaneFromScores({ "Portable Air": 20, "Pump/Dewatering": 10 })).toBeNull();
  });

  it("returns null when top score is exactly 29", () => {
    expect(classifyProductLaneFromScores({ "Portable Air": 29 })).toBeNull();
  });

  it("returns null when only non-PT dimensions are present", () => {
    expect(classifyProductLaneFromScores({ "Service Potential": 80, "Rental Influence": 70 })).toBeNull();
  });

  // ── Single-lane clear winner ───────────────────────────────────────────────

  it("returns portable_air when Portable Air dominates by ≥ 15 points", () => {
    expect(classifyProductLaneFromScores({ "Portable Air": 75, "Pump/Dewatering": 50 })).toBe("portable_air");
  });

  it("returns portable_air when Portable Air is the only PT dimension ≥ 30", () => {
    expect(classifyProductLaneFromScores({ "Portable Air": 60 })).toBe("portable_air");
  });

  it("returns pumps when Pump/Dewatering dominates by ≥ 15 points", () => {
    expect(classifyProductLaneFromScores({ "Pump/Dewatering": 80, "Portable Air": 30 })).toBe("pumps");
  });

  it("returns pumps when Pump/Dewatering is the only PT dimension ≥ 30", () => {
    expect(classifyProductLaneFromScores({ "Pump/Dewatering": 55 })).toBe("pumps");
  });

  it("returns pal when Generators dominates by ≥ 15 points", () => {
    expect(classifyProductLaneFromScores({ "Generators": 70, "BESS": 40 })).toBe("pal");
  });

  it("returns pal when Generators is the only PT dimension ≥ 30", () => {
    expect(classifyProductLaneFromScores({ "Generators": 45 })).toBe("pal");
  });

  it("returns bess when BESS dominates by ≥ 15 points", () => {
    expect(classifyProductLaneFromScores({ "BESS": 90, "Portable Air": 50 })).toBe("bess");
  });

  it("returns bess when BESS is the only PT dimension ≥ 30", () => {
    expect(classifyProductLaneFromScores({ "BESS": 65 })).toBe("bess");
  });

  // ── Multi-lane PT ──────────────────────────────────────────────────────────

  it("returns multi_lane_pt when top two lanes are both ≥ 40 and within 15 points", () => {
    expect(classifyProductLaneFromScores({ "Portable Air": 60, "Pump/Dewatering": 55 })).toBe("multi_lane_pt");
  });

  it("returns multi_lane_pt when top two lanes are both exactly 40", () => {
    expect(classifyProductLaneFromScores({ "BESS": 40, "Generators": 40 })).toBe("multi_lane_pt");
  });

  it("returns multi_lane_pt when three lanes all score ≥ 40", () => {
    expect(classifyProductLaneFromScores({
      "Portable Air": 70,
      "Pump/Dewatering": 65,
      "BESS": 60,
    })).toBe("multi_lane_pt");
  });

  it("returns multi_lane_pt when gap is exactly 14 (< 15) and both ≥ 40", () => {
    expect(classifyProductLaneFromScores({ "Portable Air": 54, "BESS": 40 })).toBe("multi_lane_pt");
  });

  it("returns single lane when gap is exactly 15 (≥ 15)", () => {
    expect(classifyProductLaneFromScores({ "Portable Air": 55, "BESS": 40 })).toBe("portable_air");
  });

  it("returns multi_lane_pt when top score < 40 but gap < 15 and both ≥ 30", () => {
    // topScore=35, secondScore=30, gap=5 → neither ≥40 so multi_lane_pt via fallback
    expect(classifyProductLaneFromScores({ "Portable Air": 35, "Pump/Dewatering": 30 })).toBe("multi_lane_pt");
  });

  // ── Non-PT dimensions are ignored ─────────────────────────────────────────

  it("ignores non-PT dimensions when classifying", () => {
    const scores = {
      "Portable Air": 60,
      "Service Potential": 95,
      "Rental Influence": 80,
      "Nitrogen": 75,
    };
    expect(classifyProductLaneFromScores(scores)).toBe("portable_air");
  });

  it("uses max score when same dimension appears multiple times (via map)", () => {
    // The function uses Math.max, so duplicate keys are resolved by the last write
    // but in practice the map already deduplicates; test the normal case
    expect(classifyProductLaneFromScores({ "BESS": 70, "Generators": 30 })).toBe("bess");
  });

  // ── Boundary: exactly 30 ──────────────────────────────────────────────────

  it("returns a lane when top score is exactly 30 and it is the only lane", () => {
    expect(classifyProductLaneFromScores({ "Portable Air": 30 })).toBe("portable_air");
  });

  it("returns multi_lane_pt when both lanes are exactly 30 (gap = 0 < 15)", () => {
    expect(classifyProductLaneFromScores({ "Portable Air": 30, "Pump/Dewatering": 30 })).toBe("multi_lane_pt");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. normalizeStageCode — PT Capital Sales sprint stageCode normalisation
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeStageCode — PT Capital Sales sprint patterns", () => {
  // ── Terminal states ────────────────────────────────────────────────────────
  it("maps 'cancelled' → cancelled", () => {
    expect(normalizeStageCode("cancelled").code).toBe("cancelled");
  });

  it("maps 'decommissioned' → cancelled", () => {
    expect(normalizeStageCode("decommissioned").code).toBe("cancelled");
  });

  it("maps 'withdrawn' → cancelled", () => {
    expect(normalizeStageCode("withdrawn").code).toBe("cancelled");
  });

  it("maps 'closed' → cancelled", () => {
    expect(normalizeStageCode("closed").code).toBe("cancelled");
  });

  it("does not map 'close to completion' → cancelled", () => {
    expect(normalizeStageCode("close to completion").code).not.toBe("cancelled");
  });

  it("maps 'completed' → completed", () => {
    expect(normalizeStageCode("completed").code).toBe("completed");
  });

  it("maps 'fully completed' → completed", () => {
    expect(normalizeStageCode("fully completed").code).toBe("completed");
  });

  it("maps 'commissioned' → commissioning", () => {
    expect(normalizeStageCode("commissioned").code).toBe("commissioning");
  });

  it("maps 'commissioning' → commissioning", () => {
    expect(normalizeStageCode("commissioning").code).toBe("commissioning");
  });

  // ── Operational ────────────────────────────────────────────────────────────
  it("maps 'operational' → operational", () => {
    expect(normalizeStageCode("operational").code).toBe("operational");
  });

  it("maps 'operating' → operational", () => {
    expect(normalizeStageCode("operating").code).toBe("operational");
  });

  it("maps 'ramp-up' → operational", () => {
    expect(normalizeStageCode("ramp-up").code).toBe("operational");
  });

  // ── Construction ───────────────────────────────────────────────────────────
  it("maps 'under construction' → construction", () => {
    expect(normalizeStageCode("under construction").code).toBe("construction");
  });

  it("maps 'construction commenced' → construction", () => {
    expect(normalizeStageCode("construction commenced").code).toBe("construction");
  });

  it("maps 'construction underway' → construction", () => {
    expect(normalizeStageCode("construction underway").code).toBe("construction");
  });

  it("maps 'underway' → construction", () => {
    expect(normalizeStageCode("underway").code).toBe("construction");
  });

  it("maps 'tunnelling' → construction", () => {
    expect(normalizeStageCode("tunnelling").code).toBe("construction");
  });

  // ── Awarded ────────────────────────────────────────────────────────────────
  it("maps 'awarded' → awarded", () => {
    expect(normalizeStageCode("awarded").code).toBe("awarded");
  });

  it("maps 'contract award' → awarded", () => {
    expect(normalizeStageCode("contract award").code).toBe("awarded");
  });

  it("maps 'contract signed' → awarded", () => {
    expect(normalizeStageCode("contract signed").code).toBe("awarded");
  });

  // ── Procurement ────────────────────────────────────────────────────────────
  it("maps 'procurement' → procurement", () => {
    expect(normalizeStageCode("procurement").code).toBe("procurement");
  });

  it("maps 'tendering' → procurement", () => {
    expect(normalizeStageCode("tendering").code).toBe("procurement");
  });

  it("maps 'tender' → procurement", () => {
    expect(normalizeStageCode("tender").code).toBe("procurement");
  });

  // ── Design ─────────────────────────────────────────────────────────────────
  it("maps 'design' → design", () => {
    expect(normalizeStageCode("design").code).toBe("design");
  });

  // ── Planning ───────────────────────────────────────────────────────────────
  it("maps 'planning' → planning", () => {
    expect(normalizeStageCode("planning").code).toBe("planning");
  });

  it("maps 'pre-construction' → planning", () => {
    expect(normalizeStageCode("pre-construction").code).toBe("planning");
  });

  it("maps 'early works' → planning", () => {
    expect(normalizeStageCode("early works").code).toBe("planning");
  });

  it("maps 'development' → planning", () => {
    expect(normalizeStageCode("development").code).toBe("planning");
  });

  it("maps 'funding secured' → planning", () => {
    expect(normalizeStageCode("funding secured").code).toBe("planning");
  });

  // ── Feasibility ────────────────────────────────────────────────────────────
  it("maps 'feasibility' → feasibility", () => {
    expect(normalizeStageCode("feasibility").code).toBe("feasibility");
  });

  it("maps 'pre-feasibility' → feasibility", () => {
    expect(normalizeStageCode("pre-feasibility").code).toBe("feasibility");
  });

  it("maps 'environmental assessment' → feasibility", () => {
    expect(normalizeStageCode("environmental assessment").code).toBe("feasibility");
  });

  it("maps 'proposed' → feasibility", () => {
    expect(normalizeStageCode("proposed").code).toBe("feasibility");
  });

  it("maps 'concept' → feasibility", () => {
    expect(normalizeStageCode("concept").code).toBe("feasibility");
  });

  // ── Exploration ────────────────────────────────────────────────────────────
  it("maps 'exploration' → exploration", () => {
    expect(normalizeStageCode("exploration").code).toBe("exploration");
  });

  it("maps 'drilling' → exploration", () => {
    expect(normalizeStageCode("drilling").code).toBe("exploration");
  });

  it("maps 'spudded' → exploration", () => {
    expect(normalizeStageCode("spudded").code).toBe("exploration");
  });

  // ── Fallback ───────────────────────────────────────────────────────────────
  it("returns unknown for empty string", () => {
    expect(normalizeStageCode("").code).toBe("unknown");
  });

  it("returns unknown for null", () => {
    expect(normalizeStageCode(null).code).toBe("unknown");
  });

  it("returns unknown for unrecognised text", () => {
    expect(normalizeStageCode("miscellaneous status").code).toBe("unknown");
  });

  // ── Confidence values ──────────────────────────────────────────────────────
  it("returns high confidence (≥ 0.85) for 'under construction'", () => {
    expect(normalizeStageCode("under construction").confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("returns high confidence (≥ 0.85) for 'feasibility'", () => {
    expect(normalizeStageCode("feasibility").confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("returns low confidence (0.3) for unknown/null", () => {
    expect(normalizeStageCode(null).confidence).toBe(0.3);
    expect(normalizeStageCode("").confidence).toBe(0.3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Email digest lane grouping logic (pure simulation)
// ─────────────────────────────────────────────────────────────────────────────

describe("Email digest lane grouping", () => {
  type DigestProject = {
    id: number;
    name: string;
    productLane?: string | null;
    hasNoContacts?: boolean;
  };

  /**
   * Simulates the lane grouping logic from emailDigest.ts.
   * Groups projects by productLane, defaulting to 'multi_lane_pt' if null/undefined.
   */
  function groupByLane(projects: DigestProject[]): Record<string, DigestProject[]> {
    const groups: Record<string, DigestProject[]> = {};
    for (const p of projects) {
      const lane = p.productLane || "multi_lane_pt";
      if (!groups[lane]) groups[lane] = [];
      groups[lane].push(p);
    }
    return groups;
  }

  const LANE_ORDER = ["portable_air", "pumps", "pal", "bess", "multi_lane_pt"];

  it("groups projects by their productLane", () => {
    const projects: DigestProject[] = [
      { id: 1, name: "Mine A", productLane: "portable_air" },
      { id: 2, name: "Pump B", productLane: "pumps" },
      { id: 3, name: "BESS C", productLane: "bess" },
    ];
    const groups = groupByLane(projects);
    expect(groups["portable_air"]).toHaveLength(1);
    expect(groups["pumps"]).toHaveLength(1);
    expect(groups["bess"]).toHaveLength(1);
  });

  it("assigns null productLane projects to multi_lane_pt group", () => {
    const projects: DigestProject[] = [
      { id: 1, name: "Unknown Lane", productLane: null },
      { id: 2, name: "Also Unknown", productLane: undefined },
    ];
    const groups = groupByLane(projects);
    expect(groups["multi_lane_pt"]).toHaveLength(2);
  });

  it("assigns multi_lane_pt projects to the multi_lane_pt group", () => {
    const projects: DigestProject[] = [
      { id: 1, name: "Multi A", productLane: "multi_lane_pt" },
    ];
    const groups = groupByLane(projects);
    expect(groups["multi_lane_pt"]).toHaveLength(1);
  });

  it("handles all 5 lanes simultaneously", () => {
    const projects: DigestProject[] = [
      { id: 1, name: "PA", productLane: "portable_air" },
      { id: 2, name: "Pumps", productLane: "pumps" },
      { id: 3, name: "PAL", productLane: "pal" },
      { id: 4, name: "BESS", productLane: "bess" },
      { id: 5, name: "Multi", productLane: "multi_lane_pt" },
    ];
    const groups = groupByLane(projects);
    for (const lane of LANE_ORDER) {
      expect(groups[lane]).toHaveLength(1);
    }
  });

  it("renders lanes in the correct order", () => {
    const projects: DigestProject[] = [
      { id: 1, name: "Multi", productLane: "multi_lane_pt" },
      { id: 2, name: "BESS", productLane: "bess" },
      { id: 3, name: "PA", productLane: "portable_air" },
    ];
    const groups = groupByLane(projects);
    const renderedOrder = LANE_ORDER.filter(lane => groups[lane] && groups[lane].length > 0);
    expect(renderedOrder).toEqual(["portable_air", "bess", "multi_lane_pt"]);
  });

  it("produces an empty group map for an empty project list", () => {
    expect(groupByLane([])).toEqual({});
  });

  it("groups multiple projects in the same lane together", () => {
    const projects: DigestProject[] = [
      { id: 1, name: "BESS A", productLane: "bess" },
      { id: 2, name: "BESS B", productLane: "bess" },
      { id: 3, name: "BESS C", productLane: "bess" },
    ];
    const groups = groupByLane(projects);
    expect(groups["bess"]).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Contact-discovery-needed state (hasNoContacts flag)
// ─────────────────────────────────────────────────────────────────────────────

describe("Contact-discovery-needed state", () => {
  type DigestProject = {
    id: number;
    name: string;
    hasNoContacts?: boolean;
  };

  /**
   * Simulates the contact-discovery-needed rendering logic from emailDigest.ts.
   * Returns the advisory text if hasNoContacts is true.
   */
  function renderContactState(p: DigestProject): string {
    if (p.hasNoContacts) {
      return "⚠️ Stakeholder discovery needed — no high-relevance contacts found yet\n→ Recommended next step: contractor discovery / owner-side stakeholder search";
    }
    return "";
  }

  it("renders the stakeholder discovery message when hasNoContacts is true", () => {
    const output = renderContactState({ id: 1, name: "Project X", hasNoContacts: true });
    expect(output).toContain("Stakeholder discovery needed");
    expect(output).toContain("no high-relevance contacts found yet");
  });

  it("includes the recommended next step when hasNoContacts is true", () => {
    const output = renderContactState({ id: 1, name: "Project X", hasNoContacts: true });
    expect(output).toContain("contractor discovery");
    expect(output).toContain("owner-side stakeholder search");
  });

  it("renders nothing when hasNoContacts is false", () => {
    const output = renderContactState({ id: 1, name: "Project Y", hasNoContacts: false });
    expect(output).toBe("");
  });

  it("renders nothing when hasNoContacts is undefined", () => {
    const output = renderContactState({ id: 1, name: "Project Z" });
    expect(output).toBe("");
  });

  it("renders the advisory for every project with hasNoContacts=true in a list", () => {
    const projects: DigestProject[] = [
      { id: 1, name: "No Contact A", hasNoContacts: true },
      { id: 2, name: "Has Contact B", hasNoContacts: false },
      { id: 3, name: "No Contact C", hasNoContacts: true },
    ];
    const outputs = projects.map(renderContactState);
    expect(outputs[0]).toContain("Stakeholder discovery needed");
    expect(outputs[1]).toBe("");
    expect(outputs[2]).toContain("Stakeholder discovery needed");
  });
});
