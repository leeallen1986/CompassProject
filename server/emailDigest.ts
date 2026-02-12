/**
 * Email Digest Generator
 * Builds personalized intelligence summaries for each user based on their profile preferences.
 * Uses the built-in notification API to deliver digests.
 */
import { notifyOwner } from "./_core/notification";
import {
  getAllEnabledDigestUsers,
  getLatestReport,
  getProjectsByReportId,
  getContactsByReportId,
  getPipelineClaimsByUser,
  getDb,
} from "./db";
import { emailDigestPrefs } from "../drizzle/schema";
import { eq } from "drizzle-orm";

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
 * Score a project against a user's profile for relevance (0-100)
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
  }
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
      if (terr === "National") { matched = true; break; }
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

  // Priority boost
  if (project.priority === "hot") score += 10;
  if (project.priority === "warm") score += 5;

  // New project boost
  if (project.isNew) score += 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Generate a personalized digest for a single user
 */
function generateDigestContent(
  userName: string,
  reportWeek: string,
  matchedProjects: Array<DigestProject & { relevanceScore: number }>,
  matchedContacts: DigestContact[],
  pipelineCount: number,
  includeHotOnly: boolean,
  includeContacts: boolean,
  includePipelineUpdates: boolean,
): string {
  const filtered = includeHotOnly
    ? matchedProjects.filter(p => p.priority === "hot")
    : matchedProjects;

  const top10 = filtered.slice(0, 10);

  let content = `**Weekly Intelligence Digest — ${reportWeek}**\n\n`;
  content += `Hi ${userName || "there"},\n\n`;
  content += `Here are your personalized project matches for this week:\n\n`;

  // Summary stats
  const hotCount = filtered.filter(p => p.priority === "hot").length;
  const warmCount = filtered.filter(p => p.priority === "warm").length;
  const newCount = filtered.filter(p => p.isNew).length;
  content += `**Summary:** ${filtered.length} matching projects (${hotCount} hot, ${warmCount} warm, ${newCount} new this week)\n\n`;

  // Top projects
  content += `**Top Matching Projects:**\n\n`;
  for (const p of top10) {
    const priorityEmoji = p.priority === "hot" ? "🔥" : p.priority === "warm" ? "🌡️" : "❄️";
    const newBadge = p.isNew ? " [NEW]" : "";
    content += `${priorityEmoji} **${p.name}**${newBadge}\n`;
    content += `   📍 ${p.location} | 💰 ${p.value} | ${p.owner}\n`;
    content += `   Route: ${p.opportunityRoute} | Match: ${p.relevanceScore}%\n`;
    if (p.overview) {
      content += `   ${p.overview.substring(0, 120)}...\n`;
    }
    content += `\n`;
  }

  // Contacts
  if (includeContacts && matchedContacts.length > 0) {
    content += `\n**Key Contacts (${Math.min(matchedContacts.length, 5)} of ${matchedContacts.length}):**\n\n`;
    for (const c of matchedContacts.slice(0, 5)) {
      content += `• **${c.name}** — ${c.title} at ${c.company}`;
      if (c.email) content += ` (${c.email})`;
      content += `\n`;
    }
  }

  // Pipeline
  if (includePipelineUpdates && pipelineCount > 0) {
    content += `\n**Your Pipeline:** ${pipelineCount} active opportunities\n`;
  }

  content += `\n---\n`;
  content += `View the full dashboard for detailed project cards, contractor info, and source links.\n`;
  content += `Update your preferences in Settings to refine your matches.`;

  return content;
}

/**
 * Check if a digest was already sent within the user's frequency window.
 * Weekly: 6-day guard, Fortnightly: 13-day guard, Daily: 20-hour guard.
 */
function wasDigestSentRecently(lastSentAt: Date | null, frequency: string): boolean {
  if (!lastSentAt) return false;
  const guardMs: Record<string, number> = {
    daily: 20 * 60 * 60 * 1000,       // 20 hours
    weekly: 6 * 24 * 60 * 60 * 1000,  // 6 days
    fortnightly: 13 * 24 * 60 * 60 * 1000, // 13 days
  };
  const window = guardMs[frequency] ?? guardMs.weekly;
  return (Date.now() - lastSentAt.getTime()) < window;
}

/**
 * Update the lastSentAt timestamp for a user's digest preference
 */
async function markDigestSent(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(emailDigestPrefs)
    .set({ lastSentAt: new Date() })
    .where(eq(emailDigestPrefs.userId, userId));
}

/**
 * Send personalized digests to all enabled users
 * Called when a new report is published or via admin trigger.
 * Includes deduplication: skips users who already received a digest this week.
 */
export async function sendWeeklyDigests(force = false): Promise<{
  sent: number;
  failed: number;
  skipped: number;
  alreadySent: number;
}> {
  const results = { sent: 0, failed: 0, skipped: 0, alreadySent: 0 };

  // Get the latest report
  const report = await getLatestReport();
  if (!report) {
    console.warn("[EmailDigest] No report found, skipping digest");
    return results;
  }

  // Get all projects and contacts for this report
  const allProjects = await getProjectsByReportId(report.id);
  const allContacts = await getContactsByReportId(report.id);

  // Get all users with enabled digests
  const digestUsers = await getAllEnabledDigestUsers();

  for (const { pref, user, profile } of digestUsers) {
    if (!user || !profile) {
      results.skipped++;
      continue;
    }

    // Deduplication guard: skip if digest was already sent within the user's frequency window
    if (!force && wasDigestSentRecently(pref.lastSentAt, pref.frequency)) {
      results.alreadySent++;
      continue;
    }

    try {
      // Score projects for this user
      const scoredProjects = allProjects.map(p => ({
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
          },
          {
            territories: profile.territories as string[] | null,
            industries: profile.industries as string[] | null,
            offerCategories: profile.offerCategories as string[] | null,
            customerTypes: profile.customerTypes as string[] | null,
            dealSizeMin: profile.dealSizeMin,
            dealSizeMax: profile.dealSizeMax,
          }
        ),
      }));

      // Sort by relevance
      scoredProjects.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Filter to relevant projects (score > 40)
      const matchedProjects = scoredProjects.filter(p => p.relevanceScore > 40);

      if (matchedProjects.length === 0) {
        results.skipped++;
        continue;
      }

      // Get pipeline count
      const pipeline = await getPipelineClaimsByUser(user.id);

      // Get matched contacts (from same projects)
      const matchedProjectNames = new Set(matchedProjects.map(p => p.name));
      const matchedContacts = allContacts.filter(c => matchedProjectNames.has(c.project));

      // Generate the digest content
      const content = generateDigestContent(
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
        pref.includeHotOnly,
        pref.includeContacts,
        pref.includePipelineUpdates,
      );

      // Send via notification API
      const sent = await notifyOwner({
        title: `📊 Atlas Copco Intelligence — Week of ${report.weekEnding}`,
        content,
      });

      if (sent) {
        results.sent++;
        // Mark digest as sent for this user to prevent duplicates
        await markDigestSent(user.id);
      } else {
        results.failed++;
      }
    } catch (error) {
      console.error(`[EmailDigest] Failed for user ${user.id}:`, error);
      results.failed++;
    }
  }

  return results;
}
