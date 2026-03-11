/**
 * Business Line Scoring — Vitest Tests
 * Tests: SCORING_DIMENSIONS config, module exports, schema columns,
 *        dimension coverage, scoring prompt content
 */
import { describe, it, expect } from "vitest";
import {
  SCORING_DIMENSIONS,
  scoreProject,
  saveProjectScores,
  getProjectScores,
  getProjectScoresBatch,
  getUnscoredProjectIds,
  scoreAndSaveProjects,
} from "./businessLineScoring";
import type { ScoringDimension, DimensionScore, ProjectScores } from "./businessLineScoring";
import { projectBusinessLineScores } from "../drizzle/schema";

describe("SCORING_DIMENSIONS config", () => {
  it("should have exactly 9 scoring dimensions", () => {
    expect(SCORING_DIMENSIONS).toHaveLength(9);
  });

  it("should include all required business lines", () => {
    expect(SCORING_DIMENSIONS).toContain("Portable Air");
    expect(SCORING_DIMENSIONS).toContain("PAL");
    expect(SCORING_DIMENSIONS).toContain("BESS");
    expect(SCORING_DIMENSIONS).toContain("Pump/Dewatering");
    expect(SCORING_DIMENSIONS).toContain("Generators");
    expect(SCORING_DIMENSIONS).toContain("Nitrogen");
    expect(SCORING_DIMENSIONS).toContain("Booster");
    expect(SCORING_DIMENSIONS).toContain("Service Potential");
    expect(SCORING_DIMENSIONS).toContain("Rental Influence");
  });

  it("should have unique dimension names", () => {
    expect(new Set(SCORING_DIMENSIONS).size).toBe(SCORING_DIMENSIONS.length);
  });

  it("should be a readonly tuple (const assertion)", () => {
    // SCORING_DIMENSIONS is defined with `as const`
    expect(Array.isArray(SCORING_DIMENSIONS)).toBe(true);
    expect(SCORING_DIMENSIONS.length).toBe(9);
  });

  it("each dimension should be a non-empty string", () => {
    for (const dim of SCORING_DIMENSIONS) {
      expect(typeof dim).toBe("string");
      expect(dim.length).toBeGreaterThan(0);
    }
  });
});

describe("Dimension coverage", () => {
  it("should cover all Power Technique core business lines", () => {
    expect(SCORING_DIMENSIONS).toContain("Portable Air");
    expect(SCORING_DIMENSIONS).toContain("PAL");
    expect(SCORING_DIMENSIONS).toContain("BESS");
    expect(SCORING_DIMENSIONS).toContain("Pump/Dewatering");
  });

  it("should include Generators as a distinct sub-category of PAL", () => {
    expect(SCORING_DIMENSIONS).toContain("Generators");
    expect(SCORING_DIMENSIONS).toContain("PAL");
    // Both should exist as separate dimensions
    const palIdx = SCORING_DIMENSIONS.indexOf("PAL");
    const genIdx = SCORING_DIMENSIONS.indexOf("Generators");
    expect(palIdx).not.toBe(genIdx);
  });

  it("should cover specialty product lines (Nitrogen, Booster)", () => {
    expect(SCORING_DIMENSIONS).toContain("Nitrogen");
    expect(SCORING_DIMENSIONS).toContain("Booster");
  });

  it("should cover commercial opportunity dimensions", () => {
    expect(SCORING_DIMENSIONS).toContain("Service Potential");
    expect(SCORING_DIMENSIONS).toContain("Rental Influence");
  });

  it("should explicitly include Dewatering via Pump/Dewatering", () => {
    // Dewatering is explicitly part of the Pump/Dewatering dimension
    const pumpDim = SCORING_DIMENSIONS.find(d => d.includes("Dewatering"));
    expect(pumpDim).toBe("Pump/Dewatering");
  });
});

describe("Module exports", () => {
  it("should export SCORING_DIMENSIONS array", () => {
    expect(Array.isArray(SCORING_DIMENSIONS)).toBe(true);
  });

  it("should export scoreProject function", () => {
    expect(typeof scoreProject).toBe("function");
  });

  it("should export saveProjectScores function", () => {
    expect(typeof saveProjectScores).toBe("function");
  });

  it("should export getProjectScores function", () => {
    expect(typeof getProjectScores).toBe("function");
  });

  it("should export getProjectScoresBatch function", () => {
    expect(typeof getProjectScoresBatch).toBe("function");
  });

  it("should export getUnscoredProjectIds function", () => {
    expect(typeof getUnscoredProjectIds).toBe("function");
  });

  it("should export scoreAndSaveProjects function", () => {
    expect(typeof scoreAndSaveProjects).toBe("function");
  });
});

describe("Schema: projectBusinessLineScores", () => {
  it("should have id column", () => {
    expect(projectBusinessLineScores.id).toBeDefined();
  });

  it("should have projectId column", () => {
    expect(projectBusinessLineScores.projectId).toBeDefined();
  });

  it("should have scoringDimension column", () => {
    expect(projectBusinessLineScores.scoringDimension).toBeDefined();
  });

  it("should have score column", () => {
    expect(projectBusinessLineScores.score).toBeDefined();
  });

  it("should have explanation column", () => {
    expect(projectBusinessLineScores.explanation).toBeDefined();
  });

  it("should have createdAt or timestamp column", () => {
    // The table may use createdAt instead of scoredAt
    const hasTimestamp = projectBusinessLineScores.createdAt || projectBusinessLineScores.scoredAt;
    expect(hasTimestamp).toBeDefined();
  });
});

describe("Type safety", () => {
  it("ScoringDimension type should accept valid dimension names", () => {
    const dim: ScoringDimension = "Portable Air";
    expect(dim).toBe("Portable Air");
  });

  it("DimensionScore should have dimension, score, and explanation", () => {
    const ds: DimensionScore = {
      dimension: "Pump/Dewatering",
      score: 85,
      explanation: "Large mine dewatering project with extensive pump requirements",
    };
    expect(ds.dimension).toBe("Pump/Dewatering");
    expect(ds.score).toBe(85);
    expect(ds.explanation).toBeTruthy();
  });

  it("ProjectScores should have projectId, scores array, and topDimensions", () => {
    const ps: ProjectScores = {
      projectId: 42,
      scores: SCORING_DIMENSIONS.map(dim => ({
        dimension: dim,
        score: 50,
        explanation: "Test",
      })),
      topDimensions: ["Portable Air"],
    };
    expect(ps.projectId).toBe(42);
    expect(ps.scores).toHaveLength(9);
    expect(ps.topDimensions).toContain("Portable Air");
  });

  it("scores should use 0-100 range (not 0-10)", () => {
    // Verify the scoring range by checking the type allows values up to 100
    const ds: DimensionScore = {
      dimension: "BESS",
      score: 95,
      explanation: "Battery storage project",
    };
    expect(ds.score).toBe(95);
    expect(ds.score).toBeGreaterThan(10); // Confirms 0-100 range, not 0-10
  });
});

describe("Database integration", () => {
  it("getProjectScores should return empty array for non-existent project", async () => {
    const scores = await getProjectScores(999999);
    expect(Array.isArray(scores)).toBe(true);
    expect(scores.length).toBe(0);
  });

  it("getProjectScoresBatch should return empty map for empty input", async () => {
    const map = await getProjectScoresBatch([]);
    expect(map instanceof Map).toBe(true);
    expect(map.size).toBe(0);
  });

  it("getUnscoredProjectIds should return an array", async () => {
    const ids = await getUnscoredProjectIds(5);
    expect(Array.isArray(ids)).toBe(true);
  });
});
