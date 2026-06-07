/**
 * Email Digest Generator
 * Builds personalized intelligence summaries for each user based on their profile preferences.
 * Uses Resend API to deliver emails directly to each user's corporate email address.
 *
 * COMPULSORY DELIVERY: All users with profiles receive emails regardless of opt-in.
 *   - Monday: Full weekly digest (personalized projects, contacts, pipeline, This Week highlights)
 *   - Thursday: Mid-week reminder (urgent actions, pipeline nudges, new hot projects since Monday)
 */
import { sendEmail } from "./emailSender";
import { buildDigestEmailHtml, buildDigestEmailText, type EmailSignal, type DigestEmailData } from "./emailTemplate";
import {
  getAllUsersWithProfiles,
  getLatestReport,
  getProjectsByReportId,
  getContactsByReportId,
  getActiveProjects,
  getAllContacts,
  getPipelineClaimsByUser,
  getDb,
  getEmailRecipients,
  logEmailSendExtended,
  claimDigestSendSlot,
  finaliseDigestSendSlot,
  getLatestPipelineRun,
  getCurrentWeekKey,
  getDigestWeekKey,
  getManagerRollup,
  wasEmailSentToUserThisWeek,
  checkPipelineFreshness,
} from "./db";
import { shouldIncludeInBrief, getTierLabel, type ActionTier } from "./tierClassification";
import { getProjectScoresBatch, type DimensionScore } from "./businessLineScoring";
import {
  computePerUserFinalScore,
  classifyVisibility,
  applyTieBreaker,
  portableAirOpportunityGate,
  palBessOpportunityGate,
  isPumpLaneRep,
  resolveRepLaneCategory,
  type VisibilityTier,
} from "./laneScoring";
import { getFeedbackBoostForProjects } from "./mlRanker";
import { selectProjectContact, type ContactInput } from "./contactSelector";
import { resolveTerritories, resolveBusinessLines } from "./canonicalMappings";
import { ENV } from "./_core/env";
import { getThisWeekForEmail, type ThisWeekProject, type ThisWeekStakeholder, type SuggestedAction } from "./thisWeekService";
import { userEmailSendLog, digestScheduleLog, projectValidationGates, digestSendControl, accountPriors } from "../drizzle/schema";
import { eq, and, gte, inArray, sql } from "drizzle-orm";

// ── Territory-Level Digest Send Threshold ──
//
// Rules (per WA rollout spec):
//   1. Minimum 3 digest-safe Must Act items (action_ready + digestSafe gate = true)
//   2. Each qualifying item must have a named, verified contact (send_ready trust tier)
//   3. No territory contamination: all qualifying items must be in the rep's territory
//   4. No weak filler cards: discovery_needed items do NOT count toward the threshold
//
// Returns: { passes: boolean; reason: string; qualifyingCount: number }

export interface TerritoryThresholdResult {
  passes: boolean;
  reason: string;
  qualifyingCount: number;
  digestSafeProjectIds: number[];
}

export async function checkTerritoryThreshold(
  annotatedProjects: Array<DigestProject & { briefReadiness?: BriefReadiness; bestContact?: DigestProject["bestContact"] }>,
  territories: string[],
  minQualifying = 3,
): Promise<TerritoryThresholdResult> {
  const db = await getDb();

  // Step 1: Find action_ready projects with a verified bestContact
  const actionReadyWithContact = annotatedProjects.filter(
    p => p.briefReadiness === "action_ready" && p.bestContact?.email
  );

  if (actionReadyWithContact.length === 0) {
    return {
      passes: false,
      reason: "No action-ready projects with verified contacts found for this territory",
      qualifyingCount: 0,
      digestSafeProjectIds: [],
    };
  }

  // Step 2: Check which of those have digestSafe = true in projectValidationGates
  let digestSafeProjectIds: number[] = [];
  if (db) {
    const projectIds = actionReadyWithContact.map(p => p.id);
    const gates = await db
      .select({ projectId: projectValidationGates.projectId })
      .from(projectValidationGates)
      .where(
        and(
          inArray(projectValidationGates.projectId, projectIds),
          eq(projectValidationGates.digestSafe, true),
        )
      );
    digestSafeProjectIds = gates.map(g => g.projectId);
  } else {
    // No DB: fall back to all action-ready projects (graceful degradation)
    digestSafeProjectIds = actionReadyWithContact.map(p => p.id);
  }

  // Step 3: Territory contamination check
  // A project is territory-clean if it has no territory set (national) or matches the rep's territories.
  // Hard guard: for state-coded territories (e.g. WA, QLD, NSW), projectState must match OR
  // the location string must contain the territory code. Projects with projectState set to a
  // different Australian state (e.g. NSW, VIC) are hard-excluded even if accidentally gated.
  // This prevents non-WA projects (Stockland National, Snowy Hydro NSW, Goulburn NSW, Inland Rail VIC)
  // from satisfying the WA digest threshold.
  const qualifying = actionReadyWithContact.filter(p => {
    if (!digestSafeProjectIds.includes(p.id)) return false;
    // Territory check: if rep has territories, project must match at least one
    if (territories.length === 0) return true; // national rep — no contamination possible
    const projectState = ((p as any).projectState || "").toUpperCase();
    const loc = ((p as any).location || "").toLowerCase();
    return territories.some(t => {
      const tUpper = t.toUpperCase();
      // Hard projectState exclusion: if projectState is set to a specific Australian state
      // that does NOT match the territory, reject immediately (prevents cross-state contamination).
      // Exception: OFFSHORE_AU is treated as territory-neutral (e.g. Barrow Island for WA reps).
      const AUSTRALIAN_STATES = ["WA", "QLD", "NSW", "VIC", "SA", "TAS", "NT", "ACT"];
      if (projectState && AUSTRALIAN_STATES.includes(projectState) && projectState !== tUpper) return false;
      // Fallback: location string contains territory code (word-boundary for short codes)
      const tLower = t.toLowerCase();
      if (tLower.length <= 3) {
        const re = new RegExp(`\\b${tLower}\\b`, "i");
        return re.test(loc);
      }
      return loc.includes(tLower);
    });
  });

  const qualifyingCount = qualifying.length;

  if (qualifyingCount < minQualifying) {
    const gatedCount = digestSafeProjectIds.length;
    const actionReadyCount = actionReadyWithContact.length;
    let reason: string;
    if (gatedCount === 0 && actionReadyCount > 0) {
      reason = `${actionReadyCount} action-ready project${actionReadyCount !== 1 ? "s" : ""} found but none have been validated as digest-safe yet (0 of ${minQualifying} required). Run the Contact Validation workflow first.`;
    } else if (qualifying.length < gatedCount) {
      reason = `Territory contamination: ${gatedCount} digest-safe project${gatedCount !== 1 ? "s" : ""} found but only ${qualifying.length} match this rep's territory (${territories.join("/")}). ${minQualifying - qualifying.length} more needed.`;
    } else {
      reason = `Only ${qualifyingCount} digest-safe Must Act item${qualifyingCount !== 1 ? "s" : ""} with verified contacts (${minQualifying} required). Validate more projects before sending.`;
    }
    return { passes: false, reason, qualifyingCount, digestSafeProjectIds };
  }

  return {
    passes: true,
    reason: `${qualifyingCount} digest-safe Must Act items with verified contacts — threshold met`,
    qualifyingCount,
    digestSafeProjectIds,
  };
}

/**
 * Check if a freshness-gate hold notification was already sent this week.
 * Prevents spamming the owner with repeated "digest HELD" emails on every
 * server cold-start (CloudRun spins up on each request).
 * Returns true if a 'held' record exists for monday this week.
 */
async function wasFreshnessHeldNotifiedThisWeek(): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;

    // Compute start of this ISO week (Monday 00:00 UTC).
    // If today is Sunday, the relevant Monday is tomorrow (same logic as persistentScheduler).
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const startOfWeek = new Date(now);
    if (dayOfWeek === 0) {
      startOfWeek.setUTCDate(now.getUTCDate() + 1);
    } else {
      startOfWeek.setUTCDate(now.getUTCDate() - ((dayOfWeek + 6) % 7));
    }
    startOfWeek.setUTCHours(0, 0, 0, 0);

    const result = await db
      .select()
      .from(digestScheduleLog)
      .where(
        and(
          eq(digestScheduleLog.digestType, "monday"),
          eq(digestScheduleLog.status, "failed"),
          gte(digestScheduleLog.createdAt, startOfWeek)
        )
      )
      .limit(1);

    return result.length > 0;
  } catch {
    return false;
  }
}

/**
 * Log a freshness-gate hold event so subsequent cold-starts don't re-notify.
 */
async function logFreshnessHeld(reason: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(digestScheduleLog).values({
      digestType: "monday",
      scheduledFor: new Date(),
      sentAt: null,
      status: "failed",
      error: `FRESHNESS_GATE_HELD: ${reason}`,
    });
  } catch {
    // Non-critical — ignore
  }
}

/** Absolute base URL for email deep-links. Falls back to empty string (relative) if not configured. */
function getSiteUrl(): string {
  return ENV.appSiteUrl || "";
}

/**
 * Get today's date as YYYY-MM-DD in UTC.
 */
function getTodayUTC(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

/**
 * Check if a specific user already received a specific digest type today.
 * Returns true if the user already has a "sent" record for today.
 */
async function wasEmailSentToUser(
  userId: number,
  digestType: "monday" | "thursday",
): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const today = getTodayUTC();
    const result = await db
      .select()
      .from(userEmailSendLog)
      .where(
        and(
          eq(userEmailSendLog.userId, userId),
          eq(userEmailSendLog.digestType, digestType),
          eq(userEmailSendLog.sentDate, today),
          eq(userEmailSendLog.status, "sent"),
        ),
      )
      .limit(1);
    return result.length > 0;
  } catch (err) {
    console.error(`[EmailDigest] Error checking per-user send status for user ${userId}:`, err);
    // On error, assume sent to prevent duplicates
    return true;
  }
}

/**
 * Log that a specific user received (or failed to receive) a digest.
 */
async function logUserEmailSend(
  userId: number,
  digestType: "monday" | "thursday",
  status: "sent" | "failed",
  error?: string,
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(userEmailSendLog).values({
      userId,
      digestType,
      sentDate: getTodayUTC(),
      status,
      error: error || null,
    });
  } catch (err) {
    console.error(`[EmailDigest] Error logging per-user send for user ${userId}:`, err);
  }
}

/** Brief readiness classification — determines which section a project appears in */
export type BriefReadiness = "action_ready" | "discovery_needed" | "monitor_only";

interface DigestProject {
  id: number;
  name: string;
  location: string;
  value: string;
  owner: string;
  priority: string;
  sector: string;
  opportunityRoute: string;
  isNew: boolean;
  stage: string | null;
  overview: string | null;
  actionTier: ActionTier | null;
  /** PT Capital Sales Sprint: equipment lane for grouping in brief */
  productLane?: string | null;
  /** PT Capital Sales Sprint: normalised stage code */
  stageCode?: string | null;
  /** PT Capital Sales Sprint: true if no contacts linked to this project */
  hasNoContacts?: boolean;
  /** Brief readiness classification */
  briefReadiness?: BriefReadiness;
  /** Best send-ready contact for this project (name + title + contact path) */
  bestContact?: { name: string; title: string; email?: string | null; linkedin?: string | null; trustTier?: string | null; source?: string | null; company?: string | null; verificationScore?: number | null; isDowngraded?: boolean; isLlmInferred?: boolean } | null;
  /** Tender close date for actionability scoring */
  tenderCloseDate?: string | null;
  /** Lane visibility tier from laneScoring.ts — used to gate section assignment */
  visibilityTier?: VisibilityTier;
  /** Lane fit label for card display */
  laneFitLabel?: "High" | "Medium" | "Low" | "Not relevant";
  /** Selling-motion channel enum */
  channel?: string;
  /** Why this project is actionable now */
  whyNow?: string;
  /** Route-to-buy description */
  routeToBuy?: string;
  /** Best next move for the rep */
  bestNextMove?: string;
  /** Reason codes for explainability */
  reasonCodes?: string[];
  /** Portable Air Opportunity Gate result — projects that fail are demoted to monitor_only or suppressed */
  gateResult?: { pass: true } | { pass: false; reason: string; suppressionLevel: 'suppress' | 'monitor_only' };
  /** Three-family air opportunity classification */
  airFit?: "High" | "Medium" | "Low" | "None";
  /** Primary air opportunity type */
  opportunityType?: string;
  /** Best product angle for this project */
  bestProductAngle?: string;
  /** Best Sykes pump product angle for pump-lane reps */
  bestPumpAngle?: string;
}

interface DigestContact {
  name: string;
  title: string;
  company: string;
  project: string;
  priority: string;
  email: string | null;
  roleRelevance?: string | null;
  linkedin?: string | null;
  /** Three-tier trust model: only send_ready contacts are outreach-ready */
  contactTrustTier?: string | null;
  /** Contact data source (scraper, crm, apollo, manual) — required by defensibility gate */
  source?: string | null;
  /** Verification score 0-100 */
  verificationScore?: number | null;
}

/**
 * Classify a project's brief readiness based on contact availability.
 *
 * action_ready: has at least one send-ready contact (email or LinkedIn)
 *   with high/medium roleRelevance, OR has verified contractor + tier1 stage.
 * discovery_needed: tier1/tier2 hot/warm but no usable contacts.
 * monitor_only: everything else (tier3, cold tier2).
 */
export function classifyBriefReadiness(
  project: DigestProject,
  projectContacts: DigestContact[],
  options?: { isPumpLane?: boolean },
): { readiness: BriefReadiness; bestContact: DigestProject["bestContact"] } {
  const tier = project.actionTier || "tier3_monitor";
  const priority = project.priority as "hot" | "warm" | "cold";

  // ── Lane visibility gate (laneScoring.ts guardrail 2) ──
  // If the lane scoring engine has classified this project as suppress or monitor_only,
  // respect that decision regardless of contact state or action tier.
  if (project.visibilityTier === "suppress" || project.visibilityTier === "monitor_only") {
    return { readiness: "monitor_only", bestContact: null };
  }

  // Monitor-only: tier3 or cold tier2 — these never lead the brief
  if (tier === "tier3_monitor") return { readiness: "monitor_only", bestContact: null };
  if (tier === "tier2_warm" && priority === "cold") return { readiness: "monitor_only", bestContact: null };

  // ── SHARED CONTACT SELECTOR (single source of truth) ──
  // Uses the same scoring logic as thisWeekService and nextBestAction.
  const contactSelection = selectProjectContact(projectContacts as unknown as ContactInput[], {
    projectName: project.name,
    projectOwner: (project as any).owner ?? "",
    projectState: (project as any).projectState ?? null,
    isPumpLane: options?.isPumpLane,
  });

  if (contactSelection.salesReadiness === "send_ready" && contactSelection.selectedContact) {
    const best = contactSelection.selectedContact;
    const rawContact = (projectContacts as any[]).find(c => c.name === best.name);
    return {
      readiness: "action_ready",
      bestContact: {
        name: best.name,
        title: best.title,
        email: best.email,
        linkedin: best.linkedin,
        trustTier: best.trustTier,
        source: rawContact?.source ?? rawContact?.enrichmentSource ?? "scraper",
        company: best.company,
        verificationScore: rawContact?.verificationScore ?? null,
        isDowngraded: false,
        isLlmInferred: false,
      },
    };
  }

  // Fallback: verified contractor + tier1 = action_ready (route-to-buy path)
  if (!project.hasNoContacts && project.actionTier === "tier1_actionable" &&
      contactSelection.selectedContact && contactSelection.selectedContact.email) {
    const best = contactSelection.selectedContact;
    const rawContact = (projectContacts as any[]).find(c => c.name === best.name);
    return {
      readiness: "action_ready",
      bestContact: {
        name: best.name,
        title: best.title,
        email: best.email,
        linkedin: best.linkedin,
        trustTier: best.trustTier,
        source: rawContact?.source ?? rawContact?.enrichmentSource ?? "scraper",
        company: best.company,
        verificationScore: rawContact?.verificationScore ?? null,
        isDowngraded: false,
        isLlmInferred: false,
      },
    };
  }

  // No usable contacts — discovery needed
  return { readiness: "discovery_needed", bestContact: null };
}

/**
 * Map user's assignedBusinessLines to scoring dimensions.
 * User profiles use "Pump (Flow)" but scoring uses "Pump/Dewatering", etc.
 */
const BL_TO_DIMENSION_MAP: Record<string, string[]> = {
  "Portable Air": ["Portable Air"],
  "PAL": ["PAL", "Generators"],
  "BESS": ["BESS"],
  "Pump (Flow)": ["Pump/Dewatering"],
  "Pump/Flow": ["Pump/Dewatering"],
  "Pump": ["Pump/Dewatering"],
  "Flow": ["Pump/Dewatering"],
  "Dewatering": ["Pump/Dewatering"],
  "Dewatering Pumps": ["Pump/Dewatering"],
  "Pump/Dewatering": ["Pump/Dewatering"],
  "Nitrogen": ["Nitrogen"],
  "Booster": ["Booster"],
  "Generators": ["Generators"],
  "PT Capital Sales": ["Portable Air", "PAL", "BESS", "Pump/Dewatering", "Generators", "Nitrogen", "Booster"],
  "PT All Capital Sales": ["Portable Air", "PAL", "BESS", "Pump/Dewatering", "Generators", "Nitrogen", "Booster"],
  "Capital Sales": ["Portable Air", "PAL", "BESS", "Pump/Dewatering", "Generators", "Nitrogen", "Booster"],
  "All Capital Sales": ["Portable Air", "PAL", "BESS", "Pump/Dewatering", "Generators", "Nitrogen", "Booster"],
};

/**
 * Hard lane tier classification for a project against a user's primary business lines.
 *
 * Returns:
 *   "primary"   — project is a strong match for the user's assigned BL(s) (BL score >= 60)
 *   "secondary" — project is a moderate match (BL score 35–59)
 *   "crosssell" — project has some BL signal but is not the user's primary lane (score 15–34)
 *   "poor"      — project has negligible BL relevance (score < 15) — penalised in ranking
 */
function classifyLaneTier(
  assignedBusinessLines: string[] | null | undefined,
  blScores: DimensionScore[] | undefined,
): "primary" | "secondary" | "crosssell" | "poor" {
  if (!assignedBusinessLines || assignedBusinessLines.length === 0 || !blScores || blScores.length === 0) {
    return "crosssell"; // no BL data — neutral, not penalised
  }
  const userDimensions = new Set<string>();
  for (const bl of assignedBusinessLines) {
    const dims = BL_TO_DIMENSION_MAP[bl];
    if (dims) dims.forEach(d => userDimensions.add(d));
  }
  if (userDimensions.size === 0) return "crosssell";

  let maxScore = 0;
  for (const dim of Array.from(userDimensions)) {
    const s = blScores.find(b => b.dimension === dim)?.score ?? 0;
    if (s > maxScore) maxScore = s;
  }
  if (maxScore >= 60) return "primary";
  if (maxScore >= 35) return "secondary";
  if (maxScore >= 15) return "crosssell";
  return "poor";
}

/**
 * Compute a relevance score (0–100) for a project against a user profile.
 * Separated from actionability — this score reflects how relevant the project
 * is to the user's lane, sector, stage preference, and strategic accounts.
 *
 * WEIGHTS:
 *   Primary lane fit (hard tier)  — 0/12/22/32 pts  (poor/crosssell/secondary/primary)
 *   Stage timing fit              — up to 15 pts     (major dimension)
 *   Sector fit                    — up to 12 pts     (sectorFocus > industries fallback)
 *   Secondary/cross-sell signal   — up to  8 pts     (Service Potential + Rental Influence)
 *   Strategic account fit         — up to  6 pts     (capped; cannot rescue poor lane fit)
 *   Priority signal               — up to  5 pts     (hot/warm/new)
 *   Territory quality             — up to  5 pts     (quality signal; hard exclusion upstream)
 *
 * Base = 0. Capped at 100.
 */
function computeRelevanceScore(
  project: DigestProject,
  profile: {
    territories: string[] | null;
    industries: string[] | null;
    offerCategories: string[] | null;
    customerTypes: string[] | null;
    dealSizeMin: string | null;
    dealSizeMax: string | null;
    assignedBusinessLines?: string[] | null;
    sectorFocus?: string[] | null;
    stageTiming?: string[] | null;
    buyerRoles?: string[] | null;
    keyAccounts?: string[] | null;
  },
  blScores?: DimensionScore[],
): { relevance: number; laneTier: "primary" | "secondary" | "crosssell" | "poor"; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let score = 0;

  // ── 1. Primary lane fit via hard tier (+0/+12/+22/+32) ──
  const laneTier = classifyLaneTier(profile.assignedBusinessLines, blScores);
  const lanePoints = laneTier === "primary" ? 32 : laneTier === "secondary" ? 22 : laneTier === "crosssell" ? 12 : 0;
  // Poor lane fit gets a penalty to ensure it ranks below cross-sell projects
  const lanePenalty = laneTier === "poor" ? -8 : 0;
  breakdown["lane"] = lanePoints + lanePenalty;
  score += lanePoints + lanePenalty;

  // ── 2. Stage timing fit (+0 to +15) — major dimension ──
  if (profile.stageTiming && profile.stageTiming.length > 0) {
    const stagePref = profile.stageTiming.map(s => s.toLowerCase());
    const projStage = (project.stage || "").toLowerCase();
    const stageAliases: Record<string, string[]> = {
      early_signal:       ["planning", "feasibility", "study", "announcement", "early", "concept", "pre-feasibility", "scoping"],
      tender_live:        ["tender", "rfq", "rfp", "eoi", "bid", "procurement", "expression of interest"],
      awarded_mobilizing: ["awarded", "mobilizing", "mobilisation", "construction", "execution", "active", "underway", "commenced"],
      commissioning:      ["commissioning", "startup", "start-up", "handover", "testing"],
      operations:         ["operations", "production", "operating", "operational", "mro", "shutdown", "maintenance"],
    };
    let stageScore = 0;
    // Primary preferred stage = full 15 pts; secondary preferred stage = 8 pts
    const [firstPref, ...restPrefs] = stagePref;
    const firstAliases = stageAliases[firstPref] || [firstPref];
    if (firstAliases.some(a => projStage.includes(a))) {
      stageScore = 15;
    } else {
      for (const pref of restPrefs) {
        const aliases = stageAliases[pref] || [pref];
        if (aliases.some(a => projStage.includes(a))) { stageScore = 8; break; }
      }
    }
    breakdown["stage"] = stageScore;
    score += stageScore;
  }

  // ── 3. Sector fit (+0 to +12) ──
  const effectiveSectors = (profile.sectorFocus && profile.sectorFocus.length > 0)
    ? profile.sectorFocus
    : (profile.industries || []).map(i => i.split("_")[0]);
  if (effectiveSectors.length > 0) {
    const projSector = project.sector.toLowerCase();
    const sectorAliases: Record<string, string[]> = {
      mining:         ["mining", "exploration", "development", "production", "shutdown", "contractors"],
      oil_gas:        ["oil_gas", "oil", "gas", "lng", "fpso", "offshore", "energy_oil_gas", "energy_transmission"],
      infrastructure: ["infrastructure", "rail", "road", "port", "construction", "water"],
      energy:         ["energy", "renewable", "solar", "wind", "hydrogen", "bess", "energy_renewables"],
      defence:        ["defence", "defense", "military", "naval"],
    };
    const projAliases = sectorAliases[projSector] || [projSector];
    const matched = effectiveSectors.some(s =>
      projAliases.some(a => a.includes(s.toLowerCase()) || s.toLowerCase().includes(a))
    );
    breakdown["sector"] = matched ? 12 : 0;
    score += matched ? 12 : 0;
  }

  // ── 4. Secondary / cross-sell BL signal (+0 to +8) ──
  // Service Potential and Rental Influence are evaluated for all users.
  if (blScores && blScores.length > 0) {
    const serviceScore = blScores.find(s => s.dimension === "Service Potential")?.score ?? 0;
    const rentalScore  = blScores.find(s => s.dimension === "Rental Influence")?.score ?? 0;
    const offerCats = (profile.offerCategories || []).map(c => c.toLowerCase());
    const wantsRental  = offerCats.some(c => c.includes("rental") || c.includes("hire"));
    const wantsService = offerCats.some(c => c.includes("service") || c.includes("parts") || c.includes("engineering") || c.includes("consumable"));
    let crossSell = 0;
    if (wantsRental)  crossSell += Math.round((rentalScore  / 100) * 5);
    if (wantsService) crossSell += Math.round((serviceScore / 100) * 5);
    crossSell = Math.min(crossSell, 8); // cap
    breakdown["crosssell"] = crossSell;
    score += crossSell;
  }

  // ── 5. Strategic account fit (+0 to +6, capped) ──
  // Cannot rescue a poor-lane-fit project — capped at 6 so it is a tiebreaker, not a lifeline.
  if (profile.keyAccounts && profile.keyAccounts.length > 0) {
    const accounts = profile.keyAccounts.map(a => a.toLowerCase());
    const ownerLower = (project.owner || "").toLowerCase();
    const nameLower  = project.name.toLowerCase();
    const isStrategic = accounts.some(a => a.length > 3 && (ownerLower.includes(a) || nameLower.includes(a)));
    const strategicPts = isStrategic ? 6 : 0;
    breakdown["strategic"] = strategicPts;
    score += strategicPts;
  }

  // ── 6. Priority signal (+0 to +5) ──
  const priorityPts = project.priority === "hot" ? 5 : project.priority === "warm" ? 3 : 0;
  const newPts = project.isNew ? 2 : 0;
  breakdown["priority"] = priorityPts + newPts;
  score += priorityPts + newPts;

  // ── 7. Territory quality (+0 to +5) ──
  // Hard exclusion is done upstream. Here we give a small quality boost for a
  // strong location match (e.g. Pilbara vs just "WA").
  if (profile.territories && profile.territories.length > 0) {
    const territories = profile.territories;
    const loc = project.location.toLowerCase();
    const stateMap: Record<string, string[]> = {
      WA:  ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha", "port hedland", "newman", "geraldton", "bunbury", "broome", "norseman", "murchison", "kwinana"],
      NT:  ["northern territory", "nt", "darwin", "alice springs", "tennant creek", "katherine"],
      QLD: ["queensland", "qld", "brisbane", "townsville", "mackay", "gladstone", "rockhampton", "cairns", "bowen basin", "moranbah", "emerald"],
      NSW: ["new south wales", "nsw", "sydney", "newcastle", "hunter valley", "wollongong", "broken hill", "orange", "dubbo", "mudgee", "goulburn", "wakehurst"],
      VIC: ["victoria", "vic", "melbourne", "geelong", "ballarat", "bendigo", "latrobe", "euroa"],
      SA:  ["south australia", "sa", "adelaide", "olympic dam", "whyalla", "port augusta"],
      TAS: ["tasmania", "tas", "hobart", "launceston"],
      ACT: ["australian capital territory", "act", "canberra"],
    };
    let terrPts = 0;
    for (const terr of territories) {
      if (terr === "National" || terr === "NATIONAL") { terrPts = 3; break; }
      const keywords = stateMap[terr] || [terr.toLowerCase()];
      const exactMatch = keywords.some(k => {
        if (k.length <= 3) {
          const re = new RegExp(`(?:^|[\\s,;/|()\\-])${k}(?:$|[\\s,;/|()\\-])`, "i");
          return re.test(loc);
        }
        return loc.includes(k);
      });
      if (exactMatch) { terrPts = 5; break; }
    }
    breakdown["territory"] = terrPts;
    score += terrPts;
  }

  return { relevance: Math.max(0, Math.min(100, score)), laneTier, breakdown };
}

/**
 * Compute an actionability score (0–100) for a project.
 * Separated from relevance — this score reflects how actionable the project is
 * right now (contacts available, closing soon, contractor known, etc.).
 *
 * WEIGHTS:
 *   Trust-safe contact present    — up to 30 pts  (send_ready > named_unverified > none)
 *   Buyer role match on contact   — up to 15 pts  (only when contact is trust-safe)
 *   Tender closing soon           — up to 20 pts  (within 14 days = full; within 30 = partial)
 *   Contractor known              — up to 15 pts  (verified contractor on record)
 *   Action tier                   — up to 20 pts  (tier1_actionable > tier2 > tier3)
 *
 * Base = 0. Capped at 100.
 */
function computeActionabilityScore(
  project: DigestProject,
  projectContacts: DigestContact[],
  profile: { buyerRoles?: string[] | null },
): { actionability: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let score = 0;

  // ── 1. Trust-safe contact present (+0 to +30) ──
  const sendReadyContacts  = projectContacts.filter(c => c.contactTrustTier === "send_ready" && c.email);
  const namedContacts      = projectContacts.filter(c => c.contactTrustTier === "named_unverified");
  let contactPts = 0;
  if (sendReadyContacts.length > 0)  contactPts = 30;
  else if (namedContacts.length > 0) contactPts = 12;
  breakdown["contact"] = contactPts;
  score += contactPts;

  // ── 2. Buyer role match on trust-safe contact (+0 to +15) ──
  // Only applied when a send_ready contact exists — prevents inflating score for unverified contacts.
  if (sendReadyContacts.length > 0 && profile.buyerRoles && profile.buyerRoles.length > 0) {
    const buyerRoles = profile.buyerRoles.map(r => r.toLowerCase());
    const roleAliases: Record<string, string[]> = {
      procurement:        ["procurement", "commercial", "supply chain", "contracts", "purchasing"],
      fleet_manager:      ["fleet", "equipment manager", "plant manager", "asset"],
      operations_site:    ["operations", "site manager", "project manager", "construction manager", "site supervisor"],
      maintenance_shutdown: ["maintenance", "shutdown", "turnaround", "reliability", "mechanical"],
      project_manager:    ["project manager", "pm", "project director", "project engineer"],
      engineering:        ["engineer", "technical", "design", "process"],
      hse_esg:            ["hse", "safety", "esg", "environment", "sustainability"],
      commercial:         ["commercial", "business development", "bd", "sales"],
    };
    const bestContact = sendReadyContacts[0];
    const titleLower  = (bestContact.title || "").toLowerCase();
    const roleMatched = buyerRoles.some(role => {
      const aliases = roleAliases[role] || [role];
      return aliases.some(a => titleLower.includes(a));
    });
    const rolePts = roleMatched ? 15 : 0;
    breakdown["buyerRole"] = rolePts;
    score += rolePts;
  }

  // ── 3. Tender closing soon (+0 to +20) ──
  if (project.tenderCloseDate) {
    const daysUntilClose = Math.ceil(
      (new Date(project.tenderCloseDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    let closingPts = 0;
    if (daysUntilClose >= 0 && daysUntilClose <= 7)  closingPts = 20;
    else if (daysUntilClose <= 14)                   closingPts = 16;
    else if (daysUntilClose <= 21)                   closingPts = 10;
    else if (daysUntilClose <= 30)                   closingPts = 6;
    breakdown["closing"] = closingPts;
    score += closingPts;
  }

  // ── 4. Contractor known (+0 to +15) ──
  const hasContractor = !!(project as any).contractor || !!(project as any).confirmedContractor;
  const contractorPts = hasContractor ? 15 : 0;
  breakdown["contractor"] = contractorPts;
  score += contractorPts;

  // ── 5. Action tier (+0 to +20) ──
  const tierPts = project.actionTier === "tier1_actionable" ? 20
    : project.actionTier === "tier2_warm"    ? 10
    : project.actionTier === "tier3_monitor" ? 4
    : 0;
  breakdown["actionTier"] = tierPts;
  score += tierPts;

  return { actionability: Math.max(0, Math.min(100, score)), breakdown };
}

/**
 * Combined per-user project score for digest section placement.
 *
 * Must Act  = relevance >= 35 AND actionability >= 50  → combined = 0.5*R + 0.5*A
 * On Radar  = relevance >= 35 AND actionability < 50   → combined = 0.8*R + 0.2*A
 * Waiting   = relevance >= 20 AND actionability < 30   → combined = R
 *
 * Returned as a flat number (0–100) used for sorting within each section.
 * The section assignment is done in scoreAndFilterProjects.
 */
function scoreProjectForUser(
  project: DigestProject,
  profile: {
    territories: string[] | null;
    industries: string[] | null;
    offerCategories: string[] | null;
    customerTypes: string[] | null;
    dealSizeMin: string | null;
    dealSizeMax: string | null;
    assignedBusinessLines?: string[] | null;
    sectorFocus?: string[] | null;
    stageTiming?: string[] | null;
    buyerRoles?: string[] | null;
    keyAccounts?: string[] | null;
  },
  blScores?: DimensionScore[],
  projectContacts?: DigestContact[],
): number {
  // Delegate to the separated relevance + actionability scorers.
  // For the legacy flat score (used for backward-compat sort), combine:
  //   Must Act range: 0.5*R + 0.5*A  (both matter)
  //   Otherwise:      0.8*R + 0.2*A  (relevance dominates)
  const { relevance } = computeRelevanceScore(project, profile, blScores);
  const { actionability } = computeActionabilityScore(project, projectContacts || [], { buyerRoles: profile.buyerRoles });
  const isHighlyActionable = actionability >= 50;
  const combined = isHighlyActionable
    ? Math.round(0.5 * relevance + 0.5 * actionability)
    : Math.round(0.8 * relevance + 0.2 * actionability);
  return Math.max(0, Math.min(100, combined));
}

/**
 * Sanitize a contractor name: strip raw HTML fragments, anchor tags, URLs, hex colors.
 * Returns null if the name is not a valid plain-text company name.
 */
function sanitizeContractorName(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = String(name).trim();
  // Reject if it contains HTML tags, href patterns, URL fragments, or hex colors
  if (
    s.includes("<") ||
    s.includes(">") ||
    s.includes("href") ||
    s.includes("//www.") ||
    s.includes("http") ||
    /^#[0-9a-fA-F]{3,6}$/.test(s) ||
    s.startsWith("\"") ||
    s.length < 3 ||
    s.length > 200
  ) {
    return null;
  }
  return s;
}

/**
 * Format the "This Week" highlight section for the email digest.
 * Includes top 3 projects, top 2 stakeholders, and 1 urgent action.
 */
function formatThisWeekSection(
  top3Projects: ThisWeekProject[],
  top2Stakeholders: ThisWeekStakeholder[],
  urgentAction: SuggestedAction | null,
  thisWeekUrl: string,
): string {
  let section = "";

  // ── Urgent Action (contact-aware wording) ──
  if (urgentAction) {
    const isDiscoveryAction = urgentAction.type === "tier1_new" || urgentAction.type === "contractor_gap";
    if (isDiscoveryAction) {
      // No usable contact path — softer wording
      section += `🔍 **DISCOVERY NEEDED: ${urgentAction.title}**\n`;
      section += `${urgentAction.description}\n\n`;
    } else {
      // Has a contact path — real action
      const priorityEmoji = urgentAction.priority === "urgent" ? "🚨" : "⚡";
      section += `${priorityEmoji} **ACTION: ${urgentAction.title}**\n`;
      section += `${urgentAction.description}\n\n`;
    }
  }

  // ── Top 3 Projects ──
  if (top3Projects.length > 0) {
    section += `**Top 3 Priority Projects This Week:**\n\n`;
    for (const p of top3Projects) {
      const priorityEmoji = p.priority === "hot" ? "🔥" : p.priority === "warm" ? "🌡️" : "❄️";
      const newBadge = p.isNew ? " [NEW]" : "";
      const tierBadge = p.actionTier === "tier1_actionable" ? " [ACTIONABLE]" : p.actionTier === "tier2_warm" ? " [WARM]" : "";
      section += `${priorityEmoji} **${p.name}**${newBadge}${tierBadge}\n`;
      section += `   📍 ${p.location} | 💰 ${p.value} | ${p.owner}\n`;
      if (p.detectedActivities.length > 0) {
        section += `   🏗️ Activities: ${p.detectedActivities.slice(0, 3).join(", ")}\n`;
      }
      if (p.contractors && p.contractors.length > 0) {
        const cleanContractors = p.contractors
          .map(c => sanitizeContractorName(c.name))
          .filter((n): n is string => n !== null)
          .slice(0, 2);
        if (cleanContractors.length > 0) {
          section += `   🔧 Contractors: ${cleanContractors.join(", ")}\n`;
        }
      }
      if (p.overview) {
        section += `   ${p.overview.substring(0, 120)}...\n`;
      }
      section += `\n`;
    }
  }

  // ── Top 2 Stakeholder Discoveries ──
  if (top2Stakeholders.length > 0) {
    section += `**New Stakeholder Discoveries:**\n\n`;
    for (const s of top2Stakeholders) {
      const relBadge = s.roleRelevance === "high" ? "🔑 KEY" : "📋 MED";
      section += `${relBadge} **${s.name}** — ${s.title} at ${s.company}\n`;
      section += `   Project: ${s.project}`;
      if (s.email) section += ` | Email: ${s.email}`;
      if (s.linkedin) section += ` | [LinkedIn](${s.linkedin})`;
      section += `\n\n`;
    }
  }

  // ── Link back to This Week ──
  section += `---\n`;
  const siteUrlSection = getSiteUrl();
  section += `**[View full "This Week" summary →](${siteUrlSection}${thisWeekUrl})**\n`;
  section += `See all priority projects, stage changes, and suggested actions in one place.\n`;

  return section;
}

/**
 * Generate a personalized Monday weekly digest for a single user.
 * Includes This Week highlights + personalized project matches.
 */
function generateMondayDigest(
  userName: string,
  reportWeek: string,
  matchedProjects: Array<DigestProject & { relevanceScore: number }>,
  matchedContacts: DigestContact[],
  pipelineCount: number,
  thisWeekSection: string,
  territories: string[],
  freshnessLine: string,
  weekKey: string,
  userId: number,
  excludeMustActIds?: Set<number>, // cross-rep dedup: project IDs claimed by a higher-scoring rep
  assignedBLs: string[] = [],
): string {
  // ── Brief Readiness Split ──
  const actionReady = matchedProjects.filter(p => p.briefReadiness === "action_ready");
  const discoveryNeeded = matchedProjects.filter(p => p.briefReadiness === "discovery_needed");
  const monitorOnly = matchedProjects.filter(p => p.briefReadiness === "monitor_only");

  // Brief caps — tighter than before: 3 must-act, 2 discovery, 3 monitor
  const TOP_ACTIONS_CAP = 3;
  const DISCOVERY_CAP = 2;
  const MONITOR_CAP = 3;

  // Primary Must Act pool: action_ready projects (have verified contacts)
  // Apply cross-rep dedup exclusion: projects claimed by a higher-scoring rep are excluded
  const dedupFilteredActionReady = excludeMustActIds && excludeMustActIds.size > 0
    ? actionReady.filter(p => !p.id || !excludeMustActIds.has(p.id))
    : actionReady;
  let topActions: typeof actionReady = dedupFilteredActionReady.slice(0, TOP_ACTIONS_CAP);

  // Fallback Must Act: if fewer than 3 action_ready, fill from warm projects with
  // high lane fit + high relevance score. These are honest fallbacks — labelled
  // differently in the render path so the rep knows contacts still need validation.
  const FALLBACK_MIN_SCORE = 35;
  const FALLBACK_MIN_LANE_FIT = "High";
  if (topActions.length < TOP_ACTIONS_CAP) {
    const fallbackCandidates = matchedProjects
      .filter(p => {
        if (topActions.some(a => a.id === p.id)) return false;
        if (p.briefReadiness === "monitor_only") return false;
        if (p.priority !== "warm") return false;
        if (p.laneFitLabel !== FALLBACK_MIN_LANE_FIT && p.laneFitLabel !== "Medium") return false;
        if ((p.relevanceScore ?? 0) < FALLBACK_MIN_SCORE) return false;
        // Portable Air Gate: fallback Must Act must also pass the gate
        const gate = (p as any).gateResult;
        if (gate && !gate.pass) return false;
        return true;
      })
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
    const needed = TOP_ACTIONS_CAP - topActions.length;
    const fallbackItems = fallbackCandidates.slice(0, needed).map(p => ({ ...p, isFallback: true }));
    topActions = [...topActions, ...fallbackItems];
  }

  const discoveryItems = discoveryNeeded
    .filter(p => {
      if (topActions.some(a => a.id === p.id)) return false;
      // Portable Air Gate: only show Waiting on Contact Discovery if the project
      // would genuinely be worth pursuing once a contact is found.
      // Gate-failed projects (suppress or monitor_only) are excluded — no point
      // asking Ryan to find a contact for a school or a seismic survey.
      const gate = (p as any).gateResult;
      if (gate && !gate.pass) return false;
      return true;
    })
    .slice(0, DISCOVERY_CAP);
  const monitorItems = monitorOnly.slice(0, MONITOR_CAP);

  const territoryLabel = territories.length > 0
    ? territories.includes("NATIONAL") || territories.includes("National")
      ? "National"
      : territories.join(", ")
    : "All Regions";

  const hotCount = matchedProjects.filter(p => p.priority === "hot").length;
  const newCount = matchedProjects.filter(p => p.isNew).length;
  const totalShown = topActions.length + discoveryItems.length + monitorItems.length;

  // ── Header: 1 line, above the fold ──
  let content = `**PT Capital Sales — ${territoryLabel} Brief — ${reportWeek}**\n\n`;
  content += `Hi ${userName || "there"},\n\n`;

  // ── Above-the-fold summary: counts + freshness in one line ──
  const summaryParts: string[] = [];
  if (hotCount > 0) summaryParts.push(`${hotCount} hot`);
  if (newCount > 0) summaryParts.push(`${newCount} new`);
  summaryParts.push(`${topActions.length} ready to act`);
  if (discoveryItems.length > 0) summaryParts.push(`${discoveryItems.length} need contacts`);
  content += `**This week:** ${summaryParts.join(" | ")} — _${freshnessLine}_\n\n`;

  // NOTE: thisWeekSection (Discovery Needed banner, Top 3 Priority Projects, New Stakeholder
  // Discoveries) intentionally removed from Monday digest to eliminate the duplicate priority
  // system and prevent cross-state territory contamination. Single hierarchy: Must Act →
  // Closing Soon → Waiting on Contact Discovery.

  // ═══════════════════════════════════════════════════════════════
  // SECTION 1: MUST ACT (action_ready, max 3)
  // ═══════════════════════════════════════════════════════════════
  if (topActions.length > 0) {
    content += `---\n\n## 🟥 Must Act This Week (${topActions.length})\n\n`;
    for (const p of topActions) {
      const isFallback = !!(p as any).isFallback;
      content += renderProjectCard(p, weekKey, userId, isFallback ? "discovery_needed" : "action_ready", isFallback, assignedBLs);
    }
  } else {
    content += `---\n\n## 🟥 Must Act This Week\n\n`;
    content += `_No action-ready opportunities this week — see Discovery Needed below._\n\n`;
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 2: CLOSING SOON (tenders closing within 14 days, max 3)
  // ═══════════════════════════════════════════════════════════════
  const CLOSING_SOON_CAP = 3;
  const nowDate = new Date();
  const twoWeeksOut = new Date(nowDate.getTime() + 14 * 24 * 60 * 60 * 1000);
  const closingSoonItems = matchedProjects
    .filter(p => {
      const closeDate = (p as any).tenderCloseDate;
      if (!closeDate) return false;
      const d = new Date(closeDate);
      if (!(d >= nowDate && d <= twoWeeksOut)) return false;
      // Portable Air Gate: Closing Soon must pass the gate — no school/health/wind/BESS
      // tenders in this section regardless of score.
      const gate = (p as any).gateResult;
      if (gate && !gate.pass) return false;
      // Quality gate: only show Closing Soon if the project is genuinely relevant.
      // Thresholds are sector-dependent:
      //   - infrastructure: score >= 55 AND priority=hot|warm (prevents school/council/govt
      //     building tenders from appearing — AI scraper inflates their scores via equipment signals)
      //   - industrial (mining/oil_gas/energy/defence): score >= 35 (standard threshold)
      const score = (p as any).relevanceScore ?? 0;
      const laneFit = (p as any).laneFitLabel ?? "";
      const sector = (p as any).sector ?? "";
      const priority = (p as any).priority ?? "";
      const isInfrastructure = sector.toLowerCase() === "infrastructure";
      if (isInfrastructure) {
        // Infrastructure projects need a higher bar: score >= 55 AND hot or warm priority
        if (score < 55) return false;
        if (priority === "cold") return false;
      } else {
        if (score <= 35) return false;
      }
      if (laneFit === "Not relevant") return false;
      // Must have direct-sale credible channel (not monitor/low fit)
      const channel = (p as any).channel ?? "";
      if (channel === "monitor" || channel === "low_fit") return false;
      return true;
    })
    .sort((a, b) => {
      const da = new Date((a as any).tenderCloseDate).getTime();
      const db = new Date((b as any).tenderCloseDate).getTime();
      return da - db;
    })
    .slice(0, CLOSING_SOON_CAP);
  if (closingSoonItems.length > 0) {
    content += `---\n\n## ⏰ Closing Soon (${closingSoonItems.length})\n\n`;
    const siteUrl = getSiteUrl();
    for (const p of closingSoonItems) {
      const closeDate = new Date((p as any).tenderCloseDate);
      const daysLeft = Math.ceil((closeDate.getTime() - nowDate.getTime()) / (24 * 60 * 60 * 1000));
      content += `**${p.name}** — Closes in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} — [View →](${siteUrl}/project/${p.id})\n`;
      const factParts: string[] = [];
      if (p.location && p.location !== "Unknown") factParts.push(p.location);
      if (p.value && p.value !== "Unknown" && p.value !== "TBC") factParts.push(p.value);
      if (factParts.length > 0) content += `   ${factParts.join(" • ")}\n`;
      content += `\n`;
    }
  }
  // ═══════════════════════════════════════════════════════════════
  // SECTION 3: WAITING ON CONTACT DISCOVERY (max 3, compact)
  // ═══════════════════════════════════════════════════════════════
  if (discoveryItems.length > 0) {
    content += `---\n\n## 🔍 Waiting on Contact Discovery (${discoveryItems.length})\n\n`;
    for (const p of discoveryItems) {
      content += renderProjectCard(p, weekKey, userId, "discovery_needed", false, assignedBLs);
    }
  }

  // ── Footer: pipeline count + dashboard link only ──
  content += `---\n\n`;
  if (pipelineCount > 0) {
    content += `**Your pipeline:** ${pipelineCount} active — `;
  }
  content += `[Open full dashboard →](${getSiteUrl()}/)`;
  if (totalShown < matchedProjects.length) {
    content += ` | ${matchedProjects.length - totalShown} more opportunities in dashboard`;
  }
  content += `\n`;

  return content;
}

/**
 * Render a single project card in the email brief.
 *
 * Design rules (tighter rep brief):
 * - 1 project = max 5 lines
 * - Atlas-known facts on line 2 (location, value, contractor/owner)
 * - Why now on line 3 (stage, why it matters, AI-inferred if applicable)
 * - Route-to-buy + known stakeholder OR role gap on line 4
 * - Exact next step on line 5 (single action, not prose)
 * - One project link only
 * - No repeated "Unknown" fields
 * - No long prose overview blocks
 */
function renderProjectCard(
  p: DigestProject & { relevanceScore: number },
  weekKey: string,
  userId: number,
  readiness: BriefReadiness,
  isFallback = false,
  assignedBLs: string[] = [],
): string {
  const priorityLabel = p.priority === "hot" ? "🔥 HOT" : p.priority === "warm" ? "🟡 WARM" : "🔵 COLD";
  const newBadge = p.isNew ? " • NEW" : "";
  const siteUrl = getSiteUrl();

  // Line 1: Project name + priority badge + link
  let card = `**${p.name}** — ${priorityLabel}${newBadge} — [View →](${siteUrl}/project/${p.id})\n`;

  // Line 1b: Lane Fit + Channel chip (new — from laneScoring.ts)
  const laneFitChip = p.laneFitLabel && p.laneFitLabel !== "Not relevant"
    ? `${p.laneFitLabel === "High" ? "✅" : p.laneFitLabel === "Medium" ? "🟡" : "⬜"} ${p.laneFitLabel} fit`
    : null;
  // 'rental' channel is suppressed by the Portable Air Opportunity Gate before display.
  // It should never appear in a rep-facing digest card.
  const channelChip = p.channel && p.channel !== "monitor" && p.channel !== "rental"
    ? p.channel === "direct" ? "Direct sale"
    : p.channel === "crosssell" ? "Cross-sell / Adjacent"
    : null
    : null;
  // Three-family air opportunity chip: only show for PA reps (not pump/dewatering reps)
  const isPrimaryPAOrSpecialtyAirRep =
    assignedBLs.some(bl => ['Portable Air', 'Specialty Air'].includes(bl)) &&
    !assignedBLs.some(bl => ['Pump (Flow)', 'Dewatering Pumps', 'Pump'].includes(bl));
  const isPumpRep =
    assignedBLs.some(bl => ['Pump (Flow)', 'Dewatering Pumps', 'Pump'].includes(bl));
  // PA/Specialty Air reps see air product angle; Pump reps see Sykes pump product angle
  const productAngleChip = isPrimaryPAOrSpecialtyAirRep &&
    p.bestProductAngle && p.bestProductAngle !== "Monitor" && p.airFit && p.airFit !== "None"
    ? `🛠️ ${p.bestProductAngle}`
    : isPumpRep && p.bestPumpAngle && p.bestPumpAngle !== "Monitor"
    ? `🔵 ${p.bestPumpAngle}`
    : null;
  const fallbackChip = isFallback ? "⚠️ Contacts need validation" : null;
  const chipParts = [laneFitChip, channelChip, productAngleChip, fallbackChip].filter(Boolean);
  if (chipParts.length > 0) {
    card += `   ${chipParts.join(" • ")}\n`;
  }

  // Line 2: Atlas-known facts (skip Unknown/empty fields)
  const factParts: string[] = [];
  if (p.location && p.location !== "Unknown" && p.location !== "unknown") factParts.push(p.location);
  if (p.value && p.value !== "Unknown" && p.value !== "TBC") factParts.push(p.value);
  // Owner only if not dirty/unknown
  const ownerClean = p.owner && p.owner !== "Unknown" && p.owner !== "unknown" && p.owner.length > 2;
  if (ownerClean) factParts.push(p.owner);
  if (factParts.length > 0) {
    card += `   ${factParts.join(" • ")}\n`;
  }

  // Line 3: Why now — prefer lane-scored whyNow, fall back to stage + route + overview snippet
  if (p.whyNow && p.whyNow.length > 5) {
    card += `   ${p.whyNow.substring(0, 120)}${p.whyNow.length > 120 ? "…" : ""}\n`;
  } else {
    const stageLabel = p.stageCode && p.stageCode !== "unknown" && p.stageCode !== "Unknown"
      ? p.stageCode.charAt(0).toUpperCase() + p.stageCode.slice(1)
      : null;
    const routeLabel = p.opportunityRoute && p.opportunityRoute !== "Unknown" ? p.opportunityRoute : null;
    const whyNowParts: string[] = [];
    if (stageLabel) whyNowParts.push(stageLabel);
    if (routeLabel) whyNowParts.push(routeLabel);
    if (p.overview && p.overview.length > 20) {
      const snippet = p.overview.replace(/\s+/g, " ").trim().substring(0, 80);
      whyNowParts.push(snippet + (p.overview.length > 80 ? "…" : ""));
    }
    if (whyNowParts.length > 0) {
      card += `   ${whyNowParts.join(" • ")}\n`;
    }
  }

  // Line 4 + 5: Readiness-specific action
  if (readiness === "action_ready" && p.bestContact) {
    const contact = p.bestContact;
    // Stakeholder line: name + title (skip if both empty)
    const hasName = contact.name && contact.name !== "Unknown";
    const hasTitle = contact.title && contact.title !== "Unknown";
    if (hasName || hasTitle) {
      const stakeholderLine = [hasName ? contact.name : null, hasTitle ? contact.title : null]
        .filter(Boolean).join(", ");
      card += `   👤 ${stakeholderLine}\n`;
    }
    // Next step: single concrete action
    if (contact.email) {
      card += `   ➡️ **Email ${contact.name || "contact"}:** ${contact.email}\n`;
    } else if (contact.linkedin) {
      card += `   ➡️ **Connect on LinkedIn:** [${contact.name || "View profile"}](${contact.linkedin})\n`;
    } else {
      card += `   ➡️ Open project card → Contacts tab to reach out\n`;
    }
  } else if (readiness === "discovery_needed") {
    const govStatus = (p as any).govFallbackStatus as string | null;
    const blockedReason = (p as any).enrichmentBlockedReason as string | null;
    if (govStatus === "government_fallback_role_only") {
      card += `   🏙️ Gov / Public Body — roles found, no named contact\n`;
      card += `   ➡️ Search LinkedIn for procurement contacts at ${ownerClean ? p.owner : "this organisation"}\n`;
    } else if (govStatus === "government_fallback_no_result" || govStatus === "government_fallback_manual_review_required") {
      card += `   🏙️ Gov / Public Body — no automated contact path\n`;
      card += `   ➡️ Check tender portal or issuer website for contact details\n`;
    } else if (blockedReason === "blocked_unknown_owner" || blockedReason === "blocked_dirty_owner_string") {
      card += `   ⚠️ Owner data gap — update owner name to unlock enrichment\n`;
      card += `   ➡️ Open project card → edit owner field\n`;
    } else {
      card += `   🔍 No send-ready contacts yet\n`;
      card += `   ➡️ Open project card → Contacts tab → Run Enrichment\n`;
    }
  } else if (readiness === "monitor_only") {
    // Monitor: minimal — just the facts, no action line
    // (already covered by lines 1–3 above)
  }

  card += `\n`;
  return card;
}

// ── Product lane slug → human label map ──
const PRODUCT_LANE_LABELS: Record<string, string> = {
  portable_air: "Portable Air",
  multi_lane_pt: "Power Technique",
  bess: "Battery Energy Storage",
  pal: "Power & Light",
  generators: "Generators",
  lighting: "Lighting Towers",
  pump: "Dewatering Pumps",
  pumps: "Dewatering Pumps",
  dewatering: "Dewatering",
  nitrogen: "Nitrogen Generation",
  opexmonitor: "Monitoring & Service",
  opex_monitor: "Monitoring & Service",
  opex: "Monitoring & Service",
  fleet_capex: "Fleet Equipment",
  direct_capex: "Direct Equipment",
  rental: "Equipment Solutions",
};

function humaniseProductLabel(raw: string | null | undefined): string | null {
  if (!raw || raw === "Unknown" || raw === "unknown") return null;
  const key = raw.toLowerCase().replace(/[\s/]+/g, "_");
  const mapped = PRODUCT_LANE_LABELS[key];
  if (mapped !== undefined) return mapped;
  // Fallback: title-case the slug for display
  return raw.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Sector slug → human label map ──
const SECTOR_LABELS: Record<string, string> = {
  oil_gas: "Oil & Gas",
  oil: "Oil & Gas",
  gas: "Gas",
  mining: "Mining",
  energy: "Energy",
  infrastructure: "Infrastructure",
  defence: "Defence",
  water: "Water",
  construction: "Construction",
  renewables: "Renewables",
  transport: "Transport",
};

function humaniseSectorLabel(raw: string | null | undefined): string {
  if (!raw || raw === "Unknown") return "project";
  const key = raw.toLowerCase().replace(/[\s/]+/g, "_");
  return SECTOR_LABELS[key] ?? raw.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Truncate pitch at word boundary (never mid-word) ──
function truncatePitch(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  // Try to break at sentence boundary first (period followed by space)
  const sentenceCut = text.lastIndexOf(". ", maxLen - 3);
  if (sentenceCut > 60) return text.slice(0, sentenceCut + 1);
  // Fall back to word boundary — use a lower threshold (40) to avoid mid-word cuts
  const wordCut = text.lastIndexOf(" ", maxLen - 3);
  if (wordCut > 40) return text.slice(0, wordCut) + "...";
  // Last resort: hard cut at maxLen (extremely rare — only if no spaces in first 40 chars)
  return text.slice(0, maxLen - 3) + "...";
}

// ── Sanitise contact title (extract credible job title from LinkedIn headlines) ──
function sanitiseContactTitle(raw: string | null | undefined): string | null {
  if (!raw || raw === "Unknown" || raw === "unknown") return null;
  // Step 1: Take first pipe-separated segment
  const first = raw.split("|")[0].trim();
  // Step 2: Strip "at Company" suffix
  const noCompany = first.replace(/\s+at\s+[A-Z].*/i, "").replace(/[,;]+$/, "").trim();
  // Step 3: If the result looks like a LinkedIn headline (starts with adjective/descriptor),
  // try to extract a real job title by finding known role keywords
  const ROLE_KEYWORDS = /(?:Manager|Director|Engineer|Superintendent|Coordinator|Lead|Head|Officer|VP|President|Chief|Specialist|Advisor|Consultant|Analyst|Supervisor|Foreman|Controller|Planner|Buyer|Procurement)/i;
  let clean = noCompany;
  if (clean.length > 50 && !ROLE_KEYWORDS.test(clean.slice(0, 30))) {
    // The first 30 chars don't contain a role keyword — try to find one later in the string
    const match = clean.match(ROLE_KEYWORDS);
    if (match && match.index !== undefined) {
      // Extract from 2 words before the keyword to end of that phrase
      const before = clean.slice(0, match.index);
      const lastSpace = before.lastIndexOf(" ", before.length - 1);
      const secondLastSpace = lastSpace > 0 ? before.lastIndexOf(" ", lastSpace - 1) : -1;
      const startIdx = secondLastSpace > 0 ? secondLastSpace + 1 : (lastSpace > 0 ? lastSpace + 1 : match.index);
      // Take from startIdx to next comma/pipe/end
      const remainder = clean.slice(startIdx);
      const endMatch = remainder.match(/[|,;]/);
      clean = endMatch ? remainder.slice(0, endMatch.index).trim() : remainder.trim();
    }
  }
  // Step 4: Enforce max length
  if (clean.length > 60) clean = clean.slice(0, 57) + "...";
  return clean || null;
}

// ── Lane-appropriate CTA language (direct-sale, no rental) ──
function buildCtaAction(
  contactName: string | null,
  contactTitle: string | null,
  productLane: string | null,
  badge: "action_ready" | "discovery_needed",
): string {
  if (badge === "discovery_needed") {
    if (contactName && contactTitle) {
      return `Engage ${contactName}, ${contactTitle} — confirm equipment scope, timing, and route to purchase.`;
    }
    return "Open project card → Contacts tab → run enrichment to identify the right buyer.";
  }
  // action_ready — lane-specific direct-sale language
  const lane = (productLane ?? "").toLowerCase();
  let action: string;
  if (lane.includes("pump") || lane.includes("dewater")) {
    // Intelligence-first: lead with project insight, not cold outreach
    action = "review project scope and dewatering requirements on the dashboard before reaching out";
  } else if (lane.includes("bess") || lane.includes("pal") || lane.includes("generator") || lane.includes("lighting")) {
    action = "discuss project package, deployment timing, and site delivery path";
  } else {
    // Portable Air default (also covers multi_lane_pt, direct_capex, fleet_capex)
    action = "discuss application, timing, equipment package, and contractor route-to-buy";
  }
  if (contactName && contactTitle) {
    return `Contact ${contactName}, ${contactTitle} to ${action}.`;
  } else if (contactName) {
    return `Contact ${contactName} to ${action}.`;
  } else if (contactTitle) {
    return `Contact the ${contactTitle} to ${action}.`;
  }
  return `Open project card to ${action}.`;
}

/**
 * Convert annotated projects into EmailSignal[] for the new HTML template.
 * Caps at 5 signals total: up to 3 action_ready + 2 discovery_needed.
 * Monitor-only projects are excluded from the email (they can see them on dashboard).
 */
export function buildEmailSignals(
  annotatedProjects: Array<DigestProject & { relevanceScore: number; briefReadiness?: BriefReadiness; bestContact?: DigestProject["bestContact"] }>,
  territories: string[],
): EmailSignal[] {
  const signals: EmailSignal[] = [];
  const actionReady = annotatedProjects.filter(p => p.briefReadiness === "action_ready").slice(0, 3);
  const discoveryNeeded = annotatedProjects.filter(p => p.briefReadiness === "discovery_needed").slice(0, 2);
  for (const p of actionReady) {
    const rawProductSuffix = p.productLane && p.productLane !== "Unknown"
      ? p.productLane
      : p.opportunityRoute && p.opportunityRoute !== "Unknown"
        ? p.opportunityRoute
        : null;
    const productSuffix = humaniseProductLabel(rawProductSuffix);
    const title = productSuffix ? `${p.name} — ${productSuffix}` : p.name;
    const company = p.owner && p.owner !== "Unknown" && p.owner !== "unknown" ? p.owner : "";
    // Build pitch from overview — word-boundary truncation
    let pitch = "";
    if (p.overview && p.overview.length > 20) {
      pitch = truncatePitch(p.overview.replace(/\s+/g, " ").trim(), 200);
    } else {
      pitch = `${p.name} presents an opportunity for Atlas Copco Power Technique solutions.`;
    }
    // Build CTA — direct-sale language, contact name + sanitised title
    const contactName = p.bestContact?.name && p.bestContact.name !== "Unknown" ? p.bestContact.name : null;
    const rawTitle = p.bestContact?.title && p.bestContact.title !== "Unknown" ? p.bestContact.title : null;
    const contactTitle = sanitiseContactTitle(rawTitle);
    const ctaAction = buildCtaAction(contactName, contactTitle, rawProductSuffix, "action_ready");
    // Product tag — human labels
    const sectorLabel = humaniseSectorLabel(p.sector);
    const productTag = productSuffix
      ? `${productSuffix} for ${sectorLabel}`
      : `Equipment solutions for ${sectorLabel}`;
    signals.push({
      projectId: p.id,
      badge: "action_ready",
      title,
      company,
      pitch,
      ctaAction,
      productTag,
    });
  }
  for (const p of discoveryNeeded) {
    const rawProductSuffix = p.productLane && p.productLane !== "Unknown"
      ? p.productLane
      : p.opportunityRoute && p.opportunityRoute !== "Unknown"
        ? p.opportunityRoute
        : null;
    const productSuffix = humaniseProductLabel(rawProductSuffix);
    const title = productSuffix ? `${p.name} — ${productSuffix}` : p.name;
    const company = p.owner && p.owner !== "Unknown" && p.owner !== "unknown" ? p.owner : "";
    let pitch = "";
    if (p.overview && p.overview.length > 20) {
      pitch = truncatePitch(p.overview.replace(/\s+/g, " ").trim(), 200);
    } else {
      pitch = `${p.name} may require Power Technique solutions — contact discovery needed.`;
    }
    const contactName = p.bestContact?.name && p.bestContact.name !== "Unknown" ? p.bestContact.name : null;
    const rawTitle = p.bestContact?.title && p.bestContact.title !== "Unknown" ? p.bestContact.title : null;
    const contactTitle = sanitiseContactTitle(rawTitle);
    const ctaAction = buildCtaAction(contactName, contactTitle, rawProductSuffix, "discovery_needed");
    const sectorLabel = humaniseSectorLabel(p.sector);
    const productTag = productSuffix
      ? `${productSuffix} for ${sectorLabel}`
      : `Equipment opportunity — ${sectorLabel}`;
    signals.push({
      projectId: p.id,
      badge: "discovery_needed",
      title,
      company,
      pitch,
      ctaAction,
      productTag,
    });
  }
  return signals;
}
/**
 * Generate a personalized Thursday mid-week reminder for a single user.
 * Lighter than the Monday digest — focuses on urgent actions, pipeline nudges,
 * and any new hot projects discovered since Monday.
 */
function generateThursdayReminder(
  userName: string,
  reportWeek: string,
  hotProjects: Array<DigestProject & { relevanceScore: number }>,
  pipelineCount: number,
  thisWeekSection: string,
  territories: string[],
  freshnessLine: string,
  weekKey: string,
  userId: number,
): string {
  const territoryLabel = territories.length > 0
    ? territories.includes("NATIONAL") || territories.includes("National")
      ? "National"
      : territories.join(", ")
    : "All Regions";

  let content = `**PT Capital Sales — Mid-Week Reminder — ${reportWeek}**\n\n`;
  content += `Hi ${userName || "there"},\n\n`;
  content += `Quick mid-week PT Capital Sales check-in for **${territoryLabel}** — here's what needs your attention.\n\n`;

  // ── Freshness line near top ──
  content += `_${freshnessLine}_\n\n`;

  // NOTE: thisWeekSection removed from Thursday reminder — same territory contamination risk.

  // ── Hot projects only ──
  const actionable = hotProjects.filter(p =>
    p.actionTier === "tier1_actionable" || p.priority === "hot"
  );

  if (actionable.length > 0) {
    content += `---\n\n`;
    content += `**🔥 Hot & Actionable Projects in Your Territory (${actionable.length}):**\n\n`;
    for (const p of actionable.slice(0, 5)) {
      const newBadge = p.isNew ? " [NEW]" : "";
      const actCode = `ACT-${weekKey}-${userId}-${p.id}`;
      content += `🔥 **${p.name}**${newBadge}\n`;
      content += `   📍 ${p.location} | 💰 ${p.value} | ${p.owner}\n`;
      const siteUrlThurs = getSiteUrl();
      content += `   Ref: ${actCode} | 🔗 [View project →](${siteUrlThurs}/project/${p.id})\n`;
      if (p.overview) {
        content += `   ${p.overview.substring(0, 100)}...\n`;
      }
      content += `\n`;
    }
  }

  // Pipeline nudge
  if (pipelineCount > 0) {
    content += `\n**📋 Pipeline Reminder:** You have ${pipelineCount} active opportunities — have you updated their status this week?\n`;
  } else {
    content += `\n**📋 Pipeline Tip:** No active pipeline claims yet. Check the dashboard for projects worth adding to your pipeline.\n`;
  }

  content += `\n---\n`;
  content += `Open the dashboard to review all projects and take action before the weekend.`;

  return content;
}

/**
 * Core function: score and filter projects for a specific user profile.
 */
export async function scoreAndFilterProjects(
  allProjects: any[],
  profile: {
    territories: string[] | null;
    industries: string[] | null;
    offerCategories: string[] | null;
    customerTypes: string[] | null;
    dealSizeMin: string | null;
    dealSizeMax: string | null;
    assignedBusinessLines?: string[] | null;
    sectorFocus?: string[] | null;
    stageTiming?: string[] | null;
    buyerRoles?: string[] | null;
    keyAccounts?: string[] | null;
    salesMotion?: "direct_only" | "mixed" | null;
    /** Rep name for rep-gated signal logic (e.g. portable_air_blasting_signal) */
    repName?: string | null;
  },
): Promise<Array<DigestProject & { relevanceScore: number }>> {
  // Fetch BL scores for all projects in one batch
  const projectIds = allProjects.map(p => p.id).filter(Boolean);
  let blScoresMap = new Map<number, DimensionScore[]>();
  try {
    blScoresMap = await getProjectScoresBatch(projectIds);
  } catch (err) {
    console.warn("[EmailDigest] Failed to fetch BL scores, proceeding without:", err);
  }

  // ── Feedback tie-breaker boosts (mlRanker — guardrail 4) ──
  // Fetched once for the whole batch; applied per-project after lane scoring.
  // Capped to ±5 pts so it only breaks ties, not changes ranking order.
  let feedbackBoostMap = new Map<number, number>();
  const userId = (profile as any).userId as number | undefined;
  if (userId) {
    try {
      feedbackBoostMap = await getFeedbackBoostForProjects(userId, projectIds);
    } catch {
      // Non-fatal: proceed without tie-breaker
    }
  }

  const assignedBLs = (profile.assignedBusinessLines || []) as string[];

  // ── Load account priors for pump-lane matching (digest) ──
  let digestAccountPriors: { canonicalName: string; aliases: string[] | null; priorityLevel: string | null }[] = [];
  try {
    const db = await getDb();
    if (db) {
      digestAccountPriors = await db.select({
        canonicalName: accountPriors.canonicalName,
        aliases: accountPriors.aliases,
        priorityLevel: accountPriors.priorityLevel,
      }).from(accountPriors);
    }
  } catch { /* non-fatal */ }
  function matchAccountPriorDigest(projectOwner: string, projectName: string) {
    const ownerLower = (projectOwner || '').toLowerCase();
    const nameLower = (projectName || '').toLowerCase();
    for (const prior of digestAccountPriors) {
      const canonical = prior.canonicalName.toLowerCase();
      if (canonical.length > 3 && (ownerLower.includes(canonical) || nameLower.includes(canonical))) {
        return { canonicalName: prior.canonicalName, priorityLevel: prior.priorityLevel || 'B' };
      }
      if (prior.aliases) {
        for (const alias of prior.aliases) {
          const aliasLower = alias.toLowerCase();
          if (aliasLower.length > 3 && (ownerLower.includes(aliasLower) || nameLower.includes(aliasLower))) {
            return { canonicalName: prior.canonicalName, priorityLevel: prior.priorityLevel || 'B' };
          }
        }
      }
    }
    return null;
  }

  const scoredProjects = allProjects.map(p => {
    const projectBLScores = blScoresMap.get(p.id) || [];

    // ── Lane-aware scoring (laneScoring.ts — single source of truth) ──
    const laneResult = computePerUserFinalScore(
      {
        id: p.id,
        name: p.name,
        location: p.location,
        value: p.value,
        owner: p.owner,
        priority: p.priority,
        sector: p.sector,
        opportunityRoute: p.opportunityRoute,
        isNew: p.isNew,
        stage: p.stage,
        overview: p.overview,
        equipmentSignals: (p as any).equipmentSignals ?? null,
        contractors: (p as any).contractors ?? null,
      },
      {
        territories: profile.territories,
        assignedBusinessLines: profile.assignedBusinessLines,
        sectorFocus: profile.sectorFocus,
        stageTiming: profile.stageTiming,
        keyAccounts: profile.keyAccounts,
        buyerRoles: profile.buyerRoles,
        salesMotion: profile.salesMotion,
        repName: profile.repName,
      },
      projectBLScores,
      [], // contacts not available here; contact quality uses project-level signals
      matchAccountPriorDigest(p.owner, p.name),
    );

    // Apply mlRanker tie-breaker (±5 pts)
    const feedbackBoost = feedbackBoostMap.get(p.id) ?? 0;
    const laneResultWithTieBreaker = applyTieBreaker(laneResult, feedbackBoost);

    // Classify visibility tier (guardrail 2 — separate from scoring)
    let visibilityTier = classifyVisibility(laneResultWithTieBreaker, assignedBLs.length > 0);

    // ── Opportunity Gate (guardrail 3) ──
    // Gate selection depends on the rep's assigned business lines:
    //   - PAL/BESS reps: only the PAL/BESS gate runs (PA gate is bypassed)
    //   - All other reps: the Portable Air gate runs
    const isPalBessRep = assignedBLs.some(bl => ['PAL', 'BESS', 'pal', 'bess'].includes(bl));
    const portableAirScore = laneResultWithTieBreaker.laneScores?.portableAir ?? 0;

    // Default gateResult: pass (will be overridden below)
    let gateResult: ReturnType<typeof portableAirOpportunityGate> = { pass: true };
    let palBessGateResult: ReturnType<typeof palBessOpportunityGate> | null = null;

    if (isPalBessRep) {
      // PAL/BESS reps: skip Portable Air gate, run PAL/BESS gate instead
      palBessGateResult = palBessOpportunityGate({
        name: p.name,
        overview: p.overview,
        sector: p.sector,
        opportunityRoute: p.opportunityRoute,
        equipmentSignals: (p as any).equipmentSignals ?? null,
        stage: (p as any).stage ?? null,
        priority: (p as any).priority ?? null,
      });
      if (!palBessGateResult.pass) {
        // Demote to monitor_only — not a PAL/BESS opportunity
        // Hard-suppress only for road/highway/rail projects (never a PAL/BESS path)
        if (palBessGateResult.suppressionLevel === 'suppress') {
          visibilityTier = 'suppress';
        } else if (visibilityTier !== 'suppress') {
          visibilityTier = 'monitor_only';
        }
      }
      // Mirror palBessGateResult into gateResult for downstream section checks
      gateResult = palBessGateResult.pass
        ? { pass: true }
        : { pass: false, reason: palBessGateResult.reason, suppressionLevel: palBessGateResult.suppressionLevel };
    } else {
      // Portable Air reps: run the Portable Air gate
      gateResult = portableAirOpportunityGate(
        {
          name: p.name,
          overview: p.overview,
          sector: p.sector,
          stage: p.stage,
          opportunityRoute: p.opportunityRoute,
          owner: p.owner,
          equipmentSignals: (p as any).equipmentSignals ?? null,
        },
        portableAirScore,
      );
      if (!gateResult.pass) {
        // Hard suppress: remove from pool entirely
        if (gateResult.suppressionLevel === 'suppress') {
          visibilityTier = 'suppress';
        } else {
          // Soft suppress: demote to monitor_only (still visible in Waiting section)
          if (visibilityTier !== 'suppress') visibilityTier = 'monitor_only';
        }
      }
    }

    return {
      id: p.id,
      name: p.name,
      location: p.location,
      value: p.value,
      owner: p.owner,
      priority: p.priority,
      sector: p.sector,
      opportunityRoute: p.opportunityRoute,
      isNew: p.isNew,
      stage: p.stage,
      overview: p.overview,
      actionTier: (p as any).actionTier as ActionTier | null,
      productLane: (p as any).productLane ?? null,
      stageCode: (p as any).stageCode ?? null,
      tenderCloseDate: (p as any).tenderCloseDate ?? null,
      projectState: (p as any).projectState ?? null,
      hasNoContacts: (p as any).hasNoContacts ?? false,
      // Lane scoring fields
      relevanceScore: laneResultWithTieBreaker.finalScoreWithTieBreaker,
      visibilityTier,
      laneFitLabel: laneResultWithTieBreaker.laneFitLabel,
      channel: laneResultWithTieBreaker.channel,
      whyNow: laneResultWithTieBreaker.whyNow,
      routeToBuy: laneResultWithTieBreaker.routeToBuy,
      bestNextMove: laneResultWithTieBreaker.bestNextMove,
      reasonCodes: laneResultWithTieBreaker.reasonCodes,
      gateResult,
      palBessGateResult: palBessGateResult ?? undefined,
      // Three-family air opportunity classification
      airFit: laneResultWithTieBreaker.airFit,
      opportunityType: laneResultWithTieBreaker.opportunityType,
      bestProductAngle: laneResultWithTieBreaker.bestProductAngle,
      // Sykes pump product angle for pump-lane reps
      bestPumpAngle: laneResultWithTieBreaker.bestPumpAngle,
    };
  });

  // Sort by relevance (finalScoreWithTieBreaker), then by tenderCloseDate asc (soonest first)
  // as a commercially meaningful secondary sort when scores are tied.
  scoredProjects.sort((a, b) => {
    const scoreDiff = b.relevanceScore - a.relevanceScore;
    if (scoreDiff !== 0) return scoreDiff;
    // Secondary: soonest closing date first (null/undefined sorts to the end)
    const aClose = (a as any).tenderCloseDate ? new Date((a as any).tenderCloseDate).getTime() : Infinity;
    const bClose = (b as any).tenderCloseDate ? new Date((b as any).tenderCloseDate).getTime() : Infinity;
    if (aClose !== bClose) return aClose - bClose;
    // Tertiary: alphabetical by project name for stable ordering
    return (a.name || "").localeCompare(b.name || "");
  });

  // Filter: suppress projects are excluded entirely; monitor_only projects are kept
  // (they appear in the monitor section of the digest, not Must Act / Watchlist)
  const scored = scoredProjects.filter(p => {
    if (p.visibilityTier === "suppress") return false;
    // Legacy score threshold: keep projects with score > 25 (lowered from 40 since
    // lane scoring is more precise — a 30-pt lane-scored project is more relevant
    // than a 45-pt generic-scored project was under the old model)
    return p.relevanceScore > 25;
  });

  // ── Lane-integrity post-filter (guardrail 4b) ──
  // For single-lane reps, hard-exclude projects whose productLane is clearly outside
  // their assigned lane. This prevents high-contact-count BESS/PAL/pump projects from
  // outscoring lower-contact PA/pump projects purely on contact-count base score.
  //
  // Rules:
  //   PA-only reps (Ryan, Daniel, Leo): exclude bess, pal, pumps
  //   Pump-only reps (Brett Hansen, Dan Day): exclude bess, pal, portable_air
  //   PAL/BESS reps (Amit): no exclusion
  //   Mixed-lane reps: no exclusion
  //
  // Keep always: multi_lane_pt, null/unknown (legitimately cross-lane)
  //
  // Brett Hansen override: treated as pump-only for this patch even if BL metadata
  // contains mixed labels. Resolved via resolveRepLaneCategory repNameOverride.
  const repLaneCategory = resolveRepLaneCategory(
    assignedBLs,
    (profile as any).repName as string | null | undefined,
  );
  const LANE_EXCLUSIONS_PA:   Set<string> = new Set(['bess', 'pal', 'pumps']);
  const LANE_EXCLUSIONS_PUMP: Set<string> = new Set(['bess', 'pal', 'portable_air']);
  const laneFilteredScored = scored.filter(p => {
    const lane = ((p as any).productLane || '').toLowerCase().trim();
    // null / unknown / multi_lane_pt always pass through
    if (!lane || lane === 'null' || lane === 'unknown' || lane === 'multi_lane_pt') return true;
    if (repLaneCategory === 'portableAir' && LANE_EXCLUSIONS_PA.has(lane)) return false;
    if (repLaneCategory === 'pump'        && LANE_EXCLUSIONS_PUMP.has(lane)) return false;
    return true;
  });

  // ── Hard territory filter (post-scoring) ──
  // For state-coded territories (WA, QLD, NSW, VIC, SA, NT, TAS, ACT), a project must
  // match at least one territory via projectState OR location string. Projects with
  // projectState set to a different Australian state are hard-excluded even if they
  // scored above threshold (prevents Stockland National, Snowy Hydro NSW, Goulburn NSW,
  // Wakehurst Parkway NSW, Inland Rail VIC, etc. appearing in WA digest).
  const territories = resolveTerritories(profile.territories as string[] | null, profile.sectorFocus as string[] | null);
  if (territories.length === 0 || territories.length >= 8) {
    return laneFilteredScored; // National reps (resolved to all 8+ states) see everything
  }
  const AU_STATES = new Set(["WA", "QLD", "NSW", "VIC", "SA", "TAS", "NT", "ACT"]);
  const stateKeywordsMap: Record<string, string[]> = {
    WA: ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha", "port hedland", "newman", "geraldton", "bunbury", "broome", "norseman", "murchison", "kwinana"],
    QLD: ["queensland", "qld", "brisbane", "townsville", "mackay", "gladstone", "rockhampton", "cairns", "bowen basin", "moranbah", "emerald"],
    NSW: ["new south wales", "nsw", "sydney", "newcastle", "hunter valley", "wollongong", "broken hill", "orange", "dubbo", "mudgee", "goulburn", "wakehurst"],
    VIC: ["victoria", "vic", "melbourne", "geelong", "ballarat", "bendigo", "latrobe", "euroa"],
    SA: ["south australia", "sa", "adelaide", "olympic dam", "whyalla", "port augusta"],
    NT: ["northern territory", "nt", "darwin", "alice springs", "tennant creek", "katherine"],
    TAS: ["tasmania", "tas", "hobart", "launceston"],
    ACT: ["australian capital territory", "act", "canberra"],
  };
  return laneFilteredScored.filter(p => {
    const projectState = ((p as any).projectState || "").toUpperCase();
    const loc = (p.location || "").toLowerCase();
    return territories.some(t => {
      const tUpper = t.toUpperCase();
      // Hard exclusion: projectState is set to a different AU state
      if (projectState && AU_STATES.has(projectState) && projectState !== tUpper) return false;
      // Location string match using word-boundary-aware keywords
      const keywords = stateKeywordsMap[tUpper] || [t.toLowerCase()];
      return keywords.some(kw => {
        if (kw.length <= 3) {
          const re = new RegExp(`(?:^|[\\s,;/|()\\-])${kw}(?:$|[\\s,;/|()\\-])`, "i");
          return re.test(loc);
        }
        return loc.includes(kw);
      });
    });
  });
}

/**
 * Send compulsory personalized Monday weekly digests to ALL users with profiles.
 * No opt-in required — every user who has completed onboarding gets a digest.
 *
 * @param force - Skip dedup guard and re-send even if already sent today
 * @param dryRun - Generate content but do NOT send; logs with dryRun=true
 */
export async function sendWeeklyDigests(force = false, dryRun = false): Promise<{
  sent: number;
  failed: number;
  skipped: number;
  alreadySent: number;
  previews?: Array<{ userId: number; subject: string; contentLength: number; contentSnippet?: string }>;
}> {
  const results: {
    sent: number; failed: number; skipped: number; alreadySent: number;
    previews?: Array<{ userId: number; subject: string; contentLength: number; contentSnippet?: string }>;
  } = { sent: 0, failed: 0, skipped: 0, alreadySent: 0 };
  if (dryRun) results.previews = [];

  // Kill switch: skip all email sending when disabled (dry-run bypasses this)
  if (!dryRun && process.env.EMAIL_DIGESTS_ENABLED !== "true") {
    console.log("[EmailDigest] ⚠ Email digests DISABLED (EMAIL_DIGESTS_ENABLED != true). Skipping weekly digest.");
    return results;
  }

  // ── Freshness Gate ──
  // Block the Monday digest if the pipeline data is stale or failed.
  // Bypass: force=true (admin Force Re-send) OR dryRun=true OR DIGEST_STALE_FALLBACK=true.
  //
  // Freshness window: 26h (tolerates minor scheduler drift).
  // If stale/failed and DIGEST_STALE_FALLBACK=true, digest sends with a clear stale warning.
  //
  // AUDIT: Any force bypass is logged with FORCE_OVERRIDE marker so it is always
  // visible in server logs and auditable.
  if (force && !dryRun) {
    const freshness = await checkPipelineFreshness(36);
    console.warn(
      `[EmailDigest] ⚠ FORCE_OVERRIDE: sendWeeklyDigests(force=true) bypassing freshness gate.` +
      ` Pipeline status: ${freshness.status} (${freshness.ageHours}h old).` +
      ` Sending to all recipients with potentially stale data.`
    );
  }

  if (!force && !dryRun) {
    const freshness = await checkPipelineFreshness(36);
    const isBlocked = freshness.status === "stale" || freshness.status === "failed" || freshness.status === "never_run";

    if (isBlocked) {
      const allowStaleFallback = process.env.DIGEST_STALE_FALLBACK === "true";

      if (!allowStaleFallback) {
        // Hard block: hold the digest and notify owner
        console.warn(
          `[EmailDigest] 🚫 FRESHNESS GATE: Monday digest HELD. Pipeline status: ${freshness.status}. Reason: ${freshness.blockedReason}`
        );

        // Dedup: only notify the owner ONCE per week — CloudRun cold-starts on every
        // request, so without this guard the owner gets spammed on every retry.
        const alreadyNotified = await wasFreshnessHeldNotifiedThisWeek();
        if (!alreadyNotified) {
          // Log the hold FIRST so any concurrent cold-starts also see it
          await logFreshnessHeld(freshness.blockedReason ?? freshness.status);
          try {
            const { notifyOwner } = await import("./_core/notification");
            const digestAttemptedAt = new Date();
            const stalenessHours = freshness.lastCompletedAt
              ? Math.round(((digestAttemptedAt.getTime() - freshness.lastCompletedAt.getTime()) / 3600000) * 10) / 10
              : null;
            await notifyOwner({
              title: "⚠️ Monday Digest HELD — Pipeline Freshness Gate",
              content: [
                `The Monday digest was blocked by the freshness gate and was NOT sent.`,
                `Pipeline status: **${freshness.status.toUpperCase()}**`,
                `Reason: ${freshness.blockedReason}`,
                ``,
                `Last successful pipeline run: ${freshness.lastCompletedAt ? freshness.lastCompletedAt.toUTCString() : "never"}`,
                `Digest attempted at: ${digestAttemptedAt.toUTCString()}`,
                `Freshness threshold: ${freshness.windowHours}h`,
                `Actual staleness: ${stalenessHours !== null ? `${stalenessHours}h` : "unknown (no completed run found)"}`,
                ``,
                `To override and send with stale data, set DIGEST_STALE_FALLBACK=true and trigger a manual send from the Admin panel.`,
                ``,
                `(This notification will not repeat until next week.)`,
              ].join("\n"),
            });
          } catch (notifyErr) {
            console.error("[EmailDigest] Failed to notify owner of freshness gate hold:", notifyErr);
          }
        } else {
          console.log(
            "[EmailDigest] Freshness gate hold already notified this week — suppressing duplicate notification"
          );
        }

        // Return with a special marker so callers can detect the hold
        return { ...results, skipped: -1 }; // skipped=-1 signals freshness gate hold
      }

      // Stale fallback: send but flag clearly in subject and body
      console.warn(
        `[EmailDigest] ⚠ STALE FALLBACK: Sending Monday digest with stale data (DIGEST_STALE_FALLBACK=true). Pipeline status: ${freshness.status}`
      );
      // staleWarning is injected into the email subject and body below
      (results as any).__staleWarning = `[STALE DATA — pipeline ${freshness.status}: ${freshness.blockedReason}]`;
    } else {
      console.log(
        `[EmailDigest] ✓ Freshness gate passed: pipeline status=${freshness.status}, last completed ${freshness.ageHours}h ago`
      );
    }
  }

  const weekKey = getDigestWeekKey();

  // Get the latest report
  const report = await getLatestReport();
  if (!report) {
    console.warn("[EmailDigest] No report found, skipping digest");
    return results;
  }

  // Get freshness line: last pipeline run date
  const latestRun = await getLatestPipelineRun();
  const freshnessLine = latestRun?.completedAt
    ? `Data last refreshed: ${new Date(latestRun.completedAt).toUTCString().slice(0, 16)} UTC`
    : `Data as of: ${report.weekEnding}`;

  // Get all active, non-suppressed projects and quality-filtered contacts.
  // NOTE: We no longer filter by reportId because reportId assignment is fragmented
  // across scrapers (each creates its own report row). Instead we load all active
  // projects and let the per-user scoring + tier classification handle relevance.
  const allProjects = await getActiveProjects();
  let allContacts = await getAllContacts();
  console.log(`[EmailDigest] Loaded ${allProjects.length} active projects, ${allContacts.length} quality contacts (report.id=${report.id} used for metadata only)`);

  // ── Pre-digest enrichment: target hot/tier1 projects with no send-ready contacts ──
  // This runs BEFORE per-user scoring so enriched contacts are available for all reps.
  try {
    const contactProjectNames = new Set(allContacts.map(c => c.project).filter(Boolean));
    const enrichCandidates = allProjects
      .filter(p =>
        (p.priority === "hot" || (p as any).actionTier === "tier1_actionable") &&
        !p.suppressed &&
        !contactProjectNames.has(p.name)
      )
      .slice(0, 5); // cap at 5 to keep digest latency reasonable

    if (enrichCandidates.length > 0) {
      console.log(`[EmailDigest] Pre-digest enrichment: ${enrichCandidates.length} hot projects with no contacts`);
      const { enrichProjectContacts } = await import("./apolloEnrichment");
      for (const p of enrichCandidates) {
        try {
          await enrichProjectContacts(p.id, report.id, { enrichEmails: true, maxPerCompany: 3 });
          console.log(`[EmailDigest] Pre-digest enriched: ${p.name} (id=${p.id})`);
        } catch (enrichErr) {
          console.warn(`[EmailDigest] Pre-digest enrichment failed for ${p.name}:`, enrichErr);
        }
      }
      // Re-fetch contacts after enrichment so new contacts appear in the digest
      allContacts = await getAllContacts();
      console.log(`[EmailDigest] Post-enrichment contact count: ${allContacts.length}`);
    }
  } catch (enrichErr) {
    console.warn(`[EmailDigest] Pre-digest enrichment step failed (non-fatal):`, enrichErr);
  }

  // Recipient selection: respects PILOT_MODE and PILOT_ALLOW_LIST env vars
  // Exclude admin users from rep digest — admins receive manager rollup only
  const allUsersRaw = await getEmailRecipients({ digestType: "monday" });
  const allUsers = allUsersRaw.filter(({ user }) => user.role !== "admin");
  console.log(`[EmailDigest] Monday digest: ${allUsers.length} eligible rep recipients (${allUsersRaw.length - allUsers.length} admin(s) excluded) (dryRun=${dryRun})`);

  // ── Cross-rep Must Act deduplication pre-pass ──
  // For each project that would appear in multiple reps' Must Act lists,
  // assign it to the rep with the highest lane score and exclude it from the others.
  // This prevents two reps calling the same contact on the same project.
  //
  // Map: projectId → { userId, score }
  const mustActClaims = new Map<number, { userId: number; score: number }>();
  // Map: userId → Set<projectId> that are claimed by a higher-scoring rep
  const mustActExcludedByRep = new Map<number, Set<number>>();

  try {
    // Pre-score all reps to find Must Act candidates
    for (const { user: preUser, profile: preProfile } of allUsers) {
      if (!preUser || !preProfile) continue;
      const preProjects = await scoreAndFilterProjects(allProjects, {
        territories: preProfile.territories as string[] | null,
        industries: preProfile.industries as string[] | null,
        offerCategories: preProfile.offerCategories as string[] | null,
        customerTypes: preProfile.customerTypes as string[] | null,
        dealSizeMin: preProfile.dealSizeMin,
        dealSizeMax: preProfile.dealSizeMax,
        assignedBusinessLines: preProfile.assignedBusinessLines as string[] | null,
        sectorFocus: (preProfile as any).sectorFocus as string[] | null,
        stageTiming: (preProfile as any).stageTiming as string[] | null,
        buyerRoles: (preProfile as any).buyerRoles as string[] | null,
        keyAccounts: (preProfile as any).keyAccounts as string[] | null,
        salesMotion: (preProfile as any).salesMotion as "direct_only" | "mixed" | null,
        repName: preUser.name || null,
      });
      // Identify this rep's Must Act candidates (action_ready, score > 35, High/Medium lane fit)
      const preMustAct = preProjects.filter(p =>
        p.briefReadiness === "action_ready" &&
        (p.relevanceScore ?? 0) > 35 &&
        (p.laneFitLabel === "High" || p.laneFitLabel === "Medium")
      );
      for (const p of preMustAct) {
        if (!p.id) continue;
        const existing = mustActClaims.get(p.id);
        if (!existing || (p.relevanceScore ?? 0) > existing.score) {
          // This rep has a higher score — claim the project
          if (existing) {
            // Evict the previous claimant
            const prevExcluded = mustActExcludedByRep.get(existing.userId) || new Set<number>();
            prevExcluded.add(p.id);
            mustActExcludedByRep.set(existing.userId, prevExcluded);
          }
          mustActClaims.set(p.id, { userId: preUser.id, score: p.relevanceScore ?? 0 });
        } else {
          // Another rep has a higher score — exclude from this rep
          const excluded = mustActExcludedByRep.get(preUser.id) || new Set<number>();
          excluded.add(p.id);
          mustActExcludedByRep.set(preUser.id, excluded);
        }
      }
    }
    const dedupedCount = mustActClaims.size;
    const conflictCount = Array.from(mustActExcludedByRep.values()).reduce((sum, s) => sum + s.size, 0);
    console.log(`[EmailDigest] Cross-rep Must Act dedup: ${dedupedCount} unique projects claimed, ${conflictCount} cross-rep conflicts resolved`);
  } catch (dedupErr) {
    console.warn(`[EmailDigest] Cross-rep Must Act dedup pre-pass failed (non-fatal — proceeding without dedup):`, dedupErr);
  }

  for (const { user, profile } of allUsers) {
    if (!user || !profile) {
      results.skipped++;
      continue;
    }

    try {
      // ── Per-user deduplication: atomic claim-before-send (replaces check-then-send race) ──
      // claimDigestSendSlot uses INSERT IGNORE — only ONE concurrent goroutine wins the slot.
      // Dry-run and force mode bypass the claim so previews and manual re-sends still work.
      if (!force && !dryRun) {
        const claimed = await claimDigestSendSlot(user.id, "monday", weekKey);
        if (!claimed) {
          results.alreadySent++;
          console.log(`[EmailDigest] ⏭ Monday digest slot already claimed for ${user.name} (${weekKey}), skipping`);
          continue;
        }
      }

      // Get personalized "This Week" data for this specific user
      let thisWeekSection = "";
      try {
        const thisWeekData = await getThisWeekForEmail(user.id);
        const thisWeekUrl = "/";
        thisWeekSection = formatThisWeekSection(
          thisWeekData.top3Projects,
          thisWeekData.top2Stakeholders,
          thisWeekData.urgentAction,
          thisWeekUrl,
        );
      } catch (err) {
        console.warn(`[EmailDigest] Failed to get This Week data for user ${user.id}:`, err);
        thisWeekSection = "";
      }

      // Score projects for this user (with full personalisation profile)
      const matchedProjects = await scoreAndFilterProjects(allProjects, {
        territories: profile.territories as string[] | null,
        industries: profile.industries as string[] | null,
        offerCategories: profile.offerCategories as string[] | null,
        customerTypes: profile.customerTypes as string[] | null,
        dealSizeMin: profile.dealSizeMin,
        dealSizeMax: profile.dealSizeMax,
         assignedBusinessLines: profile.assignedBusinessLines as string[] | null,
        sectorFocus: (profile as any).sectorFocus as string[] | null,
        stageTiming: (profile as any).stageTiming as string[] | null,
        buyerRoles: (profile as any).buyerRoles as string[] | null,
        keyAccounts: (profile as any).keyAccounts as string[] | null,
        salesMotion: (profile as any).salesMotion as "direct_only" | "mixed" | null,
        repName: user.name || null,
      });
      if (matchedProjects.length === 0) {
        results.skipped++;
        console.log(`[EmailDigest] Skipping ${user.name} — no matching projects`);
        if (!force && !dryRun) await finaliseDigestSendSlot(user.id, "monday", weekKey, "failed", { error: "No matching projects after scoring" });
        continue;
      }

      // Get pipeline count
      const pipeline = await getPipelineClaimsByUser(user.id);

      // Get matched contacts (from same projects)
      const matchedProjectNames = new Set(matchedProjects.map(p => p.name));
      const matchedContacts = allContacts.filter(c => matchedProjectNames.has(c.project));

      // Part D: annotate each project with hasNoContacts + briefReadiness
      // Contacts join by project name (not projectId), so use name-based lookup
      const contactProjectNames = new Set(allContacts.map(c => c.project).filter(Boolean));
      const annotatedProjects = matchedProjects.map(p => {
        const hasNoContacts = !contactProjectNames.has(p.name);
        // Find contacts for this project (fuzzy name match)
        const projectContacts: DigestContact[] = matchedContacts
          .filter(c =>
            c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
            p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
          )
          .map(c => ({
            ...c,
            roleRelevance: (c as any).roleRelevance ?? null,
            linkedin: (c as any).linkedinProfileUrl ?? (c as any).linkedin ?? null,
            // Pass trust tier through so classifyBriefReadiness can enforce it
            contactTrustTier: (c as any).contactTrustTier ?? null,
            // Pass source + verificationScore for gate defensibility check
            source: (c as any).source ?? null,
            verificationScore: (c as any).verificationScore ?? null,
          }));
         const { readiness, bestContact } = classifyBriefReadiness(
          { ...p, hasNoContacts },
          projectContacts,
          { isPumpLane: isPumpLaneRep((profile.assignedBusinessLines as string[] | null) || []) },
        );
        return {
          ...p,
          hasNoContacts,
          briefReadiness: readiness,
          bestContact,
        };
      });
      const rawTerritories = (profile.territories as string[]) || [];
      // Resolve NATIONAL → all states via canonical model
      const territories = resolveTerritories(rawTerritories, profile.sectorFocus as string[] | null);

      // ── Territory-Level Send Threshold ──
      // Block the digest for this rep if the territory quality threshold is not met.
      // force=true (admin re-send) and dryRun=true both bypass the threshold so
      // admins can preview and manually override.
      if (!force && !dryRun) {
        const threshold = await checkTerritoryThreshold(annotatedProjects, territories);
        if (!threshold.passes) {
          results.skipped++;
          console.log(
            `[EmailDigest] ⏸ Territory threshold NOT met for ${user.name} (${territories.join("/") || "National"}): ${threshold.reason}`
          );
          // Log the hold so it is visible in the admin dashboard
          await logEmailSendExtended({
            userId: user.id, digestType: "monday", status: "failed",
            weekKey, itemCount: 0, dryRun: false,
            error: `TERRITORY_THRESHOLD_HELD: ${threshold.reason}`,
          });
          // Finalise the pending slot so it doesn't stay orphaned
          await finaliseDigestSendSlot(user.id, "monday", weekKey, "failed", { error: `TERRITORY_THRESHOLD_HELD: ${threshold.reason}` });
          continue;
        }
        console.log(
          `[EmailDigest] ✓ Territory threshold met for ${user.name}: ${threshold.reason}`
        );

        // ── Manual Preview Gate ──
        // The first live digest send for each territory requires a manual preview/review.
        // Even when the territory threshold is met, the digest is held until an admin
        // explicitly approves the first send via the digest preview endpoint.
        // After one approved cycle, autoSendEnabled is set to true and this gate is bypassed.
        const db = await getDb();
        if (db) {
          const primaryTerritory = territories[0] || "National";
          const [sendControl] = await db
            .select()
            .from(digestSendControl)
            .where(eq(digestSendControl.territory, primaryTerritory))
            .limit(1);

          if (!sendControl) {
            // No control record yet — create one and hold the send
            await db.insert(digestSendControl).values({
              territory: primaryTerritory,
              firstSendApproved: false,
              autoSendEnabled: false,
            });
            results.skipped++;
            console.log(
              `[EmailDigest] ⏸ MANUAL PREVIEW GATE: First send for territory "${primaryTerritory}" requires manual preview approval. Run a dry-run preview and approve it before the first live send.`
            );
            await logEmailSendExtended({
              userId: user.id, digestType: "monday", status: "failed",
              weekKey, itemCount: 0, dryRun: false,
              error: `MANUAL_PREVIEW_GATE: First send for territory "${primaryTerritory}" requires manual preview approval via the admin digest preview endpoint.`,
            });
            await finaliseDigestSendSlot(user.id, "monday", weekKey, "failed", { error: `MANUAL_PREVIEW_GATE: ${primaryTerritory}` });
            continue;
          }

          if (!sendControl.autoSendEnabled && !sendControl.firstSendApproved) {
            results.skipped++;
            console.log(
              `[EmailDigest] ⏸ MANUAL PREVIEW GATE: Territory "${primaryTerritory}" has not completed the required preview/review cycle. Approve the digest preview before the first live send.`
            );
            await logEmailSendExtended({
              userId: user.id, digestType: "monday", status: "failed",
              weekKey, itemCount: 0, dryRun: false,
              error: `MANUAL_PREVIEW_GATE: Territory "${primaryTerritory}" awaiting first-send approval. Preview the digest and approve it in the admin dashboard.`,
            });
            await finaliseDigestSendSlot(user.id, "monday", weekKey, "failed", { error: `MANUAL_PREVIEW_GATE: ${primaryTerritory} awaiting approval` });
            continue;
          }

          console.log(
            `[EmailDigest] ✓ Manual preview gate passed for territory "${primaryTerritory}" (autoSend=${sendControl.autoSendEnabled}, firstApproved=${sendControl.firstSendApproved})`
          );
        }
      }

      // ── Rep-Level Hardening Gate (automated SEND/HOLD) ──
      // Runs after territory threshold + manual preview gate, before email generation.
      // Checks: contact defensibility, junk suppression, pool depth, lane fit.
      // HOLD = skip this rep with evidence logged; SEND = proceed to email generation.
      if (!force && !dryRun) {
        try {
          const { runAllGates, checkJunkSuppression, storeGateResult, identifyRescueCandidates } = await import("./digestHardeningGates");
          const { repDigestGateResults } = await import("../drizzle/schema");
          // Determine rep's primary lane from business lines
          const repBLs = (profile.assignedBusinessLines as string[] | null) || [];
          const repLane = repBLs.includes("Pump") || repBLs.includes("Pump (Flow)") || repBLs.includes("Pump (Dewatering)")
            ? "pumps"
            : repBLs.includes("PAL") || repBLs.includes("BESS")
              ? "pal_bess"
              : "portable_air";
          // Extract top 3 Must Act projects (action_ready, sorted by relevanceScore)
          const mustActCandidates = annotatedProjects
            .filter(p => p.briefReadiness === "action_ready" && (p.laneFitLabel === "High" || p.laneFitLabel === "Medium"))
            .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
            .slice(0, 3);
          // Run junk suppression on top 3 (non-mutating check)
          let junkCount = 0;
          for (const p of mustActCandidates) {
            const junk = checkJunkSuppression(
              { name: p.name, overview: (p as any).overview, sector: (p as any).sector, owner: (p as any).owner },
              repLane,
            );
            if (junk.isJunk) junkCount++;
          }
          if (junkCount > 0) {
            console.log(`[EmailDigest] \uD83E\uDDF9 Junk detected: ${junkCount} of top 3 for ${user.name}`);
          }
          // Build gate input with bestContact data
          const gateTop3 = mustActCandidates.map(p => ({
            id: p.id,
            name: p.name,
            overview: (p as any).overview as string | undefined,
            sector: (p as any).sector as string | undefined,
            owner: (p as any).owner as string | undefined,
            laneFitLabel: p.laneFitLabel || "Low",
            relevanceScore: p.relevanceScore,
            contractors: (p as any).contractors as string[] | null,
            bestContact: p.bestContact ? {
              name: p.bestContact.name || "",
              email: p.bestContact.email || null,
              title: (p.bestContact as any).title || null,
              company: (p.bestContact as any).company || null,
              trustTier: (p.bestContact as any).trustTier || null,
              source: (p.bestContact as any).source || null,
              verificationScore: (p.bestContact as any).verificationScore || null,
              isDowngraded: (p.bestContact as any).isDowngraded || false,
              isLlmInferred: (p.bestContact as any).isLlmInferred || false,
            } : null,
          }));
          // Run the full gate
          const gateResult = runAllGates({
            userId: user.id,
            userName: user.name || "Unknown",
            repLane,
            weekKey,
            top3Projects: gateTop3,
          });
          // Store the gate result for operator visibility
          const gateDb = await getDb();
          if (gateDb) {
            await storeGateResult(
              {
                userId: user.id,
                userName: user.name || "Unknown",
                weekKey,
                decision: gateResult.decision,
                blockers: gateResult.blockers,
                top3Snapshot: gateTop3.map(p => ({ id: p.id, name: p.name, score: p.relevanceScore || 0, contactName: p.bestContact?.name })),
                rescueAttempted: false,
                createdAt: new Date().toISOString(),
              },
              gateDb,
              repDigestGateResults,
            );
          }
          let rescueSucceeded = false;
          if (gateResult.decision === "HOLD") {
            // ── AUTOMATIC RESCUE TRIGGER ──
            // Only fires on contact-related blockers for visible-top projects.
            // Respects cooldown (7 days), budget (daily cap - 5 reserve), and max 3 projects per run.
            const hasContactBlockers = gateResult.blockers.some(b =>
              b.criterion === "trust_tier_not_send_ready" || b.criterion === "contact_not_defensible" ||
              b.criterion === "card_detail_inconsistent" || b.criterion === "card_detail_mismatch" ||
              b.criterion === "no_contact" || b.criterion === "insufficient_defensible_contacts"
            );
            let rescueResult: any = null;
            if (hasContactBlockers) {
              try {
                console.log(`[EmailDigest] 🚑 Rescue trigger: attempting contact rescue for ${user.name}...`);
                const { enrichProjectContacts } = await import("./apolloEnrichment");
                const { projectEnrichmentCache, apolloCreditLog } = await import("../drizzle/schema");
                const { sql: sqlFn, gte: gteFn, desc: descFn, eq: eqFn } = await import("drizzle-orm");
                const rescueDb = await getDb();
                if (!rescueDb) throw new Error("No DB for rescue");
                // Get Apollo daily usage
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const [usageRow] = await rescueDb
                  .select({ total: sqlFn<number>`COALESCE(SUM(${apolloCreditLog.creditsUsed}), 0)` })
                  .from(apolloCreditLog)
                  .where(gteFn(apolloCreditLog.createdAt, todayStart));
                const apolloDailyUsed = usageRow?.total ?? 0;
                const APOLLO_DAILY_CAP = 200; // Rescue-specific cap (conservative)
                // Build rescue candidate data from top 5 visible projects
                const top5Visible = annotatedProjects
                  .filter(p => p.briefReadiness === "action_ready" && (p.laneFitLabel === "High" || p.laneFitLabel === "Medium"))
                  .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
                  .slice(0, 5);
                // Get lastEnrichedAt for each project from projectEnrichmentCache
                const rescueCandidateData = await Promise.all(top5Visible.map(async (p) => {
                  const [cacheEntry] = await rescueDb
                    .select({ enrichedAt: projectEnrichmentCache.enrichedAt })
                    .from(projectEnrichmentCache)
                    .where(eqFn(projectEnrichmentCache.projectId, p.id))
                    .orderBy(descFn(projectEnrichmentCache.enrichedAt))
                    .limit(1);
                  // Count send_ready contacts for this project
                  const projectContacts = matchedContacts.filter(c =>
                    c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
                    p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
                  );
                  const sendReadyCount = projectContacts.filter(c => (c as any).contactTrustTier === "send_ready").length;
                  return {
                    id: p.id,
                    name: p.name,
                    relevanceScore: p.relevanceScore ?? 0,
                    laneFitLabel: p.laneFitLabel || "Low",
                    bestContactTrustTier: p.bestContact?.trustTier ?? null,
                    lastEnrichedAt: cacheEntry?.enrichedAt ?? null,
                    contactCount: sendReadyCount,
                  };
                }));
                rescueResult = identifyRescueCandidates(rescueCandidateData, apolloDailyUsed, APOLLO_DAILY_CAP);
                if (rescueResult.triggered && rescueResult.candidates.length > 0) {
                  console.log(`[EmailDigest] 🚑 Rescue: enriching ${rescueResult.candidates.length} projects for ${user.name} (budget remaining: ${rescueResult.budgetRemaining})`);
                  for (const candidate of rescueResult.candidates) {
                    try {
                      await enrichProjectContacts(candidate.projectId, report.id, { enrichEmails: true, maxPerCompany: 3 });
                      console.log(`[EmailDigest] 🚑 Rescue enriched: ${candidate.projectName} (id=${candidate.projectId})`);
                    } catch (enrichErr) {
                      console.warn(`[EmailDigest] 🚑 Rescue enrichment failed for ${candidate.projectName}:`, enrichErr);
                    }
                  }
                  // Re-fetch contacts after rescue enrichment
                  allContacts = await getAllContacts();
                  // Re-annotate projects with fresh contact data
                  const freshMatchedContacts = allContacts.filter(c => matchedProjectNames.has(c.project));
                  const freshContactProjectNames = new Set(allContacts.map(c => c.project).filter(Boolean));
                  const freshAnnotatedProjects = matchedProjects.map(p => {
                    const hasNoContacts = !freshContactProjectNames.has(p.name);
                    const projectContacts: DigestContact[] = freshMatchedContacts
                      .filter(c =>
                        c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
                        p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
                      )
                      .map(c => ({
                        ...c,
                        roleRelevance: (c as any).roleRelevance ?? null,
                        linkedin: (c as any).linkedinProfileUrl ?? (c as any).linkedin ?? null,
                        contactTrustTier: (c as any).contactTrustTier ?? null,
                        source: (c as any).source ?? null,
                        verificationScore: (c as any).verificationScore ?? null,
                      }));
                    const { readiness, bestContact: freshBestContact } = classifyBriefReadiness(
                      { ...p, hasNoContacts },
                      projectContacts,
                      { isPumpLane: isPumpLaneRep((profile.assignedBusinessLines as string[] | null) || []) },
                    );
                    return { ...p, hasNoContacts, briefReadiness: readiness, bestContact: freshBestContact };
                  });
                  // Re-build gate top 3 with fresh data
                  const freshMustAct = freshAnnotatedProjects
                    .filter(p => p.briefReadiness === "action_ready" && (p.laneFitLabel === "High" || p.laneFitLabel === "Medium"))
                    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
                    .slice(0, 3);
                  const freshGateTop3 = freshMustAct.map(p => ({
                    id: p.id,
                    name: p.name,
                    overview: (p as any).overview as string | undefined,
                    sector: (p as any).sector as string | undefined,
                    owner: (p as any).owner as string | undefined,
                    laneFitLabel: p.laneFitLabel || "Low",
                    relevanceScore: p.relevanceScore,
                    contractors: (p as any).contractors as string[] | null,
                    bestContact: p.bestContact ? {
                      name: p.bestContact.name || "",
                      email: p.bestContact.email || null,
                      title: (p.bestContact as any).title || null,
                      company: (p.bestContact as any).company || null,
                      trustTier: (p.bestContact as any).trustTier || null,
                      source: (p.bestContact as any).source || null,
                      verificationScore: (p.bestContact as any).verificationScore || null,
                      isDowngraded: (p.bestContact as any).isDowngraded || false,
                      isLlmInferred: (p.bestContact as any).isLlmInferred || false,
                    } : null,
                  }));
                  // Re-run the gate with fresh data
                  const retryGateResult = runAllGates({
                    userId: user.id,
                    userName: user.name || "Unknown",
                    repLane,
                    weekKey,
                    top3Projects: freshGateTop3,
                  });
                  // Store the rescue result
                  if (gateDb) {
                    await storeGateResult(
                      {
                        userId: user.id,
                        userName: user.name || "Unknown",
                        weekKey,
                        decision: retryGateResult.decision,
                        blockers: retryGateResult.blockers,
                        top3Snapshot: freshGateTop3.map(p => ({ id: p.id, name: p.name, score: p.relevanceScore || 0, contactName: p.bestContact?.name })),
                        rescueAttempted: true,
                        rescueResult,
                        createdAt: new Date().toISOString(),
                      },
                      gateDb,
                      repDigestGateResults,
                    );
                  }
                  if (retryGateResult.decision === "SEND") {
                    rescueSucceeded = true;
                    // Update annotatedProjects in the outer scope for email generation
                    // Replace with fresh data so the email uses rescued contacts
                    annotatedProjects.length = 0;
                    freshAnnotatedProjects.forEach(p => annotatedProjects.push(p as any));
                    console.log(`[EmailDigest] 🚑 Rescue SUCCESS: ${user.name} upgraded from HOLD → SEND after enriching ${rescueResult.candidates.length} projects`);
                  } else {
                    // ── LUSHA STAGE 4 FALLBACK ──
                    // Apollo rescue failed. Try Lusha for top visible, high-fit, commercially sensible projects.
                    // Only fires if remaining blockers are contact-related (not lane-fit/junk).
                    const retryContactBlockers = retryGateResult.blockers.some(b =>
                      b.criterion === "trust_tier_not_send_ready" || b.criterion === "contact_not_defensible" ||
                      b.criterion === "insufficient_defensible_contacts" || b.criterion === "no_contact"
                    );
                    if (retryContactBlockers) {
                      try {
                        const { lushaRescueForRep } = await import("./lushaEnrichment");
                        // Only pass commercially sensible projects (High/Medium fit)
                        const lushaCandidates = freshGateTop3
                          .filter(p => p.laneFitLabel === "High" || p.laneFitLabel === "Medium")
                          .map(p => ({
                            projectId: p.id,
                            projectName: p.name,
                            laneFitLabel: p.laneFitLabel,
                            relevanceScore: p.relevanceScore ?? 0,
                          }));
                        if (lushaCandidates.length > 0) {
                          console.log(`[EmailDigest] 🔮 Lusha Stage 4: attempting for ${user.name} (${lushaCandidates.length} candidates)`);
                          const lushaResult = await lushaRescueForRep(lushaCandidates);
                          if (lushaResult.totalPromoted > 0) {
                            // Re-fetch and re-gate one more time
                            allContacts = await getAllContacts();
                            const lushaFreshMatched = allContacts.filter(c => matchedProjectNames.has(c.project));
                            const lushaFreshContactNames = new Set(allContacts.map(c => c.project).filter(Boolean));
                            const lushaFreshAnnotated = matchedProjects.map(p => {
                              const hasNoContacts = !lushaFreshContactNames.has(p.name);
                              const pContacts: DigestContact[] = lushaFreshMatched
                                .filter(c =>
                                  c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
                                  p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
                                )
                                .map(c => ({
                                  ...c,
                                  roleRelevance: (c as any).roleRelevance ?? null,
                                  linkedin: (c as any).linkedinProfileUrl ?? (c as any).linkedin ?? null,
                                  contactTrustTier: (c as any).contactTrustTier ?? null,
                                  source: (c as any).source ?? null,
                                  verificationScore: (c as any).verificationScore ?? null,
                                }));
                              const { readiness, bestContact: bc } = classifyBriefReadiness({ ...p, hasNoContacts }, pContacts, { isPumpLane: isPumpLaneRep((profile.assignedBusinessLines as string[] | null) || []) });
                              return { ...p, hasNoContacts, briefReadiness: readiness, bestContact: bc };
                            });
                            const lushaTop3 = lushaFreshAnnotated
                              .filter(p => p.briefReadiness === "action_ready" && (p.laneFitLabel === "High" || p.laneFitLabel === "Medium"))
                              .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
                              .slice(0, 3)
                              .map(p => ({
                                id: p.id, name: p.name,
                                overview: (p as any).overview as string | undefined,
                                sector: (p as any).sector as string | undefined,
                                owner: (p as any).owner as string | undefined,
                                laneFitLabel: p.laneFitLabel || "Low",
                                relevanceScore: p.relevanceScore,
                                contractors: (p as any).contractors as string[] | null,
                                bestContact: p.bestContact ? {
                                  name: p.bestContact.name || "",
                                  email: p.bestContact.email || null,
                                  title: (p.bestContact as any).title || null,
                                  company: (p.bestContact as any).company || null,
                                  trustTier: (p.bestContact as any).trustTier || null,
                                  source: (p.bestContact as any).source || null,
                                  verificationScore: (p.bestContact as any).verificationScore || null,
                                  isDowngraded: (p.bestContact as any).isDowngraded || false,
                                  isLlmInferred: (p.bestContact as any).isLlmInferred || false,
                                } : null,
                              }));
                            const lushaGateResult = runAllGates({
                              userId: user.id, userName: user.name || "Unknown",
                              repLane, weekKey, top3Projects: lushaTop3,
                            });
                            if (lushaGateResult.decision === "SEND") {
                              rescueSucceeded = true;
                              annotatedProjects.length = 0;
                              lushaFreshAnnotated.forEach(p => annotatedProjects.push(p as any));
                              console.log(`[EmailDigest] 🔮 Lusha Stage 4 SUCCESS: ${user.name} upgraded HOLD → SEND (${lushaResult.totalPromoted} contacts promoted)`);
                            } else {
                              console.warn(`[EmailDigest] 🔮 Lusha Stage 4 FAILED: ${user.name} still HELD. Blockers: ${lushaGateResult.blockers.map(b => b.criterion).join(", ")}`);
                            }
                            // Store Lusha gate result
                            if (gateDb) {
                              await storeGateResult({
                                userId: user.id, userName: user.name || "Unknown", weekKey,
                                decision: lushaGateResult.decision,
                                blockers: lushaGateResult.blockers,
                                top3Snapshot: lushaTop3.map(p => ({ id: p.id, name: p.name, score: p.relevanceScore || 0, contactName: p.bestContact?.name })),
                                rescueAttempted: true,
                                rescueResult: { ...rescueResult, lushaStage4: lushaResult },
                                createdAt: new Date().toISOString(),
                              }, gateDb, repDigestGateResults);
                            }
                          } else {
                            console.log(`[EmailDigest] 🔮 Lusha Stage 4: no contacts promoted for ${user.name}`);
                          }
                        }
                      } catch (lushaErr) {
                        console.warn(`[EmailDigest] 🔮 Lusha Stage 4 error for ${user.name} (non-fatal):`, lushaErr);
                      }
                    }
                    if (!rescueSucceeded) {
                      console.warn(`[EmailDigest] 🚑 Rescue FAILED: ${user.name} still HELD after Apollo+Lusha. Remaining blockers: ${retryGateResult.blockers.map(b => b.criterion).join(", ")}`);
                    }
                  }
                } else {
                  console.log(`[EmailDigest] 🚑 Rescue not triggered for ${user.name}: ${rescueResult.candidates.length} candidates, budget=${rescueResult.budgetRemaining}, cooldown=${rescueResult.cooldownBlocked}`);
                  // Store the non-triggered rescue attempt
                  if (gateDb) {
                    await storeGateResult(
                      {
                        userId: user.id,
                        userName: user.name || "Unknown",
                        weekKey,
                        decision: "HOLD",
                        blockers: gateResult.blockers,
                        top3Snapshot: gateTop3.map(p => ({ id: p.id, name: p.name, score: p.relevanceScore || 0, contactName: p.bestContact?.name })),
                        rescueAttempted: true,
                        rescueResult,
                        createdAt: new Date().toISOString(),
                      },
                      gateDb,
                      repDigestGateResults,
                    );
                  }
                }
              } catch (rescueErr) {
                console.warn(`[EmailDigest] 🚑 Rescue error for ${user.name} (non-fatal):`, rescueErr);
              }
            }
            // If rescue didn't succeed, hold the digest
            if (!rescueSucceeded) {
              results.skipped++;
              console.warn(
                `[EmailDigest] \uD83D\uDEAB REP HARDENING GATE: ${user.name} HELD${hasContactBlockers ? " (rescue attempted)" : ""}. Blockers: ${gateResult.blockers.map(b => b.criterion).join(", ")}`
              );
              await logEmailSendExtended({
                userId: user.id, digestType: "monday", status: "failed",
                weekKey, itemCount: 0, dryRun: false,
                error: `REP_HARDENING_GATE_HELD: ${gateResult.blockers.map(b => `${b.criterion}: ${b.detail}`).join("; ")}${rescueResult ? ` | rescue: ${rescueResult.candidates.length} candidates, triggered=${rescueResult.triggered}` : ""}`,
              });
              await finaliseDigestSendSlot(user.id, "monday", weekKey, "failed", {
                error: `REP_HARDENING_GATE: ${gateResult.blockers.map(b => b.criterion).join(", ")}`,
              });
              continue;
            }
          }
          console.log(`[EmailDigest] \u2713 Rep hardening gate PASSED for ${user.name} (decision=SEND${rescueSucceeded ? ", after rescue" : ""})`);
          // If rescue succeeded, we already stored the gate result above
          // The annotatedProjects have been updated with fresh contact data
        } catch (gateErr) {
          // Gate failure is non-fatal — proceed with send but log the error
          console.warn(`[EmailDigest] \u26A0 Rep hardening gate error for ${user.name} (non-fatal, proceeding):`, gateErr);
        }
      }
      // Generate the personalized Monday digest
      const content = generateMondayDigest(
        user.name || "Team Member",
        report.weekEnding,
        annotatedProjects,
        matchedContacts.map(c => ({
          name: c.name,
          title: c.title,
          company: c.company,
          project: c.project,
          priority: c.priority,
          email: c.email,
        })),
        pipeline.length,
        thisWeekSection,
        territories,
        freshnessLine,
        weekKey,
        user.id,
        mustActExcludedByRep.get(user.id), // cross-rep dedup exclusion set
        (profile.assignedBusinessLines as string[] | null) || [],
      );

      // ── PT Capital Sales subject line (clean — no BL label in subject) ──
      const territoryLabel = territories.length > 0 ? territories.join("/") : "National";
      const staleWarning = (results as any).__staleWarning as string | undefined;
      const subject = staleWarning
        ? `[STALE DATA] PT Capital Sales — Weekly Intelligence Brief | ${territoryLabel} — ${report.weekEnding}`
        : `PT Capital Sales — Weekly Intelligence Brief | ${territoryLabel} — ${report.weekEnding}`;

      // ── Dry-run: log preview without sending ──
      if (dryRun) {
        results.previews!.push({ userId: user.id, subject, contentLength: content.length, contentSnippet: content.slice(0, 6000) });
        await logEmailSendExtended({
          userId: user.id, digestType: "monday", status: "dry_run",
          weekKey, itemCount: annotatedProjects.length, dryRun: true,
        });
        console.log(`[EmailDigest] 🔍 DRY-RUN Monday digest for ${user.name}: "${subject}" (${content.length} chars)`);
        continue;
      }

      // Send directly to user's email via Resend
      const userEmail = user.email;
      if (!userEmail) {
        console.warn(`[EmailDigest] No email for user ${user.name}, skipping`);
        results.skipped++;
        if (!force && !dryRun) await finaliseDigestSendSlot(user.id, "monday", weekKey, "failed", { error: "No email address configured" });
        continue;
      }

      // ── Build clean HTML email using benchmark template ──
      const emailSignals = buildEmailSignals(annotatedProjects, territories);
      const actionReadyCount = emailSignals.filter(s => s.badge === "action_ready").length;
      const discoveryCount = emailSignals.filter(s => s.badge === "discovery_needed").length;
      const summaryParts: string[] = [];
      if (actionReadyCount > 0) summaryParts.push(`${actionReadyCount} action-ready opportunit${actionReadyCount === 1 ? "y" : "ies"}`);
      if (discoveryCount > 0) summaryParts.push(`${discoveryCount} need${discoveryCount === 1 ? "s" : ""} contact discovery`);
      const summaryLine = summaryParts.length > 0
        ? `${summaryParts.join(" and ")} this week.`
        : "Here's your weekly intelligence update.";

      const emailData: DigestEmailData = {
        userName: (user.name || "Team Member").split(" ")[0],
        territory: territoryLabel,
        weekLabel: report.weekEnding,
        summaryLine,
        signals: emailSignals,
        dashboardUrl: getSiteUrl(),
      };
      const htmlContent = buildDigestEmailHtml(emailData);
      const textContent = buildDigestEmailText(emailData);

      const sent = await sendEmail({
        to: userEmail,
        subject,
        markdownContent: content,
        htmlContent,
        textContent,
      });

      if (sent) {
        results.sent++;
        // Finalise the pre-claimed slot from 'pending' → 'sent'
        await finaliseDigestSendSlot(user.id, "monday", weekKey, "sent", { itemCount: annotatedProjects.length });
        console.log(`[EmailDigest] ✓ Monday digest sent for ${user.name} (${territories.join(", ")})`);
      } else {
        results.failed++;
        await finaliseDigestSendSlot(user.id, "monday", weekKey, "failed", { error: "sendEmail returned false" });
        console.warn(`[EmailDigest] ✗ Failed to send Monday digest for ${user.name}`);
      }
    } catch (error) {
      console.error(`[EmailDigest] Failed for user ${user.id}:`, error);
      results.failed++;
      // Wrap finalise in its own try/catch — a DB timeout here must not leave
      // the row permanently pending (which blocks all future re-sends for this user).
      if (user?.id) {
        try {
          await finaliseDigestSendSlot(user.id, "monday", weekKey, "failed", { error: String(error) });
        } catch (finaliseErr) {
          console.error(`[EmailDigest] CRITICAL: finaliseDigestSendSlot also failed for user ${user.id} — row may be stuck pending:`, finaliseErr);
        }
      }
    }
  }

  return results;
}

/**
 * Send compulsory personalized Thursday mid-week reminders to ALL users with profiles.
 * Lighter than Monday — focuses on urgent actions, hot projects, and pipeline nudges.
 *
 * @param force - Skip dedup guard and re-send even if already sent this week
 * @param dryRun - Generate content but do NOT send; logs with dryRun=true
 */
export async function sendThursdayReminders(force = false, dryRun = false): Promise<{
  sent: number;
  failed: number;
  skipped: number;
  alreadySent: number;
  previews?: Array<{ userId: number; subject: string; contentLength: number; contentSnippet?: string }>;
}> {
  const results: {
    sent: number; failed: number; skipped: number; alreadySent: number;
    previews?: Array<{ userId: number; subject: string; contentLength: number; contentSnippet?: string }>;
  } = { sent: 0, failed: 0, skipped: 0, alreadySent: 0 };
  if (dryRun) results.previews = [];

  // Kill switch: skip all email sending when disabled (dry-run bypasses this)
  if (!dryRun && process.env.EMAIL_DIGESTS_ENABLED !== "true") {
    console.log("[EmailDigest] ⚠ Email digests DISABLED (EMAIL_DIGESTS_ENABLED != true). Skipping Thursday reminder.");
    return results;
  }

  const weekKey = getDigestWeekKey();

  // Get the latest report
  const report = await getLatestReport();
  if (!report) {
    console.warn("[EmailDigest] No report found, skipping Thursday reminder");
    return results;
  }

  // Get freshness line
  const latestRun = await getLatestPipelineRun();
  const freshnessLine = latestRun?.completedAt
    ? `Data last refreshed: ${new Date(latestRun.completedAt).toUTCString().slice(0, 16)} UTC`
    : `Data as of: ${report.weekEnding}`;

  // Get all active, non-suppressed projects (not filtered by reportId — see sendWeeklyDigests comment)
  const allProjects = await getActiveProjects();

  // Recipient selection: respects PILOT_MODE and PILOT_ALLOW_LIST env vars
  // Exclude admin users from rep Thursday reminder — admins receive manager rollup only
  const allUsersRaw = await getEmailRecipients({ digestType: "thursday" });
  const allUsers = allUsersRaw.filter(({ user }) => user.role !== "admin");
  console.log(`[EmailDigest] Thursday reminder: ${allUsers.length} eligible rep recipients (${allUsersRaw.length - allUsers.length} admin(s) excluded) (dryRun=${dryRun})`);

  for (const { user, profile } of allUsers) {
    if (!user || !profile) {
      results.skipped++;
      continue;
    }

    try {
      // ── Per-user deduplication: atomic claim-before-send ──
      if (!force && !dryRun) {
        const claimed = await claimDigestSendSlot(user.id, "thursday", weekKey);
        if (!claimed) {
          results.alreadySent++;
          console.log(`[EmailDigest] ⏭ Thursday reminder slot already claimed for ${user.name} (${weekKey}), skipping`);
          continue;
        }
      }

      // Get personalized "This Week" data for this specific user
      let thisWeekSection = "";
      try {
        const thisWeekData = await getThisWeekForEmail(user.id);
        const thisWeekUrl = "/";
        thisWeekSection = formatThisWeekSection(
          thisWeekData.top3Projects,
          thisWeekData.top2Stakeholders,
          thisWeekData.urgentAction,
          thisWeekUrl,
        );
      } catch (err) {
        console.warn(`[EmailDigest] Failed to get This Week data for user ${user.id}:`, err);
        thisWeekSection = "";
      }

      // Score projects for this user — only hot/actionable (with BL personalization)
      const matchedProjects = await scoreAndFilterProjects(allProjects, {
        territories: profile.territories as string[] | null,
        industries: profile.industries as string[] | null,
        offerCategories: profile.offerCategories as string[] | null,
        customerTypes: profile.customerTypes as string[] | null,
        dealSizeMin: profile.dealSizeMin,
        dealSizeMax: profile.dealSizeMax,
         assignedBusinessLines: profile.assignedBusinessLines as string[] | null,
        salesMotion: (profile as any).salesMotion as "direct_only" | "mixed" | null,
        repName: user.name || null,
      });
      const hotProjects = matchedProjects.filter(p =>
        p.priority === "hot" || p.actionTier === "tier1_actionable"
      );

      // Get pipeline count
      const pipeline = await getPipelineClaimsByUser(user.id);

      const territories = resolveTerritories(profile.territories as string[] | null, profile.sectorFocus as string[] | null);

      // Generate the personalized Thursday reminder
      const contentWithFreshness = generateThursdayReminder(
        user.name || "Team Member",
        report.weekEnding,
        hotProjects,
        pipeline.length,
        thisWeekSection,
        territories,
        freshnessLine,
        weekKey,
        user.id,
      );

      // Send directly to user's email via Resend
      const userEmail = user.email;
      if (!userEmail) {
        console.warn(`[EmailDigest] No email for user ${user.name}, skipping Thursday reminder`);
        results.skipped++;
        if (!force && !dryRun) await finaliseDigestSendSlot(user.id, "thursday", weekKey, "failed", { error: "No email address configured" });
        continue;
      }

      // ── PT Capital Sales subject line (clean — no BL label in subject) ──
      const territoryLabel = territories.length > 0 ? territories.join("/") : "National";
      const subject = `PT Capital Sales — Mid-Week Action Reminder | ${territoryLabel} — ${report.weekEnding}`;

      // ── Dry-run: log preview without sending ──
      if (dryRun) {
        results.previews!.push({ userId: user.id, subject, contentLength: contentWithFreshness.length, contentSnippet: contentWithFreshness.slice(0, 6000) });
        await logEmailSendExtended({
          userId: user.id, digestType: "thursday", status: "dry_run",
          weekKey, itemCount: hotProjects.length, dryRun: true,
        });
        console.log(`[EmailDigest] 🔍 DRY-RUN Thursday reminder for ${user.name}: "${subject}"`);
        continue;
      }

       // ── Build clean HTML email using benchmark template for Thursday ──
      const thursdaySignals = buildEmailSignals(hotProjects, territories);
      const thursSummaryLine = hotProjects.length > 0
        ? `${hotProjects.length} hot opportunit${hotProjects.length === 1 ? "y" : "ies"} need${hotProjects.length === 1 ? "s" : ""} your attention this week.`
        : "Quick mid-week check-in on your territory.";
      const thursEmailData: DigestEmailData = {
        userName: (user.name || "Team Member").split(" ")[0],
        territory: territoryLabel,
        weekLabel: report.weekEnding,
        summaryLine: thursSummaryLine,
        signals: thursdaySignals,
        dashboardUrl: getSiteUrl(),
      };
      const thursHtmlContent = buildDigestEmailHtml(thursEmailData);
      const thursTextContent = buildDigestEmailText(thursEmailData);

      const sent = await sendEmail({
        to: userEmail,
        subject,
        markdownContent: contentWithFreshness,
        htmlContent: thursHtmlContent,
        textContent: thursTextContent,
      });
      if (sent) {
        results.sent++;
        await finaliseDigestSendSlot(user.id, "thursday", weekKey, "sent", { itemCount: hotProjects.length });
        console.log(`[EmailDigest] ✓ Thursday reminder sent for ${user.name} (${territories.join(", ")})`);
      } else {
        results.failed++;
        await finaliseDigestSendSlot(user.id, "thursday", weekKey, "failed", { error: "sendEmail returned false" });
        console.warn(`[EmailDigest] ✗ Failed to send Thursday reminder for ${user.name}`);
      }
    } catch (error) {
      console.error(`[EmailDigest] Thursday reminder failed for user ${user.id}:`, error);
      results.failed++;
      // Wrap finalise in its own try/catch — a DB timeout here must not leave
      // the row permanently pending (which blocks all future re-sends for this user).
      if (user?.id) {
        try {
          await finaliseDigestSendSlot(user.id, "thursday", weekKey, "failed", { error: String(error) });
        } catch (finaliseErr) {
          console.error(`[EmailDigest] CRITICAL: finaliseDigestSendSlot also failed for user ${user.id} — row may be stuck pending:`, finaliseErr);
        }
      }
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manager Rollup Email (Thursday, admin users only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the HTML/Markdown content for the manager rollup email.
 * Shows per-rep action counts, lane breakdown, and any projects still at not_started.
 */
function generateManagerRollupEmail(
  rollup: Awaited<ReturnType<typeof getManagerRollup>>,
  weekEnding: string,
  freshnessLine: string,
): string {
  const OUTCOME_LABELS: Record<string, string> = {
    contacted: "Contacted",
    meeting_booked: "Meeting Booked",
    proposal_sent: "Proposal Sent",
    won: "Won",
    lost: "Lost",
    deferred: "Deferred",
    not_relevant: "Not Relevant",
    already_active: "Already Active",
    contact_discovery_needed: "Contact Discovery Needed",
    not_started: "Not Started",
  };

  let content = `# PT Capital Sales — Manager Rollup — Week of ${weekEnding}\n\n`;
  content += `_${freshnessLine}_\n\n`;
  content += `**Total actions logged this week:** ${rollup.totalActions}\n\n`;

  // ── Early return for empty rollup — still send so manager knows the system ran ──
  if (rollup.totalActions === 0) {
    content += `_No rep actions have been logged this week yet. Reps can log outcomes from the Action Tracker on the dashboard._\n\n`;
    content += `**Next steps for manager:**\n`;
    content += `- Check that reps have received and opened their Monday brief\n`;
    content += `- Remind reps to log outcomes using the action tracker on each project card\n`;
    content += `- Review the [dashboard](${getSiteUrl()}/this-week) for this week's priority projects\n`;
    return content;
  }

  // ── Outcome summary ──
  if (Object.keys(rollup.byOutcome).length > 0) {
    content += `## Outcome Summary\n\n`;
    content += `| Outcome | Count |\n|---|---|\n`;
    for (const [outcome, count] of Object.entries(rollup.byOutcome).sort((a, b) => b[1] - a[1])) {
      content += `| ${OUTCOME_LABELS[outcome] ?? outcome} | ${count} |\n`;
    }
    content += `\n`;
  }

  // ── Per-rep breakdown ──
  if (rollup.byRep.length > 0) {
    content += `## Rep Activity\n\n`;
    content += `| Rep | Total Actions | Top Outcome |\n|---|---|---|\n`;
    for (const rep of rollup.byRep.sort((a, b) => b.count - a.count)) {
      const topOutcome = Object.entries(rep.byOutcome).sort((a, b) => b[1] - a[1])[0];
      const topLabel = topOutcome ? `${OUTCOME_LABELS[topOutcome[0]] ?? topOutcome[0]} (${topOutcome[1]})` : "—";
      content += `| ${rep.userName ?? `User #${rep.userId}`} | ${rep.count} | ${topLabel} |\n`;
    }
    content += `\n`;
  } else {
    content += `_No rep actions logged this week._\n\n`;
  }

  // ── Lane breakdown ──
  if (Object.keys(rollup.byLane).length > 0) {
    content += `## Lane Breakdown\n\n`;
    content += `| Lane | Actions |\n|---|---|\n`;
    for (const [lane, count] of Object.entries(rollup.byLane).sort((a, b) => b[1] - a[1])) {
      content += `| ${lane} | ${count} |\n`;
    }
    content += `\n`;
  }

  content += `---\n_${freshnessLine}_\n`;
  content += `\n[View dashboard →](${getSiteUrl()}/this-week)\n`;
  return content;
}

/**
 * Send the Thursday manager rollup email to all admin users.
 * Separate from the rep Thursday reminder — admins get the rollup view.
 *
 * @param force - Skip dedup guard
 * @param dryRun - Generate content but do NOT send
 */
export async function sendManagerRollupEmail(force = false, dryRun = false): Promise<{
  sent: number;
  failed: number;
  skipped: number;
  alreadySent: number;
  previews?: Array<{ userId: number; subject: string; contentLength: number }>;
}> {
  const results: {
    sent: number; failed: number; skipped: number; alreadySent: number;
    previews?: Array<{ userId: number; subject: string; contentLength: number }>;
  } = { sent: 0, failed: 0, skipped: 0, alreadySent: 0 };
  if (dryRun) results.previews = [];

  if (!dryRun && process.env.EMAIL_DIGESTS_ENABLED !== "true") {
    console.log("[EmailDigest] ⚠ Email digests DISABLED. Skipping manager rollup.");
    return results;
  }

  const weekKey = getDigestWeekKey();

  // Get the latest report for weekEnding label
  const report = await getLatestReport();
  if (!report) {
    console.warn("[EmailDigest] No report found, skipping manager rollup");
    return results;
  }

  // Get freshness line
  const latestRun = await getLatestPipelineRun();
  const freshnessLine = latestRun?.completedAt
    ? `Data last refreshed: ${new Date(latestRun.completedAt).toUTCString().slice(0, 16)} UTC`
    : `Data as of: ${report.weekEnding}`;

  // Get rollup data
  const rollup = await getManagerRollup(weekKey);

  // Get manager rollup recipients: use configurable table first, fall back to role='admin'
  const { users: usersTable, managerRollupRecipients: rollupRecipientsTable } = await import("../drizzle/schema");
  const { eq: eqOp, inArray } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) {
    console.warn("[EmailDigest] No DB for manager rollup");
    return results;
  }
  // Check configurable recipient list
  const configuredRows = await db.select().from(rollupRecipientsTable);
  let admins;
  if (configuredRows.length > 0) {
    const userIds = configuredRows.map(r => r.userId);
    admins = await db.select().from(usersTable).where(inArray(usersTable.id, userIds));
    console.log(`[EmailDigest] Manager rollup: ${admins.length} configured recipients (dryRun=${dryRun})`);
  } else {
    // Fallback: all admin-role users
    admins = await db.select().from(usersTable).where(eqOp(usersTable.role, "admin"));
    console.log(`[EmailDigest] Manager rollup: ${admins.length} admin-role recipients (fallback, dryRun=${dryRun})`);
  }

  const content = generateManagerRollupEmail(rollup, report.weekEnding, freshnessLine);
  const subject = `PT Capital Sales — Manager Rollup — Week of ${report.weekEnding}`;

  for (const admin of admins) {
    if (!admin.email) {
      results.skipped++;
      continue;
    }

    try {
      if (!force && !dryRun) {
        const claimed = await claimDigestSendSlot(admin.id, "manager_rollup", weekKey);
        if (!claimed) {
          results.alreadySent++;
          continue;
        }
      }

      if (dryRun) {
        results.previews!.push({ userId: admin.id, subject, contentLength: content.length });
        await logEmailSendExtended({
          userId: admin.id, digestType: "manager_rollup", status: "dry_run",
          weekKey, itemCount: rollup.totalActions, dryRun: true,
        });
        console.log(`[EmailDigest] 🔍 DRY-RUN Manager rollup for ${admin.name}: "${subject}"`);
        continue;
      }

      const sent = await sendEmail({
        to: admin.email,
        subject,
        markdownContent: content,
        textContent: content,
      });

      if (sent) {
        results.sent++;
        await finaliseDigestSendSlot(admin.id, "manager_rollup", weekKey, "sent", { itemCount: rollup.totalActions });
        console.log(`[EmailDigest] ✓ Manager rollup sent to ${admin.name}`);
      } else {
        results.failed++;
        await finaliseDigestSendSlot(admin.id, "manager_rollup", weekKey, "failed", { error: "sendEmail returned false" });
      }
    } catch (error) {
      console.error(`[EmailDigest] Manager rollup failed for admin ${admin.id}:`, error);
      results.failed++;
      await finaliseDigestSendSlot(admin.id, "manager_rollup", weekKey, "failed", { error: String(error) });
    }
  }

  return results;
}

// ── Per-user preview helpers (dry-run only, used by Admin Email Preview UI) ──

/**
 * Send the Monday digest to a single specific user.
 *
 * FRESHNESS GATE: By default this function respects the same 26h freshness
 * window as the batch send. Pass `forceOverride=true` only when an admin
 * explicitly acknowledges they are sending with potentially stale data.
 *
 * @param userId - Target recipient
 * @param forceOverride - When true, bypasses freshness gate AND dedup guard.
 *   Must be explicit — callers cannot accidentally bypass the gate.
 *   Logged to console with FORCE_OVERRIDE marker for audit trail.
 */
export async function sendWeeklyDigestToUser(userId: number, forceOverride = false): Promise<{
  sent: boolean;
  subject: string;
  userName: string;
  freshnessBlocked?: boolean;
  error?: string;
} | null> {
  // ── Freshness Gate (mirrors sendWeeklyDigests) ──
  // forceOverride must be explicitly true — default is false (safe).
  if (!forceOverride) {
    const freshness = await checkPipelineFreshness(36);
    const isBlocked = freshness.status === "stale" || freshness.status === "failed" || freshness.status === "never_run";
    if (isBlocked) {
      console.warn(
        `[EmailDigest] 🚫 FRESHNESS GATE: sendWeeklyDigestToUser(${userId}) BLOCKED.` +
        ` Pipeline status: ${freshness.status}. Reason: ${freshness.blockedReason}.` +
        ` Use forceOverride=true to send with stale data (will be logged).`
      );
      return { sent: false, subject: "", userName: "", freshnessBlocked: true, error: `Freshness gate: ${freshness.blockedReason}` };
    }
  } else {
    // Audit log: any force override must be visible in logs
    const freshness = await checkPipelineFreshness(36);
    console.warn(
      `[EmailDigest] ⚠ FORCE_OVERRIDE: sendWeeklyDigestToUser(${userId}) bypassing freshness gate.` +
      ` Pipeline status: ${freshness.status} (${freshness.ageHours}h old). This will be sent with stale data.`
    );
  }

  const preview = await sendWeeklyDigestsForUser(userId);
  if (!preview) return null;

  try {
    const db = await getDb();
    if (!db) return null;
    const { users: usersTable } = await import("../drizzle/schema");
    const { eq: eqOp } = await import("drizzle-orm");
    const [user] = await db.select().from(usersTable).where(eqOp(usersTable.id, userId));
    if (!user) return null;

    const userEmail = user.email || (user as any).oauthEmail;
    if (!userEmail) return { sent: false, subject: preview.subject, userName: preview.userName, error: "No email address" };

    // Build the same HTML + text content as the scheduled batch send
    const { buildDigestEmailHtml: _buildHtml, buildDigestEmailText: _buildText } = await import("./emailTemplate");
    const { buildEmailSignals: _buildSignals } = await import("./emailDigest");
    // Re-use sendWeeklyDigestsForUser data — but we need emailSignals, so call buildEmailSignals
    // directly from the preview data. Since sendWeeklyDigestsForUser only returns markdown,
    // we call the helper functions inline here to produce the styled HTML.
    // Note: preview.content is the markdown version (used as fallback only).
    // For the styled HTML we need to rebuild emailData — use the same pipeline as the batch.
    let htmlContent: string | undefined;
    let textContent: string | undefined;
    try {
      const { sendWeeklyDigestsForUser: _previewFn } = await import("./emailDigest");
      // Build email signals by re-running the annotation pipeline for this user
      const { getActiveProjects: _getProjects, getAllContacts: _getContacts, getLatestReport: _getReport, getPipelineClaimsByUser: _getPipeline, getDb: _getDb, getLatestPipelineRun: _getRun } = await import("./db");
      const { scoreAndFilterProjects: _score } = await import("./emailDigest");
      const { resolveTerritories: _resolveTerr } = await import("./canonicalMappings");
      const { classifyBriefReadiness: _classify } = await import("./emailDigest");
      const { users: _usersT, userProfiles: _profilesT } = await import("../drizzle/schema");
      const { eq: _eq } = await import("drizzle-orm");
      const _db2 = await _getDb();
      const _report2 = await _getReport();
      if (_db2 && _report2) {
        const [_user2] = await _db2.select().from(_usersT).where(_eq(_usersT.id, userId));
        const [_profile2] = await _db2.select().from(_profilesT).where(_eq(_profilesT.userId, userId));
        if (_user2 && _profile2) {
          const _allProjects2 = await _getProjects();
          const _allContacts2 = await _getContacts();
          const _latestRun2 = await _getRun();
          const _matched2 = await _score(_allProjects2, {
            territories: _profile2.territories as string[] | null,
            industries: _profile2.industries as string[] | null,
            offerCategories: _profile2.offerCategories as string[] | null,
            customerTypes: _profile2.customerTypes as string[] | null,
            dealSizeMin: _profile2.dealSizeMin,
            dealSizeMax: _profile2.dealSizeMax,
            assignedBusinessLines: _profile2.assignedBusinessLines as string[] | null,
            salesMotion: (_profile2 as any).salesMotion as "direct_only" | "mixed" | null,
          });
          const _contactProjectNames2 = new Set(_allContacts2.map((c: any) => c.project).filter(Boolean));
          const _matchedContacts2 = _allContacts2.filter((c: any) => new Set(_matched2.map((p: any) => p.name)).has(c.project));
          const _annotated2 = _matched2.map((p: any) => {
            const hasNoContacts = !_contactProjectNames2.has(p.name);
            const projectContacts = _matchedContacts2
              .filter((c: any) =>
                c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
                p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
              )
              .map((c: any) => ({
                name: c.name, title: c.title, company: c.company, project: c.project,
                priority: c.priority, email: c.email, roleRelevance: (c as any).roleRelevance ?? null,
                linkedin: (c as any).linkedinProfileUrl ?? (c as any).linkedin ?? null,
                contactTrustTier: (c as any).contactTrustTier ?? null,
                source: (c as any).source ?? null,
                verificationScore: (c as any).verificationScore ?? null,
              }));
            const { readiness, bestContact } = _classify({ ...p, hasNoContacts }, projectContacts);
            return { ...p, hasNoContacts, briefReadiness: readiness, bestContact };
          });
          const _territories2 = _resolveTerr(_profile2.territories as string[] | null, _profile2.sectorFocus as string[] | null);
          const _emailSignals2 = _buildSignals(_annotated2, _territories2);
          const _freshnessLine2 = _latestRun2?.completedAt
            ? `Data last refreshed: ${new Date(_latestRun2.completedAt).toUTCString().slice(0, 16)} UTC`
            : `Data as of: ${_report2.weekEnding}`;
          const _actionCount2 = _emailSignals2.filter((s: any) => s.badge === "action_ready").length;
          const _discoveryCount2 = _emailSignals2.filter((s: any) => s.badge === "discovery_needed").length;
          const _summaryParts2: string[] = [];
          if (_actionCount2 > 0) _summaryParts2.push(`${_actionCount2} action-ready opportunit${_actionCount2 === 1 ? "y" : "ies"}`);
          if (_discoveryCount2 > 0) _summaryParts2.push(`${_discoveryCount2} need${_discoveryCount2 === 1 ? "s" : ""} contact discovery`);
          const _summaryLine2 = _summaryParts2.length > 0 ? `${_summaryParts2.join(" and ")} this week.` : "Here's your weekly intelligence update.";
          const _territoryLabel2 = _territories2.length > 0 ? _territories2.join("/") : "National";
          const _emailData2 = {
            userName: (_user2.name || "Team Member").split(" ")[0],
            territory: _territoryLabel2,
            weekLabel: _report2.weekEnding,
            summaryLine: _summaryLine2,
            signals: _emailSignals2,
            dashboardUrl: ENV.appSiteUrl || "",
          };
          htmlContent = _buildHtml(_emailData2);
          textContent = _buildText(_emailData2);
        }
      }
    } catch (htmlErr) {
      console.warn("[EmailDigest] sendWeeklyDigestToUser: failed to build htmlContent, falling back to markdown:", htmlErr);
    }
    const sent = await sendEmail({
      to: userEmail,
      subject: forceOverride ? `[FORCE OVERRIDE] ${preview.subject}` : preview.subject,
      markdownContent: preview.content,
      htmlContent,
      textContent: textContent ?? preview.content,
    });

    if (sent) {
      // Log the send — claim the slot first (INSERT IGNORE), then finalise to 'sent'
      const weekKey = getDigestWeekKey();
      await claimDigestSendSlot(userId, "monday", weekKey);
      // Always finalise regardless of whether claim returned true/false
      // (the row may already exist from a previous failed attempt)
      await finaliseDigestSendSlot(userId, "monday", weekKey, "sent", {});
      console.log(
        forceOverride
          ? `[EmailDigest] ⚠ FORCE_OVERRIDE Monday digest sent to ${preview.userName} (${userEmail})`
          : `[EmailDigest] ✓ Catch-up Monday digest sent to ${preview.userName} (${userEmail})`
      );
    }

    return { sent, subject: preview.subject, userName: preview.userName };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[EmailDigest] Failed to send catch-up digest to user ${userId}:`, errMsg);
    return { sent: false, subject: preview.subject, userName: preview.userName, error: errMsg };
  }
}

/**
 * Generate a Monday digest preview for a single specific user.
 * Always dry-run — never sends. Returns subject + full content.
 */
export async function sendWeeklyDigestsForUser(userId: number): Promise<{
  subject: string;
  content: string;
  contentLength: number;
  userName: string;
} | null> {
  const weekKey = getDigestWeekKey();
  const report = await getLatestReport();
  if (!report) return null;

  const latestRun = await getLatestPipelineRun();
  const freshnessLine = latestRun?.completedAt
    ? `Data last refreshed: ${new Date(latestRun.completedAt).toUTCString().slice(0, 16)} UTC`
    : `Data as of: ${report.weekEnding}`;

  const allProjects = await getActiveProjects();
  const allContacts = await getAllContacts();

  const db = await getDb();
  if (!db) return null;
  const { users: usersTable, userProfiles: userProfilesTable } = await import("../drizzle/schema");
  const { eq: eqOp } = await import("drizzle-orm");
  const [user] = await db.select().from(usersTable).where(eqOp(usersTable.id, userId));
  if (!user) return null;
  const [profile] = await db.select().from(userProfilesTable).where(eqOp(userProfilesTable.userId, userId));
  if (!profile) return null;

  let thisWeekSection = "";
  try {
    const thisWeekData = await getThisWeekForEmail(userId);
    thisWeekSection = formatThisWeekSection(
      thisWeekData.top3Projects,
      thisWeekData.top2Stakeholders,
      thisWeekData.urgentAction,
      "/",
    );
  } catch { /* ignore */ }

  const matchedProjects = await scoreAndFilterProjects(allProjects, {
    territories: profile.territories as string[] | null,
    industries: profile.industries as string[] | null,
    offerCategories: profile.offerCategories as string[] | null,
    customerTypes: profile.customerTypes as string[] | null,
    dealSizeMin: profile.dealSizeMin,
    dealSizeMax: profile.dealSizeMax,
     assignedBusinessLines: profile.assignedBusinessLines as string[] | null,
    salesMotion: (profile as any).salesMotion as "direct_only" | "mixed" | null,
    repName: (profile as any).repName || null,
  });
  const contactProjectNames = new Set(allContacts.map(c => c.project).filter(Boolean));
  const matchedContacts2 = allContacts.filter(c => new Set(matchedProjects.map(p => p.name)).has(c.project));
  const annotatedProjects = matchedProjects.map(p => {
    const hasNoContacts = !contactProjectNames.has(p.name);
    const projectContacts: DigestContact[] = matchedContacts2
      .filter(c =>
        c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
        p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
      )
      .map(c => ({
        name: c.name, title: c.title, company: c.company, project: c.project, priority: c.priority, email: c.email,
        roleRelevance: (c as any).roleRelevance ?? null,
        linkedin: (c as any).linkedinProfileUrl ?? (c as any).linkedin ?? null,
        // Pass trust tier through so classifyBriefReadiness can enforce it
        contactTrustTier: (c as any).contactTrustTier ?? null,
        // Pass source + verificationScore for gate defensibility check
        source: (c as any).source ?? null,
        verificationScore: (c as any).verificationScore ?? null,
      }));
    const { readiness, bestContact } = classifyBriefReadiness(
      { ...p, hasNoContacts },
      projectContacts,
      { isPumpLane: isPumpLaneRep((profile.assignedBusinessLines as string[] | null) || []) },
    );
    return { ...p, hasNoContacts, briefReadiness: readiness, bestContact };
  });
  const territories = resolveTerritories(profile.territories as string[] | null, profile.sectorFocus as string[] | null);
  const matchedContacts = allContacts.filter(c => new Set(matchedProjects.map(p => p.name)).has(c.project));
  const pipeline = await getPipelineClaimsByUser(userId);

  const content = generateMondayDigest(
    user.name || "Team Member",
    report.weekEnding,
    annotatedProjects,
    matchedContacts.map(c => ({
      name: c.name,
      title: c.title,
      company: c.company,
      project: c.project,
      priority: c.priority,
      email: c.email,
    })),
    pipeline.length,
    thisWeekSection,
    territories,
    freshnessLine,
    weekKey,
    userId,
    undefined, // Note: single-user preview — no cross-rep dedup applied
    (profile.assignedBusinessLines as string[] | null) || [],
  );

  const territoryLabel = territories.length > 0 ? territories.join("/") : "National";
  const subject = `PT Capital Sales — Weekly Intelligence Brief | ${territoryLabel} — ${report.weekEnding}`;

  return { subject, content, contentLength: content.length, userName: user.name || "Team Member" };
}

/**
 * Generate a Thursday reminder preview for a single specific user.
 * Always dry-run — never sends. Returns subject + full content.
 */
export async function sendThursdayReminderForUser(userId: number): Promise<{
  subject: string;
  content: string;
  contentLength: number;
  userName: string;
} | null> {
  const weekKey = getDigestWeekKey();
  const report = await getLatestReport();
  if (!report) return null;

  const latestRun = await getLatestPipelineRun();
  const freshnessLine = latestRun?.completedAt
    ? `Data last refreshed: ${new Date(latestRun.completedAt).toUTCString().slice(0, 16)} UTC`
    : `Data as of: ${report.weekEnding}`;

  const allProjects = await getActiveProjects();
  const allContacts = await getAllContacts();

  const db = await getDb();
  if (!db) return null;
  const { users: usersTable, userProfiles: userProfilesTable } = await import("../drizzle/schema");
  const { eq: eqOp } = await import("drizzle-orm");
  const [user] = await db.select().from(usersTable).where(eqOp(usersTable.id, userId));
  if (!user) return null;
  const [profile] = await db.select().from(userProfilesTable).where(eqOp(userProfilesTable.userId, userId));
  if (!profile) return null;

  const matchedProjects = await scoreAndFilterProjects(allProjects, {
    territories: profile.territories as string[] | null,
    industries: profile.industries as string[] | null,
    offerCategories: profile.offerCategories as string[] | null,
    customerTypes: profile.customerTypes as string[] | null,
    dealSizeMin: profile.dealSizeMin,
    dealSizeMax: profile.dealSizeMax,
    assignedBusinessLines: profile.assignedBusinessLines as string[] | null,
    salesMotion: (profile as any).salesMotion as "direct_only" | "mixed" | null,
    repName: user.name || null,
  });
  const territories = resolveTerritories(profile.territories as string[] | null, profile.sectorFocus as string[] | null);
  const matchedContacts = allContacts.filter(c => new Set(matchedProjects.map(p => p.name)).has(c.project));
  const pipeline = await getPipelineClaimsByUser(userId);;

  let thisWeekSection = "";
  try {
    const thisWeekData = await getThisWeekForEmail(userId);
    thisWeekSection = formatThisWeekSection(
      thisWeekData.top3Projects,
      thisWeekData.top2Stakeholders,
      thisWeekData.urgentAction,
      "/",
    );
  } catch { /* ignore */ }

  const content = generateThursdayReminder(
    user.name || "Team Member",
    report.weekEnding,
    matchedProjects,
    pipeline.length,
    thisWeekSection,
    territories,
    freshnessLine,
    weekKey,
    userId,
  );

  const territoryLabel = territories.length > 0 ? territories.join("/") : "National";
  const subject = `PT Capital Sales — Mid-Week Action Reminder | ${territoryLabel} — ${report.weekEnding}`;

  return { subject, content, contentLength: content.length, userName: user.name || "Team Member" };
}

/**
 * Force-send the Thursday reminder to a single specific user, bypassing the weekly dedup guard.
 * Used by admin to re-send to users whose slot was stuck in 'pending' (server restart mid-send).
 *
 * This calls sendThursdayReminders(force=true) with a targetUserId filter so only the
 * specified user is processed. The force flag ensures the dedup guard is bypassed even
 * if a 'failed' row exists for today.
 */
export async function sendThursdayReminderActualToUser(userId: number): Promise<{
  sent: number;
  failed: number;
  skipped: number;
  error?: string;
}> {
  try {
    // Temporarily patch getEmailRecipients by running the full send with a user filter.
    // We use sendThursdayReminders(force=true) and filter inside by wrapping the DB.
    // Simpler approach: call the full send loop but only for this user.
    const weekKey = getDigestWeekKey();
    const report = await getLatestReport();
    if (!report) return { sent: 0, failed: 1, skipped: 0, error: "No report found" };

    const latestRun = await getLatestPipelineRun();
    const freshnessLine = latestRun?.completedAt
      ? `Data last refreshed: ${new Date(latestRun.completedAt).toUTCString().slice(0, 16)} UTC`
      : `Data as of: ${report.weekEnding}`;

    const allProjects = await getActiveProjects();

    const db = await getDb();
    if (!db) return { sent: 0, failed: 1, skipped: 0, error: "No DB connection" };
    const { users: usersTable, userProfiles: userProfilesTable } = await import("../drizzle/schema");
    const { eq: eqOp } = await import("drizzle-orm");

    const [user] = await db.select().from(usersTable).where(eqOp(usersTable.id, userId));
    if (!user) return { sent: 0, failed: 1, skipped: 0, error: `User ${userId} not found` };
    if (!user.email) return { sent: 0, failed: 1, skipped: 0, error: `User ${userId} has no email` };

    const [profile] = await db.select().from(userProfilesTable).where(eqOp(userProfilesTable.userId, userId));
    if (!profile) return { sent: 0, failed: 1, skipped: 0, error: `No profile for user ${userId}` };

    // Claim a fresh slot (force=true bypasses the dedup guard)
    const claimed = await claimDigestSendSlot(user.id, "thursday", weekKey);
    // If claim fails (row already exists for today), force-insert via finalise
    // by calling finalise with 'pending' first to ensure a row exists, then proceed.
    // Actually: if claimed=false it means a row exists. We need to check if it's failed/sent.
    // For force-resend we just proceed and finalise will UPDATE the existing row.

    try {
      const matchedProjects = await scoreAndFilterProjects(allProjects, {
        territories: profile.territories as string[] | null,
        industries: profile.industries as string[] | null,
        offerCategories: profile.offerCategories as string[] | null,
        customerTypes: profile.customerTypes as string[] | null,
        dealSizeMin: profile.dealSizeMin,
        dealSizeMax: profile.dealSizeMax,
        assignedBusinessLines: profile.assignedBusinessLines as string[] | null,
        salesMotion: (profile as any).salesMotion as "direct_only" | "mixed" | null,
        repName: user.name || null,
      });
      const hotProjects = matchedProjects.filter(p => p.priority === "hot" || p.actionTier === "tier1_actionable");
      const territories = resolveTerritories(profile.territories as string[] | null, profile.sectorFocus as string[] | null);
      const pipeline = await getPipelineClaimsByUser(user.id);

      let thisWeekSection = "";
      try {
        const thisWeekData = await getThisWeekForEmail(user.id);
        thisWeekSection = formatThisWeekSection(
          thisWeekData.top3Projects, thisWeekData.top2Stakeholders, thisWeekData.urgentAction, "/",
        );
      } catch { /* ignore */ }

      const contentWithFreshness = generateThursdayReminder(
        user.name || "Team Member", report.weekEnding, hotProjects, pipeline.length,
        thisWeekSection, territories, freshnessLine, weekKey, user.id,
      );

      const territoryLabel = territories.length > 0 ? territories.join("/") : "National";
      const subject = `PT Capital Sales — Mid-Week Action Reminder | ${territoryLabel} — ${report.weekEnding}`;

      const thursdaySignals = buildEmailSignals(hotProjects, territories);
      const thursSummaryLine = hotProjects.length > 0
        ? `${hotProjects.length} hot opportunit${hotProjects.length === 1 ? "y" : "ies"} need${hotProjects.length === 1 ? "s" : ""} your attention this week.`
        : "Quick mid-week check-in on your territory.";
      const thursEmailData: DigestEmailData = {
        userName: (user.name || "Team Member").split(" ")[0],
        territory: territoryLabel,
        weekLabel: report.weekEnding,
        summaryLine: thursSummaryLine,
        signals: thursdaySignals,
        dashboardUrl: getSiteUrl(),
      };
      const thursHtmlContent = buildDigestEmailHtml(thursEmailData);
      const thursTextContent = buildDigestEmailText(thursEmailData);

      const sent = await sendEmail({
        to: user.email,
        subject,
        markdownContent: contentWithFreshness,
        htmlContent: thursHtmlContent,
        textContent: thursTextContent,
      });

      if (sent) {
        // Force-update the row to 'sent' regardless of current status
        // (finaliseDigestSendSlot only matches pending/dry_run rows, so we
        // use a direct UPSERT here to handle the force-resend case correctly).
        try {
          const dbConn = await getDb();
          if (dbConn) {
            const today = new Date().toISOString().slice(0, 10);
            await dbConn.execute(
              sql`INSERT INTO userEmailSendLog
                (userId, digestType, sentDate, weekKey, status, itemCount, dryRun, error)
                VALUES
                (${user.id}, 'thursday', ${today}, ${weekKey}, 'sent', ${hotProjects.length}, 0, NULL)
                ON DUPLICATE KEY UPDATE
                  status = 'sent',
                  weekKey = VALUES(weekKey),
                  itemCount = VALUES(itemCount),
                  error = NULL,
                  dryRun = 0,
                  sentAt = CURRENT_TIMESTAMP`
            );
          }
        } catch (dbErr) {
          console.error(`[EmailDigest] DB log update failed after successful send for ${user.name}:`, dbErr);
        }
        console.log(`[EmailDigest] \u2713 Force-resend Thursday reminder sent for ${user.name}`);
        return { sent: 1, failed: 0, skipped: 0 };
      } else {
        await finaliseDigestSendSlot(user.id, "thursday", weekKey, "failed", { error: "sendEmail returned false" });
        return { sent: 0, failed: 1, skipped: 0, error: "sendEmail returned false" };
      }
    } catch (innerErr) {
      const errMsg = String(innerErr);
      try { await finaliseDigestSendSlot(user.id, "thursday", weekKey, "failed", { error: errMsg }); } catch { /* ignore */ }
      return { sent: 0, failed: 1, skipped: 0, error: errMsg };
    }
  } catch (outerErr) {
    return { sent: 0, failed: 1, skipped: 0, error: String(outerErr) };
  }
}
