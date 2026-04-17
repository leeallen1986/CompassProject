/**
 * templateService.ts — Campaign email template engine
 *
 * Provides:
 * - Merge field rendering (replace {{tokens}} with contact/campaign data)
 * - Template CRUD (one active template per campaign, upsert pattern)
 * - Per-contact draft generation from template
 * - Bulk "Generate All from Template" for an entire campaign
 */
import { getDb } from "./db";
import { campaignEmailTemplates, campaignContacts, campaigns, projects } from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";

// ── Merge Field Definitions ──

export const MERGE_FIELDS = [
  { token: "{{firstName}}", label: "First Name", description: "Contact's first name", example: "James" },
  { token: "{{lastName}}", label: "Last Name", description: "Contact's last name", example: "Wilson" },
  { token: "{{fullName}}", label: "Full Name", description: "Contact's full name", example: "James Wilson" },
  { token: "{{company}}", label: "Company", description: "Contact's company name", example: "BHP Group" },
  { token: "{{title}}", label: "Job Title", description: "Contact's job title", example: "Operations Manager" },
  { token: "{{email}}", label: "Email", description: "Contact's email address", example: "james.wilson@bhp.com" },
  { token: "{{projectName}}", label: "Project Name", description: "Matched project name", example: "Olympic Dam Expansion" },
  { token: "{{projectLocation}}", label: "Project Location", description: "Matched project location", example: "South Australia" },
  { token: "{{sector}}", label: "Sector", description: "Project sector", example: "Mining" },
  { token: "{{collateralName}}", label: "Collateral Name", description: "Campaign collateral product", example: "XAVS1800 High-Pressure Compressor" },
  { token: "{{senderName}}", label: "Sender Name", description: "Email sender's name", example: "Michael Chen" },
  { token: "{{senderTitle}}", label: "Sender Title", description: "Email sender's job title", example: "National Business Development Manager" },
  { token: "{{senderEmail}}", label: "Sender Email", description: "Email sender's email", example: "michael.chen@atlascopco.com" },
] as const;

export type MergeFieldToken = typeof MERGE_FIELDS[number]["token"];

// ── Merge Field Context ──

export interface MergeFieldContext {
  firstName: string;
  lastName: string;
  fullName: string;
  company: string;
  title: string;
  email: string;
  projectName: string;
  projectLocation: string;
  sector: string;
  collateralName: string;
  senderName: string;
  senderTitle: string;
  senderEmail: string;
}

/**
 * Build a merge field context from a campaign contact and campaign data.
 */
export function buildMergeContext(
  contact: {
    firstName?: string | null;
    lastName?: string | null;
    title?: string | null;
    company: string;
    reviewedCompanyName?: string | null;
    email?: string | null;
    enrichedEmail?: string | null;
    enrichedTitle?: string | null;
    matchedProjectIds?: number[] | null;
  },
  campaign: {
    senderName: string;
    senderEmail: string;
    senderTitle?: string | null;
    collateralName?: string | null;
  },
  matchedProject?: {
    name: string;
    location: string;
    sector: string;
  } | null,
): MergeFieldContext {
  const firstName = contact.firstName || "there";
  const lastName = contact.lastName || "";
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "there";
  const contactTitle = contact.enrichedTitle || contact.title || "";
  const contactEmail = contact.enrichedEmail || contact.email || "";
  const company = contact.reviewedCompanyName || contact.company;

  return {
    firstName,
    lastName,
    fullName,
    company,
    title: contactTitle,
    email: contactEmail,
    projectName: matchedProject?.name || company,
    projectLocation: matchedProject?.location || "Australia",
    sector: matchedProject?.sector || "resources",
    collateralName: campaign.collateralName || "our solutions",
    senderName: campaign.senderName,
    senderTitle: campaign.senderTitle || "Business Development Manager",
    senderEmail: campaign.senderEmail,
  };
}

/**
 * Render a template string by replacing all {{mergeField}} tokens with values.
 * Unknown tokens are left as-is.
 */
export function renderTemplate(template: string, context: MergeFieldContext): string {
  let result = template;
  for (const [key, value] of Object.entries(context)) {
    const token = `{{${key}}}`;
    result = result.split(token).join(value);
  }
  return result;
}

/**
 * Render a full email (subject + body) from a template and merge context.
 * Handles greeting and sign-off assembly.
 */
export function renderFullEmail(
  template: {
    subjectTemplate: string;
    bodyTemplate: string;
    greetingStyle: string;
    signOffStyle: string;
    senderSignature?: string | null;
  },
  context: MergeFieldContext,
): { subject: string; body: string } {
  const subject = renderTemplate(template.subjectTemplate, context);

  // Build body: greeting + body + sign-off + signature
  const greeting = renderTemplate(template.greetingStyle, context);
  const bodyContent = renderTemplate(template.bodyTemplate, context);
  const signOff = renderTemplate(template.signOffStyle, context);

  const signatureBlock = template.senderSignature
    ? renderTemplate(template.senderSignature, context)
    : `${context.senderName}\n${context.senderTitle}\nAtlas Copco Australia - Power Technique\n${context.senderEmail}`;

  const body = `${greeting}\n\n${bodyContent}\n\n${signOff}\n${signatureBlock}`;

  return { subject, body };
}

// ── Sample Context for Preview ──

export function getSampleContext(campaign?: {
  senderName?: string;
  senderEmail?: string;
  senderTitle?: string | null;
  collateralName?: string | null;
}): MergeFieldContext {
  return {
    firstName: "James",
    lastName: "Wilson",
    fullName: "James Wilson",
    company: "BHP Group",
    title: "Operations Manager",
    email: "james.wilson@bhp.com",
    projectName: "Olympic Dam Expansion",
    projectLocation: "South Australia",
    sector: "Mining",
    collateralName: campaign?.collateralName || "XAVS1800 High-Pressure Compressor",
    senderName: campaign?.senderName || "Michael Chen",
    senderTitle: campaign?.senderTitle || "National Business Development Manager",
    senderEmail: campaign?.senderEmail || "michael.chen@atlascopco.com",
  };
}

// ── Default Template ──

export function getDefaultTemplate(collateralName?: string): {
  subjectTemplate: string;
  bodyTemplate: string;
  greetingStyle: string;
  signOffStyle: string;
  senderSignature: string;
} {
  const productRef = collateralName || "our portable air solutions";
  return {
    subjectTemplate: `{{company}} — ${productRef} for {{projectName}}`,
    bodyTemplate: `I hope this finds you well. I'm reaching out regarding {{projectName}} in {{projectLocation}}, and I believe ${productRef} could add significant value to your operations.

Given your role as {{title}} at {{company}}, I thought you'd be interested in how we're supporting similar projects across Australia with reliable, high-performance equipment solutions.

I'd welcome the opportunity to discuss how we can support {{company}}'s requirements. Would you be available for a brief call this week?

I've attached our product overview for your reference.`,
    greetingStyle: "Hi {{firstName}},",
    signOffStyle: "Kind regards,",
    senderSignature: `{{senderName}}\n{{senderTitle}}\nAtlas Copco Australia - Power Technique\n{{senderEmail}}`,
  };
}

// ── Database Operations ──

/**
 * Get the active template for a campaign.
 */
export async function getCampaignTemplate(campaignId: number) {
  const db = await getDb();
  if (!db) return null;

  const [template] = await db
    .select()
    .from(campaignEmailTemplates)
    .where(and(
      eq(campaignEmailTemplates.campaignId, campaignId),
      eq(campaignEmailTemplates.isActive, true),
    ))
    .limit(1);

  return template || null;
}

/**
 * Upsert (create or update) a campaign template.
 * Deactivates any existing active templates for the campaign.
 */
export async function upsertCampaignTemplate(
  campaignId: number,
  data: {
    subjectTemplate: string;
    bodyTemplate: string;
    greetingStyle: string;
    signOffStyle: string;
    senderSignature?: string;
    name?: string;
  },
  userId: number,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check for existing active template
  const existing = await getCampaignTemplate(campaignId);

  if (existing) {
    // Update existing
    await db.update(campaignEmailTemplates).set({
      subjectTemplate: data.subjectTemplate,
      bodyTemplate: data.bodyTemplate,
      greetingStyle: data.greetingStyle,
      signOffStyle: data.signOffStyle,
      senderSignature: data.senderSignature ?? existing.senderSignature,
      name: data.name ?? existing.name,
    }).where(eq(campaignEmailTemplates.id, existing.id));

    return { ...existing, ...data };
  } else {
    // Create new
    const mergeFieldTokens = MERGE_FIELDS.map(f => f.token);
    const [result] = await db.insert(campaignEmailTemplates).values({
      campaignId,
      name: data.name || "Default Template",
      subjectTemplate: data.subjectTemplate,
      bodyTemplate: data.bodyTemplate,
      greetingStyle: data.greetingStyle,
      signOffStyle: data.signOffStyle,
      senderSignature: data.senderSignature || null,
      mergeFields: mergeFieldTokens,
      isActive: true,
      createdBy: userId,
    });

    return {
      id: result.insertId,
      campaignId,
      ...data,
    };
  }
}

/**
 * Delete (deactivate) a campaign template.
 */
export async function deleteCampaignTemplate(templateId: number) {
  const db = await getDb();
  if (!db) return;

  await db.update(campaignEmailTemplates).set({ isActive: false }).where(eq(campaignEmailTemplates.id, templateId));
}

/**
 * Generate a draft email for a single contact from the campaign template.
 * Returns the rendered subject and body, and saves to the contact record.
 */
export async function generateFromTemplate(
  contactId: number,
  templateOverride?: {
    subjectTemplate: string;
    bodyTemplate: string;
    greetingStyle: string;
    signOffStyle: string;
    senderSignature?: string | null;
  },
): Promise<{ subject: string; body: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [contact] = await db.select().from(campaignContacts).where(eq(campaignContacts.id, contactId));
  if (!contact) throw new Error("Contact not found");

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, contact.campaignId));
  if (!campaign) throw new Error("Campaign not found");

  // Get template (override or from DB)
  const template = templateOverride || await getCampaignTemplate(contact.campaignId);
  if (!template) throw new Error("No template found for this campaign. Create a template first.");

  // Get matched project if available
  let matchedProject: { name: string; location: string; sector: string } | null = null;
  if (contact.matchedProjectIds && (contact.matchedProjectIds as number[]).length > 0) {
    const matchedIds = contact.matchedProjectIds as number[];
    const [topProject] = await db
      .select({ name: projects.name, location: projects.location, sector: projects.sector })
      .from(projects)
      .where(inArray(projects.id, matchedIds.slice(0, 1)));
    if (topProject) {
      matchedProject = topProject;
    }
  }

  const context = buildMergeContext(contact, campaign, matchedProject);
  const { subject, body } = renderFullEmail(template, context);

  // Save draft to contact
  await db.update(campaignContacts).set({
    draftSubject: subject,
    draftBody: body,
    draftKeyPoints: [],
    draftTone: "template",
    draftGeneratedAt: new Date(),
    outreachStatus: "pending_approval",
  }).where(eq(campaignContacts.id, contactId));

  return { subject, body };
}

/**
 * Bulk generate drafts from template for all contacts in a campaign
 * that don't already have a draft (or optionally overwrite all).
 * Returns count of generated drafts.
 */
export async function bulkGenerateFromTemplate(
  campaignId: number,
  options?: { overwriteExisting?: boolean; onlyWithEmail?: boolean },
): Promise<{ generated: number; skipped: number; total: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) throw new Error("Campaign not found");

  const template = await getCampaignTemplate(campaignId);
  if (!template) throw new Error("No template found for this campaign. Create a template first.");

  // Get all contacts
  const allContacts = await db.select().from(campaignContacts)
    .where(eq(campaignContacts.campaignId, campaignId));

  let generated = 0;
  let skipped = 0;

  for (const contact of allContacts) {
    // Skip contacts without email if option set
    if (options?.onlyWithEmail) {
      const hasEmail = contact.enrichedEmail || contact.email;
      if (!hasEmail) {
        skipped++;
        continue;
      }
    }

    // Skip contacts that already have drafts unless overwrite is set
    if (!options?.overwriteExisting && contact.draftSubject && contact.draftBody) {
      skipped++;
      continue;
    }

    // Skip excluded contacts
    if (contact.tier === "excluded") {
      skipped++;
      continue;
    }

    try {
      // Get matched project
      let matchedProject: { name: string; location: string; sector: string } | null = null;
      if (contact.matchedProjectIds && (contact.matchedProjectIds as number[]).length > 0) {
        const matchedIds = contact.matchedProjectIds as number[];
        const [topProject] = await db
          .select({ name: projects.name, location: projects.location, sector: projects.sector })
          .from(projects)
          .where(inArray(projects.id, matchedIds.slice(0, 1)));
        if (topProject) matchedProject = topProject;
      }

      const context = buildMergeContext(contact, campaign, matchedProject);
      const { subject, body } = renderFullEmail(template, context);

      await db.update(campaignContacts).set({
        draftSubject: subject,
        draftBody: body,
        draftKeyPoints: [],
        draftTone: "template",
        draftGeneratedAt: new Date(),
        outreachStatus: "pending_approval",
      }).where(eq(campaignContacts.id, contact.id));

      generated++;
    } catch (err) {
      console.warn(`[Template] Failed to generate for contact ${contact.id}:`, err);
      skipped++;
    }
  }

  // Update campaign stats
  const stats = await db.select().from(campaignContacts)
    .where(eq(campaignContacts.campaignId, campaignId));
  const emailsDrafted = stats.filter(c => c.draftSubject && c.draftBody).length;
  await db.update(campaigns).set({ emailsDrafted }).where(eq(campaigns.id, campaignId));

  return { generated, skipped, total: allContacts.length };
}

/**
 * Preview how a template would render for a specific contact (without saving).
 */
export async function previewTemplateForContact(
  contactId: number,
  template: {
    subjectTemplate: string;
    bodyTemplate: string;
    greetingStyle: string;
    signOffStyle: string;
    senderSignature?: string | null;
  },
): Promise<{ subject: string; body: string; context: MergeFieldContext }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [contact] = await db.select().from(campaignContacts).where(eq(campaignContacts.id, contactId));
  if (!contact) throw new Error("Contact not found");

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, contact.campaignId));
  if (!campaign) throw new Error("Campaign not found");

  let matchedProject: { name: string; location: string; sector: string } | null = null;
  if (contact.matchedProjectIds && (contact.matchedProjectIds as number[]).length > 0) {
    const matchedIds = contact.matchedProjectIds as number[];
    const [topProject] = await db
      .select({ name: projects.name, location: projects.location, sector: projects.sector })
      .from(projects)
      .where(inArray(projects.id, matchedIds.slice(0, 1)));
    if (topProject) matchedProject = topProject;
  }

  const context = buildMergeContext(contact, campaign, matchedProject);
  const { subject, body } = renderFullEmail(template, context);

  return { subject, body, context };
}
