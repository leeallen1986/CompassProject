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
 *   - Hunter status "valid" + confidence >= 70  → promote to send_ready
 *   - Hunter status "accept_all"                → keep as named_unverified (domain accepts all, can't confirm)
 *   - Hunter status "unknown" or "invalid"      → keep as named_unverified, flag email as unverified
 *   - LLM contacts (llm_inferred tier)          → never promoted by Hunter alone
 *
 * API docs: https://hunter.io/api-documentation
 */

import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { contacts, hunterVerificationLog } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { inferCompanyDomains } from "./domainInference";


// ── Configuration ──

const HUNTER_BASE_URL = "https://api.hunter.io/v2";
const HUNTER_MIN_CONFIDENCE_FOR_PROMOTION = 70;
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

  // Load the contact
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!contact) {
    return { contactId, action: "failed", reason: "contact_not_found" };
  }

  // Only process named_unverified — never promote LLM contacts via Hunter alone
  if (contact.contactTrustTier === "llm_inferred") {
    return { contactId, action: "skipped", reason: "llm_contacts_not_eligible" };
  }
  if (contact.contactTrustTier === "send_ready") {
    return { contactId, action: "skipped", reason: "already_send_ready" };
  }

  // Split name into first/last
  const nameParts = (contact.name || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  if (!firstName || !lastName) {
    return { contactId, action: "skipped", reason: "insufficient_name_parts" };
  }

  let hunterResult: HunterEmailFinderResult | null = null;
  let verifyResult: HunterEmailVerifierResult | null = null;
  let queryType: "email_finder" | "email_verifier" = "email_finder";
  let emailToProcess = contact.email;

  try {
    if (contact.email) {
      // Path A: Contact already has an email — verify it
      queryType = "email_verifier";
      verifyResult = await hunterEmailVerifier(contact.email);

      await db.insert(hunterVerificationLog).values({
        contactId,
        projectId: projectId || null,
        queryType: "email_verifier",
        queryInput: { email: contact.email },
        hunterStatus: verifyResult.status,
        hunterConfidence: verifyResult.score,
        emailFound: verifyResult.status === "valid" ? contact.email : null,
        hunterSources: verifyResult.sources,
        contactUpdated: false,
        tierPromoted: false,
        apiCreditsUsed: 1,
      });

      const shouldPromote =
        verifyResult.status === "valid" &&
        verifyResult.score >= HUNTER_MIN_CONFIDENCE_FOR_PROMOTION &&
        !verifyResult.disposable &&
        !verifyResult.block;

      if (shouldPromote) {
        await db.update(contacts).set({
          contactTrustTier: "send_ready",
          emailVerified: true,
        }).where(eq(contacts.id, contactId));

        await db.update(hunterVerificationLog).set({
          contactUpdated: true,
          tierPromoted: true,
        }).where(eq(hunterVerificationLog.contactId, contactId));

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
        reason: `hunter_status_${verifyResult.status}_confidence_${verifyResult.score}`,
        hunterStatus: verifyResult.status,
        hunterConfidence: verifyResult.score,
      };

    } else {
      // Path B: No email — try to find one via email-finder
      queryType = "email_finder";

      // Derive domain from company name or LinkedIn URL
      let domain: string | null = null;
      // Use LLM-based domain inference for accuracy
      domain = await deriveDomainFromCompany(contact.company || "");

      if (!domain) {
        return { contactId, action: "skipped", reason: "cannot_derive_domain" };
      }

      await new Promise(r => setTimeout(r, DELAY_MS));
      hunterResult = await hunterEmailFinder(firstName, lastName, domain);

      await db.insert(hunterVerificationLog).values({
        contactId,
        projectId: projectId || null,
        queryType: "email_finder",
        queryInput: { firstName, lastName, domain },
        hunterStatus: hunterResult.status,
        hunterConfidence: hunterResult.score,
        emailFound: hunterResult.email,
        hunterSources: hunterResult.sources,
        contactUpdated: false,
        tierPromoted: false,
        apiCreditsUsed: 1,
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

      emailToProcess = hunterResult.email;

      const shouldPromote =
        hunterResult.status === "valid" &&
        hunterResult.score >= HUNTER_MIN_CONFIDENCE_FOR_PROMOTION;

      if (shouldPromote) {
        await db.update(contacts).set({
          email: hunterResult.email,
          emailVerified: true,
          contactTrustTier: "send_ready",
          enrichmentSource: "apollo", // keep existing source, just mark verified
        }).where(eq(contacts.id, contactId));

        await db.update(hunterVerificationLog).set({
          contactUpdated: true,
          tierPromoted: true,
        }).where(eq(hunterVerificationLog.contactId, contactId));

        return {
          contactId,
          action: "email_found",
          reason: `hunter_found_valid_${hunterResult.score}`,
          hunterStatus: hunterResult.status,
          hunterConfidence: hunterResult.score,
          emailFound: hunterResult.email,
        };
      }

      // Email found but low confidence — save email but don't promote
      await db.update(contacts).set({
        email: hunterResult.email,
      }).where(eq(contacts.id, contactId));

      return {
        contactId,
        action: "kept_unverified",
        reason: `hunter_found_low_confidence_${hunterResult.score}`,
        hunterStatus: hunterResult.status,
        hunterConfidence: hunterResult.score,
        emailFound: hunterResult.email,
      };
    }

  } catch (err: any) {
    console.error(`[Hunter] Error verifying contact ${contactId}: ${err.message}`);
    return { contactId, action: "failed", reason: err.message };
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
