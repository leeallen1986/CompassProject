/**
 * nameUtils.ts — Contact name cleaning utilities for Apollo enrichment.
 *
 * Apollo's people-enrich endpoint requires clean first + last names.
 * LinkedIn profiles often contain credentials, parenthetical nicknames,
 * emoji, and other noise that must be stripped before sending to Apollo.
 */

/**
 * Clean a raw contact name for use with the Apollo people-enrich API.
 *
 * Rules applied in order:
 * 1. Reject names that start with emoji or non-letter characters.
 * 2. Strip everything after the first comma (credentials like "Calo, MBA, SPHR").
 * 3. Strip parenthetical content (nicknames like "Kenawy (Mo)").
 * 4. If the name has more than 2 tokens and all tokens beyond index 1 look like
 *    credential abbreviations (short, starts with capital), keep only first 2 tokens.
 *
 * Returns the cleaned name string, or null if the name is unrecoverable.
 */
export function cleanContactName(rawName: string): string | null {
  if (!rawName || !rawName.trim()) return null;

  // Reject names that start with emoji or non-letter characters
  // (e.g. "🪷 Successful on Paper. Depleted in Life | ...")
  if (/^[^a-zA-Z\u00C0-\u024F]/.test(rawName.trim())) return null;

  // Strip everything after a comma (credentials like "Calo, MBA, SPHR, SHRM-SCP")
  let cleaned = rawName.split(",")[0].trim();

  // Strip parenthetical content (nicknames like "Kenawy (Mo)" or "Smith (née Jones)")
  cleaned = cleaned.replace(/\s*\([^)]*\)/g, "").trim();

  // Strip known post-nominal credential tokens after the last name
  // e.g. "Arash Dalir FIEAust CPEng RPEV" → "Arash Dalir"
  // Heuristic: if tokens beyond index 1 are all short (≤8 chars) and start with a capital,
  // treat them as credentials and drop them.
  const tokens = cleaned.split(/\s+/);
  if (tokens.length > 2) {
    const credentialPattern = /^[A-Z][A-Za-z]*$/;
    const extraTokensAreCredentials = tokens.slice(2).every(
      (t) => credentialPattern.test(t) && t.length <= 8
    );
    if (extraTokensAreCredentials) {
      cleaned = tokens.slice(0, 2).join(" ");
    }
  }

  return cleaned.trim() || null;
}

/**
 * Parse a cleaned contact name into first and last name parts.
 * Returns { firstName, lastName } where lastName may be empty string.
 */
export function parseContactName(cleanedName: string): {
  firstName: string;
  lastName: string;
} {
  const parts = cleanedName.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

/**
 * Returns true if the name is valid for Apollo enrichment after cleaning.
 * Apollo requires at minimum a non-trivial first name.
 */
export function isEnrichableName(rawName: string): boolean {
  const cleaned = cleanContactName(rawName);
  if (!cleaned) return false;
  const { firstName, lastName } = parseContactName(cleaned);
  if (firstName.length <= 1) return false;
  // Last name may be empty (single-name contacts), but if present must be alpha
  if (lastName.length > 0 && !/^[a-zA-Z\-'\u00C0-\u024F\s]+$/.test(lastName)) return false;
  return true;
}
