/**
 * Tier Classification Engine
 * 
 * Classifies projects into 3 action tiers based on their stage field:
 * 
 * Tier 1 — Actionable: tender, contract award, mobilisation, construction
 * Tier 2 — Warm: approvals, detailed design, FEED
 * Tier 3 — Monitor: exploration, feasibility, conceptual announcements
 * 
 * Uses keyword matching against the free-text stage field.
 * Only Tier 1 and select Tier 2 projects reach the weekly brief.
 */

import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { eq, isNull, sql } from "drizzle-orm";

// ─── Tier Definitions ────────────────────────────────────────────

export type ActionTier = "tier1_actionable" | "tier2_warm" | "tier3_monitor";

export interface TierRule {
  tier: ActionTier;
  label: string;
  description: string;
  /** Keywords that, if found in the stage field, assign this tier */
  keywords: string[];
  /** Patterns that match more complex stage descriptions */
  patterns: RegExp[];
}

/**
 * Tier 1 — Actionable
 * Projects where equipment decisions are imminent or underway.
 * Tender, contract award, mobilisation, active construction.
 */
const TIER1_RULES: TierRule = {
  tier: "tier1_actionable",
  label: "Actionable",
  description: "Equipment decisions imminent — tender, award, mobilisation, construction",
  keywords: [
    // Construction active
    "construction", "under construction", "construction underway", "construction ongoing",
    "building", "earthworks", "civil works", "site works",
    // Tender / procurement
    "tender", "tendering", "procurement", "rfp", "rft", "eoi",
    "expression of interest", "request for proposal", "request for tender",
    "open work packages", "work packages",
    // Award
    "awarded", "contract awarded", "award", "contract signed",
    "epc contract", "epc awarded",
    // Mobilisation
    "mobilisation", "mobilization", "mobilising", "mobilizing",
    "early works", "enabling works", "site preparation",
    // Active deployment
    "commissioning", "ramp-up", "ramp up", "ramping up",
    "first ore", "first gas", "first production",
    "tunnelling", "boring", "drilling underway",
    "installation", "installing", "deployment",
    // Restart / expansion with active work
    "restart", "revamp", "augmentation", "upgrade",
    "expansion underway", "brownfield expansion",
  ],
  patterns: [
    /construct/i,
    /tender/i,
    /awarded/i,
    /mobilis/i,
    /mobiliz/i,
    /early works/i,
    /enabling works/i,
    /commissioning/i,
    /ramp[\s-]?up/i,
    /under\s+construction/i,
    /work\s+packages?/i,
    /epc\s+contract/i,
    /procurement\s+(advanced|underway|open)/i,
    /shortlisted/i,
    /tunnell/i,
    /groundbreaking/i,
    /first\s+(ore|gas|production)/i,
    /site\s+(preparation|works|clearing)/i,
    /installation\s+(completed|underway|commenced)/i,
    /drilling\s+underway/i,
  ],
};

/**
 * Tier 2 — Warm
 * Projects progressing through design/approval but not yet in construction.
 * Approvals, detailed design, FEED, planning with funding.
 */
const TIER2_RULES: TierRule = {
  tier: "tier2_warm",
  label: "Warm",
  description: "Progressing through design/approval — FEED, detailed design, approvals granted",
  keywords: [
    // Design
    "design", "detailed design", "feed", "front-end engineering",
    "design phase", "design/procurement",
    // Approvals
    "approval", "approved", "approvals", "planning approval",
    "environmental approval", "epbc", "assessment",
    "planning cleared", "plans approved",
    // Committed / funded
    "committed", "funding committed", "funding secured",
    "investment decision", "fid", "final investment",
    "confirmed funding",
    // Planning with substance
    "planning and design", "planning/design",
    "development application", "da lodged",
    "permitting",
    // Proposed with commitment
    "proposed", "proposed —", "set to be built",
    "planning — construction",
  ],
  patterns: [
    /design/i,
    /feed/i,
    /front[\s-]end\s+engineering/i,
    /approval/i,
    /approved/i,
    /planning\s+(and\s+)?design/i,
    /committed/i,
    /funding\s+(committed|secured|confirmed)/i,
    /investment\s+decision/i,
    /development\s+application/i,
    /permitting/i,
    /proposed\s*[—–-]/i,
    /set\s+to\s+be\s+built/i,
    /planning\s*[—–-]\s*construction/i,
    /assessment\s+(pathway|stage)/i,
  ],
};

/**
 * Tier 3 — Monitor
 * Early-stage projects not yet actionable.
 * Exploration, feasibility, conceptual, operational (no new equipment need).
 */
const TIER3_RULES: TierRule = {
  tier: "tier3_monitor",
  label: "Monitor",
  description: "Early stage — exploration, feasibility, conceptual, or already operational",
  keywords: [
    // Exploration
    "exploration", "greenfield exploration", "advanced exploration",
    "resource definition", "resource extension", "infill drilling",
    "regional exploration", "exploration drilling",
    // Feasibility
    "feasibility", "feasibility study", "pre-feasibility",
    "scoping study", "conceptual", "concept",
    // Operational / completed (no new equipment need)
    "operational", "completed", "commissioned", "opened",
    "first stage complete", "production",
    "ongoing production",
    // Decommissioning
    "decommissioning", "rehabilitation", "closure",
    // Very early
    "inquiry", "forecast", "announcement",
    "acquisition", "study",
  ],
  patterns: [
    /explor/i,
    /feasibility/i,
    /pre[\s-]?feasibility/i,
    /scoping\s+study/i,
    /conceptual/i,
    /resource\s+(definition|extension|estimate)/i,
    /operational/i,
    /completed/i,
    /commissioned/i,
    /decommission/i,
    /rehabilitat/i,
    /greenfield/i,
    /ongoing\s+production/i,
    /officially\s+opened/i,
  ],
};

// ─── Classification Logic ────────────────────────────────────────

/**
 * Classify a single stage string into an action tier.
 * 
 * Priority order: Tier 1 > Tier 2 > Tier 3
 * If a stage contains signals from multiple tiers, the highest tier wins.
 * If no match, defaults to Tier 3 (Monitor).
 */
export function classifyStage(stage: string | null | undefined): ActionTier {
  if (!stage || stage.trim() === "" || stage.toLowerCase() === "unknown") {
    return "tier3_monitor";
  }

  const normalised = stage.toLowerCase().trim();

  // Check Tier 1 first (highest priority)
  for (const pattern of TIER1_RULES.patterns) {
    if (pattern.test(normalised)) return "tier1_actionable";
  }
  for (const keyword of TIER1_RULES.keywords) {
    if (normalised.includes(keyword.toLowerCase())) return "tier1_actionable";
  }

  // Check Tier 2
  for (const pattern of TIER2_RULES.patterns) {
    if (pattern.test(normalised)) return "tier2_warm";
  }
  for (const keyword of TIER2_RULES.keywords) {
    if (normalised.includes(keyword.toLowerCase())) return "tier2_warm";
  }

  // Check Tier 3 explicitly
  for (const pattern of TIER3_RULES.patterns) {
    if (pattern.test(normalised)) return "tier3_monitor";
  }
  for (const keyword of TIER3_RULES.keywords) {
    if (normalised.includes(keyword.toLowerCase())) return "tier3_monitor";
  }

  // Default: if stage exists but doesn't match any pattern, classify as Tier 2 (Warm)
  // Rationale: unrecognised stages are likely mid-process descriptions
  return "tier2_warm";
}

/**
 * Get the tier label for display
 */
export function getTierLabel(tier: ActionTier): string {
  switch (tier) {
    case "tier1_actionable": return "Tier 1 — Actionable";
    case "tier2_warm": return "Tier 2 — Warm";
    case "tier3_monitor": return "Tier 3 — Monitor";
  }
}

/**
 * Get tier configuration
 */
export function getTierConfig() {
  return {
    tier1: { ...TIER1_RULES, count: 0 },
    tier2: { ...TIER2_RULES, count: 0 },
    tier3: { ...TIER3_RULES, count: 0 },
  };
}

// ─── Bulk Classification ─────────────────────────────────────────

export interface TierClassificationResult {
  total: number;
  classified: number;
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  samplesByTier: {
    tier1: Array<{ id: number; name: string; stage: string | null }>;
    tier2: Array<{ id: number; name: string; stage: string | null }>;
    tier3: Array<{ id: number; name: string; stage: string | null }>;
  };
}

/**
 * Classify all projects in the database and update their actionTier column.
 * Processes in batches to avoid overwhelming the database.
 */
export async function classifyAllProjects(): Promise<TierClassificationResult> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Fetch all projects with their stage
  const allProjects = await db.select({
    id: projects.id,
    name: projects.name,
    stage: projects.stage,
  }).from(projects);

  const result: TierClassificationResult = {
    total: allProjects.length,
    classified: 0,
    tier1Count: 0,
    tier2Count: 0,
    tier3Count: 0,
    samplesByTier: { tier1: [], tier2: [], tier3: [] },
  };

  // Classify each project
  const updates: Array<{ id: number; tier: ActionTier; name: string; stage: string | null }> = [];

  for (const project of allProjects) {
    const tier = classifyStage(project.stage);
    updates.push({ id: project.id, tier, name: project.name, stage: project.stage });

    if (tier === "tier1_actionable") {
      result.tier1Count++;
      if (result.samplesByTier.tier1.length < 5) {
        result.samplesByTier.tier1.push({ id: project.id, name: project.name, stage: project.stage });
      }
    } else if (tier === "tier2_warm") {
      result.tier2Count++;
      if (result.samplesByTier.tier2.length < 5) {
        result.samplesByTier.tier2.push({ id: project.id, name: project.name, stage: project.stage });
      }
    } else {
      result.tier3Count++;
      if (result.samplesByTier.tier3.length < 5) {
        result.samplesByTier.tier3.push({ id: project.id, name: project.name, stage: project.stage });
      }
    }
  }

  // Batch update in groups of 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(u =>
        db.update(projects)
          .set({ actionTier: u.tier })
          .where(eq(projects.id, u.id))
      )
    );
  }

  result.classified = updates.length;
  return result;
}

/**
 * Classify a single project by ID and update the database.
 */
export async function classifyProject(projectId: number): Promise<ActionTier> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const [project] = await db.select({ stage: projects.stage })
    .from(projects)
    .where(eq(projects.id, projectId));

  if (!project) throw new Error(`Project ${projectId} not found`);

  const tier = classifyStage(project.stage);
  await db.update(projects)
    .set({ actionTier: tier })
    .where(eq(projects.id, projectId));

  return tier;
}

/**
 * Get tier distribution statistics
 */
export async function getTierDistribution(): Promise<{
  tier1: number;
  tier2: number;
  tier3: number;
  unclassified: number;
  total: number;
}> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const [tier1] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(eq(projects.actionTier, "tier1_actionable"));

  const [tier2] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(eq(projects.actionTier, "tier2_warm"));

  const [tier3] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(eq(projects.actionTier, "tier3_monitor"));

  const [unclassified] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(isNull(projects.actionTier));

  const total = Number(tier1.count) + Number(tier2.count) + Number(tier3.count) + Number(unclassified.count);

  return {
    tier1: Number(tier1.count),
    tier2: Number(tier2.count),
    tier3: Number(tier3.count),
    unclassified: Number(unclassified.count),
    total,
  };
}

/**
 * Check if a project should be included in the weekly brief based on its tier.
 * Tier 1: always included
 * Tier 2: included if priority is hot or warm
 * Tier 3: never included in the action list (may appear in monitoring section)
 */
export function shouldIncludeInBrief(
  tier: ActionTier,
  priority: "hot" | "warm" | "cold",
): boolean {
  if (tier === "tier1_actionable") return true;
  if (tier === "tier2_warm" && (priority === "hot" || priority === "warm")) return true;
  return false;
}

// ─── Exports for testing ─────────────────────────────────────────

export const _testing = {
  TIER1_RULES,
  TIER2_RULES,
  TIER3_RULES,
};
