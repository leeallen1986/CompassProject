import { readFileSync } from "fs";
import { previewImportFile, analyseImportFile, parseCompanyList } from "./server/campaignCsvImport.ts";

const buffer = readFileSync("/home/ubuntu/upload/pasted_file_6ZLeqO_Company_Names_Deduped.csv");

console.log("=== Step 1: Preview ===");
try {
  const preview = previewImportFile(buffer);
  console.log("Headers:", preview.headers);
  console.log("Sample rows:", preview.sampleRows.slice(0, 3));
  console.log("Total rows:", preview.totalRows);
  console.log("Detected mapping:", preview.detectedMapping);

  console.log("\n=== Step 2: Analyse (is it contacts or companies?) ===");
  const analysis = analyseImportFile(buffer, preview.detectedMapping);
  console.log("Type:", analysis.type);
  console.log("Rows with names:", analysis.rowsWithNames);
  console.log("Rows company only:", analysis.rowsCompanyOnly);
  console.log("Total rows:", analysis.totalRows);

  console.log("\n=== Step 3: Parse as company list ===");
  const parsed = parseCompanyList(buffer, preview.detectedMapping);
  console.log("Companies parsed:", parsed.totalParsed);
  console.log("Skipped:", parsed.skipped);
  console.log("Errors:", parsed.errors);
  console.log("First 5 companies:", parsed.companies.slice(0, 5));
  console.log("Companies with domain:", parsed.companies.filter(c => c.domain).length);
  console.log("Companies without domain:", parsed.companies.filter(c => !c.domain).length);
} catch (err) {
  console.error("ERROR:", err);
}
