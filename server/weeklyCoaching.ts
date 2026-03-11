/**
 * Weekly Coaching Engine
 *
 * Analyses a rep's project interactions and the current project landscape
 * to generate personalised coaching nudges:
 *
 * 1. Top 5 actions this week (prioritised)
 * 2. 2 overlooked opportunities (projects they should have engaged but haven't)
 * 3. 1 adjacent business-line opportunity (BL they're under-working)
 * 4. 1 early-stage project worth warming up
 * 5. 1 project that is probably too late (don't waste time)
 *
 * Framed as supportive coaching, NOT performance scoring.
 */
import { getDb, getAllProjects, getProfileByUserId } from "./db";
import { projects, contacts, userActivity, projectBusinessLineScores } from "../drizzle/schema";
import { eq, and, gte, desc, sql, inArray, count, not } from "drizzle-orm";
import { detectActivities } from "./activitySignalLayer";
import { classifyRoleRelevance } from "./roleRelevance";
import { invokeLLM } from "./_core/llm";

// ── Types ──

export interface CoachingAction {
  type: "engage" | "follow_up" | "enrich" | "outreach" | "discover";
  projectId: number;
  projectName: string;
  reason: string;
  urgency: "urgent" | "high" | "medium";
}

export interface OverlookedOpportunity {
  projectId: number;
  projectName: string;
  location: string;
  value: string;
  sector: string;
  whyOverlooked: string;
  suggestedAction: string;
}

export interface AdjacentBLOpportunity {
  businessLine: string;
  projectCount: number;
  exampleProjectId: number;
  exampleProjectName: string;
  insight: string;
}

export interface EarlyStageWarmUp {
  projectId: number;
  projectName: string;
  stage: string;
  whyWarmUp: string;
  suggestedApproach: string;
}

export interface TooLateProject {
  projectId: number;
  projectName: string;
  stage: string;
  whyTooLate: string;
}

export interface WeeklyCoaching {
  userId: number;
  weekLabel: string;
  generatedAt: number;
  // Core coaching outputs
  topActions: CoachingAction[];
  overlookedOpportunities: OverlookedOpportunity[];
  adjacentBLOpportunity: AdjacentBLOpportunity | null;
  earlyStageWarmUp: EarlyStageWarmUp | null;
  tooLateProject: TooLateProject | null;
  // Behavioural observations (soft, supportive)
  focusInsight: string; // e.g. "You're focused heavily on mining this week..."
  coverageNote: string; // e.g. "Your territory has 3 warm opportunities with weak stakeholder depth"
  // Stats for context
  stats: {
    projectsEngaged: number;
    totalActionable: number;
    sectorsWorked: string[];
    blsWorked: string[];
    contactsOpened: number;
    outreachSent: number;
  };
}

// ── In-memory cache ──
const coachingCache = new Map<number, { data: WeeklyCoaching; expiresAt: number }>();
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export function clearCoachingCache(): void {
  coachingCache.clear();
}

// ── Main Entry Point ──

export async function getWeeklyCoaching(userId: number): Promise<WeeklyCoaching> {
  // Check cache
  const cached = coachingCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);
  const weekLabel = `Week of ${now.toISOString().slice(0, 10)}`;

  // ── Gather user's recent activity ──
  const recentActivity = await db
    .select()
    .from(userActivity)
    .where(and(eq(userActivity.userId, userId), gte(userActivity.createdAt, weekStart)))
    .orderBy(desc(userActivity.createdAt))
    .limit(200);

  const viewedProjectIds = new Set(
    recentActivity
      .filter(a => a.actionType === "project_viewed" && a.projectId)
      .map(a => a.projectId!)
  );
  const contactsOpened = recentActivity.filter(a => a.actionType === "contact_viewed").length;
  const outreachSent = recentActivity.filter(a => a.actionType === "outreach_sent" || a.actionType === "outreach_drafted").length;

  // ── Gather user profile for territory/BL preferences ──
  const profile = await getProfileByUserId(userId);
  const userTerritories = profile?.territories || [];
  const userIndustries = profile?.industries || [];

  // ── Gather all actionable projects ──
  const allProjects = await db
    .select()
    .from(projects)
    .where(
      and(
        not(eq(projects.lifecycleStatus, "archived")),
        not(eq(projects.lifecycleStatus, "completed")),
      )
    )
    .orderBy(desc(projects.createdAt))
    .limit(500);

  // ── Gather BL scores for all projects ──
  const allProjectIds = allProjects.map(p => p.id);
  let blScoresMap: Map<number, { dimension: string; score: number }[]> = new Map();
  if (allProjectIds.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < allProjectIds.length; i += batchSize) {
      const batch = allProjectIds.slice(i, i + batchSize);
      const scores = await db
        .select()
        .from(projectBusinessLineScores)
        .where(inArray(projectBusinessLineScores.projectId, batch));
      for (const s of scores) {
        if (!blScoresMap.has(s.projectId)) blScoresMap.set(s.projectId, []);
        blScoresMap.get(s.projectId)!.push({ dimension: s.scoringDimension, score: s.score });
      }
    }
  }

  // ── Classify projects ──
  const tier1 = allProjects.filter(p => p.actionTier === "tier1_actionable");
  const hotProjects = allProjects.filter(p => p.priority === "hot");
  const warmProjects = allProjects.filter(p => p.priority === "warm");

  // Sectors the user has engaged this week
  const engagedSectors = new Set<string>();
  const engagedBLs = new Set<string>();
  for (const pid of Array.from(viewedProjectIds)) {
    const proj = allProjects.find(p => p.id === pid);
    if (proj) {
      engagedSectors.add(proj.sector);
      const scores = blScoresMap.get(pid) || [];
      for (const s of scores) {
        if (s.score >= 60) engagedBLs.add(s.dimension);
      }
    }
  }

  // ── 1. Top 5 Actions ──
  const topActions = generateTopActions(allProjects, viewedProjectIds, blScoresMap, tier1);

  // ── 2. Overlooked Opportunities ──
  const overlooked = findOverlookedOpportunities(allProjects, viewedProjectIds, tier1, hotProjects);

  // ── 3. Adjacent BL Opportunity ──
  const adjacentBL = findAdjacentBLOpportunity(allProjects, engagedBLs, blScoresMap);

  // ── 4. Early-Stage Warm Up ──
  const earlyStage = findEarlyStageWarmUp(allProjects, viewedProjectIds);

  // ── 5. Too Late Project ──
  const tooLate = findTooLateProject(allProjects, viewedProjectIds);

  // ── 6. Focus Insight ──
  const focusInsight = generateFocusInsight(engagedSectors, engagedBLs, allProjects, viewedProjectIds);

  // ── 7. Coverage Note ──
  const coverageNote = generateCoverageNote(allProjects, viewedProjectIds, tier1);

  const coaching: WeeklyCoaching = {
    userId,
    weekLabel,
    generatedAt: Date.now(),
    topActions,
    overlookedOpportunities: overlooked,
    adjacentBLOpportunity: adjacentBL,
    earlyStageWarmUp: earlyStage,
    tooLateProject: tooLate,
    focusInsight,
    coverageNote,
    stats: {
      projectsEngaged: viewedProjectIds.size,
      totalActionable: tier1.length,
      sectorsWorked: Array.from(engagedSectors),
      blsWorked: Array.from(engagedBLs),
      contactsOpened,
      outreachSent,
    },
  };

  coachingCache.set(userId, { data: coaching, expiresAt: Date.now() + CACHE_TTL_MS });
  return coaching;
}

// ── Helpers ──

function generateTopActions(
  allProjects: any[],
  viewedIds: Set<number>,
  blScoresMap: Map<number, { dimension: string; score: number }[]>,
  tier1: any[]
): CoachingAction[] {
  const actions: CoachingAction[] = [];

  // Priority 1: Tier 1 projects not yet viewed
  const unviewedTier1 = tier1.filter(p => !viewedIds.has(p.id));
  for (const p of unviewedTier1.slice(0, 2)) {
    actions.push({
      type: "engage",
      projectId: p.id,
      projectName: p.name,
      reason: `Tier 1 actionable project in ${p.location} (${p.value}) — not yet reviewed this week`,
      urgency: "urgent",
    });
  }

  // Priority 2: Hot projects with no contacts
  const hotNoContacts = allProjects
    .filter(p => p.priority === "hot" && (!p.contractors || (p.contractors as any[]).length === 0))
    .slice(0, 2);
  for (const p of hotNoContacts) {
    if (actions.length >= 5) break;
    if (actions.some(a => a.projectId === p.id)) continue;
    actions.push({
      type: "discover",
      projectId: p.id,
      projectName: p.name,
      reason: `Hot project with no contractor data — run stakeholder discovery before competitors`,
      urgency: "high",
    });
  }

  // Priority 3: Projects viewed but no follow-up action
  const viewedNoAction = Array.from(viewedIds)
    .map((id: number) => allProjects.find(p => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p != null)
    .filter(p => p.priority === "hot" || p.actionTier === "tier1_actionable");
  for (const p of viewedNoAction.slice(0, 2)) {
    if (actions.length >= 5) break;
    if (!p || actions.some(a => a.projectId === p.id)) continue;
    actions.push({
      type: "follow_up",
      projectId: p.id,
      projectName: p.name,
      reason: `You viewed this project recently — consider taking the next step (enrich contacts or draft outreach)`,
      urgency: "medium",
    });
  }

  // Fill remaining with high-BL-score unviewed projects
  const highBLProjects = allProjects
    .filter(p => !viewedIds.has(p.id) && !actions.some(a => a.projectId === p.id))
    .map(p => {
      const scores = blScoresMap.get(p.id) || [];
      const maxScore = Math.max(0, ...scores.map(s => s.score));
      return { ...p, maxBLScore: maxScore };
    })
    .sort((a, b) => b.maxBLScore - a.maxBLScore);

  for (const p of highBLProjects.slice(0, 3)) {
    if (actions.length >= 5) break;
    actions.push({
      type: "engage",
      projectId: p.id,
      projectName: p.name,
      reason: `High business-line relevance (score ${p.maxBLScore}) — worth reviewing for opportunity fit`,
      urgency: "medium",
    });
  }

  return actions.slice(0, 5);
}

function findOverlookedOpportunities(
  allProjects: any[],
  viewedIds: Set<number>,
  tier1: any[],
  hotProjects: any[]
): OverlookedOpportunity[] {
  // Tier 1 or hot projects the rep hasn't looked at
  const candidates = [...tier1, ...hotProjects]
    .filter(p => !viewedIds.has(p.id))
    .filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i) // dedupe
    .sort((a, b) => {
      // Prefer newer, higher-value projects
      const aScore = (a.actionTier === "tier1_actionable" ? 10 : 0) + (a.priority === "hot" ? 5 : 0) + (a.isNew ? 3 : 0);
      const bScore = (b.actionTier === "tier1_actionable" ? 10 : 0) + (b.priority === "hot" ? 5 : 0) + (b.isNew ? 3 : 0);
      return bScore - aScore;
    });

  return candidates.slice(0, 2).map(p => ({
    projectId: p.id,
    projectName: p.name,
    location: p.location,
    value: p.value,
    sector: p.sector,
    whyOverlooked: p.actionTier === "tier1_actionable"
      ? `Tier 1 actionable project you haven't reviewed yet — ${p.isNew ? "new this week" : "active opportunity"}`
      : `Hot priority project in ${p.sector} — competitors may already be engaging`,
    suggestedAction: `Review project details and identify the best stakeholder to contact`,
  }));
}

function findAdjacentBLOpportunity(
  allProjects: any[],
  engagedBLs: Set<string>,
  blScoresMap: Map<number, { dimension: string; score: number }[]>
): AdjacentBLOpportunity | null {
  // Find BLs with high-scoring projects that the rep hasn't engaged
  const blCounts: Record<string, { count: number; bestProject: any; bestScore: number }> = {};

  for (const p of allProjects) {
    if (p.priority === "cold") continue;
    const scores = blScoresMap.get(p.id) || [];
    for (const s of scores) {
      if (s.score < 70) continue;
      if (engagedBLs.has(s.dimension)) continue; // Already working this BL
      if (!blCounts[s.dimension]) {
        blCounts[s.dimension] = { count: 0, bestProject: p, bestScore: s.score };
      }
      blCounts[s.dimension].count++;
      if (s.score > blCounts[s.dimension].bestScore) {
        blCounts[s.dimension].bestProject = p;
        blCounts[s.dimension].bestScore = s.score;
      }
    }
  }

  // Pick the BL with most unworked high-score projects
  const sorted = Object.entries(blCounts).sort((a, b) => b[1].count - a[1].count);
  if (sorted.length === 0) return null;

  const [bl, data] = sorted[0];
  return {
    businessLine: bl,
    projectCount: data.count,
    exampleProjectId: data.bestProject.id,
    exampleProjectName: data.bestProject.name,
    insight: `${data.count} project${data.count > 1 ? "s" : ""} with strong ${bl} relevance that you haven't engaged yet. Consider reviewing ${data.bestProject.name} as a starting point.`,
  };
}

function findEarlyStageWarmUp(
  allProjects: any[],
  viewedIds: Set<number>
): EarlyStageWarmUp | null {
  const earlyStageKeywords = /feasib|study|plan|explor|concept|pre-fe|scoping|permit/i;
  const candidates = allProjects
    .filter(p =>
      !viewedIds.has(p.id) &&
      p.priority !== "cold" &&
      earlyStageKeywords.test(p.stage || "")
    )
    .sort((a, b) => {
      const aScore = (a.priority === "hot" ? 5 : a.priority === "warm" ? 3 : 0) + (a.isNew ? 2 : 0);
      const bScore = (b.priority === "hot" ? 5 : b.priority === "warm" ? 3 : 0) + (b.isNew ? 2 : 0);
      return bScore - aScore;
    });

  if (candidates.length === 0) return null;
  const p = candidates[0];
  return {
    projectId: p.id,
    projectName: p.name,
    stage: p.stage || "Early stage",
    whyWarmUp: `This project is still in early stages (${p.stage}), but building a relationship now positions Atlas Copco ahead of competitors when equipment decisions are made.`,
    suggestedApproach: `Introduce yourself as a technical resource rather than a sales pitch — offer to discuss equipment planning for their upcoming phases.`,
  };
}

function findTooLateProject(
  allProjects: any[],
  viewedIds: Set<number>
): TooLateProject | null {
  const lateKeywords = /complet|commission|handover|operational|closed|decommission|wind.?down/i;
  const candidates = allProjects
    .filter(p =>
      (p.lifecycleStatus === "completed" || p.lifecycleStatus === "awarded" || lateKeywords.test(p.stage || "")) &&
      viewedIds.has(p.id) // Only warn about projects they're spending time on
    );

  if (candidates.length === 0) return null;
  const p = candidates[0];
  return {
    projectId: p.id,
    projectName: p.name,
    stage: p.stage || p.lifecycleStatus,
    whyTooLate: `This project appears to be in a late stage (${p.stage || p.lifecycleStatus}). Equipment decisions have likely been made — your time may be better spent on earlier-stage opportunities.`,
  };
}

function generateFocusInsight(
  engagedSectors: Set<string>,
  engagedBLs: Set<string>,
  allProjects: any[],
  viewedIds: Set<number>
): string {
  const sectorLabels: Record<string, string> = {
    mining: "mining",
    oil_gas: "oil & gas",
    infrastructure: "infrastructure",
    energy: "energy",
    defence: "defence",
  };

  if (engagedSectors.size === 0) {
    return "You haven't engaged with any projects this week yet. Start with the suggested actions above to build momentum.";
  }

  const sectorNames = Array.from(engagedSectors).map(s => sectorLabels[s] || s);

  if (engagedSectors.size === 1) {
    const otherSectors = Object.keys(sectorLabels).filter(s => !engagedSectors.has(s));
    const otherWithProjects = otherSectors.filter(s =>
      allProjects.some(p => p.sector === s && p.priority !== "cold" && !viewedIds.has(p.id))
    );
    if (otherWithProjects.length > 0) {
      const otherNames = otherWithProjects.slice(0, 2).map(s => sectorLabels[s] || s);
      return `You're focused heavily on ${sectorNames[0]} this week. Consider reviewing ${otherNames.join(" and ")} opportunities as well — there are active projects worth a look.`;
    }
    return `You're focused on ${sectorNames[0]} this week. Good coverage of that sector.`;
  }

  return `You've been working across ${sectorNames.join(", ")} this week — good sector diversity.`;
}

function generateCoverageNote(
  allProjects: any[],
  viewedIds: Set<number>,
  tier1: any[]
): string {
  const unviewedTier1 = tier1.filter(p => !viewedIds.has(p.id));
  const totalTier1 = tier1.length;
  const viewedTier1 = totalTier1 - unviewedTier1.length;

  if (totalTier1 === 0) {
    return "No Tier 1 actionable projects this week. Focus on warming up Tier 2 opportunities.";
  }

  const coverage = Math.round((viewedTier1 / totalTier1) * 100);

  if (coverage >= 80) {
    return `Strong coverage — you've reviewed ${viewedTier1} of ${totalTier1} Tier 1 projects (${coverage}%). Keep the momentum going.`;
  }
  if (coverage >= 50) {
    return `Decent coverage — ${viewedTier1} of ${totalTier1} Tier 1 projects reviewed (${coverage}%). ${unviewedTier1.length} actionable projects still need attention.`;
  }
  return `${unviewedTier1.length} of ${totalTier1} Tier 1 projects haven't been reviewed yet. Consider prioritising these before the week ends.`;
}
