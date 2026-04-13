import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  analyseImportFile,
  parseCompanyList,
  previewImportFile,
  type ColumnMapping,
} from "./campaignCsvImport";

/** Helper: create an Excel buffer from an array of rows (first row = headers) */
function makeExcel(rows: string[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// ── analyseImportFile ──

describe("analyseImportFile", () => {
  it("detects a contact-style file (rows have names)", () => {
    const buf = makeExcel([
      ["First Name", "Last Name", "Company", "Email"],
      ["John", "Smith", "Acme Corp", "john@acme.com"],
      ["Jane", "Doe", "Beta Inc", "jane@beta.com"],
    ]);
    const mapping: ColumnMapping = { firstName: 0, lastName: 1, company: 2, email: 3 };
    const result = analyseImportFile(buf, mapping);

    expect(result.type).toBe("contacts");
    expect(result.rowsWithNames).toBe(2);
    expect(result.rowsCompanyOnly).toBe(0);
    expect(result.totalRows).toBe(2);
  });

  it("detects a company-only file (rows have company/domain but no names)", () => {
    const buf = makeExcel([
      ["Company", "Domain"],
      ["Monadelphous", "monadelphous.com.au"],
      ["Thiess", "thiess.com"],
      ["NRW Holdings", "nrw.com.au"],
      ["Macmahon", "macmahon.com.au"],
    ]);
    const mapping: ColumnMapping = { company: 0, website: 1 };
    const result = analyseImportFile(buf, mapping);

    expect(result.type).toBe("companies");
    expect(result.rowsCompanyOnly).toBe(4);
    expect(result.rowsWithNames).toBe(0);
  });

  it("detects contacts when file has emails but no names", () => {
    const buf = makeExcel([
      ["Company", "Email"],
      ["Acme Corp", "info@acme.com"],
      ["Beta Inc", "sales@beta.com"],
    ]);
    const mapping: ColumnMapping = { company: 0, email: 1 };
    const result = analyseImportFile(buf, mapping);

    // Rows with email count as "contacts" even without names
    expect(result.type).toBe("contacts");
    expect(result.rowsWithNames).toBe(2);
  });

  it("handles mixed file — majority company-only → companies", () => {
    const buf = makeExcel([
      ["Name", "Company", "Domain"],
      ["", "Monadelphous", "monadelphous.com.au"],
      ["", "Thiess", "thiess.com"],
      ["", "NRW Holdings", "nrw.com.au"],
      ["John Smith", "Acme Corp", "acme.com"],
    ]);
    const mapping: ColumnMapping = { fullName: 0, company: 1, website: 2 };
    const result = analyseImportFile(buf, mapping);

    expect(result.type).toBe("companies");
    expect(result.rowsCompanyOnly).toBe(3);
    expect(result.rowsWithNames).toBe(1);
  });

  it("handles empty file gracefully", () => {
    const buf = makeExcel([["Company", "Domain"]]);
    const mapping: ColumnMapping = { company: 0, website: 1 };
    const result = analyseImportFile(buf, mapping);

    expect(result.type).toBe("contacts");
    expect(result.totalRows).toBe(0);
  });
});

// ── parseCompanyList ──

describe("parseCompanyList", () => {
  it("extracts company names and domains", () => {
    const buf = makeExcel([
      ["Company", "Website"],
      ["Monadelphous", "https://www.monadelphous.com.au/"],
      ["Thiess", "thiess.com"],
      ["NRW Holdings", "http://nrw.com.au"],
    ]);
    const mapping: ColumnMapping = { company: 0, website: 1 };
    const result = parseCompanyList(buf, mapping);

    expect(result.companies).toHaveLength(3);
    expect(result.totalParsed).toBe(3);
    expect(result.skipped).toBe(0);

    // Domain cleaning: strips protocol, www, trailing slashes
    expect(result.companies[0].company).toBe("Monadelphous");
    expect(result.companies[0].domain).toBe("monadelphous.com.au");

    expect(result.companies[1].domain).toBe("thiess.com");
    expect(result.companies[2].domain).toBe("nrw.com.au");
  });

  it("handles rows without domains", () => {
    const buf = makeExcel([
      ["Company Name", "Notes"],
      ["Acme Corp", "Target account"],
      ["Beta Inc", ""],
    ]);
    const mapping: ColumnMapping = { company: 0 };
    const result = parseCompanyList(buf, mapping);

    expect(result.companies).toHaveLength(2);
    expect(result.companies[0].company).toBe("Acme Corp");
    expect(result.companies[0].domain).toBeNull();
    expect(result.companies[1].company).toBe("Beta Inc");
    expect(result.companies[1].domain).toBeNull();
  });

  it("skips empty rows", () => {
    const buf = makeExcel([
      ["Company", "Domain"],
      ["Monadelphous", "monadelphous.com.au"],
      ["", ""],
      ["Thiess", "thiess.com"],
    ]);
    const mapping: ColumnMapping = { company: 0, website: 1 };
    const result = parseCompanyList(buf, mapping);

    expect(result.companies).toHaveLength(2);
    expect(result.skipped).toBe(1);
  });

  it("auto-detects company-list columns from headers", () => {
    const buf = makeExcel([
      ["Organization", "URL", "Location"],
      ["Monadelphous", "monadelphous.com.au", "Perth, WA"],
      ["Thiess", "thiess.com", "Brisbane, QLD"],
    ]);
    // Provide minimal mapping — the function should auto-detect from headers
    const mapping: ColumnMapping = {};
    const result = parseCompanyList(buf, mapping);

    expect(result.companies).toHaveLength(2);
    expect(result.companies[0].company).toBe("Monadelphous");
    expect(result.companies[0].domain).toBe("monadelphous.com.au");
    expect(result.companies[0].location).toBe("Perth, WA");
  });

  it("handles N/A and dash values as null", () => {
    const buf = makeExcel([
      ["Company", "Domain", "Notes"],
      ["Acme Corp", "N/A", "--"],
      ["Beta Inc", "-", "n/a"],
    ]);
    const mapping: ColumnMapping = { company: 0, website: 1 };
    const result = parseCompanyList(buf, mapping);

    expect(result.companies).toHaveLength(2);
    expect(result.companies[0].domain).toBeNull();
    expect(result.companies[1].domain).toBeNull();
  });
});

// ── previewImportFile ──

describe("previewImportFile", () => {
  it("auto-detects domain/website column", () => {
    const buf = makeExcel([
      ["Company", "Domain", "Location"],
      ["Monadelphous", "monadelphous.com.au", "Perth"],
    ]);
    const preview = previewImportFile(buf);

    expect(preview.headers).toEqual(["Company", "Domain", "Location"]);
    expect(preview.totalRows).toBe(1);
    // The website/domain column should be detected
    expect(preview.detectedMapping.website).toBe(1);
    expect(preview.detectedMapping.company).toBe(0);
  });

  it("returns sample rows for preview", () => {
    const buf = makeExcel([
      ["Company", "Domain"],
      ["Monadelphous", "monadelphous.com.au"],
      ["Thiess", "thiess.com"],
      ["NRW", "nrw.com.au"],
    ]);
    const preview = previewImportFile(buf);

    expect(preview.sampleRows).toHaveLength(3);
    expect(preview.totalRows).toBe(3);
  });
});

// ── Title-Row Detection ──

describe("Title-row detection", () => {
  it("should skip a single-cell title row and use row 2 as headers", () => {
    const buf = makeExcel([
      ["Australia Drilling Contractors (Tier 1 & Tier 2) - RC / Waterwell Focus"],
      ["Tier", "Company", "Company Domain", "Ownership", "Location"],
      ["Tier 1", "Ausdrill", "ausdrill.com.au", "Perenti", "Perth"],
      ["Tier 1", "BWE Drilling", "bwedrilling.com.au", "Dynamic Group", "Perth"],
      ["Tier 2", "Raglan Drilling", "raglandrilling.com.au", "", "Kalgoorlie"],
    ]);

    const preview = previewImportFile(buf);

    // Headers should be from row 2, not the title row
    expect(preview.headers).toContain("Tier");
    expect(preview.headers).toContain("Company");
    expect(preview.headers).toContain("Company Domain");
    expect(preview.headers).not.toContain(
      "Australia Drilling Contractors (Tier 1 & Tier 2) - RC / Waterwell Focus"
    );

    // Should have 3 data rows
    expect(preview.totalRows).toBe(3);

    // Sample rows should contain actual data
    expect(preview.sampleRows[0]).toContain("Ausdrill");
  });

  it("should NOT skip row 0 when it has many columns (real header row)", () => {
    const buf = makeExcel([
      ["First Name", "Last Name", "Company", "Email", "Phone"],
      ["John", "Smith", "BHP", "john@bhp.com", "0412345678"],
      ["Jane", "Doe", "Rio Tinto", "jane@riotinto.com", "0498765432"],
    ]);

    const preview = previewImportFile(buf);
    expect(preview.headers).toContain("First Name");
    expect(preview.headers).toContain("Last Name");
    expect(preview.totalRows).toBe(2);
  });

  it("should handle a two-cell title row (title + date)", () => {
    const buf = makeExcel([
      ["Drilling Contractors Report", "April 2026"],
      ["Company", "Domain", "Tier", "State", "Notes"],
      ["Ausdrill", "ausdrill.com.au", "Tier 1", "WA", "Major player"],
    ]);

    const preview = previewImportFile(buf);
    expect(preview.headers).toContain("Company");
    expect(preview.headers).toContain("Domain");
    expect(preview.totalRows).toBe(1);
  });

  it("should classify title-row company file as 'companies' not 'contacts'", () => {
    const buf = makeExcel([
      ["Australia Drilling Contractors (Tier 1 & Tier 2) - RC / Waterwell Focus"],
      ["Tier", "Company", "Company Domain", "Ownership", "Location"],
      ["Tier 1", "Ausdrill", "ausdrill.com.au", "Perenti", "Perth"],
      ["Tier 1", "BWE Drilling", "bwedrilling.com.au", "Dynamic Group", "Perth"],
      ["Tier 2", "Raglan Drilling", "raglandrilling.com.au", "", "Kalgoorlie"],
    ]);

    const preview = previewImportFile(buf);
    const analysis = analyseImportFile(buf, preview.detectedMapping);

    expect(analysis.type).toBe("companies");
    expect(analysis.rowsCompanyOnly).toBeGreaterThan(0);
  });

  it("should parse companies correctly from a file with a title row", () => {
    const buf = makeExcel([
      ["Australia Drilling Contractors (Tier 1 & Tier 2) - RC / Waterwell Focus"],
      ["Tier", "Company", "Company Domain", "Ownership", "Location"],
      ["Tier 1", "Ausdrill", "https://www.ausdrill.com.au/", "Perenti", "Perth"],
      ["Tier 1", "BWE Drilling", "https://www.bwedrilling.com.au/", "Dynamic Group", "Perth"],
    ]);

    const preview = previewImportFile(buf);
    const companies = parseCompanyList(buf, preview.detectedMapping);

    expect(companies.totalParsed).toBe(2);
    expect(companies.companies[0].company).toBe("Ausdrill");
    expect(companies.companies[0].domain).toBe("ausdrill.com.au");
    expect(companies.companies[1].company).toBe("BWE Drilling");
  });
});

// ── Duplicate Column Guard ──

describe("Duplicate column guard", () => {
  it("should not map two fields to the same column", () => {
    const buf = makeExcel([
      ["Name", "Company", "Email", "Phone"],
      ["John Smith", "BHP", "john@bhp.com", "0412345678"],
    ]);

    const preview = previewImportFile(buf);

    // Collect all mapped column indices
    const mappedCols = Object.values(preview.detectedMapping).filter(
      (v) => v !== undefined
    ) as number[];
    const uniqueCols = new Set(mappedCols);

    // No duplicates
    expect(mappedCols.length).toBe(uniqueCols.size);
  });

  it("should correctly map Company and Company Domain to different fields", () => {
    const buf = makeExcel([
      ["Company", "Company Domain", "Location"],
      ["Ausdrill", "ausdrill.com.au", "Perth"],
    ]);

    const preview = previewImportFile(buf);

    // Company should map to company field, Company Domain to website field
    expect(preview.detectedMapping.company).toBeDefined();
    expect(preview.detectedMapping.website).toBeDefined();
    expect(preview.detectedMapping.company).not.toBe(preview.detectedMapping.website);
  });
});

// ── fullName Pattern Strictness ──

describe("fullName pattern strictness", () => {
  it("should NOT match 'Company Name' as fullName", () => {
    const buf = makeExcel([
      ["Company Name", "Domain", "Location"],
      ["Ausdrill", "ausdrill.com.au", "Perth"],
    ]);

    const preview = previewImportFile(buf);

    // "Company Name" should match company, not fullName
    expect(preview.detectedMapping.fullName).toBeUndefined();
    expect(preview.detectedMapping.company).toBeDefined();
  });

  it("should match 'Name' as fullName when no other name fields exist", () => {
    const buf = makeExcel([
      ["Name", "Email", "Phone"],
      ["John Smith", "john@bhp.com", "0412345678"],
    ]);

    const preview = previewImportFile(buf);
    expect(preview.detectedMapping.fullName).toBeDefined();
  });

  it("should match 'Full Name' as fullName", () => {
    const buf = makeExcel([
      ["Full Name", "Company", "Email"],
      ["John Smith", "BHP", "john@bhp.com"],
    ]);

    const preview = previewImportFile(buf);
    expect(preview.detectedMapping.fullName).toBeDefined();
  });

  it("should NOT match 'Account Name' as fullName", () => {
    const buf = makeExcel([
      ["Account Name", "Domain"],
      ["Ausdrill", "ausdrill.com.au"],
    ]);

    const preview = previewImportFile(buf);
    // "Account Name" should match company, not fullName
    expect(preview.detectedMapping.fullName).toBeUndefined();
    expect(preview.detectedMapping.company).toBeDefined();
  });
});
