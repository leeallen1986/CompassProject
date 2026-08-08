/**
 * Hunter.io Fallback Verification Service
 *
 * PURPOSE: Verify emails for already-named contacts (named_unverified tier).
 *          NOT a discovery engine — Hunter is never used to find new names.
 *
 * Two operations:
 *   1. emailFinder  — given first name + last name + domain → find email
 *   2. emailVerifier — given an existing email → verify deliverability
 *
 * Trust promotion rules:
 *   - Hunter status "valid" + confidence >= 70  → promotion evidence only
 *   - Persisted send_ready also requires allowed provenance, a non-empty
 *     mailbox, verified state, no rejection, crmOrphan=false and an exact
 *     contactProjects link
 *   - Hunter status "accept_all"                → keep as named_unverified (domain accepts all, can't confirm)
 *   - Hunter status "unknown" or "invalid"      → keep as named_unverified, flag email as unverified
 *   - LLM contacts (llm_inferred tier)          → never promoted by Hunter alone
 *
 * API docs: https://hunter.io/api-documentation
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { contacts, contactProjects, hunterVerificationLog } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { inferCompanyDomains } from "./domainInference";
import { shouldPromoteHunterResult } from "./intelligenceTrustPolicy";
import {
  canPersistSendReady,
  resolvePersistedContactTrustTier,
} from "./contactTrustPromotionBoundary";


// ── Configuration ──

const HUNTER_BASE_URL = "https://api.hunter.io/v2";
const DELAY_MS = 300; // rate-limit friendly delay between calls

// ── Types ──

export interface HunterEmailFinderResult {
  email: string | null;
  score: number;           // 0-100 confidence
  status: HunterEmailStatus;
  sources: string[];
}

export interface HunterEmailVerifierResult {
  status: HunterEmailStatus;
  score: number;
  regexp: boolean;
  gibberish: boolean;
  disposable: boolean;
  webmail: boolean;
  mxRecords: boolean;
  smtpServer: boolean;
  smtpCheck: boolean;
  acceptAll: boolean;
  block: boolean;
  sources: string[];
}

export type HunterEmailStatus = "valid" | "accept_all" | "unknown" | "invalid";

// ── Domain extraction helper ──

function extractDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() || "";
}

/**
 * Derive a domain from a company name using LLM-based inference.
 * Falls back to a simple heuristic if LLM is unavailable.
 * Results are cached in-memory for the lifetime of the process to avoid repeated LLM calls.
 */
const _domainCache = new Map<string, string | null>();

async function deriveDomainFromCompany(company: string): Promise<string | null> {
  if (!company || company.trim().length < 2) return null;
  const key = company.trim().toLowerCase();
  if (_domainCache.has(key)) return _domainCache.get(key) ?? null;
  try {
    const results = await inferCompanyDomains([company]);
    const domain = results[0]?.domain ?? null;
    _domainCache.set(key, domain);
    return domain;
  } catch {
    // Fallback to simple heuristic if LLM fails
    const cleaned = company
      .toLowerCase()
      .replace(/\s+(pty|ltd|limited|inc|corp|group|holdings|australia|au)\b.*$/i, "")
      .replace(/[^a-z0-9]/g, "")
      .trim();
    const fallback = cleaned.length >= 2 ? `${cleaned}.com.au` : null;
    _domainCache.set(key, fallback);
    return fallback;
  }
}

// ── Hunter API calls ──

async function hunterEmailFinder(
  firstName: string,
  lastName: string,
  domain: string
): Promise<HunterEmailFinderResult> {
  const params = new URLSearchParams({
    first_name: firstName,
    last_name: lastName,
    domain,
    api_key: ENV.hunterApiKey,
  });

  const res = await fetch(`${HUNTER_BASE_URL}/email-finder?${params}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Hunter email-finder failed (${res.status}): ${err}`);
  }

  const json = await res.json() as any;
  const data = json?.data;

  return {
    email: data?.email || null,
    score: data?.score || 0,
    status: (data?.status as HunterEmailStatus) || "unknown",
    sources: (data?.sources || []).map((s: any) => s.uri || s.domain || ""),
  };
}

async function hunterEmailVerifier(
  email: string
): Promise<HunterEmailVerifierResult> {
  const params = new URLSearchParams({
    email,
    api_key: ENV.hunterApiKey,
  });

  const res = await fetch(`${HUNTER_BASE_URL}/email-verifier?${params}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Hunter email-verifier failed (${res.status}): ${err}`);
  }

  const json = await res.json() as any;
  const data = json?.data;

  return {
    status: (data?.status as HunterEmailStatus) || "unknown",
    score: data?.score || 0,
    regexp: data?.regexp || false,
    gibberish: data?.gibberish || false,
    disposable: data?.disposable || false,
    webmail: data?.webmail || false,
    mxRecords: data?.mx_records || false,
    smtpServer: data?.smtp_server || false,
    smtpCheck: data?.smtp_check || false,
    acceptAll: data?.accept_all || false,
    block: data?.block || false,
    sources: (data?.sources || []).map((s: any) => s.uri || s.domain || ""),
  };
}

// ── Core: Verify a single named_unverified contact ──

export interface HunterVerifyContactResult {
  contactId: number;
  action: "promoted" | "kept_unverified" | "email_found" | "skipped" | "failed";
  reason: string;
  hunterStatus?: HunterEmailStatus;
  hunterConfidence?: number;
  emailFound?: string;
}

export async function verifyContactWithHunter(
  contactId: number,
  projectId?: number
): Promise<HunterVerifyContactResult> {
  const db = await getDb();
  if (!db) return { contactId, action: "failed", reason: "db_unavailable" };

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!contact) return { contactId, action: "failed", reason: "contact_not_found" };
  if (contact.contactTrustTier === "llm_inferred") {
    return { contactId, action: "skipped", reason: "llm_contacts_not_eligible" };
  }
  if (contact.rejectionReason != null) {
    return { contactId, action: "skipped", reason: "rejected_contact_not_eligible" };
  }
  if (!(contact.crmOrphan === false || contact.crmOrphan === 0)) {
    return { contactId, action: "skipped", reason: "crm_orphan_not_eligible" };
  }

  const [projectLink] = await db
    .select({ id: contactProjects.id })
    .from(contactProjects)
    .where(projectId
      ? and(
          eq(contactProjects.contactId, contactId),
          eq(contactProjects.projectId, projectId),
        )
      : eq(contactProjects.contactId, contactId))
    .limit(1);
  const hasProjectLink = Boolean(projectLink);
  if (!hasProjectLink) {
    return {
      contactId,
      action: "skipped",
      reason: projectId ? "contact_not_linked_to_project" : "contact_has_no_project_link",
    };
  }

  if (contact.contactTrustTier === "send_ready" && canPersistSendReady({
    enrichmentSource: contact.enrichmentSource,
    email: contact.email,
    emailVerified: contact.emailVerified,
    verificationStatus: contact.verificationStatus,
    rejectionReason: contact.rejectionReason,
    crmOrphan: contact.crmOrphan,
    hasProjectLink,
  })) {
    return { contactId, action: "skipped", reason: "already_send_ready" };
  }

  const nameParts = (contact.name || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";
  if (!firstName || !lastName) {
    return { contactId, action: "skipped", reason: "insufficient_name_parts" };
  }

  try {
    if (contact.email) {
      const verifyResult = await hunterEmailVerifier(contact.email);
      const hunterVerified = shouldPromoteHunterResult({
        status: verifyResult.status,
        score: verifyResult.score,
        disposable: verifyResult.disposable,
        block: verifyResult.block,
      });
      const nextTier = resolvePersistedContactTrustTier({
        enrichmentSource: contact.enrichmentSource,
        email: contact.email,
        emailVerified: hunterVerified,
        verificationStatus: hunterVerified ? "verified" : "unverified",
        rejectionReason: contact.rejectionReason,
        crmOrphan: contact.crmOrphan,
        hasProjectLink,
      }, contact.contactTrustTier);
      const tierPromoted = nextTier === "send_ready";
      const now = new Date();

      await db.transaction(async tx => {
        await tx.insert(hunterVerificationLog).values({
          contactId,
          projectId: projectId || null,
          queryType: "email_verifier",
          queryInput: { email: contact.email as string },
          hunterStatus: verifyResult.status,
          hunterConfidence: verifyResult.score,
          emailFound: verifyResult.status === "valid" ? contact.email : null,
          hunterSources: verifyResult.sources,
          contactUpdated: true,
          tierPromoted,
          apiCreditsUsed: 1,
        });

        await tx.update(contacts).set(hunterVerified ? {
          contactTrustTier: nextTier,
          emailVerified: true,
          verificationStatus: "verified",
          verifiedAt: now,
        } : {
          contactTrustTier: "named_unverified",
          emailVerified: false,
          verificationStatus: "unverified",
          verifiedAt: null,
        }).where(eq(contacts.id, contactId));

        const { invalidateAffectedSlatesInTransaction } = await import("./contactSlateTrustDb");
        await invalidateAffectedSlatesInTransaction(tx, contactId, projectId, now);
      });

      if (tierPromoted) {
        return {
          contactId,
          action: "promoted",
          reason: `hunter_verified_valid_${verifyResult.score}`,
          hunterStatus: verifyResult.status,
          hunterConfidence: verifyResult.score,
          emailFound: contact.email,
        };
      }
      return {
        contactId,
        action: "kept_unverified",
        reason: hunterVerified
          ? `hunter_valid_but_persist_boundary_blocked_${verifyResult.score}`
          : `hunter_status_${verifyResult.status}_confidence_${verifyResult.score}`,
        hunterStatus: verifyResult.status,
        hunterConfidence: verifyResult.score,
      };
    }

    const domain = await deriveDomainFromCompany(contact.company || "");
    if (!domain) return { contactId, action: "skipped", reason: "cannot_derive_domain" };

    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    const hunterResult = await hunterEmailFinder(firstName, lastName, domain);
    const hunterVerified = Boolean(hunterResult.email) && shouldPromoteHunterResult({
      status: hunterResult.status,
      score: hunterResult.score,
    });
    const nextTier = resolvePersistedContactTrustTier({
      enrichmentSource: contact.enrichmentSource,
      email: hunterResult.email,
      emailVerified: hunterVerified,
      verificationStatus: hunterVerified ? "verified" : "unverified",
      rejectionReason: contact.rejectionReason,
      crmOrphan: contact.crmOrphan,
      hasProjectLink,
    }, contact.contactTrustTier);
    const tierPromoted = nextTier === "send_ready";
    const contactUpdated = Boolean(hunterResult.email);
    const now = new Date();

    await db.transaction(async tx => {
      await tx.insert(hunterVerificationLog).values({
        contactId,
        projectId: projectId || null,
        queryType: "email_finder",
        queryInput: { firstName, lastName, domain },
        hunterStatus: hunterResult.status,
        hunterConfidence: hunterResult.score,
        emailFound: hunterResult.email,
        hunterSources: hunterResult.sources,
        contactUpdated,
        tierPromoted,
        apiCreditsUsed: 1,
      });

      if (hunterResult.email) {
        await tx.update(contacts).set(hunterVerified ? {
          email: hunterResult.email,
          emailVerified: true,
          verificationStatus: "verified",
          contactTrustTier: nextTier,
          verifiedAt: now,
        } : {
          email: hunterResult.email,
          emailVerified: false,
          verificationStatus: "unverified",
          contactTrustTier: "named_unverified",
          verifiedAt: null,
        }).where(eq(contacts.id, contactId));
        const { invalidateAffectedSlatesInTransaction } = await import("./contactSlateTrustDb");
        await invalidateAffectedSlatesInTransaction(tx, contactId, projectId, now);
      }
    });

    if (!hunterResult.email) {
      return {
        contactId,
        action: "kept_unverified",
        reason: "hunter_no_email_found",
        hunterStatus: hunterResult.status,
        hunterConfidence: hunterResult.score,
      };
    }
    if (tierPromoted) {
      return {
        contactId,
        action: "email_found",
        reason: `hunter_found_valid_${hunterResult.score}`,
        hunterStatus: hunterResult.status,
        hunterConfidence: hunterResult.score,
        emailFound: hunterResult.email,
      };
    }
    return {
      contactId,
      action: "kept_unverified",
      reason: hunterVerified
        ? `hunter_found_valid_but_persist_boundary_blocked_${hunterResult.score}`
        : `hunter_found_low_confidence_${hunterResult.score}`,
      hunterStatus: hunterResult.status,
      hunterConfidence: hunterResult.score,
      emailFound: hunterResult.email,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Hunter] Error verifying contact ${contactId}: ${message}`);
    return { contactId, action: "failed", reason: message };
  }
}

// ── Batch: Verify all named_unverified contacts for a project ──

export interface HunterBatchResult {
  projectId: number;
  processed: number;
  promoted: number;
  emailsFound: number;
  keptUnverified: number;
  skipped: number;
  failed: number;
  results: HunterVerifyContactResult[];
}

export async function verifyProjectContactsWithHunter(
  projectId: number,
  maxContacts = 10
): Promise<HunterBatchResult> {
  const db = await getDb();
  if (!db) return { projectId, processed: 0, promoted: 0, emailsFound: 0, keptUnverified: 0, skipped: 0, failed: 0, results: [] };

  // Get named_unverified contacts for this project
  const [rows] = await (db as any).execute(
    `SELECT c.id
     FROM contacts c
     JOIN contactProjects cp ON cp.contactId = c.id
     WHERE cp.projectId = ${projectId}
       AND c.contactTrustTier = 'named_unverified'
       AND c.rejectionReason IS NULL
       AND c.crmOrphan = 0
       AND (c.enrichmentSource != 'llm' OR c.enrichmentSource IS NULL)
     ORDER BY
       CASE c.roleRelevance WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       CASE c.confidenceScore WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
     LIMIT ${maxContacts}`
  );

  const contactIds = (Array.isArray(rows) ? rows : []).map((r: any) => r.id as number);

  const results: HunterVerifyContactResult[] = [];
  let promoted = 0, emailsFound = 0, keptUnverified = 0, skipped = 0, failed = 0;

  for (const contactId of contactIds) {
    await new Promise(r => setTimeout(r, DELAY_MS));
    const result = await verifyContactWithHunter(contactId, projectId);
    results.push(result);

    if (result.action === "promoted") promoted++;
    else if (result.action === "email_found") emailsFound++;
    else if (result.action === "kept_unverified") keptUnverified++;
    else if (result.action === "skipped") skipped++;
    else if (result.action === "failed") failed++;
  }

  return {
    projectId,
    processed: contactIds.length,
    promoted,
    emailsFound,
    keptUnverified,
    skipped,
    failed,
    results,
  };
}
