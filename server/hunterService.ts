/**
 * hunterService.ts — Hunter.io API integration for email enrichment
 *
 * Provides:
 * - Domain Search: find all emails at a company domain (1 request per domain)
 * - Email Finder: find a specific person's email by name + domain (1 request per person)
 * - Email Verifier: check deliverability of an email address
 *
 * API docs: https://hunter.io/api-documentation/v2
 * Rate limits: 15 req/s, 500 req/min
 */

const HUNTER_API_BASE = "https://api.hunter.io/v2";

function getApiKey(): string {
  const key = process.env.HUNTER_API_KEY;
  if (!key) throw new Error("[Hunter] HUNTER_API_KEY not set");
  return key;
}

// ── Types ──

export interface HunterEmail {
  value: string;
  type: "personal" | "generic";
  confidence: number;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  seniority: string | null;
  department: string | null;
  linkedin: string | null;
  twitter: string | null;
  phone_number: string | null;
  verification: {
    date: string | null;
    status: "valid" | "accept_all" | "unknown" | "invalid" | null;
  } | null;
}

export interface DomainSearchResult {
  domain: string;
  organization: string;
  pattern: string | null;
  emails: HunterEmail[];
  totalResults: number;
}

export interface EmailFinderResult {
  email: string | null;
  score: number;
  position: string | null;
  linkedin_url: string | null;
  company: string | null;
  verification: {
    date: string | null;
    status: "valid" | "accept_all" | "unknown" | "invalid" | null;
  } | null;
}

export interface EmailVerifierResult {
  email: string;
  status: "valid" | "invalid" | "accept_all" | "unknown" | "webmail" | "disposable";
  score: number;
  result: string;
}

// ── Domain Search ──

/**
 * Search all email addresses at a given domain.
 * Uses 1 API request regardless of how many emails are returned.
 * Returns up to 100 emails per request.
 */
export async function domainSearch(
  domain: string,
  options?: { type?: "personal" | "generic"; limit?: number; offset?: number }
): Promise<DomainSearchResult> {
  const params = new URLSearchParams({
    domain,
    api_key: getApiKey(),
    limit: String(options?.limit ?? 100),
    offset: String(options?.offset ?? 0),
  });
  if (options?.type) params.set("type", options.type);

  const url = `${HUNTER_API_BASE}/domain-search?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[Hunter] Domain search failed for ${domain}: ${res.status} ${body}`);
  }

  const json = await res.json();
  const data = json.data;

  return {
    domain: data.domain,
    organization: data.organization || "",
    pattern: data.pattern || null,
    emails: (data.emails || []) as HunterEmail[],
    totalResults: json.meta?.results ?? data.emails?.length ?? 0,
  };
}

// ── Email Finder ──

/**
 * Find the most likely email address for a person at a domain.
 * Uses 1 API request per person.
 */
export async function emailFinder(opts: {
  domain?: string;
  company?: string;
  firstName: string;
  lastName: string;
}): Promise<EmailFinderResult> {
  if (!opts.domain && !opts.company) {
    throw new Error("[Hunter] emailFinder requires domain or company");
  }

  const params = new URLSearchParams({
    api_key: getApiKey(),
    first_name: opts.firstName,
    last_name: opts.lastName,
  });
  if (opts.domain) params.set("domain", opts.domain);
  if (opts.company) params.set("company", opts.company);

  const url = `${HUNTER_API_BASE}/email-finder?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text();
    // 404 means not found — not an error
    if (res.status === 404) {
      return { email: null, score: 0, position: null, linkedin_url: null, company: null, verification: null };
    }
    throw new Error(`[Hunter] Email finder failed: ${res.status} ${body}`);
  }

  const json = await res.json();
  const data = json.data;

  return {
    email: data.email || null,
    score: data.score || 0,
    position: data.position || null,
    linkedin_url: data.linkedin_url || null,
    company: data.company || null,
    verification: data.verification || null,
  };
}

// ── Email Verifier ──

/**
 * Verify the deliverability of an email address.
 * Uses 1 verification credit per email.
 * May take up to 20 seconds; returns 202 if still processing.
 */
export async function emailVerifier(email: string): Promise<EmailVerifierResult> {
  const params = new URLSearchParams({
    email,
    api_key: getApiKey(),
  });

  const url = `${HUNTER_API_BASE}/email-verifier?${params}`;
  let res = await fetch(url);

  // If 202, poll until complete (max 5 retries)
  let retries = 0;
  while (res.status === 202 && retries < 5) {
    await new Promise(r => setTimeout(r, 5000));
    res = await fetch(url);
    retries++;
  }

  if (!res.ok && res.status !== 202) {
    const body = await res.text();
    throw new Error(`[Hunter] Email verifier failed for ${email}: ${res.status} ${body}`);
  }

  const json = await res.json();
  const data = json.data;

  return {
    email: data.email,
    status: data.status || "unknown",
    score: data.score || 0,
    result: data.result || "unknown",
  };
}

// ── Batch Domain Search (groups contacts by domain) ──

interface ContactForEnrichment {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  company: string;
}

export interface HunterEnrichmentResult {
  contactId: number;
  email: string | null;
  confidence: number;
  position: string | null;
  linkedin: string | null;
  verificationStatus: string | null;
  source: "domain_search" | "email_finder";
}

/**
 * Enrich a batch of contacts using Hunter.io.
 * Strategy:
 * 1. Group contacts by company email domain
 * 2. Domain Search each unique domain (1 request per domain)
 * 3. Match returned emails to contacts by first/last name
 * 4. For unmatched contacts with known domain, use Email Finder as fallback
 *
 * Returns enrichment results for each contact.
 */
export async function batchHunterEnrich(
  contacts: ContactForEnrichment[],
  options?: { useFallbackFinder?: boolean; rateLimitMs?: number }
): Promise<{ results: HunterEnrichmentResult[]; domainSearches: number; emailFinderCalls: number }> {
  const useFallback = options?.useFallbackFinder ?? true;
  const rateLimitMs = options?.rateLimitMs ?? 200; // 200ms = 5 req/s (well within 15/s limit)

  const results: HunterEnrichmentResult[] = [];
  let domainSearches = 0;
  let emailFinderCalls = 0;

  // Group contacts by domain
  const domainGroups = new Map<string, ContactForEnrichment[]>();
  const noDomainContacts: ContactForEnrichment[] = [];

  for (const contact of contacts) {
    let domain: string | null = null;
    if (contact.email) {
      const match = contact.email.match(/@(.+)/);
      if (match) domain = match[1].toLowerCase();
    }
    if (domain) {
      if (!domainGroups.has(domain)) domainGroups.set(domain, []);
      domainGroups.get(domain)!.push(contact);
    } else {
      noDomainContacts.push(contact);
    }
  }

  console.log(`[Hunter] Enriching ${contacts.length} contacts across ${domainGroups.size} domains (${noDomainContacts.length} without domain)`);

  // Phase 1: Domain Search for each unique domain
  const matchedContactIds = new Set<number>();

  for (const [domain, domainContacts] of Array.from(domainGroups.entries())) {
    try {
      const searchResult = await domainSearch(domain, { type: "personal", limit: 100 });
      domainSearches++;

      // Match returned emails to our contacts
      for (const contact of domainContacts) {
        const contactFirst = (contact.firstName || "").toLowerCase().trim();
        const contactLast = (contact.lastName || "").toLowerCase().trim();

        if (!contactFirst && !contactLast) continue;

        // Find best matching email from domain search results
        let bestMatch: HunterEmail | null = null;
        let bestScore = 0;

        for (const hunterEmail of searchResult.emails) {
          const hFirst = (hunterEmail.first_name || "").toLowerCase().trim();
          const hLast = (hunterEmail.last_name || "").toLowerCase().trim();

          // Exact match on both names
          if (hFirst === contactFirst && hLast === contactLast) {
            bestMatch = hunterEmail;
            bestScore = hunterEmail.confidence;
            break;
          }

          // Partial match: first name matches and last name starts with same letter
          if (hFirst === contactFirst && hLast && contactLast && hLast[0] === contactLast[0]) {
            if (hunterEmail.confidence > bestScore) {
              bestMatch = hunterEmail;
              bestScore = hunterEmail.confidence;
            }
          }

          // Match on email pattern: check if email contains first.last or firstlast
          const emailLower = hunterEmail.value.toLowerCase();
          if (contactFirst && contactLast &&
            (emailLower.includes(`${contactFirst}.${contactLast}`) ||
             emailLower.includes(`${contactFirst}${contactLast}`) ||
             emailLower.includes(`${contactFirst[0]}.${contactLast}`) ||
             emailLower.includes(`${contactFirst[0]}${contactLast}`))) {
            if (hunterEmail.confidence > bestScore) {
              bestMatch = hunterEmail;
              bestScore = hunterEmail.confidence;
            }
          }
        }

        if (bestMatch) {
          results.push({
            contactId: contact.id,
            email: bestMatch.value,
            confidence: bestMatch.confidence,
            position: bestMatch.position,
            linkedin: bestMatch.linkedin,
            verificationStatus: bestMatch.verification?.status || null,
            source: "domain_search",
          });
          matchedContactIds.add(contact.id);
        }
      }

      // Rate limit between domain searches
      await new Promise(r => setTimeout(r, rateLimitMs));
    } catch (err) {
      console.error(`[Hunter] Domain search failed for ${domain}:`, err);
    }
  }

  // Phase 2: Email Finder fallback for unmatched contacts with known domains
  if (useFallback) {
    const unmatchedWithDomain: Array<{ contact: ContactForEnrichment; domain: string }> = [];

    for (const [domain, domainContacts] of Array.from(domainGroups.entries())) {
      for (const contact of domainContacts) {
        if (!matchedContactIds.has(contact.id) && contact.firstName && contact.lastName) {
          unmatchedWithDomain.push({ contact, domain });
        }
      }
    }

    // Also try contacts without domain but with company name
    for (const contact of noDomainContacts) {
      if (contact.firstName && contact.lastName && contact.company) {
        unmatchedWithDomain.push({ contact, domain: "" });
      }
    }

    console.log(`[Hunter] Running Email Finder fallback for ${unmatchedWithDomain.length} unmatched contacts`);

    for (const { contact, domain } of unmatchedWithDomain) {
      try {
        const finderResult = await emailFinder({
          domain: domain || undefined,
          company: !domain ? contact.company : undefined,
          firstName: contact.firstName!,
          lastName: contact.lastName!,
        });
        emailFinderCalls++;

        if (finderResult.email && finderResult.score >= 30) {
          results.push({
            contactId: contact.id,
            email: finderResult.email,
            confidence: finderResult.score,
            position: finderResult.position,
            linkedin: finderResult.linkedin_url,
            verificationStatus: finderResult.verification?.status || null,
            source: "email_finder",
          });
          matchedContactIds.add(contact.id);
        }

        await new Promise(r => setTimeout(r, rateLimitMs));
      } catch (err) {
        console.error(`[Hunter] Email finder failed for ${contact.firstName} ${contact.lastName}:`, err);
      }
    }
  }

  console.log(`[Hunter] Enrichment complete: ${results.length} found, ${domainSearches} domain searches, ${emailFinderCalls} email finder calls`);

  return { results, domainSearches, emailFinderCalls };
}
