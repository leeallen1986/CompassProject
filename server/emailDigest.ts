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
} from "./db";
import { shouldIncludeInBrief, getTierLabel, type ActionTier } from "./tierClassification";
import { getProjectScoresBatch, type DimensionScore } from "./businessLineScoring";
import { getThisWeekForEmail, type ThisWeekProject, type ThisWeekStakeholder, type SuggestedAction } from "./thisWeekService";

/**
 * Base URL for the published app — used to build clickable links in digest emails.
 * Falls back to compasspt.manus.space if no env var is set.
 */
const APP_BASE_URL = (process.env.APP_BASE_URL || "https://compasspt.manus.space").replace(/\/$/, "");

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
      const projectUrl = `${APP_BASE_URL}/projects/${p.id}`;
      section += `${priorityEmoji} **[${p.name}](${projectUrl})**${newBadge}${tierBadge}\n`;
      section += `   📍 ${p.location} | 💰 ${p.value} | ${p.owner}\n`;
      if (p.detectedActivities.length > 0) {
        section += `   🏗️ Activities: ${p.detectedActivities.slice(0, 3).join(", ")}\n`;
      }
      if (p.contractors && p.contractors.length > 0) {
        // Strip any HTML tags from contractor names (data may contain raw HTML)
        const cleanNames = p.contractors.slice(0, 2).map(c => c.name.replace(/<[^>]*>/g, "").trim()).filter(Boolean);
        if (cleanNames.length > 0) {
          section += `   🔧 Contractors: ${cleanNames.join(", ")}\n`;
        }
      }
      if (p.overview) {
        // Strip any HTML tags from overview text
        const cleanOverview = p.overview.replace(/<[^>]*>/g, "").trim();
        section += `   ${cleanOverview.substring(0, 120)}...\n`;
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

  let content = `**Weekly Intelligence Digest — ${reportWeek}**\n\n`;
  content += `Hi ${userName || "there"},\n\n`;
  content += `Here's your personalised weekly intelligence brief for **${territoryLabel}**.\n\n`;

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

  // Top projects
  for (const p of top10) {
    const priorityEmoji = p.priority === "hot" ? "🔥" : p.priority === "warm" ? "🌡️" : "❄️";
    const newBadge = p.isNew ? " [NEW]" : "";
    const tierBadge = p.actionTier === "tier1_actionable" ? " [ACTIONABLE]" : p.actionTier === "tier2_warm" ? " [WARM]" : "";
    const projectUrl = `${APP_BASE_URL}/projects/${p.id}`;
    content += `${priorityEmoji} **[${p.name}](${projectUrl})**${newBadge}${tierBadge}\n`;
    content += `   📍 ${p.location} | 💰 ${p.value} | ${p.owner}\n`;
    content += `   Route: ${p.opportunityRoute} | Match: ${p.relevanceScore}%\n`;
    if (p.overview) {
      const cleanOverview = p.overview.replace(/<[^>]*>/g, "").trim();
      content += `   ${cleanOverview.substring(0, 120)}...\n`;
    }
    content += `\n`;
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
  content += `[**→ Open Your Dashboard**](${APP_BASE_URL})\n\n`;
  content += `View detailed project cards, contractor info, source links, and take action on your pipeline.\n`;
  content += `[Update your preferences](${APP_BASE_URL}/settings) to refine your matches.`;

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

  let content = `**Mid-Week Intelligence Reminder — ${reportWeek}**\n\n`;
  content += `Hi ${userName || "there"},\n\n`;
  content += `Quick mid-week check-in for **${territoryLabel}** — here's what needs your attention.\n\n`;

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
      const projectUrl = `${APP_BASE_URL}/projects/${p.id}`;
      content += `🔥 **[${p.name}](${projectUrl})**${newBadge}\n`;
      content += `   📍 ${p.location} | 💰 ${p.value} | ${p.owner}\n`;
      if (p.overview) {
        const cleanOverview = p.overview.replace(/<[^>]*>/g, "").trim();
        content += `   ${cleanOverview.substring(0, 100)}...\n`;
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
  content += `[**→ Open Your Dashboard**](${APP_BASE_URL})\n\n`;
  content += `Review all projects and take action before the weekend.`;

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
 */
export async function sendWeeklyDigests(force = false, targetUserIds?: number[]): Promise<{
  sent: number;
  failed: number;
  skipped: number;
  alreadySent: number;
}> {
  const results = { sent: 0, failed: 0, skipped: 0, alreadySent: 0 };

  // Kill switch: skip all email sending when disabled (bypass for targeted test sends)
  if (process.env.EMAIL_DIGESTS_ENABLED !== "true" && !targetUserIds) {
    console.log("[EmailDigest] ⚠ Email digests DISABLED (EMAIL_DIGESTS_ENABLED != true). Skipping weekly digest.");
    return results;
  }

  // Get the latest report
  const report = await getLatestReport();
  if (!report) {
    console.warn("[EmailDigest] No report found, skipping digest");
    return results;
  }

  // Get all projects and contacts for this report
  const allProjects = await getProjectsByReportId(report.id);
  const allContacts = await getContactsByReportId(report.id);

  // Get users — either targeted subset or ALL users with profiles
  let allUsers = await getAllUsersWithProfiles();
  if (targetUserIds && targetUserIds.length > 0) {
    allUsers = allUsers.filter(({ user }) => user && targetUserIds.includes(user.id));
    console.log(`[EmailDigest] Targeted test send: ${allUsers.length} users (IDs: ${targetUserIds.join(", ")})`);
  } else {
    console.log(`[EmailDigest] Monday digest: ${allUsers.length} users with profiles`);
  }

  for (const { user, profile } of allUsers) {
    if (!user || !profile) {
      results.skipped++;
      continue;
    }

    try {
      // Get personalized "This Week" data for this specific user
      let thisWeekSection = "";
      try {
        const thisWeekData = await getThisWeekForEmail(user.id);
        const thisWeekUrl = APP_BASE_URL;
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

      const territories = (profile.territories as string[]) || [];

      // Generate the personalized Monday digest
      const content = generateMondayDigest(
        user.name || "Team Member",
        report.weekEnding,
        matchedProjects,
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

      // Send directly to user's email via Resend
      const userEmail = user.email;
      if (!userEmail) {
        console.warn(`[EmailDigest] No email for user ${user.name}, skipping`);
        results.skipped++;
        continue;
      }

      const subject = `📊 Weekly Brief for ${user.name || "Team"} — ${territories.length > 0 ? territories.join("/") : "National"} — ${report.weekEnding}`;
      const sent = await sendEmail({
        to: userEmail,
        subject,
        markdownContent: content,
        textContent: content,
      });

      if (sent) {
        results.sent++;
        console.log(`[EmailDigest] ✓ Monday digest sent for ${user.name} (${territories.join(", ")})`);
        // Delay between sends to avoid Exchange/O365 bulk-send quarantine
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        results.failed++;
        console.warn(`[EmailDigest] ✗ Failed to send Monday digest for ${user.name}`);
      }
    } catch (error) {
      console.error(`[EmailDigest] Failed for user ${user.id}:`, error);
      results.failed++;
    }
  }

  return results;
}

/**
 * Send compulsory personalized Thursday mid-week reminders to ALL users with profiles.
 * Lighter than Monday — focuses on urgent actions, hot projects, and pipeline nudges.
 */
export async function sendThursdayReminders(): Promise<{
  sent: number;
  failed: number;
  skipped: number;
}> {
  const results = { sent: 0, failed: 0, skipped: 0 };

  // Kill switch: skip all email sending when disabled
  if (process.env.EMAIL_DIGESTS_ENABLED !== "true") {
    console.log("[EmailDigest] ⚠ Email digests DISABLED (EMAIL_DIGESTS_ENABLED != true). Skipping Thursday reminder.");
    return results;
  }

  // Get the latest report
  const report = await getLatestReport();
  if (!report) {
    console.warn("[EmailDigest] No report found, skipping Thursday reminder");
    return results;
  }

  // Get all projects for this report
  const allProjects = await getProjectsByReportId(report.id);

  // Get ALL users with profiles (compulsory)
  const allUsers = await getAllUsersWithProfiles();
  console.log(`[EmailDigest] Thursday reminder: ${allUsers.length} users with profiles`);

  for (const { user, profile } of allUsers) {
    if (!user || !profile) {
      results.skipped++;
      continue;
    }

    try {
      // Get personalized "This Week" data for this specific user
      let thisWeekSection = "";
      try {
        const thisWeekData = await getThisWeekForEmail(user.id);
        const thisWeekUrl = APP_BASE_URL;
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

      // Only hot projects for this user — only hot/actionable (with BL personalization)
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

      const subject = `⚡ Mid-Week Reminder for ${user.name || "Team"} — ${territories.length > 0 ? territories.join("/") : "National"} — ${report.weekEnding}`;
      const sent = await sendEmail({
        to: userEmail,
        subject,
        markdownContent: content,
        textContent: content,
      });

      if (sent) {
        results.sent++;
        console.log(`[EmailDigest] ✓ Thursday reminder sent for ${user.name} (${territories.join(", ")})`);
        // Delay between sends to avoid Exchange/O365 bulk-send quarantine
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        results.failed++;
        console.warn(`[EmailDigest] ✗ Failed to send Thursday reminder for ${user.name}`);
      }
    } catch (error) {
      console.error(`[EmailDigest] Thursday reminder failed for user ${user.id}:`, error);
      results.failed++;
    }
  }

  return results;
}
