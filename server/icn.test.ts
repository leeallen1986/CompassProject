import { describe, it, expect } from "vitest";
import { _testing } from "./icnScraper";

const {
  matchBusinessLines,
  mapPriority,
  mapCapexGrade,
  ICN_PROJECTS,
} = _testing;

// ── Data Integrity ──

describe("ICN project data integrity", () => {
  it("has at least 20 curated projects", () => {
    expect(ICN_PROJECTS.length).toBeGreaterThanOrEqual(20);
  });

  it("all projects have required fields", () => {
    for (const p of ICN_PROJECTS) {
      expect(p.name).toBeTruthy();
      expect(p.owner).toBeTruthy();
      expect(p.state).toBeTruthy();
      expect(p.sector).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(p.equipmentRelevance.length).toBeGreaterThan(0);
      expect(p.businessLineHints.length).toBeGreaterThan(0);
    }
  });

  it("all projects have valid sectors", () => {
    const validSectors = ["infrastructure", "energy", "mining", "oil_gas", "defence"];
    for (const p of ICN_PROJECTS) {
      expect(validSectors).toContain(p.sector);
    }
  });

  it("all projects have valid Australian states", () => {
    const validStates = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "NT", "ACT"];
    for (const p of ICN_PROJECTS) {
      expect(validStates).toContain(p.state);
    }
  });

  it("all projects have valid business line hints", () => {
    const validHints = ["air", "pal", "bess", "pump"];
    for (const p of ICN_PROJECTS) {
      for (const hint of p.businessLineHints) {
        expect(validHints).toContain(hint);
      }
    }
  });

  it("work packages have non-negative values", () => {
    for (const p of ICN_PROJECTS) {
      expect(p.workPackages.total).toBeGreaterThanOrEqual(0);
      expect(p.workPackages.open).toBeGreaterThanOrEqual(0);
      expect(p.workPackages.awarded).toBeGreaterThanOrEqual(0);
      expect(p.workPackages.closed).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── Sector Coverage ──

describe("ICN sector coverage", () => {
  it("covers defence projects", () => {
    const defence = ICN_PROJECTS.filter(p => p.sector === "defence");
    expect(defence.length).toBeGreaterThanOrEqual(3);
  });

  it("covers mining projects", () => {
    const mining = ICN_PROJECTS.filter(p => p.sector === "mining");
    expect(mining.length).toBeGreaterThanOrEqual(3);
  });

  it("covers infrastructure projects", () => {
    const infra = ICN_PROJECTS.filter(p => p.sector === "infrastructure");
    expect(infra.length).toBeGreaterThanOrEqual(3);
  });

  it("covers energy projects", () => {
    const energy = ICN_PROJECTS.filter(p => p.sector === "energy");
    expect(energy.length).toBeGreaterThanOrEqual(1);
  });

  it("covers oil & gas projects", () => {
    const oilGas = ICN_PROJECTS.filter(p => p.sector === "oil_gas");
    expect(oilGas.length).toBeGreaterThanOrEqual(2);
  });
});

// ── State Coverage ──

describe("ICN state coverage", () => {
  it("covers multiple Australian states", () => {
    const states = new Set(ICN_PROJECTS.map(p => p.state));
    expect(states.size).toBeGreaterThanOrEqual(4);
  });

  it("includes major resource states (WA, QLD, NSW)", () => {
    const states = new Set(ICN_PROJECTS.map(p => p.state));
    expect(states.has("WA")).toBe(true);
    expect(states.has("QLD")).toBe(true);
    expect(states.has("NSW")).toBe(true);
  });
});

// ── Business Line Matching ──

describe("matchBusinessLines", () => {
  it("maps air hint to -1", () => {
    const project = ICN_PROJECTS.find(p => p.businessLineHints.includes("air"))!;
    const ids = matchBusinessLines(project);
    expect(ids).toContain(-1);
  });

  it("maps pal hint to -3", () => {
    const project = ICN_PROJECTS.find(p => p.businessLineHints.includes("pal"))!;
    const ids = matchBusinessLines(project);
    expect(ids).toContain(-3);
  });

  it("maps bess hint to -2", () => {
    const project = ICN_PROJECTS.find(p => p.businessLineHints.includes("bess"))!;
    const ids = matchBusinessLines(project);
    expect(ids).toContain(-2);
  });

  it("maps pump hint to -4", () => {
    const project = ICN_PROJECTS.find(p => p.businessLineHints.includes("pump"))!;
    const ids = matchBusinessLines(project);
    expect(ids).toContain(-4);
  });

  it("maps multiple hints correctly", () => {
    const project = ICN_PROJECTS.find(p => p.businessLineHints.length >= 3)!;
    const ids = matchBusinessLines(project);
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Priority Mapping ──

describe("mapPriority", () => {
  it("maps projects with open work packages to hot", () => {
    const project = {
      ...ICN_PROJECTS[0],
      workPackages: { total: 10, open: 3, awarded: 5, closed: 2 },
    };
    expect(mapPriority(project)).toBe("hot");
  });

  it("maps projects with many awarded but no open to warm", () => {
    const project = {
      ...ICN_PROJECTS[0],
      workPackages: { total: 20, open: 0, awarded: 15, closed: 5 },
    };
    expect(mapPriority(project)).toBe("warm");
  });

  it("maps mostly closed projects to cold", () => {
    const project = {
      ...ICN_PROJECTS[0],
      workPackages: { total: 10, open: 0, awarded: 3, closed: 7 },
    };
    expect(mapPriority(project)).toBe("cold");
  });
});

// ── CAPEX Grade ──

describe("mapCapexGrade", () => {
  it("maps billion-dollar projects to A", () => {
    expect(mapCapexGrade("$45 billion")).toBe("A");
    expect(mapCapexGrade("$1.6 billion")).toBe("A");
    expect(mapCapexGrade("$368 billion (lifecycle)")).toBe("A");
  });

  it("maps $500M+ to A", () => {
    expect(mapCapexGrade("$567 million")).toBe("A");
  });

  it("maps $100M-$500M to B", () => {
    expect(mapCapexGrade("$275 million")).toBe("B");
  });

  it("maps unknown values to Unknown", () => {
    expect(mapCapexGrade(undefined)).toBe("Unknown");
    expect(mapCapexGrade("Not disclosed")).toBe("Unknown");
  });

  it("handles $X+ billion format", () => {
    expect(mapCapexGrade("$10+ billion")).toBe("A");
    expect(mapCapexGrade("$5+ billion")).toBe("A");
  });
});

// ── Business Line Coverage ──

describe("business line coverage across ICN projects", () => {
  it("most projects include Portable Air", () => {
    const airProjects = ICN_PROJECTS.filter(p => p.businessLineHints.includes("air"));
    expect(airProjects.length).toBeGreaterThanOrEqual(15);
  });

  it("most projects include PAL", () => {
    const palProjects = ICN_PROJECTS.filter(p => p.businessLineHints.includes("pal"));
    expect(palProjects.length).toBeGreaterThanOrEqual(15);
  });

  it("some projects include Pump", () => {
    const pumpProjects = ICN_PROJECTS.filter(p => p.businessLineHints.includes("pump"));
    expect(pumpProjects.length).toBeGreaterThanOrEqual(10);
  });

  it("some projects include BESS", () => {
    const bessProjects = ICN_PROJECTS.filter(p => p.businessLineHints.includes("bess"));
    expect(bessProjects.length).toBeGreaterThanOrEqual(1);
  });
});

// ── High-Value Projects ──

describe("high-value ICN projects", () => {
  it("includes AUKUS submarine program", () => {
    const aukus = ICN_PROJECTS.find(p => p.name.toLowerCase().includes("aukus"));
    expect(aukus).toBeDefined();
    expect(aukus!.sector).toBe("defence");
  });

  it("includes Hunter Class Frigate", () => {
    const frigate = ICN_PROJECTS.find(p => p.name.toLowerCase().includes("hunter class"));
    expect(frigate).toBeDefined();
    expect(frigate!.sector).toBe("defence");
  });

  it("includes Sydney Metro", () => {
    const metro = ICN_PROJECTS.find(p => p.name.toLowerCase().includes("sydney metro"));
    expect(metro).toBeDefined();
    expect(metro!.sector).toBe("infrastructure");
  });

  it("includes Suburban Rail Loop", () => {
    const srl = ICN_PROJECTS.find(p => p.name.toLowerCase().includes("suburban rail loop"));
    expect(srl).toBeDefined();
    expect(srl!.sector).toBe("infrastructure");
  });

  it("includes Pilbara mining projects", () => {
    const pilbara = ICN_PROJECTS.filter(p =>
      p.name.toLowerCase().includes("pilbara") || p.state === "WA" && p.sector === "mining"
    );
    expect(pilbara.length).toBeGreaterThanOrEqual(2);
  });
});
