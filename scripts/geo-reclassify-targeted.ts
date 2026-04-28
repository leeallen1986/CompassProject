/**
 * Targeted geo reclassification — only processes blocked_cross_border_signal projects.
 * Much faster than full backfill (9 rows vs 1296).
 */

import { createConnection } from "mysql2/promise";
import { config } from "dotenv";
import { classifyProjectGeography } from "../server/geoClassifier";

config({ path: ".env.local" });
config();

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL!);

  // Step 1: Get all blocked_cross_border_signal projects
  const [blocked] = await conn.execute<any[]>(`
    SELECT id, name, location, owner, overview, sources, sector,
           projectCountry as prevCountry, geoBlockedReason as prevBlockedReason,
           projectState as prevState
    FROM projects
    WHERE geoBlockedReason = 'blocked_cross_border_signal'
    ORDER BY id ASC
  `);

  console.log(`\n=== TARGETED GEO RECLASSIFICATION ===`);
  console.log(`Processing ${blocked.length} blocked_cross_border_signal projects\n`);

  const reclassified: any[] = [];
  const stillBlocked: any[] = [];

  for (const row of blocked) {
    // mysql2 auto-parses JSON columns — handle both string and object
    let sources: Array<{ label: string; url: string; date?: string }> | null = null;
    if (Array.isArray(row.sources)) {
      sources = row.sources;
    } else if (typeof row.sources === 'string') {
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

    // Always apply
    await conn.execute(
      `UPDATE projects SET projectCountry=?, projectState=?, locationConfidence=?, geoBlockedReason=? WHERE id=?`,
      [result.projectCountry, result.projectState, result.locationConfidence, result.geoBlockedReason, row.id]
    );

    if (result.projectCountry === "AU") {
      reclassified.push({ ...row, newCountry: result.projectCountry, newState: result.projectState, conf: result.locationConfidence });
    } else {
      stillBlocked.push({ ...row, newReason: result.geoBlockedReason });
    }
  }

  console.log(`=== RECLASSIFIED → AU (${reclassified.length}) ===`);
  for (const p of reclassified) {
    console.log(`  [${p.id}] ${p.name.slice(0, 60)}`);
    console.log(`    location="${p.location}" owner="${p.owner.slice(0, 50)}"`);
    console.log(`    → AU/${p.newState} conf=${p.conf.toFixed(2)}`);
    console.log(``);
  }

  console.log(`=== STILL BLOCKED (${stillBlocked.length}) ===`);
  for (const p of stillBlocked) {
    console.log(`  [${p.id}] ${p.name.slice(0, 60)}`);
    console.log(`    location="${p.location}" owner="${p.owner.slice(0, 50)}"`);
    console.log(`    reason: ${p.newReason}`);
    const ov = (p.overview || "").slice(0, 150);
    console.log(`    overview: ${ov}`);
    console.log(``);
  }

  // Step 2: Also get a sample of 10 newly allowed projects from other blocked types
  const [otherBlocked] = await conn.execute<any[]>(`
    SELECT id, name, location, owner, overview, sources, sector,
           projectCountry as prevCountry, geoBlockedReason as prevBlockedReason
    FROM projects
    WHERE geoBlockedReason IN ('blocked_location_unclear', 'blocked_non_australian_project')
    ORDER BY id ASC
    LIMIT 100
  `);

  const newlyAllowed: any[] = [];
  for (const row of otherBlocked) {
    // mysql2 auto-parses JSON columns — handle both string and object
    let sources: Array<{ label: string; url: string; date?: string }> | null = null;
    if (Array.isArray(row.sources)) {
      sources = row.sources;
    } else if (typeof row.sources === 'string') {
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

    if (result.projectCountry === "AU" && row.prevBlockedReason) {
      newlyAllowed.push({ ...row, newState: result.projectState, conf: result.locationConfidence });
      await conn.execute(
        `UPDATE projects SET projectCountry=?, projectState=?, locationConfidence=?, geoBlockedReason=? WHERE id=?`,
        [result.projectCountry, result.projectState, result.locationConfidence, result.geoBlockedReason, row.id]
      );
    }
  }

  console.log(`=== NEWLY ALLOWED FROM OTHER BLOCKED TYPES — sample of 10 ===`);
  for (const p of newlyAllowed.slice(0, 10)) {
    console.log(`  [${p.id}] ${p.name.slice(0, 60)}`);
    console.log(`    prevReason=${p.prevBlockedReason} → AU/${p.newState} conf=${p.conf.toFixed(2)}`);
    console.log(``);
  }
  if (newlyAllowed.length === 0) {
    console.log(`  (none — other blocked types unaffected by new rules)`);
  }

  // Step 3: Final summary
  const [summary] = await conn.execute<any[]>(`
    SELECT geoBlockedReason, COUNT(*) as cnt FROM projects GROUP BY geoBlockedReason ORDER BY cnt DESC
  `);
  console.log(`\n=== FINAL GEO CLASSIFICATION SUMMARY (AFTER) ===`);
  for (const r of summary) {
    console.log(`  ${r.geoBlockedReason ?? "NULL (unclassified)"}: ${r.cnt}`);
  }

  await conn.end();
}

main().catch(console.error);
