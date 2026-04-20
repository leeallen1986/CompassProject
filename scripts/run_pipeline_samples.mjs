/**
 * run_pipeline_samples.mjs
 *
 * Runs the ingestion pipeline on 3 sample files and captures exact staged JSON
 * for all 10 required validation cases.
 *
 * Run with: node scripts/run_pipeline_samples.mjs
 */

import { runIngestionPipeline } from "../server/ingestionService.ts";
import { writeFileSync } from "fs";

// ─────────────────────────────────────────────────────────────────────────────
// Sample File 1: Mixed CRM Export
// Contains: James Wilson Jr., SARAH CHEN, David Kumar (retired), blank row, N/A row
// ─────────────────────────────────────────────────────────────────────────────
const crmExportCsv = `Full Name,Job Title,Organization,Email,Phone,Notes
James Wilson Jr.,Site Manager,BHP Group Pty Ltd,j.wilson@bhp.com,0412 345 678,Key contact for WAIO expansion
SARAH CHEN,PROCUREMENT MANAGER,Rio Tinto Limited,s.chen@riotinto.com,0423 456 789,
David Kumar (retired),Former Project Director,Thiess Pty Ltd,d.kumar@thiess.com.au,,Retired Q3 2023 - do not contact before Q3 2024
,,,,, 
N/A,N/A,N/A,,,
test@test.com,Test,Test Company,,, 
James Wilson Jr.,Site Manager,BHP Group Pty Ltd,j.wilson@bhp.com,,Duplicate of row 2
info@cimic.com.au,Business Development,CIMIC Group / UGL Joint Venture,,, 
`;

// ─────────────────────────────────────────────────────────────────────────────
// Sample File 2: Contact-Led File (split first/last name)
// ─────────────────────────────────────────────────────────────────────────────
const contactSplitCsv = `First Name,Last Name,Title,Company,Email,Mobile,LinkedIn
James,Wilson,Site Manager,BHP Group Pty Ltd,j.wilson@bhp.com,0412345678,https://linkedin.com/in/jameswilson
Sarah,Chen,Procurement Manager,Rio Tinto Limited,s.chen@riotinto.com,0423456789,
David,Kumar,Project Director,Thiess Pty Ltd,d.kumar@thiess.com.au,,
,,,,,, 
N/A,N/A,N/A,N/A,,, 
`;

// ─────────────────────────────────────────────────────────────────────────────
// Sample File 3: Company-Only File
// Contains: BHP Group, Rio Tinto, Thiess (no contact names)
// ─────────────────────────────────────────────────────────────────────────────
const companyOnlyCsv = `Company,Website,Notes
BHP Group Pty Ltd,bhp.com,Major mining operator - WAIO expansion phase
Rio Tinto Limited,riotinto.com,Pilbara iron ore operations
Thiess Pty Ltd,thiess.com.au,Mining contractor - active on multiple projects
CIMIC Group / UGL Joint Venture,cimic.com.au,JV for infrastructure delivery
,, 
`;

// ─────────────────────────────────────────────────────────────────────────────
// Convert CSV strings to Buffers
// ─────────────────────────────────────────────────────────────────────────────
const crmBuffer = Buffer.from(crmExportCsv, "utf-8");
const contactBuffer = Buffer.from(contactSplitCsv, "utf-8");
const companyBuffer = Buffer.from(companyOnlyCsv, "utf-8");

// ─────────────────────────────────────────────────────────────────────────────
// Run pipelines
// ─────────────────────────────────────────────────────────────────────────────

// For CRM: simulate that j.wilson@bhp.com is already in the campaign (cross-batch dedup test)
const existingEmails = new Set(["j.wilson@bhp.com"]);

console.log("\n═══════════════════════════════════════════════════════");
console.log("FILE 1: Mixed CRM Export");
console.log("═══════════════════════════════════════════════════════");
const crmResult = runIngestionPipeline(crmBuffer, { existingEmails });
console.log("File type:", crmResult.fileType);
console.log("Total rows:", crmResult.totalRows);
console.log("verified_contact:", crmResult.verifiedContacts);
console.log("enrichable_contact:", crmResult.enrichableContacts);
console.log("company_target:", crmResult.companyTargets);
console.log("review_needed:", crmResult.reviewRows);
console.log("rejected:", crmResult.rejectedRows);
console.log("\nStaged rows:");
for (const row of crmResult.staged) {
  console.log(JSON.stringify(row, null, 2));
  console.log("---");
}

console.log("\n═══════════════════════════════════════════════════════");
console.log("FILE 2: Contact-Led Split Name File");
console.log("═══════════════════════════════════════════════════════");
const contactResult = runIngestionPipeline(contactBuffer);
console.log("File type:", contactResult.fileType);
console.log("Total rows:", contactResult.totalRows);
console.log("verified_contact:", contactResult.verifiedContacts);
console.log("enrichable_contact:", contactResult.enrichableContacts);
console.log("company_target:", contactResult.companyTargets);
console.log("review_needed:", contactResult.reviewRows);
console.log("rejected:", contactResult.rejectedRows);
console.log("\nStaged rows:");
for (const row of contactResult.staged) {
  console.log(JSON.stringify(row, null, 2));
  console.log("---");
}

console.log("\n═══════════════════════════════════════════════════════");
console.log("FILE 3: Company-Only File");
console.log("═══════════════════════════════════════════════════════");
const companyResult = runIngestionPipeline(companyBuffer);
console.log("File type:", companyResult.fileType);
console.log("Total rows:", companyResult.totalRows);
console.log("verified_contact:", companyResult.verifiedContacts);
console.log("enrichable_contact:", companyResult.enrichableContacts);
console.log("company_target:", companyResult.companyTargets);
console.log("review_needed:", companyResult.reviewRows);
console.log("rejected:", companyResult.rejectedRows);
console.log("\nStaged rows:");
for (const row of companyResult.staged) {
  console.log(JSON.stringify(row, null, 2));
  console.log("---");
}

// Save full JSON output
const output = {
  file1_crm_export: crmResult,
  file2_contact_split: contactResult,
  file3_company_only: companyResult,
};
writeFileSync("/home/ubuntu/pipeline_sample_outputs.json", JSON.stringify(output, null, 2));
console.log("\n✓ Full output saved to /home/ubuntu/pipeline_sample_outputs.json");
