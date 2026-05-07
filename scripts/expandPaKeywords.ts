/**
 * expandPaKeywords.ts
 * Adds specialty air (Family 2 + Family 3) terms to the Portable Air
 * business line keyword gate in the database.
 *
 * Run: npx tsx scripts/expandPaKeywords.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

// ── New terms to add ──────────────────────────────────────────────────────────
// Family 2 — Air Treatment / Quality
const FAMILY_2_TERMS = [
  "air dryer",
  "refrigerant dryer",
  "desiccant dryer",
  "air drying",
  "line drying",
  "pipe drying",
  "pipeline drying",
  "drying of pipeline",
  "moisture separator",
  "moisture trap",
  "dew point",
  "dew-point",
  "instrument air",
  "instrument-air",
  "instrument quality air",
  "control air",
  "control valve air",
  "oil-free air",
  "oil free air",
  "iso 8573",
  "moisture-sensitive",
  "moisture sensitive",
];

// Family 3 — Specialty Air / Gas
const FAMILY_3_TERMS = [
  "nitrogen",
  "nitrogen gas",
  "n2 membrane",
  "nitrogen membrane",
  "nitrogen generator",
  "nitrogen purging",
  "pipeline purging",
  "purging",
  "inerting",
  "inert gas",
  "inert atmosphere",
  "pipeline testing",
  "pipeline pressure test",
  "pneumatic pressure test",
  "hydrostatic testing",
  "hydrostatic pressure test",
  "pressure testing",
  "pre-commissioning",
  "pre commissioning",
  "precommissioning",
  "pipeline pre-commissioning",
  "dry-out",
  "dryout",
  "pipeline dry-out",
  "booster compressor",
  "pressure booster",
  "gas booster",
  "air booster",
  "high pressure testing",
  "high-pressure test",
  "high pressure air",
  "pipeline commissioning",
  "pipeline dewatering",
  "pipeline cleaning",
  "pipeline gauging",
  "pigging",
  "pig launcher",
  "pig receiver",
  "subsea pipeline",
  "export pipeline",
  "gas export",
];

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  // Get current Portable Air row
  const [rows] = await conn.execute<any[]>(
    `SELECT id, name, keywords FROM businessLines WHERE name = 'Portable Air' LIMIT 1`
  );

  if (rows.length === 0) {
    console.error("Portable Air business line not found in database");
    process.exit(1);
  }

  const row = rows[0];
  // mysql2 returns JSON columns as already-parsed JS values
  const existing: string[] = Array.isArray(row.keywords) ? row.keywords : JSON.parse(row.keywords);
  const existingLower = existing.map((k: string) => k.toLowerCase());
  console.log(`Current keyword count: ${existing.length}`);

  // Merge — only add terms not already present (case-insensitive)
  const allNew = [...FAMILY_2_TERMS, ...FAMILY_3_TERMS];
  const toAdd = allNew.filter(t => !existingLower.includes(t.toLowerCase()));
  console.log(`Terms to add: ${toAdd.length}`);
  toAdd.forEach(t => console.log(`  + "${t}"`))

  if (toAdd.length === 0) {
    console.log("Nothing to add — all terms already present.");
    await conn.end();
    process.exit(0);
  }

  const updated = [...existing, ...toAdd];

  await conn.execute(
    `UPDATE businessLines SET keywords = ? WHERE id = ?`,
    [JSON.stringify(updated), row.id]
  );

  console.log(`\nPortable Air keywords updated: ${existing.length} → ${updated.length}`);
  await conn.end();
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
