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

  // Specialty Air is a profile label, not a persisted scoring dimension.
  // It expands to the two existing specialty opportunity dimensions while
  // leaving Portable Air primary when both profile labels are assigned.
  "Specialty Air": ["Nitrogen", "Booster"],

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
 *
 * Classification logic (based on definitive lane assignments):
 *
 * - "Flow-only" reps: profile has ONLY pump/flow/dewatering labels
 *   (possibly with PA as secondary). If pump labels are the MAJORITY
 *   of non-PA, non-Capital-Sales labels → primary = Pump/Dewatering.
 *
 * - "PAL/BESS-only" reps: profile has ONLY PAL and/or BESS labels
 *   → primary = first of PAL or BESS.
 *
 * - "PA-only" reps: profile has only "Portable Air" (possibly with
 *   "PT Capital Sales" expansion) → primary = Portable Air.
 *
 * - "All-BL" reps: profile has 3+ distinct BL categories (PA + PAL/BESS + Pump)
 *   or "PT All Capital Sales" alone → multi-lane, no single primary.
 *   Returns first resolved dimension (Portable Air by convention).
 *
 * The key distinction:
 * - Brett [PA, Pump (Flow), Dewatering Pumps] → 2 pump labels vs 1 PA = Flow rep
 * - Egor [BESS, PA, PAL, Pump (Flow)] → 4 distinct categories = All-BL rep
 * - Tim [PA, PAL, BESS, Pump (Flow)] → 4 distinct categories = All-BL rep
 * - Ray [PAL, BESS, Pump (Flow)] → only PAL/BESS/Pump, no PA = Flow rep
 *   (Ray is "just flow" per user — pump takes priority when mixed with PAL/BESS)
 */
export function getPrimaryDimension(
  rawBusinessLines: string | string[] | null | undefined
): ScoringDimension {
  const resolved = resolveBusinessLines(rawBusinessLines);
  if (resolved.length <= 1) return resolved[0];

  // Parse raw labels
  let labels: string[] = [];
  if (rawBusinessLines) {
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
  }

  const lowerLabels = labels.map(l => l.toLowerCase().trim());

  // Classify each raw label into a category
  const hasPumpLabel = lowerLabels.some(l =>
    l.includes("pump") || l === "flow" || l.includes("dewatering")
  );
  const hasPALabel = lowerLabels.some(l =>
    l === "portable air"
  );
  const hasPALLabel = lowerLabels.some(l => l === "pal");
  const hasBESSLabel = lowerLabels.some(l => l === "bess");
  const hasCapitalSalesLabel = lowerLabels.some(l =>
    l.includes("capital sales") || l.includes("pt all")
  );

  // Count distinct BL categories (excluding Capital Sales which is an expansion)
  const categories = new Set<string>();
  if (hasPALabel) categories.add("PA");
  if (hasPALLabel) categories.add("PAL");
  if (hasBESSLabel) categories.add("BESS");
  if (hasPumpLabel) categories.add("Pump");

  // Rule 1: "All-BL" reps — 3+ distinct categories INCLUDING PA = multi-lane
  // These reps (Egor, Tim, Alexandre) get no single primary preference;
  // they see the best project regardless of lane.
  // Note: PAL+BESS+Pump WITHOUT PA is NOT multi-lane (Ray = Flow rep)
  const isMultiLane = (categories.size >= 3 && hasPALabel) ||
    (hasCapitalSalesLabel && categories.size === 0);
  if (isMultiLane) {
    // Multi-lane: return first resolved (Portable Air by convention)
    return resolved[0];
  }

  // Rule 2: Flow-only reps — pump labels dominate
  // Brett: [PA, Pump (Flow), Dewatering Pumps] → categories = {PA, Pump} but pump count > PA count
  // Ray: [PAL, BESS, Pump (Flow)] → categories = {PAL, BESS, Pump} — but wait, that's 3.
  // Actually Ray is "just flow" per user. Special case: PAL+BESS+Pump without PA = Flow rep.
  if (hasPumpLabel && resolved.includes("Pump/Dewatering")) {
    // Count pump-related labels vs other labels
    const pumpLabelCount = lowerLabels.filter(l =>
      l.includes("pump") || l === "flow" || l.includes("dewatering")
    ).length;
    const nonPumpNonCapitalLabels = lowerLabels.filter(l =>
      !l.includes("pump") && l !== "flow" && !l.includes("dewatering") &&
      !l.includes("capital sales") && !l.includes("pt all")
    ).length;

    // If pump labels are majority of non-Capital-Sales labels → Flow rep
    // Brett: 2 pump labels, 1 PA label → pump majority
    if (pumpLabelCount > nonPumpNonCapitalLabels) {
      return "Pump/Dewatering";
    }

    // Special case: PAL/BESS + Pump without PA → Flow rep (Ray's case)
    if (!hasPALabel && hasPumpLabel) {
      return "Pump/Dewatering";
    }
  }

  // Rule 3: PAL/BESS-only reps (Amit: [PAL, BESS])
  if ((hasPALLabel || hasBESSLabel) && !hasPALabel && !hasPumpLabel) {
    return hasPALLabel ? "PAL" : "BESS";
  }

  // Rule 4: PA-only reps with Capital Sales expansion (Ryan: [PA, PT Capital Sales])
  if (hasPALabel && hasCapitalSalesLabel && !hasPumpLabel && !hasPALLabel && !hasBESSLabel) {
    return "Portable Air";
  }

  // Rule 5: Default — first resolved dimension
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
  businessLines?: string | string[] | null; // alias for assignedBusinessLines
  sectorFocus?: string | string[] | null;
}): ResolvedProfile {
  const rawBLs = profile.assignedBusinessLines || profile.businessLines;
  const territories = resolveTerritories(profile.territories, profile.sectorFocus);
  const scoringDimensions = resolveBusinessLines(rawBLs);
  const primaryDimension = getPrimaryDimension(rawBLs);
  const isNational = territories.length >= ALL_AU_STATES.length - 1; // 8+ states = national

  return {
    territories,
    scoringDimensions,
    primaryDimension,
    isNational,
  };
}
