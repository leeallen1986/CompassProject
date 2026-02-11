import { describe, expect, it } from "vitest";

/**
 * Tests for business line filter feature (Power Technique division only):
 * 1. Keyword matching logic correctly tags projects for Portable Air and Power Technique
 * 2. Filter logic correctly filters projects by business line ID
 */
import { matchKeywords } from "./rssHarvester";
import type { BusinessLine } from "../drizzle/schema";

const mockBusinessLines: BusinessLine[] = [
  {
    id: 1,
    name: "Portable Air",
    description: "Portable compressors",
    keywords: ["compressor", "drilling", "portable air", "blasting", "pneumatic"],
    sectors: ["mining", "infrastructure"],
    equipmentTypes: ["Portable Compressor"],
    defaultTerritories: ["WA", "QLD"],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 2,
    name: "Power Technique",
    description: "Generators and pumps",
    keywords: ["generator", "dewatering pump", "lighting tower", "temporary power"],
    sectors: ["mining", "infrastructure"],
    equipmentTypes: ["Diesel Generator"],
    defaultTerritories: ["WA"],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

// ── matchKeywords returns correct business line IDs ──

describe("matchKeywords for PT business line tagging", () => {
  it("tags a drilling project with Portable Air", () => {
    const result = matchKeywords(
      "BHP Olympic Dam Drilling Campaign",
      "Major RC drilling program requiring portable compressor fleet",
      mockBusinessLines
    );
    expect(result.matchedBusinessLineIds).toContain(1); // Portable Air
    expect(result.matchedKeywords).toContain("drilling");
    expect(result.matchedKeywords).toContain("compressor");
  });

  it("tags a generator project with Power Technique", () => {
    const result = matchKeywords(
      "Mine Site Power Upgrade",
      "Installation of temporary power generator for construction phase",
      mockBusinessLines
    );
    expect(result.matchedBusinessLineIds).toContain(2); // Power Technique
    expect(result.matchedKeywords).toContain("generator");
  });

  it("tags a project matching both Portable Air and Power Technique", () => {
    const result = matchKeywords(
      "Mining Project Needs Compressor and Generator",
      "The site requires both portable air compressor and diesel generator for drilling operations",
      mockBusinessLines
    );
    expect(result.matchedBusinessLineIds).toContain(1); // Portable Air
    expect(result.matchedBusinessLineIds).toContain(2); // Power Technique
    expect(result.matchedBusinessLineIds).toHaveLength(2);
  });

  it("tags dewatering pump project with Power Technique", () => {
    const result = matchKeywords(
      "Flood Recovery Dewatering",
      "Emergency dewatering pump deployment for flooded mine pit",
      mockBusinessLines
    );
    expect(result.matchedBusinessLineIds).toContain(2); // Power Technique
    expect(result.matchedKeywords).toContain("dewatering pump");
  });

  it("tags lighting tower project with Power Technique", () => {
    const result = matchKeywords(
      "Night Shift Operations",
      "Portable lighting tower rental for construction site night operations",
      mockBusinessLines
    );
    expect(result.matchedBusinessLineIds).toContain(2); // Power Technique
    expect(result.matchedKeywords).toContain("lighting tower");
  });

  it("returns empty arrays for unrelated content", () => {
    const result = matchKeywords(
      "Local Council Meeting Minutes",
      "Discussion about park maintenance and road resurfacing budget",
      mockBusinessLines
    );
    expect(result.matchedBusinessLineIds).toHaveLength(0);
    expect(result.matchedKeywords).toHaveLength(0);
  });
});

// ── Client-side filter logic ──

interface MockProject {
  id: number;
  name: string;
  matchedBusinessLines: number[] | null;
  priority: "hot" | "warm" | "cold";
  sector: string;
}

function filterByBusinessLine(projects: MockProject[], businessLineFilter: string): MockProject[] {
  if (businessLineFilter === "all") return projects;
  return projects.filter(p => {
    const blIds = p.matchedBusinessLines;
    if (!blIds || blIds.length === 0) return false;
    return blIds.includes(Number(businessLineFilter));
  });
}

describe("filterByBusinessLine (PT division)", () => {
  const mockProjects: MockProject[] = [
    { id: 1, name: "Drilling Project", matchedBusinessLines: [1, 2], priority: "hot", sector: "mining" },
    { id: 2, name: "Generator Project", matchedBusinessLines: [2], priority: "warm", sector: "infrastructure" },
    { id: 3, name: "Compressor Only", matchedBusinessLines: [1], priority: "cold", sector: "mining" },
    { id: 4, name: "Both Divisions", matchedBusinessLines: [1, 2], priority: "hot", sector: "mining" },
    { id: 5, name: "Legacy Project", matchedBusinessLines: null, priority: "warm", sector: "mining" },
  ];

  it("returns all projects when filter is 'all'", () => {
    const result = filterByBusinessLine(mockProjects, "all");
    expect(result).toHaveLength(5);
  });

  it("filters by Portable Air (id=1)", () => {
    const result = filterByBusinessLine(mockProjects, "1");
    expect(result).toHaveLength(3);
    expect(result.map(p => p.id)).toEqual([1, 3, 4]);
  });

  it("filters by Power Technique (id=2)", () => {
    const result = filterByBusinessLine(mockProjects, "2");
    expect(result).toHaveLength(3);
    expect(result.map(p => p.id)).toEqual([1, 2, 4]);
  });

  it("excludes projects with null matchedBusinessLines", () => {
    const result = filterByBusinessLine(mockProjects, "1");
    expect(result.find(p => p.id === 5)).toBeUndefined();
  });

  it("returns empty array for non-existent business line", () => {
    const result = filterByBusinessLine(mockProjects, "999");
    expect(result).toHaveLength(0);
  });
});
