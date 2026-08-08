/**
 * Lusha Contact Enrichment Service — Stage 4 Fallback
 *
 * PURPOSE: Last-resort contact enrichment for top visible projects where
 *          Apollo (Stage 1) and Hunter (Stage 3) failed to produce send_ready contacts.
 *
 * Constraints:
 *   - Only triggered for HOLD/near-HOLD reps due to contact gap
 *   - Only for top visible projects with high lane fit + commercially sensible
 *   - Budget: max 10 credits/day across all reps (conservative)
 *   - Cooldown: 14 days per project (longer than Apollo's 7-day cooldown)
 *   - Dedup: skip contacts already enriched by Apollo/Hunter
 *
 * API: GET https://api.lusha.com/v2/person
 *   Headers: api_key: <key>
 *   Params: firstName, lastName, companyName (or linkedinUrl)
 *   Returns: email, confidence, phone, title, company, location
 *
 * Trust promotion:
 *   - Only an explicit high-confidence Lusha email is verification evidence
 *   - Persisted send_ready additionally requires allowed provenance, no
 *     rejection, crmOrphan=false and an exact contactProjects link
 *   - Lower-confidence email found → store it as named_unverified
 *   - No email found → keep current tier, log attempt
 */
import { eq, and, sql, gte, desc } from "drizzle-orm";
import { getDb } from "./db";
import { contacts, contactProjects, projects, lushaEnrichmentLog } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { resolvePersistedContactTrustTier } from "./contactTrustPromotionBoundary";

// ── Configuration ──
const LUSHA_BASE_URL = "https://api.lusha.com";
export const LUSHA_DAILY_BUDGET = 10;
const LUSHA_DAILY_CAP = LUSHA_DAILY_BUDGET; // Very conservative — Lusha credits are expensive
export const LUSHA_COOLDOWN_DAYS = 14; // Longer cooldown than Apollo (7 days)
const DELAY_BETWEEN_CALLS_MS = 800; // Respect 25 req/s rate limit with margin
export const LUSHA_RESCUE_MAX_CREDITS_PER_RUN = 5; // Max credits per single rescue run
const MAX_CONTACTS_PER_PROJECT = 3; // Don't over-enrich a single project

// ── Types ──
export interface LushaPersonResult {
  email?: string;
  emailConfidence?: string | null;
  phone?: string;
  title?: string;
  company?: string;
  location?: string;
  firstName?: string;
  lastName?: string;
}

export interface LushaEnrichmentResult {
  contactId: number;
  contactName: string;
  projectId: number;
  projectName: string;
  status: "enriched" | "not_found" | "failed" | "skipped_dedup" | "skipped_budget" | "skipped_cooldown";
  email?: string;
  phone?: string;
  title?: string;
  promoted: boolean;
  error?: string;
  creditsUsed: number;
}

export interface LushaRescueResult {
  projectId: number;
  projectName: string;
  contactsAttempted: number;
  contactsEnriched: number;
  contactsPromoted: number;
  creditsUsed: number;
  results: LushaEnrichmentResult[];
}

export interface LushaRescueSummary {
  projectsAttempted: number;
  totalCreditsUsed: number;
  totalPromoted: number;
  dailyBudgetRemaining: number;
  results: LushaRescueResult[];
}

// ── Helpers ──
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isLushaEmailVerified(confidence: string | null | undefined): boolean {
  return confidence?.trim().toLowerCase() === "high";
}

function lushaVerificationScore(confidence: string | null | undefined): number {
  const normalised = confidence?.trim().toLowerCase();
  if (normalised === "high") return 95;
  if (normalised === "medium") return 60;
  if (normalised === "low") return 40;
  return 0;
}

/**
 * Call Lusha Person API to enrich a single contact.
 * Supports two lookup modes:
 *   1. LinkedIn URL lookup (preferred for privacy-restricted contacts)
 *   2. Name + company lookup (fallback)
 */
async function lushaPersonLookup(
  firstName: string,
  lastName: string,
  company: string,
  linkedinUrl?: string,
): Promise<LushaPersonResult | null> {
  const apiKey = ENV.lushaApiKey;
  if (!apiKey) {
    throw new Error("LUSHA_API_KEY not configured");
  }

  // Prefer LinkedIn URL lookup when available — more accurate for privacy-restricted contacts
  const params = linkedinUrl
    ? new URLSearchParams({ linkedinUrl })
    : new URLSearchParams({ firstName, lastName, companyName: company });

  const response = await fetch(`${LUSHA_BASE_URL}/v2/person?${params.toString()}`, {
    method: "GET",
    headers: {
      "api_key": apiKey,
      "Accept": "application/json",
    },
  });

  if (response.status === 404) {
    return null; // Person not found
  }

  if (response.status === 429) {
    throw new Error("Lusha rate limit exceeded");
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Lusha API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const payload = data?.data ?? data;
  const emailRecord = Array.isArray(payload?.emailAddresses)
    ? payload.emailAddresses.find((entry: any) => typeof entry?.email === "string" && entry.email.trim())
    : null;

  return {
    email: emailRecord?.email || payload?.email || null,
    emailConfidence:
      emailRecord?.emailConfidence ||
      emailRecord?.confidence ||
      payload?.emailConfidence ||
      null,
    phone: payload?.phoneNumbers?.[0]?.internationalNumber || payload?.phone || null,
    title: payload?.currentJobTitle || payload?.title || null,
    company: payload?.currentCompanyName || payload?.company || null,
    location: payload?.location || null,
    firstName: payload?.firstName || firstName,
    lastName: payload?.lastName || lastName,
  };
}

/**
 * Get today's Lusha credit usage from the log table.
 */
async function getLushaDailyUsage(): Promise<number> {
  const db = await getDb();
  if (!db) return LUSHA_DAILY_CAP; // Assume maxed if no DB

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${lushaEnrichmentLog.creditsUsed}), 0)` })
    .from(lushaEnrichmentLog)
    .where(gte(lushaEnrichmentLog.createdAt, todayStart));

  return row?.total ?? 0;
}

/**
 * Check if a project is in Lusha cooldown (enriched within LUSHA_COOLDOWN_DAYS).
 */
async function isProjectInCooldown(projectId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return true; // Assume cooldown if no DB

  const cooldownDate = new Date();
  cooldownDate.setDate(cooldownDate.getDate() - LUSHA_COOLDOWN_DAYS);

  const [row] = await db
    .select({ id: lushaEnrichmentLog.id })
    .from(lushaEnrichmentLog)
    .where(
      and(
        eq(lushaEnrichmentLog.projectId, projectId),
        gte(lushaEnrichmentLog.createdAt, cooldownDate),
      )
    )
    .limit(1);

  return !!row;
}

/**
 * Check if a contact was already enriched by Lusha (dedup).
 */
async function isContactAlreadyLushaEnriched(contactId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;

  const [row] = await db
    .select({ id: lushaEnrichmentLog.id })
    .from(lushaEnrichmentLog)
    .where(eq(lushaEnrichmentLog.contactId, contactId))
    .limit(1);

  return !!row;
}

/**
 * Split a full name into first/last name parts.
 */
function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

/**
 * Enrich contacts for a single project via Lusha.
 * Only enriches contacts that:
 *   - Are NOT already send_ready
 *   - Have a real name (not LLM-inferred junk)
 *   - Are not rejected or CRM-orphaned
 *   - Have NOT been Lusha-enriched before (dedup)
 *   - Belong to a project NOT in cooldown
 *
 * Returns enrichment results with promotion status.
 */
export async function lushaEnrichProjectContacts(
  projectId: number,
  projectName: string,
  options?: {
    maxContacts?: number;
    budgetRemaining?: number;
  },
): Promise<LushaRescueResult> {
  const db = await getDb();
  const result: LushaRescueResult = {
    projectId,
    projectName,
    contactsAttempted: 0,
    contactsEnriched: 0,
    contactsPromoted: 0,
    creditsUsed: 0,
    results: [],
  };

  if (!db) return result;
  if (!ENV.lushaApiKey) {
    console.warn("[Lusha] No LUSHA_API_KEY configured — skipping");
    return result;
  }

  // Check project cooldown
  if (await isProjectInCooldown(projectId)) {
    console.log(`[Lusha] Project ${projectId} (${projectName}) in cooldown — skipping`);
    return result;
  }

  const maxContacts = options?.maxContacts ?? MAX_CONTACTS_PER_PROJECT;
  let budgetRemaining = options?.budgetRemaining ?? (LUSHA_DAILY_CAP - await getLushaDailyUsage());

  if (budgetRemaining <= 0) {
    console.log(`[Lusha] Daily budget exhausted — skipping project ${projectName}`);
    return result;
  }

  // Get contacts for this project that need enrichment
  // Priority: named contacts without verified email, not LLM-inferred
  // Include linkedin/linkedinProfileUrl for LinkedIn URL lookup mode
  const projectContacts = await db.execute(sql`
    SELECT c.id, c.name, c.company, c.title, c.email, c.enrichmentStatus, c.enrichmentSource,
           c.contactTrustTier, c.roleBucket, c.linkedin, c.linkedinProfileUrl,
           c.rejectionReason, c.crmOrphan
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    WHERE cp.projectId = ${projectId}
      AND c.contactTrustTier != 'send_ready'
      AND c.enrichmentSource != 'llm'
      AND c.rejectionReason IS NULL
      AND c.crmOrphan = 0
      AND c.name IS NOT NULL
      AND c.name != ''
      AND c.name NOT LIKE '%Unknown%'
      AND c.company IS NOT NULL
      AND c.company != ''
    ORDER BY
      CASE WHEN c.contactTrustTier = 'named_unverified' THEN 1
           WHEN c.contactTrustTier = 'role_only' THEN 2
           ELSE 3 END,
      c.id ASC
    LIMIT ${maxContacts * 2}
  `);

  const rows = (projectContacts as any)[0] || projectContacts;
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`[Lusha] No enrichable contacts for project ${projectName}`);
    return result;
  }

  let enriched = 0;
  for (const contact of rows) {
    if (enriched >= maxContacts || budgetRemaining <= 0) break;

    // Dedup check
    if (await isContactAlreadyLushaEnriched(contact.id)) {
      result.results.push({
        contactId: contact.id,
        contactName: contact.name,
        projectId,
        projectName,
        status: "skipped_dedup",
        promoted: false,
        creditsUsed: 0,
      });
      continue;
    }

    result.contactsAttempted++;
    const { firstName, lastName } = splitName(contact.name);

    // For LinkedIn URL lookup, we don't need a last name (privacy-restricted contacts like "Mark K.")
    const contactLinkedinUrlForCheck = contact.linkedin || contact.linkedinProfileUrl;
    if (!firstName || (!lastName && !contactLinkedinUrlForCheck)) {
      result.results.push({
        contactId: contact.id,
        contactName: contact.name,
        projectId,
        projectName,
        status: "failed",
        promoted: false,
        error: "Cannot split name into first/last and no LinkedIn URL available",
        creditsUsed: 0,
      });
      continue;
    }

    try {
      // Use LinkedIn URL if available (preferred for privacy-restricted contacts like "Mark K.")
      const contactLinkedinUrl = contact.linkedin || contact.linkedinProfileUrl || undefined;
      const lushaResult = await lushaPersonLookup(firstName, lastName, contact.company, contactLinkedinUrl);
      const enrichedEmail = lushaResult?.email?.trim() || null;
      const emailVerified = Boolean(enrichedEmail) && isLushaEmailVerified(lushaResult?.emailConfidence);
      const verificationStatus = emailVerified ? "verified" : "unverified";
      const queryInput: Record<string, string> = contactLinkedinUrl
        ? { linkedinUrl: contactLinkedinUrl, firstName, lastName: lastName || "", companyName: contact.company }
        : { firstName, lastName, companyName: contact.company };

      budgetRemaining--;
      result.creditsUsed++;

      if (enrichedEmail) {
        const nextTier = resolvePersistedContactTrustTier({
          enrichmentSource: "lusha",
          email: enrichedEmail,
          emailVerified,
          verificationStatus,
          rejectionReason: contact.rejectionReason,
          crmOrphan: contact.crmOrphan,
          hasProjectLink: true,
        }, contact.contactTrustTier);
        const promoted = nextTier === "send_ready";
        const now = new Date();

        // NOTE: Phone numbers are intentionally excluded — Lusha phone credits are
        // expensive and the platform only needs email for outreach. Do NOT add phone back.
        await db.transaction(async tx => {
          await tx.insert(lushaEnrichmentLog).values({
            contactId: contact.id,
            projectId,
            queryInput,
            emailFound: enrichedEmail,
            phoneFound: lushaResult?.phone || null,
            titleFound: lushaResult?.title || null,
            status: "enriched",
            creditsUsed: 1,
            contactPromoted: promoted,
          });

          await tx.update(contacts).set({
            email: enrichedEmail,
            emailVerified,
            verificationStatus,
            verificationScore: lushaVerificationScore(lushaResult?.emailConfidence),
            enrichmentStatus: "enriched",
            enrichmentSource: "lusha",
            enrichedAt: now,
            verifiedAt: emailVerified ? now : null,
            contactTrustTier: nextTier,
            ...(lushaResult?.title && { linkedinHeadline: lushaResult.title }),
          }).where(eq(contacts.id, contact.id));

          const { invalidateAffectedSlatesInTransaction } = await import("./contactSlateTrustDb");
          await invalidateAffectedSlatesInTransaction(tx, contact.id, projectId, now);
        });

        result.contactsEnriched++;
        if (promoted) result.contactsPromoted++;
        result.results.push({
          contactId: contact.id,
          contactName: contact.name,
          projectId,
          projectName,
          status: "enriched",
          email: enrichedEmail,
          phone: lushaResult?.phone,
          title: lushaResult?.title,
          promoted,
          creditsUsed: 1,
        });
        enriched++;
      } else {
        await db.insert(lushaEnrichmentLog).values({
          contactId: contact.id,
          projectId,
          queryInput,
          emailFound: null,
          phoneFound: lushaResult?.phone || null,
          titleFound: lushaResult?.title || null,
          status: "not_found",
          creditsUsed: 1,
          contactPromoted: false,
        });

        result.results.push({
          contactId: contact.id,
          contactName: contact.name,
          projectId,
          projectName,
          status: "not_found",
          promoted: false,
          creditsUsed: 1,
        });
        enriched++;
      }

      await sleep(DELAY_BETWEEN_CALLS_MS);
    } catch (err: any) {
      result.results.push({
        contactId: contact.id,
        contactName: contact.name,
        projectId,
        projectName,
        status: "failed",
        promoted: false,
        error: err.message,
        creditsUsed: 0,
      });

      // If rate limited, stop immediately
      if (err.message.includes("rate limit")) {
        console.warn("[Lusha] Rate limited — stopping rescue for this project");
        break;
      }
    }
  }

  console.log(`[Lusha] Project ${projectName}: ${result.contactsAttempted} attempted, ${result.contactsEnriched} enriched, ${result.contactsPromoted} promoted, ${result.creditsUsed} credits`);
  return result;
}

/**
 * Run Lusha rescue for multiple projects (Stage 4 fallback).
 * Called after Apollo rescue fails to produce enough send_ready contacts.
 *
 * Eligibility:
 *   - Project must be in rep's top visible set
 *   - Lane fit must be High or Medium
 *   - Project must be commercially sensible (not failing not_commercially_sensible gate)
 *   - Rep must be HOLD due to contact gap (not due to junk/lane-fit issues)
 *
 * Budget: shared daily cap across all reps (LUSHA_DAILY_CAP = 10).
 */
export async function lushaRescueForRep(
  rescueCandidates: Array<{
    projectId: number;
    projectName: string;
    laneFitLabel: string;
    relevanceScore: number;
  }>,
): Promise<LushaRescueSummary> {
  const summary: LushaRescueSummary = {
    projectsAttempted: 0,
    totalCreditsUsed: 0,
    totalPromoted: 0,
    dailyBudgetRemaining: 0,
    results: [],
  };

  if (!ENV.lushaApiKey) {
    console.warn("[Lusha] No API key — rescue skipped");
    return summary;
  }

  let budgetRemaining = LUSHA_DAILY_CAP - await getLushaDailyUsage();
  summary.dailyBudgetRemaining = budgetRemaining;

  if (budgetRemaining <= 0) {
    console.log("[Lusha] Daily budget exhausted — rescue skipped");
    return summary;
  }

  // Filter: only High/Medium lane fit, commercially sensible (relevance >= 40)
  const eligible = rescueCandidates
    .filter(p => (p.laneFitLabel === "High" || p.laneFitLabel === "Medium") && p.relevanceScore >= 40)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 3); // Max 3 projects per rescue run

  for (const project of eligible) {
    if (budgetRemaining <= 0) break;

    summary.projectsAttempted++;
    const result = await lushaEnrichProjectContacts(project.projectId, project.projectName, {
      maxContacts: MAX_CONTACTS_PER_PROJECT,
      budgetRemaining,
    });

    summary.results.push(result);
    summary.totalCreditsUsed += result.creditsUsed;
    summary.totalPromoted += result.contactsPromoted;
    budgetRemaining -= result.creditsUsed;
  }

  summary.dailyBudgetRemaining = budgetRemaining;
  console.log(`[Lusha] Rescue summary: ${summary.projectsAttempted} projects, ${summary.totalCreditsUsed} credits, ${summary.totalPromoted} promoted`);
  return summary;
}
