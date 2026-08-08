import {
  hasNonEmptyEmail,
  hasSendReadyEnrichmentSource,
  isExplicitlyNotCrmOrphan,
  normaliseBoolean,
  type ContactTrustTier,
} from "./contactSlateTrustPolicy";

/**
 * Canonical evidence required before any normal application path may persist
 * contactTrustTier = "send_ready".
 *
 * This is intentionally stricter than the read-time effective-tier check:
 * persisted promotion also requires an explicit non-orphan state and at least
 * one exact contactProjects link. Missing/unknown values fail closed.
 */
export interface PersistedSendReadyCandidate {
  enrichmentSource: string | null | undefined;
  email: string | null | undefined;
  emailVerified: boolean | number | null | undefined;
  verificationStatus: string | null | undefined;
  rejectionReason: string | null | undefined;
  crmOrphan: boolean | number | null | undefined;
  hasProjectLink: boolean;
}

export function canPersistSendReady(
  candidate: PersistedSendReadyCandidate,
): boolean {
  return (
    hasSendReadyEnrichmentSource(candidate.enrichmentSource) &&
    hasNonEmptyEmail(candidate.email) &&
    normaliseBoolean(candidate.emailVerified) &&
    candidate.verificationStatus === "verified" &&
    candidate.rejectionReason == null &&
    isExplicitlyNotCrmOrphan(candidate.crmOrphan) &&
    candidate.hasProjectLink === true
  );
}

/**
 * Fail closed while preserving the stronger identity quarantine for
 * llm_inferred contacts. All other unsupported promotions resolve to
 * named_unverified.
 */
export function resolvePersistedContactTrustTier(
  candidate: PersistedSendReadyCandidate,
  currentTier?: ContactTrustTier | null,
): ContactTrustTier {
  if (canPersistSendReady(candidate)) return "send_ready";
  return currentTier === "llm_inferred" ? "llm_inferred" : "named_unverified";
}
