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
import { ENV } from "./_core/env";
import { getThisWeekForEmail, type ThisWeekProject, type ThisWeekStakeholder, type SuggestedAction } from "./thisWeekService";
import { userEmailSendLog } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

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
  bestContact?: { name: string; title: string; email?: string | null; linkedin?: string | null } | null;
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
}

/**
 * Classify a project's brief readiness based on contact availability.
 *
 * action_ready: has at least one send-ready contact (email or LinkedIn)
 *   with high/medium roleRelevance, OR has verified contractor + tier1 stage.
 * discovery_needed: tier1/tier2 hot/warm but no usable contacts.
 * monitor_only: everything else (tier3, cold tier2).
 */
function classifyBriefReadiness(
  project: DigestProject,
  projectContacts: DigestContact[],
): { readiness: BriefReadiness; bestContact: DigestProject["bestContact"] } {
  const tier = project.actionTier || "tier3_monitor";
  const priority = project.priority as "hot" | "warm" | "cold";

  // Monitor-only: tier3 or cold tier2 — these never lead the brief
  if (tier === "tier3_monitor") return { readiness: "monitor_only", bestContact: null };
  if (tier === "tier2_warm" && priority === "cold") return { readiness: "monitor_only", bestContact: null };

  // Find the best send-ready contact: high/medium relevance + has email or LinkedIn
  const sendReady = projectContacts
    .filter(c =>
      (c.roleRelevance === "high" || c.roleRelevance === "medium") &&
      (c.email || c.linkedin)
    )
    .sort((a, b) => {
      const relOrder: Record<string, number> = { high: 2, medium: 1, low: 0 };
      return (relOrder[b.roleRelevance ?? "low"] ?? 0) - (relOrder[a.roleRelevance ?? "low"] ?? 0);
    });

  if (sendReady.length > 0) {
    const best = sendReady[0];
    return {
      readiness: "action_ready",
      bestContact: { name: best.name, title: best.title, email: best.email, linkedin: best.linkedin },
    };
  }

  // Fallback: verified contractor + tier1 = action_ready (route-to-buy path)
  const hasVerifiedContractor = !project.hasNoContacts &&
    project.actionTier === "tier1_actionable" &&
    projectContacts.length > 0;
  // Even without high-rel contacts, if there are ANY contacts with email, it's action_ready
  const anyContactWithEmail = projectContacts.find(c => c.email);
  if (hasVerifiedContractor && anyContactWithEmail) {
    return {
      readiness: "action_ready",
      bestContact: { name: anyContactWithEmail.name, title: anyContactWithEmail.title, email: anyContactWithEmail.email, linkedin: anyContactWithEmail.linkedin },
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
): string {
  // ── Brief Readiness Split ──
  // Separate projects into action_ready, discovery_needed, monitor_only
  const actionReady = matchedProjects.filter(p => p.briefReadiness === "action_ready");
  const discoveryNeeded = matchedProjects.filter(p => p.briefReadiness === "discovery_needed");
  const monitorOnly = matchedProjects.filter(p => p.briefReadiness === "monitor_only");

  // Brief caps
  const TOP_ACTIONS_CAP = 5;
  const DISCOVERY_CAP = 2;
  const MONITOR_CAP = 3;

  const topActions = actionReady.slice(0, TOP_ACTIONS_CAP);
  const discoveryItems = discoveryNeeded.slice(0, DISCOVERY_CAP);
  const monitorItems = monitorOnly.slice(0, MONITOR_CAP);

  const territoryLabel = territories.length > 0
    ? territories.includes("NATIONAL") || territories.includes("National")
      ? "National"
      : territories.join(", ")
    : "All Regions";

  let content = `**PT Capital Sales — Weekly Intelligence Brief — ${reportWeek}**\n\n`;
  content += `Hi ${userName || "there"},\n\n`;
  content += `Here's your personalised PT Capital Sales intelligence brief for **${territoryLabel}**.\n\n`;

  // ── Freshness line near top of email ──
  content += `_${freshnessLine}_\n\n`;

  // ── This Week Highlights (top of email) ──
  content += thisWeekSection;
  content += `\n`;

  // ── Summary stats ──
  content += `---\n\n`;
  const totalInBrief = actionReady.length + discoveryNeeded.length;
  const hotCount = matchedProjects.filter(p => p.priority === "hot").length;
  const warmCount = matchedProjects.filter(p => p.priority === "warm").length;
  const newCount = matchedProjects.filter(p => p.isNew).length;
  content += `**Summary:** ${totalInBrief} shortlisted projects (${actionReady.length} action-ready, ${discoveryNeeded.length} need discovery) | ${hotCount} hot, ${warmCount} warm, ${newCount} new\n\n`;

  // ═══════════════════════════════════════════════════════════════
  // SECTION 1: TOP ACTIONS (action_ready only, max 5)
  // ═══════════════════════════════════════════════════════════════
  if (topActions.length > 0) {
    content += `## 🎯 Top Actions — Ready to Act (${topActions.length})\n\n`;
    for (const p of topActions) {
      content += renderProjectBlock(p, weekKey, userId, "action_ready");
    }
  } else {
    content += `## 🎯 Top Actions\n\n`;
    content += `_No action-ready projects this week — all shortlisted projects need stakeholder discovery first._\n\n`;
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 2: STAKEHOLDER DISCOVERY NEEDED (max 2)
  // ═══════════════════════════════════════════════════════════════
  if (discoveryItems.length > 0) {
    content += `## 🔍 Stakeholder Discovery Needed (${discoveryItems.length})\n\n`;
    content += `_These projects are high-priority but have no send-ready contacts yet. Run enrichment or AI Search to find the right person before outreach._\n\n`;
    for (const p of discoveryItems) {
      content += renderProjectBlock(p, weekKey, userId, "discovery_needed");
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 3: MONITOR (optional, max 3)
  // ═══════════════════════════════════════════════════════════════
  if (monitorItems.length > 0) {
    content += `## 📋 Monitor (${monitorItems.length})\n\n`;
    content += `_Warm-pipeline projects to keep on your radar._\n\n`;
    for (const p of monitorItems) {
      content += renderProjectBlock(p, weekKey, userId, "monitor_only");
    }
  }

  // ── Key Contacts ──
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
 * Render a single project block in the email brief.
 * Adapts wording based on readiness classification.
 */
function renderProjectBlock(
  p: DigestProject & { relevanceScore: number },
  weekKey: string,
  userId: number,
  readiness: BriefReadiness,
): string {
  let block = "";
  const priorityEmoji = p.priority === "hot" ? "🔥" : p.priority === "warm" ? "🌡️" : "❄️";
  const newBadge = p.isNew ? " [NEW]" : "";
  const stageBadge = p.stageCode && p.stageCode !== "unknown" ? ` | ${p.stageCode.charAt(0).toUpperCase() + p.stageCode.slice(1)}` : "";
  const actCode = `ACT-${weekKey}-${userId}-${p.id}`;
  const siteUrl = getSiteUrl();

  block += `${priorityEmoji} **${p.name}**${newBadge}\n`;
  block += `   📍 ${p.location} | 💰 ${p.value}${stageBadge} | ${p.owner}\n`;
  block += `   Route: ${p.opportunityRoute} | Match: ${p.relevanceScore}% | Ref: ${actCode}\n`;
  block += `   🔗 [View project →](${siteUrl}/project/${p.id})\n`;

  if (p.overview) {
    block += `   ${p.overview.substring(0, 120)}...\n`;
  }

  // ── Readiness-specific messaging ──
  if (readiness === "action_ready" && p.bestContact) {
    const contact = p.bestContact;
    const contactPath = contact.email
      ? `Email: ${contact.email}`
      : contact.linkedin
        ? `[LinkedIn](${contact.linkedin})`
        : "";
    block += `   ✅ **Next step:** Reach out to **${contact.name}** (${contact.title}) — ${contactPath}\n`;
  } else if (readiness === "discovery_needed") {
    // Surface govFallbackStatus if available for more specific guidance
    const govStatus = (p as any).govFallbackStatus as string | null;
    const blockedReason = (p as any).enrichmentBlockedReason as string | null;
    if (govStatus === "government_fallback_role_only") {
      block += `   🏛️ **Government / Public Body** — roles identified, no named contact yet\n`;
      block += `   → Manual discovery needed: search LinkedIn for procurement/project delivery contacts at ${p.owner}\n`;
    } else if (govStatus === "government_fallback_no_result" || govStatus === "government_fallback_manual_review_required") {
      block += `   🏛️ **Government / Public Body** — no contact path found via automated discovery\n`;
      block += `   → Manual review required: check issuer website or tender portal for contact details\n`;
    } else if (blockedReason === "blocked_unknown_owner" || blockedReason === "blocked_dirty_owner_string") {
      block += `   ⚠️ **Owner Data Gap** — owner name too poor to enrich automatically\n`;
      block += `   → Check source data and update owner name to unlock enrichment\n`;
    } else {
      block += `   🔍 **Coverage Gap** — no send-ready contacts found yet\n`;
      block += `   → Open project card → Contacts tab → run enrichment or AI Search\n`;
    }
  } else if (readiness === "monitor_only") {
    // Minimal — no action line needed
  }

  block += `\n`;
  return block;
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
  if (!force && !dryRun) {
    const freshness = await checkPipelineFreshness(26);
    const isBlocked = freshness.status === "stale" || freshness.status === "failed" || freshness.status === "never_run";

    if (isBlocked) {
      const allowStaleFallback = process.env.DIGEST_STALE_FALLBACK === "true";

      if (!allowStaleFallback) {
        // Hard block: hold the digest and notify owner
        console.warn(
          `[EmailDigest] 🚫 FRESHNESS GATE: Monday digest HELD. Pipeline status: ${freshness.status}. Reason: ${freshness.blockedReason}`
        );
        try {
          const { notifyOwner } = await import("./_core/notification");
          await notifyOwner({
            title: "⚠️ Monday Digest HELD — Pipeline Freshness Gate",
            content: [
              `The Monday digest was blocked by the freshness gate and was NOT sent.`,
              `Pipeline status: **${freshness.status.toUpperCase()}**`,
              `Reason: ${freshness.blockedReason}`,
              `Last successful run: ${freshness.lastCompletedAt ? freshness.lastCompletedAt.toUTCString() : "never"}`,
              ``,
              `To override and send with stale data, set DIGEST_STALE_FALLBACK=true and trigger a manual send from the Admin panel.`,
            ].join("\n"),
          });
        } catch (notifyErr) {
          console.error("[EmailDigest] Failed to notify owner of freshness gate hold:", notifyErr);
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
          }));
        const { readiness, bestContact } = classifyBriefReadiness(
          { ...p, hasNoContacts },
          projectContacts,
        );
        return {
          ...p,
          hasNoContacts,
          briefReadiness: readiness,
          bestContact,
        };
      });

      const territories = (profile.territories as string[]) || [];

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
      // Attempt to finalise the slot as failed (may not exist if claim itself failed)
      if (user?.id) await finaliseDigestSendSlot(user.id, "monday", weekKey, "failed", { error: String(error) });
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
      });

      const hotProjects = matchedProjects.filter(p =>
        p.priority === "hot" || p.actionTier === "tier1_actionable"
      );

      // Get pipeline count
      const pipeline = await getPipelineClaimsByUser(user.id);

      const territories = (profile.territories as string[]) || [];

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

      const sent = await sendEmail({
        to: userEmail,
        subject,
        markdownContent: contentWithFreshness,
        textContent: contentWithFreshness,
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
      if (user?.id) await finaliseDigestSendSlot(user.id, "thursday", weekKey, "failed", { error: String(error) });
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
 * Bypasses the freshness gate and dedup guard (force send).
 * Logs the send to userEmailSendLog.
 */
export async function sendWeeklyDigestToUser(userId: number): Promise<{
  sent: boolean;
  subject: string;
  userName: string;
  error?: string;
} | null> {
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

    const sent = await sendEmail({
      to: userEmail,
      subject: preview.subject,
      markdownContent: preview.content,
      textContent: preview.content,
    });

    if (sent) {
      // Log the send — claim the slot first (INSERT IGNORE), then finalise to 'sent'
      const weekKey = getDigestWeekKey();
      await claimDigestSendSlot(userId, "monday", weekKey);
      // Always finalise regardless of whether claim returned true/false
      // (the row may already exist from a previous failed attempt)
      await finaliseDigestSendSlot(userId, "monday", weekKey, "sent", {});
      console.log(`[EmailDigest] ✓ Catch-up Monday digest sent to ${preview.userName} (${userEmail})`);
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
      }));
    const { readiness, bestContact } = classifyBriefReadiness(
      { ...p, hasNoContacts },
      projectContacts,
    );
    return { ...p, hasNoContacts, briefReadiness: readiness, bestContact };
  });

  const territories = (profile.territories as string[]) || [];
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
  });

  const territories = (profile.territories as string[]) || [];
  const matchedContacts = allContacts.filter(c => new Set(matchedProjects.map(p => p.name)).has(c.project));
  const pipeline = await getPipelineClaimsByUser(userId);

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
