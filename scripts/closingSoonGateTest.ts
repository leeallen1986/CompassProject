/**
 * closingSoonGateTest.ts
 * Tests the portableAirOpportunityGate on the three Closing Soon projects
 * that appeared in Ryan's digest preview.
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { portableAirOpportunityGate } from "../server/laneScoring";

const conn = await mysql.createConnection(process.env.DATABASE_URL!);

const [rows] = await conn.execute<any[]>(
  `SELECT p.id, p.name, p.sector, p.stage, p.overview, p.equipmentSignals, p.owner, p.opportunityRoute,
          COALESCE(pbs.score, 0) AS portableAirScore
   FROM projects p
   LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Portable Air'
   WHERE p.id IN (870035, 810021, 1110006, 810020, 810019)`
);

await conn.end();

for (const p of rows) {
  let equipmentSignals: string[] = [];
  if (p.equipmentSignals) {
    try {
      const parsed = typeof p.equipmentSignals === 'string' ? JSON.parse(p.equipmentSignals) : p.equipmentSignals;
      equipmentSignals = Array.isArray(parsed) ? parsed : [String(parsed)];
    } catch {
      equipmentSignals = String(p.equipmentSignals).split(',').map((s: string) => s.trim());
    }
  }

  const portableAirScore = Number(p.portableAirScore) || 0;
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

  console.log(`\n[${p.id}] ${p.name}`);
  console.log(`  sector=${p.sector} paScore=${portableAirScore}`);
  console.log(`  owner=${p.owner}`);
  console.log(`  equipmentSignals=${JSON.stringify(equipmentSignals)}`);
  console.log(`  Gate: ${gateResult.pass ? 'PASS' : gateResult.suppressionLevel?.toUpperCase()} — ${gateResult.reason || 'ok'}`);
}
