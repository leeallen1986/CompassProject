/**
 * seedCampaign.mjs — One-time script to create the XAVS1800 Blasting Campaign
 * and import contacts from the Blast_Paint_contact_list_checked.xlsx
 *
 * Column layout (Report_checked):
 *   0: First Name, 1: Last Name, 2: Title, 3: Company (raw, bold markdown),
 *   4: Phone, 5: Mobile, 6: Email, 7-8: unused,
 *   9: Clean company name, 10: Reviewed company name, 11: Name check status,
 *   12: Review notes, 13: Source URL
 *
 * Run: node server/seedCampaign.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import XLSX from 'xlsx';
import fs from 'fs';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const url = new URL(DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname,
  port: parseInt(url.port || "3306"),
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
});

console.log("Connected to database");

// ── Step 0: Clean up any previous campaign data ──
const [existingCampaigns] = await conn.execute(
  `SELECT id FROM campaigns WHERE name = 'XAVS1800 Abrasive Blasting Campaign'`
);
for (const c of existingCampaigns) {
  await conn.execute(`DELETE FROM campaignContacts WHERE campaignId = ?`, [c.id]);
  await conn.execute(`DELETE FROM campaigns WHERE id = ?`, [c.id]);
  console.log(`Cleaned up previous campaign ID ${c.id}`);
}

// ── Step 1: Find the XAVS1800 collateral item ──
const [collateralRows] = await conn.execute(
  `SELECT id, name FROM collateralItems WHERE name LIKE '%XAVS1800%' LIMIT 1`
);
const collateralId = collateralRows.length > 0 ? collateralRows[0].id : null;
const collateralName = collateralRows.length > 0 ? collateralRows[0].name : "XAVS1800 — High-Volume Air for Demanding Blasting";
console.log(`Collateral: ${collateralName} (ID: ${collateralId})`);

// ── Step 2: Create the campaign ──
const nowDate = new Date();
await conn.execute(
  `INSERT INTO campaigns (name, description, status, collateralId, collateralName, senderName, senderEmail, senderTitle, targetSegment, createdBy, createdAt, updatedAt, totalContacts, enrichedContacts, emailsDrafted, emailsApproved, emailsSent)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0)`,
  [
    "XAVS1800 Abrasive Blasting Campaign",
    "Targeted outreach to blasting and coating companies in Australia using XAVS1800 high-volume air collateral. Contacts sourced from CRM blast/paint contact list.",
    "active",
    collateralId,
    collateralName,
    "Ryan Pemberton",
    "ryan.pemberton@atlascopco.com",
    "Business Line Manager — Portable Air",
    "Abrasive Blasting & Protective Coatings",
    1,
    nowDate,
    nowDate,
  ]
);

const [campaignRow] = await conn.execute(`SELECT LAST_INSERT_ID() as id`);
const campaignId = campaignRow[0].id;
console.log(`Campaign created with ID: ${campaignId}`);

// ── Step 3: Parse the Excel file using positional columns ──
const filePath = '/home/ubuntu/upload/Blast_Paint_contact_list_checked.xlsx';
const workbook = XLSX.readFile(filePath);
const reportSheet = workbook.Sheets['Report_checked'];
// Use sheet_to_json with header:1 to get arrays (positional access)
const reportRows = XLSX.utils.sheet_to_json(reportSheet, { header: 1, defval: "" });

// Read Company_review sheet for name check status lookup
const companySheet = workbook.Sheets['Company_review'];
const companyData = companySheet ? XLSX.utils.sheet_to_json(companySheet, { defval: "" }) : [];
const companyStatusLookup = new Map();
for (const row of companyData) {
  const company = (row['Company'] || row['Reviewed Company Name'] || "").toString().trim().toLowerCase();
  const reviewed = (row['Reviewed Company Name'] || "").toString().trim();
  const status = (row['Name Check'] || row['Status'] || row['Name check status'] || "").toString().trim().toLowerCase();
  if (company) {
    companyStatusLookup.set(company, { reviewed, status });
  }
}

// Skip header row
const dataRows = reportRows.slice(1);
console.log(`Parsed ${dataRows.length} contact rows from Report_checked`);
console.log(`Parsed ${companyData.length} companies from Company_review`);

// ── Step 4: Scoring functions ──

const BLASTING_TITLE_PATTERNS = [
  /blast/i, /paint(?:ing|er)?/i, /coat(?:ing|s)?/i, /surface\s*(treat|protect|prep)/i,
  /corrosion/i, /abrasive/i, /sandblast/i, /uhp/i, /nace/i,
];
const DECISION_MAKER_PATTERNS = [
  /managing\s*director/i, /general\s*manager/i, /\bceo\b/i, /\bcoo\b/i,
  /\bdirector\b/i, /\bowner\b/i, /proprietor/i,
  /operations\s*manager/i, /project\s*manager/i, /project\s*director/i,
  /procurement/i, /purchasing/i, /supply\s*chain/i,
  /business\s*development/i, /commercial\s*manager/i,
  /fleet\s*manager/i, /equipment\s*manager/i,
  /maintenance\s*manager/i, /workshop\s*manager/i,
];
const OPERATIONS_PATTERNS = [
  /supervisor/i, /superintendent/i, /coordinator/i, /foreman/i,
  /estimator/i, /engineer/i, /inspector/i, /planner/i,
  /site\s*manager/i, /area\s*manager/i, /branch\s*manager/i,
  /production\s*manager/i, /factory\s*manager/i,
];

function classifyTitle(title) {
  if (!title) return "unknown";
  if (BLASTING_TITLE_PATTERNS.some(p => p.test(title))) return "blasting_specialist";
  if (DECISION_MAKER_PATTERNS.some(p => p.test(title))) return "decision_maker";
  if (OPERATIONS_PATTERNS.some(p => p.test(title))) return "operations";
  return "other";
}

function cleanCompanyName(raw) {
  if (!raw) return "";
  // Remove bold markdown markers
  return raw.replace(/\*\*/g, "").trim();
}

function isValidEmail(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ── Step 5: Import contacts ──

let imported = 0;
let excluded = 0;
let noData = 0;
const batchSize = 100;
let batch = [];

for (const row of dataRows) {
  const firstName = (row[0] || "").toString().trim();
  const lastName = (row[1] || "").toString().trim();
  const title = (row[2] || "").toString().trim();
  const rawCompany = (row[3] || "").toString().trim();
  const phone = (row[4] || "").toString().trim();
  const mobile = (row[5] || "").toString().trim();
  const rawEmail = (row[6] || "").toString().trim();
  const cleanCompany = (row[9] || "").toString().trim();
  const reviewedCompany = (row[10] || "").toString().trim();
  const nameCheckStatus = (row[11] || "").toString().trim().toLowerCase();

  // Skip empty rows
  if (!firstName && !lastName && !rawCompany && !cleanCompany) {
    noData++;
    continue;
  }

  // Use reviewed company name, fall back to clean, then raw
  const company = reviewedCompany || cleanCompany || cleanCompanyName(rawCompany);

  // Skip companies flagged as not usable
  if (nameCheckStatus.includes("not a company") || nameCheckStatus.includes("do not use") || nameCheckStatus.includes("duplicate")) {
    excluded++;
    continue;
  }

  const email = isValidEmail(rawEmail) ? rawEmail.trim() : null;
  const relevance = classifyTitle(title);

  // Score
  let score = 0;
  if (relevance === "blasting_specialist") score += 35;
  else if (relevance === "decision_maker") score += 25;
  else if (relevance === "operations") score += 15;
  else if (relevance === "other") score += 5;
  if (email) score += 20;
  if (title) score += 10;
  if (company) score += 5;

  // Tier — adjusted for this dataset where most contacts lack email
  let tier;
  if (relevance === "blasting_specialist" && title) tier = "tier1_hot";
  else if (relevance === "decision_maker" && title) tier = "tier2_warm";
  else if ((relevance === "operations" || relevance === "other") && title) tier = "tier3_enrich";
  else tier = "tier4_low";

  const enrichmentStatus = (email && title) ? "not_needed" : "pending";

  batch.push([
    campaignId, firstName || null, lastName || null, title || null,
    company, reviewedCompany || cleanCompany || null, email, phone || null, mobile || null,
    score, tier, relevance, enrichmentStatus,
    null, null, null, // enriched fields
    "not_started", // outreach status
    null, null, null, // draft fields
    0, // matched project count
    nameCheckStatus || "unknown",
    nowDate, nowDate,
  ]);

  if (batch.length >= batchSize) {
    await insertBatch(conn, batch);
    imported += batch.length;
    batch = [];
    process.stdout.write(`\rImported: ${imported}`);
  }
}

if (batch.length > 0) {
  await insertBatch(conn, batch);
  imported += batch.length;
}

console.log(`\nImported: ${imported}, Excluded: ${excluded}, Empty: ${noData}`);

// ── Step 6: Update campaign stats ──
const [statsRows] = await conn.execute(
  `SELECT COUNT(*) as total,
    SUM(CASE WHEN enrichmentStatus = 'enriched' OR enrichmentStatus = 'not_needed' THEN 1 ELSE 0 END) as enriched
   FROM campaignContacts WHERE campaignId = ?`,
  [campaignId]
);

await conn.execute(
  `UPDATE campaigns SET totalContacts = ?, enrichedContacts = ?, updatedAt = ? WHERE id = ?`,
  [statsRows[0].total, statsRows[0].enriched || 0, nowDate, campaignId]
);

// Print tier breakdown
const [tierRows] = await conn.execute(
  `SELECT tier, COUNT(*) as cnt FROM campaignContacts WHERE campaignId = ? GROUP BY tier ORDER BY FIELD(tier, 'tier1_hot', 'tier2_warm', 'tier3_enrich', 'tier4_low', 'excluded')`,
  [campaignId]
);
console.log("\nTier Breakdown:");
for (const row of tierRows) {
  console.log(`  ${row.tier}: ${row.cnt}`);
}

// Print title relevance breakdown
const [relRows] = await conn.execute(
  `SELECT titleRelevance, COUNT(*) as cnt FROM campaignContacts WHERE campaignId = ? GROUP BY titleRelevance ORDER BY cnt DESC`,
  [campaignId]
);
console.log("\nTitle Relevance:");
for (const row of relRows) {
  console.log(`  ${row.titleRelevance}: ${row.cnt}`);
}

// Print sample of Tier 1 contacts
const [t1Rows] = await conn.execute(
  `SELECT firstName, lastName, title, company, email, score FROM campaignContacts WHERE campaignId = ? AND tier = 'tier1_hot' ORDER BY score DESC LIMIT 10`,
  [campaignId]
);
console.log("\nTop 10 Tier 1 (Hot) Contacts:");
for (const row of t1Rows) {
  console.log(`  ${row.firstName} ${row.lastName} — ${row.title} @ ${row.company} (${row.email || 'no email'}) [${row.score}]`);
}

await conn.end();
console.log("\nDone!");

// ── Helper ──
async function insertBatch(conn, batch) {
  const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",\n");
  const values = batch.flat();
  await conn.execute(
    `INSERT INTO campaignContacts (
      campaignId, firstName, lastName, title,
      company, reviewedCompanyName, email, phone, mobile,
      score, tier, titleRelevance, enrichmentStatus,
      enrichedEmail, enrichedTitle, enrichedLinkedin,
      outreachStatus,
      draftSubject, draftBody, draftKeyPoints,
      matchedProjectCount,
      nameCheckStatus,
      createdAt, updatedAt
    ) VALUES ${placeholders}`,
    values
  );
}
