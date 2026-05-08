/**
 * Canonical Territory & Business-Line Normalization
 * ==================================================
 * Single source of truth for resolving user profile labels
 * to the actual values used in project filtering and scoring.
 *
 * Used by: dashboard, digest, detail page, QA scripts, mlRanker
 */

// ============================================================
// PART A — TERRITORY NORMALIZATION
// ============================================================

/**
 * All valid Australian state/territory codes used in projects.projectState
 */
export const ALL_AU_STATES = [
  "WA", "NSW", "QLD", "VIC", "SA", "TAS", "NT", "ACT", "OFFSHORE_AU"
] as const;

export type AUState = (typeof ALL_AU_STATES)[number];

/**
 * Territory labels that represent "all of Australia"
 */
const NATIONAL_ALIASES = new Set([
  "NATIONAL",
  "national",
  "National",
  "ALL",
  "all",
  "All states",
  "ALL states",
]);

/**
 * Resolve a user profile's territory value to a concrete set of projectState codes.
 *
 * Input formats supported:
 * - "NATIONAL" → all states
 * - "WA,NT" → ["WA", "NT"]
 * - ["WA", "NT"] → ["WA", "NT"]
 * - "WA,NSW,QLD,VIC,SA,TAS,NT,ACT" → all states (with OFFSHORE_AU added)
 *
 * Rules:
 * 1. NATIONAL → all states including OFFSHORE_AU
 * 2. If profile has ≥7 distinct states → treat as national, add OFFSHORE_AU
 * 3. Otherwise → return the listed states as-is
 * 4. Offshore-relevant reps (O&G sector focus) get OFFSHORE_AU added
 */
export function resolveTerritories(
  rawTerritories: string | string[] | null | undefined,
  sectorFocus?: string | string[] | null
): AUState[] {
  if (!rawTerritories) return [...ALL_AU_STATES]; // no profile = national

  // Normalize to array
  let territories: string[];
  if (typeof rawTerritories === "string") {
    // Could be "NATIONAL" or "WA,NT" or JSON string
    if (NATIONAL_ALIASES.has(rawTerritories.trim())) {
      return [...ALL_AU_STATES];
    }
    try {
      const parsed = JSON.parse(rawTerritories);
      territories = Array.isArray(parsed) ? parsed : [rawTerritories];
    } catch {
      territories = rawTerritories.split(",").map(t => t.trim());
    }
  } else {
    territories = rawTerritories;
  }

  // Check if any element is a national alias
  if (territories.some(t => NATIONAL_ALIASES.has(t.trim()))) {
    return [...ALL_AU_STATES];
  }

  // Normalize case
  const normalized = territories.map(t => t.trim().toUpperCase()) as AUState[];

  // If profile has ≥7 states, treat as effectively national
  if (normalized.length >= 7) {
    // Add OFFSHORE_AU if not already present
    if (!normalized.includes("OFFSHORE_AU")) {
      normalized.push("OFFSHORE_AU");
    }
    return normalized;
  }

  // Add OFFSHORE_AU for O&G-focused reps
  const sectors = normalizeSectorFocus(sectorFocus);
  if (sectors.includes("oil_gas") && !normalized.includes("OFFSHORE_AU")) {
    normalized.push("OFFSHORE_AU");
  }

  return normalized;
}

function normalizeSectorFocus(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : raw.split(",").map(s => s.trim());
    } catch {
      return raw.split(",").map(s => s.trim());
    }
  }
  return raw;
}

// ============================================================
// PART B — BUSINESS-LINE NORMALIZATION
// ============================================================

/**
 * All scoring dimensions available in projectBusinessLineScores.scoringDimension
 */
export const ALL_SCORING_DIMENSIONS = [
  "Portable Air",
  "PAL",
  "BESS",
  "Pump/Dewatering",
  "Generators",
  "Nitrogen",
  "Booster",
  "Service Potential",
  "Rental Influence",
] as const;

export type ScoringDimension = (typeof ALL_SCORING_DIMENSIONS)[number];

/**
 * Canonical mapping from user profile business-line labels
 * to actual scoring dimensions in projectBusinessLineScores.
 *
 * Each profile label maps to one or more scoring dimensions.
 * The first dimension in the array is the "primary" for ranking.
 */
const BL_TO_DIMENSIONS: Record<string, ScoringDimension[]> = {
  // Direct matches
  "Portable Air": ["Portable Air"],
  "PAL": ["PAL"],
  "BESS": ["BESS"],
  "Generators": ["Generators"],
  "Nitrogen": ["Nitrogen"],
  "Booster": ["Booster"],

  // Pump / Flow / Dewatering variants → all map to "Pump/Dewatering"
  "Pump (Flow)": ["Pump/Dewatering"],
  "Pump/Flow": ["Pump/Dewatering"],
  "Pump": ["Pump/Dewatering"],
  "Flow": ["Pump/Dewatering"],
  "Dewatering": ["Pump/Dewatering"],
  "Dewatering Pumps": ["Pump/Dewatering"],
  "Pump/Dewatering": ["Pump/Dewatering"],

  // Capital Sales variants → all primary dimensions (excluding Service/Rental)
  "PT Capital Sales": ["Portable Air", "PAL", "BESS", "Pump/Dewatering", "Generators", "Nitrogen", "Booster"],
  "PT All Capital Sales": ["Portable Air", "PAL", "BESS", "Pump/Dewatering", "Generators", "Nitrogen", "Booster"],
  "Capital Sales": ["Portable Air", "PAL", "BESS", "Pump/Dewatering", "Generators", "Nitrogen", "Booster"],
  "All Capital Sales": ["Portable Air", "PAL", "BESS", "Pump/Dewatering", "Generators", "Nitrogen", "Booster"],

  // Service / Rental (informational only)
  "Service Potential": ["Service Potential"],
  "Rental Influence": ["Rental Influence"],
};

/**
 * Resolve a user profile's assigned business lines to concrete scoring dimensions.
 *
 * Input formats:
 * - "Portable Air,Pump (Flow)" → ["Portable Air", "Pump/Dewatering"]
 * - ["PAL", "BESS"] → ["PAL", "BESS"]
 * - "PT All Capital Sales" → all 7 capital dimensions
 *
 * Returns deduplicated list of scoring dimensions.
 */
export function resolveBusinessLines(
  rawBusinessLines: string | string[] | null | undefined
): ScoringDimension[] {
  if (!rawBusinessLines) return ["Portable Air"]; // default fallback

  // Normalize to array
  let labels: string[];
  if (typeof rawBusinessLines === "string") {
    try {
      const parsed = JSON.parse(rawBusinessLines);
      labels = Array.isArray(parsed) ? parsed : rawBusinessLines.split(",").map(s => s.trim());
    } catch {
      labels = rawBusinessLines.split(",").map(s => s.trim());
    }
  } else {
    labels = rawBusinessLines;
  }

  const dimensions = new Set<ScoringDimension>();

  for (const label of labels) {
    const trimmed = label.trim();
    const mapped = BL_TO_DIMENSIONS[trimmed];
    if (mapped) {
      for (const dim of mapped) {
        dimensions.add(dim);
      }
    } else {
      // Fuzzy fallback: case-insensitive match
      const lowerLabel = trimmed.toLowerCase();
      for (const [key, dims] of Object.entries(BL_TO_DIMENSIONS)) {
        if (key.toLowerCase() === lowerLabel) {
          for (const dim of dims) {
            dimensions.add(dim);
          }
          break;
        }
      }
      // If still no match, check if it's a direct dimension name
      const directMatch = ALL_SCORING_DIMENSIONS.find(
        d => d.toLowerCase() === lowerLabel
      );
      if (directMatch) {
        dimensions.add(directMatch);
      }
    }
  }

  // If nothing resolved, default to Portable Air
  if (dimensions.size === 0) {
    dimensions.add("Portable Air");
  }

  return Array.from(dimensions);
}

/**
 * Get the primary scoring dimension for a user profile.
 * Used for single-dimension ranking (e.g., "sort by PA score").
 */
export function getPrimaryDimension(
  rawBusinessLines: string | string[] | null | undefined
): ScoringDimension {
  const resolved = resolveBusinessLines(rawBusinessLines);
  return resolved[0];
}

// ============================================================
// COMBINED RESOLVER
// ============================================================

export interface ResolvedProfile {
  territories: AUState[];
  scoringDimensions: ScoringDimension[];
  primaryDimension: ScoringDimension;
  isNational: boolean;
}

/**
 * Full profile resolution: territory + business lines → concrete filter values.
 * This is the single entry point all consumers should use.
 */
export function resolveUserProfile(profile: {
  territories?: string | string[] | null;
  assignedBusinessLines?: string | string[] | null;
  sectorFocus?: string | string[] | null;
}): ResolvedProfile {
  const territories = resolveTerritories(profile.territories, profile.sectorFocus);
  const scoringDimensions = resolveBusinessLines(profile.assignedBusinessLines);
  const primaryDimension = scoringDimensions[0];
  const isNational = territories.length >= ALL_AU_STATES.length - 1; // 8+ states = national

  return {
    territories,
    scoringDimensions,
    primaryDimension,
    isNational,
  };
}
