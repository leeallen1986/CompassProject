/**
 * seed-user-profiles.mjs
 * Backfills userProfiles for the 6 confirmed Atlas Copco reps.
 * Uses INSERT ... ON DUPLICATE KEY UPDATE so re-runs are idempotent.
 *
 * User IDs from live DB:
 *   840008  → Leo Williams
 *   2340043 → Ryan Pemberton
 *   2550006 → Brett Hansen
 *   2820073 → Daniel Zec
 *   3630009 → Dan Day
 *   3870014 → Amit Bhargava
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ── Profile definitions ──────────────────────────────────────────────────────

const profiles = [
  {
    userId: 2340043, // Ryan Pemberton
    companyName: "Atlas Copco",
    territories: ["WA"],
    remoteMetroOnly: "both",
    industries: ["mining_exploration", "mining_production", "oil_gas", "infrastructure"],
    offerCategories: ["equipment", "rentals", "services"],
    customerTypes: ["principal_contractor", "owner_operator", "subcontractor"],
    dealSizeMin: "$25k",
    dealSizeMax: "$500k+",
    stageTiming: ["early_signal", "planning", "tendering", "awarded_mobilizing"],
    buyerRoles: ["procurement", "project_manager", "engineering", "operations"],
    assignedBusinessLines: ["Portable Air", "PT Capital Sales"],
    sectorFocus: ["mining", "oil_gas", "infrastructure", "energy"],
    onboardingCompleted: true,
  },
  {
    userId: 2550006, // Brett Hansen
    companyName: "Atlas Copco",
    territories: ["WA", "NT"],
    remoteMetroOnly: "both",
    industries: ["mining_exploration", "mining_production", "oil_gas", "infrastructure"],
    offerCategories: ["equipment", "rentals", "services"],
    customerTypes: ["principal_contractor", "owner_operator", "subcontractor"],
    dealSizeMin: "$25k",
    dealSizeMax: "$500k+",
    stageTiming: ["early_signal", "planning", "tendering", "awarded_mobilizing"],
    buyerRoles: ["procurement", "project_manager", "engineering", "operations"],
    assignedBusinessLines: ["Portable Air", "Pump (Flow)", "Dewatering Pumps"],
    sectorFocus: ["mining", "oil_gas", "infrastructure"],
    onboardingCompleted: true,
  },
  {
    userId: 2820073, // Daniel Zec
    companyName: "Atlas Copco",
    territories: ["NSW", "VIC", "SA", "TAS"],
    remoteMetroOnly: "both",
    industries: ["mining_exploration", "mining_production", "infrastructure", "construction"],
    offerCategories: ["equipment", "rentals", "services"],
    customerTypes: ["principal_contractor", "owner_operator", "subcontractor"],
    dealSizeMin: "$25k",
    dealSizeMax: "$500k+",
    stageTiming: ["early_signal", "planning", "tendering", "awarded_mobilizing"],
    buyerRoles: ["procurement", "project_manager", "engineering", "operations"],
    assignedBusinessLines: ["Portable Air"],
    sectorFocus: ["mining", "infrastructure", "oil_gas", "industrial"],
    onboardingCompleted: true,
  },
  {
    userId: 3630009, // Dan Day
    companyName: "Atlas Copco",
    territories: ["SA", "QLD", "VIC", "NSW", "TAS"],
    remoteMetroOnly: "both",
    industries: ["mining_exploration", "mining_production", "water", "civils", "infrastructure"],
    offerCategories: ["equipment", "rentals", "services"],
    customerTypes: ["principal_contractor", "owner_operator", "subcontractor"],
    dealSizeMin: "$25k",
    dealSizeMax: "$500k+",
    stageTiming: ["early_signal", "planning", "tendering", "awarded_mobilizing"],
    buyerRoles: ["procurement", "project_manager", "engineering", "operations"],
    assignedBusinessLines: ["Pump (Flow)", "Dewatering Pumps"],
    sectorFocus: ["mining", "infrastructure", "water", "civils"],
    onboardingCompleted: true,
  },
  {
    userId: 840008, // Leo Williams
    companyName: "Atlas Copco",
    territories: ["WA", "NSW", "QLD", "VIC", "SA", "TAS", "NT", "ACT"],
    remoteMetroOnly: "both",
    industries: ["mining_exploration", "mining_production", "oil_gas", "infrastructure", "energy", "defence"],
    offerCategories: ["equipment", "rentals", "services"],
    customerTypes: ["principal_contractor", "owner_operator", "subcontractor"],
    dealSizeMin: "$25k",
    dealSizeMax: "$500k+",
    stageTiming: ["early_signal", "planning", "tendering", "awarded_mobilizing"],
    buyerRoles: ["procurement", "project_manager", "engineering", "operations"],
    assignedBusinessLines: ["Portable Air"],
    sectorFocus: ["mining", "oil_gas", "infrastructure", "industrial"],
    onboardingCompleted: true,
  },
  {
    userId: 3870014, // Amit Bhargava
    companyName: "Atlas Copco",
    territories: ["WA", "NSW", "QLD", "VIC", "SA", "TAS", "NT", "ACT"],
    remoteMetroOnly: "both",
    industries: ["industrial_maintenance", "shutdowns", "infrastructure", "energy", "construction"],
    offerCategories: ["equipment", "rentals", "services"],
    customerTypes: ["principal_contractor", "owner_operator", "subcontractor"],
    dealSizeMin: "$25k",
    dealSizeMax: "$500k+",
    stageTiming: ["early_signal", "planning", "tendering", "awarded_mobilizing"],
    buyerRoles: ["procurement", "project_manager", "engineering", "operations"],
    assignedBusinessLines: ["PAL", "BESS"],
    sectorFocus: ["energy", "infrastructure", "industrial"],
    onboardingCompleted: true,
  },
];

// ── Upsert each profile ───────────────────────────────────────────────────────

console.log("Seeding user profiles...\n");

for (const p of profiles) {
  const [userRow] = await conn.query("SELECT name FROM users WHERE id = ?", [p.userId]);
  const name = userRow[0]?.name ?? `userId=${p.userId}`;

  await conn.query(
    `INSERT INTO userProfiles
       (userId, companyName, territories, remoteMetroOnly, industries,
        offerCategories, customerTypes, dealSizeMin, dealSizeMax,
        stageTiming, buyerRoles, assignedBusinessLines, sectorFocus,
        onboardingCompleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       companyName            = VALUES(companyName),
       territories            = VALUES(territories),
       remoteMetroOnly        = VALUES(remoteMetroOnly),
       industries             = VALUES(industries),
       offerCategories        = VALUES(offerCategories),
       customerTypes          = VALUES(customerTypes),
       dealSizeMin            = VALUES(dealSizeMin),
       dealSizeMax            = VALUES(dealSizeMax),
       stageTiming            = VALUES(stageTiming),
       buyerRoles             = VALUES(buyerRoles),
       assignedBusinessLines  = VALUES(assignedBusinessLines),
       sectorFocus            = VALUES(sectorFocus),
       onboardingCompleted    = VALUES(onboardingCompleted)`,
    [
      p.userId,
      p.companyName,
      JSON.stringify(p.territories),
      p.remoteMetroOnly,
      JSON.stringify(p.industries),
      JSON.stringify(p.offerCategories),
      JSON.stringify(p.customerTypes),
      p.dealSizeMin,
      p.dealSizeMax,
      JSON.stringify(p.stageTiming),
      JSON.stringify(p.buyerRoles),
      JSON.stringify(p.assignedBusinessLines),
      JSON.stringify(p.sectorFocus),
      p.onboardingCompleted ? 1 : 0,
    ]
  );

  console.log(`  ✓ ${name}`);
  console.log(`    territories: ${p.territories.join(", ")}`);
  console.log(`    BLs: ${p.assignedBusinessLines.join(", ")}`);
  console.log(`    sectors: ${p.sectorFocus.join(", ")}\n`);
}

// ── Verify ────────────────────────────────────────────────────────────────────

const [rows] = await conn.query(
  `SELECT u.name, p.territories, p.assignedBusinessLines, p.sectorFocus
   FROM userProfiles p
   JOIN users u ON u.id = p.userId
   WHERE p.onboardingCompleted = 1
   ORDER BY u.name`
);

console.log("── Seeded profiles ──────────────────────────────────────────────");
for (const r of rows) {
  const t = JSON.parse(Buffer.isBuffer(r.territories) ? r.territories.toString() : r.territories || "[]");
  const b = JSON.parse(Buffer.isBuffer(r.assignedBusinessLines) ? r.assignedBusinessLines.toString() : r.assignedBusinessLines || "[]");
  console.log(`  ${r.name}: [${t.join(",")}] | ${b.join(", ")}`);
}

await conn.end();
console.log("\n✓ Done.");
