import { describe, expect, it } from "vitest";
import {
  ContactValidationTransitionError,
  deriveContactValidationTransition,
  type ContactValidationState,
} from "./contactValidationState";

const now = new Date("2026-07-25T01:00:00Z");
function state(overrides: Partial<ContactValidationState> = {}): ContactValidationState {
  return {
    contactTrustTier: "named_unverified",
    enrichmentSource: "manual",
    email: "person@example.com",
    emailVerified: false,
    verificationStatus: "unverified",
    verifiedByUserId: null,
    verifiedAt: null,
    rejectionReason: null,
    rejectedByUserId: null,
    rejectedAt: null,
    ...overrides,
  };
}

const context = { userId: 42, now, note: null };

describe("contact validation action state matrix", () => {
  it("accept confirms identity without verifying or promoting an unverified mailbox", () => {
    const result = deriveContactValidationTransition("accept", state(), context);
    expect(result.newTier).toBe("named_unverified");
    expect(result.identityAccepted).toBe(true);
    expect(result.emailVerifiedByAction).toBe(false);
    expect(result.update).not.toHaveProperty("emailVerified");
    expect(result.update).not.toHaveProperty("verifiedByUserId");
  });

  it("accept moves an inferred identity to named_unverified", () => {
    const result = deriveContactValidationTransition(
      "accept",
      state({ contactTrustTier: "llm_inferred", enrichmentSource: "llm" }),
      context,
    );
    expect(result.newTier).toBe("named_unverified");
    expect(result.update.enrichmentSource).toBe("manual");
  });

  it("accept preserves an independently effective send-ready contact", () => {
    const result = deriveContactValidationTransition(
      "accept",
      state({
        contactTrustTier: "send_ready",
        emailVerified: true,
        verificationStatus: "verified",
      }),
      context,
    );
    expect(result.newTier).toBe("send_ready");
  });

  it("does not preserve a raw send-ready label backed only by LLM provenance", () => {
    const result = deriveContactValidationTransition(
      "accept",
      state({
        contactTrustTier: "send_ready",
        enrichmentSource: "llm",
        emailVerified: true,
        verificationStatus: "verified",
      }),
      context,
    );
    expect(result.newTier).toBe("named_unverified");
    expect(result.update.enrichmentSource).toBe("manual");
  });

  it("verify_email requires a current email and accepted non-LLM identity", () => {
    expect(() => deriveContactValidationTransition(
      "verify_email",
      state({ email: null }),
      context,
    )).toThrowError(ContactValidationTransitionError);
    expect(() => deriveContactValidationTransition(
      "verify_email",
      state({ contactTrustTier: "llm_inferred" }),
      context,
    )).toThrowError(/Accept the inferred identity/);
  });

  it("verify_email creates the complete verified send-ready state", () => {
    const result = deriveContactValidationTransition("verify_email", state(), context);
    expect(result.newTier).toBe("send_ready");
    expect(result.update).toMatchObject({
      contactTrustTier: "send_ready",
      emailVerified: true,
      verificationStatus: "verified",
      verifiedByUserId: 42,
      verifiedAt: now,
    });
  });

  it("records manual provenance when a human verifies a legacy LLM-sourced row", () => {
    const result = deriveContactValidationTransition(
      "verify_email",
      state({ enrichmentSource: "llm" }),
      context,
    );
    expect(result.newTier).toBe("send_ready");
    expect(result.update.enrichmentSource).toBe("manual");
  });

  it("reject and wrong_company clear verification and cannot remain send-ready", () => {
    for (const action of ["reject", "wrong_company"] as const) {
      const result = deriveContactValidationTransition(
        action,
        state({
          contactTrustTier: "send_ready",
          emailVerified: true,
          verificationStatus: "verified",
        }),
        { ...context, note: "left company" },
      );
      expect(result.newTier).toBe("named_unverified");
      expect(result.update.emailVerified).toBe(false);
      expect(result.update.verificationStatus).toBe("unverified");
      expect(result.update.verifiedByUserId).toBeNull();
      expect(result.update.rejectionReason).toBeTruthy();
    }
  });

  it("wrong_role and backup_only never promote but preserve real mailbox verification", () => {
    for (const action of ["wrong_role", "backup_only"] as const) {
      expect(deriveContactValidationTransition(action, state(), context).newTier)
        .toBe("named_unverified");
      expect(deriveContactValidationTransition(
        action,
        state({
          contactTrustTier: "send_ready",
          emailVerified: true,
          verificationStatus: "verified",
        }),
        context,
      ).newTier).toBe("send_ready");
    }
  });
});
