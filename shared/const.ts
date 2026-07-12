export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = "Please login (10001)";
export const NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// ── Pipeline Attribution: Product Family Vocabulary ─────────────────────────
/**
 * Broad product families retained for legacy/project-sourced records and
 * platform-wide collateral matching.
 */
export const PRODUCT_FAMILIES = [
  "portable_air",
  "portable_air_small_medium",
  "portable_air_large",
  "specialty_air_boosters",
  "e_air",
  "dryers",
  "dewatering",
  "generators",
  "bess",
  "nitrogen",
  "lighting",
  "other",
] as const;
export type ProductFamily = typeof PRODUCT_FAMILIES[number];

/**
 * Full Potential opportunity families. Portable air is intentionally split by
 * commercial route so a claim cannot hide the CEA/direct distinction.
 */
export const FP_PRODUCT_FAMILIES = [
  "portable_air_small_medium",
  "portable_air_large",
  "specialty_air_boosters",
  "e_air",
  "dryers",
  "nitrogen",
  "dewatering",
  "generators",
  "bess",
  "lighting",
  "other",
] as const;
export type FpProductFamily = typeof FP_PRODUCT_FAMILIES[number];

// ── Pipeline Attribution: Status Groups ──────────────────────────────────────
export const ACTIVE_PIPELINE_STATUSES = [
  "identified",
  "contacted",
  "meeting_booked",
  "qualified",
  "quoted",
] as const;

export const TERMINAL_PIPELINE_STATUSES = [
  "won",
  "lost",
  "not_relevant",
] as const;

/**
 * Deferred is inactive for funnel reporting but remains the same opportunity
 * cycle and therefore continues to block a duplicate open claim.
 */
export const DEDUPE_BLOCKING_PIPELINE_STATUSES = [
  ...ACTIVE_PIPELINE_STATUSES,
  "deferred",
] as const;

export const PIPELINE_STATUSES = [
  ...ACTIVE_PIPELINE_STATUSES,
  "won",
  "lost",
  "deferred",
  "not_relevant",
] as const;

export type PipelineStatus = typeof PIPELINE_STATUSES[number];

// ── Internal Sales Guard ─────────────────────────────────────────────────────
export const NOT_INTERNAL_SALES_ERR_MSG =
  "Full Potential pipeline access requires internal sales access (10003)";
