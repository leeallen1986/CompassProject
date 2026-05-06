import { getDb } from './server/db';
import { sql } from 'drizzle-orm';

const PROJECTS_TO_GATE = [
  { id: 450042, name: "Port Hedland Car Dumper 6 Project", reason: "WA confirmed (Port Hedland, WA), HOT mining, BHP/Monadelphous, construction underway, 6 Apollo-verified send_ready contacts (verScore 95, emailVerified)" },
  { id: 330015, name: "Norseman Gold - Third Underground Mine Development", reason: "WA confirmed (Norseman, WA), HOT mining, Pantoro Gold/Macmahon/Byrnecut, 12 Apollo-verified send_ready contacts (verScore 95, emailVerified)" },
  { id: 1020027, name: "Murchison Gold Project underground development", reason: "WA confirmed (Murchison, WA), HOT mining, Meeka Metals, 3 Apollo-verified send_ready contacts incl. Procurement Superintendent (verScore 95, emailVerified)" },
];

const GATE_SET_BY = 1;

async function main() {
  const db = await getDb();

  for (const p of PROJECTS_TO_GATE) {
    console.log(`\nGating project ${p.id}: ${p.name}`);

    const existing = await db.execute(sql`
      SELECT projectId, digestSafe, primaryAcceptable FROM projectValidationGates WHERE projectId = ${p.id}
    `);
    const existingRows = (existing as any)[0] as any[];

    if (existingRows.length > 0) {
      const gate = existingRows[0];
      console.log(`  Existing gate: digestSafe=${gate.digestSafe}, primaryAcceptable=${gate.primaryAcceptable}`);
      await db.execute(sql`
        UPDATE projectValidationGates
        SET digestSafe = 1,
            primaryAcceptable = 1,
            gateSetBy = ${GATE_SET_BY},
            gateSetAt = NOW(),
            gateNote = ${p.reason}
        WHERE projectId = ${p.id}
      `);
      console.log(`  Updated: digestSafe=true, primaryAcceptable=true`);
    } else {
      await db.execute(sql`
        INSERT INTO projectValidationGates (projectId, primaryAcceptable, backupAcceptable, digestSafe, gateSetBy, gateSetAt, gateNote)
        VALUES (${p.id}, 1, 0, 1, ${GATE_SET_BY}, NOW(), ${p.reason})
      `);
      console.log(`  Inserted: digestSafe=true, primaryAcceptable=true`);
    }

    await db.execute(sql`
      UPDATE projects SET discoveryStatus = 'send_ready_contact' WHERE id = ${p.id} AND discoveryStatus != 'send_ready_contact'
    `);
    console.log(`  Discovery status set to send_ready_contact`);
  }

  console.log('\n===== VERIFICATION =====');
  const verify = await db.execute(sql`
    SELECT pvg.projectId, pvg.digestSafe, pvg.primaryAcceptable, pvg.gateNote,
           p.name, p.projectState, p.location,
           (SELECT COUNT(*) FROM contacts c JOIN contactProjects cp ON cp.contactId = c.id
            WHERE cp.projectId = p.id AND c.contactTrustTier = 'send_ready') as sendReadyCount
    FROM projectValidationGates pvg
    JOIN projects p ON p.id = pvg.projectId
    WHERE pvg.projectId IN (450042, 330015, 1020027)
  `);
  const verRows = (verify as any)[0] as any[];
  for (const r of verRows) {
    console.log(`\nID: ${r.projectId} | ${r.name}`);
    console.log(`  State: ${r.projectState} | Location: ${r.location}`);
    console.log(`  digestSafe: ${r.digestSafe} | primaryAcceptable: ${r.primaryAcceptable}`);
    console.log(`  Send-Ready Contacts: ${r.sendReadyCount}`);
  }

  const total = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM projectValidationGates WHERE digestSafe = 1
  `);
  const totalCount = Number(((total as any)[0] as any[])[0]?.cnt || 0);
  console.log(`\nTotal digest-safe projects: ${totalCount}`);
  console.log(`Threshold (3 required): ${totalCount >= 3 ? 'MET' : 'NOT MET'}`);

  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
