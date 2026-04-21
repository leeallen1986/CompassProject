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
import {
  getAllUsersWithProfiles,
  getLatestReport,
  getProjectsByReportId,
  getContactsByReportId,
  getPipelineClaimsByUser,
  getDb,
  getEmailRecipients,
  logEmailSendExtended,
  getLatestPipelineRun,
  getCurrentWeekKey,
  getManagerRollup,
  wasEmailSentToUserThisWeek,
} from "./db";
import { shouldIncludeInBrief, getTierLabel, type ActionTier } from "./tierClassification";
import { getProjectScoresBatch, type DimensionScore } from "./businessLineScoring";
import { getThisWeekForEmail, type ThisWeekProject, type ThisWeekStakeholder, type SuggestedAction } from "./thisWeekService";
import { userEmailSendLog } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

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
}

interface DigestContact {
  name: string;
  title: string;
  company: string;
  project: string;
  priority: string;
  email: string | null;
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
  "Nitrogen": ["Nitrogen"],
  "Booster": ["Booster"],
};

/**
 * Score a project against a user's profile for relevance (0-100).
 * Now includes BL-based scoring when blScores are provided.
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
  },
  blScores?: DimensionScore[],
): number {
  let score = 50; // base score

  // Territory match
  if (profile.territories && (profile.territories as string[]).length > 0) {
    const territories = profile.territories as string[];
    const loc = project.location.toLowerCase();
    const stateMap: Record<string, string[]> = {
      WA: ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha", "port hedland"],
      NT: ["northern territory", "nt", "darwin", "alice springs"],
      QLD: ["queensland", "qld", "brisbane", "gladstone", "mackay", "bowen"],
      NSW: ["new south wales", "nsw", "sydney", "hunter valley", "newcastle"],
      VIC: ["victoria", "vic", "melbourne", "gippsland"],
      SA: ["south australia", "sa", "adelaide", "olympic dam", "whyalla"],
      TAS: ["tasmania", "tas", "hobart"],
      ACT: ["act", "canberra"],
    };

    let matched = false;
    for (const terr of territories) {
      if (terr === "National" || terr === "NATIONAL") { matched = true; break; }
      const keywords = stateMap[terr] || [terr.toLowerCase()];
      if (keywords.some(k => loc.includes(k))) { matched = true; break; }
    }
    score += matched ? 15 : -20;
  }

  // Industry match
  if (profile.industries && (profile.industries as string[]).length > 0) {
    const industries = (profile.industries as string[]).map(i => i.toLowerCase());
    const sectorMap: Record<string, string[]> = {
      mining: ["mining", "exploration", "development", "production", "shutdown", "mro", "contractors"],
      oil_gas: ["oil", "gas", "lng", "fpso", "offshore"],
      infrastructure: ["infrastructure", "rail", "road", "port", "construction"],
      energy: ["energy", "renewable", "solar", "wind", "hydrogen"],
      defence: ["defence", "defense", "military", "naval"],
    };
    const sectorKeywords = sectorMap[project.sector] || [];
    const matched = industries.some(ind =>
      sectorKeywords.some(sk => ind.includes(sk) || sk.includes(ind))
    );
    score += matched ? 15 : -10;
  }

  // Offer category match
  if (profile.offerCategories && (profile.offerCategories as string[]).length > 0) {
    const categories = (profile.offerCategories as string[]).map(c => c.toLowerCase());
    const route = project.opportunityRoute.toLowerCase();
    const matched = categories.some(cat => {
      if (cat.includes("compressor") || cat.includes("portable")) return route.includes("capex") || route.includes("direct");
      if (cat.includes("rental") || cat.includes("hire")) return route.includes("opex") || route.includes("fleet");
      if (cat.includes("service") || cat.includes("parts")) return route.includes("opex");
      return false;
    });
    if (matched) score += 10;
  }

  // ── Business Line scoring boost (major differentiator) ──
  if (profile.assignedBusinessLines && profile.assignedBusinessLines.length > 0 && blScores && blScores.length > 0) {
    // Map user's BLs to scoring dimensions
    const userDimensions = new Set<string>();
    for (const bl of profile.assignedBusinessLines) {
      const dims = BL_TO_DIMENSION_MAP[bl];
      if (dims) dims.forEach(d => userDimensions.add(d));
    }

    if (userDimensions.size > 0) {
      // Get the max score across the user's assigned BL dimensions
      let maxBLScore = 0;
      let avgBLScore = 0;
      let matchCount = 0;

      for (const dim of Array.from(userDimensions)) {
        const dimScore = blScores.find(s => s.dimension === dim);
        if (dimScore && dimScore.score > 0) {
          maxBLScore = Math.max(maxBLScore, dimScore.score);
          avgBLScore += dimScore.score;
          matchCount++;
        }
      }

      if (matchCount > 0) {
        avgBLScore = avgBLScore / matchCount;
        // Strong boost for high BL relevance (up to +25 points)
        // This ensures a Pump guy sees pump projects first, not generic ones
        score += Math.round((maxBLScore / 100) * 25);
        // Additional boost if multiple BL dimensions match well
        if (matchCount > 1 && avgBLScore > 50) {
          score += 5;
        }
      } else {
        // Penalize projects with zero relevance to user's BLs
        score -= 15;
      }
    }
  }

  // Priority boost
  if (project.priority === "hot") score += 10;
  if (project.priority === "warm") score += 5;

  // New project boost
  if (project.isNew) score += 5;

  return Math.max(0, Math.min(100, score));
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

  // ── Urgent Action ──
  if (urgentAction) {
    const priorityEmoji = urgentAction.priority === "urgent" ? "🚨" : "⚡";
    section += `${priorityEmoji} **ACTION REQUIRED: ${urgentAction.title}**\n`;
    section += `${urgentAction.description}\n\n`;
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
        section += `   🔧 Contractors: ${p.contractors.slice(0, 2).map(c => c.name).join(", ")}\n`;
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
  section += `**[View full "This Week" summary →](${thisWeekUrl})**\n`;
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
): string {
  // Apply tier-based filtering: only Tier 1 and select Tier 2 reach the brief
  const tierFiltered = matchedProjects.filter(p => {
    const tier = p.actionTier || "tier3_monitor";
    const priority = p.priority as "hot" | "warm" | "cold";
    return shouldIncludeInBrief(tier, priority);
  });

  const top10 = tierFiltered.slice(0, 10);
  const territoryLabel = territories.length > 0
    ? territories.includes("NATIONAL") || territories.includes("National")
      ? "National"
      : territories.join(", ")
    : "All Regions";

  let content = `**PT Capital Sales — Weekly Intelligence Brief — ${reportWeek}**\n\n`;
  content += `Hi ${userName || "there"},\n\n`;
  content += `Here's your personalised PT Capital Sales intelligence brief for **${territoryLabel}**.\n\n`;

  // ── This Week Highlights (top of email) ──
  content += thisWeekSection;
  content += `\n`;

  // ── Personalized Matches ──
  content += `---\n\n`;
  content += `**Your Personalised Project Matches:**\n\n`;

  // Summary stats
  const hotCount = tierFiltered.filter(p => p.priority === "hot").length;
  const warmCount = tierFiltered.filter(p => p.priority === "warm").length;
  const newCount = tierFiltered.filter(p => p.isNew).length;
  const tier1Count = tierFiltered.filter(p => p.actionTier === "tier1_actionable").length;
  const tier2Count = tierFiltered.filter(p => p.actionTier === "tier2_warm").length;
  content += `**Summary:** ${tierFiltered.length} matching projects (${hotCount} hot, ${warmCount} warm, ${newCount} new this week)\n`;
  content += `**Action Tiers:** ${tier1Count} actionable, ${tier2Count} warm pipeline\n\n`;

  // Lane labels for PT Capital Sales grouping
  const LANE_LABELS: Record<string, string> = {
    portable_air: "Portable Air",
    pumps: "Pumps & Dewatering",
    pal: "PAL / Generators",
    bess: "BESS",
    multi_lane_pt: "Multi-Lane PT",
  };

  // Group top projects by productLane
  const laneGroups: Record<string, typeof top10> = {};
  for (const p of top10) {
    const lane = p.productLane || "multi_lane_pt";
    if (!laneGroups[lane]) laneGroups[lane] = [];
    laneGroups[lane].push(p);
  }

  // Render by lane
  const laneOrder = ["portable_air", "pumps", "pal", "bess", "multi_lane_pt"];
  for (const lane of laneOrder) {
    const group = laneGroups[lane];
    if (!group || group.length === 0) continue;
    content += `\n**${LANE_LABELS[lane] || lane} (${group.length}):**\n\n`;
    for (const p of group) {
      const priorityEmoji = p.priority === "hot" ? "🔥" : p.priority === "warm" ? "🌡️" : "❄️";
      const newBadge = p.isNew ? " [NEW]" : "";
      const tierBadge = p.actionTier === "tier1_actionable" ? " [ACTIONABLE]" : p.actionTier === "tier2_warm" ? " [WARM]" : "";
      const stageBadge = p.stageCode && p.stageCode !== "unknown" ? ` | ${p.stageCode.charAt(0).toUpperCase() + p.stageCode.slice(1)}` : "";
      content += `${priorityEmoji} **${p.name}**${newBadge}${tierBadge}\n`;
      content += `   📍 ${p.location} | 💰 ${p.value}${stageBadge} | ${p.owner}\n`;
      content += `   Route: ${p.opportunityRoute} | Match: ${p.relevanceScore}%\n`;
      if (p.overview) {
        content += `   ${p.overview.substring(0, 120)}...\n`;
      }
      // Edit 3: explicit contact-discovery-needed state
      if (p.hasNoContacts) {
        content += `   ⚠️ **Stakeholder discovery needed** — no high-relevance contacts found yet\n`;
        content += `   → Recommended next step: contractor discovery / owner-side stakeholder search\n`;
      }
      content += `\n`;
    }
  }

  // Contacts
  if (matchedContacts.length > 0) {
    content += `\n**Key Contacts (${Math.min(matchedContacts.length, 5)} of ${matchedContacts.length}):**\n\n`;
    for (const c of matchedContacts.slice(0, 5)) {
      content += `• **${c.name}** — ${c.title} at ${c.company}`;
      if (c.email) content += ` (${c.email})`;
      content += `\n`;
    }
  }

  // Pipeline
  if (pipelineCount > 0) {
    content += `\n**Your Pipeline:** ${pipelineCount} active opportunities\n`;
  }

  content += `\n---\n`;
  content += `View the full dashboard for detailed project cards, contractor info, and source links.\n`;
  content += `Update your territory and industry preferences in Settings to refine your matches.`;

  return content;
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
): string {
  const territoryLabel = territories.length > 0
    ? territories.includes("NATIONAL") || territories.includes("National")
      ? "National"
      : territories.join(", ")
    : "All Regions";

  let content = `**PT Capital Sales — Mid-Week Reminder — ${reportWeek}**\n\n`;
  content += `Hi ${userName || "there"},\n\n`;
  content += `Quick mid-week PT Capital Sales check-in for **${territoryLabel}** — here's what needs your attention.\n\n`;

  // ── This Week Highlights (urgent actions + top projects) ──
  content += thisWeekSection;
  content += `\n`;

  // ── Hot projects only ──
  const actionable = hotProjects.filter(p =>
    p.actionTier === "tier1_actionable" || p.priority === "hot"
  );

  if (actionable.length > 0) {
    content += `---\n\n`;
    content += `**🔥 Hot & Actionable Projects in Your Territory (${actionable.length}):**\n\n`;
    for (const p of actionable.slice(0, 5)) {
      const newBadge = p.isNew ? " [NEW]" : "";
      content += `🔥 **${p.name}**${newBadge}\n`;
      content += `   📍 ${p.location} | 💰 ${p.value} | ${p.owner}\n`;
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
async function scoreAndFilterProjects(
  allProjects: any[],
  profile: {
    territories: string[] | null;
    industries: string[] | null;
    offerCategories: string[] | null;
    customerTypes: string[] | null;
    dealSizeMin: string | null;
    dealSizeMax: string | null;
    assignedBusinessLines?: string[] | null;
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

  const scoredProjects = allProjects.map(p => {
    const projectBLScores = blScoresMap.get(p.id) || [];
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
      relevanceScore: scoreProjectForUser(
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
          actionTier: (p as any).actionTier as ActionTier | null,
        },
        profile,
        projectBLScores,
      ),
    };
  });

  // Sort by relevance
  scoredProjects.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Filter to relevant projects (score > 40)
  return scoredProjects.filter(p => p.relevanceScore > 40);
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
  previews?: Array<{ userId: number; subject: string; contentLength: number }>;
}> {
  const results: {
    sent: number; failed: number; skipped: number; alreadySent: number;
    previews?: Array<{ userId: number; subject: string; contentLength: number }>;
  } = { sent: 0, failed: 0, skipped: 0, alreadySent: 0 };
  if (dryRun) results.previews = [];

  // Kill switch: skip all email sending when disabled (dry-run bypasses this)
  if (!dryRun && process.env.EMAIL_DIGESTS_ENABLED !== "true") {
    console.log("[EmailDigest] ⚠ Email digests DISABLED (EMAIL_DIGESTS_ENABLED != true). Skipping weekly digest.");
    return results;
  }

  const weekKey = getCurrentWeekKey();

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

  // Get all projects and contacts for this report
  const allProjects = await getProjectsByReportId(report.id);
  const allContacts = await getContactsByReportId(report.id);

  // Recipient selection: respects PILOT_MODE and PILOT_ALLOW_LIST env vars
  const allUsers = await getEmailRecipients({ digestType: "monday" });
  console.log(`[EmailDigest] Monday digest: ${allUsers.length} eligible recipients (dryRun=${dryRun})`);

  for (const { user, profile } of allUsers) {
    if (!user || !profile) {
      results.skipped++;
      continue;
    }

    try {
      // ── Per-user deduplication: skip if already sent this week (or today for backward compat) ──
      if (!force && !dryRun) {
        const alreadySentThisWeek = await wasEmailSentToUserThisWeek(user.id, "monday", weekKey);
        if (alreadySentThisWeek) {
          results.alreadySent++;
          console.log(`[EmailDigest] ⏭ Monday digest already sent to ${user.name} this week (${weekKey}), skipping`);
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

      // Score projects for this user (with BL-based personalization)
      const matchedProjects = await scoreAndFilterProjects(allProjects, {
        territories: profile.territories as string[] | null,
        industries: profile.industries as string[] | null,
        offerCategories: profile.offerCategories as string[] | null,
        customerTypes: profile.customerTypes as string[] | null,
        dealSizeMin: profile.dealSizeMin,
        dealSizeMax: profile.dealSizeMax,
        assignedBusinessLines: profile.assignedBusinessLines as string[] | null,
      });

      if (matchedProjects.length === 0) {
        results.skipped++;
        console.log(`[EmailDigest] Skipping ${user.name} — no matching projects`);
        continue;
      }

      // Get pipeline count
      const pipeline = await getPipelineClaimsByUser(user.id);

      // Get matched contacts (from same projects)
      const matchedProjectNames = new Set(matchedProjects.map(p => p.name));
      const matchedContacts = allContacts.filter(c => matchedProjectNames.has(c.project));

      // Part D: annotate each project with hasNoContacts and latestActionStatus
      const contactProjectIds = new Set(allContacts.map(c => (c as any).projectId).filter(Boolean));
      const annotatedProjects = matchedProjects.map(p => ({
        ...p,
        hasNoContacts: !contactProjectIds.has(p.id),
      }));

      const territories = (profile.territories as string[]) || [];

      // Generate the personalized Monday digest
      const rawContent = generateMondayDigest(
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
      );
      // Append freshness line
      const content = rawContent + `\n\n---\n_${freshnessLine}_`;

      // ── PT Capital Sales subject line ──
      const laneLabel = (profile.assignedBusinessLines as string[] | null)?.length
        ? (profile.assignedBusinessLines as string[]).slice(0, 2).join("/")
        : "PT Capital Sales";
      const territoryLabel = territories.length > 0 ? territories.join("/") : "National";
      const subject = `PT Capital Sales — Weekly Intelligence Brief — ${laneLabel} | ${territoryLabel} — ${report.weekEnding}`;

      // ── Dry-run: log preview without sending ──
      if (dryRun) {
        results.previews!.push({ userId: user.id, subject, contentLength: content.length });
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
        continue;
      }

      const sent = await sendEmail({
        to: userEmail,
        subject,
        markdownContent: content,
        textContent: content,
      });

      if (sent) {
        results.sent++;
        await logEmailSendExtended({
          userId: user.id, digestType: "monday", status: "sent",
          weekKey, itemCount: annotatedProjects.length, dryRun: false,
        });
        console.log(`[EmailDigest] ✓ Monday digest sent for ${user.name} (${territories.join(", ")})`);
      } else {
        results.failed++;
        await logEmailSendExtended({
          userId: user.id, digestType: "monday", status: "failed",
          weekKey, itemCount: annotatedProjects.length, dryRun: false,
          error: "sendEmail returned false",
        });
        console.warn(`[EmailDigest] ✗ Failed to send Monday digest for ${user.name}`);
      }
    } catch (error) {
      console.error(`[EmailDigest] Failed for user ${user.id}:`, error);
      results.failed++;
      if (user?.id) await logEmailSendExtended({
        userId: user.id, digestType: "monday", status: "failed",
        weekKey, dryRun: false, error: String(error),
      });
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
  previews?: Array<{ userId: number; subject: string; contentLength: number }>;
}> {
  const results: {
    sent: number; failed: number; skipped: number; alreadySent: number;
    previews?: Array<{ userId: number; subject: string; contentLength: number }>;
  } = { sent: 0, failed: 0, skipped: 0, alreadySent: 0 };
  if (dryRun) results.previews = [];

  // Kill switch: skip all email sending when disabled (dry-run bypasses this)
  if (!dryRun && process.env.EMAIL_DIGESTS_ENABLED !== "true") {
    console.log("[EmailDigest] ⚠ Email digests DISABLED (EMAIL_DIGESTS_ENABLED != true). Skipping Thursday reminder.");
    return results;
  }

  const weekKey = getCurrentWeekKey();

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

  // Get all projects for this report
  const allProjects = await getProjectsByReportId(report.id);

  // Recipient selection: respects PILOT_MODE and PILOT_ALLOW_LIST env vars
  const allUsers = await getEmailRecipients({ digestType: "thursday" });
  console.log(`[EmailDigest] Thursday reminder: ${allUsers.length} eligible recipients (dryRun=${dryRun})`);

  for (const { user, profile } of allUsers) {
    if (!user || !profile) {
      results.skipped++;
      continue;
    }

    try {
      // ── Per-user deduplication: skip if already sent this week ──
      if (!force && !dryRun) {
        const alreadySentThisWeek = await wasEmailSentToUserThisWeek(user.id, "thursday", weekKey);
        if (alreadySentThisWeek) {
          results.alreadySent++;
          console.log(`[EmailDigest] ⏭ Thursday reminder already sent to ${user.name} this week (${weekKey}), skipping`);
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
      });

      const hotProjects = matchedProjects.filter(p =>
        p.priority === "hot" || p.actionTier === "tier1_actionable"
      );

      // Get pipeline count
      const pipeline = await getPipelineClaimsByUser(user.id);

      const territories = (profile.territories as string[]) || [];

      // Generate the personalized Thursday reminder
      const content = generateThursdayReminder(
        user.name || "Team Member",
        report.weekEnding,
        hotProjects,
        pipeline.length,
        thisWeekSection,
        territories,
      );

      // Send directly to user's email via Resend
      const userEmail = user.email;
      if (!userEmail) {
        console.warn(`[EmailDigest] No email for user ${user.name}, skipping Thursday reminder`);
        results.skipped++;
        continue;
      }

      // Append freshness line
      const contentWithFreshness = content + `\n\n---\n_${freshnessLine}_`;

      // ── PT Capital Sales subject line ──
      const laneLabel = (profile.assignedBusinessLines as string[] | null)?.length
        ? (profile.assignedBusinessLines as string[]).slice(0, 2).join("/")
        : "PT Capital Sales";
      const territoryLabel = territories.length > 0 ? territories.join("/") : "National";
      const subject = `PT Capital Sales — Mid-Week Action Reminder — ${laneLabel} | ${territoryLabel} — ${report.weekEnding}`;

      // ── Dry-run: log preview without sending ──
      if (dryRun) {
        results.previews!.push({ userId: user.id, subject, contentLength: contentWithFreshness.length });
        await logEmailSendExtended({
          userId: user.id, digestType: "thursday", status: "dry_run",
          weekKey, itemCount: hotProjects.length, dryRun: true,
        });
        console.log(`[EmailDigest] 🔍 DRY-RUN Thursday reminder for ${user.name}: "${subject}"`);
        continue;
      }

      const sent = await sendEmail({
        to: userEmail,
        subject,
        markdownContent: contentWithFreshness,
        textContent: contentWithFreshness,
      });

      if (sent) {
        results.sent++;
        await logEmailSendExtended({
          userId: user.id, digestType: "thursday", status: "sent",
          weekKey, itemCount: hotProjects.length, dryRun: false,
        });
        console.log(`[EmailDigest] ✓ Thursday reminder sent for ${user.name} (${territories.join(", ")})`);
      } else {
        results.failed++;
        await logEmailSendExtended({
          userId: user.id, digestType: "thursday", status: "failed",
          weekKey, itemCount: hotProjects.length, dryRun: false,
          error: "sendEmail returned false",
        });
        console.warn(`[EmailDigest] ✗ Failed to send Thursday reminder for ${user.name}`);
      }
    } catch (error) {
      console.error(`[EmailDigest] Thursday reminder failed for user ${user.id}:`, error);
      results.failed++;
      if (user?.id) await logEmailSendExtended({
        userId: user.id, digestType: "thursday", status: "failed",
        weekKey, dryRun: false, error: String(error),
      });
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
  content += `**Total actions logged this week:** ${rollup.totalActions}\n\n`;

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

  const weekKey = getCurrentWeekKey();

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

  // Get admin recipients
  const { users: usersTable } = await import("../drizzle/schema");
  const { eq: eqOp } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) {
    console.warn("[EmailDigest] No DB for manager rollup");
    return results;
  }
  const admins = await db
    .select()
    .from(usersTable)
    .where(eqOp(usersTable.role, "admin"));

  console.log(`[EmailDigest] Manager rollup: ${admins.length} admin recipients (dryRun=${dryRun})`);

  const content = generateManagerRollupEmail(rollup, report.weekEnding, freshnessLine);
  const subject = `PT Capital Sales — Manager Rollup — Week of ${report.weekEnding}`;

  for (const admin of admins) {
    if (!admin.email) {
      results.skipped++;
      continue;
    }

    try {
      if (!force && !dryRun) {
        const alreadySent = await wasEmailSentToUserThisWeek(admin.id, "manager_rollup", weekKey);
        if (alreadySent) {
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
        await logEmailSendExtended({
          userId: admin.id, digestType: "manager_rollup", status: "sent",
          weekKey, itemCount: rollup.totalActions, dryRun: false,
        });
        console.log(`[EmailDigest] ✓ Manager rollup sent to ${admin.name}`);
      } else {
        results.failed++;
        await logEmailSendExtended({
          userId: admin.id, digestType: "manager_rollup", status: "failed",
          weekKey, dryRun: false, error: "sendEmail returned false",
        });
      }
    } catch (error) {
      console.error(`[EmailDigest] Manager rollup failed for admin ${admin.id}:`, error);
      results.failed++;
      await logEmailSendExtended({
        userId: admin.id, digestType: "manager_rollup", status: "failed",
        weekKey, dryRun: false, error: String(error),
      });
    }
  }

  return results;
}
