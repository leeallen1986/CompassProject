/**
 * Government Major Projects Scraper — Unit Tests
 *
 * Tests the pure-function helpers exported from govScraper.ts:
 * - Business line matching
 * - Priority mapping (stage → hot/warm/cold)
 * - CAPEX grade mapping (dollar/MW values → A/B/Unknown)
 * - Opportunity route mapping
 * - Project data integrity
 */
import { describe, it, expect } from "vitest";
import { _testing } from "./govScraper";

const {
  matchBusinessLines,
  mapPriority,
  mapCapexGrade,
  mapOpportunityRoute,
  ALL_GOV_PROJECTS,
  INFRA_AUSTRALIA_PROJECTS,
  NREPL_PROJECTS,
} = _testing;

// ── Business Line Matching ──

describe("matchBusinessLines", () => {
  it("maps air hint to -1", () => {
    const result = matchBusinessLines({
      businessLineHints: ["air"],
    } as any);
    expect(result).toContain(-1);
  });

  it("maps bess hint to -2", () => {
    const result = matchBusinessLines({
      businessLineHints: ["bess"],
    } as any);
    expect(result).toContain(-2);
  });

  it("maps pal hint to -3", () => {
    const result = matchBusinessLines({
      businessLineHints: ["pal"],
    } as any);
    expect(result).toContain(-3);
  });

  it("maps pump hint to -4", () => {
    const result = matchBusinessLines({
      businessLineHints: ["pump"],
    } as any);
    expect(result).toContain(-4);
  });

  it("maps multiple hints correctly", () => {
    const result = matchBusinessLines({
      businessLineHints: ["air", "pal", "pump"],
    } as any);
    expect(result).toContain(-1);
    expect(result).toContain(-3);
    expect(result).toContain(-4);
    expect(result).not.toContain(-2);
  });

  it("returns all four for projects with all hints", () => {
    const result = matchBusinessLines({
      businessLineHints: ["air", "bess", "pal", "pump"],
    } as any);
    expect(result).toHaveLength(4);
    expect(result).toEqual(expect.arrayContaining([-1, -2, -3, -4]));
  });
});

// ── Priority Mapping ──

describe("mapPriority", () => {
  it("maps 'Under Construction' to hot", () => {
    expect(mapPriority("Under Construction — Phase 1", "$11 billion")).toBe("hot");
  });

  it("maps 'Early Works' to hot", () => {
    expect(mapPriority("Under Construction — Early Works", "$4.9 billion")).toBe("hot");
  });

  it("maps 'Approved — Construction 2025' to hot", () => {
    expect(mapPriority("Approved — Construction 2025", "$3.8 billion")).toBe("hot");
  });

  it("maps 'Approved — Construction 2026' to hot", () => {
    expect(mapPriority("Planning — Construction 2026", "$8 billion+")).toBe("hot");
  });

  it("maps 'Proposed' to warm", () => {
    expect(mapPriority("Proposed", "1,000 MW (Wind + Solar)")).toBe("warm");
  });

  it("maps 'Feasibility' to warm", () => {
    expect(mapPriority("Feasibility — Phased Expansion", "$10 billion+")).toBe("warm");
  });

  it("maps 'Approved — Route Selection' to hot (because 'approved' is hot)", () => {
    expect(mapPriority("Approved — Route Selection", "$3.3 billion")).toBe("hot");
  });

  it("maps 'Route Selection' without 'approved' to warm", () => {
    expect(mapPriority("Pending — Route Selection", "$3.3 billion")).toBe("warm");
  });

  it("maps unknown stages to cold", () => {
    expect(mapPriority("Completed", "$500 million")).toBe("cold");
  });
});

// ── CAPEX Grade Mapping ──

describe("mapCapexGrade", () => {
  it("grades $1+ billion as A", () => {
    expect(mapCapexGrade("$31.4 billion")).toBe("A");
    expect(mapCapexGrade("$11 billion")).toBe("A");
    expect(mapCapexGrade("$1.6 billion")).toBe("A");
  });

  it("grades $500M-$999M as A", () => {
    expect(mapCapexGrade("$567 million")).toBe("A");
    expect(mapCapexGrade("$800 million")).toBe("A");
  });

  it("grades $100M-$499M as B", () => {
    expect(mapCapexGrade("$275 million")).toBe("B");
    expect(mapCapexGrade("$100 million")).toBe("B");
  });

  it("grades 500+ MW as A", () => {
    expect(mapCapexGrade("1,000 MW (Wind + Solar)")).toBe("A");
    expect(mapCapexGrade("1,750 MW (Wind 1400 + BESS 350)")).toBe("A");
    expect(mapCapexGrade("702 MW (Wind)")).toBe("A");
  });

  it("grades 200-499 MW as B", () => {
    expect(mapCapexGrade("420 MW (Wind)")).toBe("B");
    expect(mapCapexGrade("200 MW (Solar)")).toBe("B");
  });

  it("returns Unknown for unrecognized values", () => {
    expect(mapCapexGrade("TBD")).toBe("Unknown");
    expect(mapCapexGrade("Not disclosed")).toBe("Unknown");
  });

  it("handles '$X billion+' format", () => {
    expect(mapCapexGrade("$8 billion+")).toBe("A");
    expect(mapCapexGrade("$10 billion+")).toBe("A");
  });

  it("handles combined MW values", () => {
    expect(mapCapexGrade("2,100 MW (Solar 900 + BESS 1200)")).toBe("A");
  });

  it("handles kV transmission values with dollar amounts", () => {
    expect(mapCapexGrade("$4.9 billion (500 kV, 360 km)")).toBe("A");
    expect(mapCapexGrade("$2.4 billion (330 kV, 900 km)")).toBe("A");
  });
});

// ── Opportunity Route Mapping ──

describe("mapOpportunityRoute", () => {
  it("maps hot to Direct CAPEX", () => {
    expect(mapOpportunityRoute("hot")).toBe("Direct CAPEX");
  });

  it("maps warm to Fleet CAPEX", () => {
    expect(mapOpportunityRoute("warm")).toBe("Fleet CAPEX");
  });

  it("maps cold to OPEX/Monitor", () => {
    expect(mapOpportunityRoute("cold")).toBe("OPEX/Monitor");
  });
});

// ── Project Data Integrity ──

describe("project data integrity", () => {
  it("has at least 40 total government projects", () => {
    expect(ALL_GOV_PROJECTS.length).toBeGreaterThanOrEqual(40);
  });

  it("has Infrastructure Australia projects", () => {
    expect(INFRA_AUSTRALIA_PROJECTS.length).toBeGreaterThanOrEqual(10);
  });

  it("has NREPL projects", () => {
    expect(NREPL_PROJECTS.length).toBeGreaterThanOrEqual(20);
  });

  it("all projects have required fields", () => {
    for (const project of ALL_GOV_PROJECTS) {
      expect(project.name).toBeTruthy();
      expect(project.owner).toBeTruthy();
      expect(project.state).toBeTruthy();
      expect(project.sector).toBeTruthy();
      expect(project.value).toBeTruthy();
      expect(project.stage).toBeTruthy();
      expect(project.description).toBeTruthy();
      expect(project.source.label).toBeTruthy();
      expect(project.source.url).toBeTruthy();
      expect(project.equipmentRelevance.length).toBeGreaterThan(0);
      expect(project.businessLineHints.length).toBeGreaterThan(0);
    }
  });

  it("all projects have valid sectors", () => {
    const validSectors = ["infrastructure", "energy", "mining", "defence"];
    for (const project of ALL_GOV_PROJECTS) {
      expect(validSectors).toContain(project.sector);
    }
  });

  it("all projects have valid business line hints", () => {
    const validHints = ["air", "bess", "pal", "pump"];
    for (const project of ALL_GOV_PROJECTS) {
      for (const hint of project.businessLineHints) {
        expect(validHints).toContain(hint);
      }
    }
  });

  it("includes key flagship projects", () => {
    const names = ALL_GOV_PROJECTS.map(p => p.name);
    expect(names).toContain("Inland Rail — Melbourne to Brisbane");
    expect(names).toContain("Snowy 2.0 Pumped Hydro");
    expect(names).toContain("Western Sydney International Airport");
    expect(names).toContain("Suburban Rail Loop — East Section");
    expect(names).toContain("HumeLink Transmission");
  });

  it("includes pump-relevant projects (dam, water infrastructure)", () => {
    const pumpProjects = ALL_GOV_PROJECTS.filter(p =>
      p.businessLineHints.includes("pump")
    );
    expect(pumpProjects.length).toBeGreaterThanOrEqual(15);

    const pumpNames = pumpProjects.map(p => p.name);
    expect(pumpNames).toContain("Warragamba Dam Wall Raising");
    expect(pumpNames).toContain("Snowy 2.0 Pumped Hydro");
  });

  it("includes BESS-relevant projects", () => {
    const bessProjects = ALL_GOV_PROJECTS.filter(p =>
      p.businessLineHints.includes("bess")
    );
    expect(bessProjects.length).toBeGreaterThanOrEqual(4);
  });

  it("includes defence projects", () => {
    const defenceProjects = ALL_GOV_PROJECTS.filter(p => p.sector === "defence");
    expect(defenceProjects.length).toBeGreaterThanOrEqual(2);
  });

  it("all Infrastructure Australia projects have dollar values", () => {
    for (const project of INFRA_AUSTRALIA_PROJECTS) {
      expect(project.value).toMatch(/\$/);
    }
  });

  it("all NREPL projects have MW or dollar values", () => {
    for (const project of NREPL_PROJECTS) {
      expect(project.value).toMatch(/MW|\$/);
    }
  });

  it("project names are unique", () => {
    const names = ALL_GOV_PROJECTS.map(p => p.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it("covers multiple Australian states", () => {
    const states = new Set(ALL_GOV_PROJECTS.map(p => p.state));
    expect(states.size).toBeGreaterThanOrEqual(5);
    // Should cover major states
    const allStatesStr = [...states].join(",");
    expect(allStatesStr).toContain("NSW");
    expect(allStatesStr).toContain("VIC");
    expect(allStatesStr).toContain("QLD");
    expect(allStatesStr).toContain("WA");
    expect(allStatesStr).toContain("SA");
  });
});

// ── Category Coverage ──

describe("category coverage", () => {
  it("includes transmission projects", () => {
    const transmission = ALL_GOV_PROJECTS.filter(p =>
      p.category.includes("Transmission")
    );
    expect(transmission.length).toBeGreaterThanOrEqual(5);
  });

  it("includes generation projects", () => {
    const generation = ALL_GOV_PROJECTS.filter(p =>
      p.category.includes("Generation")
    );
    expect(generation.length).toBeGreaterThanOrEqual(10);
  });

  it("includes water infrastructure projects", () => {
    const water = ALL_GOV_PROJECTS.filter(p =>
      p.category.includes("Water")
    );
    expect(water.length).toBeGreaterThanOrEqual(3);
  });

  it("includes national connectivity projects", () => {
    const connectivity = ALL_GOV_PROJECTS.filter(p =>
      p.category.includes("Connectivity")
    );
    expect(connectivity.length).toBeGreaterThanOrEqual(5);
  });
});
