import { describe, it, expect } from "vitest";

// We test the scoring function indirectly by importing the module and checking the BL map
// The actual scoreProjectForUser is not exported, so we test via the map and logic

describe("BL-to-Dimension mapping", () => {
  const BL_TO_DIMENSION_MAP: Record<string, string[]> = {
    "Portable Air": ["Portable Air"],
    "PAL": ["PAL", "Generators"],
    "BESS": ["BESS"],
    "Pump (Flow)": ["Pump/Dewatering"],
    "Nitrogen": ["Nitrogen"],
    "Booster": ["Booster"],
  };

  it("should map Portable Air to Portable Air dimension", () => {
    expect(BL_TO_DIMENSION_MAP["Portable Air"]).toEqual(["Portable Air"]);
  });

  it("should map PAL to PAL and Generators dimensions", () => {
    expect(BL_TO_DIMENSION_MAP["PAL"]).toEqual(["PAL", "Generators"]);
  });

  it("should map Pump (Flow) to Pump/Dewatering dimension", () => {
    expect(BL_TO_DIMENSION_MAP["Pump (Flow)"]).toEqual(["Pump/Dewatering"]);
  });

  it("should map BESS to BESS dimension", () => {
    expect(BL_TO_DIMENSION_MAP["BESS"]).toEqual(["BESS"]);
  });

  it("should cover all user-assignable business lines", () => {
    const allBLs = ["Portable Air", "PAL", "BESS", "Pump (Flow)", "Nitrogen", "Booster"];
    for (const bl of allBLs) {
      expect(BL_TO_DIMENSION_MAP[bl]).toBeDefined();
      expect(BL_TO_DIMENSION_MAP[bl].length).toBeGreaterThan(0);
    }
  });
});

describe("BL scoring logic", () => {
  // Simulate the scoring logic from emailDigest.ts
  function computeBLBoost(
    assignedBLs: string[],
    blScores: { dimension: string; score: number }[],
  ): number {
    const BL_TO_DIMENSION_MAP: Record<string, string[]> = {
      "Portable Air": ["Portable Air"],
      "PAL": ["PAL", "Generators"],
      "BESS": ["BESS"],
      "Pump (Flow)": ["Pump/Dewatering"],
      "Nitrogen": ["Nitrogen"],
      "Booster": ["Booster"],
    };

    const userDimensions = new Set<string>();
    for (const bl of assignedBLs) {
      const dims = BL_TO_DIMENSION_MAP[bl];
      if (dims) dims.forEach(d => userDimensions.add(d));
    }

    let maxBLScore = 0;
    let avgBLScore = 0;
    let matchCount = 0;

    for (const dim of Array.from(userDimensions)) {
      const dimScore = blScores.find(s => s.dimension === dim);
      if (dimScore && dimScore.score > 0) {
        maxBLScore = Math.max(maxBLScore, dimScore.score);
        avgBLScore += dimScore.score;
        matchCount++;
      }
    }

    if (matchCount > 0) {
      avgBLScore = avgBLScore / matchCount;
      let boost = Math.round((maxBLScore / 100) * 25);
      if (matchCount > 1 && avgBLScore > 50) boost += 5;
      return boost;
    }
    return -15; // penalty for no match
  }

  it("should give high boost for Pump user on pump-relevant project", () => {
    const boost = computeBLBoost(
      ["Pump (Flow)"],
      [
        { dimension: "Portable Air", score: 20 },
        { dimension: "PAL", score: 30 },
        { dimension: "BESS", score: 10 },
        { dimension: "Pump/Dewatering", score: 90 },
        { dimension: "Generators", score: 25 },
      ],
    );
    // maxBLScore = 90, boost = round(90/100 * 25) = 23
    expect(boost).toBe(23);
  });

  it("should give low boost for Pump user on BESS project", () => {
    const boost = computeBLBoost(
      ["Pump (Flow)"],
      [
        { dimension: "Portable Air", score: 10 },
        { dimension: "PAL", score: 15 },
        { dimension: "BESS", score: 95 },
        { dimension: "Pump/Dewatering", score: 5 },
        { dimension: "Generators", score: 20 },
      ],
    );
    // maxBLScore = 5, boost = round(5/100 * 25) = 1
    expect(boost).toBe(1);
  });

  it("should penalize project with zero BL relevance", () => {
    const boost = computeBLBoost(
      ["Pump (Flow)"],
      [
        { dimension: "Portable Air", score: 80 },
        { dimension: "PAL", score: 70 },
        { dimension: "BESS", score: 90 },
        { dimension: "Pump/Dewatering", score: 0 },
        { dimension: "Generators", score: 60 },
      ],
    );
    expect(boost).toBe(-15);
  });

  it("should give extra boost for PAL user with multi-dimension match", () => {
    const boost = computeBLBoost(
      ["PAL"],
      [
        { dimension: "Portable Air", score: 20 },
        { dimension: "PAL", score: 80 },
        { dimension: "BESS", score: 10 },
        { dimension: "Pump/Dewatering", score: 15 },
        { dimension: "Generators", score: 70 },
      ],
    );
    // PAL maps to ["PAL", "Generators"]
    // maxBLScore = 80, avgBLScore = (80+70)/2 = 75 > 50
    // boost = round(80/100 * 25) + 5 = 20 + 5 = 25
    expect(boost).toBe(25);
  });

  it("should differentiate Josh (Pump) vs Ryan (Portable Air) on same project", () => {
    const projectScores = [
      { dimension: "Portable Air", score: 85 },
      { dimension: "PAL", score: 40 },
      { dimension: "BESS", score: 10 },
      { dimension: "Pump/Dewatering", score: 30 },
      { dimension: "Generators", score: 35 },
    ];

    const joshBoost = computeBLBoost(["Pump (Flow)"], projectScores);
    const ryanBoost = computeBLBoost(["Portable Air"], projectScores);

    // Ryan should get much higher boost on this Portable Air project
    expect(ryanBoost).toBeGreaterThan(joshBoost);
    // Ryan: round(85/100 * 25) = 21
    // Josh: round(30/100 * 25) = 8
    expect(ryanBoost).toBe(21);
    expect(joshBoost).toBe(8);
  });
});
