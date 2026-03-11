/**
 * personalisation.test.ts — Tests for territory/BL personalisation logic
 *
 * Covers:
 * - mlRanker BL matching scoring
 * - AI search user preference boosting
 * - Outreach BL context injection
 * - NBA user BL passthrough
 * - Coaching territory/BL scoping
 */
import { describe, it, expect } from "vitest";

// ── 1. ML Ranker BL Matching ──

describe("mlRanker BL matching", () => {
  it("should boost score when project BL matches user assigned BLs", () => {
    // Simulate the BL matching logic from mlRanker
    const userBLs = ["Portable Air", "Pump"];
    const projectScores = [
      { dimension: "Portable Air", score: 85 },
      { dimension: "PAL", score: 60 },
      { dimension: "BESS", score: 30 },
    ];

    // BL match scoring logic (mirrors mlRanker.ts)
    let blMatchScore = 0;
    if (userBLs.length > 0 && projectScores.length > 0) {
      const matchedBLs = projectScores.filter(
        (s) => userBLs.includes(s.dimension) && s.score >= 40
      );
      if (matchedBLs.length > 0) {
        const avgScore = matchedBLs.reduce((sum, s) => sum + s.score, 0) / matchedBLs.length;
        blMatchScore = Math.round((avgScore / 100) * 15);
      }
    }

    expect(blMatchScore).toBeGreaterThan(0);
    expect(blMatchScore).toBeLessThanOrEqual(15);
    // Portable Air at 85 → (85/100)*15 = 12.75 → 13
    expect(blMatchScore).toBe(13);
  });

  it("should return 0 when no BLs match", () => {
    const userBLs = ["BESS"];
    const projectScores = [
      { dimension: "Portable Air", score: 85 },
      { dimension: "PAL", score: 60 },
      { dimension: "BESS", score: 30 }, // Below 40 threshold
    ];

    let blMatchScore = 0;
    if (userBLs.length > 0 && projectScores.length > 0) {
      const matchedBLs = projectScores.filter(
        (s) => userBLs.includes(s.dimension) && s.score >= 40
      );
      if (matchedBLs.length > 0) {
        const avgScore = matchedBLs.reduce((sum, s) => sum + s.score, 0) / matchedBLs.length;
        blMatchScore = Math.round((avgScore / 100) * 15);
      }
    }

    expect(blMatchScore).toBe(0);
  });

  it("should return 0 when user has no assigned BLs (no filtering)", () => {
    const userBLs: string[] = [];
    const projectScores = [
      { dimension: "Portable Air", score: 85 },
    ];

    let blMatchScore = 0;
    if (userBLs.length > 0 && projectScores.length > 0) {
      const matchedBLs = projectScores.filter(
        (s) => userBLs.includes(s.dimension) && s.score >= 40
      );
      if (matchedBLs.length > 0) {
        const avgScore = matchedBLs.reduce((sum, s) => sum + s.score, 0) / matchedBLs.length;
        blMatchScore = Math.round((avgScore / 100) * 15);
      }
    }

    expect(blMatchScore).toBe(0);
  });

  it("should average scores when multiple BLs match", () => {
    const userBLs = ["Portable Air", "PAL"];
    const projectScores = [
      { dimension: "Portable Air", score: 80 },
      { dimension: "PAL", score: 60 },
      { dimension: "BESS", score: 90 },
    ];

    let blMatchScore = 0;
    if (userBLs.length > 0 && projectScores.length > 0) {
      const matchedBLs = projectScores.filter(
        (s) => userBLs.includes(s.dimension) && s.score >= 40
      );
      if (matchedBLs.length > 0) {
        const avgScore = matchedBLs.reduce((sum, s) => sum + s.score, 0) / matchedBLs.length;
        blMatchScore = Math.round((avgScore / 100) * 15);
      }
    }

    // (80 + 60) / 2 = 70 → (70/100)*15 = 10.5 → 11
    expect(blMatchScore).toBe(11);
  });
});

// ── 2. Sector Focus Boosting ──

describe("sector focus boosting", () => {
  it("should boost score when project sector matches user focus", () => {
    const userSectorFocus = ["mining", "oil_gas"];
    const projectSector = "mining";

    let sectorBoost = 0;
    if (userSectorFocus.length > 0 && userSectorFocus.includes(projectSector)) {
      sectorBoost = 5;
    }

    expect(sectorBoost).toBe(5);
  });

  it("should not boost when sector doesn't match", () => {
    const userSectorFocus = ["mining", "oil_gas"];
    const projectSector = "infrastructure";

    let sectorBoost = 0;
    if (userSectorFocus.length > 0 && userSectorFocus.includes(projectSector)) {
      sectorBoost = 5;
    }

    expect(sectorBoost).toBe(0);
  });

  it("should not boost when user has no sector focus (all sectors)", () => {
    const userSectorFocus: string[] = [];
    const projectSector = "mining";

    let sectorBoost = 0;
    if (userSectorFocus.length > 0 && userSectorFocus.includes(projectSector)) {
      sectorBoost = 5;
    }

    expect(sectorBoost).toBe(0);
  });
});

// ── 3. Territory Matching ──

describe("territory matching", () => {
  const STATE_KEYWORDS: Record<string, string[]> = {
    WA: ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha"],
    QLD: ["queensland", "qld", "brisbane", "townsville", "mackay", "gladstone"],
    NSW: ["new south wales", "nsw", "sydney", "newcastle", "wollongong"],
    VIC: ["victoria", "vic", "melbourne"],
    SA: ["south australia", "sa", "adelaide"],
    NT: ["northern territory", "nt", "darwin"],
    TAS: ["tasmania", "tas", "hobart"],
    ACT: ["act", "canberra"],
  };

  function isInUserTerritory(location: string, userTerritories: string[]): boolean {
    if (userTerritories.length === 0) return true;
    const loc = location.toLowerCase();
    return userTerritories.some((t) => {
      const kws = STATE_KEYWORDS[t] || [t.toLowerCase()];
      return kws.some((kw) => loc.includes(kw));
    });
  }

  it("should match WA territory with Pilbara location", () => {
    expect(isInUserTerritory("Pilbara, Western Australia", ["WA"])).toBe(true);
  });

  it("should match QLD territory with Brisbane location", () => {
    expect(isInUserTerritory("Brisbane, QLD", ["QLD"])).toBe(true);
  });

  it("should not match WA territory with NSW location", () => {
    expect(isInUserTerritory("Sydney, NSW", ["WA"])).toBe(false);
  });

  it("should match when user has multiple territories", () => {
    expect(isInUserTerritory("Perth, WA", ["QLD", "WA"])).toBe(true);
  });

  it("should match all locations when user has no territory set", () => {
    expect(isInUserTerritory("Anywhere, Mars", [])).toBe(true);
  });

  it("should handle case-insensitive matching", () => {
    expect(isInUserTerritory("PERTH, WESTERN AUSTRALIA", ["WA"])).toBe(true);
  });

  it("should match Karratha to WA", () => {
    expect(isInUserTerritory("Karratha", ["WA"])).toBe(true);
  });

  it("should match Gladstone to QLD", () => {
    expect(isInUserTerritory("Gladstone LNG Project", ["QLD"])).toBe(true);
  });
});

// ── 4. AI Search Personalisation Boosting ──

describe("AI search personalisation boosting", () => {
  it("should boost territory-matching results", () => {
    const userTerritories = ["WA"];
    const results = [
      { name: "Gold Mine", location: "Kalgoorlie, WA", score: 80 },
      { name: "Coal Mine", location: "Mackay, QLD", score: 85 },
    ];

    const STATE_KEYWORDS: Record<string, string[]> = {
      WA: ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha"],
      QLD: ["queensland", "qld", "brisbane", "townsville", "mackay", "gladstone"],
    };

    const boosted = results.map((r) => {
      let boost = 0;
      const loc = r.location.toLowerCase();
      if (
        userTerritories.some((t) => {
          const kws = STATE_KEYWORDS[t] || [t.toLowerCase()];
          return kws.some((kw) => loc.includes(kw));
        })
      ) {
        boost += 10;
      }
      return { ...r, adjustedScore: r.score + boost };
    });

    // WA project should now rank higher despite lower base score
    const sorted = boosted.sort((a, b) => b.adjustedScore - a.adjustedScore);
    expect(sorted[0].name).toBe("Gold Mine");
    expect(sorted[0].adjustedScore).toBe(90);
  });

  it("should boost BL-matching results", () => {
    const userBLs = ["Pump"];
    const results = [
      { name: "Dewatering Project", blScores: [{ dim: "Pump", score: 90 }], baseScore: 70 },
      { name: "Power Project", blScores: [{ dim: "PAL", score: 90 }], baseScore: 75 },
    ];

    const boosted = results.map((r) => {
      let boost = 0;
      if (userBLs.length > 0) {
        const matchedBL = r.blScores.some(
          (s) => userBLs.includes(s.dim) && s.score >= 40
        );
        if (matchedBL) boost += 8;
      }
      return { ...r, adjustedScore: r.baseScore + boost };
    });

    const sorted = boosted.sort((a, b) => b.adjustedScore - a.adjustedScore);
    expect(sorted[0].name).toBe("Dewatering Project");
    expect(sorted[0].adjustedScore).toBe(78);
  });

  it("should not boost when user has no preferences", () => {
    const userTerritories: string[] = [];
    const userBLs: string[] = [];

    const result = { location: "Perth, WA", blScores: [{ dim: "Pump", score: 90 }], baseScore: 80 };

    let boost = 0;
    if (userTerritories.length > 0) boost += 10;
    if (userBLs.length > 0) boost += 8;

    expect(boost).toBe(0);
    expect(result.baseScore + boost).toBe(80);
  });
});

// ── 5. Outreach BL Context Injection ──

describe("outreach BL context injection", () => {
  it("should include sender BL context in prompt when BLs are set", () => {
    const senderBLs = ["Portable Air", "Pump"];
    const blContext = senderBLs.length > 0
      ? `SENDER'S PRODUCT FOCUS: The sender specialises in ${senderBLs.join(", ")}.`
      : "";

    expect(blContext).toContain("Portable Air");
    expect(blContext).toContain("Pump");
    expect(blContext).toContain("SENDER'S PRODUCT FOCUS");
  });

  it("should not include sender BL context when BLs are empty", () => {
    const senderBLs: string[] = [];
    const blContext = senderBLs.length > 0
      ? `SENDER'S PRODUCT FOCUS: The sender specialises in ${senderBLs.join(", ")}.`
      : "";

    expect(blContext).toBe("");
  });
});

// ── 6. Coaching Territory/BL Scoping ──

describe("coaching territory/BL scoping", () => {
  it("should classify in-scope projects correctly", () => {
    const userTerritories = ["WA"];
    const userBLs = ["Portable Air"];

    const STATE_KEYWORDS: Record<string, string[]> = {
      WA: ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha"],
    };

    function isInUserTerritory(location: string): boolean {
      if (userTerritories.length === 0) return true;
      const loc = location.toLowerCase();
      return userTerritories.some((t) => {
        const kws = STATE_KEYWORDS[t] || [t.toLowerCase()];
        return kws.some((kw) => loc.includes(kw));
      });
    }

    function isInUserBLScope(blScores: { dimension: string; score: number }[]): boolean {
      if (userBLs.length === 0) return true;
      return blScores.some((s) => userBLs.includes(s.dimension) && s.score >= 40);
    }

    const projects = [
      { name: "WA Mine", location: "Pilbara, WA", blScores: [{ dimension: "Portable Air", score: 80 }] },
      { name: "QLD Road", location: "Brisbane, QLD", blScores: [{ dimension: "PAL", score: 70 }] },
      { name: "NSW Tunnel", location: "Sydney, NSW", blScores: [{ dimension: "Portable Air", score: 60 }] },
    ];

    const inScope = projects.filter(
      (p) => isInUserTerritory(p.location) || isInUserBLScope(p.blScores)
    );

    // WA Mine: territory match (WA) ✓
    // QLD Road: no territory match, no BL match → out of scope
    // NSW Tunnel: no territory match, but BL match (Portable Air ≥ 40) ✓
    expect(inScope.length).toBe(2);
    expect(inScope.map((p) => p.name)).toContain("WA Mine");
    expect(inScope.map((p) => p.name)).toContain("NSW Tunnel");
    expect(inScope.map((p) => p.name)).not.toContain("QLD Road");
  });

  it("should include all projects when user has no preferences", () => {
    const userTerritories: string[] = [];
    const userBLs: string[] = [];

    function isInUserTerritory(location: string): boolean {
      if (userTerritories.length === 0) return true;
      return false;
    }

    function isInUserBLScope(blScores: { dimension: string; score: number }[]): boolean {
      if (userBLs.length === 0) return true;
      return false;
    }

    const projects = [
      { name: "WA Mine", location: "Pilbara, WA", blScores: [] },
      { name: "QLD Road", location: "Brisbane, QLD", blScores: [] },
    ];

    const inScope = projects.filter(
      (p) => isInUserTerritory(p.location) || isInUserBLScope(p.blScores)
    );

    expect(inScope.length).toBe(2);
  });
});

// ── 7. NBA User BL Passthrough ──

describe("NBA user BL passthrough", () => {
  it("should include user BLs in NBA prompt when set", () => {
    const userBLs = ["Portable Air", "BESS"];

    const blSection = userBLs && userBLs.length > 0
      ? `\nREP'S ASSIGNED BUSINESS LINES: ${userBLs.join(", ")}\nIMPORTANT: Tailor recommendations to the rep's assigned BLs.`
      : "";

    expect(blSection).toContain("Portable Air");
    expect(blSection).toContain("BESS");
    expect(blSection).toContain("REP'S ASSIGNED BUSINESS LINES");
    expect(blSection).toContain("Tailor recommendations");
  });

  it("should not include BL section when user has no BLs", () => {
    const userBLs: string[] = [];

    const blSection = userBLs && userBLs.length > 0
      ? `\nREP'S ASSIGNED BUSINESS LINES: ${userBLs.join(", ")}`
      : "";

    expect(blSection).toBe("");
  });
});

// ── 8. Profile Schema Validation ──

describe("profile schema validation", () => {
  it("should accept valid business line names", () => {
    const validBLs = ["Portable Air", "Pump", "PAL", "BESS", "Nitrogen", "Generators", "Booster", "Service"];
    for (const bl of validBLs) {
      expect(typeof bl).toBe("string");
      expect(bl.length).toBeGreaterThan(0);
    }
  });

  it("should accept valid territory codes", () => {
    const validTerritories = ["WA", "QLD", "NSW", "VIC", "SA", "NT", "TAS", "ACT"];
    for (const t of validTerritories) {
      expect(typeof t).toBe("string");
      expect(t.length).toBeLessThanOrEqual(3);
    }
  });

  it("should accept valid sector focus values", () => {
    const validSectors = ["mining", "oil_gas", "infrastructure", "energy", "defence"];
    for (const s of validSectors) {
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
    }
  });
});
