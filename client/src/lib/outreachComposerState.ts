export const AI_DRAFTING_UNAVAILABLE_MESSAGE =
  "AI drafting is temporarily unavailable. Use a saved template or write manually.";

export const AI_DRAFT_FAILURE_MESSAGE =
  "An AI draft could not be created. Use a saved template or write the email manually.";

export type OutreachDraftState =
  | "idle"
  | "loading"
  | "ai_ready"
  | "deterministic_fallback"
  | "manual_template"
  | "error";

/**
 * These states mean another AI attempt is known to be unsafe or wasteful.
 * Saved templates and manual editing remain available while AI controls are
 * disabled.
 */
export function isQuotaOrCircuitUnavailable(
  reason: string | null | undefined
): boolean {
  return (
    reason === "quota_exhausted" ||
    reason === "rate_limited" ||
    reason === "circuit_open"
  );
}

/** Recipient handoff actions require meaningful subject and body content. */
export function isCompleteOutreachDraft(
  subject: string,
  body: string
): boolean {
  return subject.trim().length > 0 && body.trim().length > 0;
}

export function planOutreachComposerOpen(
  hasValidIds: boolean,
  existingUnavailableReason: string | null | undefined,
): {
  draftState: "idle" | "loading" | "error";
  shouldRequestAi: boolean;
  knownQuotaBlock: boolean;
} {
  if (!hasValidIds) {
    return {
      draftState: "idle",
      shouldRequestAi: false,
      knownQuotaBlock: false,
    };
  }

  const knownQuotaBlock = isQuotaOrCircuitUnavailable(
    existingUnavailableReason,
  );
  return knownQuotaBlock
    ? { draftState: "error", shouldRequestAi: false, knownQuotaBlock: true }
    : { draftState: "loading", shouldRequestAi: true, knownQuotaBlock: false };
}

/** Both the operation epoch and contact/project context must still be current. */
export function isCurrentOutreachOperation(
  currentEpoch: number,
  requestEpoch: number,
  activeContext: string | null,
  requestContext: string,
): boolean {
  return currentEpoch === requestEpoch && activeContext === requestContext;
}
