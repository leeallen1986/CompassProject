/**
 * Behaviour Analysis Service
 *
 * Analyses a rep's activity history to infer:
 * - Working style (sector focus, stage preference, BL comfort zones)
 * - Engagement patterns (time-of-day, day-of-week, consistency)
 * - Blind spots (sectors/BLs/stages they're underworking)
 * - Strengths (what they're naturally gravitating toward)
 *
 * This is NOT surveillance. It's self-awareness tooling.
 * The rep sees their own profile; managers see aggregate patterns only.
 */
import { getDb, getAllProjects } from "./db";
import { userActivity, projects, projectBusinessLineScores, userProfiles } from "../drizzle/schema";
import { eq, and, gte, desc, sql, inArray, count } from "drizzle-orm";

// ── Types ──

export interface SectorEngagement {
  sector: string;
  projectsViewed: number;
  contactsOpened: number;
  outreachSent: number;
  totalActions: number;
  /** Percentage of this rep's total activity */
  shareOfActivity: number;
}

export interface BLEngagement {
  businessLine: string;
  projectsEngaged: number;
  /** How many high-score projects exist that the rep hasn't touched */
  untouchedHighScore: number;
  isBlindSpot: boolean;
}

export interface StagePreference {
  stage: string;
  projectCount: number;
  shareOfActivity: number;
}

export interface EngagementPattern {
  /** Most active days of the week (0=Sun, 6=Sat) */
  activeDays: { day: number; dayName: string; count: number }[];
  /** Average actions per active day */
  avgActionsPerDay: number;
  /** Consistency score (0-100): how evenly spread is activity across the period */
  consistencyScore: number;
  /** Total actions in the period */
  totalActions: number;
  /** Days with at least 1 action */
  activeDayCount: number;
}

export interface WorkingStyleProfile {
  userId: number;
  periodDays: number;
  generatedAt: number;
  // Sector analysis
  sectorEngagement: SectorEngagement[];
  topSectors: string[];
  underworkedSectors: string[];
  // Business line analysis
  blEngagement: BLEngagement[];
  comfortZones: string[];
  blindSpots: string[];
  // Stage preference
  stagePreferences: StagePreference[];
  preferredStages: string[];
  // Engagement patterns
  engagementPattern: EngagementPattern;
  // Summary insights (human-readable)
  insights: WorkingStyleInsight[];
}

export interface WorkingStyleInsight {
  type: "strength" | "opportunity" | "pattern" | "suggestion";
  title: string;
  description: string;
  icon: string; // emoji for UI
}

// ── Cache ──
const profileCache = new Map<string, { data: WorkingStyleProfile; expiresAt: number }>();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export function clearBehaviourCache(): void {
  profileCache.clear();
}

// ── Main Entry ──

export async function getWorkingStyleProfile(
  userId: number,
  periodDays: number = 30
): Promise<WorkingStyleProfile> {
  const cacheKey = `${userId}-${periodDays}`;
  const cached = profileCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const since = new Date();
  since.setDate(since.getDate() - periodDays);

  // ── Fetch activity ──
  const activities = await db
    .select()
    .from(userActivity)
    .where(and(eq(userActivity.userId, userId), gte(userActivity.createdAt, since)))
    .orderBy(desc(userActivity.createdAt))
    .limit(2000);

  // ── Fetch all active projects for cross-reference ──
  const allProjects = await db
    .select()
    .from(projects)
    .limit(1000);

  const projectMap = new Map(allProjects.map(p => [p.id, p]));

  // ── Fetch BL scores ──
  const projectIds = Array.from(new Set(activities.filter(a => a.projectId).map(a => a.projectId!)));
  const blScoresMap = new Map<number, { dimension: string; score: number }[]>();

  if (projectIds.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < projectIds.length; i += batchSize) {
      const batch = projectIds.slice(i, i + batchSize);
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

  // ── Sector Engagement ──
  const sectorEngagement = analyseSectorEngagement(activities, projectMap);

  // ── BL Engagement ──
  const blEngagement = analyseBLEngagement(activities, projectMap, blScoresMap, allProjects);

  // ── Stage Preferences ──
  const stagePreferences = analyseStagePreferences(activities, projectMap);

  // ── Engagement Patterns ──
  const engagementPattern = analyseEngagementPatterns(activities, periodDays);

  // ── Generate Insights ──
  const insights = generateInsights(sectorEngagement, blEngagement, stagePreferences, engagementPattern, allProjects);

  const profile: WorkingStyleProfile = {
    userId,
    periodDays,
    generatedAt: Date.now(),
    sectorEngagement,
    topSectors: sectorEngagement.filter(s => s.shareOfActivity >= 20).map(s => s.sector),
    underworkedSectors: findUnderworkedSectors(sectorEngagement, allProjects),
    blEngagement,
    comfortZones: blEngagement.filter(b => b.projectsEngaged >= 3 && !b.isBlindSpot).map(b => b.businessLine),
    blindSpots: blEngagement.filter(b => b.isBlindSpot).map(b => b.businessLine),
    stagePreferences,
    preferredStages: stagePreferences.filter(s => s.shareOfActivity >= 25).map(s => s.stage),
    engagementPattern,
    insights,
  };

  profileCache.set(cacheKey, { data: profile, expiresAt: Date.now() + CACHE_TTL_MS });
  return profile;
}

// ── Analysis Functions ──

function analyseSectorEngagement(
  activities: any[],
  projectMap: Map<number, any>
): SectorEngagement[] {
  const sectorData: Record<string, { viewed: Set<number>; contacts: number; outreach: number; total: number }> = {};

  for (const a of activities) {
    if (!a.projectId) continue;
    const proj = projectMap.get(a.projectId);
    if (!proj) continue;
    const sector = proj.sector;
    if (!sectorData[sector]) {
      sectorData[sector] = { viewed: new Set(), contacts: 0, outreach: 0, total: 0 };
    }
    sectorData[sector].total++;
    if (a.actionType === "project_viewed") sectorData[sector].viewed.add(a.projectId);
    if (a.actionType === "contact_viewed") sectorData[sector].contacts++;
    if (a.actionType === "outreach_sent" || a.actionType === "outreach_drafted") sectorData[sector].outreach++;
  }

  const totalActions = activities.length || 1;

  return Object.entries(sectorData)
    .map(([sector, data]) => ({
      sector,
      projectsViewed: data.viewed.size,
      contactsOpened: data.contacts,
      outreachSent: data.outreach,
      totalActions: data.total,
      shareOfActivity: Math.round((data.total / totalActions) * 100),
    }))
    .sort((a, b) => b.totalActions - a.totalActions);
}

function analyseBLEngagement(
  activities: any[],
  projectMap: Map<number, any>,
  blScoresMap: Map<number, { dimension: string; score: number }[]>,
  allProjects: any[]
): BLEngagement[] {
  // Count which BLs the rep has engaged with
  const engagedProjectIds = new Set(activities.filter(a => a.projectId).map(a => a.projectId!));
  const blEngaged: Record<string, Set<number>> = {};

  for (const pid of Array.from(engagedProjectIds)) {
    const scores = blScoresMap.get(pid) || [];
    for (const s of scores) {
      if (s.score >= 50) {
        if (!blEngaged[s.dimension]) blEngaged[s.dimension] = new Set();
        blEngaged[s.dimension].add(pid);
      }
    }
  }

  // Count high-score projects the rep HASN'T touched
  const allBLHighScore: Record<string, number> = {};
  for (const p of allProjects) {
    if (engagedProjectIds.has(p.id)) continue;
    // We need to check BL scores for unengaged projects too
    // But we may not have them loaded — approximate from sector
    const scores = blScoresMap.get(p.id) || [];
    for (const s of scores) {
      if (s.score >= 70) {
        allBLHighScore[s.dimension] = (allBLHighScore[s.dimension] || 0) + 1;
      }
    }
  }

  // Combine all known BLs
  const allBLs = new Set([...Object.keys(blEngaged), ...Object.keys(allBLHighScore)]);

  return Array.from(allBLs).map(bl => {
    const engaged = blEngaged[bl]?.size || 0;
    const untouched = allBLHighScore[bl] || 0;
    return {
      businessLine: bl,
      projectsEngaged: engaged,
      untouchedHighScore: untouched,
      isBlindSpot: engaged === 0 && untouched >= 3,
    };
  }).sort((a, b) => b.projectsEngaged - a.projectsEngaged);
}

function analyseStagePreferences(
  activities: any[],
  projectMap: Map<number, any>
): StagePreference[] {
  const stageCounts: Record<string, Set<number>> = {};

  for (const a of activities) {
    if (!a.projectId || a.actionType !== "project_viewed") continue;
    const proj = projectMap.get(a.projectId);
    if (!proj || !proj.stage) continue;
    const stage = normaliseStage(proj.stage);
    if (!stageCounts[stage]) stageCounts[stage] = new Set();
    stageCounts[stage].add(a.projectId);
  }

  const totalProjects = Object.values(stageCounts).reduce((sum, s) => sum + s.size, 0) || 1;

  return Object.entries(stageCounts)
    .map(([stage, pids]) => ({
      stage,
      projectCount: pids.size,
      shareOfActivity: Math.round((pids.size / totalProjects) * 100),
    }))
    .sort((a, b) => b.projectCount - a.projectCount);
}

function normaliseStage(stage: string): string {
  const s = stage.toLowerCase();
  if (/feasib|study|concept|scoping/.test(s)) return "Feasibility/Study";
  if (/plan|permit|approv/.test(s)) return "Planning/Permitting";
  if (/tender|bid|procurement/.test(s)) return "Tender/Procurement";
  if (/construct|build|execut/.test(s)) return "Construction/Execution";
  if (/commission|start.?up|ramp/.test(s)) return "Commissioning";
  if (/operat|produc|active/.test(s)) return "Operational";
  if (/explor|drill/.test(s)) return "Exploration/Drilling";
  return stage;
}

function analyseEngagementPatterns(
  activities: any[],
  periodDays: number
): EngagementPattern {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayCounts: Record<number, number> = {};
  const dateCounts: Record<string, number> = {};

  for (const a of activities) {
    const d = new Date(a.createdAt);
    const dayOfWeek = d.getDay();
    dayCounts[dayOfWeek] = (dayCounts[dayOfWeek] || 0) + 1;
    const dateKey = d.toISOString().slice(0, 10);
    dateCounts[dateKey] = (dateCounts[dateKey] || 0) + 1;
  }

  const activeDays = Object.entries(dayCounts)
    .map(([day, c]) => ({ day: parseInt(day), dayName: dayNames[parseInt(day)], count: c }))
    .sort((a, b) => b.count - a.count);

  const activeDayCount = Object.keys(dateCounts).length;
  const avgActionsPerDay = activeDayCount > 0 ? Math.round(activities.length / activeDayCount) : 0;

  // Consistency: how evenly spread across the period
  // Perfect consistency = actions every day; poor = all in one burst
  const expectedDays = Math.min(periodDays, 30);
  const consistencyScore = Math.min(100, Math.round((activeDayCount / expectedDays) * 100));

  return {
    activeDays,
    avgActionsPerDay,
    consistencyScore,
    totalActions: activities.length,
    activeDayCount,
  };
}

function findUnderworkedSectors(
  sectorEngagement: SectorEngagement[],
  allProjects: any[]
): string[] {
  const sectorLabels: Record<string, string> = {
    mining: "Mining",
    oil_gas: "Oil & Gas",
    infrastructure: "Infrastructure",
    energy: "Energy",
    defence: "Defence",
  };

  const engagedSectors = new Set(sectorEngagement.map(s => s.sector));
  const allSectors = new Set(allProjects.filter(p => p.priority !== "cold").map(p => p.sector));

  return Array.from(allSectors)
    .filter(s => !engagedSectors.has(s))
    .map(s => sectorLabels[s] || s);
}

// ── Insight Generation ──

function generateInsights(
  sectorEngagement: SectorEngagement[],
  blEngagement: BLEngagement[],
  stagePreferences: StagePreference[],
  engagementPattern: EngagementPattern,
  allProjects: any[]
): WorkingStyleInsight[] {
  const insights: WorkingStyleInsight[] = [];

  // Strength: dominant sector
  if (sectorEngagement.length > 0 && sectorEngagement[0].shareOfActivity >= 40) {
    insights.push({
      type: "strength",
      title: `Strong ${formatSector(sectorEngagement[0].sector)} Focus`,
      description: `${sectorEngagement[0].shareOfActivity}% of your activity is in ${formatSector(sectorEngagement[0].sector)}. You're building deep expertise in this sector.`,
      icon: "💪",
    });
  }

  // Opportunity: blind spots
  const blindSpots = blEngagement.filter(b => b.isBlindSpot);
  if (blindSpots.length > 0) {
    const blNames = blindSpots.slice(0, 2).map(b => b.businessLine).join(" and ");
    const totalUntouched = blindSpots.reduce((sum, b) => sum + b.untouchedHighScore, 0);
    insights.push({
      type: "opportunity",
      title: `Untapped ${blNames} Opportunities`,
      description: `There are ${totalUntouched} high-relevance projects for ${blNames} that you haven't explored yet. These could be quick wins.`,
      icon: "🔍",
    });
  }

  // Pattern: engagement consistency
  if (engagementPattern.consistencyScore >= 70) {
    insights.push({
      type: "pattern",
      title: "Consistent Engagement",
      description: `You're active ${engagementPattern.activeDayCount} days with ~${engagementPattern.avgActionsPerDay} actions per day. Consistent engagement correlates with better pipeline coverage.`,
      icon: "📊",
    });
  } else if (engagementPattern.consistencyScore < 40 && engagementPattern.totalActions > 10) {
    insights.push({
      type: "suggestion",
      title: "Consider Spreading Activity",
      description: `Your activity tends to cluster in bursts. Spreading 15-20 minutes of project review across more days can improve coverage and catch time-sensitive opportunities.`,
      icon: "⏰",
    });
  }

  // Stage preference insight
  if (stagePreferences.length > 0 && stagePreferences[0].shareOfActivity >= 50) {
    const preferredStage = stagePreferences[0].stage;
    const earlyStages = ["Feasibility/Study", "Planning/Permitting", "Exploration/Drilling"];
    if (earlyStages.includes(preferredStage)) {
      insights.push({
        type: "strength",
        title: "Early-Stage Specialist",
        description: `You gravitate toward ${preferredStage} projects. This is valuable — building relationships early gives Atlas Copco first-mover advantage.`,
        icon: "🌱",
      });
    } else {
      insights.push({
        type: "pattern",
        title: `${preferredStage} Focus`,
        description: `Most of your activity is on ${preferredStage} projects. Consider also reviewing earlier-stage projects to build pipeline for next quarter.`,
        icon: "📋",
      });
    }
  }

  // Sector diversity
  const activeSectors = sectorEngagement.filter(s => s.shareOfActivity >= 10);
  if (activeSectors.length >= 3) {
    insights.push({
      type: "strength",
      title: "Good Sector Diversity",
      description: `You're working across ${activeSectors.length} sectors. This broad coverage helps identify cross-sector opportunities.`,
      icon: "🎯",
    });
  }

  // Outreach ratio
  const totalViews = sectorEngagement.reduce((sum, s) => sum + s.projectsViewed, 0);
  const totalOutreach = sectorEngagement.reduce((sum, s) => sum + s.outreachSent, 0);
  if (totalViews > 10 && totalOutreach === 0) {
    insights.push({
      type: "suggestion",
      title: "Convert Views to Outreach",
      description: `You've reviewed ${totalViews} projects but haven't sent any outreach yet. Consider drafting an email for your top prospect.`,
      icon: "✉️",
    });
  } else if (totalViews > 0 && totalOutreach > 0) {
    const ratio = Math.round((totalOutreach / totalViews) * 100);
    if (ratio >= 20) {
      insights.push({
        type: "strength",
        title: "Strong Conversion Rate",
        description: `${ratio}% of your project reviews lead to outreach — that's a healthy conversion rate.`,
        icon: "🚀",
      });
    }
  }

  return insights.slice(0, 6); // Cap at 6 insights
}

function formatSector(sector: string): string {
  const labels: Record<string, string> = {
    mining: "Mining",
    oil_gas: "Oil & Gas",
    infrastructure: "Infrastructure",
    energy: "Energy",
    defence: "Defence",
  };
  return labels[sector] || sector;
}
