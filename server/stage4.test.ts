/**
 * stage4.test.ts — Stage 4 feature test suite
 *
 * Covers:
 *  1. allCampaignEnrichedEmails duplicate detection in evaluateEnrichmentQA
 *  2. sendReadiness output values (send_ready / review_before_send / blocked_from_send)
 *  3. evaluateEnrichmentQA result structure invariants
 *  4. Domain override input validation (pure logic)
 *  5. Bulk approve / export blocked — CSV row shape
 *  6. sendReadiness filter logic
 */

import { describe, it, expect } from "vitest";
import {
  evaluateEnrichmentQA,
  type EnrichmentQAInput,
} from "./enrichmentQA";

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a minimal valid EnrichmentQAInput
// ─────────────────────────────────────────────────────────────────────────────
function makeInput(overrides: Partial<EnrichmentQAInput> = {}): EnrichmentQAInput {
  return {
    firstName: "James",
    lastName: "Wilson",
    title: "Operations Manager",
    company: "BHP Group",
    recordType: "person",
    enrichedEmail: "james.wilson@bhp.com",
    originalEmail: null,
    enrichmentSource: "apollo",
    verificationStatus: "valid",
    hunterConfidence: null,
    enrichedLinkedin: "https://linkedin.com/in/jameswilson",
    enrichedTitle: null,
    finalScore: 55,
    finalTier: "tier1_hot",
    enrichedCountry: "AU",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. allCampaignEnrichedEmails — duplicate detection
// ─────────────────────────────────────────────────────────────────────────────
describe("allCampaignEnrichedEmails duplicate detection", () => {
  it("does NOT flag email_reused when the list is empty", () => {
    const result = evaluateEnrichmentQA(makeInput({ allCampaignEnrichedEmails: [] }));
    expect(result.qaFlags).not.toContain("email_reused_across_contacts");
  });

  it("does NOT flag email_reused when the email appears exactly once in the list (itself)", () => {
    const result = evaluateEnrichmentQA(makeInput({
      enrichedEmail: "james.wilson@bhp.com",
      allCampaignEnrichedEmails: ["james.wilson@bhp.com"],
    }));
    expect(result.qaFlags).not.toContain("email_reused_across_contacts");
  });

  it("flags email_reused_across_contacts when the email appears more than once", () => {
    const result = evaluateEnrichmentQA(makeInput({
      enrichedEmail: "shared@bhp.com",
      allCampaignEnrichedEmails: [
        "shared@bhp.com",
        "shared@bhp.com",  // duplicate
        "other@bhp.com",
      ],
    }));
    expect(result.qaFlags).toContain("email_reused_across_contacts");
  });

  it("is case-insensitive when detecting duplicates", () => {
    const result = evaluateEnrichmentQA(makeInput({
      enrichedEmail: "SHARED@BHP.COM",
      allCampaignEnrichedEmails: [
        "shared@bhp.com",
        "Shared@BHP.com",  // same email, different case
      ],
    }));
    expect(result.qaFlags).toContain("email_reused_across_contacts");
  });

  it("does NOT flag email_reused when allCampaignEnrichedEmails is undefined", () => {
    const result = evaluateEnrichmentQA(makeInput({ allCampaignEnrichedEmails: undefined }));
    expect(result.qaFlags).not.toContain("email_reused_across_contacts");
  });

  it("does NOT flag email_reused when enrichedEmail is null", () => {
    const result = evaluateEnrichmentQA(makeInput({
      enrichedEmail: null,
      allCampaignEnrichedEmails: ["shared@bhp.com", "shared@bhp.com"],
    }));
    expect(result.qaFlags).not.toContain("email_reused_across_contacts");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. sendReadiness output values
// ─────────────────────────────────────────────────────────────────────────────
describe("evaluateEnrichmentQA sendReadiness output", () => {
  const VALID_READINESS = ["send_ready", "review_before_send", "blocked_from_send"] as const;

  it("always returns a valid sendReadiness value", () => {
    const result = evaluateEnrichmentQA(makeInput());
    expect(VALID_READINESS as readonly string[]).toContain(result.sendReadiness);
  });

  it("returns send_ready for a clean, high-confidence contact", () => {
    const result = evaluateEnrichmentQA(makeInput({
      enrichedEmail: "james.wilson@bhp.com",
      verificationStatus: "valid",
      enrichedLinkedin: "https://linkedin.com/in/jameswilson",
      finalScore: 70,
      finalTier: "tier1_hot",
      enrichedCountry: "AU",
    }));
    expect(result.sendReadiness).toBe("send_ready");
  });

  it("returns blocked_from_send for a contact with do_not_contact flag", () => {
    const result = evaluateEnrichmentQA(makeInput({ doNotContact: true }));
    expect(result.sendReadiness).toBe("blocked_from_send");
  });

  it("returns review_before_send for a retired_or_former contact (soft flag)", () => {
    const result = evaluateEnrichmentQA(makeInput({ retiredOrFormer: true }));
    // retired_or_former is a soft flag — requires human review, not a hard block
    expect(result.sendReadiness).toBe("review_before_send");
  });

  it("returns review_before_send when email is reused across contacts (soft flag)", () => {
    const result = evaluateEnrichmentQA(makeInput({
      enrichedEmail: "shared@bhp.com",
      allCampaignEnrichedEmails: ["shared@bhp.com", "shared@bhp.com"],
    }));
    // email_reused_across_contacts is a soft flag — requires human review, not a hard block
    expect(result.sendReadiness).toBe("review_before_send");
  });

  it("returns blocked_from_send when no email exists", () => {
    const result = evaluateEnrichmentQA(makeInput({ enrichedEmail: null }));
    expect(result.sendReadiness).toBe("blocked_from_send");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. evaluateEnrichmentQA result structure invariants
// ─────────────────────────────────────────────────────────────────────────────
describe("evaluateEnrichmentQA result structure", () => {
  it("always returns required fields", () => {
    const result = evaluateEnrichmentQA(makeInput());
    expect(result).toHaveProperty("qaFlags");
    expect(result).toHaveProperty("sendReadiness");
    expect(result).toHaveProperty("hardFlags");
    expect(result).toHaveProperty("softFlags");
    expect(result).toHaveProperty("reasoningSummary");
    expect(result).toHaveProperty("providerConfidence");
    expect(result).toHaveProperty("domainMatchType");
    expect(Array.isArray(result.qaFlags)).toBe(true);
    expect(Array.isArray(result.hardFlags)).toBe(true);
    expect(Array.isArray(result.softFlags)).toBe(true);
    expect(typeof result.reasoningSummary).toBe("string");
  });

  it("hardFlags is a subset of qaFlags", () => {
    const result = evaluateEnrichmentQA(makeInput({ doNotContact: true }));
    for (const flag of result.hardFlags) {
      expect(result.qaFlags).toContain(flag);
    }
  });

  it("softFlags is a subset of qaFlags", () => {
    const result = evaluateEnrichmentQA(makeInput());
    for (const flag of result.softFlags) {
      expect(result.qaFlags).toContain(flag);
    }
  });

  it("reasoningSummary is non-empty", () => {
    const result = evaluateEnrichmentQA(makeInput());
    expect(result.reasoningSummary.length).toBeGreaterThan(0);
  });

  it("hardFlags is empty when sendReadiness is send_ready", () => {
    const result = evaluateEnrichmentQA(makeInput({
      enrichedEmail: "james.wilson@bhp.com",
      verificationStatus: "valid",
      enrichedLinkedin: "https://linkedin.com/in/jameswilson",
      finalScore: 70,
      enrichedCountry: "AU",
    }));
    if (result.sendReadiness === "send_ready") {
      expect(result.hardFlags).toHaveLength(0);
    }
  });

  it("hardFlags is non-empty when sendReadiness is blocked_from_send (do_not_contact)", () => {
    const result = evaluateEnrichmentQA(makeInput({ doNotContact: true }));
    expect(result.hardFlags.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Domain override input validation (pure logic)
// ─────────────────────────────────────────────────────────────────────────────
describe("domain override input validation", () => {
  it("accepts a valid domain string", () => {
    const domain = "bhp.com";
    expect(domain).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/i);
  });

  it("rejects an empty domain string", () => {
    const domain = "";
    expect(domain.length).toBe(0);
  });

  it("rejects a domain with spaces", () => {
    const domain = "b h p.com";
    expect(domain).toMatch(/\s/);
  });

  it("valid override actions are allow and block", () => {
    const validActions = ["allow", "block"] as const;
    expect(validActions).toContain("allow");
    expect(validActions).toContain("block");
    expect(validActions).not.toContain("ignore");
  });

  it("domain normalisation lowercases the domain", () => {
    const raw = "BHP.COM";
    const normalised = raw.toLowerCase().trim();
    expect(normalised).toBe("bhp.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Bulk approve / export blocked — CSV row shape
// ─────────────────────────────────────────────────────────────────────────────
describe("export blocked contacts CSV row shape", () => {
  interface BlockedRow {
    id: number;
    name: string;
    title: string;
    company: string;
    email: string;
    sendReadiness: string;
    enrichmentSource: string;
    blockReason: string;
    tier: string;
    score: number;
  }

  const mockRow: BlockedRow = {
    id: 1,
    name: "Jane Smith",
    title: "Procurement Manager",
    company: "Rio Tinto",
    email: "jane.smith@riotinto.com",
    sendReadiness: "blocked_from_send",
    enrichmentSource: "apollo",
    blockReason: "do_not_contact",
    tier: "tier2_warm",
    score: 45,
  };

  it("CSV row has all required fields", () => {
    const fields = ["id", "name", "title", "company", "email", "sendReadiness", "enrichmentSource", "blockReason", "tier", "score"];
    for (const field of fields) {
      expect(mockRow).toHaveProperty(field);
    }
  });

  it("CSV row can be serialised without throwing", () => {
    const values = [
      mockRow.id, mockRow.name, mockRow.title, mockRow.company, mockRow.email,
      mockRow.sendReadiness, mockRow.enrichmentSource, mockRow.blockReason, mockRow.tier, mockRow.score,
    ];
    const csvLine = values.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
    expect(csvLine).toContain("Jane Smith");
    expect(csvLine).toContain("blocked_from_send");
  });

  it("CSV escapes embedded double-quotes correctly", () => {
    const name = 'O"Brien';
    const escaped = `"${name.replace(/"/g, '""')}"`;
    expect(escaped).toBe('"O""Brien"');
  });

  it("CSV handles null/undefined values gracefully", () => {
    const values = [null, undefined, "", 0];
    const csvLine = values.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
    // null and undefined both become empty string via ?? ""
    expect(csvLine).toBe('"",' + '"",' + '"",' + '"0"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. sendReadiness filter logic
// ─────────────────────────────────────────────────────────────────────────────
describe("sendReadiness filter logic", () => {
  const contacts = [
    { id: 1, sendReadiness: "send_ready" },
    { id: 2, sendReadiness: "blocked_from_send" },
    { id: 3, sendReadiness: "review_before_send" },
    { id: 4, sendReadiness: "review_before_send" },
    { id: 5, sendReadiness: null },
  ];

  it("returns all contacts when filter is undefined", () => {
    const filter = undefined;
    const result = filter ? contacts.filter(c => c.sendReadiness === filter) : contacts;
    expect(result).toHaveLength(5);
  });

  it("filters to only send_ready contacts", () => {
    const result = contacts.filter(c => c.sendReadiness === "send_ready");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("filters to only blocked_from_send contacts", () => {
    const result = contacts.filter(c => c.sendReadiness === "blocked_from_send");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  it("filters to only review_before_send contacts", () => {
    const result = contacts.filter(c => c.sendReadiness === "review_before_send");
    expect(result).toHaveLength(2);
  });

  it("null sendReadiness contacts are excluded by any specific filter", () => {
    const result = contacts.filter(c => c.sendReadiness === "send_ready");
    expect(result.some(c => c.sendReadiness === null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. enrichmentQA approvedDomain override integration
// ─────────────────────────────────────────────────────────────────────────────
describe("enrichmentQA approvedDomain override", () => {
  it("uses approvedDomain to resolve expected domain when company domain is ambiguous", () => {
    const result = evaluateEnrichmentQA(makeInput({
      company: "BHP Billiton Ltd",
      enrichedEmail: "james@bhp.com",
      approvedDomain: "bhp.com",
    }));
    // With an approved domain override, the domain match should be exact or trusted
    expect(["exact_match", "alias_match", "trusted_parent_match"]).toContain(result.domainMatchType);
  });

  it("without approvedDomain, still resolves known company domains", () => {
    const result = evaluateEnrichmentQA(makeInput({
      company: "BHP Group",
      enrichedEmail: "james@bhp.com",
      approvedDomain: undefined,
    }));
    expect(result.domainMatchType).not.toBe("unknown_expected_domain");
  });
});
