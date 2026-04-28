/**
 * Geo reclassification backfill script.
 * Re-runs classifyProjectGeography on ALL projects and reports:
 * - Projects reclassified from blocked_cross_border_signal to AU
 * - Sample of 10 remaining blocked_cross_border_signal projects
 * - Sample of 10 newly allowed projects
 * - Any potential false positives (non-AU projects that slipped through)
 */

import { createConnection } from "mysql2/promise";
import { config } from "dotenv";
import { classifyProjectGeography } from "../server/geoClassifier";

config({ path: ".env.local" });
config();

interface ProjectRow {
  id: number;
  name: string;
  location: string;
  owner: string;
  overview: string | null;
  sources: string | null;
  sector: string;
  prevCountry: string | null;
  prevBlockedReason: string | null;
  prevState: string | null;
}

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL!);

  // Fetch all projects
  const [rows] = await conn.execute<any[]>(`
    SELECT id, name, location, owner, overview, sources, sector,
           projectCountry as prevCountry, geoBlockedReason as prevBlockedReason,
           projectState as prevState
    FROM projects
    ORDER BY id ASC
  `);

  console.log(`\n=== GEO RECLASSIFICATION BACKFILL ===`);
  console.log(`Total projects to process: ${rows.length}\n`);

  const reclassifiedFromCrossBorder: Array<{
    id: number; name: string; location: string; owner: string;
    prevReason: string; newCountry: string | null; newState: string | null; confidence: number;
  }> = [];

  const remainingBlocked: Array<{
    id: number; name: string; location: string; owner: string; overview: string;
  }> = [];

  const newlyAllowed: Array<{
    id: number; name: string; location: string; owner: string;
    prevReason: string | null; newState: string | null; confidence: number;
  }> = [];

  let totalReclassified = 0;
  let totalAu = 0;
  let totalBlocked = 0;
  let totalUnclear = 0;

  for (const row of rows as ProjectRow[]) {
    let sources: Array<{ label: string; url: string; date?: string }> | null = null;
    try {
      sources = row.sources ? JSON.parse(row.sources) : null;
    } catch { sources = null; }

    const result = classifyProjectGeography({
      name: row.name,
      location: row.location,
      owner: row.owner,
      overview: row.overview,
      sources,
      sector: row.sector,
    });

    const changed =
      result.projectCountry !== row.prevCountry ||
      result.geoBlockedReason !== row.prevBlockedReason;

    // Always apply the new classification (force re-evaluation of all rows)
    await conn.execute(
      `UPDATE projects SET projectCountry=?, projectState=?, locationConfidence=?, geoBlockedReason=? WHERE id=?`,
      [result.projectCountry, result.projectState, result.locationConfidence, result.geoBlockedReason, row.id]
    );

    if (changed) {
      totalReclassified++;

      // Track cross-border → AU transitions
      if (row.prevBlockedReason === "blocked_cross_border_signal" && result.projectCountry === "AU") {
        reclassifiedFromCrossBorder.push({
          id: row.id,
          name: row.name,
          location: row.location,
          owner: row.owner,
          prevReason: row.prevBlockedReason,
          newCountry: result.projectCountry,
          newState: result.projectState,
          confidence: result.locationConfidence,
        });
      }

      // Track any newly allowed projects (was blocked, now AU)
      if (row.prevBlockedReason && !result.geoBlockedReason && result.projectCountry === "AU") {
        newlyAllowed.push({
          id: row.id,
          name: row.name,
          location: row.location,
          owner: row.owner,
          prevReason: row.prevBlockedReason,
          newState: result.projectState,
          confidence: result.locationConfidence,
        });
      }
    }

    // Track remaining blocked cross-border
    if (result.geoBlockedReason === "blocked_cross_border_signal") {
      remainingBlocked.push({
        id: row.id,
        name: row.name,
        location: row.location,
        owner: row.owner,
        overview: (row.overview || "").slice(0, 150),
      });
    }

    if (result.projectCountry === "AU") totalAu++;
    else if (result.geoBlockedReason === "blocked_non_australian_project") totalBlocked++;
    else totalUnclear++;
  }

  // ── Report ──

  console.log(`=== RECLASSIFICATION SUMMARY ===`);
  console.log(`  Total processed: ${rows.length}`);
  console.log(`  Total reclassified: ${totalReclassified}`);
  console.log(`  Now AU: ${totalAu}`);
  console.log(`  Still blocked (non-AU): ${totalBlocked}`);
  console.log(`  Unclear: ${totalUnclear}`);
  console.log(``);

  console.log(`=== RECLASSIFIED FROM blocked_cross_border_signal → AU (${reclassifiedFromCrossBorder.length}) ===`);
  for (const p of reclassifiedFromCrossBorder) {
    console.log(`  [${p.id}] ${p.name}`);
    console.log(`    location="${p.location}" owner="${p.owner.slice(0, 50)}"`);
    console.log(`    → country=AU state=${p.newState} conf=${p.confidence.toFixed(2)}`);
    console.log(``);
  }

  console.log(`=== REMAINING blocked_cross_border_signal (${remainingBlocked.length}) ===`);
  for (const p of remainingBlocked.slice(0, 10)) {
    console.log(`  [${p.id}] ${p.name}`);
    console.log(`    location="${p.location}" owner="${p.owner.slice(0, 50)}"`);
    console.log(`    overview: ${p.overview}...`);
    console.log(``);
  }

  console.log(`=== NEWLY ALLOWED (was blocked, now AU) — sample of 10 ===`);
  for (const p of newlyAllowed.slice(0, 10)) {
    console.log(`  [${p.id}] ${p.name}`);
    console.log(`    location="${p.location}" owner="${p.owner.slice(0, 50)}"`);
    console.log(`    prevReason=${p.prevReason} → state=${p.newState} conf=${p.confidence.toFixed(2)}`);
    console.log(``);
  }

  await conn.end();
}

main().catch(console.error);
