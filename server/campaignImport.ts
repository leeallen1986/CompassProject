/**
 * campaignImport.ts — Parse the Blast & Paint contact list Excel file
 * and return structured rows ready for campaign import.
 */

import * as XLSX from "xlsx";
import type { RawContactRow } from "./campaignService";

/**
 * Parse the Blast_Paint_contact_list_checked.xlsx file.
 * Uses the Report_checked sheet which has clean company names and review statuses.
 */
export function parseBlastContactList(buffer: Buffer): RawContactRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets["Report_checked"];
  if (!sheet) throw new Error("Report_checked sheet not found in workbook");

  // Get all rows as JSON
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { header: 1, defval: null });

  const contacts: RawContactRow[] = [];

  // Skip header row (index 0)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as any[];
    if (!row || row.length === 0) continue;

    // Column mapping from Report_checked:
    // A(0): First Name
    // B(1): Last Name
    // C(2): Title
    // D(3): Company (raw with ** formatting)
    // E(4): Phone
    // F(5): Mobile
    // G(6): Email (column `.1`)
    // H-I(7-8): Additional email columns
    // J(9): Clean company name
    // K(10): Reviewed current/company name
    // L(11): Name check status
    // M(12): Review notes

    const firstName = cleanString(row[0]);
    const lastName = cleanString(row[1]);
    const title = cleanString(row[2]);
    const rawCompany = cleanString(row[3]) || "";
    const phone = cleanString(row[4]);
    const mobile = cleanString(row[5]);
    const email = cleanString(row[6]);
    const cleanCompany = cleanString(row[9]) || rawCompany;
    const reviewedCompanyName = cleanString(row[10]) || cleanCompany;
    const nameCheckStatus = cleanString(row[11]);
    const reviewNotes = cleanString(row[12]);

    // Skip completely empty rows
    if (!firstName && !lastName && !rawCompany) continue;

    contacts.push({
      firstName,
      lastName,
      title,
      company: cleanCompany,
      reviewedCompanyName,
      phone,
      mobile,
      email,
      nameCheckStatus,
      reviewNotes,
      sourceRow: i + 1, // 1-indexed to match Excel row numbers
    });
  }

  return contacts;
}

function cleanString(val: any): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s === "" || s === "-" || s === "--") return null;
  return s;
}
