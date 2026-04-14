/**
 * Geographic Filtering for Australian Market Intelligence
 *
 * Provides utilities to detect and filter out non-Australian contacts
 * from project displays and enrichment pipelines. All projects in the
 * system are Australian, so contacts should be Australia/APAC-based
 * or at minimum not explicitly assigned to other regions.
 *
 * Three-layer approach:
 * 1. Title-based region detection — flags contacts whose job titles
 *    contain explicit non-Australian region signals (LATAM, EMEA, Americas, etc.)
 * 2. Location-based filtering — uses LinkedIn location data to detect
 *    non-Australian geography
 * 3. Display filtering — safety net that filters contacts before showing
 *    them on Australian project cards
 */

// ── Non-Australian Region Signals in Job Titles ──

/**
 * Patterns that indicate a contact is responsible for a non-Australian region.
 * These are checked against job titles and headlines.
 * We look for explicit region assignments — a generic "Business Development Manager"
 * is fine, but "LATAM Business Development Manager" is not.
 */
const NON_AU_TITLE_PATTERNS: RegExp[] = [
  // Latin America
  /\blatam\b/i,
  /\blatin\s*america/i,
  /\bsouth\s*america/i,
  /\bcentral\s*america/i,
  /\bbrazil/i,
  /\bchile\b/i,
  /\bperu\b/i,
  /\bcolombia\b/i,
  /\bargentin/i,
  /\bmexico\b/i,
  /\bmexican\b/i,

  // EMEA
  /\bemea\b/i,
  /\beurope\b/i,
  /\beuropean\b/i,
  /\bmiddle\s*east/i,
  /\bafrica\b/i,
  /\bafrican\b/i,
  /\bsub-saharan/i,

  // Americas (non-Australia)
  /\bamericas\b/i,
  /\bnorth\s*america/i,
  /\busa\b/i,
  /\bunited\s*states/i,
  /\bcanada\b/i,
  /\bcanadian\b/i,

  // Asia (non-APAC/non-Australia)
  /\bchina\b/i,
  /\bchinese\b/i,
  /\bindia\b/i,
  /\bindian\b/i,
  /\bjapan/i,
  /\bkorea/i,
];

/**
 * Patterns that indicate a contact IS Australia/APAC-relevant.
 * If a title matches both a non-AU pattern and an AU pattern,
 * the AU pattern wins (e.g., "Global Director, Asia Pacific" is OK).
 */
const AU_APAC_TITLE_PATTERNS: RegExp[] = [
  /\baustrali/i,
  /\bapac\b/i,
  /\basia[- ]?pacific/i,
  /\banz\b/i,
  /\boceania/i,
  /\bnew\s*zealand/i,
  /\bperth\b/i,
  /\bsydney\b/i,
  /\bmelbourne\b/i,
  /\bbrisbane\b/i,
  /\bqueensland\b/i,
  /\bwestern\s*australia/i,
  /\bnsw\b/i,
  /\bvictoria\b/i,
  /\bwa\b/i,
  /\bqld\b/i,
  /\bpilbara\b/i,
  /\bkarratha\b/i,
  /\bnewcastle\b/i,
];

// ── Non-Australian Location Signals ──

const NON_AU_LOCATION_PATTERNS: RegExp[] = [
  // South America
  /\bbrazil/i,
  /\bchile\b/i,
  /\bperu\b/i,
  /\bcolombia\b/i,
  /\bargentin/i,
  /\bmexico\b/i,
  /\bbogot/i,
  /\blima\b/i,
  /\bsantiago\b/i,
  /\bsao\s*paulo/i,
  /\brio\s*de/i,
  /\bbuenos\s*aires/i,

  // North America
  /\bunited\s*states/i,
  /\bcanada\b/i,
  /\btoronto\b/i,
  /\bvancouver\b/i,
  /\bcalgary\b/i,
  /\bhouston\b/i,
  /\bdenver\b/i,
  /\bnew\s*york/i,

  // Europe
  /\bunited\s*kingdom/i,
  /\blondon\b/i,
  /\bgermany\b/i,
  /\bfrance\b/i,
  /\bsweden\b/i,
  /\bstockholm\b/i,
  /\bbelgium\b/i,
  /\bnetherlands\b/i,

  // Africa
  /\bsouth\s*africa/i,
  /\bjohannesburg/i,
  /\bcape\s*town/i,
  /\bghana\b/i,
  /\btanzania/i,
  /\bkenya\b/i,

  // Asia (non-APAC)
  /\bindia\b/i,
  /\bmumbai\b/i,
  /\bdelhi\b/i,
  /\bchina\b/i,
  /\bbeijing\b/i,
  /\bshanghai\b/i,
];

const AU_LOCATION_PATTERNS: RegExp[] = [
  /\baustrali/i,
  /\bperth\b/i,
  /\bsydney\b/i,
  /\bmelbourne\b/i,
  /\bbrisbane\b/i,
  /\badelaide\b/i,
  /\bdarwin\b/i,
  /\bhobart\b/i,
  /\bcanberra\b/i,
  /\bqueensland\b/i,
  /\bwestern\s*australia/i,
  /\bnew\s*south\s*wales/i,
  /\bvictoria\b/i,
  /\btasmania/i,
  /\bnorthern\s*territory/i,
  /\bsouth\s*australia/i,
  /\bpilbara\b/i,
  /\bkarratha\b/i,
  /\bnewcastle\b/i,
  /\bwollongong\b/i,
  /\btownsville\b/i,
  /\bmackay\b/i,
  /\bgladstone\b/i,
  /\bgeelong\b/i,
  /\bkalgoorlie\b/i,
];

// ── Detection Result ──

export type RegionClassification =
  | "australia"    // Confirmed Australian
  | "non_australia" // Confirmed non-Australian region
  | "unknown";     // No region signals detected (assume OK)

export interface GeoFilterResult {
  classification: RegionClassification;
  reason: string | null;
  /** The specific non-AU signal that was detected */
  detectedSignal: string | null;
}

// ── Core Detection Functions ──

/**
 * Check if a job title contains non-Australian region signals.
 * Returns the classification and the signal that triggered it.
 */
export function classifyTitleRegion(title: string | null | undefined): GeoFilterResult {
  if (!title) return { classification: "unknown", reason: null, detectedSignal: null };

  const t = title.trim();

  // First check if title has AU/APAC signals — these override non-AU signals
  const hasAuSignal = AU_APAC_TITLE_PATTERNS.some(p => p.test(t));

  // Check for non-AU signals
  for (const pattern of NON_AU_TITLE_PATTERNS) {
    if (pattern.test(t)) {
      if (hasAuSignal) {
        // AU signal overrides — e.g., "Director LATAM & APAC" is OK
        return {
          classification: "australia",
          reason: "Title has non-AU signal but also has AU/APAC signal (override)",
          detectedSignal: null,
        };
      }
      const match = t.match(pattern);
      return {
        classification: "non_australia",
        reason: `Title contains non-Australian region signal: "${match?.[0]}"`,
        detectedSignal: match?.[0] || null,
      };
    }
  }

  // Check for explicit AU signals
  if (hasAuSignal) {
    return {
      classification: "australia",
      reason: "Title contains Australia/APAC signal",
      detectedSignal: null,
    };
  }

  return { classification: "unknown", reason: null, detectedSignal: null };
}

/**
 * Check if a location string indicates non-Australian geography.
 */
export function classifyLocationRegion(location: string | null | undefined): GeoFilterResult {
  if (!location) return { classification: "unknown", reason: null, detectedSignal: null };

  const loc = location.trim();

  // Check for AU location first
  const hasAuLocation = AU_LOCATION_PATTERNS.some(p => p.test(loc));
  if (hasAuLocation) {
    return {
      classification: "australia",
      reason: "Location is in Australia",
      detectedSignal: null,
    };
  }

  // Check for non-AU location
  for (const pattern of NON_AU_LOCATION_PATTERNS) {
    if (pattern.test(loc)) {
      const match = loc.match(pattern);
      return {
        classification: "non_australia",
        reason: `Location is outside Australia: "${match?.[0]}"`,
        detectedSignal: match?.[0] || null,
      };
    }
  }

  return { classification: "unknown", reason: null, detectedSignal: null };
}

/**
 * Comprehensive contact region classification.
 * Checks title AND location. Non-AU in either = non-Australian.
 * AU in either = Australian (unless the other is explicitly non-AU).
 */
export function classifyContactRegion(contact: {
  title?: string | null;
  linkedinHeadline?: string | null;
  linkedinLocation?: string | null;
  location?: string | null;
}): GeoFilterResult {
  // Check title (use headline if available, fall back to title)
  const titleToCheck = contact.linkedinHeadline || contact.title;
  const titleResult = classifyTitleRegion(titleToCheck);

  // Check location
  const locationToCheck = contact.linkedinLocation || contact.location;
  const locationResult = classifyLocationRegion(locationToCheck);

  // If title says non-AU and no AU override from location
  if (titleResult.classification === "non_australia") {
    if (locationResult.classification === "australia") {
      // Location says AU, title says non-AU — trust location (person may be AU-based with regional title)
      return {
        classification: "australia",
        reason: "Title has non-AU signal but location is Australian",
        detectedSignal: null,
      };
    }
    return titleResult;
  }

  // If location says non-AU
  if (locationResult.classification === "non_australia") {
    if (titleResult.classification === "australia") {
      // Title says AU, location says non-AU — trust title (APAC role based overseas)
      return {
        classification: "australia",
        reason: "Location is non-AU but title has AU/APAC signal",
        detectedSignal: null,
      };
    }
    return locationResult;
  }

  // If either says AU
  if (titleResult.classification === "australia" || locationResult.classification === "australia") {
    return {
      classification: "australia",
      reason: titleResult.reason || locationResult.reason,
      detectedSignal: null,
    };
  }

  // Both unknown — assume OK (no region signals detected)
  return { classification: "unknown", reason: null, detectedSignal: null };
}

/**
 * Quick boolean check: should this contact be shown on Australian projects?
 * Returns true if the contact is Australian, APAC, or has no region signals.
 * Returns false only if the contact is explicitly non-Australian.
 */
export function isAustralianRelevant(contact: {
  title?: string | null;
  linkedinHeadline?: string | null;
  linkedinLocation?: string | null;
  location?: string | null;
}): boolean {
  const result = classifyContactRegion(contact);
  return result.classification !== "non_australia";
}

/**
 * Filter an array of contacts to only those relevant to Australian projects.
 * This is the main function used by display pipelines (thisWeekService, nextBestAction, etc.)
 */
export function filterAustralianContacts<T extends {
  title?: string | null;
  linkedinHeadline?: string | null;
  linkedinLocation?: string | null;
  location?: string | null;
}>(contacts: T[]): T[] {
  return contacts.filter(c => isAustralianRelevant(c));
}

/**
 * Classify a LinkedIn search result for geographic relevance.
 * Used during web stakeholder discovery and second-pass search
 * to filter out non-Australian results before saving to DB.
 */
export function isLinkedInResultAustralianRelevant(person: {
  headline?: string | null;
  location?: string | null;
  fullName?: string | null;
}): boolean {
  return isAustralianRelevant({
    title: person.headline,
    linkedinHeadline: person.headline,
    linkedinLocation: person.location,
  });
}

// ══════════════════════════════════════════════════════════════════════
// Company & Email Domain Geo-Filtering (for company search pipeline)
// ══════════════════════════════════════════════════════════════════════

// ── AU/NZ Email Domain TLDs ──
const AU_NZ_EMAIL_TLDS = [
  ".com.au",
  ".net.au",
  ".org.au",
  ".edu.au",
  ".gov.au",
  ".asn.au",
  ".id.au",
  ".co.nz",
  ".net.nz",
  ".org.nz",
  ".govt.nz",
  ".ac.nz",
];

// ── Known non-AU/NZ Email Domain TLDs ──
const NON_AUNZ_EMAIL_TLDS = [
  ".us",
  ".co.uk",
  ".org.uk",
  ".ca",
  ".de",
  ".fr",
  ".it",
  ".es",
  ".nl",
  ".se",
  ".no",
  ".dk",
  ".fi",
  ".jp",
  ".cn",
  ".in",
  ".br",
  ".za",
  ".sg",
  ".hk",
  ".my",
  ".ph",
  ".id",
  ".th",
  ".vn",
  ".kr",
  ".tw",
  ".ae",
  ".sa",
  ".ru",
  ".pl",
  ".cz",
  ".at",
  ".ch",
  ".be",
  ".ie",
  ".pt",
];

// ── AU/NZ Company Name Indicators ──
const AUNZ_COMPANY_PATTERNS: RegExp[] = [
  /\bpty\b/i,
  /\bpty\s*ltd\b/i,
  /\baustralia\b/i,
  /\baustralian\b/i,
  /\bnew\s*zealand\b/i,
];

// ── Non-AU/NZ Company Name Indicators ──
// These patterns target US-style legal suffixes. We require them to appear
// as the FINAL word (with optional period) to avoid false positives on
// company names that happen to contain these words mid-name.
const NON_AUNZ_COMPANY_PATTERNS: RegExp[] = [
  /\bllc\.?\s*$/i,          // "... LLC" or "... LLC."
  /,?\s+inc\.?\s*$/i,       // "..., Inc." or "... Inc"
  /\bcorporation\s*$/i,     // "... Corporation"
  /,?\s+corp\.?\s*$/i,      // "..., Corp." or "... Corp"
  /(?<!pty\s)\bltd\.?\s*$/i, // "... Ltd" but NOT "Pty Ltd" (which is Australian)
  /\bgmbh\b/i,              // German company suffix
  /\bs\.?a\.?\s*$/i,        // "... SA" or "... S.A." (European/Latin American)
];

// ── AU/NZ Country Names (for Apollo enrichment data) ──
const AUNZ_COUNTRY_NAMES = [
  "australia",
  "new zealand",
  "au",
  "nz",
  "aus",
  "nzl",
];

export type CompanyGeoCheckResult = {
  isAuNz: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
};

/**
 * Check if an email domain is definitively AU/NZ or non-AU/NZ.
 * Returns null if ambiguous (.com, .net, .org).
 */
export function checkEmailDomainGeo(email: string | null | undefined): CompanyGeoCheckResult | null {
  if (!email) return null;

  const lower = email.toLowerCase().trim();
  const atIndex = lower.lastIndexOf("@");
  if (atIndex < 0) return null;

  const domain = lower.substring(atIndex + 1);

  for (const tld of AU_NZ_EMAIL_TLDS) {
    if (domain.endsWith(tld)) {
      return { isAuNz: true, confidence: "high", reason: `Email domain ends with ${tld}` };
    }
  }

  for (const tld of NON_AUNZ_EMAIL_TLDS) {
    if (domain.endsWith(tld)) {
      return { isAuNz: false, confidence: "high", reason: `Email domain ends with ${tld} (non-AU/NZ)` };
    }
  }

  return null; // .com, .net, .org — ambiguous
}

/**
 * Check if a company domain TLD is definitively AU/NZ or non-AU/NZ.
 * Returns null if ambiguous (.com, .net, .org).
 */
export function checkCompanyDomainGeo(domain: string | null | undefined): CompanyGeoCheckResult | null {
  if (!domain) return null;

  const lower = domain.toLowerCase().trim();

  for (const tld of AU_NZ_EMAIL_TLDS) {
    if (lower.endsWith(tld)) {
      return { isAuNz: true, confidence: "high", reason: `Company domain ends with ${tld}` };
    }
  }

  for (const tld of NON_AUNZ_EMAIL_TLDS) {
    if (lower.endsWith(tld)) {
      return { isAuNz: false, confidence: "high", reason: `Company domain ends with ${tld} (non-AU/NZ)` };
    }
  }

  return null;
}

/**
 * Check if a company name suggests AU/NZ or non-AU/NZ origin.
 */
export function checkCompanyNameGeo(companyName: string | null | undefined): CompanyGeoCheckResult | null {
  if (!companyName) return null;

  for (const pattern of AUNZ_COMPANY_PATTERNS) {
    if (pattern.test(companyName)) {
      return { isAuNz: true, confidence: "medium", reason: `Company name matches AU/NZ pattern: ${pattern}` };
    }
  }

  for (const pattern of NON_AUNZ_COMPANY_PATTERNS) {
    if (pattern.test(companyName)) {
      return { isAuNz: false, confidence: "medium", reason: `Company name matches non-AU/NZ pattern: ${pattern}` };
    }
  }

  return null;
}

/**
 * Check if a country string (from Apollo enrichment) is AU/NZ.
 */
export function checkCountryGeo(country: string | null | undefined): CompanyGeoCheckResult | null {
  if (!country) return null;

  const lower = country.toLowerCase().trim();

  if (AUNZ_COUNTRY_NAMES.includes(lower)) {
    return { isAuNz: true, confidence: "high", reason: `Country is ${country}` };
  }

  return { isAuNz: false, confidence: "high", reason: `Country is ${country} (not AU/NZ)` };
}

/**
 * Combined geo-check for a contact/company using all available signals.
 * Priority: country > email domain > company domain > company name
 *
 * Returns isAuNz=true if the contact appears to be AU/NZ.
 * For ambiguous cases (.com domains, no company indicators), defaults to true
 * (benefit of the doubt — the company was in our target list).
 */
export function isAuNzCompanyContact(params: {
  email?: string | null;
  company?: string | null;
  country?: string | null;
  domain?: string | null;
}): CompanyGeoCheckResult {
  // 1. Country field (highest confidence — from Apollo enrichment)
  const countryCheck = checkCountryGeo(params.country);
  if (countryCheck && countryCheck.confidence === "high") {
    return countryCheck;
  }

  // 2. Email domain TLD
  const emailCheck = checkEmailDomainGeo(params.email);
  if (emailCheck && emailCheck.confidence === "high") {
    return emailCheck;
  }

  // 3. Company domain TLD
  const domainCheck = checkCompanyDomainGeo(params.domain);
  if (domainCheck && domainCheck.confidence === "high") {
    return domainCheck;
  }

  // 4. Company name heuristics
  const companyCheck = checkCompanyNameGeo(params.company);
  if (companyCheck) {
    return companyCheck;
  }

  // Can't determine — assume AU/NZ (benefit of the doubt)
  return { isAuNz: true, confidence: "low", reason: "No geo signals found — assumed AU/NZ" };
}

/**
 * Filter contacts from company search results, removing non-AU/NZ entries.
 * Used during import to exclude contacts like Easy Air Rentals (US .com company).
 */
export function filterAuNzCompanyContacts<T extends {
  email?: string | null;
  company?: string | null;
}>(
  contacts: T[],
  companyDomain?: string
): { kept: T[]; removed: { contact: T; reason: string }[] } {
  const kept: T[] = [];
  const removed: { contact: T; reason: string }[] = [];

  for (const contact of contacts) {
    const result = isAuNzCompanyContact({
      email: contact.email,
      company: contact.company,
      domain: companyDomain,
    });

    if (result.isAuNz) {
      kept.push(contact);
    } else {
      removed.push({ contact, reason: result.reason });
    }
  }

  return { kept, removed };
}
