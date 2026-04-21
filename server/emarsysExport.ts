/**
 * Stage 6A — Atlas-to-Emarsys Export Engine
 *
 * Roles:
 *   Atlas  = targeting, gating, and eligibility decisions
 *   Emarsys = campaign execution (email delivery, reporting)
 *
 * This module is the ONLY place that decides whether a contact is eligible
 * for an Emarsys export. It must never be bypassed.
 *
 * Export modes:
 *   curated_marketing_export  — broader but still gated; for comms-managed sends
 *   sales_direct_export       — smaller direct follow-up list; for rep/manual use
 *
 * Hard eligibility rules (applied in order — first failing rule wins):
 *   Rule 1: Contact must be linked to ≥1 non-suppressed projectType='opportunity' project
 *   Rule 2: Contact must have a valid email address
 *   Rule 3: doNotContact must be false
 *   Rule 4: sendReadiness must NOT be 'blocked_from_send'
 *   Rule 5: outreachStatus must NOT be 'opted_out' or 'bounced'
 *   Rule 6: Title must not indicate retired / former status
 *   Rule 7: No unresolved suspicious domain mismatch (enrichmentQA flag)
 *   Rule 8: No unresolved duplicate / reused-email issue (enrichmentQA flag)
 *
 * Additional rule for curated_marketing_export:
 *   Rule 9 (curated only): emarsysApproved must be true OR tier must be tier1_hot/tier2_warm
 *
 * Admin override: passing `adminOverrideOpportunityGate: true` bypasses Rule 1 only.
 * No other rules can be bypassed without modifying this file.
 */

import { getDb } from "./db";
import {
  campaignContacts,
  campaigns,
  emarsysExportLogs,
  projects,
  type CampaignContact,
} from "../drizzle/schema";
import { eq, inArray, and } from "drizzle-orm";
import { storagePut } from "./storage";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExportMode = "curated_marketing_export" | "sales_direct_export";

export type ExclusionReason =
  | "no_opportunity_project"       // Rule 1
  | "missing_email"                // Rule 2
  | "do_not_contact"               // Rule 3
  | "blocked_from_send"            // Rule 4
  | "opted_out_or_bounced"         // Rule 5
  | "retired_former_title"         // Rule 6
  | "suspicious_domain_mismatch"   // Rule 7
  | "duplicate_email_unresolved"   // Rule 8
  | "not_approved_for_marketing";  // Rule 9 (curated only)

export interface EligibilityResult {
  contactId: number;
  eligible: boolean;
  exclusionReason: ExclusionReason | null;
}

export interface EmarsysRow {
  CD_identifier: string;          // "atlas-cc-{contactId}-{campaignId}"
  Email: string;
  "First Name": string;
  "Last Name": string;
  CD_divisionDetails: string;     // e.g. "Atlas Copco"
  CD_salesOrgDetails: string;     // e.g. "AU30"
  "IETF language tag": string;    // e.g. "en"
  "Country or region": string;    // e.g. "Australia"
  // Extended fields (not required by Emarsys core but useful for comms manager)
  Company: string;
  Title: string;
  CampaignName: string;
  CollateralName: string;
  ExportTimestamp: string;        // ISO 8601
  ExportOwner: string;
  ExportMode: ExportMode;
}

export interface ExportDefaults {
  divisionLabel: string;          // default: "Atlas Copco"
  salesOrg: string;               // default: "AU30"
  languageTag: string;            // default: "en"
  countryRegion: string;          // default: "Australia"
  collateralName?: string;
}

export interface ExportOptions {
  campaignId: number;
  exportMode: ExportMode;
  exportedByUserId: number;
  exportedByName: string;
  defaults: ExportDefaults;
  /** If true, bypasses Rule 1 (opportunity project gate) only. Admin-only. */
  adminOverrideOpportunityGate?: boolean;
  /** If provided, only export these specific contact IDs */
  contactIdFilter?: number[];
}

export interface ExportPreview {
  totalCampaignContacts: number;
  eligibleCount: number;
  excludedCount: number;
  exclusionBreakdown: Record<ExclusionReason, number>;
  eligibleContactIds: number[];
}

export interface ExportResult {
  exportLogId: number;
  exportedCount: number;
  excludedCount: number;
  exclusionBreakdown: Record<ExclusionReason, number>;
  csvUrl: string;
  csvKey: string;
  rows: EmarsysRow[];
}

// ─── Retired/Former title patterns ────────────────────────────────────────────

const RETIRED_FORMER_PATTERNS = [
  /\bformer\b/i,
  /\bretired\b/i,
  /\bex[-\s]/i,
  /\bprevious(ly)?\b/i,
  /\bpast\s+(ceo|coo|cfo|gm|director|manager)\b/i,
];

function isRetiredFormerTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return RETIRED_FORMER_PATTERNS.some(p => p.test(title));
}

// ─── Eligibility engine ───────────────────────────────────────────────────────

/**
 * Evaluate a single contact against all hard eligibility rules.
 * Returns the first failing rule or null if all rules pass.
 *
 * @param contact  - The campaignContact row
 * @param hasOpportunityProject - Whether this contact is linked to ≥1 non-suppressed opportunity project
 * @param mode     - Export mode
 * @param adminOverrideOpportunityGate - Bypass Rule 1 (admin only)
 */
export function evaluateEligibility(
  contact: {
    id: number;
    email: string | null;
    enrichedEmail: string | null;
    doNotContact: boolean;
    sendReadiness: string | null;
    outreachStatus: string;
    title: string | null;
    enrichedTitle: string | null;
    enrichmentQA: unknown;
    emarsysApproved: boolean;
    tier: string;
  },
  hasOpportunityProject: boolean,
  mode: ExportMode,
  adminOverrideOpportunityGate = false
): EligibilityResult {
  const effectiveEmail = contact.enrichedEmail || contact.email;

  // Rule 1: Must be linked to a non-suppressed opportunity project
  if (!adminOverrideOpportunityGate && !hasOpportunityProject) {
    return { contactId: contact.id, eligible: false, exclusionReason: "no_opportunity_project" };
  }

  // Rule 2: Must have a valid email
  if (!effectiveEmail || !effectiveEmail.includes("@")) {
    return { contactId: contact.id, eligible: false, exclusionReason: "missing_email" };
  }

  // Rule 3: doNotContact flag
  if (contact.doNotContact) {
    return { contactId: contact.id, eligible: false, exclusionReason: "do_not_contact" };
  }

  // Rule 4: Not blocked_from_send
  if (contact.sendReadiness === "blocked_from_send") {
    return { contactId: contact.id, eligible: false, exclusionReason: "blocked_from_send" };
  }

  // Rule 5: Not opted_out or bounced
  if (contact.outreachStatus === "opted_out" || contact.outreachStatus === "bounced") {
    return { contactId: contact.id, eligible: false, exclusionReason: "opted_out_or_bounced" };
  }

  // Rule 6: Retired/former title
  const effectiveTitle = contact.enrichedTitle || contact.title;
  if (isRetiredFormerTitle(effectiveTitle)) {
    return { contactId: contact.id, eligible: false, exclusionReason: "retired_former_title" };
  }

  // Rule 7: Suspicious domain mismatch (from enrichmentQA)
  const qa = contact.enrichmentQA as Record<string, unknown> | null;
  if (qa?.domainMismatch === true && qa?.domainMismatchResolved !== true) {
    return { contactId: contact.id, eligible: false, exclusionReason: "suspicious_domain_mismatch" };
  }

  // Rule 8: Duplicate/reused email unresolved
  if (qa?.duplicateEmail === true && qa?.duplicateEmailResolved !== true) {
    return { contactId: contact.id, eligible: false, exclusionReason: "duplicate_email_unresolved" };
  }

  // Rule 9 (curated_marketing_export only): Must be explicitly approved OR tier1/tier2
  if (mode === "curated_marketing_export") {
    const isHighTier = contact.tier === "tier1_hot" || contact.tier === "tier2_warm";
    if (!contact.emarsysApproved && !isHighTier) {
      return { contactId: contact.id, eligible: false, exclusionReason: "not_approved_for_marketing" };
    }
  }

  return { contactId: contact.id, eligible: true, exclusionReason: null };
}

// ─── Field mapper ─────────────────────────────────────────────────────────────

/**
 * Map an Atlas campaignContact row to the Emarsys-ready row structure.
 * All defaults are configurable — nothing is hardcoded.
 */
export function mapToEmarsysRow(
  contact: {
    id: number;
    campaignId: number;
    firstName: string | null;
    lastName: string | null;
    title: string | null;
    enrichedTitle: string | null;
    company: string;
    reviewedCompanyName: string | null;
    email: string | null;
    enrichedEmail: string | null;
    tier: string;
  },
  campaignName: string,
  defaults: ExportDefaults,
  exportedByName: string,
  exportMode: ExportMode
): EmarsysRow {
  const effectiveEmail = contact.enrichedEmail || contact.email || "";
  const effectiveTitle = contact.enrichedTitle || contact.title || "";
  const effectiveCompany = contact.reviewedCompanyName || contact.company;

  return {
    CD_identifier: `atlas-cc-${contact.id}-${contact.campaignId}`,
    Email: effectiveEmail,
    "First Name": contact.firstName || "",
    "Last Name": contact.lastName || "",
    CD_divisionDetails: defaults.divisionLabel,
    CD_salesOrgDetails: defaults.salesOrg,
    "IETF language tag": defaults.languageTag,
    "Country or region": defaults.countryRegion,
    Company: effectiveCompany,
    Title: effectiveTitle,
    CampaignName: campaignName,
    CollateralName: defaults.collateralName || "",
    ExportTimestamp: new Date().toISOString(),
    ExportOwner: exportedByName,
    ExportMode: exportMode,
  };
}

// ─── CSV builder ──────────────────────────────────────────────────────────────

const EMARSYS_COLUMNS: (keyof EmarsysRow)[] = [
  "CD_identifier",
  "Email",
  "First Name",
  "Last Name",
  "CD_divisionDetails",
  "CD_salesOrgDetails",
  "IETF language tag",
  "Country or region",
  "Company",
  "Title",
  "CampaignName",
  "CollateralName",
  "ExportTimestamp",
  "ExportOwner",
  "ExportMode",
];

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCSV(rows: EmarsysRow[]): string {
  const header = EMARSYS_COLUMNS.join(",");
  const dataRows = rows.map(row =>
    EMARSYS_COLUMNS.map(col => escapeCSV(String(row[col] ?? ""))).join(",")
  );
  return [header, ...dataRows].join("\n");
}

// ─── Exclusion report builder ─────────────────────────────────────────────────

export function buildExclusionReport(
  results: EligibilityResult[]
): Record<ExclusionReason, number> {
  const breakdown: Record<ExclusionReason, number> = {
    no_opportunity_project: 0,
    missing_email: 0,
    do_not_contact: 0,
    blocked_from_send: 0,
    opted_out_or_bounced: 0,
    retired_former_title: 0,
    suspicious_domain_mismatch: 0,
    duplicate_email_unresolved: 0,
    not_approved_for_marketing: 0,
  };
  for (const r of results) {
    if (!r.eligible && r.exclusionReason) {
      breakdown[r.exclusionReason] = (breakdown[r.exclusionReason] || 0) + 1;
    }
  }
  return breakdown;
}

// ─── Preview (dry-run, no DB writes) ─────────────────────────────────────────

export async function previewEmarsysExport(
  options: Omit<ExportOptions, "exportedByUserId" | "exportedByName">
): Promise<ExportPreview> {
  const { campaignId, exportMode, defaults, adminOverrideOpportunityGate, contactIdFilter } = options;

  // Fetch contacts
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const contacts = await db
    .select()
    .from(campaignContacts)
    .where(
      contactIdFilter?.length
        ? and(eq(campaignContacts.campaignId, campaignId), inArray(campaignContacts.id, contactIdFilter))
        : eq(campaignContacts.campaignId, campaignId)
    );

  // Fetch matched project types for Rule 1
  const opportunityProjectMap = await buildOpportunityProjectMap(contacts);

  const results: EligibilityResult[] = contacts.map((c: CampaignContact) =>
    evaluateEligibility(
      c,
      opportunityProjectMap.has(c.id),
      exportMode,
      adminOverrideOpportunityGate
    )
  );

  const eligible = results.filter(r => r.eligible);
  const excluded = results.filter(r => !r.eligible);

  return {
    totalCampaignContacts: contacts.length,
    eligibleCount: eligible.length,
    excludedCount: excluded.length,
    exclusionBreakdown: buildExclusionReport(results),
    eligibleContactIds: eligible.map(r => r.contactId),
  };
}

// ─── Full export (writes DB, uploads CSV) ────────────────────────────────────

export async function generateEmarsysExport(
  options: ExportOptions
): Promise<ExportResult> {
  const {
    campaignId,
    exportMode,
    exportedByUserId,
    exportedByName,
    defaults,
    adminOverrideOpportunityGate,
    contactIdFilter,
  } = options;

  // 1. Fetch campaign metadata
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [campaign] = await db
    .select({ name: campaigns.name, collateralName: campaigns.collateralName })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const effectiveDefaults: ExportDefaults = {
    ...defaults,
    collateralName: defaults.collateralName || campaign.collateralName || "",
  };

  // 2. Fetch contacts
  const allContacts = await db
    .select()
    .from(campaignContacts)
    .where(
      contactIdFilter?.length
        ? and(eq(campaignContacts.campaignId, campaignId), inArray(campaignContacts.id, contactIdFilter))
        : eq(campaignContacts.campaignId, campaignId)
    );

  // 3. Build opportunity project map for Rule 1
  const opportunityProjectMap = await buildOpportunityProjectMap(allContacts);

  // 4. Evaluate eligibility
  const results: EligibilityResult[] = allContacts.map((c: CampaignContact) =>
    evaluateEligibility(
      c,
      opportunityProjectMap.has(c.id),
      exportMode,
      adminOverrideOpportunityGate
    )
  );

  const eligibleIds = new Set(results.filter(r => r.eligible).map(r => r.contactId));
  const eligibleContacts = allContacts.filter((c: CampaignContact) => eligibleIds.has(c.id));

  // 5. Map to Emarsys rows
  const rows: EmarsysRow[] = eligibleContacts.map((c: CampaignContact) =>
    mapToEmarsysRow(c, campaign.name, effectiveDefaults, exportedByName, exportMode)
  );

  // 6. Build CSV
  const csv = buildCSV(rows);

  // 7. Upload to S3
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileKey = `emarsys-exports/campaign-${campaignId}/${exportMode}-${timestamp}.csv`;
  const { url: csvUrl } = await storagePut(fileKey, Buffer.from(csv, "utf-8"), "text/csv");

  // 8. Build exclusion report
  const exclusionBreakdown = buildExclusionReport(results);

  // 9. Write export log
  const [logResult] = await db.insert(emarsysExportLogs).values({
    campaignId,
    campaignName: campaign.name,
    exportMode,
    divisionLabel: effectiveDefaults.divisionLabel,
    salesOrg: effectiveDefaults.salesOrg,
    languageTag: effectiveDefaults.languageTag,
    countryRegion: effectiveDefaults.countryRegion,
    collateralName: effectiveDefaults.collateralName,
    totalCampaignContacts: allContacts.length,
    exportedCount: eligibleContacts.length,
    excludedCount: allContacts.length - eligibleContacts.length,
    exclusionBreakdown,
    templateVersion: "6A-v1",
    exportFileKey: fileKey,
    exportFileUrl: csvUrl,
    exportedBy: exportedByUserId,
    exportedByName,
  });

  const exportLogId = (logResult as { insertId: number }).insertId;

  // 10. Stamp lastExportedAt and lastExportLogId on exported contacts
  if (eligibleContacts.length > 0) {
    await db
      .update(campaignContacts)
      .set({ lastExportedAt: new Date(), lastExportLogId: exportLogId })
      .where(inArray(campaignContacts.id, eligibleContacts.map(c => c.id)));
  }

  return {
    exportLogId,
    exportedCount: eligibleContacts.length,
    excludedCount: allContacts.length - eligibleContacts.length,
    exclusionBreakdown,
    csvUrl,
    csvKey: fileKey,
    rows,
  };
}

// ─── Helper: build opportunity project map ────────────────────────────────────

/**
 * For a list of contacts, determine which ones are linked to at least one
 * non-suppressed projectType='opportunity' project via matchedProjectIds.
 *
 * Returns a Set of contactIds that pass Rule 1.
 */
async function buildOpportunityProjectMap(
  contacts: Array<{ id: number; matchedProjectIds: unknown }>
): Promise<Set<number>> {
  // Collect all referenced project IDs
  const allProjectIds = new Set<number>();
  const contactToProjectIds = new Map<number, number[]>();

  for (const c of contacts) {
    const ids = Array.isArray(c.matchedProjectIds)
      ? (c.matchedProjectIds as number[])
      : [];
    contactToProjectIds.set(c.id, ids);
    ids.forEach((id: number) => allProjectIds.add(id));
  }

  if (allProjectIds.size === 0) {
    // No project links at all — no contact passes Rule 1
    return new Set();
  }

  // Fetch projects that are non-suppressed opportunities
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const opportunityProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        inArray(projects.id, Array.from(allProjectIds)),
        eq(projects.projectType, "opportunity"),
        eq(projects.suppressed, false)
      )
    );

  const opportunityProjectIds = new Set(opportunityProjects.map((p: { id: number }) => p.id));

  // Build the result set: contacts that have ≥1 opportunity project
  const result = new Set<number>();
  const entries = Array.from(contactToProjectIds.entries());
  for (const [contactId, projectIds] of entries) {
    if (projectIds.some((pid: number) => opportunityProjectIds.has(pid))) {
      result.add(contactId);
    }
  }
  return result;
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export async function getExportLogs(campaignId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select()
    .from(emarsysExportLogs)
    .where(eq(emarsysExportLogs.campaignId, campaignId))
    .orderBy(emarsysExportLogs.createdAt);
}

export async function toggleEmarsysApproval(
  contactId: number,
  approved: boolean,
  approvedByUserId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .update(campaignContacts)
    .set({
      emarsysApproved: approved,
      emarsysApprovedAt: approved ? new Date() : null,
      emarsysApprovedBy: approved ? approvedByUserId : null,
    })
    .where(eq(campaignContacts.id, contactId));
}
