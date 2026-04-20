/**
 * enrichmentQA.ts — Stage 3: Post-Enrichment QA and Provider Validation Layer
 *
 * This module runs AFTER enrichment (Apollo / Hunter / import) and BEFORE
 * any contact is marked send-ready. It produces an EnrichmentQAResult object
 * that is stored in the `enrichmentQA` JSON column of campaignContacts.
 *
 * Pipeline position:
 *   Stage 1 (ingestion) → Stage 2 (scoring) → enrichment → Stage 3 (QA) → outreach
 *
 * company_target rows from Stage 1 MUST NOT enter this pipeline.
 * Only person records (verified_contact, enrichable_contact, review_needed) are processed.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** How well the enriched email domain matches the expected company domain */
export type DomainMatchType =
  | "exact_match"          // enriched domain == expected domain
  | "trusted_parent_match" // enriched domain is a known parent of the company
  | "alias_match"          // enriched domain is a known alias/subsidiary
  | "suspicious_mismatch"  // enriched domain belongs to a different company
  | "unknown_expected_domain"; // we couldn't derive an expected domain

/** Provider-level confidence band */
export type ProviderConfidenceBand =
  | "high_trust"    // verified + exact domain + personal email + high score
  | "medium_trust"  // some uncertainty but plausible
  | "low_trust"     // multiple risk signals — review before send
  | "blocked";      // hard block — do not send

/** Final send-readiness decision */
export type SendReadiness =
  | "send_ready"       // all gates passed
  | "review_before_send" // soft flags — human review required
  | "blocked_from_send"; // hard block — one or more hard flags present

/** Individual QA risk flag */
export type QAFlag =
  // Domain flags
  | "domain_exact_match"
  | "domain_trusted_parent"
  | "domain_alias"
  | "domain_suspicious_mismatch"
  | "domain_unknown"
  // Email quality flags
  | "generic_role_email"      // info@, admin@, reception@, sales@, enquiries@, noreply@
  | "catch_all_domain"        // Hunter/Apollo reports accept_all
  | "invalid_email"           // Hunter/Apollo reports invalid
  | "unknown_verification"    // verification status unknown
  | "email_reused_across_contacts" // same enriched email on multiple contacts in campaign
  // Provider flags
  | "low_hunter_confidence"   // Hunter confidence < 50
  | "very_low_hunter_confidence" // Hunter confidence < 30
  | "no_linkedin_corroboration"  // no LinkedIn URL from any provider
  | "provider_not_found"      // enrichment returned not_found
  // Plausibility flags
  | "title_company_mismatch"  // enriched title very unrelated to campaign/company
  | "cross_company_contamination" // email domain belongs to a different known company
  | "enriched_to_parent_entity"   // person enriched to parent, not target company
  | "geo_mismatch"            // non-AU/NZ country detected
  | "retired_or_former"       // name/title contains retired/former/ex-
  | "do_not_contact"          // DNC flag from ingestion
  // Stage 1 carry-forward flags
  | "company_target_blocked"  // company_target row — must not enter person scoring
  // Scoring gate
  | "below_score_threshold"   // finalScore < tier threshold for send
  | "tier_not_send_eligible"; // tier3_enrich or tier4_low or excluded

/** Full explainable QA result stored per contact */
export interface EnrichmentQAResult {
  // Domain validation
  expectedDomain: string | null;
  actualDomain: string | null;
  domainMatchType: DomainMatchType;
  domainMatchSource: "known_mapping" | "parent_mapping" | "alias_mapping" | "inferred" | "none";

  // Provider
  providerSource: "apollo" | "hunter" | "import" | "manual" | null;
  verificationStatus: "valid" | "accept_all" | "unknown" | "invalid" | null;
  hunterConfidence: number | null;
  providerConfidence: ProviderConfidenceBand;

  // Risk flags
  qaFlags: QAFlag[];
  hardFlags: QAFlag[];   // subset of qaFlags that cause blocked_from_send
  softFlags: QAFlag[];   // subset that cause review_before_send

  // Send-readiness
  sendReadiness: SendReadiness;

  // Explainability
  reasoningSummary: string;

  // Metadata
  evaluatedAt: string; // ISO timestamp
  schemaVersion: number; // increment when logic changes
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

/**
 * Generic / role-based email prefixes that should not be treated as personal contacts.
 * These are soft flags (review_before_send) not hard blocks, because some companies
 * use role addresses for their primary contact point.
 */
const GENERIC_EMAIL_PREFIXES = new Set([
  "info", "admin", "reception", "sales", "enquiries", "enquiry",
  "contact", "hello", "hi", "support", "help", "service", "services",
  "office", "general", "mail", "email", "accounts", "billing",
  "noreply", "no-reply", "donotreply", "do-not-reply",
  "marketing", "media", "pr", "communications",
  "hr", "humanresources", "recruitment", "careers",
  "legal", "compliance", "safety", "hse",
  "operations", "ops", "projects", "tenders",
  "purchasing", "procurement", "supply",
  "webmaster", "website", "web", "it", "ict",
  "postmaster", "abuse", "spam",
]);

/**
 * Known parent/subsidiary domain relationships.
 * Key = subsidiary domain, Value = parent domain.
 * Used for trusted_parent_match classification.
 */
const PARENT_DOMAIN_MAP: Record<string, string> = {
  // CIMIC Group subsidiaries
  "thiess.com": "cimic.com.au",
  "cpbcon.com.au": "cimic.com.au",
  "ugl.com.au": "cimic.com.au",
  "sedgman.com": "cimic.com.au",
  "hpengineering.com.au": "cimic.com.au",

  // Downer Group subsidiaries
  "spotless.com.au": "downergroup.com",
  "laing.com.au": "downergroup.com",

  // NRW Holdings subsidiaries
  "actiondrilling.com.au": "nrw.com.au",
  "bgc.com.au": "nrw.com.au",

  // Perenti subsidiaries
  "ausdrill.com.au": "perenti.com",
  "africoast.com": "perenti.com",
  "barminco.com.au": "perenti.com",
  "reedrill.com.au": "perenti.com",

  // Macmahon subsidiaries
  "macmahon.com.au": "macmahon.com.au",

  // BHP subsidiaries / related
  "bhpbilliton.com": "bhp.com",
  "bhpbilliton.com.au": "bhp.com",

  // Rio Tinto subsidiaries
  "riotinto.com.au": "riotinto.com",
  "rtio.com.au": "riotinto.com",
  "turquoisehill.com": "riotinto.com",

  // Fortescue subsidiaries
  "fmgl.com.au": "fortescue.com",
  "ffienergy.com": "fortescue.com",
  "forrestfamilyinvestments.com.au": "fortescue.com",

  // Newmont / Newcrest
  "newcrest.com": "newmont.com",
  "newcrest.com.au": "newmont.com",

  // Atlas Copco / Epiroc (same group historically)
  "epiroc.com": "atlascopco.com",
};

/**
 * Known domain aliases — different domain for the same company.
 * Key = alias domain, Value = canonical domain.
 */
const ALIAS_DOMAIN_MAP: Record<string, string> = {
  // South32
  "south32.net": "south32.com",
  "south32.com": "south32.net",

  // Northern Star
  "nsrltd.com": "northernstar.com.au",
  "northernstar.com.au": "nsrltd.com",

  // Schneider Electric
  "se.com": "schneider-electric.com",
  "schneider-electric.com": "se.com",

  // Multiplex
  "multiplex.global": "multiplex.com.au",
  "multiplex.com.au": "multiplex.global",

  // Laing O'Rourke
  "laingorourke.com": "laingorourke.com.au",
  "laingorourke.com.au": "laingorourke.com",

  // Direct Blast / DirectIndustries
  "directblast.com.au": "directindustries.com.au",
  "directindustries.com.au": "directblast.com.au",

  // Orontide / Alphablast (same company, different trading names)
  "alphablast.com.au": "orontide.com.au",
  "orontide.com.au": "alphablast.com.au",
};

/**
 * Domains that are known to belong to a specific company.
 * Used for cross-company contamination detection.
 * Key = domain, Value = canonical company name.
 */
const DOMAIN_TO_COMPANY: Record<string, string> = {
  "bhp.com": "BHP",
  "bhpbilliton.com": "BHP",
  "riotinto.com": "Rio Tinto",
  "riotinto.com.au": "Rio Tinto",
  "fortescue.com": "Fortescue",
  "fmgl.com.au": "Fortescue",
  "newmont.com": "Newmont",
  "newcrest.com": "Newcrest",
  "south32.net": "South32",
  "santos.com": "Santos",
  "woodside.com": "Woodside",
  "chevron.com": "Chevron",
  "inpex.com.au": "INPEX",
  "shell.com": "Shell",
  "pttep.com": "PTTEP",
  "pttep.com.au": "PTTEP",
  "cimic.com.au": "CIMIC Group",
  "thiess.com": "Thiess",
  "cpbcon.com.au": "CPB Contractors",
  "ugl.com.au": "UGL",
  "downergroup.com": "Downer Group",
  "spotless.com.au": "Spotless",
  "nrw.com.au": "NRW Holdings",
  "monadelphous.com.au": "Monadelphous",
  "perenti.com": "Perenti",
  "macmahon.com.au": "Macmahon",
  "decmil.com.au": "Decmil",
  "bechtel.com": "Bechtel",
  "johnholland.com.au": "John Holland",
  "laingorourke.com": "Laing O'Rourke",
  "lendlease.com": "Lendlease",
  "atlascopco.com": "Atlas Copco",
  "epiroc.com": "Epiroc",
  "cat.com": "Caterpillar",
  "komatsu.com.au": "Komatsu",
  "sandvik.com": "Sandvik",
  "orontide.com.au": "Orontide",
  "alphablast.com.au": "Orontide",
};

/**
 * The authoritative known-domain mapping (same as inferDomain in apolloEnrichment.ts
 * but kept here as a read-only reference for QA purposes).
 * Key = normalised company name, Value = canonical domain.
 */
const KNOWN_COMPANY_DOMAINS: Record<string, string> = {
  "bhp": "bhp.com",
  "bhp group": "bhp.com",
  "rio tinto": "riotinto.com",
  "fortescue": "fortescue.com",
  "fortescue metals": "fortescue.com",
  "fortescue metals group": "fortescue.com",
  "fmg": "fortescue.com",
  "newmont": "newmont.com",
  "south32": "south32.net",
  "mineral resources": "mineralresources.com.au",
  "minres": "mineralresources.com.au",
  "pilbara minerals": "pilbaraminerals.com.au",
  "northern star": "nsrltd.com",
  "northern star resources": "nsrltd.com",
  "gold fields": "goldfields.com",
  "evolution mining": "evolutionmining.com.au",
  "santos": "santos.com",
  "woodside": "woodside.com",
  "woodside energy": "woodside.com",
  "chevron": "chevron.com",
  "inpex": "inpex.com.au",
  "shell": "shell.com",
  "nrw holdings": "nrw.com.au",
  "nrw": "nrw.com.au",
  "cimic": "cimic.com.au",
  "cimic group": "cimic.com.au",
  "thiess": "thiess.com",
  "downer": "downergroup.com",
  "downer group": "downergroup.com",
  "monadelphous": "monadelphous.com.au",
  "perenti": "perenti.com",
  "macmahon": "macmahon.com.au",
  "decmil": "decmil.com.au",
  "bechtel": "bechtel.com",
  "cpb contractors": "cpbcon.com.au",
  "john holland": "johnholland.com.au",
  "georgiou": "georgiou.com.au",
  "laing o'rourke": "laingorourke.com",
  "multiplex": "multiplex.global",
  "lendlease": "lendlease.com",
  "lynas": "lynasrareearths.com",
  "lynas rare earths": "lynasrareearths.com",
  "iluka": "iluka.com",
  "iluka resources": "iluka.com",
  "alcoa": "alcoa.com",
  "newcrest": "newcrest.com",
  "regis resources": "regisresources.com.au",
  "gold road resources": "goldroad.com.au",
  "de grey mining": "degreymining.com.au",
  "chalice mining": "chalicemining.com",
  "atlas copco": "atlascopco.com",
  "epiroc": "epiroc.com",
  "caterpillar": "cat.com",
  "komatsu": "komatsu.com.au",
  "sandvik": "sandvik.com",
  "weir minerals": "weirminerals.com",
  "metso": "metso.com",
  "abb": "abb.com",
  "siemens": "siemens.com",
  "schneider electric": "se.com",
  "main roads wa": "mainroads.wa.gov.au",
  "water corporation": "watercorporation.com.au",
  "western power": "westernpower.com.au",
  "synergy": "synergy.net.au",
  "horizon power": "horizonpower.com.au",
  "development wa": "developmentwa.com.au",
  "orontide": "orontide.com.au",
  "orontide alphablast": "orontide.com.au",
  "alphablast": "alphablast.com.au",
  "direct blast": "directblast.com.au",
  "pttep": "pttep.com",
  "ugl": "ugl.com.au",
  "cpb": "cpbcon.com.au",
  // JV / joint venture variants — map to the primary entity's domain
  "cimic group / ugl joint venture": "cimic.com.au",
  "cimic / ugl joint venture": "cimic.com.au",
  "ugl joint venture": "cimic.com.au",
  "cimic ugl jv": "cimic.com.au",
  "thiess / cpb jv": "cimic.com.au",
  "thiess cpb jv": "cimic.com.au",
  "cpb thiess jv": "cimic.com.au",
  "nrw / macmahon jv": "nrw.com.au",
  "macmahon / nrw jv": "nrw.com.au",
};

// ─────────────────────────────────────────────────────────────────────────────
// Domain helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the domain from an email address. Returns null if malformed. */
export function extractEmailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain || !domain.includes(".")) return null;
  return domain;
}

/**
 * Derive the expected company domain from the canonical company name.
 * Checks the known-domain map first, then falls back to a heuristic.
 * Returns null if the company name is too generic or ambiguous.
 */
export function deriveExpectedDomain(
  companyName: string | null | undefined,
  options?: {
    websiteDomain?: string | null;    // from upload field
    approvedDomain?: string | null;   // from campaignDomainOverrides table
    existingEmailDomain?: string | null; // from the contact's original email field
  }
): { domain: string | null; source: EnrichmentQAResult["domainMatchSource"] } {
  // 1. Manual approved override takes highest priority
  if (options?.approvedDomain) {
    return { domain: options.approvedDomain.toLowerCase().trim(), source: "known_mapping" };
  }

  // 2. Website/domain field from upload
  if (options?.websiteDomain) {
    const d = options.websiteDomain.toLowerCase()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .trim();
    if (d && d.includes(".")) {
      return { domain: d, source: "known_mapping" };
    }
  }

  // 3. Known company domain map
  if (companyName) {
    const normalised = companyName.toLowerCase().trim();
    if (KNOWN_COMPANY_DOMAINS[normalised]) {
      return { domain: KNOWN_COMPANY_DOMAINS[normalised], source: "known_mapping" };
    }

    // Try stripping common suffixes and retrying
    const stripped = normalised
      .replace(/\s*(pty\.?\s*ltd\.?|limited|inc\.?|corp\.?|corporation|group|australia|holdings|resources|mining|energy|services|solutions|contractors?)\s*/gi, " ")
      .trim();
    if (stripped && KNOWN_COMPANY_DOMAINS[stripped]) {
      return { domain: KNOWN_COMPANY_DOMAINS[stripped], source: "known_mapping" };
    }
  }

  // 4. Trusted existing email domain (only if it's a personal email, not generic)
  if (options?.existingEmailDomain) {
    const prefix = options.existingEmailDomain.split("@")[0]?.toLowerCase();
    if (prefix && !GENERIC_EMAIL_PREFIXES.has(prefix)) {
      return { domain: options.existingEmailDomain, source: "inferred" };
    }
  }

  return { domain: null, source: "none" };
}

/**
 * Classify the relationship between the enriched email domain and the expected domain.
 */
export function classifyDomainMatch(
  enrichedDomain: string | null,
  expectedDomain: string | null,
  companyName: string | null | undefined
): { matchType: DomainMatchType; crossCompanyName?: string } {
  if (!enrichedDomain) {
    return { matchType: "unknown_expected_domain" };
  }

  if (!expectedDomain) {
    // We don't know what domain to expect — check if the enriched domain
    // belongs to a completely different known company
    const knownOwner = DOMAIN_TO_COMPANY[enrichedDomain];
    const normCompany = companyName?.toLowerCase().trim() ?? "";
    if (knownOwner && !normCompany.includes(knownOwner.toLowerCase())) {
      return { matchType: "suspicious_mismatch", crossCompanyName: knownOwner };
    }
    return { matchType: "unknown_expected_domain" };
  }

  // Exact match
  if (enrichedDomain === expectedDomain) {
    return { matchType: "exact_match" };
  }

  // Alias match — both domains are known aliases of each other
  if (ALIAS_DOMAIN_MAP[enrichedDomain] === expectedDomain ||
      ALIAS_DOMAIN_MAP[expectedDomain] === enrichedDomain) {
    return { matchType: "alias_match" };
  }

  // Trusted parent match — enriched domain is the parent of the expected domain
  if (PARENT_DOMAIN_MAP[expectedDomain] === enrichedDomain) {
    return { matchType: "trusted_parent_match" };
  }

  // Trusted parent match — expected domain is the parent of the enriched domain
  if (PARENT_DOMAIN_MAP[enrichedDomain] === expectedDomain) {
    return { matchType: "trusted_parent_match" };
  }

  // Cross-company contamination — enriched domain belongs to a different known company
  const knownOwner = DOMAIN_TO_COMPANY[enrichedDomain];
  if (knownOwner) {
    const normExpected = DOMAIN_TO_COMPANY[expectedDomain] ?? expectedDomain;
    if (knownOwner.toLowerCase() !== normExpected.toLowerCase()) {
      return { matchType: "suspicious_mismatch", crossCompanyName: knownOwner };
    }
  }

  // Subdomain of expected domain (e.g. au.bhp.com vs bhp.com)
  if (enrichedDomain.endsWith(`.${expectedDomain}`) ||
      expectedDomain.endsWith(`.${enrichedDomain}`)) {
    return { matchType: "trusted_parent_match" };
  }

  // Different domain — suspicious
  return { matchType: "suspicious_mismatch" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic email detection
// ─────────────────────────────────────────────────────────────────────────────

export function isGenericRoleEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.indexOf("@");
  if (at < 1) return false;
  const prefix = email.slice(0, at).toLowerCase()
    .replace(/[._+-].*$/, ""); // strip sub-addressing and dots
  return GENERIC_EMAIL_PREFIXES.has(prefix);
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider confidence model
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderConfidenceInput {
  enrichmentSource: "apollo" | "hunter" | "import" | "manual" | null;
  verificationStatus: "valid" | "accept_all" | "unknown" | "invalid" | null;
  hunterConfidence: number | null;
  domainMatchType: DomainMatchType;
  isGenericEmail: boolean;
  hasLinkedin: boolean;
  emailExists: boolean;
}

export function computeProviderConfidence(input: ProviderConfidenceInput): ProviderConfidenceBand {
  // Hard blocks
  if (!input.emailExists) return "blocked";
  if (input.verificationStatus === "invalid") return "blocked";
  if (input.domainMatchType === "suspicious_mismatch") return "blocked";

  // Low trust signals — accumulate
  let riskScore = 0;

  if (input.verificationStatus === "accept_all") riskScore += 2;
  if (input.verificationStatus === "unknown") riskScore += 1;
  if (input.isGenericEmail) riskScore += 2;
  if (input.hunterConfidence !== null && input.hunterConfidence < 30) riskScore += 3;
  else if (input.hunterConfidence !== null && input.hunterConfidence < 50) riskScore += 1;
  if (input.domainMatchType === "unknown_expected_domain") riskScore += 1;
  if (input.domainMatchType === "trusted_parent_match") riskScore += 1;
  if (input.domainMatchType === "alias_match") riskScore += 1;
  if (!input.hasLinkedin) riskScore += 1;
  if (input.enrichmentSource === "import") riskScore += 1; // unverified import email

  if (riskScore === 0) return "high_trust";
  if (riskScore <= 2) return "medium_trust";
  if (riskScore <= 4) return "low_trust";
  return "blocked";
}

// ─────────────────────────────────────────────────────────────────────────────
// Send-readiness gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard flags that always result in blocked_from_send.
 * These cannot be overridden by a manual review approval.
 */
const HARD_BLOCK_FLAGS = new Set<QAFlag>([
  "domain_suspicious_mismatch",
  "invalid_email",
  "company_target_blocked",
  "cross_company_contamination",
  "do_not_contact",
  "geo_mismatch",
  "below_score_threshold",
  "tier_not_send_eligible",
]);

/**
 * Soft flags that result in review_before_send.
 * A human reviewer can approve despite these.
 */
const SOFT_REVIEW_FLAGS = new Set<QAFlag>([
  "domain_trusted_parent",
  "domain_alias",
  "domain_unknown",
  "generic_role_email",
  "catch_all_domain",
  "unknown_verification",
  "low_hunter_confidence",
  "very_low_hunter_confidence",
  "no_linkedin_corroboration",
  "title_company_mismatch",
  "enriched_to_parent_entity",
  "retired_or_former",
  "email_reused_across_contacts",
  "provider_not_found",
]);

export function determineSendReadiness(
  flags: QAFlag[],
  providerConfidence: ProviderConfidenceBand,
  emailExists: boolean
): SendReadiness {
  if (!emailExists) return "blocked_from_send";
  if (providerConfidence === "blocked") return "blocked_from_send";

  const flagSet = new Set(flags);

  // Any hard block flag → blocked
  for (const f of Array.from(HARD_BLOCK_FLAGS)) {
    if (flagSet.has(f)) return "blocked_from_send";
  }

  // Any soft flag → review
  for (const f of Array.from(SOFT_REVIEW_FLAGS)) {
    if (flagSet.has(f)) return "review_before_send";
  }

  // Low trust → review
  if (providerConfidence === "low_trust") return "review_before_send";

  return "send_ready";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main QA evaluation function
// ─────────────────────────────────────────────────────────────────────────────

export interface EnrichmentQAInput {
  // Contact identity
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  company: string;
  recordType?: string | null;  // Stage 1 classification — company_target must be blocked

  // Email data
  enrichedEmail: string | null;
  originalEmail: string | null;  // pre-enrichment email from upload

  // Enrichment metadata
  enrichmentSource: "apollo" | "hunter" | "import" | "manual" | null;
  verificationStatus: "valid" | "accept_all" | "unknown" | "invalid" | null;
  hunterConfidence: number | null;
  enrichedLinkedin: string | null;
  enrichedTitle: string | null;

  // Scoring (from Stage 2)
  finalScore: number;
  finalTier: string;

  // Domain hints
  websiteDomain?: string | null;
  approvedDomain?: string | null;  // from campaignDomainOverrides table

  // Ingestion flags (from Stage 1)
  retiredOrFormer?: boolean;
  doNotContact?: boolean;

  // Cross-contact dedup (optional — pass all enriched emails in the campaign)
  allCampaignEnrichedEmails?: string[];

  // Geo
  enrichedCountry?: string | null;
}

/**
 * Run the full Stage 3 QA evaluation on a single enriched contact.
 * Returns a complete EnrichmentQAResult with all flags, confidence band,
 * and send-readiness decision.
 */
export function evaluateEnrichmentQA(input: EnrichmentQAInput): EnrichmentQAResult {
  const flags: QAFlag[] = [];
  const now = new Date().toISOString();

  // ── 0. company_target guard ──────────────────────────────────────────────
  if (input.recordType === "company_target") {
    const result: EnrichmentQAResult = {
      expectedDomain: null,
      actualDomain: null,
      domainMatchType: "unknown_expected_domain",
      domainMatchSource: "none",
      providerSource: null,
      verificationStatus: null,
      hunterConfidence: null,
      providerConfidence: "blocked",
      qaFlags: ["company_target_blocked"],
      hardFlags: ["company_target_blocked"],
      softFlags: [],
      sendReadiness: "blocked_from_send",
      reasoningSummary: "company_target rows are not eligible for person scoring or enrichment QA.",
      evaluatedAt: now,
      schemaVersion: SCHEMA_VERSION,
    };
    return result;
  }

  // ── 1. Domain validation ─────────────────────────────────────────────────
  const enrichedEmail = input.enrichedEmail || input.originalEmail;
  const actualDomain = extractEmailDomain(enrichedEmail);
  const existingEmailDomain = extractEmailDomain(input.originalEmail);

  const { domain: expectedDomain, source: domainMatchSource } = deriveExpectedDomain(
    input.company,
    {
      websiteDomain: input.websiteDomain,
      approvedDomain: input.approvedDomain,
      existingEmailDomain,
    }
  );

  const { matchType: domainMatchType, crossCompanyName } = classifyDomainMatch(
    actualDomain,
    expectedDomain,
    input.company
  );

  // Domain flags
  switch (domainMatchType) {
    case "exact_match":
      flags.push("domain_exact_match");
      break;
    case "trusted_parent_match":
      flags.push("domain_trusted_parent");
      break;
    case "alias_match":
      flags.push("domain_alias");
      break;
    case "suspicious_mismatch":
      flags.push("domain_suspicious_mismatch");
      if (crossCompanyName) flags.push("cross_company_contamination");
      break;
    case "unknown_expected_domain":
      flags.push("domain_unknown");
      break;
  }

  // ── 2. Email quality checks ──────────────────────────────────────────────
  const emailExists = !!enrichedEmail;
  const isGenericEmail = isGenericRoleEmail(enrichedEmail);
  if (isGenericEmail) flags.push("generic_role_email");

  const verificationStatus = input.verificationStatus;
  if (verificationStatus === "accept_all") flags.push("catch_all_domain");
  if (verificationStatus === "invalid") flags.push("invalid_email");
  if (verificationStatus === "unknown") flags.push("unknown_verification");

  // Cross-contact email reuse
  if (enrichedEmail && input.allCampaignEnrichedEmails) {
    const emailLower = enrichedEmail.toLowerCase();
    const dupeCount = input.allCampaignEnrichedEmails.filter(
      e => e.toLowerCase() === emailLower
    ).length;
    if (dupeCount > 1) flags.push("email_reused_across_contacts");
  }

  // ── 3. Provider confidence ───────────────────────────────────────────────
  if (input.hunterConfidence !== null) {
    if (input.hunterConfidence < 30) flags.push("very_low_hunter_confidence");
    else if (input.hunterConfidence < 50) flags.push("low_hunter_confidence");
  }

  if (!input.enrichedLinkedin) flags.push("no_linkedin_corroboration");

  if (!emailExists && input.enrichmentSource !== null) {
    flags.push("provider_not_found");
  }

  const providerConfidence = computeProviderConfidence({
    enrichmentSource: input.enrichmentSource,
    verificationStatus,
    hunterConfidence: input.hunterConfidence,
    domainMatchType,
    isGenericEmail,
    hasLinkedin: !!input.enrichedLinkedin,
    emailExists,
  });

  // ── 4. Plausibility checks ───────────────────────────────────────────────
  if (input.retiredOrFormer) flags.push("retired_or_former");
  if (input.doNotContact) flags.push("do_not_contact");

  // Geo mismatch — non-AU/NZ country
  if (input.enrichedCountry) {
    const country = input.enrichedCountry.toLowerCase().trim();
    const auNzCountries = new Set(["australia", "new zealand", "au", "nz"]);
    if (!auNzCountries.has(country)) flags.push("geo_mismatch");
  }

  // Enriched to parent entity — email domain is a known parent of the target company
  if (domainMatchType === "trusted_parent_match" && actualDomain) {
    const parentCompany = DOMAIN_TO_COMPANY[actualDomain];
    if (parentCompany) flags.push("enriched_to_parent_entity");
  }

  // ── 5. Scoring gate ──────────────────────────────────────────────────────
  const sendEligibleTiers = new Set(["tier1_hot", "tier2_warm"]);
  if (!sendEligibleTiers.has(input.finalTier)) {
    flags.push("tier_not_send_eligible");
  }
  // tier1_hot requires score >= 55, tier2_warm requires score >= 35
  if (input.finalTier === "tier1_hot" && input.finalScore < 55) {
    flags.push("below_score_threshold");
  }
  if (input.finalTier === "tier2_warm" && input.finalScore < 35) {
    flags.push("below_score_threshold");
  }

  // ── 6. Partition flags into hard / soft ──────────────────────────────────
  const hardFlags = flags.filter(f => HARD_BLOCK_FLAGS.has(f));
  const softFlags = flags.filter(f => SOFT_REVIEW_FLAGS.has(f));

  // ── 7. Send-readiness ────────────────────────────────────────────────────
  const sendReadiness = determineSendReadiness(flags, providerConfidence, emailExists);

  // ── 8. Reasoning summary ─────────────────────────────────────────────────
  const reasoningSummary = buildReasoningSummary({
    sendReadiness,
    providerConfidence,
    domainMatchType,
    expectedDomain,
    actualDomain,
    hardFlags,
    softFlags,
    crossCompanyName,
    enrichmentSource: input.enrichmentSource,
    verificationStatus,
    hunterConfidence: input.hunterConfidence,
    company: input.company,
  });

  return {
    expectedDomain,
    actualDomain,
    domainMatchType,
    domainMatchSource,
    providerSource: input.enrichmentSource,
    verificationStatus,
    hunterConfidence: input.hunterConfidence,
    providerConfidence,
    qaFlags: flags,
    hardFlags,
    softFlags,
    sendReadiness,
    reasoningSummary,
    evaluatedAt: now,
    schemaVersion: SCHEMA_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reasoning summary builder
// ─────────────────────────────────────────────────────────────────────────────

function buildReasoningSummary(params: {
  sendReadiness: SendReadiness;
  providerConfidence: ProviderConfidenceBand;
  domainMatchType: DomainMatchType;
  expectedDomain: string | null;
  actualDomain: string | null;
  hardFlags: QAFlag[];
  softFlags: QAFlag[];
  crossCompanyName?: string;
  enrichmentSource: string | null;
  verificationStatus: string | null;
  hunterConfidence: number | null;
  company: string;
}): string {
  const parts: string[] = [];

  // Lead with the decision
  if (params.sendReadiness === "send_ready") {
    parts.push(`SEND_READY — ${params.providerConfidence}.`);
  } else if (params.sendReadiness === "review_before_send") {
    parts.push(`REVIEW_BEFORE_SEND — ${params.providerConfidence}.`);
  } else {
    parts.push(`BLOCKED — ${params.providerConfidence}.`);
  }

  // Domain
  if (params.domainMatchType === "exact_match") {
    parts.push(`Domain: exact match (${params.actualDomain}).`);
  } else if (params.domainMatchType === "trusted_parent_match") {
    parts.push(`Domain: trusted parent match — enriched to ${params.actualDomain}, expected ${params.expectedDomain}.`);
  } else if (params.domainMatchType === "alias_match") {
    parts.push(`Domain: alias match — ${params.actualDomain} is a known alias of ${params.expectedDomain}.`);
  } else if (params.domainMatchType === "suspicious_mismatch") {
    if (params.crossCompanyName) {
      parts.push(`Domain: SUSPICIOUS — enriched email domain ${params.actualDomain} belongs to ${params.crossCompanyName}, not ${params.company}.`);
    } else {
      parts.push(`Domain: SUSPICIOUS — enriched domain ${params.actualDomain} does not match expected ${params.expectedDomain}.`);
    }
  } else {
    parts.push(`Domain: unknown expected domain for ${params.company}.`);
  }

  // Provider
  if (params.enrichmentSource) {
    const src = params.enrichmentSource.toUpperCase();
    if (params.verificationStatus) {
      parts.push(`Provider: ${src} (${params.verificationStatus}${params.hunterConfidence !== null ? `, confidence ${params.hunterConfidence}` : ""}).`);
    } else {
      parts.push(`Provider: ${src}.`);
    }
  }

  // Hard flags
  if (params.hardFlags.length > 0) {
    parts.push(`Hard blocks: ${params.hardFlags.join(", ")}.`);
  }

  // Soft flags
  if (params.softFlags.length > 0) {
    parts.push(`Review flags: ${params.softFlags.join(", ")}.`);
  }

  return parts.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch evaluation helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run QA on a batch of contacts, automatically passing all enriched emails
 * for cross-contact dedup detection.
 */
export function evaluateEnrichmentQABatch(
  contacts: EnrichmentQAInput[]
): EnrichmentQAResult[] {
  // Collect all enriched emails for cross-contact dedup
  const allEmails = contacts
    .map(c => c.enrichedEmail || c.originalEmail)
    .filter((e): e is string => !!e);

  return contacts.map(contact =>
    evaluateEnrichmentQA({ ...contact, allCampaignEnrichedEmails: allEmails })
  );
}
