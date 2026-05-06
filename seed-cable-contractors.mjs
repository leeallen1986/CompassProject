/**
 * Seed script: Australia Cable / Underground Power Contractors
 * Source: Australia_cable_layers_by_state.docx (generated 30 Apr 2026)
 * Uses single batch INSERT ... ON DUPLICATE KEY UPDATE for speed.
 */
import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL not set");

const conn = await mysql.createConnection(DB_URL);

const fitScore = { "Very High": 90, "High": 75, "Medium-High": 60, "Medium": 45 };

const contractors = [
  // WA
  { name: "Ventia", state: "WA", fit: "Medium" },
  { name: "UGL", state: "WA", fit: "High" },
  { name: "Service Stream", state: "WA", fit: "Medium" },
  { name: "GenusPlus Group", state: "WA", fit: "Very High" },
  { name: "Zinfra", state: "WA", fit: "High" },
  { name: "Cape", state: "WA", fit: "Very High" },
  { name: "Mainswest / Osmose Australia", state: "WA", fit: "Medium-High" },
  { name: "Boretech Contracting", state: "WA", fit: "High" },
  { name: "Power On Cabling", state: "WA", fit: "High" },
  { name: "Diversified Services", state: "WA", fit: "High" },
  { name: "MME Underground Services", state: "WA", fit: "Very High" },
  { name: "Network Contracting", state: "WA", fit: "Very High" },
  { name: "Geographe Underground Services", state: "WA", fit: "Medium-High" },
  { name: "GeoEx", state: "WA", fit: "Medium-High" },
  { name: "KIER Contracting", state: "WA", fit: "Medium-High" },
  { name: "Perth Underground Power", state: "WA", fit: "Medium" },
  { name: "Cable Layers Australia", state: "WA", fit: "High" },
  { name: "Cable Force", state: "WA", fit: "Medium" },
  { name: "Cabling WA", state: "WA", fit: "Medium" },
  { name: "WA Underground Services", state: "WA", fit: "Medium" },
  { name: "Advance Excavations", state: "WA", fit: "Medium" },
  { name: "MC Earthworx", state: "WA", fit: "Medium-High" },
  { name: "Allied Power WA", state: "WA", fit: "Medium-High" },
  { name: "HV Power Services", state: "WA", fit: "Medium" },
  // NSW
  { name: "SRG Global Utilities", state: "NSW", fit: "High" },
  { name: "Quickway", state: "NSW", fit: "Very High" },
  { name: "Killard Group", state: "NSW", fit: "High" },
  { name: "Garde Services", state: "NSW", fit: "Very High" },
  { name: "Lindsay Civil", state: "NSW", fit: "High" },
  { name: "QC Comms", state: "NSW", fit: "Medium-High" },
  { name: "Alliance Network Infrastructure", state: "NSW", fit: "High" },
  { name: "BRP Industries", state: "NSW", fit: "High" },
  { name: "Gremalco", state: "NSW", fit: "High" },
  { name: "L & M Trenchless", state: "NSW", fit: "Medium-High" },
  { name: "MH Power", state: "NSW", fit: "Medium-High" },
  { name: "Smalls Power Poles & Linework", state: "NSW", fit: "Medium-High" },
  { name: "District Power", state: "NSW", fit: "Medium" },
  { name: "Plustel", state: "NSW", fit: "Medium" },
  // VIC
  { name: "UCS Group", state: "VIC", fit: "High" },
  { name: "Daly's Constructions", state: "VIC", fit: "Very High" },
  { name: "Kelly Electrical & Civil", state: "VIC", fit: "High" },
  { name: "Utility Solutions Group", state: "VIC", fit: "High" },
  { name: "Powerplant Project Services", state: "VIC", fit: "High" },
  { name: "Livic Underground Construction", state: "VIC", fit: "High" },
  { name: "Total Underground Solutions", state: "VIC", fit: "High" },
  { name: "Cable Solutions Pty Ltd", state: "VIC", fit: "High" },
  { name: "AMH Civil", state: "VIC", fit: "Medium-High" },
  { name: "Evolution Electrical", state: "VIC", fit: "Medium-High" },
  { name: "Complete Underground", state: "VIC", fit: "Medium-High" },
  { name: "DirectBor", state: "VIC", fit: "Very High" },
  // QLD
  { name: "CINC Group", state: "QLD", fit: "Very High" },
  { name: "TBG", state: "QLD", fit: "High" },
  { name: "Underground Power South East Queensland", state: "QLD", fit: "Very High" },
  { name: "SEQ Electrical Contractors", state: "QLD", fit: "High" },
  { name: "Elexcom", state: "QLD", fit: "Medium-High" },
  { name: "PDR Group", state: "QLD", fit: "High" },
  { name: "Minelec", state: "QLD", fit: "Medium-High" },
  { name: "Underground Network Services", state: "QLD", fit: "High" },
  { name: "HV Power", state: "QLD", fit: "Medium-High" },
  { name: "PowerME", state: "QLD", fit: "Medium" },
  // SA
  { name: "CATCON", state: "SA", fit: "High" },
  { name: "EDC Expert Group", state: "SA", fit: "High" },
  { name: "Trenchless Pipelaying Contractors", state: "SA", fit: "High" },
  { name: "SEM Group", state: "SA", fit: "Very High" },
  { name: "Camco", state: "SA", fit: "High" },
  { name: "T & J Constructions", state: "SA", fit: "Medium-High" },
  { name: "Diverse Civil and Commercial Projects", state: "SA", fit: "Medium-High" },
  { name: "Beltrame Civil", state: "SA", fit: "High" },
  { name: "DML Constructions", state: "SA", fit: "Medium-High" },
  { name: "Platinum Civil Construction Group", state: "SA", fit: "Medium-High" },
  { name: "UGI Underground Installations", state: "SA", fit: "High" },
  // TAS
  { name: "PowerLinesTas", state: "TAS", fit: "High" },
  { name: "Archers Underground Services", state: "TAS", fit: "High" },
  { name: "NSX Electrical Services", state: "TAS", fit: "Medium-High" },
  { name: "Joint Co Tas", state: "TAS", fit: "Medium-High" },
  { name: "AJ Water", state: "TAS", fit: "Medium-High" },
  { name: "Paneltec", state: "TAS", fit: "Medium" },
  { name: "Marinus Link supply chain", state: "TAS", fit: "Very High" },
  // NT
  { name: "NT Electrical Group", state: "NT", fit: "High" },
  { name: "NT Link", state: "NT", fit: "Medium-High" },
  { name: "ABR Group NT", state: "NT", fit: "High" },
  { name: "Florance Electrical", state: "NT", fit: "Medium-High" },
  { name: "Austar Underground Services", state: "NT", fit: "High" },
  { name: "JSM Civil", state: "NT", fit: "High" },
  { name: "Northern Power Services", state: "NT", fit: "High" },
  { name: "iFind Pipes N Cables", state: "NT", fit: "Medium" },
  { name: "MEC NT", state: "NT", fit: "Medium" },
  // ACT
  { name: "Wodens", state: "ACT", fit: "High" },
  { name: "Complex Co", state: "ACT", fit: "Medium" },
  { name: "Huon Contractors", state: "ACT", fit: "Medium" },
  { name: "Cord Civil", state: "ACT", fit: "Medium" },
  { name: "JSC Group", state: "ACT", fit: "Medium" },
  { name: "G&G Group", state: "ACT", fit: "Medium" },
  { name: "Cappello Hydraulics & Civil", state: "ACT", fit: "Medium" },
  { name: "BRP Industries (Canberra operations)", state: "ACT", fit: "High" },
];

// Build batch values
const values = contractors.map(c => {
  const score = fitScore[c.fit] ?? 45;
  return [
    c.name,
    JSON.stringify([]),         // aliases
    "contractor",               // primaryRole
    JSON.stringify(["subcontractor"]),  // additionalRoles
    0, 0, 0,                    // projectCount, confirmedCount, predictedCount
    JSON.stringify({ infrastructure: 1 }),  // sectorBreakdown
    JSON.stringify({ [c.state]: 1 }),        // stateBreakdown
    JSON.stringify([]),         // recentProjectIds
    0, 0,                       // momentumScore, recurrenceScore
    score,                      // atlasRelevanceScore
    0,                          // earlySignalScore
    score,                      // compositeScore
  ];
});

const placeholders = values.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
const flat = values.flat();

console.log(`\nBatch-inserting ${contractors.length} cable/underground power contractors...`);
await conn.execute(
  `INSERT INTO contractorRegistry
     (canonicalName, aliases, primaryRole, additionalRoles,
      projectCount, confirmedCount, predictedCount,
      sectorBreakdown, stateBreakdown,
      recentProjectIds, momentumScore, recurrenceScore,
      atlasRelevanceScore, earlySignalScore, compositeScore)
   VALUES ${placeholders}
   ON DUPLICATE KEY UPDATE
     atlasRelevanceScore = GREATEST(atlasRelevanceScore, VALUES(atlasRelevanceScore)),
     sectorBreakdown = COALESCE(sectorBreakdown, VALUES(sectorBreakdown)),
     stateBreakdown = COALESCE(stateBreakdown, VALUES(stateBreakdown)),
     updatedAt = NOW()`,
  flat
);
console.log(`  ✓ Done`);

// ─── Append cable-layer keywords to Portable Air ──────────────────────────
const cableKeywords = [
  "underground power", "underground cable", "cable laying", "cable installation",
  "HV feeder", "HV cable", "LV cable", "substation construction",
  "trenchless", "HDD", "horizontal directional drilling", "directional drilling",
  "cable hauling", "cable jointing", "underground reticulation",
  "transmission line construction", "distribution network construction",
  "underground utility", "conduit installation", "cable duct",
  "power reticulation", "underground electrical", "feeder upgrade",
  "pit and pipe", "cable trenching", "underground infrastructure contractor",
  "cable layer", "cable contractor", "underground power contractor"
];

const [blRows] = await conn.execute(
  "SELECT id, keywords FROM businessLines WHERE name = 'Portable Air' AND isActive = 1 LIMIT 1"
);

if (blRows.length === 0) {
  console.log("  ⚠ Portable Air business line not found — skipping keyword update");
} else {
  const bl = blRows[0];
  let existing = [];
  if (bl.keywords) {
    const raw = (Buffer.isBuffer(bl.keywords) ? bl.keywords.toString('utf8') : String(bl.keywords)).trim();
    if (raw.startsWith('[')) {
      existing = JSON.parse(raw);
    } else {
      // Legacy comma-separated string
      existing = raw.split(',').map(k => k.trim()).filter(Boolean);
    }
  }
  const merged = [...new Set([...existing, ...cableKeywords])];
  await conn.execute(
    "UPDATE businessLines SET keywords = ?, updatedAt = NOW() WHERE id = ?",
    [JSON.stringify(merged), bl.id]
  );
  const added = merged.length - existing.length;
  console.log(`✓ Portable Air keywords: ${existing.length} → ${merged.length} (+${added} cable-layer keywords added)`);
}

// ─── Summary ──────────────────────────────────────────────────────────────
const [countRow] = await conn.execute("SELECT COUNT(*) as total FROM contractorRegistry");
console.log(`\nTotal contractors in registry: ${countRow[0].total}`);

const [topRows] = await conn.execute(
  `SELECT canonicalName, atlasRelevanceScore, stateBreakdown
   FROM contractorRegistry
   WHERE atlasRelevanceScore >= 90
   ORDER BY canonicalName ASC`
);
console.log(`\nTop-priority contractors (score ≥ 90): ${topRows.length}`);
for (const r of topRows) {
  console.log(`  ${r.canonicalName} (score: ${r.atlasRelevanceScore})`);
}

await conn.end();
console.log("\n✓ Seed complete.");
