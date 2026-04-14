import * as XLSX from "xlsx";
import { parseCompanyList, analyseImportFile, previewImportFile } from "./server/campaignCsvImport.ts";

// Simulate the exact file structure from the screenshot
// Row 0: Title row — "Australia Drilling Contractors (Tier 1 & Tier 2) – RC / Waterwell Focus"
// Row 1: Headers — "Tier", "Company", "Company Domain", "Ownership", "Location"
// Row 2+: Data

const wb = XLSX.utils.book_new();

// Create with AOA (array of arrays) to simulate the exact structure
const data = [
  ["Australia Drilling Contractors (Tier 1 & Tier 2) – RC / Waterwell Focus", "", "", "", "", "", ""],
  ["Tier", "Company", "Company Domain", "Ownership", "Location", "Key Services", "Notes"],
  ["Tier 1", "Ausdrill", "https://www.ausdrill.com.au/", "Perenti", "Perth, WA", "RC Drilling, Exploration", "Major player"],
  ["Tier 1", "BWE Drilling", "https://www.bwedrilling.com.au/", "Dynamic Group", "Perth, WA", "Water Well", ""],
  ["Tier 1", "DDH1 Drilling", "https://www.ddh1.com.au/", "Listed", "Perth, WA", "RC, Diamond", ""],
  ["Tier 2", "Raglan Drilling", "https://www.raglandrilling.com.au/", "Private", "Kalgoorlie, WA", "RC Drilling", ""],
];

const ws = XLSX.utils.aoa_to_sheet(data);

// Also try with merged cells (like Excel might do for a title row)
// ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];

XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

console.log("=== Testing with simulated XLSX ===");

// Test 1: detectHeaderRow
const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
console.log("\nRow 0:", JSON.stringify(allRows[0]));
console.log("Row 1:", JSON.stringify(allRows[1]));
console.log("Row 0 non-empty cells:", allRows[0].filter(c => String(c ?? "").trim() !== "").length);
console.log("Row 1 non-empty cells:", allRows[1].filter(c => String(c ?? "").trim() !== "").length);

// Test 2: previewImportFile
console.log("\n=== previewImportFile ===");
const preview = previewImportFile(buffer);
console.log("Detected mapping:", JSON.stringify(preview.detectedMapping));
console.log("Total rows:", preview.totalRows);

// Test 3: analyseImportFile with empty mapping (what the UI sends)
console.log("\n=== analyseImportFile with empty mapping ===");
const analysis = analyseImportFile(buffer, {});
console.log("Analysis:", JSON.stringify(analysis));

// Test 4: parseCompanyList with empty mapping (what the UI sends)
console.log("\n=== parseCompanyList with empty mapping ===");
const parsed = parseCompanyList(buffer, {});
console.log("Companies found:", parsed.companies.length);
console.log("Skipped:", parsed.skipped);
console.log("Errors:", parsed.errors);
if (parsed.companies.length > 0) {
  console.log("First company:", JSON.stringify(parsed.companies[0]));
}

// Test 5: Now try with merged cells
console.log("\n=== Testing with MERGED title cell ===");
const wb2 = XLSX.utils.book_new();
const ws2 = XLSX.utils.aoa_to_sheet(data);
ws2['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
XLSX.utils.book_append_sheet(wb2, ws2, "Sheet1");
const buffer2 = Buffer.from(XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }));

const preview2 = previewImportFile(buffer2);
console.log("Detected mapping (merged):", JSON.stringify(preview2.detectedMapping));

const analysis2 = analyseImportFile(buffer2, {});
console.log("Analysis (merged):", JSON.stringify(analysis2));

const parsed2 = parseCompanyList(buffer2, {});
console.log("Companies found (merged):", parsed2.companies.length);
if (parsed2.companies.length > 0) {
  console.log("First company (merged):", JSON.stringify(parsed2.companies[0]));
}

// Test 6: Try with title row having only 1 non-empty cell (as it would be in the real file)
console.log("\n=== Testing with single-cell title row ===");
const data3 = [
  ["Australia Drilling Contractors (Tier 1 & Tier 2) – RC / Waterwell Focus"],
  ["Tier", "Company", "Company Domain", "Ownership", "Location", "Key Services", "Notes"],
  ["Tier 1", "Ausdrill", "https://www.ausdrill.com.au/", "Perenti", "Perth, WA", "RC Drilling", "Major player"],
  ["Tier 1", "BWE Drilling", "https://www.bwedrilling.com.au/", "Dynamic Group", "Perth, WA", "Water Well", ""],
];
const wb3 = XLSX.utils.book_new();
const ws3 = XLSX.utils.aoa_to_sheet(data3);
XLSX.utils.book_append_sheet(wb3, ws3, "Sheet1");
const buffer3 = Buffer.from(XLSX.write(wb3, { type: "buffer", bookType: "xlsx" }));

const preview3 = previewImportFile(buffer3);
console.log("Detected mapping (single-cell):", JSON.stringify(preview3.detectedMapping));

const analysis3 = analyseImportFile(buffer3, {});
console.log("Analysis (single-cell):", JSON.stringify(analysis3));

const parsed3 = parseCompanyList(buffer3, {});
console.log("Companies found (single-cell):", parsed3.companies.length);
if (parsed3.companies.length > 0) {
  console.log("First company (single-cell):", JSON.stringify(parsed3.companies[0]));
}
