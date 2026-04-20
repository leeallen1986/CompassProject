/**
 * ingestionService.test.ts
 *
 * Vitest unit tests for the Stage 1 pre-waterfall ingestion service.
 *
 * Coverage:
 *   1.  detectColumnMapping — all supported alias variants
 *   2.  detectUploadType — contact_split, company_only, crm_export
 *   3.  parseFullName — split, full, honorifics, ambiguous, email-as-name, parenthetical suffix
 *   4.  normalizeSplitName — casing, honorifics, all-caps
 *   5.  normalizeTitle — casing, punctuation, abbreviation expansion, retired/former
 *   6.  canonicalizeCompany — legal suffix stripping, placeholders, JV detection
 *   7.  validateEmail — valid, invalid, role address, non-AU
 *   8.  classifyRow — all 5 classification values
 *   9.  runIngestionPipeline — contact_split, company_only, crm_export
 *  10.  Deduplication — hard (within-batch) and soft (cross-campaign)
 *  11.  Company-only branch isolation
 *  12.  Notes and exclusions — do_not_contact, retired, test rows, N/A, blank rows
 *  13.  stagedToRawContact round-trip
 */

import { describe, it, expect } from "vitest";
import {
  detectColumnMapping,
  detectUploadType,
  parseFullName,
  normalizeSplitName,
  normalizeTitle,
  canonicalizeCompany,
  validateEmail,
  classifyRow,
  runIngestionPipeline,
  stagedToRawContact,
  type StagedContact,
  type RowClassification,
} from "./ingestionService";

// ─────────────────────────────────────────────────────────────────────────────
// 1. detectColumnMapping
// ─────────────────────────────────────────────────────────────────────────────

describe("detectColumnMapping", () => {
  it("maps standard contact-led headers", () => {
    const { mapping } = detectColumnMapping([
      "First Name", "Last Name", "Job Title", "Organization",
      "Email Address", "Phone", "Mobile", "LinkedIn URL",
    ]);
    expect(mapping.firstName).toBe(0);
    expect(mapping.lastName).toBe(1);
    expect(mapping.title).toBe(2);
    expect(mapping.company).toBe(3);
    expect(mapping.email).toBe(4);
    expect(mapping.phone).toBe(5);
    expect(mapping.mobile).toBe(6);
    expect(mapping.linkedin).toBe(7);
  });

  it("maps CRM export headers with alternate names", () => {
    const { mapping } = detectColumnMapping([
      "Full Name", "Position", "Account Name", "Email",
      "Work Phone", "Cell", "LinkedIn Profile",
    ]);
    expect(mapping.fullName).toBe(0);
    expect(mapping.title).toBe(1);
    expect(mapping.company).toBe(2);
    expect(mapping.email).toBe(3);
    expect(mapping.phone).toBe(4);
    expect(mapping.mobile).toBe(5);
    expect(mapping.linkedin).toBe(6);
  });

  it("maps company-led file headers", () => {
    const { mapping } = detectColumnMapping(["Company", "Website", "Industry", "Notes"]);
    expect(mapping.company).toBe(0);
    expect(mapping.domain).toBe(1);
    expect(mapping.notes).toBe(3);
  });

  it("handles case-insensitive and trimmed headers", () => {
    const { mapping } = detectColumnMapping([
      "  FIRST NAME  ", "  SURNAME  ", "  TITLE  ", "  COMPANY  ",
    ]);
    expect(mapping.firstName).toBe(0);
    expect(mapping.lastName).toBe(1);
    expect(mapping.title).toBe(2);
    expect(mapping.company).toBe(3);
  });

  it("returns empty mapping for unrecognised headers", () => {
    const { mapping } = detectColumnMapping(["Foo", "Bar", "Baz"]);
    expect(Object.keys(mapping).length).toBe(0);
  });

  it("returns a confidence score between 0 and 1", () => {
    const { confidence } = detectColumnMapping([
      "First Name", "Last Name", "Job Title", "Company", "Email",
    ]);
    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. detectUploadType
// ─────────────────────────────────────────────────────────────────────────────

describe("detectUploadType", () => {
  it("detects contact_split when firstName/lastName columns are present", () => {
    const { mapping } = detectColumnMapping(["First Name", "Last Name", "Email", "Company"]);
    const dataRows = [["John", "Smith", "john@co.com", "Acme"]];
    const result = detectUploadType(mapping, dataRows, ["First Name", "Last Name", "Email", "Company"]);
    expect(result).toBe("contact_split");
  });

  it("detects company_only when most rows have no personal name", () => {
    const { mapping } = detectColumnMapping(["Company", "Website"]);
    const dataRows = [
      ["Orontide Group", "orontide.com.au"],
      ["BHP", "bhp.com"],
      ["Rio Tinto", "riotinto.com"],
    ];
    const result = detectUploadType(mapping, dataRows, ["Company", "Website"]);
    expect(result).toBe("company_only");
  });

  it("detects crm_export when fullName + notes columns are present", () => {
    const { mapping } = detectColumnMapping([
      "Full Name", "Position", "Account Name", "Email", "Work Phone", "Notes",
    ]);
    const dataRows = [["John Smith", "PM", "Acme", "j@acme.com", "0412", "Key contact"]];
    const result = detectUploadType(mapping, dataRows, [
      "Full Name", "Position", "Account Name", "Email", "Work Phone", "Notes",
    ]);
    expect(result).toBe("crm_export");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. parseFullName
// ─────────────────────────────────────────────────────────────────────────────

describe("parseFullName", () => {
  it("splits a simple two-word full name", () => {
    const { firstName, lastName } = parseFullName("John Smith");
    expect(firstName).toBe("John");
    expect(lastName).toBe("Smith");
  });

  it("handles three-word names (first + middle + last)", () => {
    const { firstName, lastName } = parseFullName("Mary Jane Watson");
    expect(firstName).toBe("Mary");
    expect(lastName).toBe("Jane Watson");
  });

  it("strips honorific prefixes", () => {
    const { firstName, lastName } = parseFullName("Mr. James Brown");
    expect(firstName).toBe("James");
    expect(lastName).toBe("Brown");
  });

  it("handles single-word name as firstName only", () => {
    const { firstName, lastName } = parseFullName("Madonna");
    expect(firstName).toBe("Madonna");
    expect(lastName).toBeNull();
  });

  it("returns null for empty input", () => {
    const { firstName, lastName } = parseFullName("");
    expect(firstName).toBeNull();
    expect(lastName).toBeNull();
  });

  it("handles comma-separated Last, First format", () => {
    const { firstName, lastName } = parseFullName("Smith, John");
    expect(firstName).toBe("John");
    expect(lastName).toBe("Smith");
  });

  it("title-cases all-uppercase names", () => {
    const { firstName, lastName } = parseFullName("JOHN SMITH");
    expect(firstName).toBe("John");
    expect(lastName).toBe("Smith");
  });

  it("flags all-caps name", () => {
    const { flags } = parseFullName("SARAH CHEN");
    expect(flags).toContain("all_caps_name");
  });

  it("strips (retired) parenthetical from lastName", () => {
    const { firstName, lastName } = parseFullName("David Kumar (retired)");
    expect(firstName).toBe("David");
    expect(lastName).toBe("Kumar");
  });

  it("strips (former) parenthetical from lastName", () => {
    const { firstName, lastName } = parseFullName("Jane Doe (former)");
    expect(firstName).toBe("Jane");
    expect(lastName).toBe("Doe");
  });

  it("detects email address in name field (email_as_name)", () => {
    const { firstName, lastName, flags } = parseFullName("info@cimic.com.au");
    expect(firstName).toBeNull();
    expect(lastName).toBeNull();
    expect(flags).toContain("email_as_name");
  });

  it("detects test@test.com as email_as_name", () => {
    const { firstName, lastName, flags } = parseFullName("test@test.com");
    expect(firstName).toBeNull();
    expect(lastName).toBeNull();
    expect(flags).toContain("email_as_name");
  });

  it("returns null for N/A placeholder", () => {
    const { firstName, lastName, flags } = parseFullName("N/A");
    expect(firstName).toBeNull();
    expect(lastName).toBeNull();
    expect(flags).toContain("placeholder_name");
  });

  it("flags name that looks like a company", () => {
    const { flags } = parseFullName("BHP Pty Ltd");
    expect(flags).toContain("name_looks_like_company");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. normalizeSplitName
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeSplitName", () => {
  it("applies title case to a normal name", () => {
    const { firstName, lastName } = normalizeSplitName("john", "smith");
    expect(firstName).toBe("John");
    expect(lastName).toBe("Smith");
  });

  it("strips honorific from first name", () => {
    const { firstName } = normalizeSplitName("Mr. James", "Brown");
    expect(firstName).toBe("James");
  });

  it("flags all-caps first name", () => {
    const { flags } = normalizeSplitName("JOHN", "Smith");
    expect(flags).toContain("all_caps_name");
  });

  it("flags placeholder first name", () => {
    const { flags, firstName } = normalizeSplitName("N/A", "Smith");
    expect(flags).toContain("placeholder_name");
    expect(firstName).toBeNull();
  });

  it("flags name that looks like a company", () => {
    const { flags } = normalizeSplitName("Orontide Pty Ltd", null);
    expect(flags).toContain("name_looks_like_company");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. normalizeTitle
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeTitle", () => {
  it("title-cases a lowercase title", () => {
    const { title } = normalizeTitle("project manager");
    expect(title).toBe("Project Manager");
  });

  it("expands CEO abbreviation", () => {
    const { title } = normalizeTitle("CEO");
    expect(title).toBe("Chief Executive Officer");
  });

  it("expands BDM abbreviation", () => {
    const { title } = normalizeTitle("BDM");
    expect(title).toBe("Business Development Manager");
  });

  it("expands PM abbreviation", () => {
    const { title } = normalizeTitle("PM");
    expect(title).toBe("Project Manager");
  });

  it("strips trailing punctuation", () => {
    const { title } = normalizeTitle("Site Supervisor.");
    expect(title).toBe("Site Supervisor");
  });

  it("returns null for empty input", () => {
    const { title } = normalizeTitle("");
    expect(title).toBeNull();
  });

  it("handles null input gracefully", () => {
    const { title } = normalizeTitle(null);
    expect(title).toBeNull();
  });

  it("flags a title that is too long", () => {
    const { flags } = normalizeTitle("A".repeat(130));
    expect(flags).toContain("title_too_long");
  });

  it("flags retired/former title", () => {
    const { flags } = normalizeTitle("Former Project Director");
    expect(flags).toContain("retired_or_former");
  });

  it("flags ex- title", () => {
    const { flags } = normalizeTitle("Ex-Site Manager");
    expect(flags).toContain("retired_or_former");
  });

  it("does not preserve 4-letter non-acronym all-caps words", () => {
    const { title } = normalizeTitle("SITE Supervisor");
    expect(title).toBe("Site Supervisor");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. canonicalizeCompany
// ─────────────────────────────────────────────────────────────────────────────

describe("canonicalizeCompany", () => {
  it("strips Pty Ltd suffix", () => {
    const { canonical } = canonicalizeCompany("Orontide Group Pty Ltd");
    expect(canonical).toBe("Orontide Group");
  });

  it("strips Pty. Ltd. with dots", () => {
    const { canonical } = canonicalizeCompany("Atlas Copco Pty. Ltd.");
    expect(canonical).toBe("Atlas Copco");
  });

  it("strips Inc suffix", () => {
    const { canonical } = canonicalizeCompany("Acme Inc");
    expect(canonical).toBe("Acme");
  });

  it("strips Limited suffix", () => {
    const { canonical } = canonicalizeCompany("BHP Limited");
    expect(canonical).toBe("BHP");
  });

  it("flags placeholder company names", () => {
    const { flags, canonical } = canonicalizeCompany("Company");
    expect(flags).toContain("placeholder_company");
    expect(canonical).toBeNull();
  });

  it("flags n/a as placeholder", () => {
    const { flags } = canonicalizeCompany("N/A");
    expect(flags).toContain("placeholder_company");
  });

  it("returns null for empty input", () => {
    const { canonical } = canonicalizeCompany("");
    expect(canonical).toBeNull();
  });

  it("preserves company name when no suffix present", () => {
    const { canonical } = canonicalizeCompany("Rio Tinto");
    expect(canonical).toBe("Rio Tinto");
  });

  it("extracts domain from website URL in company field", () => {
    const { domain } = canonicalizeCompany("https://www.orontide.com.au");
    expect(domain).toBe("orontide.com.au");
  });

  it("flags JV company name (slash separator)", () => {
    const { flags, jointVentureLabel } = canonicalizeCompany("CIMIC Group / UGL Joint Venture");
    expect(flags).toContain("joint_venture");
    expect(jointVentureLabel).toBeTruthy();
  });

  it("flags JV company name (Thiess / MACA)", () => {
    const { flags } = canonicalizeCompany("Thiess / MACA Joint Venture");
    expect(flags).toContain("joint_venture");
  });

  it("flags company name that is too long", () => {
    const { flags } = canonicalizeCompany("A".repeat(210));
    expect(flags).toContain("company_too_long");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. validateEmail
// ─────────────────────────────────────────────────────────────────────────────

describe("validateEmail", () => {
  it("accepts a valid corporate email", () => {
    const { email, flags } = validateEmail("john.smith@orontide.com.au");
    expect(email).toBe("john.smith@orontide.com.au");
    expect(flags).toHaveLength(0);
  });

  it("rejects a malformed email with suspicious_email flag", () => {
    const { email, flags } = validateEmail("not-an-email");
    expect(email).toBeNull();
    expect(flags).toContain("suspicious_email");
  });

  it("flags a role address (info@) as suspicious_email", () => {
    const { flags } = validateEmail("info@company.com");
    expect(flags).toContain("suspicious_email");
  });

  it("flags a noreply@ address as suspicious_email", () => {
    const { flags } = validateEmail("noreply@example.com");
    expect(flags).toContain("suspicious_email");
  });

  it("returns empty flags for null input", () => {
    const { email, flags } = validateEmail(null);
    expect(email).toBeNull();
    expect(flags).toHaveLength(0);
  });

  it("lowercases the email", () => {
    const { email } = validateEmail("John.Smith@COMPANY.COM");
    expect(email).toBe("john.smith@company.com");
  });

  it("flags non-AU/NZ email domains", () => {
    const { flags } = validateEmail("john@company.ru");
    expect(flags).toContain("non_au_email");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. classifyRow — all 5 classification values
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyRow", () => {
  it("classifies verified_contact: name + email + company, no flags", () => {
    const { classification } = classifyRow({
      firstName: "John",
      lastName: "Smith",
      company: "Orontide",
      email: "john.smith@orontide.com.au",
      recordType: "person",
      reviewFlags: [],
    });
    expect(classification).toBe("verified_contact");
  });

  it("classifies enrichable_contact: name + company, no email", () => {
    const { classification } = classifyRow({
      firstName: "John",
      lastName: "Smith",
      company: "Orontide",
      email: null,
      recordType: "person",
      reviewFlags: [],
    });
    expect(classification).toBe("enrichable_contact");
  });

  it("classifies company_target: recordType=company_target", () => {
    const { classification } = classifyRow({
      firstName: null,
      lastName: null,
      company: "BHP Group",
      email: null,
      recordType: "company_target",
      reviewFlags: ["no_name"],
    });
    expect(classification).toBe("company_target");
  });

  it("classifies review_needed: all_caps_name flag", () => {
    const { classification } = classifyRow({
      firstName: "Sarah",
      lastName: "Chen",
      company: "Rio Tinto",
      email: "s.chen@riotinto.com",
      recordType: "person",
      reviewFlags: ["all_caps_name"],
    });
    expect(classification).toBe("review_needed");
  });

  it("classifies review_needed: duplicate_in_campaign flag", () => {
    const { classification } = classifyRow({
      firstName: "John",
      lastName: "Smith",
      company: "BHP",
      email: "j.smith@bhp.com",
      recordType: "person",
      reviewFlags: ["duplicate_in_campaign"],
    });
    expect(classification).toBe("review_needed");
  });

  it("classifies review_needed: joint_venture flag", () => {
    const { classification } = classifyRow({
      firstName: null,
      lastName: null,
      company: "CIMIC Group / UGL Joint Venture",
      email: null,
      recordType: "person",
      reviewFlags: ["joint_venture"],
    });
    expect(classification).toBe("review_needed");
  });

  it("classifies rejected: do_not_contact flag", () => {
    const { classification, rejectionReason } = classifyRow({
      firstName: "David",
      lastName: "Kumar",
      company: "Thiess",
      email: "d.kumar@thiess.com.au",
      recordType: "person",
      reviewFlags: ["do_not_contact"],
    });
    expect(classification).toBe("rejected");
    expect(rejectionReason).toBeTruthy();
  });

  it("classifies rejected: test_row flag", () => {
    const { classification } = classifyRow({
      firstName: null,
      lastName: null,
      company: "Test Company",
      email: null,
      recordType: "person",
      reviewFlags: ["test_row"],
    });
    expect(classification).toBe("rejected");
  });

  it("classifies rejected: duplicate_in_batch flag", () => {
    const { classification } = classifyRow({
      firstName: "John",
      lastName: "Smith",
      company: "BHP",
      email: "j.smith@bhp.com",
      recordType: "person",
      reviewFlags: ["duplicate_in_batch"],
    });
    expect(classification).toBe("rejected");
  });

  it("classifies rejected: no_name + no_company + no email", () => {
    const { classification } = classifyRow({
      firstName: null,
      lastName: null,
      company: null,
      email: null,
      recordType: "person",
      reviewFlags: [],
    });
    expect(classification).toBe("rejected");
  });

  it("classifies rejected: placeholder_name + placeholder_company", () => {
    const { classification } = classifyRow({
      firstName: null,
      lastName: null,
      company: null,
      email: null,
      recordType: "person",
      reviewFlags: ["placeholder_name", "placeholder_company"],
    });
    expect(classification).toBe("rejected");
  });

  it("all 5 classification values are valid RowClassification members", () => {
    const validValues: RowClassification[] = [
      "verified_contact", "enrichable_contact", "company_target",
      "review_needed", "rejected",
    ];
    const testCases = [
      { firstName: "John", lastName: "Smith", company: "BHP", email: "j@bhp.com", recordType: "person" as const, reviewFlags: [] },
      { firstName: "John", lastName: "Smith", company: "BHP", email: null, recordType: "person" as const, reviewFlags: [] },
      { firstName: null, lastName: null, company: "BHP", email: null, recordType: "company_target" as const, reviewFlags: ["no_name" as const] },
      { firstName: "Sarah", lastName: "Chen", company: "Rio Tinto", email: "s@rt.com", recordType: "person" as const, reviewFlags: ["all_caps_name" as const] },
      { firstName: null, lastName: null, company: null, email: null, recordType: "person" as const, reviewFlags: [] },
    ];
    for (const tc of testCases) {
      const { classification } = classifyRow(tc);
      expect(validValues).toContain(classification);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Full pipeline — contact_split CSV
// ─────────────────────────────────────────────────────────────────────────────

describe("runIngestionPipeline — contact_split CSV", () => {
  const csvContent = [
    "First Name,Last Name,Job Title,Organization,Email,Phone,Mobile,LinkedIn",
    "John,Smith,Project Manager,Orontide Group Pty Ltd,john.smith@orontide.com.au,0412345678,,https://linkedin.com/in/johnsmith",
    "Jane,Doe,Site Supervisor,BHP Limited,jane.doe@bhp.com,,,",
    "Bob,,Accounts Payable,Acme Inc,info@acme.com,,,",
    ",,,,,,,"  // empty row — should be skipped
  ].join("\n");

  const buffer = Buffer.from(csvContent, "utf-8");

  it("detects file type as contact_split", () => {
    const result = runIngestionPipeline(buffer);
    expect(result.fileType).toBe("contact_split");
  });

  it("counts data rows correctly (excluding empty row)", () => {
    const result = runIngestionPipeline(buffer);
    expect(result.totalRows).toBe(4);
    // Empty rows are counted as rejected (not staged)
    expect(result.rejectedRows).toBeGreaterThanOrEqual(1);
  });

  it("normalizes company canonical names by stripping Pty Ltd", () => {
    const result = runIngestionPipeline(buffer);
    const john = result.staged.find(s => s.firstName === "John");
    expect(john?.companyCanonical).toBe("Orontide Group");
  });

  it("flags role email (info@) as suspicious_email", () => {
    const result = runIngestionPipeline(buffer);
    const bob = result.staged.find(s => s.firstName === "Bob");
    expect(bob?.reviewFlags).toContain("suspicious_email");
  });

  it("classifies John (clean data) as verified_contact", () => {
    const result = runIngestionPipeline(buffer);
    const john = result.staged.find(s => s.firstName === "John");
    expect(john?.classification).toBe("verified_contact");
  });

  it("classifies Bob (no last name + suspicious email) as review_needed", () => {
    const result = runIngestionPipeline(buffer);
    const bob = result.staged.find(s => s.firstName === "Bob");
    expect(bob?.classification).toBe("review_needed");
  });

  it("preserves the raw company name alongside the canonical", () => {
    const result = runIngestionPipeline(buffer);
    const john = result.staged.find(s => s.firstName === "John");
    expect(john?.companyRaw).toBe("Orontide Group Pty Ltd");
    expect(john?.companyCanonical).toBe("Orontide Group");
  });

  it("all staged rows have a recordType of person", () => {
    const result = runIngestionPipeline(buffer);
    for (const row of result.staged) {
      expect(row.recordType).toBe("person");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Full pipeline — company_only CSV
// ─────────────────────────────────────────────────────────────────────────────

describe("runIngestionPipeline — company_only CSV", () => {
  const csvContent = [
    "Company,Website,Industry,Notes",
    "Orontide Group,orontide.com.au,Mining,Key blasting contractor",
    "BHP,bhp.com,Mining,Large operator",
    "Company,,,"  // placeholder company name
  ].join("\n");

  const buffer = Buffer.from(csvContent, "utf-8");

  it("detects file type as company_only", () => {
    const result = runIngestionPipeline(buffer);
    expect(result.fileType).toBe("company_only");
  });

  it("all non-placeholder rows have recordType=company_target", () => {
    const result = runIngestionPipeline(buffer);
    const nonRejected = result.staged.filter(r => r.classification !== "rejected");
    for (const row of nonRejected) {
      expect(row.recordType).toBe("company_target");
    }
  });

  it("all non-placeholder rows have classification=company_target", () => {
    const result = runIngestionPipeline(buffer);
    const nonRejected = result.staged.filter(r => r.classification !== "rejected");
    for (const row of nonRejected) {
      expect(row.classification).toBe("company_target");
    }
  });

  it("company_target rows have null firstName and lastName", () => {
    const result = runIngestionPipeline(buffer);
    const orontide = result.staged.find(s => s.company?.includes("Orontide"));
    expect(orontide?.firstName).toBeNull();
    expect(orontide?.lastName).toBeNull();
  });

  it("extracts domain from website column", () => {
    const result = runIngestionPipeline(buffer);
    const orontide = result.staged.find(s => s.company?.includes("Orontide"));
    expect(orontide?.domain).toBe("orontide.com.au");
  });

  it("flags placeholder company name", () => {
    const result = runIngestionPipeline(buffer);
    const generic = result.staged.find(s => s.companyRaw === "Company");
    if (generic) {
      expect(generic.reviewFlags).toContain("placeholder_company");
    } else {
      expect(result.skippedRows).toBeGreaterThanOrEqual(1);
    }
  });

  it("companyTargets count matches non-placeholder company rows", () => {
    const result = runIngestionPipeline(buffer);
    expect(result.companyTargets).toBe(2); // Orontide + BHP
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Full pipeline — CRM export
// ─────────────────────────────────────────────────────────────────────────────

describe("runIngestionPipeline — crm_export", () => {
  const csvContent = [
    "Full Name,Position,Account Name,Email,Work Phone,Notes",
    "John Smith,Project Manager,Orontide Group,john.smith@orontide.com.au,0412345678,Key contact",
    "JANE DOE,SITE SUPERVISOR,BHP LIMITED,jane.doe@bhp.com,,",
    "Smith John,,,john2@orontide.com.au,,"
  ].join("\n");

  const buffer = Buffer.from(csvContent, "utf-8");

  it("detects file type as crm_export", () => {
    const result = runIngestionPipeline(buffer);
    expect(result.fileType).toBe("crm_export");
  });

  it("parses full name into first/last", () => {
    const result = runIngestionPipeline(buffer);
    const john = result.staged.find(s => s.email === "john.smith@orontide.com.au");
    expect(john?.firstName).toBe("John");
    expect(john?.lastName).toBe("Smith");
  });

  it("title-cases all-uppercase names", () => {
    const result = runIngestionPipeline(buffer);
    const jane = result.staged.find(s => s.email === "jane.doe@bhp.com");
    expect(jane?.firstName).toBe("Jane");
    expect(jane?.lastName).toBe("Doe");
  });

  it("title-cases all-uppercase title", () => {
    const result = runIngestionPipeline(buffer);
    const jane = result.staged.find(s => s.email === "jane.doe@bhp.com");
    expect(jane?.title).toBe("Site Supervisor");
  });

  it("flags all-caps name with all_caps_name review flag", () => {
    const result = runIngestionPipeline(buffer);
    const jane = result.staged.find(s => s.email === "jane.doe@bhp.com");
    expect(jane?.reviewFlags).toContain("all_caps_name");
    expect(jane?.classification).toBe("review_needed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Deduplication — hard and soft
// ─────────────────────────────────────────────────────────────────────────────

describe("runIngestionPipeline — deduplication", () => {
  const csvContent = [
    "First Name,Last Name,Email,Organization",
    "John,Smith,john.smith@orontide.com.au,Orontide",
    "Jane,Doe,jane.doe@bhp.com,BHP",
    "John,Smith,john.smith@orontide.com.au,Orontide"  // exact duplicate
  ].join("\n");

  const buffer = Buffer.from(csvContent, "utf-8");

  it("hard dedup: marks second occurrence of same email as duplicate_in_batch", () => {
    const result = runIngestionPipeline(buffer);
    const dupes = result.staged.filter(s => s.reviewFlags.includes("duplicate_in_batch"));
    expect(dupes.length).toBeGreaterThanOrEqual(1);
  });

  it("hard dedup: second occurrence is rejected (not silently merged)", () => {
    const result = runIngestionPipeline(buffer);
    const dupes = result.staged.filter(s => s.reviewFlags.includes("duplicate_in_batch"));
    for (const dupe of dupes) {
      expect(dupe.classification).toBe("rejected");
      expect(dupe.duplicateOf).toBeTruthy();
    }
  });

  it("hard dedup: first occurrence is NOT rejected", () => {
    const result = runIngestionPipeline(buffer);
    const first = result.staged.find(s => s.email === "john.smith@orontide.com.au" && s.sourceRow === 2);
    expect(first?.classification).not.toBe("rejected");
  });

  it("soft dedup: marks row as duplicate_in_campaign when email exists in campaign", () => {
    const existingEmails = new Set(["john.smith@orontide.com.au"]);
    const result = runIngestionPipeline(buffer, { existingEmails });
    const john = result.staged.find(s => s.email === "john.smith@orontide.com.au" && s.sourceRow === 2);
    expect(john?.reviewFlags).toContain("duplicate_in_campaign");
    expect(john?.duplicateOf).toContain("campaign:");
  });

  it("soft dedup: duplicate_in_campaign goes to review_needed, NOT auto-rejected", () => {
    const existingEmails = new Set(["john.smith@orontide.com.au"]);
    const result = runIngestionPipeline(buffer, { existingEmails });
    const john = result.staged.find(s => s.email === "john.smith@orontide.com.au" && s.sourceRow === 2);
    expect(john?.classification).toBe("review_needed");
  });

  it("does not flag unique emails as duplicates", () => {
    const result = runIngestionPipeline(buffer);
    const jane = result.staged.find(s => s.email === "jane.doe@bhp.com");
    expect(jane?.reviewFlags).not.toContain("duplicate_in_batch");
    expect(jane?.reviewFlags).not.toContain("duplicate_in_campaign");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Notes and exclusions
// ─────────────────────────────────────────────────────────────────────────────

describe("notes and exclusions", () => {
  it("preserves 'Do not contact before Q3' in notes field", () => {
    const csv = `First Name,Last Name,Email,Company,Notes\nDavid,Kumar,d.kumar@thiess.com.au,Thiess,Do not contact before Q3 2024\n`;
    const result = runIngestionPipeline(Buffer.from(csv));
    expect(result.staged[0].notes).toContain("Do not contact before Q3");
  });

  it("flags do_not_contact from notes and rejects the row", () => {
    const csv = `First Name,Last Name,Email,Company,Notes\nDavid,Kumar,d.kumar@thiess.com.au,Thiess,Do not contact before Q3 2024\n`;
    const result = runIngestionPipeline(Buffer.from(csv));
    expect(result.staged[0].reviewFlags).toContain("do_not_contact");
    expect(result.staged[0].classification).toBe("rejected");
  });

  it("flags retired_or_former from title", () => {
    const csv = `First Name,Last Name,Email,Company,Title\nDavid,Kumar,d.kumar@thiess.com.au,Thiess,Former Project Director\n`;
    const result = runIngestionPipeline(Buffer.from(csv));
    expect(result.staged[0].reviewFlags).toContain("retired_or_former");
  });

  it("flags retired_or_former from notes", () => {
    const csv = `First Name,Last Name,Email,Company,Notes\nDavid,Kumar,d.kumar@thiess.com.au,Thiess,Retired Q3 2023\n`;
    const result = runIngestionPipeline(Buffer.from(csv));
    expect(result.staged[0].reviewFlags).toContain("retired_or_former");
  });

  it("skips blank rows entirely", () => {
    const csv = `First Name,Last Name,Email,Company\nJohn,Smith,j.smith@bhp.com,BHP Group\n,,,\n`;
    const result = runIngestionPipeline(Buffer.from(csv));
    expect(result.staged.find(r => r.sourceRow === 3)).toBeUndefined();
    // Blank rows are counted as rejected
    expect(result.rejectedRows).toBeGreaterThanOrEqual(1);
  });

  it("rejects N/A row", () => {
    const csv = `First Name,Last Name,Email,Company\nN/A,N/A,,N/A\n`;
    const result = runIngestionPipeline(Buffer.from(csv));
    expect(result.staged[0].classification).toBe("rejected");
    expect(result.staged[0].reviewFlags).toContain("placeholder_name");
  });

  it("rejects test row (email in name field)", () => {
    const csv = `Full Name,Title,Company,Email\ntest@test.com,Test,Test Company,\n`;
    const result = runIngestionPipeline(Buffer.from(csv));
    expect(result.staged[0].classification).toBe("rejected");
    expect(result.staged[0].reviewFlags).toContain("test_row");
  });

  it("flags role email (info@) as suspicious_email", () => {
    const csv = `First Name,Last Name,Email,Company\nJohn,Smith,info@bhp.com,BHP Group\n`;
    const result = runIngestionPipeline(Buffer.from(csv));
    expect(result.staged[0].reviewFlags).toContain("suspicious_email");
  });

  it("flags malformed name (email in name field) with email_as_name", () => {
    const csv = `Full Name,Title,Company,Email\ninfo@cimic.com.au,Business Development,CIMIC Group,\n`;
    const result = runIngestionPipeline(Buffer.from(csv));
    expect(result.staged[0].reviewFlags).toContain("email_as_name");
    expect(result.staged[0].firstName).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. stagedToRawContact round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe("stagedToRawContact", () => {
  it("converts a staged contact to a RawContactRow", () => {
    const staged: StagedContact = {
      recordType: "person",
      firstName: "John",
      lastName: "Smith",
      fullNameRaw: "John Smith",
      title: "Project Manager",
      titleRaw: "project manager",
      company: "Orontide Group",
      companyRaw: "Orontide Group Pty Ltd",
      companyCanonical: "Orontide Group",
      jointVentureLabel: null,
      domain: "orontide.com.au",
      email: "john.smith@orontide.com.au",
      phone: "0412345678",
      mobile: null,
      linkedin: "https://linkedin.com/in/johnsmith",
      notes: "Key contact",
      classification: "verified_contact",
      reviewFlags: [],
      rejectionReason: null,
      duplicateOf: null,
      sourceRow: 2,
      uploadFileType: "contact_split",
    };

    const raw = stagedToRawContact(staged);
    expect(raw.firstName).toBe("John");
    expect(raw.lastName).toBe("Smith");
    expect(raw.email).toBe("john.smith@orontide.com.au");
    expect(raw.company).toBe("Orontide Group");
    expect(raw.title).toBe("Project Manager");
  });

  it("handles null fields gracefully", () => {
    const staged: StagedContact = {
      recordType: "person",
      firstName: null,
      lastName: null,
      fullNameRaw: "Unknown",
      title: null,
      titleRaw: null,
      company: "BHP",
      companyRaw: "BHP Limited",
      companyCanonical: "BHP",
      jointVentureLabel: null,
      domain: null,
      email: null,
      phone: null,
      mobile: null,
      linkedin: null,
      notes: null,
      classification: "review_needed",
      reviewFlags: ["no_name"],
      rejectionReason: null,
      duplicateOf: null,
      sourceRow: 5,
      uploadFileType: "crm_export",
    };

    const raw = stagedToRawContact(staged);
    expect(raw.firstName).toBeNull();
    expect(raw.email).toBeNull();
    expect(raw.company).toBe("BHP");
  });
});
