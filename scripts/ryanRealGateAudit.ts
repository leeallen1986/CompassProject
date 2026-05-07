/**
 * ryanRealGateAudit.ts
 * Uses the REAL portableAirOpportunityGate function from laneScoring.ts
 * to produce an authoritative audit of Ryan's WA digest pool.
 *
 * Run: npx tsx scripts/ryanRealGateAudit.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { portableAirOpportunityGate } from "../server/laneScoring";

const conn = await mysql.createConnection(process.env.DATABASE_URL!);

// ── 1. Find Ryan ──
const [ryanRows] = await conn.execute<any[]>(
  `SELECT u.id, u.name, u.email, up.salesMotion
   FROM users u
   JOIN userProfiles up ON up.userId = u.id
   WHERE u.name LIKE '%Ryan%' OR u.email LIKE '%ryan%'
   LIMIT 1`
);
const ryan = ryanRows[0];
console.log(`\n=== Ryan: id=${ryan.id} name=${ryan.name} email=${ryan.email} salesMotion=${ryan.salesMotion} ===`);

// ── 2. Get Ryan's WA tier1/tier2 pool ──
const waKeywords = ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha", "port hedland", "newman", "geraldton", "bunbury", "broome", "norseman", "murchison", "kwinana"];
const locationClauses = waKeywords.map(k => `LOWER(p.location) LIKE '%${k}%'`).join(" OR ");

const [pool] = await conn.execute<any[]>(
  `SELECT p.id, p.name, p.sector, p.stage, p.priority, p.actionTier, p.location,
          p.projectState, p.owner, p.overview, p.equipmentSignals, p.opportunityRoute,
          COALESCE(pbs.score, 0) AS portableAirScore
   FROM projects p
   LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Portable Air'
   WHERE p.lifecycleStatus = 'active'
     AND p.actionTier IN ('tier1_actionable', 'tier2_warm')
     AND (p.projectState = 'WA' OR ${locationClauses})
   ORDER BY p.actionTier ASC, p.priority DESC, CAST(COALESCE(pbs.score, 0) AS DECIMAL) DESC
   LIMIT 60`
);

console.log(`\n=== Ryan's WA tier1/tier2 pool (${pool.length} projects) ===`);
console.log(`${"ID".padEnd(8)} ${"Name".padEnd(55)} ${"Sector".padEnd(12)} ${"PaScore".padEnd(8)} ${"Gate".padEnd(15)} Reason`);
console.log("-".repeat(150));

let passCount = 0, monitorCount = 0, suppressCount = 0;
const passProjects: any[] = [];
const monitorProjects: any[] = [];
const suppressProjects: any[] = [];

for (const p of pool) {
  const portableAirScore = Number(p.portableAirScore) || 0;
  
  // Parse equipmentSignals if it's a JSON string
  let equipmentSignals: string[] = [];
  if (p.equipmentSignals) {
    try {
      const parsed = typeof p.equipmentSignals === 'string' ? JSON.parse(p.equipmentSignals) : p.equipmentSignals;
      equipmentSignals = Array.isArray(parsed) ? parsed : [String(parsed)];
    } catch {
      equipmentSignals = [String(p.equipmentSignals)];
    }
  }

  const gateResult = portableAirOpportunityGate(
    {
      name: p.name || "",
      overview: p.overview || null,
      sector: p.sector || "",
      stage: p.stage || null,
      opportunityRoute: p.opportunityRoute || "",
      owner: p.owner || "",
      equipmentSignals,
    },
    portableAirScore,
  );

  const nameShort = (p.name || "").substring(0, 54);
  const sectorShort = (p.sector || "").substring(0, 11);

  if (gateResult.pass) {
    passCount++;
    passProjects.push({ ...p, portableAirScore });
    console.log(`${String(p.id).padEnd(8)} ${nameShort.padEnd(55)} ${sectorShort.padEnd(12)} ${String(portableAirScore).padEnd(8)} ${"PASS".padEnd(15)}`);
  } else if (gateResult.suppressionLevel === 'suppress') {
    suppressCount++;
    suppressProjects.push({ ...p, portableAirScore, reason: gateResult.reason });
    console.log(`${String(p.id).padEnd(8)} ${nameShort.padEnd(55)} ${sectorShort.padEnd(12)} ${String(portableAirScore).padEnd(8)} ${"SUPPRESS".padEnd(15)} ${gateResult.reason}`);
  } else {
    monitorCount++;
    monitorProjects.push({ ...p, portableAirScore, reason: gateResult.reason });
    console.log(`${String(p.id).padEnd(8)} ${nameShort.padEnd(55)} ${sectorShort.padEnd(12)} ${String(portableAirScore).padEnd(8)} ${"MONITOR".padEnd(15)} ${gateResult.reason}`);
  }
}

console.log(`\n=== Summary ===`);
console.log(`  PASS:     ${passCount} (eligible for Must Act / Closing Soon / Waiting)`);
console.log(`  MONITOR:  ${monitorCount} (demoted to monitor_only, excluded from digest sections)`);
console.log(`  SUPPRESS: ${suppressCount} (hard-suppressed, never shown)`);
console.log(`  Total:    ${pool.length}`);

console.log(`\n=== Suppressed Projects (hard-suppress) ===`);
for (const p of suppressProjects) {
  console.log(`  [${p.id}] ${p.name}`);
  console.log(`    Reason: ${p.reason}`);
}

console.log(`\n=== Monitor-Only Projects (excluded from digest sections) ===`);
for (const p of monitorProjects) {
  console.log(`  [${p.id}] ${p.name} (PA score: ${p.portableAirScore})`);
  console.log(`    Reason: ${p.reason}`);
}

console.log(`\n=== Top 10 Eligible Projects (PASS) by PA Score ===`);
const top10 = passProjects.slice(0, 10);
for (let i = 0; i < top10.length; i++) {
  const p = top10[i];
  console.log(`  ${i+1}. [${p.id}] ${p.name}`);
  console.log(`     Sector: ${p.sector} | Stage: ${p.stage} | PA Score: ${p.portableAirScore} | Priority: ${p.priority}`);
}

// ── 3. Check if there is a stale/cached digest preview ──
const [digestRows] = await conn.execute<any[]>(
  `SELECT id, userId, createdAt, status, sections
   FROM digestSendControl
   WHERE userId = ?
   ORDER BY createdAt DESC
   LIMIT 3`,
  [ryan.id]
);
console.log(`\n=== Ryan's recent digest records (${digestRows.length}) ===`);
for (const d of digestRows) {
  const age = Math.round((Date.now() - new Date(d.createdAt).getTime()) / 1000 / 60);
  console.log(`  id=${d.id} status=${d.status} createdAt=${d.createdAt} (${age} mins ago)`);
}

await conn.end();
