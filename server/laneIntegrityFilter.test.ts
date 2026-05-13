/**
 * Lane-integrity post-filter tests (guardrail 4b)
 *
 * Tests resolveRepLaneCategory() and the lane-exclusion logic that prevents
 * BESS/PAL/pump projects leaking into PA-only rep digests and vice-versa.
 */
import { describe, it, expect } from "vitest";
import { resolveRepLaneCategory } from "./laneScoring";

// ── resolveRepLaneCategory ──────────────────────────────────────────────────

describe("resolveRepLaneCategory", () => {
  // PA-only reps
  it("returns portableAir for Ryan Pemberton (Portable Air BL)", () => {
    expect(resolveRepLaneCategory(["Portable Air"])).toBe("portableAir");
  });

  it("returns portableAir for Daniel Zec (Portable Air BL)", () => {
    expect(resolveRepLaneCategory(["Portable Air"])).toBe("portableAir");
  });

  it("returns portableAir for Leo Williams (Portable Air BL)", () => {
    expect(resolveRepLaneCategory(["Portable Air"])).toBe("portableAir");
  });

  it("returns portableAir for PA rep with PT Capital Sales (unmapped BL ignored)", () => {
    // PT Capital Sales is not in BL_TO_LANE_KEY — treated as unmapped
    // Combined with Portable Air → portableAir wins (only mapped key)
    expect(resolveRepLaneCategory(["Portable Air", "PT Capital Sales"])).toBe("portableAir");
  });

  // Pump-only reps (by BL)
  it("returns pump for Dan Day (Pump (Flow) + Dewatering Pumps)", () => {
    expect(resolveRepLaneCategory(["Pump (Flow)", "Dewatering Pumps"])).toBe("pump");
  });

  it("returns pump for rep with Dewatering Pumps only", () => {
    expect(resolveRepLaneCategory(["Dewatering Pumps"])).toBe("pump");
  });

  // Brett Hansen — rep-name override forces pump regardless of BL metadata
  it("returns pump for Brett Hansen via repNameOverride (mixed BLs)", () => {
    expect(resolveRepLaneCategory(["Portable Air", "Pump (Flow)"], "Brett Hansen")).toBe("pump");
  });

  it("returns pump for Brett Hansen via repNameOverride (PA-only BLs)", () => {
    expect(resolveRepLaneCategory(["Portable Air"], "brett hansen")).toBe("pump");
  });

  it("returns pump for Brett Hansen via repNameOverride (no BLs)", () => {
    expect(resolveRepLaneCategory([], "Brett Hansen")).toBe("pump");
  });

  // PAL/BESS rep (Amit)
  it("returns palBess for Amit Bhargava (PAL + BESS BLs)", () => {
    expect(resolveRepLaneCategory(["PAL", "BESS"])).toBe("palBess");
  });

  it("returns palBess for rep with BESS only", () => {
    expect(resolveRepLaneCategory(["BESS"])).toBe("palBess");
  });

  it("returns palBess for rep with PAL only", () => {
    expect(resolveRepLaneCategory(["PAL"])).toBe("palBess");
  });

  // Mixed-lane reps
  it("returns mixed for rep with both Portable Air and Pump (Flow)", () => {
    expect(resolveRepLaneCategory(["Portable Air", "Pump (Flow)"])).toBe("mixed");
  });

  it("returns mixed for rep with no BLs", () => {
    expect(resolveRepLaneCategory([])).toBe("mixed");
  });

  it("returns mixed for rep with only unmapped BLs (PT Capital Sales)", () => {
    expect(resolveRepLaneCategory(["PT Capital Sales"])).toBe("mixed");
  });
});

// ── Lane exclusion logic (inline simulation of the post-filter) ─────────────

/**
 * Simulates the lane-integrity post-filter from scoreAndFilterProjects().
 * Returns true if the project passes the filter for the given rep lane category.
 */
function passesLaneFilter(
  productLane: string | null | undefined,
  repLaneCategory: 'portableAir' | 'pump' | 'palBess' | 'mixed',
): boolean {
  const LANE_EXCLUSIONS_PA   = new Set(['bess', 'pal', 'pumps']);
  const LANE_EXCLUSIONS_PUMP = new Set(['bess', 'pal', 'portable_air']);
  const lane = (productLane || '').toLowerCase().trim();
  if (!lane || lane === 'null' || lane === 'unknown' || lane === 'multi_lane_pt') return true;
  if (repLaneCategory === 'portableAir' && LANE_EXCLUSIONS_PA.has(lane)) return false;
  if (repLaneCategory === 'pump'        && LANE_EXCLUSIONS_PUMP.has(lane)) return false;
  return true;
}

describe("lane-integrity post-filter exclusions", () => {
  // PA-only rep exclusions
  it("PA rep: excludes bess projects", () => {
    expect(passesLaneFilter("bess", "portableAir")).toBe(false);
  });
  it("PA rep: excludes pal projects", () => {
    expect(passesLaneFilter("pal", "portableAir")).toBe(false);
  });
  it("PA rep: excludes pumps projects", () => {
    expect(passesLaneFilter("pumps", "portableAir")).toBe(false);
  });
  it("PA rep: keeps portable_air projects", () => {
    expect(passesLaneFilter("portable_air", "portableAir")).toBe(true);
  });
  it("PA rep: keeps multi_lane_pt projects", () => {
    expect(passesLaneFilter("multi_lane_pt", "portableAir")).toBe(true);
  });
  it("PA rep: keeps null productLane", () => {
    expect(passesLaneFilter(null, "portableAir")).toBe(true);
  });
  it("PA rep: keeps unknown productLane", () => {
    expect(passesLaneFilter("unknown", "portableAir")).toBe(true);
  });

  // Pump-only rep exclusions
  it("Pump rep: excludes bess projects", () => {
    expect(passesLaneFilter("bess", "pump")).toBe(false);
  });
  it("Pump rep: excludes pal projects", () => {
    expect(passesLaneFilter("pal", "pump")).toBe(false);
  });
  it("Pump rep: excludes portable_air projects", () => {
    expect(passesLaneFilter("portable_air", "pump")).toBe(false);
  });
  it("Pump rep: keeps pumps projects", () => {
    expect(passesLaneFilter("pumps", "pump")).toBe(true);
  });
  it("Pump rep: keeps multi_lane_pt projects", () => {
    expect(passesLaneFilter("multi_lane_pt", "pump")).toBe(true);
  });
  it("Pump rep: keeps null productLane", () => {
    expect(passesLaneFilter(null, "pump")).toBe(true);
  });

  // PAL/BESS rep — no exclusions
  it("palBess rep: keeps bess projects", () => {
    expect(passesLaneFilter("bess", "palBess")).toBe(true);
  });
  it("palBess rep: keeps pal projects", () => {
    expect(passesLaneFilter("pal", "palBess")).toBe(true);
  });
  it("palBess rep: keeps portable_air projects", () => {
    expect(passesLaneFilter("portable_air", "palBess")).toBe(true);
  });
  it("palBess rep: keeps pumps projects", () => {
    expect(passesLaneFilter("pumps", "palBess")).toBe(true);
  });

  // Mixed-lane rep — no exclusions
  it("mixed rep: keeps all lane types", () => {
    expect(passesLaneFilter("bess", "mixed")).toBe(true);
    expect(passesLaneFilter("pal", "mixed")).toBe(true);
    expect(passesLaneFilter("pumps", "mixed")).toBe(true);
    expect(passesLaneFilter("portable_air", "mixed")).toBe(true);
  });
});
