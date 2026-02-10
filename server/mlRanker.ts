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
import { eq, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  feedbackWeights, projectFeedback, userProfiles, projects,
  type FeedbackWeight, type Project, type UserProfile,
} from "../drizzle/schema";

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
  matchDetails: {
    territory: number;
    industry: number;
    sector: number;
    dealSize: number;
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
    if (keywords.some(kw => loc.includes(kw))) {
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

  // Territory match
  const projectTerritories = extractTerritory(project.location);
  const userTerritories = (profile.territories as string[]) || [];
  if (userTerritories.length > 0) {
    const overlap = projectTerritories.filter(t => userTerritories.includes(t));
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
    matchDetails: { territory: 12.5, industry: 12.5, sector: 12.5, dealSize: 12.5 },
  }));

  // Get user profile
  const [profile] = await db.select().from(userProfiles)
    .where(eq(userProfiles.userId, userId)).limit(1);

  // Get learned weights
  const weights = await getOrInitWeights(userId);

  const scored: ScoredProject[] = projectList.map(project => {
    // Base profile score
    const profileScore = profile
      ? scoreByProfile(project, profile)
      : { total: 50, territory: 12.5, industry: 12.5, sector: 12.5, dealSize: 12.5 };

    // Feedback-based adjustment
    const feedbackBoost = applyFeedbackWeights(project, weights);

    // Combined score (clamped 0-100)
    const relevanceScore = Math.max(0, Math.min(100, profileScore.total + feedbackBoost));

    return {
      project,
      relevanceScore,
      profileMatch: profileScore.total,
      feedbackBoost,
      matchDetails: {
        territory: profileScore.territory,
        industry: profileScore.industry,
        sector: profileScore.sector,
        dealSize: profileScore.dealSize,
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
