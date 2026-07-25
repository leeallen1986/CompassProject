import { describe, expect, it } from "vitest";
import {
  deriveEffectiveSlateTier,
  evaluateSlateEligibility,
  isEffectivelySendReady,
  rankSlateContacts,
  sanitiseSlateForResponse,
  validateStoredCandidateSlate,
  type SlatePolicyContact,
  type StoredCandidateSlate,
} from "./contactSlateTrustPolicy";

function contact(overrides: Partial<SlatePolicyContact> = {}): SlatePolicyContact {
  return {
    id: 1,
    name: "Jane Smith",
    title: "Project Manager",
    company: "Example Co",
    email: "jane@example.com",
    linkedin: null,
    enrichmentSource: "apollo",
    contactTrustTier: "named_unverified",
    confidenceScore: "medium",
    roleRelevance: "medium",
    emailVerified: false,
    verificationStatus: "unverified",
    rejectionReason: null,
    crmOrphan: false,
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    contactId: 1,
    name: "Jane Smith",
    title: "Project Manager",
    company: "Example Co",
    email: "jane@example.com",
    linkedin: null,
    enrichmentSource: "apollo",
    contactTrustTier: "named_unverified" as const,
    confidenceScore: "medium",
    roleRelevance: "medium",
    roleLane: "primary" as const,
    ...overrides,
  };
}

function slate(overrides: Partial<StoredCandidateSlate> = {}): StoredCandidateSlate {
  return {
    id: 11,
    projectId: 101,
    primaryContactId: 1,
    backup1ContactId: null,
    backup2ContactId: null,
    commercialContactId: null,
    technicalContactId: null,
    primarySnapshot: snapshot(),
    backup1Snapshot: null,
    backup2Snapshot: null,
    commercialSnapshot: null,
    technicalSnapshot: null,
    totalSlotsFilled: 1,
    sendReadySlots: 0,
    namedUnverifiedSlots: 1,
    llmSlots: 0,
    sourcesUsed: ["apollo"],
    generatedAt: new Date("2026-07-25T00:00:00Z"),
    isStale: false,
    staleSince: null,
    ...overrides,
  };
}

describe("effective send-ready policy", () => {
  it("requires tier, email, emailVerified, verified status and no rejection", () => {
    const valid = contact({
      contactTrustTier: "send_ready",
      emailVerified: true,
      verificationStatus: "verified",
    });
    expect(isEffectivelySendReady(valid)).toBe(true);
    expect(deriveEffectiveSlateTier(valid)).toBe("send_ready");

    for (const invalid of [
      { email: null },
      { emailVerified: false },
      { verificationStatus: "unverified" },
      { rejectionReason: "wrong_company" },
      { contactTrustTier: "named_unverified" as const },
    ]) {
      const row = { ...valid, ...invalid };
      expect(isEffectivelySendReady(row)).toBe(false);
      expect(deriveEffectiveSlateTier(row)).toBe("named_unverified");
    }
  });

  it("does not reward an unsupported raw send_ready label", () => {
    const inconsistent = contact({ contactTrustTier: "send_ready", emailVerified: false });
    const named = contact({ id: 2, contactTrustTier: "named_unverified" });
    const ranked = rankSlateContacts([inconsistent, named]);
    expect(ranked.every(row => row.effectiveTrustTier === "named_unverified")).toBe(true);
    expect(ranked[0].compositeScore).toBe(ranked[1].compositeScore);
    expect(ranked.map(row => row.id)).toEqual([1, 2]);
  });
});

describe("slate eligibility and ranking", () => {
  it("excludes LLM, rejected, CRM orphan and unlinked contacts", () => {
    expect(evaluateSlateEligibility(contact({ contactTrustTier: "llm_inferred" }), true).reasons)
      .toContain("llm_inferred");
    expect(evaluateSlateEligibility(contact({ rejectionReason: "rejected" }), true).reasons)
      .toContain("rejected");
    expect(evaluateSlateEligibility(contact({ crmOrphan: true }), true).reasons)
      .toContain("crm_orphan");
    expect(evaluateSlateEligibility(contact(), false).reasons)
      .toContain("not_linked_to_project");
  });

  it("ranks effective send-ready first and breaks exact ties by ascending ID", () => {
    const sendReady = contact({
      id: 9,
      contactTrustTier: "send_ready",
      emailVerified: true,
      verificationStatus: "verified",
    });
    const named = contact({ id: 1 });
    expect(rankSlateContacts([named, sendReady])[0].id).toBe(9);

    const a = contact({ id: 8 });
    const b = contact({ id: 3 });
    expect(rankSlateContacts([a, b]).map(row => row.id)).toEqual([3, 8]);
  });
});

describe("stored-slate validation", () => {
  it("accepts a current slate whose snapshot, counts and linkage match", () => {
    const live = contact();
    const result = validateStoredCandidateSlate(
      slate(),
      new Map([[1, live]]),
      new Set([1]),
    );
    expect(result.valid).toBe(true);
    expect(result.status).toBe("current");
    expect(result.issues).toEqual([]);
  });

  it("suppresses a stale slate even when its snapshots still match", () => {
    const stored = slate({ isStale: true, staleSince: new Date() });
    const validation = validateStoredCandidateSlate(
      stored,
      new Map([[1, contact()]]),
      new Set([1]),
    );
    expect(validation.status).toBe("stale");
    expect(validation.issues.map(issue => issue.code)).toContain("stale");
    expect(sanitiseSlateForResponse(stored, validation)?.primarySnapshot).toBeNull();
  });

  it("collects structural, eligibility, freshness and count failures", () => {
    const stored = slate({
      backup1ContactId: 1,
      backup1Snapshot: null,
      totalSlotsFilled: 2,
      sendReadySlots: 2,
      namedUnverifiedSlots: 0,
      llmSlots: 1,
      primarySnapshot: snapshot({ email: "old@example.com", contactTrustTier: "send_ready" }),
    });
    const validation = validateStoredCandidateSlate(
      stored,
      new Map([[1, contact({ rejectionReason: "wrong_company" })]]),
      new Set(),
    );
    const codes = validation.issues.map(issue => issue.code);
    expect(validation.status).toBe("invalid");
    expect(codes).toContain("id_without_snapshot");
    expect(codes).toContain("rejected");
    expect(codes).toContain("not_linked_to_project");
    expect(codes).toContain("email_mismatch");
    expect(codes).toContain("trust_tier_mismatch");
    expect(codes).toContain("verification_state_inconsistency");
    expect(codes).toContain("send_ready_count_mismatch");
    expect(codes).toContain("llm_count_nonzero");
    expect(sanitiseSlateForResponse(stored, validation)?.primarySnapshot).toBeNull();
  });

  it("rejects duplicate slot assignments and missing live contacts", () => {
    const duplicate = slate({
      backup1ContactId: 1,
      backup1Snapshot: snapshot({ roleLane: "backup" }),
      totalSlotsFilled: 2,
      namedUnverifiedSlots: 2,
    });
    expect(
      validateStoredCandidateSlate(duplicate, new Map([[1, contact()]]), new Set([1]))
        .issues.map(issue => issue.code),
    ).toContain("duplicate_contact");

    expect(
      validateStoredCandidateSlate(slate(), new Map(), new Set([1]))
        .issues.map(issue => issue.code),
    ).toContain("missing_live_contact");
  });
});
