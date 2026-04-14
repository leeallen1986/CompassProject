/**
 * campaignCsvImport.ts — Generic CSV/Excel parser for campaign contact imports
 *
 * Supports:
 * - CSV files (comma, semicolon, tab delimited)
 * - Excel files (.xlsx, .xls)
 * - Automatic column detection via header matching
 * - Manual column mapping override
 * - Preview mode (returns first N rows for user confirmation)
 */

import * as XLSX from "xlsx";
import type { RawContactRow } from "./campaignService";

// ── Company-only row type ──

export interface CompanyRow {
  company: string;
  domain: string | null;
  /** Optional extra columns from the spreadsheet */
  location: string | null;
  notes: string | null;
  sourceRow: number;
}

export interface ParsedCompanies {
  companies: CompanyRow[];
  totalParsed: number;
  skipped: number;
  errors: string[];
}

/** Result of analysing an uploaded file to determine its type */
export interface FileAnalysis {
  type: "contacts" | "companies";
  /** How many rows have individual names */
  rowsWithNames: number;
  /** How many rows have company/domain but no name */
  rowsCompanyOnly: number;
  totalRows: number;
}

// ── Column Detection ──

/** Known header patterns for auto-detecting column mapping */
/** Known header patterns for company-list columns */
const COMPANY_LIST_PATTERNS: Record<string, RegExp[]> = {
  company: [/^company$/i, /^organization$/i, /^organisation$/i, /^employer$/i, /^account\s*name$/i, /^company\s*name$/i, /^business$/i, /^name$/i],
  domain: [/^domain$/i, /^website$/i, /^web$/i, /^url$/i, /^company\s*website$/i, /^company\s*domain$/i, /^site$/i],
  location: [/^location$/i, /^city$/i, /^state$/i, /^region$/i, /^country$/i, /^address$/i, /^hq$/i],
  notes: [/^notes?$/i, /^comment/i, /^description$/i, /^details?$/i, /^info$/i],
};

const COLUMN_PATTERNS: Record<keyof ColumnMapping, RegExp[]> = {
  firstName: [/^first\s*name$/i, /^first$/i, /^given\s*name$/i, /^fname$/i, /^contact\s*first/i],
  lastName: [/^last\s*name$/i, /^last$/i, /^surname$/i, /^family\s*name$/i, /^lname$/i, /^contact\s*last/i],
  fullName: [/^full\s*name$/i, /^contact\s*name$/i, /^person\s*name$/i, /^person$/i, /^name$/i],
  title: [/^title$/i, /^job\s*title$/i, /^position$/i, /^role$/i, /^designation$/i],
  company: [/^company$/i, /^organization$/i, /^organisation$/i, /^employer$/i, /^account\s*name$/i, /^company\s*name$/i],
  email: [/^e?\s*-?\s*mail$/i, /^email\s*address$/i, /^e-mail$/i, /^contact\s*email$/i],
  phone: [/^phone$/i, /^telephone$/i, /^tel$/i, /^phone\s*number$/i, /^work\s*phone$/i, /^office\s*phone$/i],
  mobile: [/^mobile$/i, /^cell$/i, /^mobile\s*phone$/i, /^cell\s*phone$/i],
  linkedin: [/^linkedin$/i, /^linkedin\s*url$/i, /^linkedin\s*profile$/i, /^li\s*url$/i],
  website: [/^website$/i, /^web$/i, /^url$/i, /^company\s*website$/i, /^company\s*domain$/i, /^domain$/i],
};

export interface ColumnMapping {
  firstName?: number;
  lastName?: number;
  fullName?: number;
  title?: number;
  company?: number;
  email?: number;
  phone?: number;
  mobile?: number;
  linkedin?: number;
  website?: number;
}

export interface ParsedPreview {
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  detectedMapping: ColumnMapping;
  sheetNames?: string[];
}

export interface ParsedContacts {
  contacts: RawContactRow[];
  totalParsed: number;
  skipped: number;
  errors: string[];
}

/**
 * Parse a file buffer (CSV or Excel) and return a preview with auto-detected column mapping.
 */
export function previewImportFile(
  buffer: Buffer,
  options?: { sheetName?: string; delimiter?: string }
): ParsedPreview {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetNames = workbook.SheetNames;
  const sheetName = options?.sheetName || sheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

  const allRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
  if (allRows.length === 0) throw new Error("File is empty");

  const headerRowIdx = detectHeaderRow(allRows);

  const headers = allRows[headerRowIdx].map(h => String(h).trim());
  const dataRows = allRows.slice(headerRowIdx + 1);
  const sampleRows = dataRows.slice(0, 5).map(r => r.map(c => String(c ?? "").trim()));

  // Auto-detect column mapping with duplicate guard — each column can only be assigned once
  const detectedMapping: ColumnMapping = {};
  const usedColumns = new Set<number>();
  for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
    for (let i = 0; i < headers.length; i++) {
      if (usedColumns.has(i)) continue; // skip already-assigned columns
      if (patterns.some(p => p.test(headers[i]))) {
        (detectedMapping as any)[field] = i;
        usedColumns.add(i);
        break;
      }
    }
  }

  return {
    headers,
    sampleRows,
    totalRows: dataRows.length,
    detectedMapping,
    sheetNames: sheetNames.length > 1 ? sheetNames : undefined,
  };
}

/**
 * Parse a file buffer using the provided column mapping and return structured contacts.
 */
export function parseImportFile(
  buffer: Buffer,
  mapping: ColumnMapping,
  options?: { sheetName?: string }
): ParsedContacts {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = options?.sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

  const allRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
  if (allRows.length <= 1) return { contacts: [], totalParsed: 0, skipped: 0, errors: [] };

  const headerRowIdx = detectHeaderRow(allRows);
  const rows = allRows; // keep original indexing for sourceRow

  const contacts: RawContactRow[] = [];
  const errors: string[] = [];
  let skipped = 0;

  // Skip header row(s)
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !String(c).trim())) {
      skipped++;
      continue;
    }

    try {
      let firstName: string | null = null;
      let lastName: string | null = null;

      // Handle full name vs first/last name
      if (mapping.fullName !== undefined) {
        const fullName = clean(row[mapping.fullName]);
        if (fullName) {
          const parts = fullName.split(/\s+/);
          firstName = parts[0] || null;
          lastName = parts.slice(1).join(" ") || null;
        }
      }
      if (mapping.firstName !== undefined) firstName = clean(row[mapping.firstName]);
      if (mapping.lastName !== undefined) lastName = clean(row[mapping.lastName]);

      const company = clean(row[mapping.company ?? -1]) || "";
      const email = clean(row[mapping.email ?? -1]);
      const title = clean(row[mapping.title ?? -1]);
      const phone = clean(row[mapping.phone ?? -1]);
      const mobile = clean(row[mapping.mobile ?? -1]);

      // Skip rows with no name and no company
      if (!firstName && !lastName && !company) {
        skipped++;
        continue;
      }

      contacts.push({
        firstName,
        lastName,
        title,
        company,
        reviewedCompanyName: null,
        phone,
        mobile,
        email,
        nameCheckStatus: null,
        reviewNotes: null,
        sourceRow: i + 1,
      });
    } catch (err) {
      errors.push(`Row ${i + 1}: ${(err as Error).message}`);
      skipped++;
    }
  }

  return { contacts, totalParsed: contacts.length, skipped, errors };
}

function clean(val: any): string | null {
  if (val === null || val === undefined || val === -1) return null;
  const s = String(val).trim();
  if (s === "" || s === "-" || s === "--" || s === "N/A" || s === "n/a") return null;
  return s;
}

/**
 * Detect whether row 0 is a title/label row rather than a real header row.
 * Returns the index of the actual header row (0 or 1).
 */
function detectHeaderRow(allRows: any[][]): number {
  if (allRows.length < 2) return 0;
  const row0Cells = allRows[0].filter(c => String(c ?? "").trim() !== "").length;
  if (allRows.length < 3) return 0;
  const row1Cells = allRows[1].filter(c => String(c ?? "").trim() !== "").length;
  // If row 0 has 1-2 non-empty cells and row 1 has significantly more, row 0 is a title
  if (row0Cells <= 2 && row1Cells >= 3 && row1Cells > row0Cells * 2) {
    return 1;
  }
  // Also check: if row 0 matches zero known patterns but row 1 matches at least 2, row 0 is a title
  const allPatterns = [...Object.values(COLUMN_PATTERNS).flat(), ...Object.values(COMPANY_LIST_PATTERNS).flat()];
  const row0Headers = allRows[0].map(c => String(c ?? "").trim());
  const row1Headers = allRows[1].map(c => String(c ?? "").trim());
  const row0Matches = row0Headers.filter(h => h && allPatterns.some(p => p.test(h))).length;
  const row1Matches = row1Headers.filter(h => h && allPatterns.some(p => p.test(h))).length;
  if (row0Matches === 0 && row1Matches >= 2) {
    return 1;
  }
  return 0;
}

/**
 * Analyse a file to determine if it contains individual contacts or company-only rows.
 * Returns a FileAnalysis with type="companies" when most rows lack individual names.
 */
export function analyseImportFile(
  buffer: Buffer,
  mapping: ColumnMapping,
  options?: { sheetName?: string }
): FileAnalysis {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = options?.sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

  const allRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
  if (allRows.length <= 1) return { type: "contacts", rowsWithNames: 0, rowsCompanyOnly: 0, totalRows: 0 };

  const headerRowIdx = detectHeaderRow(allRows);
  const headers = allRows[headerRowIdx].map(h => String(h).trim());
  const rows = allRows;

  // If the provided mapping is empty (no columns detected), do our own detection
  // using both COLUMN_PATTERNS and COMPANY_LIST_PATTERNS
  let effectiveMapping = mapping;
  const mappingHasFields = Object.values(mapping).some(v => v !== undefined);
  if (!mappingHasFields) {
    const autoMapping: ColumnMapping = {};
    const usedColumns = new Set<number>();
    // First try COLUMN_PATTERNS
    for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
      for (let i = 0; i < headers.length; i++) {
        if (usedColumns.has(i)) continue;
        if (patterns.some(p => p.test(headers[i]))) {
          (autoMapping as any)[field] = i;
          usedColumns.add(i);
          break;
        }
      }
    }
    // Also try COMPANY_LIST_PATTERNS to detect company/domain columns
    for (const [field, patterns] of Object.entries(COMPANY_LIST_PATTERNS)) {
      const mappedField = field === "domain" ? "website" : field === "company" ? "company" : null;
      if (!mappedField || autoMapping[mappedField as keyof ColumnMapping] !== undefined) continue;
      for (let i = 0; i < headers.length; i++) {
        if (usedColumns.has(i)) continue;
        if (patterns.some(p => p.test(headers[i]))) {
          (autoMapping as any)[mappedField] = i;
          usedColumns.add(i);
          break;
        }
      }
    }
    effectiveMapping = autoMapping;
  }

  let rowsWithNames = 0;
  let rowsCompanyOnly = 0;

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !String(c).trim())) continue;

    let hasName = false;
    if (effectiveMapping.firstName !== undefined && clean(row[effectiveMapping.firstName])) hasName = true;
    if (effectiveMapping.lastName !== undefined && clean(row[effectiveMapping.lastName])) hasName = true;
    if (effectiveMapping.fullName !== undefined && clean(row[effectiveMapping.fullName])) hasName = true;

    const hasCompany = effectiveMapping.company !== undefined && !!clean(row[effectiveMapping.company]);
    const hasEmail = effectiveMapping.email !== undefined && !!clean(row[effectiveMapping.email]);

    if (hasName || hasEmail) {
      rowsWithNames++;
    } else if (hasCompany) {
      rowsCompanyOnly++;
    }
  }

  const totalRows = rows.length - (headerRowIdx + 1);
  // If more than 60% of non-empty rows are company-only, treat as company list
  const nonEmpty = rowsWithNames + rowsCompanyOnly;
  const type = nonEmpty > 0 && rowsCompanyOnly / nonEmpty > 0.6 ? "companies" : "contacts";

  return { type, rowsWithNames, rowsCompanyOnly, totalRows };
}

/**
 * Parse a file as a company list — extracts company names and domains.
 * Used when the file has company/domain columns but no individual contact names.
 */
export function parseCompanyList(
  buffer: Buffer,
  mapping: ColumnMapping,
  options?: { sheetName?: string }
): ParsedCompanies {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = options?.sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

  const allRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
  if (allRows.length <= 1) return { companies: [], totalParsed: 0, skipped: 0, errors: [] };

  // Helper: try to parse companies starting from a given header row
  const tryParseFromRow = (headerIdx: number): ParsedCompanies => {
    const headers = allRows[headerIdx].map(h => String(h).trim());
    const clm: Record<string, number | undefined> = {};
    const usedCols = new Set<number>();
    // Match COMPANY_LIST_PATTERNS
    for (const [field, patterns] of Object.entries(COMPANY_LIST_PATTERNS)) {
      for (let i = 0; i < headers.length; i++) {
        if (usedCols.has(i)) continue;
        if (patterns.some(p => p.test(headers[i]))) {
          clm[field] = i;
          usedCols.add(i);
          break;
        }
      }
    }
    // Also try COLUMN_PATTERNS for company/website
    for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
      if (field !== "company" && field !== "website") continue;
      const clmField = field === "website" ? "domain" : field;
      if (clm[clmField] !== undefined) continue;
      for (let i = 0; i < headers.length; i++) {
        if (usedCols.has(i)) continue;
        if (patterns.some(p => p.test(headers[i]))) {
          clm[clmField] = i;
          usedCols.add(i);
          break;
        }
      }
    }

    const companyCol = mapping.company ?? clm.company;
    const domainCol = mapping.website ?? clm.domain;
    const locationCol = clm.location;
    const notesCol = clm.notes;

    const companies: CompanyRow[] = [];
    const errors: string[] = [];
    let skipped = 0;

    for (let i = headerIdx + 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row || row.every(c => !String(c).trim())) { skipped++; continue; }
      try {
        const company = clean(row[companyCol ?? -1]);
        const rawDomain = clean(row[domainCol ?? -1]);
        if (!company && !rawDomain) { skipped++; continue; }
        let domain = rawDomain;
        if (domain) {
          domain = domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./i, "").trim();
        }
        companies.push({
          company: company || domain || "",
          domain,
          location: clean(row[locationCol ?? -1]),
          notes: clean(row[notesCol ?? -1]),
          sourceRow: i + 1,
        });
      } catch (err) {
        errors.push(`Row ${i + 1}: ${(err as Error).message}`);
        skipped++;
      }
    }
    return { companies, totalParsed: companies.length, skipped, errors };
  };

  // Strategy 1: Use detectHeaderRow
  const primaryIdx = detectHeaderRow(allRows);
  const primaryResult = tryParseFromRow(primaryIdx);
  console.log(`[parseCompanyList] primary headerRow=${primaryIdx}, found=${primaryResult.companies.length}`);

  if (primaryResult.companies.length > 0) return primaryResult;

  // Strategy 2: If primary failed, try rows 0-4 as potential header rows
  // Pick the one that yields the most companies
  let bestResult = primaryResult;
  const maxTry = Math.min(allRows.length - 1, 5);
  for (let candidate = 0; candidate < maxTry; candidate++) {
    if (candidate === primaryIdx) continue;
    const result = tryParseFromRow(candidate);
    console.log(`[parseCompanyList] fallback headerRow=${candidate}, found=${result.companies.length}`);
    if (result.companies.length > bestResult.companies.length) {
      bestResult = result;
    }
  }

  if (bestResult.companies.length > 0) return bestResult;

  // Strategy 3: Last resort — scan every column for URL-like values (domains)
  // and treat the column with the most URLs as the domain column
  console.log(`[parseCompanyList] all strategies failed, trying URL scan`);
  const dataStartIdx = primaryIdx + 1;
  if (dataStartIdx < allRows.length) {
    const numCols = Math.max(...allRows.slice(dataStartIdx, dataStartIdx + 10).map(r => r.length));
    let bestDomainCol = -1;
    let bestDomainCount = 0;
    const urlPattern = /\.(com|net|org|au|co|io|gov|edu|uk|nz)/i;
    for (let col = 0; col < numCols; col++) {
      let count = 0;
      for (let row = dataStartIdx; row < Math.min(allRows.length, dataStartIdx + 20); row++) {
        const val = String(allRows[row]?.[col] ?? "").trim();
        if (val && urlPattern.test(val)) count++;
      }
      if (count > bestDomainCount) { bestDomainCount = count; bestDomainCol = col; }
    }

    if (bestDomainCol >= 0 && bestDomainCount >= 2) {
      // Find a company name column — the text column immediately before the domain column, or any column with diverse text values
      let companyCol = bestDomainCol > 0 ? bestDomainCol - 1 : -1;
      const companies: CompanyRow[] = [];
      const errors: string[] = [];
      let skipped = 0;
      for (let i = dataStartIdx; i < allRows.length; i++) {
        const row = allRows[i];
        if (!row || row.every(c => !String(c).trim())) { skipped++; continue; }
        try {
          const company = companyCol >= 0 ? clean(row[companyCol]) : null;
          const rawDomain = clean(row[bestDomainCol]);
          if (!company && !rawDomain) { skipped++; continue; }
          let domain = rawDomain;
          if (domain) {
            domain = domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./i, "").trim();
          }
          companies.push({ company: company || domain || "", domain, location: null, notes: null, sourceRow: i + 1 });
        } catch (err) {
          errors.push(`Row ${i + 1}: ${(err as Error).message}`);
          skipped++;
        }
      }
      console.log(`[parseCompanyList] URL scan: domainCol=${bestDomainCol}, companyCol=${companyCol}, found=${companies.length}`);
      if (companies.length > 0) return { companies, totalParsed: companies.length, skipped, errors };
    }
  }

  return { companies: [], totalParsed: 0, skipped: 0, errors: ["Could not detect company or domain columns in the file"] };
}
