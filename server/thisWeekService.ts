/**
 * "This Week" Summary Service
 * Aggregates top priorities, new stakeholders, stage changes, and suggested actions
 * for the weekly landing page. Designed to surface the most actionable intelligence.
 */
import { getDb, getAllProjects, getAllContacts, getProfileByUserId } from "./db";
import { projects, contacts, projectBusinessLineScores, pipelineRuns, dismissedActions, pipelineClaims, outreachEmails } from "../drizzle/schema";
import { eq, desc, gte, and, sql, inArray } from "drizzle-orm";
import { getProjectScoresBatch, SCORING_DIMENSIONS } from "./businessLineScoring";
import { type ActionTier, getTierLabel, shouldIncludeInBrief } from "./tierClassification";
import { detectActivities, type DetectedActivity } from "./activitySignalLayer";
import { classifyRoleRelevance } from "./roleRelevance";
import { rankProjectsForUser } from "./mlRanker";
import { getActiveBusinessLines } from "./pipelineDb";
import { isAustralianRelevant } from "./geoFilter";

// ── Types ──

export interface ThisWeekProject {
  id: number;
  name: string;
  location: string;
  value: string;
  owner: string;
  priority: "hot" | "warm" | "cold";
  sector: string;
  stage: string | null;
  overview: string | null;
  actionTier: ActionTier | null;
  tierLabel: string;
  isNew: boolean;
  opportunityRoute: string;
  contractors: { name: string; status: string; confidence?: number; detail?: string }[] | null;
  equipmentSignals: string[] | null;
  detectedActivities: string[];
  relevanceScore: number;
  createdAt: Date | null;
  // ── Sales Context (enhanced) ──
  whyItMatters: string;
  topBusinessLines: { name: string; score: number }[];
  bestStakeholder: { name: string; title: string; company: string; relevance: string; email: string | null; linkedin: string | null } | null;
  suggestedAction: string;
  contactDepth: number; // how many high/medium contacts exist for this project
  // ── Scope context (why the rep sees this) ──
  scopeReason: string; // e.g. "WA + Portable Air match", "WA cross-sell", "Outside lane — adjacent PT"
  laneMatch: boolean; // true if project matches user's primary selling lane
}

export interface ThisWeekStakeholder {
  id: number;
  name: string;
  title: string;
  company: string;
  project: string;
  roleRelevance: "high" | "medium" | "low";
  roleBucket: string;
  email: string | null;
  linkedin: string | null;
  enrichmentSource: string | null;
  createdAt: Date;
  // ── Scope context ──
  laneMatch: boolean;
  scopeReason: string;
}

export interface StageChange {
  projectId: number;
  projectName: string;
  location: string;
  previousTier: string;
  currentTier: string;
  stage: string | null;
  priority: string;
  isUpgrade: boolean;
}

export interface SuggestedAction {
  type: "contact_outreach" | "contractor_gap" | "tier1_new" | "stage_upgrade" | "high_value" | "pipeline_claim";
  priority: "urgent" | "high" | "medium";
  title: string;
  description: string;
  projectId?: number;
  projectName?: string;
  contactId?: number;
  contactName?: string;
  /** Unique key for dismissal tracking: type:projectId:contactId */
  actionKey: string;
}

export interface UserContext {
  territories: string[];
  assignedBusinessLines: string[];
  sectorFocus: string[];
  hasPreferences: boolean;
}

export interface ThisWeekSummary {
  weekLabel: string;
  generatedAt: string;
  // User's configured preferences for display
  userContext: UserContext;
  // Top priority projects (Tier 1 + hot Tier 2, ranked by relevance)
  topProjects: ThisWeekProject[];
  // New stakeholders discovered this week (high/medium relevance only)
  newStakeholders: ThisWeekStakeholder[];
  // Projects that changed tier or stage recently
  stageChanges: StageChange[];
  // AI-generated suggested actions
  suggestedActions: SuggestedAction[];
  // Pipeline health
  lastSuccessfulPipelineRun: string | null; // ISO date of last successful pipeline run
  dataFreshnessWarning: string | null; // Warning message if data is stale
  // Summary stats
  stats: {
    totalProjects: number;
    totalInScope: number; // projects matching user's territory/BL
    tier1Count: number;
    tier2Count: number;
    tier3Count: number;
    hotCount: number;
    warmCount: number;
    newProjectsThisWeek: number;
    newContactsThisWeek: number;
    highRelevanceContacts: number;
    projectsWithContractors: number;
    projectsMissingContractors: number;
  };
}

// ── Helpers ──

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

function isRecent(date: Date | string | null, windowMs = SEVEN_DAYS_MS): boolean {
  if (!date) return false;
  const d = typeof date === "string" ? new Date(date) : date;
  return Date.now() - d.getTime() < windowMs;
}

/** Generate a stable key for an action so we can track dismissals */
function makeActionKey(type: string, projectId?: number, contactId?: number): string {
  return `${type}:${projectId ?? 0}:${contactId ?? 0}`;
}

/** Get the last successful pipeline run date */
async function getLastSuccessfulPipelineRun(): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = await db.select({ completedAt: pipelineRuns.completedAt })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.status, "completed"))
      .orderBy(desc(pipelineRuns.completedAt))
      .limit(1);
    return rows[0]?.completedAt ?? null;
  } catch { return null; }
}

/** Get dismissed action keys for a user */
async function getDismissedActionKeys(userId: number): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set();
  try {
    const rows = await db.select({ actionKey: dismissedActions.actionKey })
      .from(dismissedActions)
      .where(eq(dismissedActions.userId, userId));
    return new Set(rows.map(r => r.actionKey));
  } catch { return new Set(); }
}

/** Get project IDs the user has already engaged with (pipeline claims or outreach) */
async function getEngagedProjectIds(userId: number): Promise<Set<number>> {
  const db = await getDb();
  if (!db) return new Set();
  try {
    const claims = await db.select({ projectId: pipelineClaims.projectId })
      .from(pipelineClaims)
      .where(eq(pipelineClaims.userId, userId));
    const outreach = await db.select({ projectId: outreachEmails.projectId })
      .from(outreachEmails)
      .where(eq(outreachEmails.userId, userId));
    const ids = new Set<number>();
    claims.forEach(r => { if (r.projectId) ids.add(r.projectId); });
    outreach.forEach(r => { if (r.projectId) ids.add(r.projectId); });
    return ids;
  } catch { return new Set(); }
}

const TIER_RANK: Record<string, number> = {
  tier1_actionable: 3,
  tier2_warm: 2,
  tier3_monitor: 1,
};

// ── Main Aggregation ──

export async function getThisWeekSummary(userId?: number): Promise<ThisWeekSummary> {
  const db = await getDb();

  // Get all projects (active lifecycle, AU-only)
  const allProjects = await getAllProjects();
  const activeProjects = allProjects.filter(p =>
    (p.lifecycleStatus ?? "active") === "active" &&
    !p.geoBlockedReason // AU-only gate: exclude geo-blocked projects from rep views
  );

  // Get all contacts
  const allContacts = await getAllContacts();

  // Get current week's Monday date for the week label
  // This ensures the dashboard always shows the current week, even if the pipeline hasn't run recently
  const now = new Date();
  const dayOfWeekNow = now.getUTCDay(); // 0=Sun, 1=Mon, ...
  const mondayOffset = dayOfWeekNow === 0 ? -6 : 1 - dayOfWeekNow;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + mondayOffset);
  const weekLabel = `${monday.getFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;

  // ── Load user preferences for personalisation ──
  let userContext: UserContext = {
    territories: [],
    assignedBusinessLines: [],
    sectorFocus: [],
    hasPreferences: false,
  };
  let userProfile: any = null;
  if (userId && db) {
    try {
      userProfile = await getProfileByUserId(userId);
      if (userProfile) {
        userContext = {
          territories: (userProfile.territories as string[]) || [],
          assignedBusinessLines: (userProfile.assignedBusinessLines as string[]) || [],
          sectorFocus: (userProfile.sectorFocus as string[]) || [],
          hasPreferences:
            ((userProfile.territories as string[]) || []).length > 0 ||
            ((userProfile.assignedBusinessLines as string[]) || []).length > 0,
        };
      }
    } catch { /* continue without preferences */ }
  }

  // ── 1. Top Priority Projects ──
  // Filter to Tier 1 and hot/warm Tier 2, then rank
  const actionableProjects = activeProjects.filter(p => {
    const tier = (p as any).actionTier as ActionTier | null;
    const priority = p.priority as "hot" | "warm" | "cold";
    return shouldIncludeInBrief(tier ?? "tier3_monitor", priority);
  });

  // Apply ML ranking if user is provided (now includes BL + sector focus boosting)
  let rankedProjects = actionableProjects;
  if (userId && db) {
    try {
      const rankings = await rankProjectsForUser(userId, actionableProjects);
      rankedProjects = rankings.map(r => r.project);
    } catch {
      // Fall back to default ordering
    }
  }

  // ── Hard-filter by user's territory and assigned business lines ──
  // Only apply when user has explicit preferences set
  const stateKeywords: Record<string, string[]> = {
    WA: ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha", "port hedland", "newman", "geraldton", "bunbury", "broome"],
    QLD: ["queensland", "qld", "brisbane", "townsville", "mackay", "gladstone", "rockhampton", "cairns", "bowen basin", "moranbah", "emerald"],
    NSW: ["new south wales", "nsw", "sydney", "newcastle", "hunter valley", "wollongong", "broken hill", "orange", "dubbo", "mudgee"],
    VIC: ["victoria", "vic", "melbourne", "geelong", "ballarat", "bendigo", "latrobe valley"],
    SA: ["south australia", "sa", "adelaide", "olympic dam", "whyalla", "port augusta"],
    NT: ["northern territory", "nt", "darwin", "alice springs", "tennant creek", "katherine"],
    TAS: ["tasmania", "tas", "hobart", "launceston"],
    ACT: ["australian capital territory", "act", "canberra"],
    NATIONAL: ["national", "australia", "multi-state", "nationwide"],
    OFFSHORE: ["offshore", "fpso", "nwshelf", "north west shelf", "browse", "timor sea", "bass strait"],
  };

  const locationMatchesTerritories = (location: string, territories: string[]): boolean => {
    const loc = location.toLowerCase();
    return territories.some(t => {
      if (t.toUpperCase() === "NATIONAL") return true; // NATIONAL users see everything
      const keywords = stateKeywords[t.toUpperCase()] || [t.toLowerCase()];
      return keywords.some(kw => loc.includes(kw));
    });
  };

  if (userContext.territories.length > 0 || userContext.assignedBusinessLines.length > 0) {
    // Build BL name → ID map for matching
    let blNameToId: Record<string, number> = {};
    try {
      const allBLs = await getActiveBusinessLines();
      allBLs.forEach(bl => { blNameToId[bl.name] = bl.id; });
    } catch { /* fallback: no BL filter */ }

    const userBLIds = new Set<number>(
      userContext.assignedBusinessLines
        .map(name => blNameToId[name] ?? Object.entries(blNameToId).find(
          ([n]) => n.toLowerCase() === name.toLowerCase()
        )?.[1])
        .filter((id): id is number => id !== undefined)
    );

    rankedProjects = rankedProjects.filter(p => {
      // Territory check: if user has territories set, project must match one
      if (userContext.territories.length > 0) {
        const isNational = userContext.territories.some(t => t.toUpperCase() === "NATIONAL");
        if (!isNational && !locationMatchesTerritories(p.location, userContext.territories)) {
          return false;
        }
      }

      // BL check: if user has assigned BLs and project has BL data, at least one must match
      if (userBLIds.size > 0) {
        const projectBLs = (p as any).matchedBusinessLines as number[] | null;
        if (projectBLs && projectBLs.length > 0) {
          if (!projectBLs.some(id => userBLIds.has(id))) return false;
        }
        // If project has no BL data, include it (unscored projects shouldn't be hidden)
      }

      return true;
    });
  }

  // Sort by tier (T1 first), then priority (hot first), then by isNew
  rankedProjects.sort((a, b) => {
    const tierA = TIER_RANK[(a as any).actionTier ?? "tier3_monitor"] ?? 0;
    const tierB = TIER_RANK[(b as any).actionTier ?? "tier3_monitor"] ?? 0;
    if (tierA !== tierB) return tierB - tierA;
    const prioOrder = { hot: 3, warm: 2, cold: 1 };
    const prioA = prioOrder[a.priority as keyof typeof prioOrder] ?? 0;
    const prioB = prioOrder[b.priority as keyof typeof prioOrder] ?? 0;
    if (prioA !== prioB) return prioB - prioA;
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    return 0;
  });

  // Fetch BL scores for top projects
  const topProjectIds = rankedProjects.slice(0, 15).map(p => p.id);
  const blScoresMap: Record<number, Record<string, number>> = {};
  if (db && topProjectIds.length > 0) {
    try {
      const batchScores = await getProjectScoresBatch(topProjectIds);
      Array.from(batchScores.entries()).forEach(([pid, dims]) => {
        const scores: Record<string, number> = {};
        dims.forEach(d => { scores[d.dimension] = d.score; });
        blScoresMap[pid] = scores;
      });
    } catch { /* fallback to empty */ }
  }

  const topProjects: ThisWeekProject[] = rankedProjects.slice(0, 15).map(p => {
    const activities = detectActivities(
      p.name,
      p.overview,
      p.equipmentSignals as string[] | null,
      p.sector,
    );
    const tier = ((p as any).actionTier as ActionTier) ?? "tier3_monitor";

    // BL scores for this project
    const blScores = blScoresMap[p.id] ?? {};
    const topBLs = Object.entries(blScores)
      .filter(([_, score]) => score >= 40)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, score]) => ({ name, score }));

    // Find best stakeholder for this project
    const projectContacts = allContacts.filter(c =>
      c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
      p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
    );
    // Geographic filter: exclude non-Australian contacts from project displays
    const auProjectContacts = projectContacts.filter(c => isAustralianRelevant({
      title: c.title,
      linkedinHeadline: (c as any).linkedinHeadline,
      linkedinLocation: (c as any).linkedinLocation,
    }));
    const relevantContacts = auProjectContacts.filter(c =>
      (c as any).roleRelevance === "high" || (c as any).roleRelevance === "medium"
    );
    relevantContacts.sort((a, b) => {
      const relOrder: Record<string, number> = { high: 2, medium: 1, low: 0 };
      return (relOrder[(b as any).roleRelevance ?? "low"] ?? 0) - (relOrder[(a as any).roleRelevance ?? "low"] ?? 0);
    });
    const bestContact = relevantContacts[0] ?? null;

    // Generate "Why it matters" summary
    const whyParts: string[] = [];
    if (tier === "tier1_actionable") whyParts.push("Active-stage project ready for equipment decisions");
    else if (tier === "tier2_warm") whyParts.push("Advancing project nearing equipment procurement phase");
    if (activities.length > 0) whyParts.push(`Site activities: ${activities.slice(0, 3).map(a => a.activity).join(", ")}`);
    if (topBLs.length > 0) whyParts.push(`Strong fit for ${topBLs.map(bl => bl.name).join(", ")}`);
    if (p.contractors && (p.contractors as any[]).length > 0) {
      const cNames = (p.contractors as any[]).slice(0, 2).map((c: any) => c.name).join(", ");
      whyParts.push(`Contractors: ${cNames}`);
    }
    const whyItMatters = whyParts.join(". ") + ".";

    // Generate suggested action
    let suggestedAction = "Review project details and assess opportunity";
    if (bestContact && (bestContact as any).roleRelevance === "high") {
      suggestedAction = `Reach out to ${bestContact.name} (${bestContact.title}) — high-relevance contact`;
    } else if (relevantContacts.length === 0 && auProjectContacts.length === 0) {
      suggestedAction = "Run stakeholder discovery — no contacts found yet";
    } else if (relevantContacts.length === 0) {
      suggestedAction = "Run second-pass contact search — no high-relevance contacts";
    } else if (!p.contractors || (p.contractors as any[]).length === 0) {
      suggestedAction = "Run contractor enrichment — no contractor data available";
    }

    return {
      id: p.id,
      name: p.name,
      location: p.location,
      value: p.value,
      owner: p.owner,
      priority: p.priority as "hot" | "warm" | "cold",
      sector: p.sector,
      stage: p.stage,
      overview: p.overview,
      actionTier: tier,
      tierLabel: getTierLabel(tier),
      isNew: p.isNew,
      opportunityRoute: p.opportunityRoute,
      contractors: p.contractors as any,
      equipmentSignals: p.equipmentSignals as string[] | null,
      detectedActivities: activities.map(a => a.activity),
      relevanceScore: 0,
      createdAt: p.createdAt,
      // Sales context
      whyItMatters,
      topBusinessLines: topBLs,
      bestStakeholder: bestContact ? {
        name: bestContact.name,
        title: bestContact.title,
        company: bestContact.company,
        relevance: (bestContact as any).roleRelevance ?? "medium",
        email: bestContact.email,
        linkedin: (bestContact as any).linkedinProfileUrl ?? (bestContact as any).linkedin ?? null,
      } : null,
      suggestedAction,
      contactDepth: relevantContacts.length,
      // ── Scope reason ──
      // Determine why this project is surfaced for the rep
      scopeReason: (() => {
        const hasTerritory = userContext.territories.length > 0;
        const hasLane = userContext.assignedBusinessLines.length > 0;
        const territoryMatch = hasTerritory && locationMatchesTerritories(p.location, userContext.territories);
        const laneMatchCheck = hasLane && topBLs.some(bl =>
          userContext.assignedBusinessLines.some(ubl =>
            ubl.toLowerCase() === bl.name.toLowerCase() ||
            bl.name.toLowerCase().includes(ubl.toLowerCase()) ||
            ubl.toLowerCase().includes(bl.name.toLowerCase())
          )
        );
        if (!hasTerritory && !hasLane) return "In your pipeline";
        if (territoryMatch && laneMatchCheck) {
          const lane = userContext.assignedBusinessLines[0] ?? "your lane";
          const terr = userContext.territories[0] ?? "your territory";
          return `${terr} + ${lane} match`;
        }
        if (territoryMatch && !laneMatchCheck && topBLs.length > 0) {
          return `${userContext.territories[0]} cross-sell — ${topBLs[0].name}`;
        }
        if (territoryMatch) return `Live tender in ${userContext.territories[0]}`;
        if (tier === "tier1_actionable") return "Active-stage — action now";
        return "Adjacent PT — outside primary lane";
      })(),
      laneMatch: (() => {
        if (userContext.assignedBusinessLines.length === 0) return true;
        const blScores = blScoresMap[p.id] ?? {};
        const topBLsCheck = Object.entries(blScores)
          .filter(([_, score]) => score >= 40)
          .map(([name]) => name);
        return topBLsCheck.some(bl =>
          userContext.assignedBusinessLines.some(ubl =>
            ubl.toLowerCase() === bl.toLowerCase() ||
            bl.toLowerCase().includes(ubl.toLowerCase()) ||
            ubl.toLowerCase().includes(bl.toLowerCase())
          )
        );
      })(),
    };
  });

  // ── 2. New Stakeholders ──
  // Contacts created in the last 7 days with high or medium relevance
  // Also filter out non-Australian contacts
  const recentContacts = allContacts.filter(c =>
    isRecent(c.createdAt) &&
    ((c as any).roleRelevance === "high" || (c as any).roleRelevance === "medium") &&
    isAustralianRelevant({
      title: c.title,
      linkedinHeadline: (c as any).linkedinHeadline,
      linkedinLocation: (c as any).linkedinLocation,
    })
  );

  // Sort by relevance (high first), then by date (newest first)
  recentContacts.sort((a, b) => {
    const relOrder = { high: 3, medium: 2, low: 1 };
    const relA = relOrder[((a as any).roleRelevance ?? "low") as keyof typeof relOrder] ?? 0;
    const relB = relOrder[((b as any).roleRelevance ?? "low") as keyof typeof relOrder] ?? 0;
    if (relA !== relB) return relB - relA;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Build a set of project names that are in-scope for territory matching
  const inScopeProjectNames = new Set(rankedProjects.map(p => p.name.toLowerCase().slice(0, 30)));

  const newStakeholders: ThisWeekStakeholder[] = recentContacts.slice(0, 20).map(c => {
    // Determine if this stakeholder's project is in the user's territory scope
    const contactProjectLower = c.project.toLowerCase().slice(0, 30);
    const inScopeArray = Array.from(inScopeProjectNames);
    const projectInScope = inScopeProjectNames.has(contactProjectLower) ||
      inScopeArray.some(n => n.includes(contactProjectLower) || contactProjectLower.includes(n));
    // Determine lane match based on roleBucket
    const portableAirRoles = ["maintenance", "reliability", "mechanical", "equipment", "fleet", "hme", "shutdown", "fixed plant"];
    const roleLower = (c.roleBucket ?? "").toLowerCase();
    const titleLower = (c.title ?? "").toLowerCase();
    const isPortableAirRole = portableAirRoles.some(r => roleLower.includes(r) || titleLower.includes(r));
    const hasLane = userContext.assignedBusinessLines.length > 0;
    const laneMatch = !hasLane || isPortableAirRole;
    // Build scope reason
    let scopeReason = "New contact this week";
    if (projectInScope && laneMatch) {
      const terr = userContext.territories[0] ?? "your territory";
      const lane = userContext.assignedBusinessLines[0] ?? "your lane";
      scopeReason = `${terr} + ${lane} match`;
    } else if (projectInScope) {
      scopeReason = `${userContext.territories[0] ?? "Territory"} — adjacent role`;
    } else if (laneMatch) {
      scopeReason = `${userContext.assignedBusinessLines[0] ?? "Lane"} role — outside territory`;
    } else {
      scopeReason = "Outside primary scope";
    }
    return {
      id: c.id,
      name: c.name,
      title: c.title,
      company: c.company,
      project: c.project,
      roleRelevance: ((c as any).roleRelevance ?? "medium") as "high" | "medium" | "low",
      roleBucket: c.roleBucket,
      email: c.email,
      linkedin: (c as any).linkedinProfileUrl ?? (c as any).linkedin ?? null,
      enrichmentSource: c.enrichmentSource,
      createdAt: c.createdAt,
      laneMatch,
      scopeReason,
    };
  });

  // ── 3. Stage Changes ──
  // Detect projects that are new (isNew=true) and in Tier 1 — these represent stage upgrades
  // Also detect recently updated projects that moved to a higher tier
  const stageChanges: StageChange[] = [];

  // New Tier 1 projects are the most important stage changes
  const newTier1 = activeProjects.filter(p =>
    p.isNew && (p as any).actionTier === "tier1_actionable"
  );
  for (const p of newTier1.slice(0, 5)) {
    stageChanges.push({
      projectId: p.id,
      projectName: p.name,
      location: p.location,
      previousTier: "New Entry",
      currentTier: "Tier 1 — Actionable",
      stage: p.stage,
      priority: p.priority,
      isUpgrade: true,
    });
  }

  // New Tier 2 hot/warm projects
  const newTier2Hot = activeProjects.filter(p =>
    p.isNew && (p as any).actionTier === "tier2_warm" && (p.priority === "hot" || p.priority === "warm")
  );
  for (const p of newTier2Hot.slice(0, 3)) {
    stageChanges.push({
      projectId: p.id,
      projectName: p.name,
      location: p.location,
      previousTier: "New Entry",
      currentTier: "Tier 2 — Warm",
      stage: p.stage,
      priority: p.priority,
      isUpgrade: true,
    });
  }

  // Recently updated projects (updatedAt in last 7 days) that are Tier 1 but not new
  const recentlyUpdatedT1 = activeProjects.filter(p =>
    !p.isNew &&
    (p as any).actionTier === "tier1_actionable" &&
    isRecent(p.updatedAt)
  );
  for (const p of recentlyUpdatedT1.slice(0, 5)) {
    stageChanges.push({
      projectId: p.id,
      projectName: p.name,
      location: p.location,
      previousTier: "Updated",
      currentTier: "Tier 1 — Actionable",
      stage: p.stage,
      priority: p.priority,
      isUpgrade: false,
    });
  }

  // ── 4. Suggested Actions (with dismissal + staleness filtering) ──
  // Load dismissed actions and engaged projects for this user
  const dismissedKeys = userId ? await getDismissedActionKeys(userId) : new Set<string>();
  const engagedProjectIds = userId ? await getEngagedProjectIds(userId) : new Set<number>();

  // Get pipeline health
  const lastPipelineRun = await getLastSuccessfulPipelineRun();
  const lastPipelineRunStr = lastPipelineRun ? lastPipelineRun.toISOString() : null;
  let dataFreshnessWarning: string | null = null;
  if (!lastPipelineRun) {
    dataFreshnessWarning = "No successful pipeline runs found. Project data may be incomplete.";
  } else if (Date.now() - lastPipelineRun.getTime() > FOURTEEN_DAYS_MS) {
    const daysAgo = Math.floor((Date.now() - lastPipelineRun.getTime()) / (24 * 60 * 60 * 1000));
    dataFreshnessWarning = `Project data is ${daysAgo} days old. The pipeline last ran successfully on ${lastPipelineRun.toLocaleDateString("en-AU")}.`;
  } else if (Date.now() - lastPipelineRun.getTime() > SEVEN_DAYS_MS) {
    const daysAgo = Math.floor((Date.now() - lastPipelineRun.getTime()) / (24 * 60 * 60 * 1000));
    dataFreshnessWarning = `Data may be slightly outdated (${daysAgo} days since last pipeline run).`;
  }

  const rawActions: SuggestedAction[] = [];

  // ── Generate candidate actions ──

  // Category 1: Tier 1 projects needing outreach (both new AND existing unengaged)
  const tier1Unengaged = topProjects.filter(tp =>
    tp.actionTier === "tier1_actionable" &&
    !engagedProjectIds.has(tp.id)
  ).slice(0, 5);

  for (const p of tier1Unengaged) {
    const projectContacts = allContacts.filter(c =>
      c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
      p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
    );
    const highRelContacts = projectContacts.filter(c => (c as any).roleRelevance === "high");

    if (highRelContacts.length > 0) {
      const key = makeActionKey("contact_outreach", p.id, highRelContacts[0].id);
      rawActions.push({
        type: "contact_outreach",
        priority: p.isNew ? "urgent" : "high",
        title: `Reach out to ${highRelContacts[0].name} on ${p.name}`,
        description: `${highRelContacts[0].title} at ${highRelContacts[0].company} — ${p.isNew ? "new " : ""}Tier 1 project in ${p.location}. ${p.stage ? `Stage: ${p.stage}.` : ""} Value: ${p.value}.`,
        projectId: p.id,
        projectName: p.name,
        contactId: highRelContacts[0].id,
        contactName: highRelContacts[0].name,
        actionKey: key,
      });
    } else {
      const key = makeActionKey("tier1_new", p.id);
      rawActions.push({
        type: "tier1_new",
        priority: p.isNew ? "urgent" : "high",
        title: `${p.isNew ? "New " : ""}Tier 1 opportunity: ${p.name}`,
        description: `${p.location} — ${p.value}. ${p.stage ? `Stage: ${p.stage}.` : ""} No high-relevance contacts found yet — consider running stakeholder discovery.`,
        projectId: p.id,
        projectName: p.name,
        actionKey: key,
      });
    }
  }

  // Category 2: Projects missing contractors (not already engaged)
  const missingContractorProjects = topProjects.filter(p =>
    (!p.contractors || p.contractors.length === 0) &&
    !engagedProjectIds.has(p.id)
  ).slice(0, 3);
  for (const p of missingContractorProjects) {
    const key = makeActionKey("contractor_gap", p.id);
    rawActions.push({
      type: "contractor_gap",
      priority: "high",
      title: `Find contractors for ${p.name}`,
      description: `${p.tierLabel} project in ${p.location} (${p.value}) has no contractor data. Run contractor enrichment to identify EPC/construction partners.`,
      projectId: p.id,
      projectName: p.name,
      actionKey: key,
    });
  }

  // Category 3: Hot projects with high value (not already engaged or in actions)
  const highValueHot = topProjects.filter(p =>
    p.priority === "hot" &&
    p.value &&
    !p.value.toLowerCase().includes("undisclosed") &&
    !engagedProjectIds.has(p.id) &&
    !rawActions.some(a => a.projectId === p.id)
  ).slice(0, 3);
  for (const p of highValueHot) {
    const key = makeActionKey("high_value", p.id);
    rawActions.push({
      type: "high_value",
      priority: "high",
      title: `High-value hot opportunity: ${p.name}`,
      description: `${p.location} — ${p.value}. ${p.detectedActivities.length > 0 ? `Site activities: ${p.detectedActivities.slice(0, 3).join(", ")}.` : ""} Consider adding to your pipeline.`,
      projectId: p.id,
      projectName: p.name,
      actionKey: key,
    });
  }

  // ── Filter out dismissed actions ──
  const suggestedActions = rawActions.filter(a => !dismissedKeys.has(a.actionKey));

  // ── Deprioritize stale actions (projects created >14 days ago that aren't recently updated) ──
  for (const action of suggestedActions) {
    if (action.projectId) {
      const project = topProjects.find(p => p.id === action.projectId);
      if (project && project.createdAt && !isRecent(project.createdAt, FOURTEEN_DAYS_MS) && !isRecent((project as any).updatedAt)) {
        // Downgrade priority for stale projects
        if (action.priority === "urgent") action.priority = "high";
        else if (action.priority === "high") action.priority = "medium";
      }
    }
  }

  // Sort actions by priority
  const priorityOrder = { urgent: 3, high: 2, medium: 1 };
  suggestedActions.sort((a, b) =>
    (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0)
  );

  // Limit to top 10 actions
  const finalActions = suggestedActions.slice(0, 10);

  // ── 5. Stats ── (use rankedProjects = filtered by territory + BL)
  const scopedProjects = rankedProjects; // already filtered by territory & BL above
  const newProjectsThisWeek = scopedProjects.filter(p => p.isNew).length;
  const newContactsThisWeek = allContacts.filter(c => isRecent(c.createdAt)).length;
  const highRelevanceContacts = allContacts.filter(c => (c as any).roleRelevance === "high").length;
  const projectsWithContractors = scopedProjects.filter(p =>
    p.contractors && (p.contractors as any[]).length > 0
  ).length;

  const stats = {
    totalProjects: activeProjects.length,
    totalInScope: scopedProjects.length,
    tier1Count: scopedProjects.filter(p => (p as any).actionTier === "tier1_actionable").length,
    tier2Count: scopedProjects.filter(p => (p as any).actionTier === "tier2_warm").length,
    tier3Count: scopedProjects.filter(p => (p as any).actionTier === "tier3_monitor").length,
    hotCount: scopedProjects.filter(p => p.priority === "hot").length,
    warmCount: scopedProjects.filter(p => p.priority === "warm").length,
    newProjectsThisWeek,
    newContactsThisWeek,
    highRelevanceContacts,
    projectsWithContractors,
    projectsMissingContractors: scopedProjects.length - projectsWithContractors,
  };

  return {
    weekLabel,
    generatedAt: new Date().toISOString(),
    userContext,
    topProjects,
    newStakeholders,
    stageChanges,
    suggestedActions: finalActions,
    lastSuccessfulPipelineRun: lastPipelineRunStr,
    dataFreshnessWarning,
    stats,
  };
}

/**
 * Get a compact version of This Week for the email digest.
 * Returns top 3 projects, top 2 stakeholders, and 1 urgent action.
 */
export async function getThisWeekForEmail(userId?: number): Promise<{
  top3Projects: ThisWeekProject[];
  top2Stakeholders: ThisWeekStakeholder[];
  urgentAction: SuggestedAction | null;
  weekLabel: string;
  stats: ThisWeekSummary["stats"];
}> {
  const summary = await getThisWeekSummary(userId);
  return {
    top3Projects: summary.topProjects.slice(0, 3),
    top2Stakeholders: summary.newStakeholders.slice(0, 2),
    urgentAction: summary.suggestedActions.find(a => a.priority === "urgent") ?? summary.suggestedActions[0] ?? null,
    weekLabel: summary.weekLabel,
    stats: summary.stats,
  };
}
