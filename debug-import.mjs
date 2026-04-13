import * as XLSX from "xlsx";

// Simulate the exact file structure from the screenshot
// Row 0: Title row (single merged cell spanning the whole row)
// Row 1: Headers (Tier, Company, Company Domain, Ownership, Location)
// Row 2+: Data

// The key insight: in Excel, a merged cell in row 0 might appear as
// multiple cells in the XLSX.utils.sheet_to_json output

// Create a workbook that mimics the real file
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ["Australia Drilling Contractors (Tier 1 & Tier 2) – RC / Waterwell Focus"],
  ["Tier", "Company", "Company Domain", "Ownership", "Location"],
  ["Tier 1", "Ausdrill", "https://www.ausdrill.com.au/", "Perenti", "Perth"],
  ["Tier 1", "BWE Drilling", "https://www.bwedrilling.com.au/", "Dynamic Group", "Perth"],
]);
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
const buf = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

// Now parse it back exactly as the server does
const workbook = XLSX.read(buf, { type: "buffer" });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

console.log("=== All rows ===");
allRows.forEach((row, i) => {
  const cells = row.filter(c => String(c ?? "").trim() !== "").length;
  console.log(`Row ${i}: ${cells} non-empty cells → ${JSON.stringify(row)}`);
});

// Test detectHeaderRow logic
const row0Cells = allRows[0].filter(c => String(c ?? "").trim() !== "").length;
const row1Cells = allRows[1].filter(c => String(c ?? "").trim() !== "").length;
console.log(`\n=== Title-row detection ===`);
console.log(`Row 0 non-empty cells: ${row0Cells}`);
console.log(`Row 1 non-empty cells: ${row1Cells}`);
console.log(`row0Cells <= 2: ${row0Cells <= 2}`);
console.log(`row1Cells >= 3: ${row1Cells >= 3}`);
console.log(`row1Cells > row0Cells * 2: ${row1Cells > row0Cells * 2}`);
const headerRowIdx = (row0Cells <= 2 && row1Cells >= 3 && row1Cells > row0Cells * 2) ? 1 : 0;
console.log(`Detected header row: ${headerRowIdx}`);

const headers = allRows[headerRowIdx].map(h => String(h).trim());
console.log(`\nHeaders: ${JSON.stringify(headers)}`);

// Test column pattern matching
const COLUMN_PATTERNS = {
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

const detectedMapping = {};
const usedColumns = new Set();
for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
  for (let i = 0; i < headers.length; i++) {
    if (usedColumns.has(i)) continue;
    if (patterns.some(p => p.test(headers[i]))) {
      detectedMapping[field] = i;
      usedColumns.add(i);
      console.log(`  Mapped: ${field} → column ${i} (header: "${headers[i]}")`);
      break;
    }
  }
}

console.log(`\nDetected mapping: ${JSON.stringify(detectedMapping)}`);

// Now test analyseImportFile logic
let rowsWithNames = 0;
let rowsCompanyOnly = 0;
const dataRows = allRows.slice(headerRowIdx + 1);
for (const row of dataRows) {
  if (!row || row.every(c => !String(c).trim())) continue;
  let hasName = false;
  if (detectedMapping.firstName !== undefined && row[detectedMapping.firstName]?.toString().trim()) hasName = true;
  if (detectedMapping.lastName !== undefined && row[detectedMapping.lastName]?.toString().trim()) hasName = true;
  if (detectedMapping.fullName !== undefined && row[detectedMapping.fullName]?.toString().trim()) hasName = true;
  
  const hasCompany = detectedMapping.company !== undefined && !!row[detectedMapping.company]?.toString().trim();
  const hasEmail = detectedMapping.email !== undefined && !!row[detectedMapping.email]?.toString().trim();
  
  if (hasName || hasEmail) {
    rowsWithNames++;
  } else if (hasCompany) {
    rowsCompanyOnly++;
  }
}

const totalRows = dataRows.length;
const nonEmpty = rowsWithNames + rowsCompanyOnly;
const type = nonEmpty > 0 && rowsCompanyOnly / nonEmpty > 0.6 ? "companies" : "contacts";

console.log(`\n=== Analysis ===`);
console.log(`rowsWithNames: ${rowsWithNames}`);
console.log(`rowsCompanyOnly: ${rowsCompanyOnly}`);
console.log(`totalRows: ${totalRows}`);
console.log(`File type: ${type}`);
