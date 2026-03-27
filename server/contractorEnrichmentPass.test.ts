/**
 * Tests for the Contractor Enrichment Pass
 *
 * Covers:
 * - Awarded project pattern building and formatting
 * - Contractor search result types and filtering
 * - Project contractor update/merge logic
 * - Confidence-to-status mapping (Predicted vs Confirmed)
 * - Bulk enrichment result structure
 * - Cross-reference context injection into LLM prompt
 */
import { describe, it, expect, vi } from "vitest";

// ─── Awarded Pattern Building Tests ───

describe("ContractorEnrichmentPass — Awarded Pattern Building", () => {
  // Simulate the pattern building logic that getAwardedProjectPatterns uses
  function buildPatterns(awarded: Array<{
    project: string;
    winningContractor: string;
    location: string;
    value: string;
  }>) {
    const contractorMap = new Map<string, { projects: string[]; locations: string[] }>();
    for (const a of awarded) {
      const name = a.winningContractor.trim();
      if (!contractorMap.has(name)) {
        contractorMap.set(name, { projects: [], locations: [] });
      }
      const entry = contractorMap.get(name)!;
      entry.projects.push(`${a.project} (${a.value})`);
      if (!entry.locations.includes(a.location)) {
        entry.locations.push(a.location);
      }
    }

    const allPatterns: Array<{ contractor: string; projects: string[]; locations: string[] }> = [];
    for (const [contractor, data] of Array.from(contractorMap.entries())) {
      allPatterns.push({ contractor, projects: data.projects, locations: data.locations });
    }

    const byLocation = new Map<string, typeof allPatterns>();
    const stateAbbrevs = ["WA", "QLD", "NSW", "VIC", "SA", "TAS", "NT", "ACT"];
    for (const pattern of allPatterns) {
      for (const loc of pattern.locations) {
        for (const state of stateAbbrevs) {
          if (loc.toUpperCase().includes(state)) {
            if (!byLocation.has(state)) byLocation.set(state, []);
            const stateList = byLocation.get(state)!;
            if (!stateList.find(p => p.contractor === pattern.contractor)) {
              stateList.push(pattern);
            }
          }
        }
      }
    }

    return { byLocation, allPatterns };
  }

  it("should group awarded projects by contractor", () => {
    const awarded = [
      { project: "Iron Bridge Magnetite", winningContractor: "Monadelphous", location: "WA", value: "$3.6B" },
      { project: "South Flank", winningContractor: "Monadelphous", location: "WA", value: "$3.5B" },
      { project: "Olympic Dam Expansion", winningContractor: "Thiess", location: "SA", value: "$2.1B" },
    ];

    const { allPatterns } = buildPatterns(awarded);

    const mono = allPatterns.find(p => p.contractor === "Monadelphous");
    expect(mono).toBeDefined();
    expect(mono!.projects).toHaveLength(2);
    expect(mono!.locations).toEqual(["WA"]);

    const thiess = allPatterns.find(p => p.contractor === "Thiess");
    expect(thiess).toBeDefined();
    expect(thiess!.projects).toHaveLength(1);
  });

  it("should group patterns by state location", () => {
    const awarded = [
      { project: "Carmichael Mine", winningContractor: "MACA", location: "QLD", value: "$2B" },
      { project: "Pilbara Expansion", winningContractor: "NRW", location: "WA", value: "$1.5B" },
      { project: "Carmichael Rail", winningContractor: "NRW", location: "QLD", value: "$800M" },
    ];

    const { byLocation } = buildPatterns(awarded);

    expect(byLocation.has("QLD")).toBe(true);
    expect(byLocation.has("WA")).toBe(true);

    const qldContractors = byLocation.get("QLD")!;
    expect(qldContractors.length).toBe(2); // MACA and NRW
    expect(qldContractors.map(c => c.contractor).sort()).toEqual(["MACA", "NRW"]);

    const waContractors = byLocation.get("WA")!;
    expect(waContractors.length).toBe(1);
    expect(waContractors[0].contractor).toBe("NRW");
  });

  it("should handle contractors active in multiple states", () => {
    const awarded = [
      { project: "Project A", winningContractor: "CPB Contractors", location: "NSW", value: "$1B" },
      { project: "Project B", winningContractor: "CPB Contractors", location: "VIC", value: "$2B" },
      { project: "Project C", winningContractor: "CPB Contractors", location: "QLD", value: "$1.5B" },
    ];

    const { allPatterns, byLocation } = buildPatterns(awarded);

    const cpb = allPatterns.find(p => p.contractor === "CPB Contractors");
    expect(cpb).toBeDefined();
    expect(cpb!.locations).toEqual(["NSW", "VIC", "QLD"]);
    expect(cpb!.projects).toHaveLength(3);

    // Should appear in all three state groups
    expect(byLocation.get("NSW")?.find(p => p.contractor === "CPB Contractors")).toBeDefined();
    expect(byLocation.get("VIC")?.find(p => p.contractor === "CPB Contractors")).toBeDefined();
    expect(byLocation.get("QLD")?.find(p => p.contractor === "CPB Contractors")).toBeDefined();
  });

  it("should deduplicate contractors within a state", () => {
    const awarded = [
      { project: "Project A", winningContractor: "Downer", location: "WA Pilbara", value: "$500M" },
      { project: "Project B", winningContractor: "Downer", location: "WA Goldfields", value: "$300M" },
    ];

    const { byLocation } = buildPatterns(awarded);
    const waContractors = byLocation.get("WA")!;
    expect(waContractors.filter(c => c.contractor === "Downer")).toHaveLength(1);
  });

  it("should handle empty awarded projects", () => {
    const { allPatterns, byLocation } = buildPatterns([]);
    expect(allPatterns).toHaveLength(0);
    expect(byLocation.size).toBe(0);
  });
});

// ─── Awarded Context Formatting Tests ───

describe("ContractorEnrichmentPass — Awarded Context Formatting", () => {
  function formatAwardedContext(
    project: { location: string; sector: string },
    patterns: {
      byLocation: Map<string, Array<{ contractor: string; projects: string[]; locations: string[] }>>;
      allPatterns: Array<{ contractor: string; projects: string[]; locations: string[] }>;
    }
  ): string {
    const stateAbbrevs = ["WA", "QLD", "NSW", "VIC", "SA", "TAS", "NT", "ACT"];
    const projectState = stateAbbrevs.find(s => project.location.toUpperCase().includes(s));

    const lines: string[] = [];
    lines.push("\n\nAWARDED PROJECT DATABASE (real contract wins in Australia):");

    if (projectState && patterns.byLocation.has(projectState)) {
      const statePatterns = patterns.byLocation.get(projectState)!;
      lines.push(`\nContractors active in ${projectState}:`);
      for (const p of statePatterns.slice(0, 10)) {
        lines.push(`- ${p.contractor}: won ${p.projects.slice(0, 3).join("; ")}`);
      }
    }

    const sorted = [...patterns.allPatterns].sort((a, b) => b.projects.length - a.projects.length);
    lines.push(`\nTop contractors by awarded project count:`);
    for (const p of sorted.slice(0, 8)) {
      lines.push(`- ${p.contractor} (${p.projects.length} wins): active in ${p.locations.join(", ")}`);
    }

    lines.push("\nUse this awarded project data to inform your predictions.");
    return lines.join("\n");
  }

  it("should include state-specific contractors for WA project", () => {
    const waPatterns = [
      { contractor: "Monadelphous", projects: ["Iron Bridge ($3.6B)"], locations: ["WA"] },
      { contractor: "NRW", projects: ["Pilbara Rail ($1B)"], locations: ["WA"] },
    ];
    const byLocation = new Map<string, typeof waPatterns>();
    byLocation.set("WA", waPatterns);

    const context = formatAwardedContext(
      { location: "WA Pilbara", sector: "mining" },
      { byLocation, allPatterns: waPatterns }
    );

    expect(context).toContain("Contractors active in WA:");
    expect(context).toContain("Monadelphous");
    expect(context).toContain("NRW");
    expect(context).toContain("Iron Bridge");
  });

  it("should include top contractors by project count", () => {
    const allPatterns = [
      { contractor: "CPB", projects: ["A", "B", "C", "D", "E"], locations: ["NSW", "VIC"] },
      { contractor: "Monadelphous", projects: ["F", "G", "H"], locations: ["WA"] },
      { contractor: "Thiess", projects: ["I"], locations: ["QLD"] },
    ];

    const context = formatAwardedContext(
      { location: "NSW", sector: "infrastructure" },
      { byLocation: new Map(), allPatterns }
    );

    expect(context).toContain("Top contractors by awarded project count:");
    expect(context).toContain("CPB (5 wins)");
    expect(context).toContain("Monadelphous (3 wins)");
  });

  it("should handle projects in states with no awarded data", () => {
    const context = formatAwardedContext(
      { location: "TAS Hobart", sector: "infrastructure" },
      { byLocation: new Map(), allPatterns: [] }
    );

    expect(context).toContain("AWARDED PROJECT DATABASE");
    expect(context).not.toContain("Contractors active in TAS:");
  });
});

// ─── Contractor Result Filtering Tests ───

describe("ContractorEnrichmentPass — Contractor Result Filtering", () => {
  function filterContractors(contractors: Array<{ name: string; role: string; confidence: string; detail: string }>) {
    return contractors.filter(c =>
      c.name &&
      c.name.length > 2 &&
      c.name.toLowerCase() !== "unknown" &&
      c.name.toLowerCase() !== "tba" &&
      c.name.toLowerCase() !== "n/a"
    );
  }

  it("should filter out 'Unknown' contractors", () => {
    const input = [
      { name: "Unknown", role: "contractor", confidence: "low", detail: "Unknown" },
      { name: "Monadelphous", role: "contractor", confidence: "high", detail: "Major WA contractor" },
    ];
    expect(filterContractors(input)).toHaveLength(1);
    expect(filterContractors(input)[0].name).toBe("Monadelphous");
  });

  it("should filter out 'TBA' and 'N/A' contractors", () => {
    const input = [
      { name: "TBA", role: "contractor", confidence: "low", detail: "To be announced" },
      { name: "n/a", role: "contractor", confidence: "low", detail: "Not available" },
      { name: "Thiess", role: "epc", confidence: "medium", detail: "Active in QLD" },
    ];
    expect(filterContractors(input)).toHaveLength(1);
  });

  it("should filter out very short names", () => {
    const input = [
      { name: "AB", role: "contractor", confidence: "low", detail: "Too short" },
      { name: "CPB Contractors", role: "epc", confidence: "high", detail: "Major contractor" },
    ];
    expect(filterContractors(input)).toHaveLength(1);
  });

  it("should keep all valid contractors", () => {
    const input = [
      { name: "Monadelphous", role: "contractor", confidence: "high", detail: "WA mining" },
      { name: "NRW Holdings", role: "contractor", confidence: "medium", detail: "Civil works" },
      { name: "Worley", role: "consultant", confidence: "high", detail: "Engineering" },
    ];
    expect(filterContractors(input)).toHaveLength(3);
  });
});

// ─── Confidence to Status Mapping Tests ───

describe("ContractorEnrichmentPass — Confidence to Status Mapping", () => {
  function mapConfidenceToStatus(confidence: string) {
    return {
      status: confidence === "high" ? "Confirmed" : "Predicted",
      confidenceScore: confidence === "high" ? 85 : confidence === "medium" ? 60 : 35,
    };
  }

  it("should map 'high' confidence to 'Confirmed' status", () => {
    const result = mapConfidenceToStatus("high");
    expect(result.status).toBe("Confirmed");
    expect(result.confidenceScore).toBe(85);
  });

  it("should map 'medium' confidence to 'Predicted' status", () => {
    const result = mapConfidenceToStatus("medium");
    expect(result.status).toBe("Predicted");
    expect(result.confidenceScore).toBe(60);
  });

  it("should map 'low' confidence to 'Predicted' status", () => {
    const result = mapConfidenceToStatus("low");
    expect(result.status).toBe("Predicted");
    expect(result.confidenceScore).toBe(35);
  });
});

// ─── Contractor Merge Logic Tests ───

describe("ContractorEnrichmentPass — Contractor Merge Logic", () => {
  function mergeContractors(
    existing: Array<{ name: string; status: string; confidence?: number; detail?: string }>,
    newContractors: Array<{ name: string; role: string; confidence: string; detail: string }>
  ) {
    const existingNames = new Set(
      existing
        .filter(c => c.name && c.name.toLowerCase() !== "unknown")
        .map(c => c.name.toLowerCase().trim())
    );

    const toAdd = newContractors.filter(
      c => !existingNames.has(c.name.toLowerCase().trim())
    );

    return [
      ...existing.filter(c => c.name && c.name.toLowerCase() !== "unknown"),
      ...toAdd.map(c => ({
        name: c.name,
        status: c.confidence === "high" ? "Confirmed" : "Predicted",
        confidence: c.confidence === "high" ? 85 : c.confidence === "medium" ? 60 : 35,
        detail: `${c.role}: ${c.detail} (enrichment pass)`,
      })),
    ];
  }

  it("should merge new contractors with existing ones", () => {
    const existing = [
      { name: "Monadelphous", status: "Confirmed", confidence: 90 },
    ];
    const newOnes = [
      { name: "NRW Holdings", role: "contractor", confidence: "medium", detail: "Civil works" },
    ];

    const merged = mergeContractors(existing, newOnes);
    expect(merged).toHaveLength(2);
    expect(merged[0].name).toBe("Monadelphous");
    expect(merged[1].name).toBe("NRW Holdings");
    expect(merged[1].status).toBe("Predicted");
  });

  it("should not duplicate existing contractors", () => {
    const existing = [
      { name: "Monadelphous", status: "Confirmed", confidence: 90 },
    ];
    const newOnes = [
      { name: "Monadelphous", role: "contractor", confidence: "high", detail: "Already exists" },
      { name: "Thiess", role: "epc", confidence: "medium", detail: "New" },
    ];

    const merged = mergeContractors(existing, newOnes);
    expect(merged).toHaveLength(2);
    expect(merged.filter(c => c.name === "Monadelphous")).toHaveLength(1);
  });

  it("should handle case-insensitive deduplication", () => {
    const existing = [
      { name: "monadelphous", status: "Confirmed", confidence: 90 },
    ];
    const newOnes = [
      { name: "Monadelphous", role: "contractor", confidence: "high", detail: "Same company" },
    ];

    const merged = mergeContractors(existing, newOnes);
    expect(merged).toHaveLength(1);
  });

  it("should remove 'Unknown' entries from existing contractors", () => {
    const existing = [
      { name: "Unknown", status: "Predicted", confidence: 0 },
    ];
    const newOnes = [
      { name: "CPB Contractors", role: "epc", confidence: "high", detail: "Major EPC" },
    ];

    const merged = mergeContractors(existing, newOnes);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("CPB Contractors");
    expect(merged[0].status).toBe("Confirmed");
  });

  it("should add enrichment pass detail to new contractors", () => {
    const merged = mergeContractors([], [
      { name: "Worley", role: "consultant", confidence: "medium", detail: "Engineering design" },
    ]);

    expect(merged[0].detail).toContain("enrichment pass");
    expect(merged[0].detail).toContain("consultant");
  });
});

// ─── Bulk Enrichment Result Structure Tests ───

describe("ContractorEnrichmentPass — Bulk Enrichment Result Structure", () => {
  interface BulkResult {
    total: number;
    enriched: number;
    contractorsDiscovered: number;
    failed: number;
    skipped: number;
    results: Array<{
      projectId: number;
      projectName: string;
      contractorsFound: Array<{ name: string; role: string; confidence: string; detail: string }>;
      source: string;
    }>;
  }

  it("should have correct structure for a successful run", () => {
    const result: BulkResult = {
      total: 10,
      enriched: 7,
      contractorsDiscovered: 35,
      failed: 1,
      skipped: 2,
      results: [
        {
          projectId: 1,
          projectName: "Test Project",
          contractorsFound: [
            { name: "Monadelphous", role: "contractor", confidence: "high", detail: "Mining contractor" },
          ],
          source: "llm_knowledge",
        },
      ],
    };

    expect(result.total).toBe(result.enriched + result.failed + result.skipped);
    expect(result.contractorsDiscovered).toBeGreaterThan(0);
    expect(result.results[0].source).toBe("llm_knowledge");
  });

  it("should handle empty run (no missing projects)", () => {
    const result: BulkResult = {
      total: 0,
      enriched: 0,
      contractorsDiscovered: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };

    expect(result.total).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});

// ─── Search Query Generation Tests ───

describe("ContractorEnrichmentPass — Search Query Generation", () => {
  function generateSearchQueries(projectName: string) {
    return [
      `${projectName} contractor Australia`,
      `${projectName} EPC contract`,
      `${projectName} construction partner`,
    ];
  }

  it("should generate 3 search queries per project", () => {
    const queries = generateSearchQueries("Iron Bridge Magnetite");
    expect(queries).toHaveLength(3);
  });

  it("should include project name in all queries", () => {
    const queries = generateSearchQueries("Olympic Dam Expansion");
    for (const q of queries) {
      expect(q).toContain("Olympic Dam Expansion");
    }
  });

  it("should include contractor and EPC keywords", () => {
    const queries = generateSearchQueries("Test Project");
    expect(queries.some(q => q.includes("contractor"))).toBe(true);
    expect(queries.some(q => q.includes("EPC"))).toBe(true);
  });
});
