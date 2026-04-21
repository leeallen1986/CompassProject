/**
 * Stage 6A — Emarsys Export Engine: Vitest Tests
 *
 * Covers:
 *   - evaluateEligibility: all 9 hard rules (including Rule 1: opportunity project gate)
 *   - mapToEmarsysRow: field mapping correctness
 *   - buildCSV: header and row serialisation
 *   - buildExclusionReport: count aggregation
 *   - isRetiredFormerTitle: pattern matching (via evaluateEligibility Rule 6)
 *
 * All tests are pure unit tests — no DB or network calls.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateEligibility,
  mapToEmarsysRow,
  buildCSV,
  buildExclusionReport,
  type ExportMode,
  type EmarsysRow,
  type EligibilityResult,
} from "./emarsysExport";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeContact(overrides: Partial<Parameters<typeof evaluateEligibility>[0]> = {}) {
  return {
    id: 1,
    email: "alice@contractor.com.au",
    enrichedEmail: null,
    doNotContact: false,
    sendReadiness: "send_ready",
    outreachStatus: "pending",
    title: "Project Manager",
    enrichedTitle: null,
    enrichmentQA: null,
    emarsysApproved: false,
    tier: "tier1_hot",
    ...overrides,
  };
}

const CURATED: ExportMode = "curated_marketing_export";
const SALES: ExportMode = "sales_direct_export";

// ─── Rule 1: Opportunity project gate ────────────────────────────────────────

describe("Rule 1 — opportunity project gate", () => {
  it("passes when contact has a linked opportunity project", () => {
    const result = evaluateEligibility(makeContact(), true, SALES);
    expect(result.eligible).toBe(true);
    expect(result.exclusionReason).toBeNull();
  });

  it("fails when contact has no linked opportunity project", () => {
    const result = evaluateEligibility(makeContact(), false, SALES);
    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe("no_opportunity_project");
  });

  it("bypasses Rule 1 when adminOverrideOpportunityGate=true", () => {
    const result = evaluateEligibility(makeContact(), false, SALES, true);
    expect(result.eligible).toBe(true);
    expect(result.exclusionReason).toBeNull();
  });

  it("admin override does not bypass other rules", () => {
    const result = evaluateEligibility(makeContact({ doNotContact: true }), false, SALES, true);
    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe("do_not_contact");
  });
});

// ─── Rule 2: Valid email ──────────────────────────────────────────────────────

describe("Rule 2 — valid email", () => {
  it("fails when email is null", () => {
    const result = evaluateEligibility(makeContact({ email: null }), true, SALES);
    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe("missing_email");
  });

  it("fails when email is empty string", () => {
    const result = evaluateEligibility(makeContact({ email: "" }), true, SALES);
    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe("missing_email");
  });

  it("fails when email has no @ sign", () => {
    const result = evaluateEligibility(makeContact({ email: "notanemail" }), true, SALES);
    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe("missing_email");
  });

  it("uses enrichedEmail when primary email is null", () => {
    const result = evaluateEligibility(
      makeContact({ email: null, enrichedEmail: "bob@company.com" }),
      true, SALES
    );
    expect(result.eligible).toBe(true);
  });

  it("passes when enrichedEmail overrides a missing primary email", () => {
    const result = evaluateEligibility(
      makeContact({ email: null, enrichedEmail: "valid@example.com" }),
      true, SALES
    );
    expect(result.eligible).toBe(true);
  });
});

// ─── Rule 3: Do-not-contact ───────────────────────────────────────────────────

describe("Rule 3 — doNotContact flag", () => {
  it("fails when doNotContact is true", () => {
    const result = evaluateEligibility(makeContact({ doNotContact: true }), true, SALES);
    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe("do_not_contact");
  });

  it("passes when doNotContact is false", () => {
    const result = evaluateEligibility(makeContact({ doNotContact: false }), true, SALES);
    expect(result.eligible).toBe(true);
  });
});

// ─── Rule 4: Not blocked_from_send ───────────────────────────────────────────

describe("Rule 4 — blocked_from_send", () => {
  it("fails when sendReadiness is blocked_from_send", () => {
    const result = evaluateEligibility(makeContact({ sendReadiness: "blocked_from_send" }), true, SALES);
    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe("blocked_from_send");
  });

  it("passes when sendReadiness is send_ready", () => {
    const result = evaluateEligibility(makeContact({ sendReadiness: "send_ready" }), true, SALES);
    expect(result.eligible).toBe(true);
  });

  it("passes when sendReadiness is review_before_send", () => {
    const result = evaluateEligibility(makeContact({ sendReadiness: "review_before_send" }), true, SALES);
    expect(result.eligible).toBe(true);
  });

  it("passes when sendReadiness is null", () => {
    const result = evaluateEligibility(makeContact({ sendReadiness: null }), true, SALES);
    expect(result.eligible).toBe(true);
  });
});

// ─── Rule 5: Not opted_out or bounced ────────────────────────────────────────

describe("Rule 5 — opted_out / bounced", () => {
  it("fails when outreachStatus is opted_out", () => {
    const result = evaluateEligibility(makeContact({ outreachStatus: "opted_out" }), true, SALES);
    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe("opted_out_or_bounced");
  });

  it("fails when outreachStatus is bounced", () => {
    const result = evaluateEligibility(makeContact({ outreachStatus: "bounced" }), true, SALES);
    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe("opted_out_or_bounced");
  });

  it("passes when outreachStatus is pending", () => {
    const result = evaluateEligibility(makeContact({ outreachStatus: "pending" }), true, SALES);
    expect(result.eligible).toBe(true);
  });

  it("passes when outreachStatus is sent", () => {
    const result = evaluateEligibility(makeContact({ outreachStatus: "sent" }), true, SALES);
    expect(result.eligible).toBe(true);
  });
});

// ─── Rule 6: Retired/former title ────────────────────────────────────────────

describe("Rule 6 — retired / former title", () => {
  const retiredTitles = [
    "Former CEO",
    "Retired Project Manager",
    "Ex-Director of Operations",
    "Previously General Manager",
    "Past CFO",
  ];

  retiredTitles.forEach(title => {
    it(`fails for title: "${title}"`, () => {
      const result = evaluateEligibility(makeContact({ title }), true, SALES);
      expect(result.eligible).toBe(false);
      expect(result.exclusionReason).toBe("retired_former_title");
    });
  });

  it("uses enrichedTitle when primary title is retired but enriched is current", () => {
    // enrichedTitle takes precedence over title in the rule
    const result = evaluateEligibility(
      makeContact({ title: "Former CEO", enrichedTitle: "CEO" }),
      true, SALES
    );
    expect(result.eligible).toBe(true);
  });

  it("passes for normal title", () => {
    const result = evaluateEligibility(makeContact({ title: "Senior Project Engineer" }), true, SALES);
    expect(result.eligible).toBe(true);
  });

  it("passes when title is null", () => {
    const result = evaluateEligibility(makeContact({ title: null }), true, SALES);
    expect(result.eligible).toBe(true);
  });
});

// ─── Rule 7: Suspicious domain mismatch ──────────────────────────────────────

describe("Rule 7 — suspicious domain mismatch", () => {
  it("fails when domainMismatch=true and not resolved", () => {
    const result = evaluateEligibility(
      makeContact({ enrichmentQA: { domainMismatch: true } }),
      true, SALES
    );
    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe("suspicious_domain_mismatch");
  });

  it("passes when domainMismatch=true but domainMismatchResolved=true", () => {
    const result = evaluateEligibility(
      makeContact({ enrichmentQA: { domainMismatch: true, domainMismatchResolved: true } }),
      true, SALES
    );
    expect(result.eligible).toBe(true);
  });

  it("passes when enrichmentQA is null", () => {
    const result = evaluateEligibility(makeContact({ enrichmentQA: null }), true, SALES);
    expect(result.eligible).toBe(true);
  });

  it("passes when domainMismatch is false", () => {
    const result = evaluateEligibility(
      makeContact({ enrichmentQA: { domainMismatch: false } }),
      true, SALES
    );
    expect(result.eligible).toBe(true);
  });
});

// ─── Rule 8: Duplicate email unresolved ──────────────────────────────────────

describe("Rule 8 — duplicate email unresolved", () => {
  it("fails when duplicateEmail=true and not resolved", () => {
    const result = evaluateEligibility(
      makeContact({ enrichmentQA: { duplicateEmail: true } }),
      true, SALES
    );
    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe("duplicate_email_unresolved");
  });

  it("passes when duplicateEmail=true but duplicateEmailResolved=true", () => {
    const result = evaluateEligibility(
      makeContact({ enrichmentQA: { duplicateEmail: true, duplicateEmailResolved: true } }),
      true, SALES
    );
    expect(result.eligible).toBe(true);
  });
});

// ─── Rule 9: Curated marketing export — approval gate ────────────────────────

describe("Rule 9 — curated_marketing_export approval gate", () => {
  it("fails for curated mode when not approved and tier is tier3_enrich", () => {
    const result = evaluateEligibility(
      makeContact({ emarsysApproved: false, tier: "tier3_enrich" }),
      true, CURATED
    );
    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe("not_approved_for_marketing");
  });

  it("passes for curated mode when emarsysApproved=true even if tier3", () => {
    const result = evaluateEligibility(
      makeContact({ emarsysApproved: true, tier: "tier3_enrich" }),
      true, CURATED
    );
    expect(result.eligible).toBe(true);
  });

  it("passes for curated mode when tier is tier1_hot (no explicit approval needed)", () => {
    const result = evaluateEligibility(
      makeContact({ emarsysApproved: false, tier: "tier1_hot" }),
      true, CURATED
    );
    expect(result.eligible).toBe(true);
  });

  it("passes for curated mode when tier is tier2_warm (no explicit approval needed)", () => {
    const result = evaluateEligibility(
      makeContact({ emarsysApproved: false, tier: "tier2_warm" }),
      true, CURATED
    );
    expect(result.eligible).toBe(true);
  });

  it("Rule 9 does NOT apply for sales_direct_export", () => {
    const result = evaluateEligibility(
      makeContact({ emarsysApproved: false, tier: "tier3_enrich" }),
      true, SALES
    );
    expect(result.eligible).toBe(true);
  });
});

// ─── Rule ordering: first failing rule wins ───────────────────────────────────

describe("Rule ordering — first failing rule wins", () => {
  it("returns no_opportunity_project before missing_email when both fail", () => {
    const result = evaluateEligibility(
      makeContact({ email: null }),
      false, SALES
    );
    expect(result.exclusionReason).toBe("no_opportunity_project");
  });

  it("returns missing_email before do_not_contact when both fail (Rule 1 passes)", () => {
    const result = evaluateEligibility(
      makeContact({ email: null, doNotContact: true }),
      true, SALES
    );
    expect(result.exclusionReason).toBe("missing_email");
  });

  it("returns do_not_contact before blocked_from_send when both fail", () => {
    const result = evaluateEligibility(
      makeContact({ doNotContact: true, sendReadiness: "blocked_from_send" }),
      true, SALES
    );
    expect(result.exclusionReason).toBe("do_not_contact");
  });
});

// ─── Field mapper ─────────────────────────────────────────────────────────────

describe("mapToEmarsysRow", () => {
  const contact = {
    id: 42,
    campaignId: 7,
    firstName: "Alice",
    lastName: "Smith",
    title: "Procurement Manager",
    enrichedTitle: "Senior Procurement Manager",
    company: "BHP Group",
    reviewedCompanyName: "BHP Group Ltd",
    email: "alice@bhp.com",
    enrichedEmail: "alice.smith@bhp.com",
    tier: "tier1_hot",
  };

  const defaults = {
    divisionLabel: "Atlas Copco",
    salesOrg: "AU30",
    languageTag: "en",
    countryRegion: "Australia",
    collateralName: "DrillAir X1350 Brochure",
  };

  const row = mapToEmarsysRow(contact, "Q2 Mining Campaign", defaults, "Admin User", SALES);

  it("sets CD_identifier correctly", () => {
    expect(row.CD_identifier).toBe("atlas-cc-42-7");
  });

  it("uses enrichedEmail over primary email", () => {
    expect(row.Email).toBe("alice.smith@bhp.com");
  });

  it("uses enrichedTitle over primary title", () => {
    expect(row.Title).toBe("Senior Procurement Manager");
  });

  it("uses reviewedCompanyName over company", () => {
    expect(row.Company).toBe("BHP Group Ltd");
  });

  it("maps First Name and Last Name correctly", () => {
    expect(row["First Name"]).toBe("Alice");
    expect(row["Last Name"]).toBe("Smith");
  });

  it("maps configurable defaults", () => {
    expect(row.CD_divisionDetails).toBe("Atlas Copco");
    expect(row.CD_salesOrgDetails).toBe("AU30");
    expect(row["IETF language tag"]).toBe("en");
    expect(row["Country or region"]).toBe("Australia");
    expect(row.CollateralName).toBe("DrillAir X1350 Brochure");
  });

  it("sets CampaignName from argument", () => {
    expect(row.CampaignName).toBe("Q2 Mining Campaign");
  });

  it("sets ExportOwner from argument", () => {
    expect(row.ExportOwner).toBe("Admin User");
  });

  it("sets ExportMode from argument", () => {
    expect(row.ExportMode).toBe("sales_direct_export");
  });

  it("sets ExportTimestamp as a valid ISO string", () => {
    expect(() => new Date(row.ExportTimestamp)).not.toThrow();
    expect(new Date(row.ExportTimestamp).getFullYear()).toBeGreaterThan(2020);
  });

  it("falls back to primary email when enrichedEmail is null", () => {
    const r = mapToEmarsysRow({ ...contact, enrichedEmail: null }, "Campaign", defaults, "Admin", SALES);
    expect(r.Email).toBe("alice@bhp.com");
  });

  it("falls back to primary title when enrichedTitle is null", () => {
    const r = mapToEmarsysRow({ ...contact, enrichedTitle: null }, "Campaign", defaults, "Admin", SALES);
    expect(r.Title).toBe("Procurement Manager");
  });

  it("falls back to company when reviewedCompanyName is null", () => {
    const r = mapToEmarsysRow({ ...contact, reviewedCompanyName: null }, "Campaign", defaults, "Admin", SALES);
    expect(r.Company).toBe("BHP Group");
  });
});

// ─── CSV builder ──────────────────────────────────────────────────────────────

describe("buildCSV", () => {
  const row: EmarsysRow = {
    CD_identifier: "atlas-cc-1-1",
    Email: "test@example.com",
    "First Name": "John",
    "Last Name": "Doe",
    CD_divisionDetails: "Atlas Copco",
    CD_salesOrgDetails: "AU30",
    "IETF language tag": "en",
    "Country or region": "Australia",
    Company: "Test Co",
    Title: "Engineer",
    CampaignName: "Test Campaign",
    CollateralName: "Brochure",
    ExportTimestamp: "2026-01-01T00:00:00.000Z",
    ExportOwner: "Admin",
    ExportMode: "sales_direct_export",
  };

  it("produces a header row as the first line", () => {
    const csv = buildCSV([row]);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("CD_identifier");
    expect(lines[0]).toContain("Email");
    expect(lines[0]).toContain("First Name");
    expect(lines[0]).toContain("Last Name");
  });

  it("produces exactly totalRows+1 lines (header + data)", () => {
    const csv = buildCSV([row, row]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(3);
  });

  it("escapes commas in values", () => {
    const r = { ...row, Company: "Smith, Jones & Co" };
    const csv = buildCSV([r]);
    expect(csv).toContain('"Smith, Jones & Co"');
  });

  it("escapes double-quotes in values", () => {
    const r = { ...row, Title: 'Director "Operations"' };
    const csv = buildCSV([r]);
    expect(csv).toContain('"Director ""Operations"""');
  });

  it("returns only header line for empty rows array", () => {
    const csv = buildCSV([]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("CD_identifier");
  });
});

// ─── Exclusion report builder ─────────────────────────────────────────────────

describe("buildExclusionReport", () => {
  it("returns all-zero counts for empty results", () => {
    const report = buildExclusionReport([]);
    expect(report.no_opportunity_project).toBe(0);
    expect(report.missing_email).toBe(0);
  });

  it("counts each exclusion reason correctly", () => {
    const results: EligibilityResult[] = [
      { contactId: 1, eligible: false, exclusionReason: "missing_email" },
      { contactId: 2, eligible: false, exclusionReason: "missing_email" },
      { contactId: 3, eligible: false, exclusionReason: "do_not_contact" },
      { contactId: 4, eligible: true, exclusionReason: null },
    ];
    const report = buildExclusionReport(results);
    expect(report.missing_email).toBe(2);
    expect(report.do_not_contact).toBe(1);
    expect(report.no_opportunity_project).toBe(0);
  });

  it("does not count eligible contacts in any exclusion bucket", () => {
    const results: EligibilityResult[] = [
      { contactId: 1, eligible: true, exclusionReason: null },
      { contactId: 2, eligible: true, exclusionReason: null },
    ];
    const report = buildExclusionReport(results);
    const total = Object.values(report).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });

  it("counts all 9 exclusion reasons independently", () => {
    const reasons = [
      "no_opportunity_project",
      "missing_email",
      "do_not_contact",
      "blocked_from_send",
      "opted_out_or_bounced",
      "retired_former_title",
      "suspicious_domain_mismatch",
      "duplicate_email_unresolved",
      "not_approved_for_marketing",
    ] as const;

    const results: EligibilityResult[] = reasons.map((r, i) => ({
      contactId: i + 1,
      eligible: false,
      exclusionReason: r,
    }));

    const report = buildExclusionReport(results);
    reasons.forEach(r => expect(report[r]).toBe(1));
  });
});
