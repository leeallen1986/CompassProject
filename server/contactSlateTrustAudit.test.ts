import { describe, expect, it } from "vitest";
import { buildSlateTrustAudit } from "./contactSlateTrustAudit";
import type { SlatePolicyContact, StoredCandidateSlate } from "./contactSlateTrustPolicy";

const contact: SlatePolicyContact = {
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
};

const slate: StoredCandidateSlate = {
  id: 1,
  projectId: 10,
  primaryContactId: 1,
  backup1ContactId: null,
  backup2ContactId: null,
  commercialContactId: null,
  technicalContactId: null,
  primarySnapshot: {
    contactId: 1,
    name: contact.name,
    title: contact.title,
    company: contact.company,
    email: contact.email,
    linkedin: contact.linkedin,
    enrichmentSource: "apollo",
    contactTrustTier: "named_unverified",
    confidenceScore: "medium",
    roleRelevance: "medium",
    roleLane: "primary",
  },
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
};

describe("read-only slate trust audit", () => {
  it("reports current slates as action-free", () => {
    const result = buildSlateTrustAudit(
      [slate],
      new Map([[1, contact]]),
      new Map([[10, new Set([1])]]),
      new Date("2026-07-25T01:00:00Z"),
    );
    expect(result.summary).toMatchObject({ totalSlates: 1, current: 1, requiresAction: 0 });
    expect(result.rows[0].issueCodes).toEqual([]);
  });

  it("retains multiple issue codes instead of masking later defects", () => {
    const broken = {
      ...slate,
      llmSlots: 1,
      primarySnapshot: { ...slate.primarySnapshot!, email: "old@example.com" },
    };
    const result = buildSlateTrustAudit(
      [broken],
      new Map([[1, { ...contact, contactTrustTier: "llm_inferred" }]]),
      new Map([[10, new Set([1])]]),
    );
    expect(result.rows[0].status).toBe("invalid");
    expect(result.rows[0].issueCodes).toContain("llm_inferred");
    expect(result.rows[0].issueCodes).toContain("email_mismatch");
    expect(result.rows[0].issueCodes).toContain("llm_count_nonzero");
  });
});
