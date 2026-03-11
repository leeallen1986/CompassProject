/**
 * Tests for the Tier Classification Engine
 * Validates keyword matching, priority ordering, and edge cases.
 */
import { describe, it, expect } from "vitest";
import {
  classifyStage,
  getTierLabel,
  shouldIncludeInBrief,
  type ActionTier,
} from "./tierClassification";

describe("classifyStage", () => {
  // ── Tier 1 — Actionable ──
  describe("Tier 1 — Actionable", () => {
    const tier1Stages = [
      "Construction underway",
      "Under construction",
      "Tender open",
      "Tendering phase",
      "Contract awarded to Downer EDI",
      "EPC awarded",
      "Mobilisation commenced",
      "Early works underway",
      "Enabling works",
      "Commissioning",
      "Ramp-up phase",
      "First ore expected Q3 2026",
      "Site preparation",
      "Installation underway",
      "Drilling underway",
      "Open work packages",
      "Procurement advanced",
      "Groundbreaking ceremony held",
      "Tunnelling commenced",
      "Earthworks in progress",
      "RFP issued",
      "Expression of interest",
      "Brownfield expansion underway",
      "Restart of operations",
    ];

    it.each(tier1Stages)("classifies '%s' as tier1_actionable", (stage) => {
      expect(classifyStage(stage)).toBe("tier1_actionable");
    });
  });

  // ── Tier 2 — Warm ──
  describe("Tier 2 — Warm", () => {
    const tier2Stages = [
      "Detailed design",
      "FEED stage",
      "Front-end engineering",
      "Planning approval granted",
      "Environmental approval",
      "Funding committed",
      "Final investment decision",
      "Development application lodged",
      "Permitting underway",
      "Set to be built",
      "Design phase",
      "Planning and design",
      "Approved for development",
    ];

    it.each(tier2Stages)("classifies '%s' as tier2_warm", (stage) => {
      expect(classifyStage(stage)).toBe("tier2_warm");
    });
  });

  // ── Tier 3 — Monitor ──
  describe("Tier 3 — Monitor", () => {
    const tier3Stages = [
      "Exploration",
      "Greenfield exploration",
      "Feasibility study",
      "Pre-feasibility study",
      "Scoping study",
      "Operational",
      "Completed",
      "Commissioned and operational",
      "Rehabilitation",
      "Resource definition drilling",
      "Ongoing production",
    ];

    it.each(tier3Stages)("classifies '%s' as tier3_monitor", (stage) => {
      expect(classifyStage(stage)).toBe("tier3_monitor");
    });
  });

  // ── Edge cases ──
  describe("edge cases", () => {
    it("returns tier3_monitor for null stage", () => {
      expect(classifyStage(null)).toBe("tier3_monitor");
    });

    it("returns tier3_monitor for undefined stage", () => {
      expect(classifyStage(undefined)).toBe("tier3_monitor");
    });

    it("returns tier3_monitor for empty string", () => {
      expect(classifyStage("")).toBe("tier3_monitor");
    });

    it("returns tier3_monitor for 'unknown'", () => {
      expect(classifyStage("unknown")).toBe("tier3_monitor");
    });

    it("returns tier2_warm for unrecognised stage text", () => {
      expect(classifyStage("some random description")).toBe("tier2_warm");
    });

    it("is case-insensitive", () => {
      expect(classifyStage("CONSTRUCTION UNDERWAY")).toBe("tier1_actionable");
      expect(classifyStage("FEASIBILITY STUDY")).toBe("tier3_monitor");
    });
  });

  // ── Cross-tier keyword overlap ──
  describe("cross-tier overlap", () => {
    it("classifies 'Proposed — construction 2027' as tier1 (construction keyword matches T1)", () => {
      expect(classifyStage("Proposed — construction 2027")).toBe("tier1_actionable");
    });

    it("classifies 'Conceptual design' as tier2 (design keyword matches T2 before conceptual matches T3)", () => {
      expect(classifyStage("Conceptual design")).toBe("tier2_warm");
    });

    it("classifies 'Decommissioning' as tier1 (commissioning pattern matches T1 first)", () => {
      expect(classifyStage("Decommissioning")).toBe("tier1_actionable");
    });
  });

  // ── Priority ordering: Tier 1 wins over Tier 2/3 ──
  describe("priority ordering", () => {
    it("classifies 'Construction — feasibility complete' as tier1 (construction wins)", () => {
      expect(classifyStage("Construction — feasibility complete")).toBe("tier1_actionable");
    });

    it("classifies 'Tender for detailed design' as tier1 (tender wins over design)", () => {
      expect(classifyStage("Tender for detailed design")).toBe("tier1_actionable");
    });

    it("classifies 'Design phase — exploration area' as tier2 (design wins over exploration)", () => {
      // Design is checked before exploration in Tier 2
      expect(classifyStage("Design phase — exploration area")).toBe("tier2_warm");
    });
  });
});

describe("getTierLabel", () => {
  it("returns correct labels", () => {
    expect(getTierLabel("tier1_actionable")).toBe("Tier 1 — Actionable");
    expect(getTierLabel("tier2_warm")).toBe("Tier 2 — Warm");
    expect(getTierLabel("tier3_monitor")).toBe("Tier 3 — Monitor");
  });
});

describe("shouldIncludeInBrief", () => {
  it("always includes tier1 regardless of priority", () => {
    expect(shouldIncludeInBrief("tier1_actionable", "hot")).toBe(true);
    expect(shouldIncludeInBrief("tier1_actionable", "warm")).toBe(true);
    expect(shouldIncludeInBrief("tier1_actionable", "cold")).toBe(true);
  });

  it("includes tier2 only if hot or warm priority", () => {
    expect(shouldIncludeInBrief("tier2_warm", "hot")).toBe(true);
    expect(shouldIncludeInBrief("tier2_warm", "warm")).toBe(true);
    expect(shouldIncludeInBrief("tier2_warm", "cold")).toBe(false);
  });

  it("never includes tier3", () => {
    expect(shouldIncludeInBrief("tier3_monitor", "hot")).toBe(false);
    expect(shouldIncludeInBrief("tier3_monitor", "warm")).toBe(false);
    expect(shouldIncludeInBrief("tier3_monitor", "cold")).toBe(false);
  });
});
