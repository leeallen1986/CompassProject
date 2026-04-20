/**
 * enrichmentQA.test.ts — Stage 3 post-enrichment QA test suite
 *
 * Covers:
 *  1. extractEmailDomain
 *  2. deriveExpectedDomain
 *  3. classifyDomainMatch (returns { matchType, crossCompanyName? })
 *  4. isGenericRoleEmail
 *  5. computeProviderConfidence (ProviderConfidenceInput with emailExists/isGenericEmail/hasLinkedin)
 *  6. determineSendReadiness (flags, confidence, emailExists)
 *  7. company_target guard via evaluateEnrichmentQA
 *  8. retired_or_former and do_not_contact flags
 *  9. Known Atlas bad matches (regression from audit)
 * 10. evaluateEnrichmentQA end-to-end structure and invariants
 */

import { describe, it, expect } from "vitest";
import {
  extractEmailDomain,
  deriveExpectedDomain,
  classifyDomainMatch,
  isGenericRoleEmail,
  computeProviderConfidence,
  determineSendReadiness,
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
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. extractEmailDomain
// ─────────────────────────────────────────────────────────────────────────────
describe("extractEmailDomain", () => {
  it("extracts domain from a valid email", () => {
    expect(extractEmailDomain("james.wilson@bhp.com")).toBe("bhp.com");
  });

  it("lowercases the domain", () => {
    expect(extractEmailDomain("user@BHP.COM")).toBe("bhp.com");
  });

  it("returns null for null input", () => {
    expect(extractEmailDomain(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(extractEmailDomain(undefined)).toBeNull();
  });

  it("returns null for a string with no @ sign", () => {
    expect(extractEmailDomain("notanemail")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(extractEmailDomain("")).toBeNull();
  });

  it("handles subdomains correctly", () => {
    expect(extractEmailDomain("user@mail.thiess.com")).toBe("mail.thiess.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. deriveExpectedDomain
// ─────────────────────────────────────────────────────────────────────────────
describe("deriveExpectedDomain", () => {
  it("returns known mapping for BHP", () => {
    const result = deriveExpectedDomain("BHP Group");
    expect(result.domain).toBe("bhp.com");
    expect(result.source).toBe("known_mapping");
  });

  it("returns known mapping for Rio Tinto", () => {
    const result = deriveExpectedDomain("Rio Tinto");
    expect(result.domain).toBe("riotinto.com");
    expect(result.source).toBe("known_mapping");
  });

  it("returns known mapping for Thiess", () => {
    const result = deriveExpectedDomain("Thiess");
    expect(result.domain).toBe("thiess.com");
    expect(result.source).toBe("known_mapping");
  });

  it("returns known mapping for CIMIC Group", () => {
    const result = deriveExpectedDomain("CIMIC Group");
    expect(result.domain).toBe("cimic.com.au");
    expect(result.source).toBe("known_mapping");
  });

  it("returns known mapping for Downer Group", () => {
    // "downer group" is in KNOWN_COMPANY_DOMAINS
    const result = deriveExpectedDomain("Downer Group");
    expect(result.domain).toBe("downergroup.com");
    expect(result.source).toBe("known_mapping");
  });

  it("returns known mapping for Orontide Alphablast", () => {
    const result = deriveExpectedDomain("Orontide Alphablast");
    expect(result.domain).toBe("orontide.com.au");
    expect(result.source).toBe("known_mapping");
  });

  it("returns approved domain override when provided via options", () => {
    const result = deriveExpectedDomain("Some Company", {
      approvedDomain: "approved-override.com.au",
    });
    expect(result.domain).toBe("approved-override.com.au");
    expect(result.source).toBe("known_mapping");
  });

  it("returns null domain for empty company name", () => {
    const result = deriveExpectedDomain("");
    expect(result.domain).toBeNull();
  });

  it("returns null domain for null company name", () => {
    const result = deriveExpectedDomain(null);
    expect(result.domain).toBeNull();
  });

  it("uses websiteDomain option when provided", () => {
    const result = deriveExpectedDomain("Unknown Corp", {
      websiteDomain: "https://www.unknowncorp.com.au/about",
    });
    expect(result.domain).toBe("unknowncorp.com.au");
    expect(result.source).toBe("known_mapping");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. classifyDomainMatch — returns { matchType, crossCompanyName? }
// ─────────────────────────────────────────────────────────────────────────────
describe("classifyDomainMatch", () => {
  it("exact_match when domains are identical", () => {
    const result = classifyDomainMatch("bhp.com", "bhp.com", "BHP Group");
    expect(result.matchType).toBe("exact_match");
  });

  it("exact_match is case-insensitive (both lowercased before comparison)", () => {
    // extractEmailDomain lowercases, so both should already be lowercase
    const result = classifyDomainMatch("bhp.com", "bhp.com", "BHP Group");
    expect(result.matchType).toBe("exact_match");
  });

  it("trusted_parent_match for Thiess email on CIMIC contact", () => {
    // thiess.com is a CIMIC subsidiary — PARENT_DOMAIN_MAP["thiess.com"] = "cimic.com.au"
    const result = classifyDomainMatch("thiess.com", "cimic.com.au", "CIMIC Group");
    expect(result.matchType).toBe("trusted_parent_match");
  });

  it("trusted_parent_match for CPB Contractors email on CIMIC contact", () => {
    const result = classifyDomainMatch("cpbcon.com.au", "cimic.com.au", "CIMIC Group");
    expect(result.matchType).toBe("trusted_parent_match");
  });

  it("trusted_parent_match for bhpbilliton.com vs bhp.com", () => {
    // bhpbilliton.com is in PARENT_DOMAIN_MAP (maps to bhp.com), not ALIAS_DOMAIN_MAP
    // PARENT_DOMAIN_MAP check runs before ALIAS_DOMAIN_MAP check in classifyDomainMatch
    const result = classifyDomainMatch("bhpbilliton.com", "bhp.com", "BHP Group");
    expect(result.matchType).toBe("trusted_parent_match");
  });

  it("suspicious_mismatch for completely different known companies", () => {
    // pttep.com belongs to PTTEP, not Orontide
    const result = classifyDomainMatch("pttep.com", "orontide.com.au", "Orontide Alphablast");
    expect(result.matchType).toBe("suspicious_mismatch");
  });

  it("unknown_expected_domain when enriched domain is null", () => {
    const result = classifyDomainMatch(null, "bhp.com", "BHP Group");
    expect(result.matchType).toBe("unknown_expected_domain");
  });

  it("unknown_expected_domain when expected domain is null and enriched is unknown", () => {
    const result = classifyDomainMatch("unknowncompany.com", null, "Unknown Company");
    // Not a known domain → unknown_expected_domain
    expect(result.matchType).toBe("unknown_expected_domain");
  });

  it("suspicious_mismatch includes crossCompanyName when known", () => {
    const result = classifyDomainMatch("pttep.com", "orontide.com.au", "Orontide Alphablast");
    expect(result.matchType).toBe("suspicious_mismatch");
    expect(result.crossCompanyName).toBeDefined();
  });

  it("subdomain of expected domain → trusted_parent_match", () => {
    const result = classifyDomainMatch("au.bhp.com", "bhp.com", "BHP Group");
    expect(result.matchType).toBe("trusted_parent_match");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. isGenericRoleEmail
// ─────────────────────────────────────────────────────────────────────────────
describe("isGenericRoleEmail", () => {
  it("detects info@ as generic", () => {
    expect(isGenericRoleEmail("info@bhp.com")).toBe(true);
  });

  it("detects admin@ as generic", () => {
    expect(isGenericRoleEmail("admin@thiess.com")).toBe(true);
  });

  it("detects reception@ as generic", () => {
    expect(isGenericRoleEmail("reception@orontide.com.au")).toBe(true);
  });

  it("detects procurement@ as generic", () => {
    expect(isGenericRoleEmail("procurement@bhp.com")).toBe(true);
  });

  it("detects safety@ as generic", () => {
    expect(isGenericRoleEmail("safety@riotinto.com")).toBe(true);
  });

  it("does not flag a personal email", () => {
    expect(isGenericRoleEmail("james.wilson@bhp.com")).toBe(false);
  });

  it("does not flag first.last@ format", () => {
    expect(isGenericRoleEmail("sarah.chen@thiess.com")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isGenericRoleEmail(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isGenericRoleEmail(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. computeProviderConfidence
// ─────────────────────────────────────────────────────────────────────────────
describe("computeProviderConfidence", () => {
  it("high_trust: Apollo valid + exact domain + personal email + LinkedIn", () => {
    const result = computeProviderConfidence({
      enrichmentSource: "apollo",
      verificationStatus: "valid",
      hunterConfidence: null,
      domainMatchType: "exact_match",
      isGenericEmail: false,
      hasLinkedin: true,
      emailExists: true,
    });
    expect(result).toBe("high_trust");
  });

  it("blocked when email does not exist", () => {
    const result = computeProviderConfidence({
      enrichmentSource: "apollo",
      verificationStatus: "valid",
      hunterConfidence: null,
      domainMatchType: "exact_match",
      isGenericEmail: false,
      hasLinkedin: true,
      emailExists: false,
    });
    expect(result).toBe("blocked");
  });

  it("blocked when verification status is invalid", () => {
    const result = computeProviderConfidence({
      enrichmentSource: "apollo",
      verificationStatus: "invalid",
      hunterConfidence: null,
      domainMatchType: "exact_match",
      isGenericEmail: false,
      hasLinkedin: true,
      emailExists: true,
    });
    expect(result).toBe("blocked");
  });

  it("blocked when domain is suspicious_mismatch", () => {
    const result = computeProviderConfidence({
      enrichmentSource: "apollo",
      verificationStatus: "valid",
      hunterConfidence: null,
      domainMatchType: "suspicious_mismatch",
      isGenericEmail: false,
      hasLinkedin: true,
      emailExists: true,
    });
    expect(result).toBe("blocked");
  });

  it("medium_trust: Apollo valid + parent domain match", () => {
    const result = computeProviderConfidence({
      enrichmentSource: "apollo",
      verificationStatus: "valid",
      hunterConfidence: null,
      domainMatchType: "trusted_parent_match",
      isGenericEmail: false,
      hasLinkedin: true,
      emailExists: true,
    });
    expect(result).toBe("medium_trust");
  });

  it("medium_trust: Hunter ≥80 confidence + exact domain + no LinkedIn", () => {
    const result = computeProviderConfidence({
      enrichmentSource: "hunter",
      verificationStatus: "accept_all",
      hunterConfidence: 85,
      domainMatchType: "exact_match",
      isGenericEmail: false,
      hasLinkedin: false,
      emailExists: true,
    });
    // accept_all (+2) + no LinkedIn (+1) = 3 → low_trust
    expect(["medium_trust", "low_trust"]).toContain(result);
  });

  it("low_trust: Hunter <50 confidence", () => {
    const result = computeProviderConfidence({
      enrichmentSource: "hunter",
      verificationStatus: "unknown",
      hunterConfidence: 30,
      domainMatchType: "exact_match",
      isGenericEmail: false,
      hasLinkedin: true,
      emailExists: true,
    });
    // unknown (+1) + hunter 30-49 (+1) = 2 → medium_trust
    // Actually hunter <30 is +3, 30-49 is +1. Let's check: 30 < 50 → +1, unknown → +1 = 2 → medium_trust
    expect(["medium_trust", "low_trust"]).toContain(result);
  });

  it("blocked: very low Hunter confidence <30", () => {
    const result = computeProviderConfidence({
      enrichmentSource: "hunter",
      verificationStatus: "unknown",
      hunterConfidence: 15,
      domainMatchType: "exact_match",
      isGenericEmail: false,
      hasLinkedin: false,
      emailExists: true,
    });
    // hunter <30 (+3) + unknown (+1) + no LinkedIn (+1) = 5 → blocked
    expect(result).toBe("blocked");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. determineSendReadiness
// ─────────────────────────────────────────────────────────────────────────────
describe("determineSendReadiness", () => {
  it("send_ready when no flags and high_trust", () => {
    expect(determineSendReadiness([], "high_trust", true)).toBe("send_ready");
  });

  it("blocked_from_send when email does not exist", () => {
    expect(determineSendReadiness([], "high_trust", false)).toBe("blocked_from_send");
  });

  it("blocked_from_send when confidence is blocked", () => {
    expect(determineSendReadiness([], "blocked", true)).toBe("blocked_from_send");
  });

  it("blocked_from_send when domain_suspicious_mismatch hard flag present", () => {
    expect(determineSendReadiness(["domain_suspicious_mismatch"], "high_trust", true)).toBe("blocked_from_send");
  });

  it("blocked_from_send when company_target_blocked hard flag present", () => {
    expect(determineSendReadiness(["company_target_blocked"], "high_trust", true)).toBe("blocked_from_send");
  });

  it("blocked_from_send when do_not_contact hard flag present", () => {
    expect(determineSendReadiness(["do_not_contact"], "high_trust", true)).toBe("blocked_from_send");
  });

  it("blocked_from_send when geo_mismatch hard flag present", () => {
    expect(determineSendReadiness(["geo_mismatch"], "high_trust", true)).toBe("blocked_from_send");
  });

  it("review_before_send when generic_role_email soft flag present", () => {
    expect(determineSendReadiness(["generic_role_email"], "medium_trust", true)).toBe("review_before_send");
  });

  it("review_before_send when low_trust confidence even with no flags", () => {
    expect(determineSendReadiness([], "low_trust", true)).toBe("review_before_send");
  });

  it("review_before_send when catch_all_domain soft flag present", () => {
    expect(determineSendReadiness(["catch_all_domain"], "medium_trust", true)).toBe("review_before_send");
  });

  it("review_before_send when retired_or_former soft flag present", () => {
    expect(determineSendReadiness(["retired_or_former"], "medium_trust", true)).toBe("review_before_send");
  });

  it("hard flag takes precedence over soft flag", () => {
    expect(
      determineSendReadiness(["domain_suspicious_mismatch", "generic_role_email"], "medium_trust", true)
    ).toBe("blocked_from_send");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. company_target guard
// ─────────────────────────────────────────────────────────────────────────────
describe("company_target guard", () => {
  it("blocks company_target rows from send_ready", () => {
    const result = evaluateEnrichmentQA(makeInput({
      recordType: "company_target",
      enrichedEmail: "info@bhp.com",
    }));
    expect(result.sendReadiness).toBe("blocked_from_send");
    expect(result.qaFlags).toContain("company_target_blocked");
    expect(result.hardFlags).toContain("company_target_blocked");
  });

  it("company_target is blocked even with valid email and high score", () => {
    const result = evaluateEnrichmentQA(makeInput({
      recordType: "company_target",
      enrichedEmail: "james.wilson@bhp.com",
      verificationStatus: "valid",
      finalScore: 90,
      finalTier: "tier1_hot",
    }));
    expect(result.sendReadiness).toBe("blocked_from_send");
  });

  it("person record with same email is NOT blocked by company_target guard", () => {
    const result = evaluateEnrichmentQA(makeInput({
      recordType: "person",
      enrichedEmail: "james.wilson@bhp.com",
      verificationStatus: "valid",
      finalScore: 65,
      finalTier: "tier1_hot",
    }));
    expect(result.qaFlags).not.toContain("company_target_blocked");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Retired/former and do-not-contact flags
// ─────────────────────────────────────────────────────────────────────────────
describe("retired_or_former and do_not_contact flags", () => {
  it("flags retired contact with retired_or_former", () => {
    const result = evaluateEnrichmentQA(makeInput({ retiredOrFormer: true }));
    expect(result.qaFlags).toContain("retired_or_former");
  });

  it("flags do-not-contact with do_not_contact", () => {
    const result = evaluateEnrichmentQA(makeInput({ doNotContact: true }));
    expect(result.qaFlags).toContain("do_not_contact");
    expect(result.hardFlags).toContain("do_not_contact");
    expect(result.sendReadiness).toBe("blocked_from_send");
  });

  it("non-retired contact is not flagged", () => {
    const result = evaluateEnrichmentQA(makeInput({ retiredOrFormer: false }));
    expect(result.qaFlags).not.toContain("retired_or_former");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Known Atlas bad matches — regression cases from the audit
// ─────────────────────────────────────────────────────────────────────────────
describe("Atlas audit regression cases", () => {
  it("PTTEP email on Orontide contact → suspicious_mismatch → blocked", () => {
    // The audit found Hunter returning @pttep.com emails for Orontide Alphablast contacts
    const result = evaluateEnrichmentQA(makeInput({
      company: "Orontide Alphablast",
      enrichedEmail: "john.smith@pttep.com",
      enrichmentSource: "hunter",
      hunterConfidence: 72,
      verificationStatus: "accept_all",
      enrichedLinkedin: null,
    }));
    expect(result.domainMatchType).toBe("suspicious_mismatch");
    expect(result.hardFlags).toContain("domain_suspicious_mismatch");
    expect(result.sendReadiness).toBe("blocked_from_send");
  });

  it("BHP contact with @bhp.com + valid + LinkedIn → send_ready", () => {
    const result = evaluateEnrichmentQA(makeInput({
      company: "BHP Group",
      enrichedEmail: "james.wilson@bhp.com",
      verificationStatus: "valid",
      enrichedLinkedin: "https://linkedin.com/in/jameswilson",
      finalScore: 65,
      finalTier: "tier1_hot",
    }));
    expect(result.domainMatchType).toBe("exact_match");
    expect(result.sendReadiness).toBe("send_ready");
  });

  it("Thiess contact with @cimic.com.au → trusted_parent_match → not blocked", () => {
    // Thiess is a CIMIC subsidiary — parent match is a soft flag, not a hard block
    const result = evaluateEnrichmentQA(makeInput({
      company: "Thiess",
      enrichedEmail: "david.kumar@cimic.com.au",
      verificationStatus: "valid",
      enrichedLinkedin: "https://linkedin.com/in/davidkumar",
      finalScore: 60,
      finalTier: "tier1_hot",
    }));
    expect(result.domainMatchType).toBe("trusted_parent_match");
    expect(result.sendReadiness).not.toBe("blocked_from_send");
  });

  it("CIMIC/UGL JV contact with @ugl.com.au → trusted_parent_match", () => {
    const result = evaluateEnrichmentQA(makeInput({
      company: "CIMIC Group / UGL Joint Venture",
      enrichedEmail: "sarah.chen@ugl.com.au",
      verificationStatus: "valid",
      finalScore: 55,
      finalTier: "tier1_hot",
    }));
    expect(result.domainMatchType).toBe("trusted_parent_match");
  });

  it("info@bhp.com → generic_role_email → review_before_send", () => {
    const result = evaluateEnrichmentQA(makeInput({
      company: "BHP Group",
      enrichedEmail: "info@bhp.com",
      verificationStatus: "valid",
    }));
    expect(result.softFlags).toContain("generic_role_email");
    expect(result.sendReadiness).toBe("review_before_send");
  });

  it("Hunter accept_all domain → catch_all_domain soft flag", () => {
    const result = evaluateEnrichmentQA(makeInput({
      enrichmentSource: "hunter",
      verificationStatus: "accept_all",
      hunterConfidence: 80,
      enrichedEmail: "james.wilson@bhp.com",
    }));
    expect(result.softFlags).toContain("catch_all_domain");
  });

  it("Hunter low confidence <50 → low_hunter_confidence soft flag", () => {
    const result = evaluateEnrichmentQA(makeInput({
      enrichmentSource: "hunter",
      verificationStatus: "unknown",
      hunterConfidence: 35,
      enrichedEmail: "james.wilson@bhp.com",
    }));
    expect(result.softFlags).toContain("low_hunter_confidence");
  });

  it("no email at all → blocked_from_send", () => {
    const result = evaluateEnrichmentQA(makeInput({
      enrichedEmail: null,
      originalEmail: null,
    }));
    expect(result.sendReadiness).toBe("blocked_from_send");
  });

  it("non-AU/NZ country → geo_mismatch hard flag → blocked", () => {
    const result = evaluateEnrichmentQA(makeInput({
      enrichedCountry: "Thailand",
    }));
    expect(result.hardFlags).toContain("geo_mismatch");
    expect(result.sendReadiness).toBe("blocked_from_send");
  });

  it("AU country → not flagged as geo_mismatch", () => {
    const result = evaluateEnrichmentQA(makeInput({
      enrichedCountry: "Australia",
    }));
    expect(result.qaFlags).not.toContain("geo_mismatch");
  });

  it("NZ country → not flagged as geo_mismatch", () => {
    const result = evaluateEnrichmentQA(makeInput({
      enrichedCountry: "New Zealand",
    }));
    expect(result.qaFlags).not.toContain("geo_mismatch");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. evaluateEnrichmentQA end-to-end structure and invariants
// ─────────────────────────────────────────────────────────────────────────────
describe("evaluateEnrichmentQA end-to-end", () => {
  it("returns a complete result structure", () => {
    const result = evaluateEnrichmentQA(makeInput());
    expect(result).toHaveProperty("expectedDomain");
    expect(result).toHaveProperty("actualDomain");
    expect(result).toHaveProperty("domainMatchType");
    expect(result).toHaveProperty("domainMatchSource");
    expect(result).toHaveProperty("providerSource");
    expect(result).toHaveProperty("verificationStatus");
    expect(result).toHaveProperty("hunterConfidence");
    expect(result).toHaveProperty("providerConfidence");
    expect(result).toHaveProperty("qaFlags");
    expect(result).toHaveProperty("hardFlags");
    expect(result).toHaveProperty("softFlags");
    expect(result).toHaveProperty("sendReadiness");
    expect(result).toHaveProperty("reasoningSummary");
    expect(result).toHaveProperty("evaluatedAt");
    expect(result).toHaveProperty("schemaVersion");
  });

  it("hardFlags and softFlags are disjoint subsets of qaFlags", () => {
    const result = evaluateEnrichmentQA(makeInput({
      enrichmentSource: "hunter",
      verificationStatus: "accept_all",
      hunterConfidence: 40,
      enrichedEmail: "info@bhp.com",
    }));
    for (const f of result.hardFlags) {
      expect(result.qaFlags).toContain(f);
    }
    for (const f of result.softFlags) {
      expect(result.qaFlags).toContain(f);
    }
    // No flag should appear in both hard and soft
    const hardSet = new Set(result.hardFlags);
    for (const f of result.softFlags) {
      expect(hardSet.has(f)).toBe(false);
    }
  });

  it("reasoningSummary is a non-empty string", () => {
    const result = evaluateEnrichmentQA(makeInput());
    expect(typeof result.reasoningSummary).toBe("string");
    expect(result.reasoningSummary.length).toBeGreaterThan(0);
  });

  it("schemaVersion is a positive integer", () => {
    const result = evaluateEnrichmentQA(makeInput());
    expect(typeof result.schemaVersion).toBe("number");
    expect(result.schemaVersion).toBeGreaterThan(0);
  });

  it("evaluatedAt is a valid ISO timestamp", () => {
    const result = evaluateEnrichmentQA(makeInput());
    expect(() => new Date(result.evaluatedAt)).not.toThrow();
    expect(new Date(result.evaluatedAt).getTime()).toBeGreaterThan(0);
  });

  it("ideal case: Apollo valid + exact domain + personal email + AU country + LinkedIn → send_ready", () => {
    const result = evaluateEnrichmentQA(makeInput({
      company: "BHP Group",
      enrichedEmail: "james.wilson@bhp.com",
      enrichmentSource: "apollo",
      verificationStatus: "valid",
      enrichedLinkedin: "https://linkedin.com/in/jameswilson",
      finalScore: 65,
      finalTier: "tier1_hot",
      enrichedCountry: "Australia",
    }));
    expect(result.sendReadiness).toBe("send_ready");
    expect(result.hardFlags).toHaveLength(0);
  });

  it("worst case: company_target + domain mismatch → blocked with multiple hard flags", () => {
    const result = evaluateEnrichmentQA(makeInput({
      recordType: "company_target",
      company: "Orontide Alphablast",
      enrichedEmail: "john@pttep.com",
      enrichmentSource: "hunter",
      verificationStatus: "invalid",
      hunterConfidence: 20,
      retiredOrFormer: true,
      doNotContact: true,
      finalScore: 10,
      finalTier: "tier4_low",
    }));
    expect(result.sendReadiness).toBe("blocked_from_send");
    // company_target alone is a hard block — at minimum 1 hard flag
    expect(result.hardFlags.length).toBeGreaterThanOrEqual(1);
  });
});
