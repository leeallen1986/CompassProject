/**
 * CRM Contact Import Script
 * Parses the LA9thDecContacts2025.xlsx file and batch-inserts into the contacts table.
 * 
 * Column mapping (no headers):
 * 0: Unknown (always null)
 * 1: Name (Last, First format)
 * 2: Company
 * 3: Email
 * 4: Title/Position
 * 5: Department
 * 6: Mobile Phone
 * 7: Office Phone
 * 8: Status (Active/Blocked/In Preparation)
 * 9: Account ID (sparse)
 * 10: CRM Contact ID
 * 11: Owner (sales rep name)
 * 12: Last Modified (Excel date serial)
 */

import { readFileSync } from "fs";
import * as XLSX from "xlsx";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// ── Sector classification by company name ──
const MINING_KW = ["mining", "mine ", "mines", "mineral", "gold", "iron ore", "coal", "bhp", "rio tinto", "fortescue", "newcrest", "newmont", "south32", "glencore", "barrick", "alcoa", "alumina", "nickel", "copper", "lithium", "zinc", "tin ", "tungsten", "rare earth", "ilmenite", "zircon", "bauxite", "manganese", "potash", "phosphate", "ore ", "smelter", "refinery", "metallurg"];
const OILGAS_KW = ["chevron", "woodside", "santos", "origin energy", "inpex", "shell ", "bp australia", "petroleum", "gas ", "lng", "energy", "oil ", "fuel", "petrol", "caltex", "ampol", "viva energy", "beach energy", "cooper basin", "senex"];
const INFRA_KW = ["construction", "infrastructure", "engineering", "civil", "contractor", "monadelphous", "downer", "cimic", "lendlease", "laing", "bechtel", "fluor", "clough", "mcconnell", "built ", "building", "road", "bridge", "tunnel", "rail"];
const DRILLING_KW = ["drill", "boring", "exploration", "geotechnical", "piling"];
const WATER_KW = ["water ", "desal", "irrigation", "osmoflo", "veolia water", "suez", "bore"];

function classifySector(company) {
  if (!company) return null;
  const co = company.toLowerCase();
  for (const kw of DRILLING_KW) { if (co.includes(kw)) return "drilling"; }
  for (const kw of MINING_KW) { if (co.includes(kw)) return "mining"; }
  for (const kw of OILGAS_KW) { if (co.includes(kw)) return "oil_gas"; }
  for (const kw of INFRA_KW) { if (co.includes(kw)) return "infrastructure"; }
  for (const kw of WATER_KW) { if (co.includes(kw)) return "water"; }
  return null;
}

function classifyEnrichmentPriority(sector, title) {
  // Sector-relevant contacts get high priority
  if (sector) return "high";
  // Contacts with decision-maker titles get medium
  if (title) {
    const t = title.toLowerCase();
    if (["manager", "director", "superintendent", "general manager", "ceo", "cfo", "coo", "vp", "vice president", "head of", "chief", "procurement", "purchasing", "buyer", "fleet", "maintenance manager", "operations manager", "project manager"].some(kw => t.includes(kw))) {
      return "medium";
    }
  }
  return "low";
}

function parseName(rawName) {
  if (!rawName) return { firstName: "", lastName: "" };
  const name = String(rawName).trim();
  // Format: "Last, First" or "Last, First Middle"
  const commaIdx = name.indexOf(",");
  if (commaIdx > 0) {
    const lastName = name.substring(0, commaIdx).trim();
    const firstName = name.substring(commaIdx + 1).trim();
    // Clean up dots and brackets
    const cleanFirst = firstName.replace(/^\.\s*/, "").replace(/\[.*?\]/g, "").trim();
    const cleanLast = lastName.replace(/\[.*?\]/g, "").trim();
    return { firstName: cleanFirst, lastName: cleanLast };
  }
  // No comma — just use as-is
  const parts = name.split(/\s+/);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") || "" };
}

function cleanCompany(raw) {
  if (!raw) return "";
  let co = String(raw).trim();
  // Remove [S] prefix
  if (co.startsWith("[S] - ")) co = co.substring(6);
  if (co.startsWith("[not provided")) co = "";
  return co;
}

function excelDateToTimestamp(serial) {
  if (!serial || typeof serial !== "number") return null;
  // Excel date serial to JS Date
  const baseDate = new Date(1899, 11, 30); // Dec 30, 1899
  const msPerDay = 86400000;
  return new Date(baseDate.getTime() + serial * msPerDay);
}

function cleanPhone(raw) {
  if (!raw) return null;
  return String(raw).trim() || null;
}

async function main() {
  console.log("Reading Excel file...");
  const buf = readFileSync("/home/ubuntu/upload/LA9thDecContacts2025.xlsx");
  const workbook = XLSX.read(buf, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  console.log(`Parsed ${rows.length} rows from Excel`);

  // Connect to DB
  const conn = await mysql.createConnection(DATABASE_URL);
  console.log("Connected to database");

  // Get existing CRM IDs to avoid duplicates
  const [existingCrm] = await conn.execute("SELECT crmId FROM contacts WHERE crmId IS NOT NULL");
  const existingCrmIds = new Set(existingCrm.map(r => r.crmId));
  console.log(`Found ${existingCrmIds.size} existing CRM contacts in DB`);

  // Get the latest reportId for the CRM import batch
  const [reportRows] = await conn.execute("SELECT MAX(id) as maxId FROM reports");
  const reportId = reportRows[0]?.maxId || 1;

  // Parse and prepare contacts
  let parsed = 0;
  let skipped = 0;
  let duplicates = 0;
  let sectorCounts = { mining: 0, oil_gas: 0, infrastructure: 0, drilling: 0, water: 0, general: 0 };
  
  const BATCH_SIZE = 500;
  let batch = [];
  let totalInserted = 0;

  const INSERT_SQL = `INSERT INTO contacts (
    reportId, name, title, company, project, priority, roleBucket,
    email, phone, mobilePhone, department, crmId, crmAccountId, crmOwner,
    lastCrmModified, source, sectorTag, enrichmentPriority, enrichmentStatus,
    enrichmentSource, verificationStatus, confidenceScore, roleRelevance
  ) VALUES ?`;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[1]) { skipped++; continue; }

    const crmId = row[10] ? String(row[10]).trim() : null;
    
    // Skip if already imported
    if (crmId && existingCrmIds.has(crmId)) {
      duplicates++;
      continue;
    }

    const { firstName, lastName } = parseName(row[1]);
    const fullName = `${firstName} ${lastName}`.trim();
    if (!fullName || fullName === "." || fullName.includes("[not provided")) { skipped++; continue; }

    const company = cleanCompany(row[2]);
    if (!company) { skipped++; continue; }

    const status = row[8] ? String(row[8]).trim() : "Active";
    if (status === "Blocked" || status === "Status") { skipped++; continue; }

    const email = row[3] ? String(row[3]).trim() : null;
    const title = row[4] ? String(row[4]).trim() : "";
    const dept = row[5] ? String(row[5]).trim() : null;
    const mobile = cleanPhone(row[6]);
    const phone = cleanPhone(row[7]);
    const accountId = row[9] ? String(row[9]).trim() : null;
    const owner = row[11] ? String(row[11]).trim() : null;
    const lastModified = excelDateToTimestamp(row[12]);

    const sector = classifySector(company);
    const priority = classifyEnrichmentPriority(sector, title);
    
    if (sector) sectorCounts[sector]++;
    else sectorCounts.general++;

    // Determine role bucket from title/department
    let roleBucket = "Unknown";
    if (title) {
      const t = title.toLowerCase();
      if (t.includes("procurement") || t.includes("purchasing") || t.includes("buyer")) roleBucket = "Procurement";
      else if (t.includes("maintenance")) roleBucket = "Maintenance";
      else if (t.includes("operations")) roleBucket = "Operations";
      else if (t.includes("project")) roleBucket = "Project Management";
      else if (t.includes("engineer")) roleBucket = "Engineering";
      else if (t.includes("director") || t.includes("general manager") || t.includes("ceo") || t.includes("managing")) roleBucket = "Executive";
      else if (t.includes("fleet") || t.includes("workshop")) roleBucket = "Fleet/Workshop";
      else if (t.includes("finance") || t.includes("account")) roleBucket = "Finance";
      else if (t.includes("manager")) roleBucket = "Management";
      else if (t.includes("supervisor") || t.includes("superintendent")) roleBucket = "Supervision";
      else roleBucket = "Other";
    } else if (dept) {
      const d = dept.toLowerCase();
      if (d.includes("purchasing")) roleBucket = "Procurement";
      else if (d.includes("maintenance")) roleBucket = "Maintenance";
      else if (d.includes("engineering")) roleBucket = "Engineering";
      else if (d.includes("service")) roleBucket = "Service Operations";
      else if (d.includes("finance")) roleBucket = "Finance";
      else if (d.includes("management")) roleBucket = "Management";
      else if (d.includes("production")) roleBucket = "Production";
      else roleBucket = dept;
    }

    batch.push([
      reportId,
      fullName,
      title || "CRM Contact",
      company,
      "CRM Import",       // project placeholder
      "cold",             // priority — will be updated when matched to projects
      roleBucket,
      email,
      phone,
      mobile,
      dept,
      crmId,
      accountId,
      owner,
      lastModified,
      "crm",
      sector,
      priority,
      "pending",          // enrichmentStatus
      "manual",           // enrichmentSource (will be updated to "apollo" after enrichment)
      "unverified",       // verificationStatus
      sector ? "medium" : "low",  // confidenceScore
      priority === "high" ? "high" : priority === "medium" ? "medium" : "low",  // roleRelevance
    ]);

    if (crmId) existingCrmIds.add(crmId);
    parsed++;

    // Batch insert
    if (batch.length >= BATCH_SIZE) {
      try {
        await conn.query(INSERT_SQL, [batch]);
        totalInserted += batch.length;
        if (totalInserted % 5000 === 0) {
          console.log(`  Inserted ${totalInserted} contacts...`);
        }
      } catch (err) {
        console.error(`Error inserting batch at row ${i}:`, err.message);
        // Try inserting one by one to find the problematic row
        for (const row of batch) {
          try {
            await conn.query(INSERT_SQL, [[row]]);
            totalInserted++;
          } catch (e) {
            console.error(`  Skipping contact ${row[1]} at ${row[3]}: ${e.message}`);
            skipped++;
          }
        }
      }
      batch = [];
    }
  }

  // Insert remaining batch
  if (batch.length > 0) {
    try {
      await conn.query(INSERT_SQL, [batch]);
      totalInserted += batch.length;
    } catch (err) {
      console.error("Error inserting final batch:", err.message);
      for (const row of batch) {
        try {
          await conn.query(INSERT_SQL, [[row]]);
          totalInserted++;
        } catch (e) {
          console.error(`  Skipping contact ${row[1]}: ${e.message}`);
          skipped++;
        }
      }
    }
  }

  console.log("\n=== IMPORT COMPLETE ===");
  console.log(`Total rows: ${rows.length}`);
  console.log(`Parsed: ${parsed}`);
  console.log(`Inserted: ${totalInserted}`);
  console.log(`Skipped (invalid/blocked): ${skipped}`);
  console.log(`Duplicates (already in DB): ${duplicates}`);
  console.log("\nSector breakdown:");
  for (const [sector, count] of Object.entries(sectorCounts)) {
    console.log(`  ${sector}: ${count}`);
  }

  // Verify final counts
  const [countResult] = await conn.execute("SELECT COUNT(*) as total, SUM(CASE WHEN source = 'crm' THEN 1 ELSE 0 END) as crm_total FROM contacts");
  console.log(`\nDB totals: ${countResult[0].total} total contacts, ${countResult[0].crm_total} from CRM`);

  const [sectorResult] = await conn.execute("SELECT sectorTag, enrichmentPriority, COUNT(*) as cnt FROM contacts WHERE source = 'crm' GROUP BY sectorTag, enrichmentPriority ORDER BY cnt DESC");
  console.log("\nCRM contacts by sector and priority:");
  for (const r of sectorResult) {
    console.log(`  ${r.sectorTag || 'general'} / ${r.enrichmentPriority}: ${r.cnt}`);
  }

  await conn.end();
  console.log("\nDone!");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
