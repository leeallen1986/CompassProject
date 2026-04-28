/**
 * Force-reclassify specific project IDs using the latest classifier rules.
 * Used to fix projects that were already reclassified but need re-evaluation.
 */

import { createConnection } from "mysql2/promise";
import { config } from "dotenv";
import { classifyProjectGeography } from "../server/geoClassifier";

config({ path: ".env.local" });
config();

// IDs to force-reclassify
const TARGET_IDS = [630015, 120050, 30022, 120032, 480047, 570004, 660003];

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL!);

  const [rows] = await conn.execute<any[]>(`
    SELECT id, name, location, owner, overview, sources, sector,
           projectCountry as prevCountry, geoBlockedReason as prevBlockedReason
    FROM projects
    WHERE id IN (${TARGET_IDS.join(",")})
    ORDER BY id ASC
  `);

  console.log(`\n=== FORCE RECLASSIFICATION (${rows.length} projects) ===\n`);

  for (const row of rows) {
    let sources: Array<{ label: string; url: string; date?: string }> | null = null;
    if (Array.isArray(row.sources)) {
      sources = row.sources;
    } else if (typeof row.sources === "string") {
      try { sources = JSON.parse(row.sources); } catch { sources = null; }
    }

    const result = classifyProjectGeography({
      name: row.name,
      location: row.location,
      owner: row.owner,
      overview: row.overview,
      sources,
      sector: row.sector,
    });

    await conn.execute(
      `UPDATE projects SET projectCountry=?, projectState=?, locationConfidence=?, geoBlockedReason=? WHERE id=?`,
      [result.projectCountry, result.projectState, result.locationConfidence, result.geoBlockedReason, row.id]
    );

    const before = row.prevBlockedReason ? `BLOCKED:${row.prevBlockedReason}` : `AU:${row.prevCountry}`;
    const after = result.geoBlockedReason ? `BLOCKED:${result.geoBlockedReason}` : `ALLOWED:AU/${result.projectState} conf=${result.locationConfidence.toFixed(2)}`;
    const changed = (result.projectCountry !== row.prevCountry || result.geoBlockedReason !== row.prevBlockedReason) ? " ← CHANGED" : "";

    console.log(`[${row.id}] ${row.name.slice(0, 55)}`);
    console.log(`  ${before} → ${after}${changed}`);
    console.log(``);
  }

  await conn.end();
}

main().catch(console.error);
