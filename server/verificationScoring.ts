/**
 * Verification Scoring System
 *
 * Computes a 0-100 verification score for each contact based on multiple signals.
 * The score helps salespeople quickly assess how trustworthy a contact's data is
 * before investing time in outreach.
 *
 * Score breakdown:
 * - Source quality (0-30): LinkedIn verified = 30, LLM generated = 10, manual = 20
 * - Name quality (0-15): Full name with 2+ parts = 15, single name = 5
 * - Email quality (0-15): Verified email = 15, pattern-guessed = 8, none = 0
 * - Title specificity (0-15): Specific title with seniority = 15, generic = 5
 * - LinkedIn presence (0-15): Direct profile URL = 15, search URL only = 5, none = 0
 * - Company match (0-10): Known major company = 10, unknown = 5
 */

// Major Australian mining/energy/infrastructure companies for company match scoring
const KNOWN_MAJOR_COMPANIES = new Set([
  "bhp", "rio tinto", "fortescue", "fortescue metals", "fmg",
  "newmont", "newcrest", "south32", "mineral resources", "minres",
  "pilbara minerals", "northern star", "evolution mining", "gold fields",
  "santos", "woodside", "chevron", "shell", "bp",
  "cimic", "thiess", "downer", "monadelphous", "nrw",
  "perenti", "macmahon", "byrnecut", "barminco", "ausdrill",
  "decmil", "clough", "worley", "bechtel", "fluor",
  "john holland", "cpb contractors", "lendlease", "laing o'rourke",
  "georgiou", "bam", "acciona", "samsung c&t",
  "alcoa", "iluka", "lynas", "igloo", "enermech",
  "atlas copco", "epiroc", "sandvik", "caterpillar", "komatsu",
  "weir minerals", "metso", "abb", "siemens",
  "origin energy", "agl", "transgrid", "ausgrid",
  "main roads", "water corporation", "horizon power",
  "roy hill", "hancock prospecting", "gina rinehart",
  "anglogold ashanti", "gold road", "de grey mining",
  "chalice mining", "liontown resources", "bellevue gold",
  "regis resources", "ramelius resources", "westgold",
  "karara mining", "citic pacific", "sino iron",
  "albemarle", "tianqi lithium", "igo", "nickel industries",
]);

// Seniority keywords that indicate a specific, senior title
const SENIORITY_KEYWORDS = [
  "director", "manager", "superintendent", "supervisor", "lead",
  "head of", "chief", "principal", "senior", "vp", "vice president",
  "general manager", "executive", "coordinator", "specialist",
];

export interface VerificationScoreBreakdown {
  total: number;
  source: number;
  nameQuality: number;
  emailQuality: number;
  titleSpecificity: number;
  linkedinPresence: number;
  companyMatch: number;
}

/**
 * Compute a 0-100 verification score for a contact.
 */
export function computeVerificationScore(contact: {
  enrichmentSource?: string | null;
  verificationStatus?: string | null;
  verifiedByUserId?: string | number | null;
  name: string;
  email?: string | null;
  emailVerified?: boolean | null;
  title: string;
  linkedin?: string | null;
  linkedinProfileUrl?: string | null;
  linkedinSearchUrl?: string | null;
  company: string;
}): VerificationScoreBreakdown {
  let source = 0;
  let nameQuality = 0;
  let emailQuality = 0;
  let titleSpecificity = 0;
  let linkedinPresence = 0;
  let companyMatch = 0;

  // 1. Source quality (0-30)
  // Team-verified contacts (crowdsourced) get full source score
  if (contact.verifiedByUserId) {
    source = 30;
  } else if (contact.verificationStatus === "verified" || contact.enrichmentSource === "linkedin") {
    source = 30;
  } else if (contact.enrichmentSource === "manual") {
    source = 20;
  } else if (contact.enrichmentSource === "llm") {
    source = 10;
  } else {
    source = 5;
  }

  // 2. Name quality (0-15)
  const nameParts = contact.name.trim().split(/\s+/);
  if (nameParts.length >= 2 && nameParts.every(p => p.length >= 2)) {
    nameQuality = 15;
  } else if (nameParts.length >= 2) {
    nameQuality = 10;
  } else {
    nameQuality = 5;
  }

  // 3. Email quality (0-15)
  if (contact.email) {
    if (contact.emailVerified) {
      emailQuality = 15;
    } else if (contact.verificationStatus === "verified") {
      emailQuality = 12;
    } else {
      emailQuality = 8; // Pattern-guessed
    }
  }

  // 4. Title specificity (0-15)
  const titleLower = contact.title.toLowerCase();
  const hasSeniority = SENIORITY_KEYWORDS.some(kw => titleLower.includes(kw));
  const titleWords = contact.title.trim().split(/\s+/).length;
  if (hasSeniority && titleWords >= 3) {
    titleSpecificity = 15;
  } else if (hasSeniority) {
    titleSpecificity = 12;
  } else if (titleWords >= 3) {
    titleSpecificity = 8;
  } else {
    titleSpecificity = 5;
  }

  // 5. LinkedIn presence (0-15)
  // Direct profile URLs (from LinkedIn API) get full score
  // Search URLs (from LLM generation) get partial score
  // Manually verified contacts get full score regardless
  if (contact.verificationStatus === "verified") {
    linkedinPresence = 15; // Verified by a human
  } else if (contact.linkedin && contact.linkedin.includes("/in/") && !contact.linkedin.includes("/search/")) {
    linkedinPresence = 15; // Direct profile URL from LinkedIn API
  } else if (contact.linkedinProfileUrl && contact.linkedinProfileUrl.includes("/in/") && !contact.linkedinProfileUrl.includes("/search/")) {
    linkedinPresence = 15; // Direct profile URL
  } else if (contact.linkedinSearchUrl || contact.linkedinProfileUrl) {
    linkedinPresence = 8; // Search URL (better than nothing)
  }

  // 6. Company match (0-10)
  const companyLower = contact.company.toLowerCase().trim();
  const isKnownCompany = Array.from(KNOWN_MAJOR_COMPANIES).some(
    kc => companyLower.includes(kc) || kc.includes(companyLower)
  );
  companyMatch = isKnownCompany ? 10 : 5;

  const total = source + nameQuality + emailQuality + titleSpecificity + linkedinPresence + companyMatch;

  return {
    total: Math.min(100, total),
    source,
    nameQuality,
    emailQuality,
    titleSpecificity,
    linkedinPresence,
    companyMatch,
  };
}

/**
 * Generate a precise LinkedIn search URL from a person's name, company, and title.
 * Uses LinkedIn's people search with all available context for best results.
 * Returns a search URL (not a guessed profile URL) since we can't know the actual profile slug.
 */
export function generateLinkedInSearchUrl(
  name: string,
  company?: string | null,
  title?: string | null,
): string {
  if (!name) return "";
  // Build a precise search query: "Name" at Company, Title
  const parts = [name];
  if (company) parts.push(company);
  if (title) {
    // Extract the core role keyword (e.g., "Procurement Manager" from "Head of Procurement - Australia")
    const coreTitle = title
      .replace(/[-–—]/g, " ")
      .replace(/\b(of|the|and|for|at|in)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 3)
      .join(" ");
    if (coreTitle) parts.push(coreTitle);
  }
  const query = parts.join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
}

/**
 * @deprecated Use generateLinkedInSearchUrl instead. This generates a guessed profile URL
 * that almost never resolves to the actual person.
 */
export function generateLinkedInProfileUrl(name: string): string {
  // Now redirects to search URL for better results
  return generateLinkedInSearchUrl(name);
}

/**
 * Get a human-readable label for a verification score.
 */
export function getScoreLabel(score: number): string {
  if (score >= 80) return "High Confidence";
  if (score >= 60) return "Moderate Confidence";
  if (score >= 40) return "Low Confidence";
  return "Needs Verification";
}

/**
 * Get a color class for a verification score (for UI).
 */
export function getScoreColor(score: number): string {
  if (score >= 80) return "emerald";
  if (score >= 60) return "blue";
  if (score >= 40) return "amber";
  return "red";
}
