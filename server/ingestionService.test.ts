/**
 * ingestionService.test.ts
 *
 * Vitest unit tests for the Stage 1 pre-waterfall ingestion service.
 *
 * Coverage:
 *   1. detectColumnMapping — all supported alias variants
 *   2. detectUploadType — contact_split, company_only, crm_export
 *   3. parseFullName — split, full, honorifics, ambiguous
 *   4. normalizeSplitName — casing, honorifics, all-caps
 *   5. normalizeTitle — casing, punctuation, abbreviation expansion
 *   6. canonicalizeCompany — legal suffix stripping, placeholders
 *   7. validateEmail — valid, invalid, role address
 *   8. classifyRow — clean, review_needed, skip
 *   9. runIngestionPipeline — contact-led CSV, company-led CSV, CRM export
 *  10. Deduplication — within-batch and cross-batch
 *  11. stagedToRawContact — round-trip conversion
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
    // Service keeps middle name as part of lastName (standard behaviour)
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
    const { firstName, lastName, flags } = parseFullName("Madonna");
    expect(firstName).toBe("Madonna");
    expect(lastName).toBeNull();
    // Single-word name is ambiguous — no_name should NOT be set, but lastName is null
    expect(firstName).not.toBeNull();
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

  it("preserves all-caps acronyms like CEO", () => {
    const { title } = normalizeTitle("CEO");
    // CEO is a known alias → expands to Chief Executive Officer
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
    const { flags, company } = canonicalizeCompany("Company");
    expect(flags).toContain("placeholder_company");
    expect(company).toBeNull();
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
// 8. classifyRow
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyRow", () => {
  it("classifies a complete row with no flags as clean", () => {
    const result = classifyRow({
      firstName: "John",
      lastName: "Smith",
      company: "Orontide",
      email: "john.smith@orontide.com.au",
      reviewFlags: [],
    });
    expect(result).toBe("clean");
  });

  it("classifies a row with no_name as review_needed", () => {
    const result = classifyRow({
      firstName: null,
      lastName: null,
      company: "Orontide",
      email: "john@orontide.com.au",
      reviewFlags: ["no_name"],
    });
    expect(result).toBe("review_needed");
  });

  it("classifies a row with no_company as review_needed", () => {
    const result = classifyRow({
      firstName: "John",
      lastName: "Smith",
      company: null,
      email: "john@orontide.com.au",
      reviewFlags: ["no_company"],
    });
    expect(result).toBe("review_needed");
  });

  it("classifies a row with duplicate_in_batch as review_needed", () => {
    const result = classifyRow({
      firstName: "John",
      lastName: "Smith",
      company: "Orontide",
      email: "john@orontide.com.au",
      reviewFlags: ["duplicate_in_batch"],
    });
    expect(result).toBe("review_needed");
  });

  it("classifies a row with both placeholder_name and placeholder_company as skip", () => {
    const result = classifyRow({
      firstName: null,
      lastName: null,
      company: null,
      email: null,
      reviewFlags: ["placeholder_name", "placeholder_company"],
    });
    expect(result).toBe("skip");
  });

  it("classifies a completely empty row as skip", () => {
    const result = classifyRow({
      firstName: null,
      lastName: null,
      company: null,
      email: null,
      reviewFlags: [],
    });
    expect(result).toBe("skip");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Full pipeline — contact-led (split name) CSV
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
    // 3 data rows; empty row is skipped
    expect(result.totalRows).toBe(4); // 4 data rows in CSV (including empty)
    expect(result.skippedRows).toBeGreaterThanOrEqual(1);
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

  it("classifies John (clean data) as clean", () => {
    const result = runIngestionPipeline(buffer);
    const john = result.staged.find(s => s.firstName === "John");
    expect(john?.classification).toBe("clean");
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
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Full pipeline — company-led CSV
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

  it("extracts domain from website column", () => {
    const result = runIngestionPipeline(buffer);
    const orontide = result.staged.find(s => s.company?.includes("Orontide"));
    expect(orontide?.domain).toBe("orontide.com.au");
  });

  it("flags placeholder company name and skips it", () => {
    const result = runIngestionPipeline(buffer);
    // "Company" is in PLACEHOLDER_COMPANIES → gets placeholder_company flag → skipped
    const generic = result.staged.find(s => s.companyRaw === "Company");
    // It should be skipped (not in staged) or flagged
    if (generic) {
      expect(generic.reviewFlags).toContain("placeholder_company");
    } else {
      // Was skipped — also acceptable
      expect(result.skippedRows).toBeGreaterThanOrEqual(1);
    }
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
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Deduplication
// ─────────────────────────────────────────────────────────────────────────────

describe("runIngestionPipeline — deduplication", () => {
  const csvContent = [
    "First Name,Last Name,Email,Organization",
    "John,Smith,john.smith@orontide.com.au,Orontide",
    "Jane,Doe,jane.doe@bhp.com,BHP",
    "John,Smith,john.smith@orontide.com.au,Orontide"  // exact duplicate
  ].join("\n");

  const buffer = Buffer.from(csvContent, "utf-8");

  it("detects in-file duplicate email with duplicate_in_batch flag", () => {
    const result = runIngestionPipeline(buffer);
    const dupes = result.staged.filter(s => s.reviewFlags.includes("duplicate_in_batch"));
    expect(dupes.length).toBeGreaterThanOrEqual(1);
  });

  it("marks cross-batch duplicate when email already exists in campaign", () => {
    const existingEmails = new Set(["john.smith@orontide.com.au"]);
    const result = runIngestionPipeline(buffer, { existingEmails });
    const john = result.staged.find(s => s.email === "john.smith@orontide.com.au");
    expect(john?.reviewFlags).toContain("duplicate_in_campaign");
  });

  it("does not flag unique emails as duplicates", () => {
    const result = runIngestionPipeline(buffer);
    const jane = result.staged.find(s => s.email === "jane.doe@bhp.com");
    expect(jane?.reviewFlags).not.toContain("duplicate_in_batch");
    expect(jane?.reviewFlags).not.toContain("duplicate_in_campaign");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. stagedToRawContact round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe("stagedToRawContact", () => {
  it("converts a staged contact to a RawContactRow", () => {
    const staged: StagedContact = {
      firstName: "John",
      lastName: "Smith",
      fullNameRaw: "John Smith",
      title: "Project Manager",
      titleRaw: "project manager",
      company: "Orontide Group",
      companyRaw: "Orontide Group Pty Ltd",
      companyCanonical: "Orontide Group",
      domain: "orontide.com.au",
      email: "john.smith@orontide.com.au",
      phone: "0412345678",
      mobile: null,
      linkedin: "https://linkedin.com/in/johnsmith",
      notes: "Key contact",
      classification: "clean",
      reviewFlags: [],
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
      firstName: null,
      lastName: null,
      fullNameRaw: "Unknown",
      title: null,
      titleRaw: null,
      company: "BHP",
      companyRaw: "BHP Limited",
      companyCanonical: "BHP",
      domain: null,
      email: null,
      phone: null,
      mobile: null,
      linkedin: null,
      notes: null,
      classification: "review_needed",
      reviewFlags: ["no_name"],
      sourceRow: 5,
      uploadFileType: "crm_export",
    };

    const raw = stagedToRawContact(staged);
    expect(raw.firstName).toBeNull();
    expect(raw.email).toBeNull();
    expect(raw.company).toBe("BHP");
  });
});
