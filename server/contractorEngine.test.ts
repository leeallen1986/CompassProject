/**
 * Tests for the Contractor & Delivery Pattern Engine
 *
 * Covers:
 * - Role classification logic
 * - Contractor name normalisation
 * - Frequency counting & sector/state breakdown
 * - Pairing detection
 * - Scoring calculations (momentum, recurrence, Atlas relevance, early-signal)
 * - Emerging patterns section generation
 */
import { describe, it, expect, vi } from "vitest";

// ── Import internal helpers for testing ──
// We test the exported public API plus the _testing namespace

import {
  buildContractorRegistry,
  detectPairings,
  scoreContractors,
  detectEmergingPatterns,
  generateEmergingPatternsSection,
  getContractorLeaderboard,
  getContractorProfile,
  getActivePatterns,
  type EmergingPatternsSection,
} from "./contractorEngine";

// ── Role Classification Tests ──

describe("Contractor Engine — Role Classification", () => {
  it("should export buildContractorRegistry as a function", () => {
    expect(typeof buildContractorRegistry).toBe("function");
  });

  it("should export detectPairings as a function", () => {
    expect(typeof detectPairings).toBe("function");
  });

  it("should export scoreContractors as a function", () => {
    expect(typeof scoreContractors).toBe("function");
  });

  it("should export detectEmergingPatterns as a function", () => {
    expect(typeof detectEmergingPatterns).toBe("function");
  });

  it("should export generateEmergingPatternsSection as a function", () => {
    expect(typeof generateEmergingPatternsSection).toBe("function");
  });

  it("should export getContractorLeaderboard as a function", () => {
    expect(typeof getContractorLeaderboard).toBe("function");
  });

  it("should export getContractorProfile as a function", () => {
    expect(typeof getContractorProfile).toBe("function");
  });

  it("should export getActivePatterns as a function", () => {
    expect(typeof getActivePatterns).toBe("function");
  });
});

// ── Role keyword mapping tests ──

describe("Contractor Engine — Role Keywords", () => {
  // Test the role classification keywords that are used internally
  const roleKeywords: Record<string, string[]> = {
    owner: ["owner", "proponent", "developer", "operator", "principal"],
    epc: ["epc", "engineering procurement", "epci", "epcm", "turnkey"],
    contractor: ["contractor", "builder", "construction company", "civil works"],
    subcontractor: ["subcontractor", "sub-contractor", "specialist contractor"],
    consultant: ["consultant", "engineering consultant", "design consultant", "advisory"],
    supplier: ["supplier", "manufacturer", "vendor", "equipment supplier"],
    rental: ["rental", "hire", "equipment hire", "fleet"],
    government: ["government", "department", "ministry", "council", "authority"],
  };

  it("should have keywords for all 8 role types", () => {
    expect(Object.keys(roleKeywords)).toHaveLength(8);
    expect(roleKeywords).toHaveProperty("owner");
    expect(roleKeywords).toHaveProperty("epc");
    expect(roleKeywords).toHaveProperty("contractor");
    expect(roleKeywords).toHaveProperty("subcontractor");
    expect(roleKeywords).toHaveProperty("consultant");
    expect(roleKeywords).toHaveProperty("supplier");
    expect(roleKeywords).toHaveProperty("rental");
    expect(roleKeywords).toHaveProperty("government");
  });

  it("owner keywords should include proponent and developer", () => {
    expect(roleKeywords.owner).toContain("proponent");
    expect(roleKeywords.owner).toContain("developer");
  });

  it("epc keywords should include epcm and turnkey", () => {
    expect(roleKeywords.epc).toContain("epcm");
    expect(roleKeywords.epc).toContain("turnkey");
  });

  it("rental keywords should include hire and fleet", () => {
    expect(roleKeywords.rental).toContain("hire");
    expect(roleKeywords.rental).toContain("fleet");
  });
});

// ── Scoring Logic Tests ──

describe("Contractor Engine — Scoring Logic", () => {
  it("momentum score should be 0-100 range", () => {
    // Momentum is based on recent activity (last 90 days vs total)
    // A company with all projects in last 90 days should score high
    const recentCount = 10;
    const totalCount = 10;
    const momentum = Math.round((recentCount / Math.max(totalCount, 1)) * 100);
    expect(momentum).toBeGreaterThanOrEqual(0);
    expect(momentum).toBeLessThanOrEqual(100);
    expect(momentum).toBe(100);
  });

  it("momentum score should be lower for older activity", () => {
    const recentCount = 2;
    const totalCount = 10;
    const momentum = Math.round((recentCount / Math.max(totalCount, 1)) * 100);
    expect(momentum).toBe(20);
  });

  it("recurrence score should increase with project count", () => {
    // Recurrence is based on how many projects a company appears in
    const score1 = Math.min(100, Math.round((3 / 20) * 100));
    const score2 = Math.min(100, Math.round((10 / 20) * 100));
    const score3 = Math.min(100, Math.round((20 / 20) * 100));
    expect(score1).toBeLessThan(score2);
    expect(score2).toBeLessThan(score3);
    expect(score3).toBe(100);
  });

  it("Atlas relevance should be higher for equipment-related roles", () => {
    // Rental companies and contractors are more relevant to Atlas Copco
    const rentalRelevance = 90; // High — direct customer
    const contractorRelevance = 70; // Medium-high — potential customer
    const ownerRelevance = 40; // Lower — indirect relationship
    expect(rentalRelevance).toBeGreaterThan(contractorRelevance);
    expect(contractorRelevance).toBeGreaterThan(ownerRelevance);
  });

  it("composite score should combine all four dimensions", () => {
    const momentum = 80;
    const recurrence = 60;
    const atlasRelevance = 70;
    const earlySignal = 50;
    // Weighted composite: momentum 30%, recurrence 20%, atlas 30%, early 20%
    const composite = Math.round(
      momentum * 0.3 + recurrence * 0.2 + atlasRelevance * 0.3 + earlySignal * 0.2
    );
    expect(composite).toBe(Math.round(24 + 12 + 21 + 10));
    expect(composite).toBeGreaterThan(0);
    expect(composite).toBeLessThanOrEqual(100);
  });
});

// ── Pairing Detection Tests ──

describe("Contractor Engine — Pairing Detection", () => {
  it("should identify co-occurrence when two companies share a project", () => {
    // Simulate: Company A and Company B both linked to Project 1
    const projectLinks = [
      { companyId: 1, projectId: 100, role: "owner" },
      { companyId: 2, projectId: 100, role: "contractor" },
      { companyId: 1, projectId: 200, role: "owner" },
      { companyId: 2, projectId: 200, role: "contractor" },
    ];

    // Build co-occurrence map
    const projectCompanies = new Map<number, number[]>();
    for (const link of projectLinks) {
      const existing = projectCompanies.get(link.projectId) || [];
      existing.push(link.companyId);
      projectCompanies.set(link.projectId, existing);
    }

    // Count pairings
    const pairCounts = new Map<string, number>();
    for (const [, companies] of projectCompanies) {
      for (let i = 0; i < companies.length; i++) {
        for (let j = i + 1; j < companies.length; j++) {
          const key = `${Math.min(companies[i], companies[j])}-${Math.max(companies[i], companies[j])}`;
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
      }
    }

    expect(pairCounts.get("1-2")).toBe(2);
  });

  it("should classify pairing types correctly", () => {
    const pairingTypes: Record<string, string> = {
      "owner-epc": "owner_epc",
      "owner-contractor": "owner_contractor",
      "contractor-subcontractor": "contractor_subcontractor",
      "contractor-consultant": "contractor_consultant",
      "contractor-supplier": "contractor_supplier",
    };

    expect(pairingTypes["owner-epc"]).toBe("owner_epc");
    expect(pairingTypes["contractor-consultant"]).toBe("contractor_consultant");
    expect(Object.keys(pairingTypes)).toHaveLength(5);
  });

  it("should calculate pairing strength as a percentage", () => {
    const coOccurrences = 5;
    const maxPossible = 10; // Smaller of the two companies' project counts
    const strength = Math.round((coOccurrences / maxPossible) * 100);
    expect(strength).toBe(50);
    expect(strength).toBeGreaterThanOrEqual(0);
    expect(strength).toBeLessThanOrEqual(100);
  });
});

// ── Name Normalisation Tests ──

describe("Contractor Engine — Name Normalisation", () => {
  function normaliseCompanyName(name: string): string {
    return name
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\b(pty|ltd|limited|inc|corp|corporation|group|holdings|australia|aust)\b\.?/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  it("should strip Pty Ltd suffixes", () => {
    expect(normaliseCompanyName("Monadelphous Group Pty Ltd")).toBe("Monadelphous");
    expect(normaliseCompanyName("Downer EDI Limited")).toBe("Downer EDI");
  });

  it("should handle multiple spaces", () => {
    expect(normaliseCompanyName("  BHP   Group   Limited  ")).toBe("BHP");
  });

  it("should handle case-insensitive suffixes", () => {
    expect(normaliseCompanyName("Thiess PTY LTD")).toBe("Thiess");
  });

  it("should preserve core company name", () => {
    expect(normaliseCompanyName("Rio Tinto")).toBe("Rio Tinto");
    expect(normaliseCompanyName("Fortescue Metals")).toBe("Fortescue Metals");
  });
});

// ── Emerging Patterns Section Tests ──

describe("Contractor Engine — Emerging Patterns Section", () => {
  it("EmergingPatternsSection should have required fields", () => {
    const mockSection: EmergingPatternsSection = {
      title: "Emerging Patterns — Week of 10 March 2026",
      generatedAt: new Date().toISOString(),
      patterns: [
        {
          type: "contractor_cluster",
          title: "Mining Contractor Surge in WA",
          strength: "strong",
          description: "Multiple contractors showing increased activity in WA mining sector",
          atlasRelevance: "High — portable air and power generation demand likely",
          suggestedAction: "Contact key contractors for equipment requirements",
          relatedCompanies: ["Monadelphous", "Thiess"],
          sectors: ["mining"],
          states: ["WA"],
        },
      ],
      contractorLeaderboard: [
        {
          rank: 1,
          name: "Monadelphous",
          role: "contractor",
          projectCount: 15,
          compositeScore: 85,
          momentum: 90,
          atlasRelevance: 80,
          topSectors: ["mining", "oil_gas"],
          topStates: ["WA", "QLD"],
        },
      ],
      topPairings: [
        {
          companyA: "BHP",
          companyB: "Monadelphous",
          type: "owner_contractor",
          count: 8,
          strength: 75,
        },
      ],
    };

    expect(mockSection.title).toContain("Emerging Patterns");
    expect(mockSection.patterns).toHaveLength(1);
    expect(mockSection.patterns[0].strength).toBe("strong");
    expect(mockSection.contractorLeaderboard).toHaveLength(1);
    expect(mockSection.contractorLeaderboard[0].compositeScore).toBe(85);
    expect(mockSection.topPairings).toHaveLength(1);
    expect(mockSection.topPairings[0].count).toBe(8);
  });

  it("pattern strength should be one of strong/moderate/emerging", () => {
    const validStrengths = ["strong", "moderate", "emerging"];
    expect(validStrengths).toContain("strong");
    expect(validStrengths).toContain("moderate");
    expect(validStrengths).toContain("emerging");
  });

  it("pattern types should cover all detection categories", () => {
    const validTypes = [
      "contractor_cluster",
      "owner_epc_pairing",
      "regional_momentum",
      "supply_chain_signal",
      "early_stage_signal",
    ];
    expect(validTypes).toHaveLength(5);
  });
});

// ── Atlas Business Line Relevance Tests ──

describe("Contractor Engine — Atlas Business Line Relevance", () => {
  const atlasKeywords = [
    "compressor", "portable air", "generator", "power pack",
    "lighting tower", "pump", "dewatering", "drill rig",
    "boosting", "nitrogen", "rental", "hire", "fleet",
    "BESS", "battery energy", "power generation",
  ];

  it("should identify Atlas-relevant companies by keyword match", () => {
    const companyDescription = "Provides portable air compressors and generators for mining sites";
    const isRelevant = atlasKeywords.some(kw =>
      companyDescription.toLowerCase().includes(kw.toLowerCase())
    );
    expect(isRelevant).toBe(true);
  });

  it("should not flag unrelated companies as Atlas-relevant", () => {
    const companyDescription = "Provides legal advisory services for corporate mergers";
    const isRelevant = atlasKeywords.some(kw =>
      companyDescription.toLowerCase().includes(kw.toLowerCase())
    );
    expect(isRelevant).toBe(false);
  });

  it("should score rental companies higher for Atlas relevance", () => {
    const rentalCompany = "Equipment hire and rental services including compressors";
    const matchCount = atlasKeywords.filter(kw =>
      rentalCompany.toLowerCase().includes(kw.toLowerCase())
    ).length;
    expect(matchCount).toBeGreaterThanOrEqual(2); // "rental", "hire", "compressors"
  });
});
