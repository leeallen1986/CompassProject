/**
 * Stage 5D — Project Type Classification & Suppression
 * Tests for: normalizeStageCode, computeStageConfidence, inferProjectType,
 *             evaluateSuppression, classifyProject
 */
import { describe, it, expect } from "vitest";
import {
  normalizeStageCode,
  computeStageConfidence,
  inferProjectType,
  evaluateSuppression,
  classifyProject,
} from "./db";

// ─── normalizeStageCode ───────────────────────────────────────────────────────

describe("normalizeStageCode", () => {
  it("returns unknown for null input", () => {
    expect(normalizeStageCode(null)).toMatchObject({ code: "unknown" });
  });

  it("returns unknown for empty string", () => {
    expect(normalizeStageCode("")).toMatchObject({ code: "unknown" });
  });

  it("returns unknown for whitespace-only string", () => {
    expect(normalizeStageCode("   ")).toMatchObject({ code: "unknown" });
  });

  it("classifies 'Completed' as completed with high confidence", () => {
    const r = normalizeStageCode("Completed");
    expect(r.code).toBe("completed");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("classifies 'Fully Completed' as completed", () => {
    expect(normalizeStageCode("Fully Completed").code).toBe("completed");
  });

  it("classifies 'Commissioned' as commissioning", () => {
    expect(normalizeStageCode("Commissioned").code).toBe("commissioning");
  });

  it("classifies 'Commissioning' as commissioning", () => {
    expect(normalizeStageCode("Commissioning").code).toBe("commissioning");
  });

  it("classifies 'Cancelled' as cancelled", () => {
    expect(normalizeStageCode("Cancelled").code).toBe("cancelled");
  });

  it("classifies 'Decommissioned' as cancelled", () => {
    expect(normalizeStageCode("Decommissioned").code).toBe("cancelled");
  });

  it("classifies 'Withdrawn' as cancelled", () => {
    expect(normalizeStageCode("Withdrawn").code).toBe("cancelled");
  });

  it("classifies 'Under Construction' as construction with high confidence", () => {
    const r = normalizeStageCode("Under Construction");
    expect(r.code).toBe("construction");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("classifies 'Construction Commenced' as construction", () => {
    expect(normalizeStageCode("Construction Commenced").code).toBe("construction");
  });

  it("classifies 'Tunnelling' as construction", () => {
    expect(normalizeStageCode("Tunnelling").code).toBe("construction");
  });

  it("classifies 'Awarded' as awarded", () => {
    expect(normalizeStageCode("Awarded").code).toBe("awarded");
  });

  it("classifies 'Contract Award' as awarded", () => {
    expect(normalizeStageCode("Contract Award").code).toBe("awarded");
  });

  it("classifies 'Procurement' as procurement", () => {
    expect(normalizeStageCode("Procurement").code).toBe("procurement");
  });

  it("classifies 'Tendering' as procurement", () => {
    expect(normalizeStageCode("Tendering").code).toBe("procurement");
  });

  it("classifies 'Design' as design", () => {
    expect(normalizeStageCode("Design").code).toBe("design");
  });

  it("classifies 'Planning' as planning", () => {
    expect(normalizeStageCode("Planning").code).toBe("planning");
  });

  it("classifies 'Pre-Construction' as planning", () => {
    expect(normalizeStageCode("Pre-Construction").code).toBe("planning");
  });

  it("classifies 'Early Works' as planning", () => {
    expect(normalizeStageCode("Early Works").code).toBe("planning");
  });

  it("classifies 'Feasibility' as feasibility", () => {
    expect(normalizeStageCode("Feasibility").code).toBe("feasibility");
  });

  it("classifies 'Pre-Feasibility' as feasibility", () => {
    expect(normalizeStageCode("Pre-Feasibility").code).toBe("feasibility");
  });

  it("classifies 'Exploration' as exploration", () => {
    expect(normalizeStageCode("Exploration").code).toBe("exploration");
  });

  it("classifies 'Drilling' as exploration", () => {
    expect(normalizeStageCode("Drilling").code).toBe("exploration");
  });

  it("classifies 'Operational' as operational", () => {
    expect(normalizeStageCode("Operational").code).toBe("operational");
  });

  it("classifies 'Operational / Expansion' as operational", () => {
    expect(normalizeStageCode("Operational / Expansion").code).toBe("operational");
  });

  it("does NOT classify 'Near Completion' as completed", () => {
    expect(normalizeStageCode("Near Completion").code).not.toBe("completed");
  });

  it("does NOT classify 'Pre-Construction' as construction", () => {
    expect(normalizeStageCode("Pre-Construction").code).not.toBe("construction");
  });

  it("returns confidence between 0 and 1 for all inputs", () => {
    const stages = ["Completed", "Under Construction", "Planning", "Feasibility", "Exploration", "Operational", "Awarded", "Procurement", "Design", "Commissioning", "Cancelled", ""];
    for (const s of stages) {
      const r = normalizeStageCode(s);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ─── computeStageConfidence ───────────────────────────────────────────────────

describe("computeStageConfidence", () => {
  it("returns higher confidence when owner is named", () => {
    const withOwner = computeStageConfidence({ stage: "Planning", owner: "BHP Billiton" });
    const noOwner = computeStageConfidence({ stage: "Planning", owner: null });
    expect(withOwner).toBeGreaterThan(noOwner);
  });

  it("returns higher confidence when contractors are named", () => {
    const withContractors = computeStageConfidence({
      stage: "Construction",
      owner: "Rio Tinto",
      contractors: [{ name: "Thiess", status: "confirmed" }],
    });
    const noContractors = computeStageConfidence({
      stage: "Construction",
      owner: "Rio Tinto",
      contractors: [],
    });
    expect(withContractors).toBeGreaterThan(noContractors);
  });

  it("returns higher confidence for hot priority", () => {
    const hot = computeStageConfidence({ stage: "Planning", owner: "Fortescue", priority: "hot" });
    const cold = computeStageConfidence({ stage: "Planning", owner: "Fortescue", priority: "cold" });
    expect(hot).toBeGreaterThan(cold);
  });

  it("penalises unknown stage code", () => {
    const unknown = computeStageConfidence({ stage: "", owner: "BHP" });
    const known = computeStageConfidence({ stage: "Planning", owner: "BHP" });
    expect(unknown).toBeLessThan(known);
  });

  it("always returns a value between 0.05 and 0.99", () => {
    const result = computeStageConfidence({ stage: null, owner: null });
    expect(result).toBeGreaterThanOrEqual(0.05);
    expect(result).toBeLessThanOrEqual(0.99);
  });
});

// ─── inferProjectType ─────────────────────────────────────────────────────────

describe("inferProjectType", () => {
  it("classifies a normal construction project as opportunity", () => {
    expect(inferProjectType({
      name: "Walyering West-1 Gas Development",
      stage: "Under Construction",
      owner: "Beach Energy",
      location: "WA",
      stageCode: "construction",
    })).toBe("opportunity");
  });

  it("classifies a policy/strategy document as macro_item", () => {
    expect(inferProjectType({
      name: "Australian Critical Minerals Strategy",
      stage: "Policy-driven",
      owner: "Federal Government",
      location: "National",
      stageCode: "unknown",
    })).toBe("macro_item");
  });

  it("classifies a hydrogen roadmap as macro_item", () => {
    expect(inferProjectType({
      name: "National Hydrogen Strategy 2030",
      stage: "Advocacy",
      owner: "DCCEEW",
      location: "National",
      stageCode: "unknown",
    })).toBe("macro_item");
  });

  it("classifies an AusTender government contract as macro_item", () => {
    expect(inferProjectType({
      name: "0070041016 — Department of Home Affairs",
      stage: "Awarded",
      owner: "Department of Home Affairs",
      location: "ACT",
      stageCode: "awarded",
    })).toBe("macro_item");
  });

  it("classifies a funding program wrapper as program_wrapper", () => {
    expect(inferProjectType({
      name: "Clean Energy Finance Corporation Funding Round 3",
      stage: "Planning",
      owner: "CEFC",
      location: "National",
      stageCode: "planning",
    })).toBe("program_wrapper");
  });

  it("classifies an operational mine with no expansion as background_account", () => {
    expect(inferProjectType({
      name: "Cadia Mine Operations",
      stage: "Operational",
      owner: "Newcrest Mining",
      location: "NSW",
      stageCode: "operational",
    })).toBe("background_account");
  });

  it("classifies an operational project WITH expansion signal as opportunity", () => {
    expect(inferProjectType({
      name: "Cadia Mine Expansion Stage 3",
      stage: "Operational / Expansion",
      owner: "Newcrest Mining",
      location: "NSW",
      stageCode: "operational",
    })).toBe("opportunity");
  });

  it("classifies a refinery operations project as background_account", () => {
    expect(inferProjectType({
      name: "Viva Energy Geelong Refinery Operations",
      stage: "Operational",
      owner: "Viva Energy",
      location: "VIC",
      stageCode: "operational",
    })).toBe("background_account");
  });

  it("classifies a BESS project in planning as opportunity", () => {
    expect(inferProjectType({
      name: "Reeves Plains BESS Stage 1",
      stage: "Planning",
      owner: "AGL Energy",
      location: "SA",
      stageCode: "planning",
    })).toBe("opportunity");
  });

  it("classifies a national rollout with vague owner as macro_item", () => {
    expect(inferProjectType({
      name: "NSW Battery Energy Storage Systems Expansion Rollout",
      stage: "Planning",
      owner: "Various",
      location: "National",
      stageCode: "planning",
    })).toBe("macro_item");
  });
});

// ─── evaluateSuppression ─────────────────────────────────────────────────────

describe("evaluateSuppression", () => {
  it("suppresses completed projects", () => {
    const r = evaluateSuppression({ projectType: "opportunity", stageCode: "completed", stageConfidence: 0.9, owner: "BHP" });
    expect(r.suppressed).toBe(true);
    expect(r.suppressionReason).toMatch(/completed/i);
  });

  it("suppresses cancelled projects", () => {
    const r = evaluateSuppression({ projectType: "opportunity", stageCode: "cancelled", stageConfidence: 0.9, owner: "BHP" });
    expect(r.suppressed).toBe(true);
    expect(r.suppressionReason).toMatch(/cancelled/i);
  });

  it("suppresses macro_item type", () => {
    const r = evaluateSuppression({ projectType: "macro_item", stageCode: "unknown", stageConfidence: 0.4, owner: "Federal Government" });
    expect(r.suppressed).toBe(true);
    expect(r.suppressionReason).toMatch(/macro/i);
  });

  it("suppresses program_wrapper type", () => {
    const r = evaluateSuppression({ projectType: "program_wrapper", stageCode: "planning", stageConfidence: 0.5, owner: "CEFC" });
    expect(r.suppressed).toBe(true);
    expect(r.suppressionReason).toMatch(/wrapper/i);
  });

  it("suppresses background_account type", () => {
    const r = evaluateSuppression({ projectType: "background_account", stageCode: "operational", stageConfidence: 0.8, owner: "Newcrest" });
    expect(r.suppressed).toBe(true);
    expect(r.suppressionReason).toMatch(/background/i);
  });

  it("suppresses very low confidence projects with no named owner", () => {
    const r = evaluateSuppression({ projectType: "opportunity", stageCode: "unknown", stageConfidence: 0.2, owner: null });
    expect(r.suppressed).toBe(true);
  });

  it("does NOT suppress low confidence if owner is named", () => {
    const r = evaluateSuppression({ projectType: "opportunity", stageCode: "unknown", stageConfidence: 0.2, owner: "BHP Billiton" });
    expect(r.suppressed).toBe(false);
  });

  it("does NOT suppress a normal active opportunity", () => {
    const r = evaluateSuppression({ projectType: "opportunity", stageCode: "construction", stageConfidence: 0.85, owner: "Rio Tinto" });
    expect(r.suppressed).toBe(false);
    expect(r.suppressionReason).toBeNull();
  });

  it("does NOT suppress a planning opportunity with named owner", () => {
    const r = evaluateSuppression({ projectType: "opportunity", stageCode: "planning", stageConfidence: 0.65, owner: "Fortescue Metals" });
    expect(r.suppressed).toBe(false);
  });
});

// ─── classifyProject (full pipeline) ─────────────────────────────────────────

describe("classifyProject", () => {
  it("classifies a hot construction project correctly", () => {
    const r = classifyProject({
      name: "Port of Newcastle MPT Berth Extension",
      stage: "Under Construction",
      owner: "Port of Newcastle",
      location: "NSW",
      priority: "hot",
    });
    expect(r.projectType).toBe("opportunity");
    expect(r.stageCode).toBe("construction");
    expect(r.suppressed).toBe(false);
    expect(r.suppressionReason).toBeNull();
    expect(r.stageConfidence).toBeGreaterThan(0.7);
  });

  it("classifies a completed project as suppressed", () => {
    const r = classifyProject({
      name: "Old Completed Mine Project",
      stage: "Completed",
      owner: "Newcrest Mining",
      location: "WA",
    });
    expect(r.projectType).toBe("opportunity");
    expect(r.stageCode).toBe("completed");
    expect(r.suppressed).toBe(true);
  });

  it("classifies a macro policy item as suppressed", () => {
    const r = classifyProject({
      name: "Australian Critical Minerals for Defence Roadmap",
      stage: "Policy-driven",
      owner: "Department of Industry",
      location: "National",
    });
    expect(r.projectType).toBe("macro_item");
    expect(r.suppressed).toBe(true);
  });

  it("classifies an operational account as suppressed background_account", () => {
    const r = classifyProject({
      name: "Viva Energy Geelong Refinery Operations",
      stage: "Operational",
      owner: "Viva Energy",
      location: "VIC",
    });
    expect(r.projectType).toBe("background_account");
    expect(r.suppressed).toBe(true);
  });

  it("classifies an operational expansion project as NOT suppressed", () => {
    const r = classifyProject({
      name: "Olympic Dam Expansion Stage 2",
      stage: "Operational / Expansion",
      owner: "BHP",
      location: "SA",
    });
    expect(r.projectType).toBe("opportunity");
    expect(r.suppressed).toBe(false);
  });

  it("returns all four classification fields", () => {
    const r = classifyProject({ name: "Test Project", stage: "Planning", owner: "Test Corp", location: "QLD" });
    expect(r).toHaveProperty("projectType");
    expect(r).toHaveProperty("stageCode");
    expect(r).toHaveProperty("stageConfidence");
    expect(r).toHaveProperty("suppressed");
    expect(r).toHaveProperty("suppressionReason");
  });

  it("handles null stage gracefully", () => {
    const r = classifyProject({ name: "Unknown Stage Project", stage: null, owner: "BHP", location: "WA" });
    expect(r.stageCode).toBe("unknown");
    expect(r.projectType).toBe("opportunity");
  });

  it("handles null owner gracefully", () => {
    const r = classifyProject({ name: "Test Project", stage: "Planning", owner: null, location: "QLD" });
    expect(r).toHaveProperty("projectType");
  });

  it("classifies a BESS project in planning as opportunity not suppressed", () => {
    const r = classifyProject({
      name: "Reeves Plains BESS Stage 1",
      stage: "Planning",
      owner: "AGL Energy",
      location: "SA",
      priority: "hot",
    });
    expect(r.projectType).toBe("opportunity");
    expect(r.suppressed).toBe(false);
  });

  it("classifies a gas well spud as exploration opportunity", () => {
    const r = classifyProject({
      name: "Walyering West-1 Gas Well Spud",
      stage: "Spudded",
      owner: "Beach Energy",
      location: "WA",
    });
    expect(r.stageCode).toBe("exploration");
    expect(r.projectType).toBe("opportunity");
    expect(r.suppressed).toBe(false);
  });
});
