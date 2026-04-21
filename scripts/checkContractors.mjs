/**
 * Check contractors JSON field for raw URLs, HTML, or article fragments
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

// Sample contractor data from recent projects
const [rows] = await conn.execute(
  "SELECT id, name, contractors FROM projects WHERE contractors IS NOT NULL AND contractors != 'null' AND contractors != '[]' ORDER BY id DESC LIMIT 20"
);

let urlCount = 0;
for (const row of rows) {
  try {
    const contractors = typeof row.contractors === "string" ? JSON.parse(row.contractors) : row.contractors;
    if (!Array.isArray(contractors)) continue;
    for (const c of contractors) {
      const nameStr = String(c.name || "");
      const detailStr = String(c.detail || "");
      if (nameStr.includes("http") || nameStr.includes("<a ") || nameStr.includes("href") ||
          detailStr.includes("http") || detailStr.includes("<a ") || detailStr.includes("href")) {
        console.log(`Project ${row.id} (${row.name.substring(0, 60)}): contractor has URL/HTML`);
        console.log(`  name: ${nameStr.substring(0, 200)}`);
        console.log(`  detail: ${detailStr.substring(0, 200)}`);
        urlCount++;
      }
    }
  } catch (e) {
    // skip
  }
}

if (urlCount === 0) {
  console.log("No raw URLs/HTML found in contractors JSON for recent 20 projects.");
  // Show a sample of contractor names
  console.log("\nSample contractor names:");
  for (const row of rows.slice(0, 5)) {
    try {
      const contractors = typeof row.contractors === "string" ? JSON.parse(row.contractors) : row.contractors;
      if (Array.isArray(contractors) && contractors.length > 0) {
        console.log(`  Project ${row.id}: ${contractors.map(c => c.name).join(", ")}`);
      }
    } catch (e) {}
  }
}

// Also check the apollo enrichment data table
const tables = await conn.execute("SHOW TABLES LIKE '%enrich%'");
console.log("\nEnrichment tables:", JSON.stringify(tables[0]));

await conn.end();
