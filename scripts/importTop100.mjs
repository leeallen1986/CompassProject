/**
 * importTop100.mjs — Import WA Pump / Portable Flow Top 100 targets into accountPriors table.
 * Run: node scripts/importTop100.mjs
 */
import { readFileSync } from "fs";
import { createConnection } from "mysql2/promise";
import { config } from "dotenv";
import XLSX from "xlsx";

config({ path: ".env" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// Parse DATABASE_URL
const url = new URL(DATABASE_URL);
const connOpts = {
  host: url.hostname,
  port: parseInt(url.port || "3306"),
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
};

async function main() {
  const conn = await createConnection(connOpts);
  console.log("Connected to database");

  // Read the Excel file
  const wb = XLSX.readFile("/home/ubuntu/upload/wa_portable_flow_top_100_targets.xlsx");
  const ws = wb.Sheets["Top 100 Targets"];
  const rows = XLSX.utils.sheet_to_json(ws);

  console.log(`Found ${rows.length} rows in Top 100 Targets sheet`);

  // Clear existing pump account priors
  await conn.execute("DELETE FROM accountPriors WHERE lane = 'pump'");
  console.log("Cleared existing pump account priors");

  let inserted = 0;
  for (const row of rows) {
    const rank = row["Rank"];
    const canonicalName = row["Account name"];
    if (!canonicalName) continue;

    const state = row["State / location"] || null;
    const segment = row["Segment"] || null;
    const scoreOutOf100 = row["Score out of 100"] || null;
    const priorityLevel = row["Priority level"] || null;
    const productFit = row["Product fit"] || null;
    const likelyApplication = row["Likely application"] || null;
    const whyTarget = row["Why this account is a target"] || null;
    const firstSalesAction = row["First sales action"] || null;
    const suggestedOpeningAngle = row["Suggested opening angle"] || null;
    const confidenceLevel = row["Confidence level"] || null;
    const existingHistory = row["Existing relationship / history if visible"] || null;
    const salesNotes = row["Notes for sales rep"] || null;
    const pumpSalesLC = row["Pump sales LC since 2021"] || null;
    const pumpQtySince2021 = row["Pump qty since 2021"] || null;
    const latestPumpSaleYear = row["Latest pump sale year"] || null;
    const crmRecordsGrouped = row["CRM records grouped"] || null;
    const crmRoles = row["CRM roles"] || null;
    const crmTypes = row["CRM types"] || null;
    const phone = row["Phone"] || null;
    const email = row["E-Mail"] || null;
    const owner = row["Owner"] || null;
    const status = (row["Status"] || "Not Started").toLowerCase().replace(/\s+/g, "_");

    // Build aliases from the state field (location variants) and canonical name
    const aliases = [];
    // Add common variations
    const nameParts = canonicalName.split(/\s+/);
    if (nameParts.length > 2) {
      // Add acronym
      aliases.push(nameParts.map(p => p[0]).join("").toUpperCase());
    }
    // Add PTY LTD variant
    if (!canonicalName.includes("Pty") && !canonicalName.includes("PTY")) {
      aliases.push(`${canonicalName} Pty Ltd`);
    }

    await conn.execute(
      `INSERT INTO accountPriors (
        \`rank\`, canonicalName, aliases, state, segment, scoreOutOf100,
        priorityLevel, productFit, likelyApplication, whyTarget,
        firstSalesAction, suggestedOpeningAngle, confidenceLevel,
        existingHistory, salesNotes, pumpSalesLC, pumpQtySince2021,
        latestPumpSaleYear, crmRecordsGrouped, crmRoles, crmTypes,
        phone, email, lane, status, owner
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pump', ?, ?)`,
      [
        rank, canonicalName, JSON.stringify(aliases), state, segment, scoreOutOf100,
        priorityLevel, productFit, likelyApplication, whyTarget,
        firstSalesAction, suggestedOpeningAngle, confidenceLevel,
        existingHistory, salesNotes, pumpSalesLC, pumpQtySince2021,
        latestPumpSaleYear, crmRecordsGrouped, crmRoles, crmTypes,
        phone, email, status, owner,
      ]
    );
    inserted++;
  }

  console.log(`Imported ${inserted} account priors`);

  // Verify
  const [countRows] = await conn.execute("SELECT COUNT(*) as cnt FROM accountPriors WHERE lane = 'pump'");
  console.log(`Verified: ${countRows[0].cnt} pump account priors in database`);

  // Show priority distribution
  const [priorityDist] = await conn.execute(
    "SELECT priorityLevel, COUNT(*) as cnt FROM accountPriors WHERE lane = 'pump' GROUP BY priorityLevel ORDER BY cnt DESC"
  );
  console.log("Priority distribution:", priorityDist);

  await conn.end();
}

main().catch(err => {
  console.error("Import failed:", err);
  process.exit(1);
});
