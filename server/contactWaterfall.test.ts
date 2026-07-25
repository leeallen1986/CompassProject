import { describe, expect, it } from "vitest";
import { buildCandidateSlateFromRows, type CandidateSlateRow } from "./contactWaterfall";

function row(overrides: Partial<CandidateSlateRow> = {}): CandidateSlateRow {
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

describe("candidate slate construction", () => {
  it("excludes LLM, rejected and orphan contacts from every slot", () => {
    const slate = buildCandidateSlateFromRows(101, [
      row({ id: 1, contactTrustTier: "llm_inferred" }),
      row({ id: 2, rejectionReason: "wrong_company" }),
      row({ id: 3, crmOrphan: true }),
    ]);
    expect(slate.totalSlotsFilled).toBe(0);
    expect(slate.llmSlots).toBe(0);
    expect(slate.eligibilityReport.excluded).toMatchObject({
      llm_inferred: 1,
      rejected: 1,
      crm_orphan: 1,
    });
  });

  it("deduplicates repeated contactProject rows before slot assignment", () => {
    const duplicate = row({ id: 10 });
    const slate = buildCandidateSlateFromRows(101, [duplicate, duplicate, row({ id: 20 })]);
    const ids = [slate.primary, slate.backup1, slate.backup2, slate.commercial, slate.technical]
      .filter(Boolean)
      .map(contact => contact!.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(slate.eligibilityReport.duplicateRowsDropped).toBe(1);
  });

  it("downgrades unsupported raw send_ready to named_unverified in coverage", () => {
    const slate = buildCandidateSlateFromRows(101, [
      row({ contactTrustTier: "send_ready", emailVerified: false }),
    ]);
    expect(slate.sendReadySlots).toBe(0);
    expect(slate.namedUnverifiedSlots).toBe(1);
    expect(slate.primary?.effectiveTrustTier).toBe("named_unverified");
  });

  it("fills role lanes deterministically without reusing contacts", () => {
    const slate = buildCandidateSlateFromRows(101, [
      row({ id: 10, title: "Project Director" }),
      row({ id: 20, title: "Procurement Manager" }),
      row({ id: 30, title: "Maintenance Manager" }),
      row({ id: 40, title: "Stakeholder Lead" }),
      row({ id: 50, title: "Finance Analyst" }),
    ]);
    expect(slate.primary?.id).toBe(10);
    expect(slate.commercial?.id).toBe(20);
    expect(slate.technical?.id).toBe(30);
    const ids = [slate.primary, slate.backup1, slate.backup2, slate.commercial, slate.technical]
      .filter(Boolean)
      .map(contact => contact!.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
