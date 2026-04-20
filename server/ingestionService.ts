/**
 * ingestionService.ts
 *
 * Stage 1: Pre-waterfall ingestion and normalization layer.
 *
 * Every uploaded file passes through this pipeline before any Apollo/Hunter
 * enrichment or scoring is run.
 *
 * Pipeline stages (in order):
 *   1. Upload type detection
 *   2. Header mapping (flexible synonym resolution)
 *   3. Row-level cleaning and normalization
 *   4. Name parsing (full-name split, honorific stripping, casing)
 *   5. Title normalization (whitespace, casing, known-alias expansion)
 *   6. Company canonicalization (legal-suffix stripping, casing, domain extraction)
 *   7. Joint-venture detection
 *   8. Duplicate detection (within-batch and against existing campaign contacts)
 *   9. Row classification (verified_contact / enrichable_contact / company_target /
 *                          review_needed / rejected)
 *  10. Review-needed queue assembly
 *  11. Clean staging output ready for Stage 2 (enrichment / scoring)
 */

import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────────
// 1. TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type UploadFileType =
  | "contact_split"   // has firstName + lastName columns
  | "contact_full"    // has a single full-name column
  | "crm_export"      // mixed: full name, messy org, notes, variable quality
  | "company_only"    // no contact names — only company/domain rows
  | "unknown";

/**
 * Record type: whether this row represents a person or a company target.
 * company_target rows NEVER go to person scoring or enrichment.
 */
export type RecordType = "person" | "company_target";

/**
 * Five-value classification replacing the old clean/review_needed/skip.
 *
 * verified_contact    — has name + email + company, no blocking flags
 * enrichable_contact  — has name + company but no email (needs enrichment)
 * company_target      — company-only row; goes to company enrichment branch only
 * review_needed       — has flags requiring human review before proceeding
 * rejected            — empty, duplicate, unrecoverable, or explicitly excluded
 */
export type RowClassification =
  | "verified_contact"
  | "enrichable_contact"
  | "company_target"
  | "review_needed"
  | "rejected";

export type ReviewFlag =
  | "no_name"                  // no first or last name
  | "no_company"               // no company name or domain
  | "suspicious_email"         // email fails format check or is a role address
  | "placeholder_name"         // name looks like a placeholder (e.g. "Test", "N/A")
  | "placeholder_company"      // company looks like a placeholder
  | "duplicate_in_batch"       // same email or name+company already seen in this upload
  | "duplicate_in_campaign"    // already exists in the target campaign
  | "title_too_long"           // title > 120 chars (likely a notes/bio field)
  | "company_too_long"         // company > 200 chars
  | "name_looks_like_company"  // first name contains "Pty", "Ltd", "Inc" etc.
  | "honorific_only"           // name is just "Mr", "Dr" etc. with no actual name
  | "all_caps_name"            // entire name is uppercase (likely a data quality issue)
  | "non_au_email"             // email domain is definitively non-AU/NZ
  | "retired_or_former"        // title/notes contains retired/former/ex-/left company
  | "do_not_contact"           // notes contain "do not contact" or similar
  | "joint_venture"            // company name looks like a JV (e.g. "CIMIC/UGL")
  | "test_row"                 // name, email, or company looks like a test record
  | "email_as_name";           // the name field contains an email address (CRM export issue)

/** A single row after full normalization, ready for staging */
export interface StagedContact {
  // Record type — drives routing to person vs company enrichment branch
  recordType: RecordType;

  // Identity (normalized)
  firstName: string | null;
  lastName: string | null;
  fullNameRaw: string | null;         // original full name as uploaded (for audit)
  title: string | null;
  titleRaw: string | null;            // original title before normalization
  company: string | null;
  companyRaw: string | null;          // original company before canonicalization
  companyCanonical: string | null;    // cleaned company name (no legal suffixes)
  jointVentureLabel: string | null;   // e.g. "CIMIC / UGL Joint Venture"
  domain: string | null;             // extracted/cleaned domain
  email: string | null;
  phone: string | null;
  mobile: string | null;
  linkedin: string | null;
  notes: string | null;

  // Classification
  classification: RowClassification;
  reviewFlags: ReviewFlag[];
  rejectionReason: string | null;     // human-readable reason when classification = rejected
  duplicateOf: string | null;         // dedup key of the original record this duplicates

  // Provenance
  sourceRow: number;
  uploadFileType: UploadFileType;
}

/** The result of running the full ingestion pipeline on one file */
export interface IngestionResult {
  fileType: UploadFileType;
  totalRows: number;
  verifiedContacts: number;
  enrichableContacts: number;
  companyTargets: number;
  reviewRows: number;
  rejectedRows: number;
  staged: StagedContact[];
  errors: string[];
}

/** Column mapping: field name → column index in the parsed sheet */
export interface IngestColumnMapping {
  firstName?: number;
  lastName?: number;
  fullName?: number;
  title?: number;
  company?: number;
  email?: number;
  phone?: number;
  mobile?: number;
  linkedin?: number;
  domain?: number;
  notes?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. HEADER MAPPING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exhaustive synonym map for each internal field.
 * Patterns are tested case-insensitively against the trimmed header string.
 */
export const HEADER_SYNONYMS: Record<keyof IngestColumnMapping, RegExp[]> = {
  firstName: [
    /^first\s*name$/i, /^first$/i, /^given\s*name$/i, /^fname$/i,
    /^contact\s*first/i, /^f\.?\s*name$/i, /^forename$/i, /^preferred\s*name$/i,
  ],
  lastName: [
    /^last\s*name$/i, /^last$/i, /^surname$/i, /^family\s*name$/i,
    /^lname$/i, /^contact\s*last/i, /^l\.?\s*name$/i,
  ],
  fullName: [
    /^full\s*name$/i, /^contact\s*name$/i, /^person\s*name$/i, /^person$/i,
    /^name$/i, /^contact$/i, /^full\s*contact\s*name$/i, /^display\s*name$/i,
    /^attendee$/i, /^lead\s*name$/i,
  ],
  title: [
    /^title$/i, /^job\s*title$/i, /^position$/i, /^role$/i, /^designation$/i,
    /^job\s*role$/i, /^occupation$/i, /^function$/i, /^job\s*function$/i,
    /^seniority$/i, /^level$/i,
  ],
  company: [
    /^company$/i, /^organization$/i, /^organisation$/i, /^employer$/i,
    /^account\s*name$/i, /^company\s*name$/i, /^business$/i, /^business\s*name$/i,
    /^firm$/i, /^org$/i, /^org\s*name$/i, /^client$/i, /^client\s*name$/i,
    /^company\s*\/\s*organization/i, /^company\s*or\s*organization/i,
  ],
  email: [
    /^e?\s*-?\s*mail$/i, /^email\s*address$/i, /^e-mail\s*address$/i,
    /^contact\s*email$/i, /^work\s*email$/i, /^business\s*email$/i,
    /^email\s*1$/i, /^primary\s*email$/i,
  ],
  phone: [
    /^phone$/i, /^telephone$/i, /^tel$/i, /^phone\s*number$/i,
    /^work\s*phone$/i, /^office\s*phone$/i, /^direct\s*phone$/i,
    /^business\s*phone$/i, /^ph$/i, /^phone\s*1$/i,
  ],
  mobile: [
    /^mobile$/i, /^cell$/i, /^mobile\s*phone$/i, /^cell\s*phone$/i,
    /^mobile\s*number$/i, /^cell\s*number$/i, /^mob$/i,
  ],
  linkedin: [
    /^linkedin$/i, /^linkedin\s*url$/i, /^linkedin\s*profile$/i,
    /^li\s*url$/i, /^linkedin\s*link$/i, /^linkedin\s*page$/i,
  ],
  domain: [
    /^domain$/i, /^website$/i, /^web$/i, /^url$/i, /^company\s*website$/i,
    /^company\s*domain$/i, /^site$/i, /^web\s*address$/i, /^homepage$/i,
  ],
  notes: [
    /^notes?$/i, /^comment/i, /^description$/i, /^details?$/i, /^info$/i,
    /^remarks?$/i, /^memo$/i, /^additional\s*info/i,
  ],
};

/**
 * Auto-detect column mapping from a header row.
 * Each column index can only be assigned to one field (first-match wins).
 * Returns the mapping and a confidence score (0–1) based on how many
 * expected fields were found.
 */
export function detectColumnMapping(
  headers: string[]
): { mapping: IngestColumnMapping; confidence: number } {
  const mapping: IngestColumnMapping = {};
  const usedCols = new Set<number>();

  for (const [field, patterns] of Object.entries(HEADER_SYNONYMS) as [keyof IngestColumnMapping, RegExp[]][]) {
    for (let i = 0; i < headers.length; i++) {
      if (usedCols.has(i)) continue;
      const h = headers[i].trim();
      if (patterns.some(p => p.test(h))) {
        mapping[field] = i;
        usedCols.add(i);
        break;
      }
    }
  }

  // Confidence: how many of the four "core" fields were found
  const coreFields: (keyof IngestColumnMapping)[] = ["company", "email", "title"];
  const nameFound = mapping.firstName !== undefined || mapping.lastName !== undefined || mapping.fullName !== undefined;
  const coreFound = coreFields.filter(f => mapping[f] !== undefined).length;
  const confidence = ((nameFound ? 1 : 0) + coreFound) / 4;

  return { mapping, confidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. UPLOAD TYPE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine the upload type from the detected column mapping and data rows.
 */
export function detectUploadType(
  mapping: IngestColumnMapping,
  dataRows: string[][],
  headerRow: string[]
): UploadFileType {
  const hasSplitName = mapping.firstName !== undefined || mapping.lastName !== undefined;
  const hasFullName = mapping.fullName !== undefined;
  const hasCompany = mapping.company !== undefined || mapping.domain !== undefined;
  const hasEmail = mapping.email !== undefined;

  if (!hasCompany && !hasEmail && !hasSplitName && !hasFullName) return "unknown";

  // Count rows with names vs company-only
  let rowsWithName = 0;
  let rowsCompanyOnly = 0;
  const sampleSize = Math.min(dataRows.length, 50);

  for (let i = 0; i < sampleSize; i++) {
    const row = dataRows[i];
    const firstName = mapping.firstName !== undefined ? cleanCell(row[mapping.firstName]) : null;
    const lastName = mapping.lastName !== undefined ? cleanCell(row[mapping.lastName]) : null;
    const fullName = mapping.fullName !== undefined ? cleanCell(row[mapping.fullName]) : null;
    const company = mapping.company !== undefined ? cleanCell(row[mapping.company]) : null;
    const domain = mapping.domain !== undefined ? cleanCell(row[mapping.domain]) : null;
    const email = mapping.email !== undefined ? cleanCell(row[mapping.email]) : null;

    const hasName = !!(firstName || lastName || fullName || email);
    const hasOrg = !!(company || domain);

    if (hasName) rowsWithName++;
    else if (hasOrg) rowsCompanyOnly++;
  }

  const nonEmpty = rowsWithName + rowsCompanyOnly;
  if (nonEmpty === 0) return "unknown";

  // If >60% of rows are company-only, treat as company list
  if (rowsCompanyOnly / nonEmpty > 0.6) return "company_only";

  // Distinguish contact_split vs contact_full vs crm_export
  if (hasSplitName) return "contact_split";

  // Detect CRM export: has full name + notes/description columns
  const hasNotes = mapping.notes !== undefined;
  const hasMultipleExtraColumns = Object.keys(mapping).length >= 5;
  if (hasFullName && (hasNotes || hasMultipleExtraColumns)) return "crm_export";

  if (hasFullName) return "contact_full";

  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. NAME PARSING
// ─────────────────────────────────────────────────────────────────────────────

const HONORIFICS = /^(mr\.?|mrs\.?|ms\.?|miss\.?|dr\.?|prof\.?|rev\.?|sir|lady|lord|mx\.?)\s+/i;
const HONORIFIC_ONLY = /^(mr\.?|mrs\.?|ms\.?|miss\.?|dr\.?|prof\.?|rev\.?|sir|lady|lord|mx\.?)\.?$/i;

const COMPANY_SUFFIXES_IN_NAME = /\b(pty|ltd|llc|inc|corp|co\.|plc|gmbh|bv|srl|nv|ag|sa|as)\b/i;

const PLACEHOLDER_NAMES = new Set([
  "test", "n/a", "na", "none", "unknown", "tbd", "tba", "-", "--", "---",
  "first", "last", "name", "contact", "person", "user", "example",
]);

/** Patterns that indicate a test/dummy record */
const TEST_NAME_PATTERN = /^(test|dummy|sample|fake|demo|example|placeholder)\b/i;
const TEST_EMAIL_PATTERN = /^(test|dummy|sample|fake|demo|example)@/i;
const TEST_COMPANY_PATTERN = /^(test\s*company|test\s*org|sample\s*company|dummy\s*company)/i;

/**
 * Parse a full name string into first and last name components.
 * Strips honorifics, handles single-word names, and applies title-case.
 */
export function parseFullName(raw: string | null): {
  firstName: string | null;
  lastName: string | null;
  flags: ReviewFlag[];
} {
   if (!raw || !raw.trim()) return { firstName: null, lastName: null, flags: [] };
  const flags: ReviewFlag[] = [];
  let name = raw.trim();
  // Check if the name field contains an email address (common CRM export issue)
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) {
    flags.push("email_as_name");
    return { firstName: null, lastName: null, flags };
  }
  // Check for honorific-only
  if (HONORIFIC_ONLY.test(name)) {
    return { firstName: null, lastName: null, flags: ["honorific_only"] };
  }
  // Handle comma-separatedd "Last, First" format (e.g. "Smith, John")
  if (/^[^,]+,\s*[^,]+$/.test(name)) {
    const commaIdx = name.indexOf(",");
    const last = name.slice(0, commaIdx).trim();
    const first = name.slice(commaIdx + 1).trim();
    // Only treat as Last, First if both parts are present and neither looks like a company
    if (first && last && !COMPANY_SUFFIXES_IN_NAME.test(first) && !COMPANY_SUFFIXES_IN_NAME.test(last)) {
      name = `${first} ${last}`;
    }
  }

  // Strip leading honorific
  name = name.replace(HONORIFICS, "").trim();

  // Check for company suffix in name field
  if (COMPANY_SUFFIXES_IN_NAME.test(name)) {
    flags.push("name_looks_like_company");
  }

  // Check for all-caps (likely data quality issue)
  if (name.length > 3 && name === name.toUpperCase() && /[A-Z]/.test(name)) {
    flags.push("all_caps_name");
  }

  // Check for test record
  if (TEST_NAME_PATTERN.test(name)) {
    flags.push("test_row");
  }

  // Split on whitespace
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null, flags };

  let firstName: string | null = null;
  let lastName: string | null = null;

  if (parts.length === 1) {
    const single = toTitleCase(parts[0]);
    if (PLACEHOLDER_NAMES.has(single.toLowerCase())) {
      return { firstName: null, lastName: null, flags: ["placeholder_name"] };
    }
    firstName = single;
  } else {
    firstName = toTitleCase(parts[0]);
    lastName = parts.slice(1).map(toTitleCase).join(" ");
    // Strip parenthetical suffixes from lastName: (retired), (former), (deceased), etc.
    if (lastName) {
      lastName = lastName.replace(/\s*\((?:retired|former|ex|deceased|emeritus|left|past|inactive)[^)]*\)/gi, "").trim() || null;
    }
  }

  // Check placeholders
  if (firstName && PLACEHOLDER_NAMES.has(firstName.toLowerCase())) {
    return { firstName: null, lastName: null, flags: ["placeholder_name"] };
  }

  return { firstName, lastName, flags };
}

/**
 * Normalize a split first/last name pair.
 */
export function normalizeSplitName(
  rawFirst: string | null,
  rawLast: string | null
): { firstName: string | null; lastName: string | null; flags: ReviewFlag[] } {
  const flags: ReviewFlag[] = [];

  let firstName = rawFirst ? rawFirst.trim() : null;
  let lastName = rawLast ? rawLast.trim() : null;

  // Strip honorifics from first name
  if (firstName) {
    firstName = firstName.replace(HONORIFICS, "").trim() || null;
    if (firstName && HONORIFIC_ONLY.test(firstName)) {
      flags.push("honorific_only");
      firstName = null;
    }
  }

  if (firstName && PLACEHOLDER_NAMES.has(firstName.toLowerCase())) {
    flags.push("placeholder_name");
    firstName = null;
  }
  if (lastName && PLACEHOLDER_NAMES.has(lastName.toLowerCase())) {
    flags.push("placeholder_name");
    lastName = null;
  }

  // Check all-caps
  if (firstName && firstName.length > 2 && firstName === firstName.toUpperCase()) {
    flags.push("all_caps_name");
  }

  // Check for test record
  if ((firstName && TEST_NAME_PATTERN.test(firstName)) || (lastName && TEST_NAME_PATTERN.test(lastName))) {
    flags.push("test_row");
  }

  // Apply title case
  if (firstName) firstName = toTitleCase(firstName);
  if (lastName) lastName = toTitleCase(lastName);

  // Check for company suffix in name
  const combined = [firstName, lastName].filter(Boolean).join(" ");
  if (COMPANY_SUFFIXES_IN_NAME.test(combined)) {
    flags.push("name_looks_like_company");
  }

  return { firstName, lastName, flags };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. TITLE NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/** Known title aliases → canonical form */
const TITLE_ALIASES: [RegExp, string][] = [
  [/^md$/i, "Managing Director"],
  [/^ceo$/i, "Chief Executive Officer"],
  [/^coo$/i, "Chief Operating Officer"],
  [/^cfo$/i, "Chief Financial Officer"],
  [/^cto$/i, "Chief Technology Officer"],
  [/^gm$/i, "General Manager"],
  [/^bdm$/i, "Business Development Manager"],
  [/^bde$/i, "Business Development Executive"],
  [/^pm$/i, "Project Manager"],
  [/^ops\s*mgr$/i, "Operations Manager"],
  [/^procurement\s*mgr$/i, "Procurement Manager"],
  [/^site\s*mgr$/i, "Site Manager"],
  [/^proj\s*mgr$/i, "Project Manager"],
  [/^eng(?:ineer)?$/i, "Engineer"],
  [/^sr\.?\s+/i, "Senior "],
  [/^snr\.?\s+/i, "Senior "],
  [/^jnr\.?\s+/i, "Junior "],
  [/^jr\.?\s+/i, "Junior "],
];

/**
 * Patterns indicating a person is retired, former, or has left the company.
 * These rows should be flagged for review, not automatically enriched.
 */
const RETIRED_FORMER_PATTERN = /\b(retired|former|ex[-\s]|previously\s+at|left\s+company|no\s+longer|past\s+|emeritus)\b/i;

/**
 * Patterns in notes indicating a do-not-contact instruction.
 */
const DO_NOT_CONTACT_PATTERN = /\b(do\s+not\s+contact|dnc|do\s+not\s+call|opt[-\s]?out|unsubscribed?|removed?|blacklist|suppressed?|bounced?)\b/i;

/**
 * Normalize a job title:
 * - Trim whitespace
 * - Collapse internal whitespace
 * - Expand known abbreviations
 * - Apply title-case
 * - Flag if too long (likely a bio/notes field)
 * - Flag if retired/former/ex-
 */
export function normalizeTitle(raw: string | null): {
  title: string | null;
  flags: ReviewFlag[];
} {
  if (!raw || !raw.trim()) return { title: null, flags: [] };
  const flags: ReviewFlag[] = [];

  let t = raw.trim().replace(/\s+/g, " ");

  // Flag if too long
  if (t.length > 120) {
    flags.push("title_too_long");
    t = t.slice(0, 120);
  }

  // Flag retired/former/ex- titles
  if (RETIRED_FORMER_PATTERN.test(t)) {
    flags.push("retired_or_former");
  }

  // Expand known abbreviations (full match only)
  for (const [pattern, replacement] of TITLE_ALIASES) {
    if (pattern.test(t)) {
      t = t.replace(pattern, replacement);
      break;
    }
  }

  // Strip trailing punctuation (periods, commas, semicolons)
  t = t.replace(/[.,;:!?]+$/, "").trim();

  // Apply title case.
  // Preserve known short acronyms (2-3 uppercase letters: IT, HR, GM, CEO, COO, CFO, CTO, etc.)
  // but title-case longer all-caps words like "SITE", "SENIOR", "SUPERVISOR"
  const KNOWN_ACRONYMS = new Set([
    "CEO", "COO", "CFO", "CTO", "GM", "MD", "HR", "IT", "VP", "SVP", "EVP",
    "BD", "BDM", "PM", "PA", "EA", "QA", "QC", "HSE", "WHS", "EHS",
    "FIFO", "DIDO", "EPC", "EPCM", "O&M", "R&D",
  ]);
  t = t.split(" ").map(word => {
    if (KNOWN_ACRONYMS.has(word)) return word;
    if (/^[A-Z]{2,3}$/.test(word)) return word; // keep 2-3 letter all-caps
    return toTitleCase(word);
  }).join(" ");

  return { title: t || null, flags };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. COMPANY CANONICALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Legal suffixes to strip when creating the canonical company name.
 * Stripping is done for deduplication purposes only — the original name is preserved.
 */
const LEGAL_SUFFIX_PATTERN = /\s*[\(\[]?(pty\.?\s*ltd\.?|pty\s*limited|ltd\.?|limited|llc|inc\.?|incorporated|corp\.?|corporation|plc|gmbh|bv|srl|nv|ag|sa|as|co\.?\s*pty|co\.?\s*ltd|trading\s+as\s+\S+|t\/a\s+\S+|atf\s+\S+)[\)\]]?\.?\s*$/i;

const PLACEHOLDER_COMPANIES = new Set([
  "n/a", "na", "none", "unknown", "tbd", "tba", "-", "--", "---",
  "not applicable", "company", "organization", "organisation", "employer",
  "(not a company name)", "not a company name",
]);

/**
 * Joint-venture detection patterns.
 * Matches patterns like "CIMIC / UGL", "Thiess-UGL JV", "BHP Rio Tinto Joint Venture"
 */
const JV_PATTERN = /\b(jv|j\.v\.|joint\s+venture|joint\s*venture|consortium)\b|(\w+)\s*[\/\-&]\s*(\w+)\s+(jv|joint\s+venture)/i;
const JV_SLASH_PATTERN = /^([A-Z][A-Za-z\s]+)\s*[\/]\s*([A-Z][A-Za-z\s]+)(?:\s+(jv|joint\s+venture|consortium))?$/;

/**
 * Canonicalize a company name:
 * - Trim and collapse whitespace
 * - Strip legal suffixes (for dedup key)
 * - Apply title case
 * - Extract domain if present in the string
 * - Flag placeholders
 * - Detect joint ventures
 */
export function canonicalizeCompany(raw: string | null): {
  company: string | null;
  canonical: string | null;
  domain: string | null;
  jointVentureLabel: string | null;
  flags: ReviewFlag[];
} {
  if (!raw || !raw.trim()) return { company: null, canonical: null, domain: null, jointVentureLabel: null, flags: [] };
  const flags: ReviewFlag[] = [];

  let company = raw.trim().replace(/\s+/g, " ");

  // Flag placeholder companies
  if (PLACEHOLDER_COMPANIES.has(company.toLowerCase())) {
    return { company: null, canonical: null, domain: null, jointVentureLabel: null, flags: ["placeholder_company"] };
  }

  // Flag test company
  if (TEST_COMPANY_PATTERN.test(company)) {
    flags.push("test_row");
  }

  // Flag if too long
  if (company.length > 200) {
    flags.push("company_too_long");
    company = company.slice(0, 200);
  }

  // Extract domain if the company field contains a URL
  let domain: string | null = null;
  const urlMatch = company.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)/);
  if (urlMatch && /\.(com|net|org|au|co|io|gov|edu|uk|nz|biz|info)/i.test(urlMatch[0])) {
    domain = urlMatch[1].toLowerCase();
    // If the whole string is a URL, use domain as company name
    if (/^https?:\/\//i.test(company) || company === urlMatch[0]) {
      company = domain;
    }
  }

  // Detect joint venture
  let jointVentureLabel: string | null = null;
  if (JV_PATTERN.test(company) || JV_SLASH_PATTERN.test(company)) {
    flags.push("joint_venture");
    // Normalize the JV label
    jointVentureLabel = company
      .replace(/\s*[\/]\s*/g, " / ")
      .replace(/\bjv\b/gi, "JV")
      .replace(/\bjoint\s*venture\b/gi, "Joint Venture")
      .trim();
  }

  // Strip legal suffixes to create canonical key
  const canonical = company
    .replace(LEGAL_SUFFIX_PATTERN, "")
    .trim()
    .replace(/\s+/g, " ");

  // Apply title case to canonical (preserve all-caps acronyms)
  const canonicalCased = canonical.split(" ").map(word => {
    if (/^[A-Z]{2,6}$/.test(word)) return word;
    return toTitleCase(word);
  }).join(" ");

  return {
    company: company || null,
    canonical: canonicalCased || null,
    domain,
    jointVentureLabel,
    flags,
  };
}

/**
 * Extract a clean domain from a URL or domain string.
 */
export function extractDomain(raw: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .trim() || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. EMAIL VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Role-based email addresses that are unlikely to reach an individual */
const ROLE_EMAIL_PREFIXES = new Set([
  "info", "contact", "admin", "sales", "support", "hello", "enquiries",
  "enquiry", "office", "accounts", "billing", "reception", "hr", "jobs",
  "careers", "marketing", "media", "press", "noreply", "no-reply",
  "donotreply", "postmaster", "webmaster", "help", "service",
]);

/** Definitively non-AU/NZ TLDs */
const NON_AU_TLDS = /\.(co\.uk|co\.in|co\.jp|co\.kr|co\.za|de|fr|it|es|nl|se|no|fi|dk|pl|ru|cn|jp|kr|in|br|mx|ar|cl|za|ng|ke|gh|eg|pk|bd|vn|th|id|ph|sg|hk|tw)$/i;

export function validateEmail(raw: string | null): {
  email: string | null;
  flags: ReviewFlag[];
} {
  if (!raw || !raw.trim()) return { email: null, flags: [] };
  const flags: ReviewFlag[] = [];
  const email = raw.trim().toLowerCase();

  // Check for test email
  if (TEST_EMAIL_PATTERN.test(email)) {
    return { email: null, flags: ["test_row", "suspicious_email"] };
  }

  if (!EMAIL_REGEX.test(email)) {
    return { email: null, flags: ["suspicious_email"] };
  }

  const [localPart, domain] = email.split("@");

  // Role address check
  if (ROLE_EMAIL_PREFIXES.has(localPart)) {
    flags.push("suspicious_email");
  }

  // Non-AU/NZ domain check
  if (NON_AU_TLDS.test(domain)) {
    flags.push("non_au_email");
  }

  return { email, flags };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. DEDUPLICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a dedup key for a contact.
 * Priority: email (most reliable) → name + canonical company.
 */
export function buildDedupKey(
  email: string | null,
  firstName: string | null,
  lastName: string | null,
  canonical: string | null
): string | null {
  if (email) return `email:${email.toLowerCase()}`;
  const name = [firstName, lastName].filter(Boolean).join(" ").toLowerCase().trim();
  const co = (canonical || "").toLowerCase().trim();
  if (name && co) return `name+co:${name}|${co}`;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. ROW CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify a staged contact using the five-value classification.
 *
 * rejected           — empty, duplicate (hard), unrecoverable, test, or DNC
 * company_target     — company-only row (no person name); goes to company branch only
 * review_needed      — has soft flags requiring human review
 * enrichable_contact — has name + company but no email
 * verified_contact   — has name + email + company, no blocking flags
 */
export function classifyRow(
  contact: Pick<StagedContact, "firstName" | "lastName" | "company" | "email" | "recordType" | "reviewFlags">
): { classification: RowClassification; rejectionReason: string | null } {
  const flags = contact.reviewFlags;

  // Hard rejections
  if (flags.includes("test_row")) {
    return { classification: "rejected", rejectionReason: "Test/dummy record detected" };
  }
  if (flags.includes("do_not_contact")) {
    return { classification: "rejected", rejectionReason: "Do-not-contact instruction in notes" };
  }
  if (flags.includes("duplicate_in_batch")) {
    return { classification: "rejected", rejectionReason: "Duplicate within this upload batch" };
  }
  if (flags.includes("placeholder_name") && flags.includes("placeholder_company")) {
    return { classification: "rejected", rejectionReason: "Both name and company are placeholders" };
  }
  if (flags.includes("placeholder_company") && !contact.email) {
    return { classification: "rejected", rejectionReason: "Placeholder company with no email" };
  }
  if (!contact.firstName && !contact.lastName && !contact.email && !contact.company) {
    return { classification: "rejected", rejectionReason: "Completely empty row" };
  }
  if (flags.includes("honorific_only") && !contact.company) {
    return { classification: "rejected", rejectionReason: "Honorific-only name with no company" };
  }

  // Company-only branch — no person name at all
  if (contact.recordType === "company_target") {
    return { classification: "company_target", rejectionReason: null };
  }

  // Soft review triggers (human must approve before enrichment)
  const reviewTriggers: ReviewFlag[] = [
    "no_name", "no_company", "suspicious_email", "placeholder_name",
    "placeholder_company", "duplicate_in_campaign",
    "title_too_long", "company_too_long", "name_looks_like_company",
    "honorific_only", "all_caps_name", "non_au_email",
    "retired_or_former", "joint_venture",
  ];
  if (flags.some(f => reviewTriggers.includes(f))) {
    return { classification: "review_needed", rejectionReason: null };
  }

  // Person rows: verified vs enrichable
  if (contact.email) {
    return { classification: "verified_contact", rejectionReason: null };
  }
  return { classification: "enrichable_contact", rejectionReason: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. HEADER ROW DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the most likely header row index in a sheet.
 * Scores each of the first 8 rows by how many cells match known header synonyms.
 */
export function detectHeaderRow(allRows: string[][]): number {
  const allPatterns = Object.values(HEADER_SYNONYMS).flat();
  let bestScore = 0;
  let bestIdx = 0;
  const maxCheck = Math.min(allRows.length, 8);

  for (let i = 0; i < maxCheck; i++) {
    const row = allRows[i];
    if (!row || row.length === 0) continue;
    const score = row.filter(cell => {
      const h = String(cell ?? "").trim();
      return h.length > 0 && allPatterns.some(p => p.test(h));
    }).length;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. MAIN PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the full ingestion pipeline on a file buffer.
 *
 * @param buffer - Raw file bytes (CSV or Excel)
 * @param options.sheetName - Sheet to parse (defaults to first sheet)
 * @param options.columnMapping - Override auto-detected mapping
 * @param options.existingEmails - Set of emails already in the target campaign (for dedup)
 * @param options.existingNameCoKeys - Set of name+company keys already in the campaign
 */
export function runIngestionPipeline(
  buffer: Buffer,
  options: {
    sheetName?: string;
    columnMapping?: Partial<IngestColumnMapping>;
    existingEmails?: Set<string>;
    existingNameCoKeys?: Set<string>;
  } = {}
): IngestionResult {
  const errors: string[] = [];

  // Parse file
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (err) {
    return {
      fileType: "unknown", totalRows: 0, verifiedContacts: 0,
      enrichableContacts: 0, companyTargets: 0,
      reviewRows: 0, rejectedRows: 0, staged: [],
      errors: [`Failed to parse file: ${(err as Error).message}`],
    };
  }

  const sheetName = options.sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return {
      fileType: "unknown", totalRows: 0, verifiedContacts: 0,
      enrichableContacts: 0, companyTargets: 0,
      reviewRows: 0, rejectedRows: 0, staged: [],
      errors: [`Sheet "${sheetName}" not found`],
    };
  }

  const allRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
  if (allRows.length === 0) {
    return {
      fileType: "unknown", totalRows: 0, verifiedContacts: 0,
      enrichableContacts: 0, companyTargets: 0,
      reviewRows: 0, rejectedRows: 0, staged: [],
      errors: ["File is empty"],
    };
  }

  const headerRowIdx = detectHeaderRow(allRows);
  const headers = allRows[headerRowIdx].map(h => String(h ?? "").trim());
  const dataRows = allRows.slice(headerRowIdx + 1).map(r => r.map(c => String(c ?? "").trim()));

  // Detect or use provided column mapping
  const { mapping: autoMapping } = detectColumnMapping(headers);
  const mapping: IngestColumnMapping = { ...autoMapping, ...options.columnMapping };

  // Detect upload type
  const fileType = detectUploadType(mapping, dataRows, headers);

  // Dedup sets
  const seenKeys = new Set<string>();
  const existingEmails = options.existingEmails ?? new Set<string>();
  const existingNameCoKeys = options.existingNameCoKeys ?? new Set<string>();

  const staged: StagedContact[] = [];
  let rejectedRows = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const sourceRow = headerRowIdx + 2 + i; // 1-indexed, accounting for header

    // Skip completely empty rows silently
    if (!row || row.every(c => !c.trim())) {
      rejectedRows++;
      continue;
    }

    try {
      const allFlags: ReviewFlag[] = [];

      // ── Name ──
      let firstName: string | null = null;
      let lastName: string | null = null;
      let fullNameRaw: string | null = null;

      if (mapping.firstName !== undefined || mapping.lastName !== undefined) {
        const rawFirst = cleanCell(row[mapping.firstName ?? -1]);
        const rawLast = cleanCell(row[mapping.lastName ?? -1]);
        const splitResult = normalizeSplitName(rawFirst, rawLast);
        firstName = splitResult.firstName;
        lastName = splitResult.lastName;
        allFlags.push(...splitResult.flags);
      } else if (mapping.fullName !== undefined) {
        fullNameRaw = cleanCell(row[mapping.fullName]);
        const parsed = parseFullName(fullNameRaw);
        firstName = parsed.firstName;
        lastName = parsed.lastName;
        allFlags.push(...parsed.flags);
      }

      if (!firstName && !lastName) allFlags.push("no_name");

      // ── Title ──
      const rawTitle = cleanCell(row[mapping.title ?? -1]);
      const { title, flags: titleFlags } = normalizeTitle(rawTitle);
      allFlags.push(...titleFlags);

      // ── Company ──
      const rawCompany = cleanCell(row[mapping.company ?? -1]);
      const { company, canonical, domain: companyDomain, jointVentureLabel, flags: companyFlags } = canonicalizeCompany(rawCompany);
      allFlags.push(...companyFlags);
      if (!company) allFlags.push("no_company");

      // ── Domain ──
      const rawDomain = cleanCell(row[mapping.domain ?? -1]);
      const domain = rawDomain ? extractDomain(rawDomain) : companyDomain;

      // ── Email ──
      const rawEmail = cleanCell(row[mapping.email ?? -1]);
      const { email, flags: emailFlags } = validateEmail(rawEmail);
      allFlags.push(...emailFlags);

      // ── Phone / Mobile / LinkedIn / Notes ──
      const phone = cleanCell(row[mapping.phone ?? -1]);
      const mobile = cleanCell(row[mapping.mobile ?? -1]);
      const linkedin = cleanCell(row[mapping.linkedin ?? -1]);
      const notes = cleanCell(row[mapping.notes ?? -1]);

      // ── Notes-based flags ──
      if (notes) {
        if (DO_NOT_CONTACT_PATTERN.test(notes)) {
          allFlags.push("do_not_contact");
        }
        if (RETIRED_FORMER_PATTERN.test(notes) && !allFlags.includes("retired_or_former")) {
          allFlags.push("retired_or_former");
        }
      }

      // ── Record type ──
      const recordType: RecordType = (!firstName && !lastName && !fullNameRaw)
        ? "company_target"
        : "person";

      // ── Deduplication ──
      let duplicateOf: string | null = null;
      const dedupKey = buildDedupKey(email, firstName, lastName, canonical);
      if (dedupKey) {
        if (seenKeys.has(dedupKey)) {
          allFlags.push("duplicate_in_batch");
          duplicateOf = dedupKey;
        } else {
          seenKeys.add(dedupKey);
          // Check against existing campaign contacts (soft warning, not hard reject)
          if (email && existingEmails.has(email.toLowerCase())) {
            allFlags.push("duplicate_in_campaign");
            duplicateOf = `campaign:${email.toLowerCase()}`;
          } else if (!email) {
            const nameCoKey = buildDedupKey(null, firstName, lastName, canonical);
            if (nameCoKey && existingNameCoKeys.has(nameCoKey)) {
              allFlags.push("duplicate_in_campaign");
              duplicateOf = `campaign:${nameCoKey}`;
            }
          }
        }
      }

      // ── Classification ──
      const { classification, rejectionReason } = classifyRow({
        firstName, lastName, company, email, recordType, reviewFlags: allFlags,
      });

      if (classification === "rejected") {
        rejectedRows++;
        // Still stage rejected rows so the UI can show them with their reason
        staged.push({
          recordType,
          firstName, lastName, fullNameRaw,
          title, titleRaw: rawTitle,
          company, companyRaw: rawCompany, companyCanonical: canonical,
          jointVentureLabel,
          domain, email, phone, mobile, linkedin, notes,
          classification,
          reviewFlags: allFlags,
          rejectionReason,
          duplicateOf,
          sourceRow,
          uploadFileType: fileType,
        });
        continue;
      }

      staged.push({
        recordType,
        firstName, lastName, fullNameRaw,
        title, titleRaw: rawTitle,
        company, companyRaw: rawCompany, companyCanonical: canonical,
        jointVentureLabel,
        domain, email, phone, mobile, linkedin, notes,
        classification,
        reviewFlags: allFlags,
        rejectionReason: null,
        duplicateOf,
        sourceRow,
        uploadFileType: fileType,
      });
    } catch (err) {
      errors.push(`Row ${sourceRow}: ${(err as Error).message}`);
      rejectedRows++;
    }
  }

  const verifiedContacts = staged.filter(r => r.classification === "verified_contact").length;
  const enrichableContacts = staged.filter(r => r.classification === "enrichable_contact").length;
  const companyTargets = staged.filter(r => r.classification === "company_target").length;
  const reviewRows = staged.filter(r => r.classification === "review_needed").length;

  return {
    fileType,
    totalRows: dataRows.length,
    verifiedContacts,
    enrichableContacts,
    companyTargets,
    reviewRows,
    rejectedRows,
    staged,
    errors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function cleanCell(val: any): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

function toTitleCase(word: string): string {
  if (!word) return word;
  // Preserve hyphenated names (e.g. "Smith-Jones")
  return word.split("-").map(part => {
    if (part.length === 0) return part;
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join("-");
}

/**
 * Convert a StagedContact to the RawContactRow format expected by
 * importCampaignContacts() in campaignService.ts.
 * Only "verified_contact" or "enrichable_contact" contacts should be passed here.
 * company_target rows must NOT be passed to this function.
 */
export function stagedToRawContact(staged: StagedContact): {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  company: string;
  reviewedCompanyName: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  nameCheckStatus: string | null;
  linkedin: string | null;
  reviewNotes: string | null;
  sourceRow: number;
} {
  if (staged.recordType === "company_target") {
    throw new Error(
      `stagedToRawContact called on company_target row (company: ${staged.company}). ` +
      `Company-only rows must go to the company enrichment branch, not person scoring.`
    );
  }
  return {
    firstName: staged.firstName,
    lastName: staged.lastName,
    title: staged.title,
    company: staged.companyCanonical || staged.company || "",
    reviewedCompanyName: staged.companyCanonical,
    phone: staged.phone,
    mobile: staged.mobile,
    email: staged.email,
    nameCheckStatus: null,
    linkedin: staged.linkedin,
    reviewNotes: staged.notes,
    sourceRow: staged.sourceRow,
  };
}
