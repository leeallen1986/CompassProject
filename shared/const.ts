export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

// ── Pipeline Attribution: Product Family Vocabulary ─────────────────────────
/** Canonical product family keys used across pipelineClaims, FP accounts, and UI. */
export const PRODUCT_FAMILIES = [
  "portable_air",
  "dewatering",
  "generators",
  "bess",
  "nitrogen",
  "lighting",
  "other",
] as const;
export type ProductFamily = typeof PRODUCT_FAMILIES[number];

// ── Pipeline Attribution: Status Groups ──────────────────────────────────────
/** Statuses that represent an open (in-progress) pipeline opportunity. */
export const OPEN_PIPELINE_STATUSES = [
  "identified",
  "contacted",
  "meeting_booked",
  "qualified",
  "quoted",
] as const;

/** Statuses that represent a closed (terminal) pipeline opportunity. */
export const CLOSED_PIPELINE_STATUSES = [
  "won",
  "lost",
  "deferred",
  "not_relevant",
] as const;

export type PipelineStatus = typeof OPEN_PIPELINE_STATUSES[number] | typeof CLOSED_PIPELINE_STATUSES[number];

// ── Internal Sales Guard ─────────────────────────────────────────────────────
export const NOT_INTERNAL_SALES_ERR_MSG = 'Full Potential pipeline access requires internal sales access (10003)';
