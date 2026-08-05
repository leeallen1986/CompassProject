import {
  deriveEffectiveSlateTier,
  hasNonEmptyEmail,
  hasSendReadyEnrichmentSource,
  isEffectivelySendReady,
  type ContactTrustTier,
} from "./contactSlateTrustPolicy";

export const CONTACT_VALIDATION_ACTIONS = [
  "accept",
  "reject",
  "wrong_company",
  "wrong_role",
  "backup_only",
  "verify_email",
] as const;

export type ContactValidationAction = (typeof CONTACT_VALIDATION_ACTIONS)[number];

export interface ContactValidationState {
  contactTrustTier: ContactTrustTier | null;
  enrichmentSource: string | null;
  email: string | null;
  emailVerified: boolean | number | null;
  verificationStatus: string | null;
  verifiedByUserId: number | null;
  verifiedAt: Date | null;
  rejectionReason: string | null;
  rejectedByUserId: number | null;
  rejectedAt: Date | null;
}

export interface ContactValidationTransitionContext {
  userId: number;
  now: Date;
  note?: string | null;
}

export interface ContactValidationTransition {
  previousTier: ContactTrustTier;
  newTier: ContactTrustTier;
  update: {
    contactTrustTier: ContactTrustTier;
    enrichmentSource?: "manual";
    emailVerified?: boolean;
    verificationStatus?: "verified" | "unverified";
    verifiedByUserId?: number | null;
    verifiedAt?: Date | null;
    rejectionReason?: string | null;
    rejectedByUserId?: number | null;
    rejectedAt?: Date | null;
  };
  promoted: boolean;
  identityAccepted: boolean;
  emailVerifiedByAction: boolean;
}

export class ContactValidationTransitionError extends Error {
  constructor(
    public readonly code:
      | "email_required"
      | "identity_acceptance_required"
      | "rejected_contact_requires_acceptance",
    message: string,
  ) {
    super(message);
    this.name = "ContactValidationTransitionError";
  }
}

/**
 * Produce the complete contact-state transition for a human validation action.
 * Identity acceptance and mailbox verification are intentionally separate.
 */
export function deriveContactValidationTransition(
  action: ContactValidationAction,
  state: ContactValidationState,
  context: ContactValidationTransitionContext,
): ContactValidationTransition {
  const previousTier = state.contactTrustTier || "named_unverified";
  const wasEffectivelySendReady = isEffectivelySendReady(state);
  // A human validation action can replace unknown/LLM-only provenance with a
  // manual source, but must not erase an existing independent source.
  const manualSourceUpdate = hasSendReadyEnrichmentSource(state.enrichmentSource)
    ? {}
    : { enrichmentSource: "manual" as const };
  const base: ContactValidationTransition = {
    previousTier,
    newTier: previousTier,
    update: { contactTrustTier: previousTier },
    promoted: false,
    identityAccepted: false,
    emailVerifiedByAction: false,
  };

  switch (action) {
    case "accept": {
      // Accept confirms the person/company identity. It never asserts that the
      // mailbox is valid. An already effective send-ready contact remains so;
      // every other accepted identity becomes named_unverified.
      const newTier: ContactTrustTier = wasEffectivelySendReady
        ? "send_ready"
        : "named_unverified";
      return {
        ...base,
        newTier,
        update: {
          contactTrustTier: newTier,
          ...manualSourceUpdate,
          rejectionReason: null,
          rejectedByUserId: null,
          rejectedAt: null,
        },
        promoted: newTier === "send_ready" && previousTier !== "send_ready",
        identityAccepted: true,
      };
    }

    case "verify_email": {
      if (!hasNonEmptyEmail(state.email)) {
        throw new ContactValidationTransitionError(
          "email_required",
          "A non-empty current email is required before verification.",
        );
      }
      if (previousTier === "llm_inferred") {
        throw new ContactValidationTransitionError(
          "identity_acceptance_required",
          "Accept the inferred identity before verifying its mailbox.",
        );
      }
      if (state.rejectionReason != null) {
        throw new ContactValidationTransitionError(
          "rejected_contact_requires_acceptance",
          "Accept the identity and clear the rejection before verifying its mailbox.",
        );
      }

      return {
        ...base,
        newTier: "send_ready",
        update: {
          contactTrustTier: "send_ready",
          ...manualSourceUpdate,
          emailVerified: true,
          verificationStatus: "verified",
          verifiedByUserId: context.userId,
          verifiedAt: context.now,
        },
        promoted: previousTier !== "send_ready" || !wasEffectivelySendReady,
        emailVerifiedByAction: true,
      };
    }

    case "reject":
    case "wrong_company": {
      const reason = action === "wrong_company"
        ? "wrong_company"
        : context.note?.trim() || "rejected_by_rep";
      return {
        ...base,
        newTier: "named_unverified",
        update: {
          contactTrustTier: "named_unverified",
          emailVerified: false,
          verificationStatus: "unverified",
          verifiedByUserId: null,
          verifiedAt: null,
          rejectionReason: reason,
          rejectedByUserId: context.userId,
          rejectedAt: context.now,
        },
      };
    }

    case "wrong_role":
    case "backup_only": {
      // These are project-position signals, not mailbox verdicts. Preserve an
      // independently verified send-ready state; otherwise keep the contact in
      // the review-first tier. Never promote as a consequence of the action.
      const newTier = deriveEffectiveSlateTier(state) === "send_ready"
        ? "send_ready"
        : "named_unverified";
      return {
        ...base,
        newTier,
        update: { contactTrustTier: newTier },
      };
    }
  }
}
