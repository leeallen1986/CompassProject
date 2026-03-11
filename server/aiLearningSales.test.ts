/**
 * AI Learning Sales Support — Test Suite
 *
 * Tests for:
 * - Behaviour Analysis (working style profile)
 * - Persona Coaching (pain-point libraries, role personas, pre-call coaching)
 * - Weekly Coaching (coaching engine)
 * - Next Best Action (NBA generation)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Persona Coaching Tests ──

describe("personaCoaching", () => {
  describe("pain-point libraries", () => {
    it("should have libraries for all 5 segments", async () => {
      const { getAllSegmentPainLibraries } = await import("./personaCoaching");
      const libraries = getAllSegmentPainLibraries();
      expect(libraries).toHaveLength(5);
      const segments = libraries.map(l => l.segment);
      expect(segments).toContain("mining");
      expect(segments).toContain("oil_gas");
      expect(segments).toContain("infrastructure");
      expect(segments).toContain("energy");
      expect(segments).toContain("defence");
    });

    it("each segment should have at least 2 pain points", async () => {
      const { getAllSegmentPainLibraries } = await import("./personaCoaching");
      const libraries = getAllSegmentPainLibraries();
      for (const lib of libraries) {
        expect(lib.painPoints.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("each pain point should have required fields", async () => {
      const { getAllSegmentPainLibraries } = await import("./personaCoaching");
      const libraries = getAllSegmentPainLibraries();
      for (const lib of libraries) {
        for (const pp of lib.painPoints) {
          expect(pp.pain).toBeTruthy();
          expect(pp.context).toBeTruthy();
          expect(pp.atlasCopcoBridge).toBeTruthy();
          expect(pp.relevantBLs.length).toBeGreaterThan(0);
        }
      }
    });

    it("should return a specific segment library", async () => {
      const { getSegmentPainLibrary } = await import("./personaCoaching");
      const mining = getSegmentPainLibrary("mining");
      expect(mining).not.toBeNull();
      expect(mining!.segment).toBe("mining");
      expect(mining!.segmentLabel).toBe("Mining & Resources");
    });

    it("should return null for unknown segment", async () => {
      const { getSegmentPainLibrary } = await import("./personaCoaching");
      const result = getSegmentPainLibrary("unknown_segment");
      expect(result).toBeNull();
    });
  });

  describe("role personas", () => {
    it("should have 4 role personas", async () => {
      const { getAllRolePersonas } = await import("./personaCoaching");
      const personas = getAllRolePersonas();
      expect(personas).toHaveLength(4);
      const roles = personas.map(p => p.role);
      expect(roles).toContain("procurement");
      expect(roles).toContain("engineering");
      expect(roles).toContain("operations");
      expect(roles).toContain("project_management");
    });

    it("each persona should have complete fields", async () => {
      const { getAllRolePersonas } = await import("./personaCoaching");
      const personas = getAllRolePersonas();
      for (const p of personas) {
        expect(p.role).toBeTruthy();
        expect(p.roleLabel).toBeTruthy();
        expect(p.typicalTitles.length).toBeGreaterThan(0);
        expect(p.cares_about.length).toBeGreaterThan(0);
        expect(p.doesnt_care_about.length).toBeGreaterThan(0);
        expect(p.communication_style).toBeTruthy();
        expect(p.decision_influence).toBeTruthy();
        expect(p.objection_patterns.length).toBeGreaterThan(0);
      }
    });

    it("should return a specific role persona", async () => {
      const { getRolePersona } = await import("./personaCoaching");
      const procurement = getRolePersona("procurement");
      expect(procurement).not.toBeNull();
      expect(procurement!.role).toBe("procurement");
      expect(procurement!.roleLabel).toBe("Procurement / Supply Chain");
    });

    it("should return null for unknown role", async () => {
      const { getRolePersona } = await import("./personaCoaching");
      const result = getRolePersona("unknown_role");
      expect(result).toBeNull();
    });

    it("procurement persona should have relevant objection patterns", async () => {
      const { getRolePersona } = await import("./personaCoaching");
      const procurement = getRolePersona("procurement");
      expect(procurement).not.toBeNull();
      const objections = procurement!.objection_patterns.join(" ");
      expect(objections).toContain("preferred supplier");
    });

    it("engineering persona should care about technical specs", async () => {
      const { getRolePersona } = await import("./personaCoaching");
      const engineering = getRolePersona("engineering");
      expect(engineering).not.toBeNull();
      const caresAbout = engineering!.cares_about.join(" ").toLowerCase();
      expect(caresAbout).toContain("technical");
    });

    it("operations persona should care about uptime", async () => {
      const { getRolePersona } = await import("./personaCoaching");
      const ops = getRolePersona("operations");
      expect(ops).not.toBeNull();
      const caresAbout = ops!.cares_about.join(" ").toLowerCase();
      expect(caresAbout).toContain("uptime");
    });
  });

  describe("pain-point BL coverage", () => {
    it("mining pain points should cover key BLs", async () => {
      const { getSegmentPainLibrary } = await import("./personaCoaching");
      const mining = getSegmentPainLibrary("mining");
      const allBLs = new Set(mining!.painPoints.flatMap(pp => pp.relevantBLs));
      expect(allBLs.has("Portable Air")).toBe(true);
      expect(allBLs.has("Pump/Dewatering")).toBe(true);
    });

    it("oil_gas pain points should cover Booster and Nitrogen", async () => {
      const { getSegmentPainLibrary } = await import("./personaCoaching");
      const oilGas = getSegmentPainLibrary("oil_gas");
      const allBLs = new Set(oilGas!.painPoints.flatMap(pp => pp.relevantBLs));
      expect(allBLs.has("Booster")).toBe(true);
      expect(allBLs.has("Nitrogen")).toBe(true);
    });

    it("energy pain points should cover BESS", async () => {
      const { getSegmentPainLibrary } = await import("./personaCoaching");
      const energy = getSegmentPainLibrary("energy");
      const allBLs = new Set(energy!.painPoints.flatMap(pp => pp.relevantBLs));
      expect(allBLs.has("BESS")).toBe(true);
    });
  });
});

// ── Behaviour Analysis Tests ──

describe("behaviourAnalysis", () => {
  it("should export getWorkingStyleProfile function", async () => {
    const mod = await import("./behaviourAnalysis");
    expect(typeof mod.getWorkingStyleProfile).toBe("function");
  });

  it("should export clearBehaviourCache function", async () => {
    const mod = await import("./behaviourAnalysis");
    expect(typeof mod.clearBehaviourCache).toBe("function");
  });

  it("clearBehaviourCache should not throw", async () => {
    const { clearBehaviourCache } = await import("./behaviourAnalysis");
    expect(() => clearBehaviourCache()).not.toThrow();
  });
});

// ── Weekly Coaching Tests ──

describe("weeklyCoaching", () => {
  it("should export getWeeklyCoaching function", async () => {
    const mod = await import("./weeklyCoaching");
    expect(typeof mod.getWeeklyCoaching).toBe("function");
  });
});

// ── Next Best Action Tests ──

describe("nextBestAction", () => {
  it("should export generateNBA function", async () => {
    const mod = await import("./nextBestAction");
    expect(typeof mod.generateNBA).toBe("function");
  });

  it("should export generateNBABatch function", async () => {
    const mod = await import("./nextBestAction");
    expect(typeof mod.generateNBABatch).toBe("function");
  });
});

// ── Persona Coaching Cache Tests ──

describe("personaCoaching cache", () => {
  it("should export clearPersonaCache function", async () => {
    const mod = await import("./personaCoaching");
    expect(typeof mod.clearPersonaCache).toBe("function");
  });

  it("clearPersonaCache should not throw", async () => {
    const { clearPersonaCache } = await import("./personaCoaching");
    expect(() => clearPersonaCache()).not.toThrow();
  });
});

// ── Integration-style Tests (structure validation) ──

describe("AI Learning Sales Support integration", () => {
  it("all segment pain libraries should have unique segments", async () => {
    const { getAllSegmentPainLibraries } = await import("./personaCoaching");
    const libraries = getAllSegmentPainLibraries();
    const segments = libraries.map(l => l.segment);
    expect(new Set(segments).size).toBe(segments.length);
  });

  it("all role personas should have unique roles", async () => {
    const { getAllRolePersonas } = await import("./personaCoaching");
    const personas = getAllRolePersonas();
    const roles = personas.map(p => p.role);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it("each persona should have at least 3 objection patterns", async () => {
    const { getAllRolePersonas } = await import("./personaCoaching");
    const personas = getAllRolePersonas();
    for (const p of personas) {
      expect(p.objection_patterns.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("each persona objection pattern should contain a response", async () => {
    const { getAllRolePersonas } = await import("./personaCoaching");
    const personas = getAllRolePersonas();
    for (const p of personas) {
      for (const obj of p.objection_patterns) {
        // Each objection should have format: "objection" → response
        expect(obj).toContain("→");
      }
    }
  });

  it("each pain point atlasCopcoBridge should be a non-empty string", async () => {
    const { getAllSegmentPainLibraries } = await import("./personaCoaching");
    const libraries = getAllSegmentPainLibraries();
    for (const lib of libraries) {
      for (const pp of lib.painPoints) {
        expect(pp.atlasCopcoBridge.length).toBeGreaterThan(20);
      }
    }
  });
});
