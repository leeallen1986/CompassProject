/**
 * campaignService.ts — Campaign management for targeted outreach
 *
 * Handles:
 * - Campaign CRUD
 * - Contact import from spreadsheet data
 * - Contact scoring and tiering
 * - Apollo enrichment queue (priority-ordered)
 * - Email generation with collateral context
 * - Approval workflow and sending
 */

import { eq, and, desc, asc, sql, inArray, isNull, or, gte, like } from "drizzle-orm";
import { getDb } from "./db";
import {
  campaigns, campaignContacts, collateralItems, collateralProjectMatches, projects,
  type InsertCampaign, type InsertCampaignContact,
  type Campaign, type CampaignContact,
} from "../drizzle/schema";
import { generateOutreachEmail, type OutreachInput, type OutreachResult } from "./outreachEmail";
import { apolloPeopleSearch, enrichSingleContact, logCreditUsage, type ApolloEnrichmentResult } from "./apolloEnrichment";
import { sendEmail } from "./emailSender";

// ── Scoring Constants ──

/** Title patterns that indicate blasting/coating specialists — highest relevance */
const BLASTING_TITLE_PATTERNS = [
  /blast/i, /paint(?:ing|er)?/i, /coat(?:ing|s)?/i, /surface\s*(treat|protect|prep)/i,
  /corrosion/i, /abrasive/i, /sandblast/i, /uhp/i, /nace/i,
];

/** Title patterns for decision makers — high relevance */
const DECISION_MAKER_PATTERNS = [
  /managing\s*director/i, /general\s*manager/i, /\bceo\b/i, /\bcoo\b/i,
  /\bdirector\b/i, /\bowner\b/i, /proprietor/i,
  /operations\s*manager/i, /project\s*manager/i, /project\s*director/i,
  /procurement/i, /purchasing/i, /supply\s*chain/i,
  /business\s*development/i, /commercial\s*manager/i,
  /fleet\s*manager/i, /equipment\s*manager/i,
  /maintenance\s*manager/i, /workshop\s*manager/i,
];

/** Title patterns for operations roles — medium relevance */
const OPERATIONS_PATTERNS = [
  /supervisor/i, /superintendent/i, /coordinator/i, /foreman/i,
  /estimator/i, /engineer/i, /inspector/i, /planner/i,
  /site\s*manager/i, /area\s*manager/i, /branch\s*manager/i,
  /production\s*manager/i, /factory\s*manager/i,
];

/** Titles to exclude — low value for outreach */
const EXCLUDE_TITLE_PATTERNS = [
  /^accounts?\s*(payable|receivable)?$/i, /^admin(istrat)?/i,
  /^store[s]?$/i, /^reception/i, /^office\s*manager/i,
  /customer\s*care/i, /^sales$/i, /^sales\s*rep/i,
];

// ── Title Classification ──

function classifyTitle(title: string | null | undefined): {
  relevance: "blasting_specialist" | "decision_maker" | "operations" | "other" | "unknown";
  score: number;
} {
  if (!title || !title.trim()) return { relevance: "unknown", score: 0 };
  const t = title.trim();

  // Check exclusions first
  for (const p of EXCLUDE_TITLE_PATTERNS) {
    if (p.test(t)) return { relevance: "other", score: 5 };
  }

  // Blasting specialists get highest score
  for (const p of BLASTING_TITLE_PATTERNS) {
    if (p.test(t)) return { relevance: "blasting_specialist", score: 40 };
  }

  // Decision makers
  for (const p of DECISION_MAKER_PATTERNS) {
    if (p.test(t)) return { relevance: "decision_maker", score: 35 };
  }

  // Operations
  for (const p of OPERATIONS_PATTERNS) {
    if (p.test(t)) return { relevance: "operations", score: 20 };
  }

  return { relevance: "other", score: 10 };
}

/** Compute composite score (0-100) for a campaign contact */
function computeScore(contact: {
  title?: string | null;
  email?: string | null;
  mobile?: string | null;
  matchedProjectCount?: number;
}): { score: number; tier: "tier1_hot" | "tier2_warm" | "tier3_enrich" | "tier4_low" | "excluded"; titleRelevance: "blasting_specialist" | "decision_maker" | "operations" | "other" | "unknown" } {
  const titleResult = classifyTitle(contact.title);
  let score = titleResult.score; // 0-40 from title

  // Data completeness bonus (up to 30 points)
  if (contact.email) score += 15;
  if (contact.mobile) score += 5;
  if (contact.title && contact.title.trim()) score += 10;

  // Project match bonus (up to 30 points)
  const matchCount = contact.matchedProjectCount ?? 0;
  if (matchCount > 0) score += Math.min(matchCount * 5, 30);

  // Cap at 100
  score = Math.min(score, 100);

  // Determine tier
  let tier: "tier1_hot" | "tier2_warm" | "tier3_enrich" | "tier4_low" | "excluded";
  if (score >= 60 && contact.email) {
    tier = "tier1_hot";
  } else if (score >= 40 && contact.email) {
    tier = "tier2_warm";
  } else if (score >= 20) {
    tier = "tier3_enrich";
  } else {
    tier = "tier4_low";
  }

  return { score, tier, titleRelevance: titleResult.relevance };
}

// ── Campaign CRUD ──

export async function createCampaign(input: {
  name: string;
  description?: string;
  collateralId?: number;
  collateralName?: string;
  senderName: string;
  senderEmail: string;
  senderTitle?: string;
  targetSegment?: string;
  createdBy: number;
}): Promise<Campaign> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(campaigns).values({
    name: input.name,
    description: input.description ?? null,
    collateralId: input.collateralId ?? null,
    collateralName: input.collateralName ?? null,
    senderName: input.senderName,
    senderEmail: input.senderEmail,
    senderTitle: input.senderTitle ?? null,
    targetSegment: input.targetSegment ?? null,
    createdBy: input.createdBy,
  });

  const id = Number(result[0].insertId);
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return campaign;
}

export async function getCampaign(id: number): Promise<Campaign | null> {
  const db = await getDb();
  if (!db) return null;
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return campaign ?? null;
}

export async function listCampaigns(): Promise<Campaign[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(campaigns).orderBy(desc(campaigns.createdAt));
}

export async function updateCampaignStatus(id: number, status: "draft" | "active" | "paused" | "completed"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(campaigns).set({ status }).where(eq(campaigns.id, id));
}

export async function updateCampaignStats(campaignId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const [stats] = await db.select({
    total: sql<number>`COUNT(*)`,
    enriched: sql<number>`SUM(CASE WHEN ${campaignContacts.enrichmentStatus} = 'enriched' OR ${campaignContacts.enrichmentStatus} = 'not_needed' THEN 1 ELSE 0 END)`,
    drafted: sql<number>`SUM(CASE WHEN ${campaignContacts.outreachStatus} != 'not_started' THEN 1 ELSE 0 END)`,
    approved: sql<number>`SUM(CASE WHEN ${campaignContacts.outreachStatus} = 'approved' OR ${campaignContacts.outreachStatus} = 'sent' THEN 1 ELSE 0 END)`,
    sent: sql<number>`SUM(CASE WHEN ${campaignContacts.outreachStatus} = 'sent' THEN 1 ELSE 0 END)`,
  })
    .from(campaignContacts)
    .where(eq(campaignContacts.campaignId, campaignId));

  await db.update(campaigns).set({
    totalContacts: Number(stats?.total ?? 0),
    enrichedContacts: Number(stats?.enriched ?? 0),
    emailsDrafted: Number(stats?.drafted ?? 0),
    emailsApproved: Number(stats?.approved ?? 0),
    emailsSent: Number(stats?.sent ?? 0),
  }).where(eq(campaigns.id, campaignId));
}

// ── Contact Import ──

export interface RawContactRow {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  company: string;
  reviewedCompanyName: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  nameCheckStatus: string | null;
  reviewNotes: string | null;
  sourceRow: number;
}

export async function importCampaignContacts(
  campaignId: number,
  contacts: RawContactRow[]
): Promise<{ imported: number; excluded: number; tierBreakdown: Record<string, number> }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let imported = 0;
  let excluded = 0;
  const tierBreakdown: Record<string, number> = {
    tier1_hot: 0,
    tier2_warm: 0,
    tier3_enrich: 0,
    tier4_low: 0,
    excluded: 0,
  };

  // Batch insert for performance
  const batch: InsertCampaignContact[] = [];

  for (const c of contacts) {
    // Skip non-company and do-not-use entries
    const status = (c.nameCheckStatus || "").toLowerCase();
    if (status.includes("non-company") || status.includes("do-not-use")) {
      excluded++;
      tierBreakdown.excluded++;
      continue;
    }

    // Skip entries with no name
    if (!c.firstName && !c.lastName) {
      excluded++;
      tierBreakdown.excluded++;
      continue;
    }

    const scoring = computeScore({
      title: c.title,
      email: c.email,
      mobile: c.mobile,
      matchedProjectCount: 0, // Will be updated after project matching
    });

    const enrichmentStatus = c.email ? "not_needed" : "pending";

    batch.push({
      campaignId,
      firstName: c.firstName,
      lastName: c.lastName,
      title: c.title,
      company: c.company,
      reviewedCompanyName: c.reviewedCompanyName,
      email: c.email,
      phone: c.phone,
      mobile: c.mobile,
      score: scoring.score,
      tier: scoring.tier,
      titleRelevance: scoring.titleRelevance,
      enrichmentStatus,
      outreachStatus: "not_started",
      sourceRow: c.sourceRow,
      nameCheckStatus: c.nameCheckStatus,
      reviewNotes: c.reviewNotes,
    });

    tierBreakdown[scoring.tier]++;
    imported++;
  }

  // Insert in batches of 500
  for (let i = 0; i < batch.length; i += 500) {
    const chunk = batch.slice(i, i + 500);
    await db.insert(campaignContacts).values(chunk);
  }

  // Update campaign stats
  await updateCampaignStats(campaignId);

  return { imported, excluded, tierBreakdown };
}

// ── Contact Queries ──

export async function getCampaignContacts(
  campaignId: number,
  options?: {
    tier?: string;
    outreachStatus?: string;
    enrichmentStatus?: string;
    search?: string;
    limit?: number;
    offset?: number;
    sortBy?: "score" | "company" | "tier" | "outreachStatus";
    sortDir?: "asc" | "desc";
  }
): Promise<{ contacts: CampaignContact[]; total: number }> {
  const db = await getDb();
  if (!db) return { contacts: [], total: 0 };

  const conditions = [eq(campaignContacts.campaignId, campaignId)];

  if (options?.tier) {
    conditions.push(eq(campaignContacts.tier, options.tier as any));
  }
  if (options?.outreachStatus) {
    conditions.push(eq(campaignContacts.outreachStatus, options.outreachStatus as any));
  }
  if (options?.enrichmentStatus) {
    conditions.push(eq(campaignContacts.enrichmentStatus, options.enrichmentStatus as any));
  }
  if (options?.search) {
    const q = `%${options.search}%`;
    conditions.push(
      or(
        like(campaignContacts.firstName, q),
        like(campaignContacts.lastName, q),
        like(campaignContacts.company, q),
        like(campaignContacts.reviewedCompanyName, q),
        like(campaignContacts.title, q),
        like(campaignContacts.email, q),
      )!
    );
  }

  const where = and(...conditions);

  // Count total
  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(campaignContacts)
    .where(where);
  const total = Number(countResult?.count ?? 0);

  // Sort
  let orderBy;
  const dir = options?.sortDir === "asc" ? asc : desc;
  switch (options?.sortBy) {
    case "company": orderBy = dir(campaignContacts.reviewedCompanyName); break;
    case "tier": orderBy = asc(campaignContacts.tier); break;
    case "outreachStatus": orderBy = asc(campaignContacts.outreachStatus); break;
    default: orderBy = desc(campaignContacts.score);
  }

  const contactsList = await db
    .select()
    .from(campaignContacts)
    .where(where)
    .orderBy(orderBy)
    .limit(options?.limit ?? 50)
    .offset(options?.offset ?? 0);

  return { contacts: contactsList, total };
}

export async function getCampaignContact(id: number): Promise<CampaignContact | null> {
  const db = await getDb();
  if (!db) return null;
  const [contact] = await db.select().from(campaignContacts).where(eq(campaignContacts.id, id));
  return contact ?? null;
}

export async function getCampaignStats(campaignId: number): Promise<{
  total: number;
  byTier: Record<string, number>;
  byOutreach: Record<string, number>;
  byEnrichment: Record<string, number>;
  byTitleRelevance: Record<string, number>;
}> {
  const db = await getDb();
  if (!db) return { total: 0, byTier: {}, byOutreach: {}, byEnrichment: {}, byTitleRelevance: {} };

  const allContacts = await db
    .select({
      tier: campaignContacts.tier,
      outreachStatus: campaignContacts.outreachStatus,
      enrichmentStatus: campaignContacts.enrichmentStatus,
      titleRelevance: campaignContacts.titleRelevance,
    })
    .from(campaignContacts)
    .where(eq(campaignContacts.campaignId, campaignId));

  const byTier: Record<string, number> = {};
  const byOutreach: Record<string, number> = {};
  const byEnrichment: Record<string, number> = {};
  const byTitleRelevance: Record<string, number> = {};

  for (const c of allContacts) {
    byTier[c.tier] = (byTier[c.tier] || 0) + 1;
    byOutreach[c.outreachStatus] = (byOutreach[c.outreachStatus] || 0) + 1;
    byEnrichment[c.enrichmentStatus] = (byEnrichment[c.enrichmentStatus] || 0) + 1;
    byTitleRelevance[c.titleRelevance] = (byTitleRelevance[c.titleRelevance] || 0) + 1;
  }

  return { total: allContacts.length, byTier, byOutreach, byEnrichment, byTitleRelevance };
}

// ── Email Generation ──

/**
 * Generate a personalised outreach email for a campaign contact.
 * Uses the XAVS1800 collateral context and project intelligence.
 */
export async function generateCampaignEmail(
  contactId: number,
  options?: {
    tone?: OutreachInput["tone"];
    collateralContext?: string;
    projectContext?: string;
  }
): Promise<OutreachResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [contact] = await db.select().from(campaignContacts).where(eq(campaignContacts.id, contactId));
  if (!contact) throw new Error("Contact not found");

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, contact.campaignId));
  if (!campaign) throw new Error("Campaign not found");

  // Get matched project context if available
  let projectName = "Abrasive Blasting Operations";
  let projectOverview = "";
  let projectLocation = "Australia";
  let projectSector = "infrastructure";
  let equipmentSignals: string[] = ["abrasive blasting", "surface preparation", "high-volume air"];

  if (contact.matchedProjectIds && (contact.matchedProjectIds as number[]).length > 0) {
    const matchedIds = contact.matchedProjectIds as number[];
    const matchedProjects = await db
      .select()
      .from(projects)
      .where(inArray(projects.id, matchedIds.slice(0, 3)));

    if (matchedProjects.length > 0) {
      const topProject = matchedProjects[0];
      projectName = topProject.name;
      projectOverview = topProject.overview || "";
      projectLocation = topProject.location;
      projectSector = topProject.sector;
      equipmentSignals = (topProject.equipmentSignals as string[]) || equipmentSignals;
    }
  }

  // Build collateral context for the LLM
  const collateralCtx = options?.collateralContext || `
The XAVS1800 is Atlas Copco's high-volume portable air compressor designed for demanding abrasive blasting operations:
- 1,800 cfm at 7 bar (or 1,500 cfm at 14 bar dual pressure)
- Built for continuous blasting operations requiring high air volumes
- Dual pressure capability for versatile applications
- Fuel-efficient design with low operating costs
- Ideal for: abrasive blasting, sandblasting, surface preparation, pipeline coating, shipyard maintenance
- Key differentiators: highest cfm-per-footprint ratio, dual pressure flexibility, proven reliability in harsh Australian conditions
`;

  const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Contact";
  const contactEmail = contact.enrichedEmail || contact.email || "";
  const contactTitle = contact.enrichedTitle || contact.title || "Operations";

  const result = await generateOutreachEmail({
    contactName,
    contactTitle,
    contactCompany: contact.reviewedCompanyName || contact.company,
    contactEmail,
    contactRoleBucket: inferRoleBucket(contactTitle),
    projectName,
    projectLocation,
    projectValue: "Unknown",
    projectSector,
    projectStage: null,
    projectOverview: projectOverview + "\n\n" + collateralCtx,
    equipmentSignals,
    opportunityRoute: "Direct CAPEX",
    matchedBusinessLines: ["Portable Air", "Sandblasting"],
    senderName: campaign.senderName,
    senderTitle: campaign.senderTitle || "National Business Development Manager",
    senderCompany: "Atlas Copco Australia - Power Technique",
    senderBusinessLines: ["Portable Air"],
    tone: options?.tone || "first_touch",
  });

  // Save draft to the contact record
  await db.update(campaignContacts).set({
    draftSubject: result.subject,
    draftBody: result.body,
    draftKeyPoints: result.keyPoints,
    draftTone: result.toneUsed,
    draftGeneratedAt: new Date(),
    outreachStatus: "pending_approval",
  }).where(eq(campaignContacts.id, contactId));

  return result;
}

/** Infer role bucket from title for outreach personalisation */
function inferRoleBucket(title: string): string {
  const t = title.toLowerCase();
  if (/blast|paint|coat|surface|corrosion|abrasive/i.test(t)) return "construction";
  if (/procurement|purchasing|supply/i.test(t)) return "procurement";
  if (/engineer/i.test(t)) return "engineering";
  if (/operations|ops/i.test(t)) return "operations";
  if (/project\s*manager|project\s*director/i.test(t)) return "project_management";
  if (/maintenance|workshop/i.test(t)) return "maintenance";
  if (/fleet|equipment/i.test(t)) return "fleet";
  if (/managing\s*director|general\s*manager|ceo|director|owner/i.test(t)) return "executive";
  return "other";
}

// ── Approval & Sending ──

export async function approveEmail(contactId: number, approvedBy: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(campaignContacts).set({
    outreachStatus: "approved",
    approvedAt: new Date(),
    approvedBy,
  }).where(eq(campaignContacts.id, contactId));
}

/**
 * Reject an email draft — pushes it back to draft status for regeneration.
 */
export async function rejectEmail(contactId: number, rejectedBy: number, reason?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(campaignContacts).set({
    outreachStatus: "rejected",
    draftSubject: null,
    draftBody: null,
    draftKeyPoints: null,
    draftTone: null,
    draftGeneratedAt: null,
    approvedAt: null,
    approvedBy: null,
  }).where(eq(campaignContacts.id, contactId));
}

export async function updateDraft(contactId: number, updates: {
  subject?: string;
  body?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const setValues: Record<string, any> = {};
  if (updates.subject !== undefined) setValues.draftSubject = updates.subject;
  if (updates.body !== undefined) setValues.draftBody = updates.body;
  if (Object.keys(setValues).length > 0) {
    await db.update(campaignContacts).set(setValues).where(eq(campaignContacts.id, contactId));
  }
}

export async function sendApprovedEmail(contactId: number): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database not available" };

  const [contact] = await db.select().from(campaignContacts).where(eq(campaignContacts.id, contactId));
  if (!contact) return { success: false, error: "Contact not found" };
  if (contact.outreachStatus !== "approved") return { success: false, error: "Email not approved yet" };

  const recipientEmail = contact.enrichedEmail || contact.email;
  if (!recipientEmail) return { success: false, error: "No email address available" };

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, contact.campaignId));
  if (!campaign) return { success: false, error: "Campaign not found" };

  const subject = contact.draftSubject || "Atlas Copco — High-Volume Air Solutions";
  const body = contact.draftBody || "";

  // Default-attach the XAVS1800 PDF collateral if the campaign has a linked collateral
  const attachments: { path: string; filename: string; contentType?: string }[] = [];
  try {
    if (campaign.collateralId) {
      const [collateral] = await db.select().from(collateralItems)
        .where(eq(collateralItems.id, campaign.collateralId));
      if (collateral && collateral.fileUrl) {
        attachments.push({
          path: collateral.fileUrl,
          filename: collateral.fileName || "atlas_copco_xavs1800_flyer.pdf",
          contentType: collateral.fileMimeType || "application/pdf",
        });
        console.log(`[Campaign] Attaching collateral: ${collateral.fileName} to email for ${recipientEmail}`);
      }
    } else {
      // Fallback: always attach the XAVS1800 flyer even if no collateral is linked
      const [xavs] = await db.select().from(collateralItems)
        .where(like(collateralItems.name, "%XAVS1800%"));
      if (xavs && xavs.fileUrl) {
        attachments.push({
          path: xavs.fileUrl,
          filename: xavs.fileName || "atlas_copco_xavs1800_flyer.pdf",
          contentType: xavs.fileMimeType || "application/pdf",
        });
        console.log(`[Campaign] Attaching XAVS1800 fallback collateral to email for ${recipientEmail}`);
      }
    }
  } catch (err) {
    console.warn("[Campaign] Failed to fetch collateral for attachment, sending without:", err);
  }

  const success = await sendEmail({
    to: recipientEmail,
    subject,
    markdownContent: body,
    textContent: body,
    attachments: attachments.length > 0 ? attachments : undefined,
  });

  if (success) {
    await db.update(campaignContacts).set({
      outreachStatus: "sent",
      sentAt: new Date(),
    }).where(eq(campaignContacts.id, contactId));

    // Update campaign stats
    await updateCampaignStats(contact.campaignId);
  }

  return { success, error: success ? undefined : "Failed to send email" };
}

/**
 * Mark an approved email as sent (for Outlook/external mail client flow).
 * Does NOT send via Resend — just updates the status to 'sent'.
 */
export async function markEmailAsSent(contactId: number): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database not available" };

  const [contact] = await db.select().from(campaignContacts).where(eq(campaignContacts.id, contactId));
  if (!contact) return { success: false, error: "Contact not found" };
  if (contact.outreachStatus !== "approved") return { success: false, error: "Email not approved yet" };

  await db.update(campaignContacts).set({
    outreachStatus: "sent",
    sentAt: new Date(),
  }).where(eq(campaignContacts.id, contactId));

  await updateCampaignStats(contact.campaignId);
  return { success: true };
}

// ── Project Matching ──

/**
 * Cross-reference campaign contacts against projects matched to the campaign's collateral.
 * Updates matchedProjectIds and matchedProjectCount on each contact.
 */
export async function matchContactsToProjects(campaignId: number): Promise<{ matched: number; total: number }> {
  const db = await getDb();
  if (!db) return { matched: 0, total: 0 };

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign || !campaign.collateralId) return { matched: 0, total: 0 };

  // Get projects matched to this collateral
  const projectMatches = await db
    .select({ projectId: collateralProjectMatches.projectId })
    .from(collateralProjectMatches)
    .where(eq(collateralProjectMatches.collateralId, campaign.collateralId));

  if (projectMatches.length === 0) return { matched: 0, total: 0 };

  const matchedProjectIds = projectMatches.map(m => m.projectId);

  // Get project details for fuzzy company matching
  const matchedProjects = await db
    .select({ id: projects.id, owner: projects.owner, name: projects.name })
    .from(projects)
    .where(inArray(projects.id, matchedProjectIds));

  // Get all campaign contacts
  const allContacts = await db
    .select({ id: campaignContacts.id, company: campaignContacts.company, reviewedCompanyName: campaignContacts.reviewedCompanyName })
    .from(campaignContacts)
    .where(eq(campaignContacts.campaignId, campaignId));

  let matched = 0;

  for (const contact of allContacts) {
    const companyName = (contact.reviewedCompanyName || contact.company || "").toLowerCase();
    if (!companyName) continue;

    const contactProjectIds: number[] = [];
    for (const proj of matchedProjects) {
      const ownerLower = (proj.owner || "").toLowerCase();
      // Fuzzy match: company name contains project owner or vice versa
      if (companyName.includes(ownerLower) || ownerLower.includes(companyName)) {
        contactProjectIds.push(proj.id);
      }
    }

    if (contactProjectIds.length > 0) {
      matched++;
      await db.update(campaignContacts).set({
        matchedProjectIds: contactProjectIds,
        matchedProjectCount: contactProjectIds.length,
      }).where(eq(campaignContacts.id, contact.id));

      // Rescore with project match bonus
      const [c] = await db.select().from(campaignContacts).where(eq(campaignContacts.id, contact.id));
      if (c) {
        const scoring = computeScore({
          title: c.title,
          email: c.email,
          mobile: c.mobile,
          matchedProjectCount: contactProjectIds.length,
        });
        await db.update(campaignContacts).set({
          score: scoring.score,
          tier: scoring.tier,
        }).where(eq(campaignContacts.id, contact.id));
      }
    }
  }

  await updateCampaignStats(campaignId);
  return { matched, total: allContacts.length };
}

// ── Apollo Enrichment for Campaign ──

/**
 * Enrich campaign contacts via Apollo — processes contacts in priority order.
 * Only enriches contacts that need email addresses.
 */
export async function enrichCampaignContacts(
  campaignId: number,
  options?: { maxContacts?: number; userId?: number; userName?: string }
): Promise<{ enriched: number; notFound: number; failed: number; creditsUsed: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const max = options?.maxContacts ?? 50;

  // Get contacts needing enrichment, ordered by score (highest first)
  const toEnrich = await db
    .select()
    .from(campaignContacts)
    .where(
      and(
        eq(campaignContacts.campaignId, campaignId),
        eq(campaignContacts.enrichmentStatus, "pending"),
      )
    )
    .orderBy(desc(campaignContacts.score))
    .limit(max);

  let enriched = 0;
  let notFound = 0;
  let failed = 0;
  let creditsUsed = 0;

  for (const contact of toEnrich) {
    try {
      const companyName = contact.reviewedCompanyName || contact.company;
      // Try to extract domain from existing email
      let domain: string | undefined;
      if (contact.email) {
        const match = contact.email.match(/@(.+)/);
        if (match) domain = match[1];
      }

      // Search Apollo for this person
      const searchResults = await apolloPeopleSearch({
        organizationDomains: domain ? [domain] : undefined,
        personTitles: contact.title ? [contact.title] : undefined,
        keywords: `${contact.firstName || ""} ${contact.lastName || ""} ${companyName}`.trim(),
        organizationLocations: ["australia"],
        perPage: 5,
      });

      if (!searchResults.people?.length) {
        await db.update(campaignContacts).set({
          enrichmentStatus: "not_found",
          enrichedAt: new Date(),
        }).where(eq(campaignContacts.id, contact.id));
        notFound++;
        continue;
      }

      // Find best match by name similarity
      const contactFullName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim().toLowerCase();
      let bestMatch = searchResults.people[0];
      for (const person of searchResults.people) {
        const personName = `${person.first_name} ${person.last_name_obfuscated || ""}`.trim().toLowerCase();
        if (personName.includes(contactFullName) || contactFullName.includes(person.first_name.toLowerCase())) {
          bestMatch = person;
          break;
        }
      }

      // Enrich the best match (1 credit)
      const apolloResult: ApolloEnrichmentResult = {
        contactId: contact.id,
        apolloId: bestMatch.id,
        name: `${bestMatch.first_name} ${bestMatch.last_name_obfuscated || ""}`.trim(),
        firstName: bestMatch.first_name,
        lastNameObfuscated: bestMatch.last_name_obfuscated,
        title: bestMatch.title,
        company: bestMatch.organization?.name || companyName,
        email: null,
        emailStatus: null,
        linkedinUrl: null,
        photoUrl: null,
        city: null,
        state: null,
        country: null,
        seniority: null,
        hasEmail: bestMatch.has_email,
        status: "found",
      };

      if (bestMatch.has_email) {
        const enrichedResult = await enrichSingleContact(apolloResult, {
          userId: options?.userId ?? 0,
          userName: options?.userName ?? "campaign_system",
        });

        if (enrichedResult.status === "enriched" && enrichedResult.email) {
          await db.update(campaignContacts).set({
            enrichmentStatus: "enriched",
            apolloPersonId: enrichedResult.apolloId,
            enrichedEmail: enrichedResult.email,
            enrichedTitle: enrichedResult.title,
            enrichedLinkedin: enrichedResult.linkedinUrl,
            enrichedAt: new Date(),
          }).where(eq(campaignContacts.id, contact.id));

          // Re-score with email now available
          const scoring = computeScore({
            title: enrichedResult.title || contact.title,
            email: enrichedResult.email,
            mobile: contact.mobile,
            matchedProjectCount: contact.matchedProjectCount,
          });
          await db.update(campaignContacts).set({
            score: scoring.score,
            tier: scoring.tier,
          }).where(eq(campaignContacts.id, contact.id));

          enriched++;
          creditsUsed++;
        } else {
          await db.update(campaignContacts).set({
            enrichmentStatus: "not_found",
            enrichedAt: new Date(),
          }).where(eq(campaignContacts.id, contact.id));
          notFound++;
        }
      } else {
        await db.update(campaignContacts).set({
          enrichmentStatus: "not_found",
          enrichedAt: new Date(),
        }).where(eq(campaignContacts.id, contact.id));
        notFound++;
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`[Campaign] Enrichment failed for contact ${contact.id}:`, err);
      await db.update(campaignContacts).set({
        enrichmentStatus: "failed",
        enrichedAt: new Date(),
      }).where(eq(campaignContacts.id, contact.id));
      failed++;
    }
  }

  await updateCampaignStats(campaignId);
  return { enriched, notFound, failed, creditsUsed };
}
