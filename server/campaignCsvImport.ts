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

// ── Column Detection ──

/** Known header patterns for auto-detecting column mapping */
const COLUMN_PATTERNS: Record<keyof ColumnMapping, RegExp[]> = {
  firstName: [/^first\s*name$/i, /^first$/i, /^given\s*name$/i, /^fname$/i, /^contact\s*first/i],
  lastName: [/^last\s*name$/i, /^last$/i, /^surname$/i, /^family\s*name$/i, /^lname$/i, /^contact\s*last/i],
  fullName: [/^(full\s*)?name$/i, /^contact\s*name$/i, /^person$/i, /^contact$/i],
  title: [/^title$/i, /^job\s*title$/i, /^position$/i, /^role$/i, /^designation$/i],
  company: [/^company$/i, /^organization$/i, /^organisation$/i, /^employer$/i, /^account\s*name$/i, /^company\s*name$/i],
  email: [/^e?\s*-?\s*mail$/i, /^email\s*address$/i, /^e-mail$/i, /^contact\s*email$/i],
  phone: [/^phone$/i, /^telephone$/i, /^tel$/i, /^phone\s*number$/i, /^work\s*phone$/i, /^office\s*phone$/i],
  mobile: [/^mobile$/i, /^cell$/i, /^mobile\s*phone$/i, /^cell\s*phone$/i],
  linkedin: [/^linkedin$/i, /^linkedin\s*url$/i, /^linkedin\s*profile$/i, /^li\s*url$/i],
  website: [/^website$/i, /^web$/i, /^url$/i, /^company\s*website$/i, /^domain$/i],
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

  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
  if (rows.length === 0) throw new Error("File is empty");

  // First row is headers
  const headers = rows[0].map(h => String(h).trim());
  const sampleRows = rows.slice(1, 6).map(r => r.map(c => String(c ?? "").trim()));

  // Auto-detect column mapping
  const detectedMapping: ColumnMapping = {};
  for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
    for (let i = 0; i < headers.length; i++) {
      if (patterns.some(p => p.test(headers[i]))) {
        (detectedMapping as any)[field] = i;
        break;
      }
    }
  }

  return {
    headers,
    sampleRows,
    totalRows: rows.length - 1,
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

  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
  if (rows.length <= 1) return { contacts: [], totalParsed: 0, skipped: 0, errors: [] };

  const contacts: RawContactRow[] = [];
  const errors: string[] = [];
  let skipped = 0;

  // Skip header row
  for (let i = 1; i < rows.length; i++) {
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
