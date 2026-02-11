/**
 * Territory Filter Tests
 *
 * Tests the locationMatchesTerritory function used for dashboard filtering.
 * The function is defined in client/src/lib/personalization.ts but we replicate
 * the logic here for server-side testing since the filtering is a critical feature.
 */
import { describe, it, expect } from "vitest";

// Replicate the state abbreviation mapping used in the client
const stateAbbreviations: Record<string, string[]> = {
  WA: ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha", "port hedland", "newman", "geraldton", "bunbury", "broome"],
  QLD: ["queensland", "qld", "brisbane", "townsville", "mackay", "gladstone", "rockhampton", "cairns", "bowen basin", "moranbah", "emerald"],
  NSW: ["new south wales", "nsw", "sydney", "newcastle", "hunter valley", "wollongong", "broken hill", "orange", "dubbo", "mudgee"],
  VIC: ["victoria", "vic", "melbourne", "geelong", "ballarat", "bendigo", "latrobe valley"],
  SA: ["south australia", "sa", "adelaide", "olympic dam", "whyalla", "port augusta"],
  NT: ["northern territory", "nt", "darwin", "alice springs", "tennant creek", "katherine"],
  TAS: ["tasmania", "tas", "hobart", "launceston"],
  ACT: ["australian capital territory", "act", "canberra"],
  OFFSHORE: ["offshore", "fpso", "nwshelf", "north west shelf", "browse", "timor sea", "bass strait"],
};

function locationMatchesTerritory(location: string, territories: string[]): boolean {
  const loc = location.toLowerCase();
  for (const territory of territories) {
    const keywords = stateAbbreviations[territory.toUpperCase()] || [territory.toLowerCase()];
    if (keywords.some(kw => loc.includes(kw))) return true;
  }
  return false;
}

describe("Territory Filter — locationMatchesTerritory", () => {
  it("matches WA locations by state name", () => {
    expect(locationMatchesTerritory("Western Australia", ["WA"])).toBe(true);
  });

  it("matches WA locations by city name (Pilbara)", () => {
    expect(locationMatchesTerritory("Pilbara, WA", ["WA"])).toBe(true);
  });

  it("matches WA locations by city name (Kalgoorlie)", () => {
    expect(locationMatchesTerritory("Kalgoorlie-Boulder", ["WA"])).toBe(true);
  });

  it("matches WA locations by city name (Karratha)", () => {
    expect(locationMatchesTerritory("Karratha, Western Australia", ["WA"])).toBe(true);
  });

  it("matches WA locations by city name (Newman)", () => {
    expect(locationMatchesTerritory("Newman, Pilbara Region", ["WA"])).toBe(true);
  });

  it("does NOT match QLD location when filtering for WA only", () => {
    expect(locationMatchesTerritory("Brisbane, Queensland", ["WA"])).toBe(false);
  });

  it("does NOT match NSW location when filtering for WA only", () => {
    expect(locationMatchesTerritory("Hunter Valley, NSW", ["WA"])).toBe(false);
  });

  it("does NOT match SA location when filtering for WA only", () => {
    expect(locationMatchesTerritory("Olympic Dam, South Australia", ["WA"])).toBe(false);
  });

  it("matches QLD locations when filtering for QLD", () => {
    expect(locationMatchesTerritory("Bowen Basin, QLD", ["QLD"])).toBe(true);
  });

  it("matches multiple territories (WA or QLD)", () => {
    expect(locationMatchesTerritory("Perth, WA", ["WA", "QLD"])).toBe(true);
    expect(locationMatchesTerritory("Brisbane, QLD", ["WA", "QLD"])).toBe(true);
    expect(locationMatchesTerritory("Sydney, NSW", ["WA", "QLD"])).toBe(false);
  });

  it("handles empty territories (no filter applied)", () => {
    // When territories is empty, the filter should not be applied (handled by caller)
    expect(locationMatchesTerritory("Perth, WA", [])).toBe(false);
  });

  it("handles case-insensitive matching", () => {
    expect(locationMatchesTerritory("WESTERN AUSTRALIA", ["WA"])).toBe(true);
    expect(locationMatchesTerritory("perth", ["WA"])).toBe(true);
    expect(locationMatchesTerritory("PILBARA", ["WA"])).toBe(true);
  });

  it("matches offshore locations", () => {
    expect(locationMatchesTerritory("North West Shelf, Offshore WA", ["OFFSHORE"])).toBe(true);
    expect(locationMatchesTerritory("Browse Basin FPSO", ["OFFSHORE"])).toBe(true);
  });

  it("matches NT locations", () => {
    expect(locationMatchesTerritory("Darwin, Northern Territory", ["NT"])).toBe(true);
    expect(locationMatchesTerritory("Tennant Creek, NT", ["NT"])).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(locationMatchesTerritory("International - Papua New Guinea", ["WA"])).toBe(false);
    expect(locationMatchesTerritory("Unknown Location", ["WA"])).toBe(false);
  });
});

describe("Territory Filter — Dashboard Integration Logic", () => {
  // Simulate the filtering logic used in Home.tsx
  interface MockProject {
    name: string;
    location: string;
    priority: "hot" | "warm" | "cold";
  }

  const mockProjects: MockProject[] = [
    { name: "Pilbara Iron Ore Expansion", location: "Pilbara, Western Australia", priority: "hot" },
    { name: "Bowen Basin Coal Mine", location: "Bowen Basin, QLD", priority: "hot" },
    { name: "Olympic Dam Expansion", location: "Olympic Dam, South Australia", priority: "warm" },
    { name: "Perth Metro Rail", location: "Perth, WA", priority: "warm" },
    { name: "Darwin LNG Plant", location: "Darwin, NT", priority: "cold" },
    { name: "Hunter Valley Mine", location: "Hunter Valley, NSW", priority: "cold" },
    { name: "Kalgoorlie Gold Project", location: "Kalgoorlie, WA", priority: "hot" },
  ];

  it("filters to only WA projects when territory is WA", () => {
    const waProjects = mockProjects.filter(p =>
      locationMatchesTerritory(p.location, ["WA"])
    );
    expect(waProjects).toHaveLength(3);
    expect(waProjects.map(p => p.name)).toEqual([
      "Pilbara Iron Ore Expansion",
      "Perth Metro Rail",
      "Kalgoorlie Gold Project",
    ]);
  });

  it("filters to WA + QLD projects when territories are WA and QLD", () => {
    const filtered = mockProjects.filter(p =>
      locationMatchesTerritory(p.location, ["WA", "QLD"])
    );
    expect(filtered).toHaveLength(4);
    expect(filtered.map(p => p.name)).toContain("Bowen Basin Coal Mine");
    expect(filtered.map(p => p.name)).toContain("Pilbara Iron Ore Expansion");
  });

  it("shows all projects when showAllTerritories is true (bypass filter)", () => {
    const showAllTerritories = true;
    const userTerritories = ["WA"];

    const filtered = (showAllTerritories || userTerritories.length === 0)
      ? mockProjects
      : mockProjects.filter(p => locationMatchesTerritory(p.location, userTerritories));

    expect(filtered).toHaveLength(7);
  });

  it("shows all projects when user has no territory preferences", () => {
    const showAllTerritories = false;
    const userTerritories: string[] = [];

    const filtered = (showAllTerritories || userTerritories.length === 0)
      ? mockProjects
      : mockProjects.filter(p => locationMatchesTerritory(p.location, userTerritories));

    expect(filtered).toHaveLength(7);
  });

  it("KPI counts reflect filtered projects", () => {
    const waProjects = mockProjects.filter(p =>
      locationMatchesTerritory(p.location, ["WA"])
    );
    const hot = waProjects.filter(p => p.priority === "hot").length;
    const warm = waProjects.filter(p => p.priority === "warm").length;
    const cold = waProjects.filter(p => p.priority === "cold").length;

    expect(hot).toBe(2); // Pilbara + Kalgoorlie
    expect(warm).toBe(1); // Perth Metro
    expect(cold).toBe(0); // None
    expect(waProjects.length).toBe(3);
  });
});
