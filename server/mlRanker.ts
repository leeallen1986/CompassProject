/**
 * ML Ranker — Feedback-driven project relevance scoring.
 *
 * Uses a lightweight Bayesian weight-learning approach:
 * 1. Starts with the user's onboarding profile as prior weights
 * 2. Each thumbs-up/down adjusts feature weights via exponential moving average
 * 3. Projects are scored by weighted feature overlap
 *
 * Zero AI credits — pure math on user feedback data.
 */
import { eq, desc, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  feedbackWeights, projectFeedback, userProfiles, projects,
  projectBusinessLineScores,
  type FeedbackWeight, type Project, type UserProfile,
} from "../drizzle/schema";
import { resolveTerritories, resolveBusinessLines } from "./canonicalMappings";

// ── Configuration ──

const LEARNING_RATE = 0.15; // How fast weights adjust per feedback event
const BASE_WEIGHT = 1.0;    // Default weight for unobserved features
const BOOST_FACTOR = 1.3;   // Multiplier for thumbs-up features
const PENALTY_FACTOR = 0.7; // Multiplier for thumbs-down features

// ── Types ──

interface ScoredProject {
  project: Project;
  relevanceScore: number;   // 0-100
  profileMatch: number;     // 0-100 (from onboarding profile)
  feedbackBoost: number;    // -50 to +50 (from learned weights)
  blBoost: number;          // 0-30 (from BL match)
  matchDetails: {
    territory: number;
    industry: number;
    sector: number;
    dealSize: number;
    businessLine: number;
  };
}

// ── Territory extraction from location string ──

function extractTerritory(location: string): string[] {
  const territories: string[] = [];
  const loc = location.toLowerCase();

  const stateMap: Record<string, string[]> = {
    WA: ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha", "port hedland", "geraldton", "bunbury"],
    QLD: ["queensland", "qld", "brisbane", "townsville", "mackay", "gladstone", "rockhampton", "cairns", "bowen basin"],
    NSW: ["new south wales", "nsw", "sydney", "newcastle", "wollongong", "hunter valley"],
    VIC: ["victoria", "vic", "melbourne", "geelong", "latrobe"],
    SA: ["south australia", "sa", "adelaide", "olympic dam", "whyalla", "port augusta"],
    NT: ["northern territory", "nt", "darwin", "alice springs", "tennant creek"],
    TAS: ["tasmania", "tas", "hobart", "launceston"],
    ACT: ["australian capital territory", "act", "canberra"],
  };

  for (const [state, keywords] of Object.entries(stateMap)) {
    if (keywords.some(kw => {
      // Short abbreviations (2-3 chars) need strict word-boundary matching
      // to prevent "SA" matching "USA", "WA" matching "water", etc.
      if (kw.length <= 3) {
        const re = new RegExp(`(?:^|[\\s,;/|()\\-])${kw}(?:$|[\\s,;/|()\\-])`, "i");
        return re.test(loc);
      }
      return loc.includes(kw);
    })) {
      territories.push(state);
    }
  }

  return territories.length > 0 ? territories : ["National"];
}

// ── Sector to industry mapping ──

function sectorToIndustries(sector: string): string[] {
  const map: Record<string, string[]> = {
    mining: ["mining_exploration", "mining_production", "mining_processing"],
    oil_gas: ["oil_gas_upstream", "oil_gas_downstream", "oil_gas_lng"],
    infrastructure: ["infrastructure_transport", "infrastructure_water", "infrastructure_civil"],
    energy: ["energy_renewables", "energy_conventional", "energy_transmission"],
    defence: ["defence_naval", "defence_land", "defence_aerospace"],
  };
  return map[sector] || [];
}

// ── Value parsing ──

function parseValueToNumber(value: string): number {
  const cleaned = value.replace(/[^0-9.bmk]/gi, "").toLowerCase();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  if (value.toLowerCase().includes("b")) return num * 1_000_000_000;
  if (value.toLowerCase().includes("m")) return num * 1_000_000;
  if (value.toLowerCase().includes("k")) return num * 1_000;
  return num;
}

// ── Profile-based scoring (from onboarding) ──

function scoreByProfile(project: Project, profile: UserProfile): {
  total: number;
  territory: number;
  industry: number;
  sector: number;
  dealSize: number;
} {
  let territory = 0;
  let industry = 0;
  let sector = 0;
  let dealSize = 0;

  // Territory match (uses canonical resolver)
  const projectTerritories = extractTerritory(project.location);
  const resolvedTerritories = resolveTerritories(
    profile.territories as string[] | string | null,
    profile.sectorFocus as string[] | string | null
  );
  if (resolvedTerritories.length > 0) {
    const overlap = projectTerritories.filter(t =>
      resolvedTerritories.some(rt => rt.toUpperCase() === t.toUpperCase())
    );
    territory = overlap.length > 0 ? 25 : 5;
  } else {
    territory = 15; // No preference = moderate match
  }

  // Industry/sector match
  const userIndustries = (profile.industries as string[]) || [];
  const projectIndustries = sectorToIndustries(project.sector);
  if (userIndustries.length > 0 && projectIndustries.length > 0) {
    const overlap = projectIndustries.filter(i => userIndustries.some(ui => i.startsWith(ui.split("_")[0])));
    industry = overlap.length > 0 ? 25 : 5;
  } else {
    industry = 15;
  }

  // Sector direct match
  const userSectors = userIndustries.map(i => i.split("_")[0]);
  sector = userSectors.includes(project.sector) ? 25 : 10;

  // Deal size match
  const projectValue = parseValueToNumber(project.value);
  const minVal = parseValueToNumber(profile.dealSizeMin || "0");
  const maxVal = parseValueToNumber(profile.dealSizeMax || "999999999999");
  if (projectValue >= minVal && projectValue <= maxVal) {
    dealSize = 25;
  } else if (projectValue > 0) {
    dealSize = 10;
  } else {
    dealSize = 15; // Unknown value
  }

  return {
    total: territory + industry + sector + dealSize,
    territory,
    industry,
    sector,
    dealSize,
  };
}

// ── Get or initialize feedback weights ──

async function getOrInitWeights(userId: number): Promise<FeedbackWeight | null> {
  const db = await getDb();
  if (!db) return null;

  const existing = await db.select().from(feedbackWeights)
    .where(eq(feedbackWeights.userId, userId)).limit(1);

  if (existing.length > 0) return existing[0];

  // Initialize with neutral weights (handle race condition with try-catch)
  try {
    await db.insert(feedbackWeights).values({
      userId,
      territoryWeights: {},
      industryWeights: {},
      sectorWeights: {},
      dealSizeWeights: {},
      totalFeedbackCount: 0,
    });
  } catch (err: unknown) {
    // Duplicate key means another request already created it — that's fine
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("Duplicate") && !msg.includes("ER_DUP_ENTRY")) {
      throw err;
    }
  }

  const [created] = await db.select().from(feedbackWeights)
    .where(eq(feedbackWeights.userId, userId)).limit(1);
  return created || null;
}

// ── Update weights from a single feedback event ──

export async function updateWeightsFromFeedback(
  userId: number,
  project: Project,
  vote: "up" | "down"
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const weights = await getOrInitWeights(userId);
  if (!weights) return;

  const factor = vote === "up" ? BOOST_FACTOR : PENALTY_FACTOR;

  // Extract features from the project
  const territories = extractTerritory(project.location);
  const industries = sectorToIndustries(project.sector);

  // Update territory weights
  const tw = (weights.territoryWeights as Record<string, number>) || {};
  for (const t of territories) {
    const current = tw[t] || BASE_WEIGHT;
    tw[t] = current * (1 - LEARNING_RATE) + (factor * LEARNING_RATE * current);
  }

  // Update sector weights
  const sw = (weights.sectorWeights as Record<string, number>) || {};
  const currentSW = sw[project.sector] || BASE_WEIGHT;
  sw[project.sector] = currentSW * (1 - LEARNING_RATE) + (factor * LEARNING_RATE * currentSW);

  // Update industry weights
  const iw = (weights.industryWeights as Record<string, number>) || {};
  for (const ind of industries) {
    const current = iw[ind] || BASE_WEIGHT;
    iw[ind] = current * (1 - LEARNING_RATE) + (factor * LEARNING_RATE * current);
  }

  // Update deal size weights
  const dsw = (weights.dealSizeWeights as Record<string, number>) || {};
  const value = parseValueToNumber(project.value);
  const bucket = value >= 1_000_000_000 ? "1B+" :
    value >= 500_000_000 ? "500M-1B" :
    value >= 100_000_000 ? "100M-500M" :
    value >= 50_000_000 ? "50M-100M" :
    value >= 10_000_000 ? "10M-50M" :
    value >= 1_000_000 ? "1M-10M" :
    value > 0 ? "Under1M" : "Unknown";

  const currentDSW = dsw[bucket] || BASE_WEIGHT;
  dsw[bucket] = currentDSW * (1 - LEARNING_RATE) + (factor * LEARNING_RATE * currentDSW);

  await db.update(feedbackWeights).set({
    territoryWeights: tw,
    sectorWeights: sw,
    industryWeights: iw,
    dealSizeWeights: dsw,
    totalFeedbackCount: (weights.totalFeedbackCount || 0) + 1,
  }).where(eq(feedbackWeights.userId, userId));
}

// ── Apply learned weights to profile score ──

function applyFeedbackWeights(
  project: Project,
  weights: FeedbackWeight | null
): number {
  if (!weights || (weights.totalFeedbackCount || 0) < 3) return 0; // Need minimum feedback

  let boost = 0;
  const territories = extractTerritory(project.location);
  const industries = sectorToIndustries(project.sector);

  // Territory boost
  const tw = (weights.territoryWeights as Record<string, number>) || {};
  for (const t of territories) {
    const w = tw[t] || BASE_WEIGHT;
    boost += (w - BASE_WEIGHT) * 15; // Scale to ±15 points
  }

  // Sector boost
  const sw = (weights.sectorWeights as Record<string, number>) || {};
  const sectorW = sw[project.sector] || BASE_WEIGHT;
  boost += (sectorW - BASE_WEIGHT) * 15;

  // Industry boost
  const iw = (weights.industryWeights as Record<string, number>) || {};
  for (const ind of industries) {
    const w = iw[ind] || BASE_WEIGHT;
    boost += (w - BASE_WEIGHT) * 10;
  }

  // Deal size boost
  const dsw = (weights.dealSizeWeights as Record<string, number>) || {};
  const value = parseValueToNumber(project.value);
  const bucket = value >= 1_000_000_000 ? "1B+" :
    value >= 500_000_000 ? "500M-1B" :
    value >= 100_000_000 ? "100M-500M" :
    value >= 50_000_000 ? "50M-100M" :
    value >= 10_000_000 ? "10M-50M" :
    value >= 1_000_000 ? "1M-10M" :
    value > 0 ? "Under1M" : "Unknown";

  const dsWeight = dsw[bucket] || BASE_WEIGHT;
  boost += (dsWeight - BASE_WEIGHT) * 10;

  // Clamp to ±50
  return Math.max(-50, Math.min(50, boost));
}

// ── BL matching ──

/** Fetch BL scores for a batch of projects and compute BL match boost per project */
async function computeBLBoosts(
  projectIds: number[],
  userBLs: string[],
  userSectorFocus: string[],
): Promise<Map<number, { blBoost: number; blScore: number }>> {
  const result = new Map<number, { blBoost: number; blScore: number }>();
  if (projectIds.length === 0 || userBLs.length === 0) return result;

  const db = await getDb();
  if (!db) return result;

  try {
    const rows = await db.select().from(projectBusinessLineScores)
      .where(inArray(projectBusinessLineScores.projectId, projectIds));

    // Group by project
    const byProject = new Map<number, { dimension: string; score: number }[]>();
    for (const r of rows) {
      const arr = byProject.get(r.projectId) || [];
      arr.push({ dimension: r.scoringDimension, score: r.score });
      byProject.set(r.projectId, arr);
    }

    // Resolve user BL labels to canonical scoring dimensions
    const resolvedDimensions = resolveBusinessLines(userBLs);

    for (const pid of projectIds) {
      const scores = byProject.get(pid) || [];
      // Find max score among user's resolved scoring dimensions
      const matchingScores = scores.filter(s => resolvedDimensions.includes(s.dimension as any));
      if (matchingScores.length === 0) {
        result.set(pid, { blBoost: 0, blScore: 0 });
        continue;
      }
      const maxScore = Math.max(...matchingScores.map(s => s.score));
      const avgScore = matchingScores.reduce((sum, s) => sum + s.score, 0) / matchingScores.length;
      // Boost: 0-30 points based on how well the project matches user's BLs
      const blBoost = Math.round((maxScore / 100) * 20 + (avgScore / 100) * 10);
      result.set(pid, { blBoost, blScore: maxScore });
    }
  } catch {
    // Fallback to no boost
  }

  return result;
}

// ── Main ranking function ──

export async function rankProjectsForUser(
  userId: number,
  projectList: Project[]
): Promise<ScoredProject[]> {
  const db = await getDb();
  if (!db) return projectList.map(p => ({
    project: p,
    relevanceScore: 50,
    profileMatch: 50,
    feedbackBoost: 0,
    blBoost: 0,
    matchDetails: { territory: 12.5, industry: 12.5, sector: 12.5, dealSize: 12.5, businessLine: 0 },
  }));

  // Get user profile
  const [profile] = await db.select().from(userProfiles)
    .where(eq(userProfiles.userId, userId)).limit(1);

  // Get learned weights
  const weights = await getOrInitWeights(userId);

  // Get BL boosts if user has assigned BLs
  const userBLs = (profile?.assignedBusinessLines as string[]) || [];
  const userSectorFocus = (profile?.sectorFocus as string[]) || [];
  const projectIds = projectList.map(p => p.id);
  const blBoosts = userBLs.length > 0
    ? await computeBLBoosts(projectIds, userBLs, userSectorFocus)
    : new Map<number, { blBoost: number; blScore: number }>();

  const scored: ScoredProject[] = projectList.map(project => {
    // Base profile score (territory + industry + sector + deal size = 0-100)
    const profileScore = profile
      ? scoreByProfile(project, profile)
      : { total: 50, territory: 12.5, industry: 12.5, sector: 12.5, dealSize: 12.5 };

    // Sector focus boost: if user has sectorFocus set, boost matching sectors
    let sectorFocusBoost = 0;
    if (userSectorFocus.length > 0) {
      sectorFocusBoost = userSectorFocus.includes(project.sector) ? 10 : -5;
    }

    // Feedback-based adjustment
    const feedbackBoost = applyFeedbackWeights(project, weights);

    // BL match boost
    const blData = blBoosts.get(project.id) || { blBoost: 0, blScore: 0 };

    // Combined score (clamped 0-100)
    const relevanceScore = Math.max(0, Math.min(100,
      profileScore.total + feedbackBoost + blData.blBoost + sectorFocusBoost
    ));

    return {
      project,
      relevanceScore,
      profileMatch: profileScore.total,
      feedbackBoost,
      blBoost: blData.blBoost,
      matchDetails: {
        territory: profileScore.territory,
        industry: profileScore.industry,
        sector: profileScore.sector,
        dealSize: profileScore.dealSize,
        businessLine: blData.blBoost,
      },
    };
  });

  // Sort by relevance score descending
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return scored;
}

// ── Batch recompute weights from all historical feedback ──

export async function recomputeAllWeights(userId: number): Promise<{ feedbackCount: number }> {
  const db = await getDb();
  if (!db) return { feedbackCount: 0 };

  // Reset weights
  await db.update(feedbackWeights).set({
    territoryWeights: {},
    industryWeights: {},
    sectorWeights: {},
    dealSizeWeights: {},
    totalFeedbackCount: 0,
  }).where(eq(feedbackWeights.userId, userId));

  // Get all feedback
  const allFeedback = await db.select().from(projectFeedback)
    .where(eq(projectFeedback.userId, userId))
    .orderBy(projectFeedback.createdAt);

  // Replay each feedback event
  for (const fb of allFeedback) {
    const [project] = await db.select().from(projects)
      .where(eq(projects.id, fb.projectId)).limit(1);
    if (project) {
      await updateWeightsFromFeedback(userId, project, fb.vote);
    }
  }

  return { feedbackCount: allFeedback.length };
}

// ── Tie-breaker boost export for laneScoring.ts ──
// Returns a Map<projectId, tieBreaker> where tieBreaker is capped to ±5 pts.
// This is intentionally narrow — it is a tie-breaker only, not a main ranker.
// laneScoring.ts adds this AFTER computing the final lane-aware score.
export async function getFeedbackBoostForProjects(
  userId: number,
  projectIds: number[],
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (projectIds.length === 0) return result;

  const db = await getDb();
  if (!db) return result;

  const weights = await getOrInitWeights(userId);
  if (!weights || (weights.totalFeedbackCount || 0) < 3) return result;

  // Fetch the minimal project data needed for applyFeedbackWeights
  const rows = await db.select({
    id: projects.id,
    location: projects.location,
    sector: projects.sector,
    value: projects.value,
  }).from(projects).where(inArray(projects.id, projectIds));

  for (const row of rows) {
    // applyFeedbackWeights expects a full Project but only uses location/sector/value
    const rawBoost = applyFeedbackWeights(row as Project, weights);
    // Cap to ±5 pts — tie-breaker only
    const tieBreaker = Math.max(-5, Math.min(5, Math.round(rawBoost / 10)));
    result.set(row.id, tieBreaker);
  }

  return result;
}
