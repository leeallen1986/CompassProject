/**
 * Tests for AI Project Matcher — pre-filter logic and keyword expansion.
 * The LLM ranking is tested via integration; here we test the deterministic
 * pre-filter scoring that narrows 500+ projects to ~60 candidates.
 */
import { describe, it, expect } from "vitest";
import { preFilterProjects } from "./aiProjectMatcher";

// ── Helper: create a mock project ──
function mockProject(overrides: Partial<{
  id: number;
  name: string;
  location: string;
  owner: string;
  overview: string;
  sector: string;
  priority: string;
  capexGrade: string;
  equipmentSignals: string[];
  contractors: { name: string; status: string }[];
  opportunityNote: string;
  stage: string;
  value: string;
  opportunityRoute: string;
}> = {}) {
  return {
    id: overrides.id ?? 1,
    reportId: 1,
    projectKey: `test-${overrides.id ?? 1}`,
    name: overrides.name ?? "Test Project",
    location: overrides.location ?? "Perth, WA",
    value: overrides.value ?? "$100M",
    owner: overrides.owner ?? "Test Corp",
    priority: overrides.priority ?? "warm",
    capexGrade: overrides.capexGrade ?? "B",
    opportunityRoute: overrides.opportunityRoute ?? "Direct CAPEX",
    sector: overrides.sector ?? "mining",
    isNew: false,
    stage: overrides.stage ?? "Construction",
    overview: overrides.overview ?? "A mining project in Western Australia",
    equipmentSignals: overrides.equipmentSignals ?? [],
    contractors: overrides.contractors ?? [],
    opportunityNote: overrides.opportunityNote ?? "",
    sources: [],
    timeline: "2025-2027",
    completion: "2027",
    matchedBusinessLines: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
}

describe("preFilterProjects", () => {
  it("returns empty array when no projects match", () => {
    const projects = [
      mockProject({ id: 1, name: "Bakery Shop Renovation", overview: "Renovating a local bakery", sector: "defence", location: "Melbourne", owner: "Baker Co" }),
    ];
    // Use a very specific query that won't expand to match any of the project's text
    const results = preFilterProjects("xyzqwerty", projects);
    expect(results.length).toBe(0);
  });

  it("matches direct keyword in project name", () => {
    const projects = [
      mockProject({ id: 1, name: "BHP Drilling Campaign", overview: "RC drilling program" }),
      mockProject({ id: 2, name: "Solar Farm Installation", overview: "Solar panels" }),
    ];
    const results = preFilterProjects("drilling", projects);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].project.id).toBe(1);
  });

  it("matches expanded keywords from product knowledge", () => {
    const projects = [
      mockProject({ id: 1, name: "Pipeline Purging Project", overview: "Gas pipeline purging and inerting operations" }),
      mockProject({ id: 2, name: "Road Construction", overview: "Highway construction project" }),
    ];
    // "N2" should expand to include "pipeline", "purging", "inerting"
    const results = preFilterProjects("N2", projects);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].project.id).toBe(1);
  });

  it("boosts hot projects over warm/cold with same keyword match", () => {
    const projects = [
      mockProject({ id: 1, name: "Mining Compressor Project A", priority: "cold" }),
      mockProject({ id: 2, name: "Mining Compressor Project B", priority: "hot" }),
      mockProject({ id: 3, name: "Mining Compressor Project C", priority: "warm" }),
    ];
    const results = preFilterProjects("compressor", projects);
    expect(results.length).toBe(3);
    // Hot should be ranked first due to priority boost
    expect(results[0].project.id).toBe(2);
  });

  it("boosts CAPEX grade A over B", () => {
    const projects = [
      mockProject({ id: 1, name: "Dewatering Pump Project X", capexGrade: "B", priority: "warm" }),
      mockProject({ id: 2, name: "Dewatering Pump Project Y", capexGrade: "A", priority: "warm" }),
    ];
    const results = preFilterProjects("dewatering", projects);
    expect(results.length).toBe(2);
    expect(results[0].project.id).toBe(2);
  });

  it("matches equipment signals", () => {
    const projects = [
      mockProject({ id: 1, name: "Gold Mine Expansion", equipmentSignals: ["portable compressor", "lighting tower"] }),
      mockProject({ id: 2, name: "Office Building", equipmentSignals: [] }),
    ];
    const results = preFilterProjects("compressor", projects);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].project.id).toBe(1);
  });

  it("matches contractor names", () => {
    const projects = [
      mockProject({ id: 1, name: "Iron Ore Mine", contractors: [{ name: "Thiess Mining", status: "confirmed" }] }),
      mockProject({ id: 2, name: "Residential Development", contractors: [] }),
    ];
    const results = preFilterProjects("Thiess", projects);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].project.id).toBe(1);
  });

  it("expands BESS keywords to match battery/solar/hybrid projects", () => {
    const projects = [
      mockProject({ id: 1, name: "Remote Mine Hybrid Power", overview: "Battery energy storage with solar hybrid for remote mining camp" }),
      mockProject({ id: 2, name: "Coal Transport Rail", overview: "Rail infrastructure for coal transport" }),
    ];
    const results = preFilterProjects("bess", projects);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].project.id).toBe(1);
  });

  it("limits results to top 60", () => {
    // Create 100 matching projects
    const projects = Array.from({ length: 100 }, (_, i) =>
      mockProject({ id: i + 1, name: `Mining Compressor Project ${i + 1}`, overview: "Compressor needed for mining" })
    );
    const results = preFilterProjects("compressor mining", projects);
    expect(results.length).toBeLessThanOrEqual(60);
  });

  it("handles multi-word queries", () => {
    const projects = [
      mockProject({ id: 1, name: "Blast Hole Drilling Program", overview: "Large blast hole drilling for iron ore mine" }),
      mockProject({ id: 2, name: "Diamond Core Exploration", overview: "Diamond core drilling for gold exploration" }),
      mockProject({ id: 3, name: "Office Renovation", overview: "Interior renovation" }),
    ];
    const results = preFilterProjects("blast hole drilling", projects);
    // All projects may match via keyword expansion (drilling → mining, construction, etc.)
    expect(results.length).toBeGreaterThanOrEqual(2);
    // The blast hole one should rank highest due to most direct matches
    expect(results[0].project.id).toBe(1);
  });

  it("matches ZenergiZe product name to BESS projects", () => {
    const projects = [
      mockProject({ id: 1, name: "Microgrid Installation", overview: "Battery storage microgrid for remote community", sector: "energy" }),
      mockProject({ id: 2, name: "Highway Bridge", overview: "Bridge construction" }),
    ];
    const results = preFilterProjects("zenergize", projects);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].project.id).toBe(1);
  });

  it("matches pump-related queries to dewatering projects", () => {
    const projects = [
      mockProject({ id: 1, name: "Flood Recovery Pumping", overview: "Emergency dewatering and flood recovery operations" }),
      mockProject({ id: 2, name: "Solar Panel Farm", overview: "Utility scale solar installation" }),
    ];
    const results = preFilterProjects("pump flood", projects);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].project.id).toBe(1);
  });

  it("matches location-based searches", () => {
    const projects = [
      mockProject({ id: 1, name: "Pilbara Iron Ore Mine", location: "Pilbara, WA" }),
      mockProject({ id: 2, name: "Sydney Office Tower", location: "Sydney, NSW" }),
    ];
    const results = preFilterProjects("Pilbara", projects);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].project.id).toBe(1);
  });

  it("matches owner name searches", () => {
    const projects = [
      mockProject({ id: 1, name: "Olympic Dam Expansion", owner: "BHP" }),
      mockProject({ id: 2, name: "Residential Complex", owner: "Lendlease" }),
    ];
    const results = preFilterProjects("BHP", projects);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].project.id).toBe(1);
  });
});
