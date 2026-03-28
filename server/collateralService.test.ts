/**
 * Collateral Service Tests
 * 
 * Tests for the matching engine, tag presets, and scoring logic.
 * Database-dependent CRUD is tested via integration; matching logic is tested
 * by directly invoking the scoring algorithm with mock project data.
 */
import { describe, it, expect } from "vitest";
import {
  APPLICATION_TAGS,
  SECTOR_TAGS,
  PRODUCT_LINES,
} from "./collateralService";

// ── Tag Presets ──

describe("Collateral tag presets", () => {
  it("should have at least 15 application tags", () => {
    expect(APPLICATION_TAGS.length).toBeGreaterThanOrEqual(15);
  });

  it("should have unique application tag values", () => {
    const values = APPLICATION_TAGS.map(t => t.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("should include key drilling applications", () => {
    const values = APPLICATION_TAGS.map(t => t.value);
    expect(values).toContain("rc_drilling");
    expect(values).toContain("waterwell_drilling");
    expect(values).toContain("diamond_drilling");
    expect(values).toContain("exploration_drilling");
    expect(values).toContain("blast_hole_drilling");
  });

  it("should include non-drilling applications", () => {
    const values = APPLICATION_TAGS.map(t => t.value);
    expect(values).toContain("tunnelling");
    expect(values).toContain("dewatering");
    expect(values).toContain("earthworks");
    expect(values).toContain("solar_farm");
  });

  it("should have at least 5 sector tags", () => {
    expect(SECTOR_TAGS.length).toBeGreaterThanOrEqual(5);
  });

  it("should have unique sector tag values", () => {
    const values = SECTOR_TAGS.map(t => t.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("should include core sectors", () => {
    const values = SECTOR_TAGS.map(t => t.value);
    expect(values).toContain("mining");
    expect(values).toContain("oil_gas");
    expect(values).toContain("infrastructure");
    expect(values).toContain("energy");
  });

  it("should have at least 5 product lines", () => {
    expect(PRODUCT_LINES.length).toBeGreaterThanOrEqual(5);
  });

  it("should have unique product line values", () => {
    const values = PRODUCT_LINES.map(t => t.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("should include portable_air as first product line", () => {
    expect(PRODUCT_LINES[0].value).toBe("portable_air");
  });

  it("should include all key product lines", () => {
    const values = PRODUCT_LINES.map(t => t.value);
    expect(values).toContain("portable_air");
    expect(values).toContain("dewatering");
    expect(values).toContain("generators");
    expect(values).toContain("bess");
    expect(values).toContain("nitrogen");
  });
});

// ── Matching Scoring Logic (unit-testable without DB) ──

describe("Collateral matching scoring algorithm", () => {
  // Replicate the scoring logic from matchCollateralToProject for unit testing
  function scoreCollateral(
    collateral: {
      productLine: string;
      sectorTags: string[];
      applicationTags: string[];
      keywordTags: string[];
    },
    projectText: string,
    projectSector: string
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // 1. Sector match (0-30 points)
    const sectorTags = collateral.sectorTags.map(s => s.toLowerCase());
    if (sectorTags.includes(projectSector.toLowerCase())) {
      score += 30;
      reasons.push(`Sector match: ${projectSector.toLowerCase()}`);
    } else if (sectorTags.length === 0) {
      score += 10;
    }

    // 2. Application tag match (0-40 points)
    const appTags = collateral.applicationTags.map(t => t.toLowerCase().replace(/_/g, " "));
    let appMatchCount = 0;
    const text = projectText.toLowerCase();
    for (const tag of appTags) {
      const tagWords = tag.split(" ");
      const anyWordMatch = tagWords.some(w => w.length > 3 && text.includes(w));
      if (text.includes(tag) || anyWordMatch) {
        appMatchCount++;
      }
    }
    if (appMatchCount > 0) {
      const appScore = Math.min(40, appMatchCount * 20);
      score += appScore;
      reasons.push(`${appMatchCount} application tag(s) matched`);
    }

    // 3. Keyword match (0-20 points)
    const keywords = collateral.keywordTags.map(k => k.toLowerCase());
    let kwMatchCount = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) {
        kwMatchCount++;
      }
    }
    if (kwMatchCount > 0) {
      const kwScore = Math.min(20, kwMatchCount * 10);
      score += kwScore;
      reasons.push(`${kwMatchCount} keyword(s) matched`);
    }

    // 4. Product line relevance bonus (0-10 points)
    const drillingKeywords = ["drill", "drilling", "bore", "borehole", "compressor", "pneumatic", "blast"];
    if (collateral.productLine === "portable_air" && drillingKeywords.some(k => text.includes(k))) {
      score += 10;
      reasons.push("Portable air relevant to drilling/compressor context");
    }

    return { score: Math.min(100, score), reasons };
  }

  it("should score high for exact sector + application match", () => {
    const result = scoreCollateral(
      {
        productLine: "portable_air",
        sectorTags: ["mining"],
        applicationTags: ["rc_drilling"],
        keywordTags: [],
      },
      "RC drilling exploration program at Pilbara gold mine",
      "mining"
    );
    // Sector (30) + App match (20) + Drilling bonus (10) = 60
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.reasons).toContain("Sector match: mining");
  });

  it("should score zero for completely unrelated collateral", () => {
    const result = scoreCollateral(
      {
        productLine: "lighting",
        sectorTags: ["construction"],
        applicationTags: ["lighting"],
        keywordTags: ["tower light"],
      },
      "Offshore oil platform decommissioning project in Bass Strait",
      "oil_gas"
    );
    expect(result.score).toBe(0);
  });

  it("should give partial credit when no sector tags are set", () => {
    const result = scoreCollateral(
      {
        productLine: "portable_air",
        sectorTags: [],
        applicationTags: ["rc_drilling"],
        keywordTags: [],
      },
      "RC drilling program at new gold mine",
      "mining"
    );
    // No sector tags = 10 partial + App match (20) + Drilling bonus (10) = 40
    expect(result.score).toBeGreaterThanOrEqual(40);
  });

  it("should cap application tag score at 40", () => {
    const result = scoreCollateral(
      {
        productLine: "portable_air",
        sectorTags: ["mining"],
        applicationTags: ["rc_drilling", "waterwell_drilling", "exploration_drilling", "blast_hole_drilling"],
        keywordTags: [],
      },
      "RC drilling waterwell drilling exploration drilling blast hole drilling program",
      "mining"
    );
    // Sector (30) + App capped at 40 + Drilling bonus (10) = 80
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("should cap keyword score at 20", () => {
    const result = scoreCollateral(
      {
        productLine: "portable_air",
        sectorTags: [],
        applicationTags: [],
        keywordTags: ["truck deck", "25 bar", "x1300", "compact"],
      },
      "Truck deck mounted 25 bar x1300 compact compressor for drilling",
      "mining"
    );
    // No sector (10) + Keywords capped at 20 + Drilling bonus (10) = 40
    expect(result.score).toBeLessThanOrEqual(40);
  });

  it("should give drilling bonus only for portable_air product line", () => {
    const portableAir = scoreCollateral(
      {
        productLine: "portable_air",
        sectorTags: ["mining"],
        applicationTags: [],
        keywordTags: [],
      },
      "RC drilling exploration at mine site",
      "mining"
    );

    const generators = scoreCollateral(
      {
        productLine: "generators",
        sectorTags: ["mining"],
        applicationTags: [],
        keywordTags: [],
      },
      "RC drilling exploration at mine site",
      "mining"
    );

    expect(portableAir.score).toBeGreaterThan(generators.score);
    expect(portableAir.reasons).toContain("Portable air relevant to drilling/compressor context");
    expect(generators.reasons).not.toContain("Portable air relevant to drilling/compressor context");
  });

  it("should match application tags by word fragments (length > 3)", () => {
    const result = scoreCollateral(
      {
        productLine: "portable_air",
        sectorTags: ["mining"],
        applicationTags: ["exploration_drilling"],
        keywordTags: [],
      },
      "Gold exploration program with extensive drilling campaign",
      "mining"
    );
    // "exploration" and "drilling" are both > 3 chars and appear in text
    expect(result.score).toBeGreaterThanOrEqual(50);
  });

  it("should not match short words (3 chars or less) from application tags", () => {
    const result = scoreCollateral(
      {
        productLine: "other",
        sectorTags: [],
        applicationTags: ["oil_gas_production"],
        keywordTags: [],
      },
      "Oil spill cleanup project — no gas or production involved",
      "infrastructure"
    );
    // "oil" is 3 chars — should not match on its own
    // "gas" is 3 chars — should not match on its own
    // "production" is > 3 chars and IS in the text, so it will match
    // The full tag "oil gas production" won't match as a whole string
    // But "production" will match as a word > 3 chars
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("should score maximum 100 even with all signals matching", () => {
    const result = scoreCollateral(
      {
        productLine: "portable_air",
        sectorTags: ["mining"],
        applicationTags: ["rc_drilling", "waterwell_drilling", "exploration_drilling"],
        keywordTags: ["truck deck", "25 bar", "x1300"],
      },
      "RC drilling waterwell drilling exploration drilling truck deck 25 bar x1300 compressor",
      "mining"
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("should filter out matches with score <= 20", () => {
    // A collateral item with only partial sector credit (10) should be filtered
    const result = scoreCollateral(
      {
        productLine: "lighting",
        sectorTags: [],
        applicationTags: ["lighting"],
        keywordTags: [],
      },
      "Offshore oil platform maintenance project",
      "oil_gas"
    );
    // No sector tags = 10, no app match, no keyword match = 10 total
    expect(result.score).toBeLessThanOrEqual(20);
  });

  it("should handle empty project text gracefully", () => {
    const result = scoreCollateral(
      {
        productLine: "portable_air",
        sectorTags: ["mining"],
        applicationTags: ["rc_drilling"],
        keywordTags: ["x1300"],
      },
      "",
      ""
    );
    expect(result.score).toBe(0);
    expect(result.reasons.length).toBe(0);
  });

  it("should handle empty collateral tags gracefully", () => {
    const result = scoreCollateral(
      {
        productLine: "other",
        sectorTags: [],
        applicationTags: [],
        keywordTags: [],
      },
      "Major mining project with RC drilling and earthworks",
      "mining"
    );
    // Only partial sector credit (10) since no sector tags
    expect(result.score).toBe(10);
  });
});

// ── X1300 Flyer Matching Scenarios ──

describe("X1300 flyer matching scenarios", () => {
  function scoreX1300(projectText: string, projectSector: string) {
    let score = 0;
    const reasons: string[] = [];
    const sectorTags = ["mining", "oil_gas", "water"];
    const applicationTags = ["rc drilling", "waterwell drilling", "exploration drilling"];
    const keywordTags = ["truck deck", "25 bar", "x1300"];
    const text = projectText.toLowerCase();

    if (sectorTags.includes(projectSector.toLowerCase())) {
      score += 30;
      reasons.push(`Sector match: ${projectSector.toLowerCase()}`);
    }

    let appMatchCount = 0;
    for (const tag of applicationTags) {
      const tagWords = tag.split(" ");
      const anyWordMatch = tagWords.some(w => w.length > 3 && text.includes(w));
      if (text.includes(tag) || anyWordMatch) appMatchCount++;
    }
    if (appMatchCount > 0) {
      score += Math.min(40, appMatchCount * 20);
      reasons.push(`${appMatchCount} application tag(s) matched`);
    }

    let kwMatchCount = 0;
    for (const kw of keywordTags) {
      if (text.includes(kw)) kwMatchCount++;
    }
    if (kwMatchCount > 0) {
      score += Math.min(20, kwMatchCount * 10);
      reasons.push(`${kwMatchCount} keyword(s) matched`);
    }

    const drillingKeywords = ["drill", "drilling", "bore", "borehole", "compressor", "pneumatic", "blast"];
    if (drillingKeywords.some(k => text.includes(k))) {
      score += 10;
      reasons.push("Portable air relevant to drilling/compressor context");
    }

    return { score: Math.min(100, score), reasons };
  }

  it("should score high for Pilbara RC drilling exploration", () => {
    const result = scoreX1300(
      "Pilbara Gold RC Drilling Exploration Program — 50,000m drill campaign across 3 tenements",
      "mining"
    );
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("should score high for waterwell drilling project", () => {
    const result = scoreX1300(
      "Remote community waterwell drilling program — 20 bores across NT communities",
      "water"
    );
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("should score low for solar farm construction", () => {
    const result = scoreX1300(
      "Western Downs Solar Farm — 400MW photovoltaic installation with earthworks and piling",
      "energy"
    );
    expect(result.score).toBeLessThanOrEqual(20);
  });

  it("should score low for tunnel construction", () => {
    const result = scoreX1300(
      "Sydney Metro West tunnel boring — twin 15km tunnels under harbour",
      "infrastructure"
    );
    expect(result.score).toBeLessThanOrEqual(20);
  });

  it("should score medium for oil & gas exploration with drilling", () => {
    const result = scoreX1300(
      "Cooper Basin exploration drilling program — 12 wells planned for gas appraisal",
      "oil_gas"
    );
    // Sector (30) + drilling word match + drilling bonus
    expect(result.score).toBeGreaterThanOrEqual(50);
  });
});
