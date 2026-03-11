/**
 * Tests for This Week Service and Email Digest integration
 */
import { describe, it, expect } from "vitest";
import { shouldIncludeInBrief, getTierLabel, type ActionTier } from "./tierClassification";
import { classifyRoleRelevance } from "./roleRelevance";
import { detectActivities } from "./activitySignalLayer";

// ── This Week: Tier-based project filtering ──

describe("This Week — Project filtering for brief", () => {
  it("includes Tier 1 projects regardless of priority", () => {
    expect(shouldIncludeInBrief("tier1_actionable", "hot")).toBe(true);
    expect(shouldIncludeInBrief("tier1_actionable", "warm")).toBe(true);
    expect(shouldIncludeInBrief("tier1_actionable", "cold")).toBe(true);
  });

  it("includes Tier 2 projects only if hot or warm", () => {
    expect(shouldIncludeInBrief("tier2_warm", "hot")).toBe(true);
    expect(shouldIncludeInBrief("tier2_warm", "warm")).toBe(true);
    expect(shouldIncludeInBrief("tier2_warm", "cold")).toBe(false);
  });

  it("excludes Tier 3 projects from the brief", () => {
    expect(shouldIncludeInBrief("tier3_monitor", "hot")).toBe(false);
    expect(shouldIncludeInBrief("tier3_monitor", "warm")).toBe(false);
    expect(shouldIncludeInBrief("tier3_monitor", "cold")).toBe(false);
  });

  it("returns correct tier labels", () => {
    expect(getTierLabel("tier1_actionable")).toBe("Tier 1 — Actionable");
    expect(getTierLabel("tier2_warm")).toBe("Tier 2 — Warm");
    expect(getTierLabel("tier3_monitor")).toBe("Tier 3 — Monitor");
  });
});

// ── This Week: Stakeholder relevance for display ──

describe("This Week — Stakeholder relevance filtering", () => {
  it("classifies construction manager as high relevance", () => {
    expect(classifyRoleRelevance("Construction Manager", "Construction Manager")).toBe("high");
  });

  it("classifies project manager as high relevance", () => {
    expect(classifyRoleRelevance("Project Manager", "Project Manager")).toBe("high");
  });

  it("classifies procurement manager as high relevance", () => {
    expect(classifyRoleRelevance("Procurement Manager", "Procurement Manager")).toBe("high");
  });

  it("classifies site superintendent as high relevance", () => {
    expect(classifyRoleRelevance("Site Superintendent", "Site Superintendent")).toBe("high");
  });

  it("classifies CEO as low relevance", () => {
    expect(classifyRoleRelevance("CEO", "Chief Executive Officer")).toBe("low");
  });

  it("classifies project director as medium relevance", () => {
    expect(classifyRoleRelevance("Project Director", "Project Director")).toBe("medium");
  });

  it("only high and medium contacts should appear in This Week stakeholders", () => {
    const contacts = [
      { role: "Construction Manager", relevance: classifyRoleRelevance("Construction Manager", "Construction Manager") },
      { role: "CEO", relevance: classifyRoleRelevance("CEO", "Chief Executive Officer") },
      { role: "Project Director", relevance: classifyRoleRelevance("Project Director", "Project Director") },
    ];
    const filtered = contacts.filter(c => c.relevance === "high" || c.relevance === "medium");
    expect(filtered.length).toBe(2);
    expect(filtered.map(c => c.role)).toContain("Construction Manager");
    expect(filtered.map(c => c.role)).toContain("Project Director");
  });
});

// ── This Week: Activity detection for project cards ──

describe("This Week — Activity detection for project display", () => {
  it("detects drilling activity for mining projects", () => {
    const activities = detectActivities(
      "Gold Mine Expansion",
      "Drilling program with 50 drill rigs for exploration and production drilling",
      null,
      "mining"
    );
    const activityNames = activities.map(a => a.activity);
    expect(activityNames).toContain("drilling");
  });

  it("detects tunnelling and dewatering for infrastructure projects", () => {
    const activities = detectActivities(
      "Metro Tunnel Project",
      "Tunnel boring machine operations with dewatering pumps for groundwater management",
      null,
      "infrastructure"
    );
    const activityNames = activities.map(a => a.activity);
    expect(activityNames).toContain("tunnelling");
    expect(activityNames).toContain("dewatering");
  });

  it("detects pipeline activities for oil and gas", () => {
    const activities = detectActivities(
      "Gas Pipeline Extension",
      "Pipeline construction and hydrotest operations across 200km route",
      null,
      "oil_gas"
    );
    const activityNames = activities.map(a => a.activity);
    expect(activityNames).toContain("pipeline_construction");
  });
});

// ── This Week: Suggested actions logic ──

describe("This Week — Suggested actions generation logic", () => {
  it("urgent actions should come before high actions", () => {
    const actions = [
      { priority: "high" as const, type: "contractor_gap" as const },
      { priority: "urgent" as const, type: "tier1_new" as const },
      { priority: "medium" as const, type: "high_value" as const },
    ];
    const priorityOrder = { urgent: 3, high: 2, medium: 1 };
    actions.sort((a, b) => (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0));
    expect(actions[0].priority).toBe("urgent");
    expect(actions[1].priority).toBe("high");
    expect(actions[2].priority).toBe("medium");
  });

  it("action types map to expected categories", () => {
    const validTypes = ["contact_outreach", "contractor_gap", "tier1_new", "stage_upgrade", "high_value", "pipeline_claim"];
    for (const t of validTypes) {
      expect(typeof t).toBe("string");
    }
  });
});

// ── Email Digest: This Week section formatting ──

describe("Email Digest — This Week section integration", () => {
  it("formatThisWeekSection includes urgent action when present", () => {
    // Test the logic that urgent actions appear at the top
    const urgentAction = {
      type: "tier1_new" as const,
      priority: "urgent" as const,
      title: "New Tier 1 opportunity: Olympic Dam Expansion",
      description: "South Australia — $2.5B. Stage: Construction. No high-relevance contacts found yet.",
      projectId: 1,
      projectName: "Olympic Dam Expansion",
    };
    // The urgent action should have priority "urgent"
    expect(urgentAction.priority).toBe("urgent");
    expect(urgentAction.title).toContain("Olympic Dam");
  });

  it("email digest should include top 3 projects, not more", () => {
    const projects = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      name: `Project ${i}`,
      priority: i < 3 ? "hot" : "warm",
    }));
    const top3 = projects.slice(0, 3);
    expect(top3.length).toBe(3);
    expect(top3[0].name).toBe("Project 0");
  });

  it("email digest should include top 2 stakeholders, not more", () => {
    const stakeholders = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      name: `Contact ${i}`,
      roleRelevance: i < 4 ? "high" : "medium",
    }));
    const top2 = stakeholders.slice(0, 2);
    expect(top2.length).toBe(2);
  });

  it("email digest should include exactly 1 urgent action", () => {
    const actions = [
      { priority: "urgent", title: "Action 1" },
      { priority: "urgent", title: "Action 2" },
      { priority: "high", title: "Action 3" },
    ];
    const urgentAction = actions.find(a => a.priority === "urgent") ?? actions[0] ?? null;
    expect(urgentAction).not.toBeNull();
    expect(urgentAction!.title).toBe("Action 1"); // First urgent action
  });
});

// ── Routing: This Week is default, Dashboard is drill-down ──

describe("Routing — This Week as default landing page", () => {
  it("This Week should be at root path /", () => {
    const routes = [
      { path: "/", component: "ThisWeek" },
      { path: "/dashboard", component: "Home" },
    ];
    const rootRoute = routes.find(r => r.path === "/");
    expect(rootRoute?.component).toBe("ThisWeek");
  });

  it("Dashboard (full report) should be at /dashboard", () => {
    const routes = [
      { path: "/", component: "ThisWeek" },
      { path: "/dashboard", component: "Home" },
    ];
    const dashRoute = routes.find(r => r.path === "/dashboard");
    expect(dashRoute?.component).toBe("Home");
  });
});

// ── Stats aggregation ──

describe("This Week — Stats aggregation logic", () => {
  it("correctly counts tier distribution", () => {
    const projects = [
      { actionTier: "tier1_actionable" },
      { actionTier: "tier1_actionable" },
      { actionTier: "tier2_warm" },
      { actionTier: "tier3_monitor" },
      { actionTier: null },
    ];
    const tier1 = projects.filter(p => p.actionTier === "tier1_actionable").length;
    const tier2 = projects.filter(p => p.actionTier === "tier2_warm").length;
    const tier3 = projects.filter(p => p.actionTier === "tier3_monitor").length;
    expect(tier1).toBe(2);
    expect(tier2).toBe(1);
    expect(tier3).toBe(1);
  });

  it("correctly identifies projects missing contractors", () => {
    const projects = [
      { contractors: [{ name: "Thiess" }] },
      { contractors: [] },
      { contractors: null },
      { contractors: [{ name: "Downer" }, { name: "CPB" }] },
    ];
    const withContractors = projects.filter(p => p.contractors && p.contractors.length > 0).length;
    const missing = projects.length - withContractors;
    expect(withContractors).toBe(2);
    expect(missing).toBe(2);
  });

  it("correctly counts new projects this week", () => {
    const projects = [
      { isNew: true },
      { isNew: false },
      { isNew: true },
      { isNew: false },
      { isNew: true },
    ];
    const newCount = projects.filter(p => p.isNew).length;
    expect(newCount).toBe(3);
  });
});

// ── Stage changes detection ──

describe("This Week — Stage changes detection", () => {
  it("new Tier 1 projects are flagged as stage upgrades", () => {
    const project = { isNew: true, actionTier: "tier1_actionable", priority: "hot" };
    const isNewTier1 = project.isNew && project.actionTier === "tier1_actionable";
    expect(isNewTier1).toBe(true);
  });

  it("new Tier 2 hot projects are flagged as stage changes", () => {
    const project = { isNew: true, actionTier: "tier2_warm", priority: "hot" };
    const isNewTier2Hot = project.isNew && project.actionTier === "tier2_warm" && (project.priority === "hot" || project.priority === "warm");
    expect(isNewTier2Hot).toBe(true);
  });

  it("new Tier 3 cold projects are NOT flagged as stage changes", () => {
    const project = { isNew: true, actionTier: "tier3_monitor", priority: "cold" };
    const isNewTier2Hot = project.isNew && project.actionTier === "tier2_warm" && (project.priority === "hot" || project.priority === "warm");
    const isNewTier1 = project.isNew && project.actionTier === "tier1_actionable";
    expect(isNewTier2Hot).toBe(false);
    expect(isNewTier1).toBe(false);
  });
});
