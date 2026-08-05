import { describe, expect, it } from "vitest";
import {
  attachOutreachContactProjection,
  type ExactContactProjectLink,
} from "./outreachContactProjection";
import type { SlatePolicyContact } from "./contactSlateTrustPolicy";

function contact(overrides: Partial<SlatePolicyContact> = {}): SlatePolicyContact {
  return {
    id: 10,
    name: "Casey Buyer",
    title: "Procurement Manager",
    company: "Build Co",
    email: "casey@example.com",
    linkedin: null,
    enrichmentSource: "linkedin",
    contactTrustTier: "send_ready",
    confidenceScore: "high",
    roleRelevance: "high",
    emailVerified: true,
    verificationStatus: "verified",
    rejectionReason: null,
    crmOrphan: false,
    ...overrides,
  };
}

function projectIds(
  overrides: Partial<SlatePolicyContact> = {},
  links: ExactContactProjectLink[] = [{ contactId: 10, projectId: 101 }],
) {
  return attachOutreachContactProjection([contact(overrides)], links)[0];
}

describe("attachOutreachContactProjection", () => {
  it("exposes an exact linked project for a fully send-ready contact", () => {
    expect(projectIds().outreachEligibleProjectIds).toEqual([101]);
  });

  it("deduplicates and sorts exact project links", () => {
    const result = projectIds({}, [
      { contactId: 10, projectId: 300 },
      { contactId: 10, projectId: 101 },
      { contactId: 10, projectId: 300 },
    ]);
    expect(result.linkedProjectIds).toEqual([101, 300]);
    expect(result.outreachEligibleProjectIds).toEqual([101, 300]);
  });

  it("does not attach another contact's project link", () => {
    const result = projectIds({}, [{ contactId: 11, projectId: 101 }]);
    expect(result.linkedProjectIds).toEqual([]);
    expect(result.outreachEligibleProjectIds).toEqual([]);
  });

  it.each([
    ["missing email verification", { emailVerified: null }],
    ["false email verification", { emailVerified: false }],
    ["missing verification status", { verificationStatus: null }],
    ["wrong verification status", { verificationStatus: "unverified" }],
    ["whitespace email", { email: "   " }],
    ["named-unverified tier", { contactTrustTier: "named_unverified" as const }],
    ["LLM-inferred tier", { contactTrustTier: "llm_inferred" as const }],
    ["LLM source despite send-ready tier", { enrichmentSource: "llm" }],
    ["rejection", { rejectionReason: "bounced" }],
    ["CRM orphan", { crmOrphan: true }],
    ["unknown CRM orphan state", { crmOrphan: null }],
  ])("fails closed for %s", (_label, overrides) => {
    const result = projectIds(overrides);
    expect(result.linkedProjectIds).toEqual([101]);
    expect(result.outreachEligibleProjectIds).toEqual([]);
  });

  it("discards non-positive and non-integer link IDs", () => {
    const result = projectIds({}, [
      { contactId: 10, projectId: 0 },
      { contactId: 10, projectId: -1 },
      { contactId: 10, projectId: 1.5 },
      { contactId: 10, projectId: Number.MAX_SAFE_INTEGER + 1 },
    ]);
    expect(result.linkedProjectIds).toEqual([]);
  });
});
