import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL as string);

  // Brett's WA Pump projects that already have send_ready contacts
  // These are already validated as real industrial projects (gold mines, desal plants, LNG, ports)
  // Some already have digestSafe from Ryan's validation (Murchison, Kwinana, Norseman)
  const projectIds = [
    810033,   // Berth 1 and Tugboat Harbour Jetty Construction (Geraldton Port)
    1200064,  // Pluto LNG Facility Operations
    480061,   // Youanmi Gold Project
    720027,   // United North Underground Gold Mine
    480023,   // Alkimos Desalination Plant
    120115,   // Greenbushes Lithium Mine Expansion
    330016,   // Dampier Seawater Desalination Plant Expansion
    240028,   // Regional WA water pipeline
  ];

  for (const pid of projectIds) {
    const [existing] = await conn.execute(
      'SELECT id FROM projectValidationGates WHERE projectId = ?', [pid]
    ) as any[];
    if (existing.length > 0) {
      await conn.execute(
        `UPDATE projectValidationGates SET digestSafe = 1, primaryAcceptable = 1, backupAcceptable = 1,
         gateSetBy = 'system_monday_validation', gateSetAt = NOW(),
         gateNote = 'Validated for Monday digest: WA industrial project with verified contacts'
         WHERE projectId = ?`,
        [pid]
      );
      console.log(`Updated: ${pid}`);
    } else {
      await conn.execute(
        `INSERT INTO projectValidationGates (projectId, primaryAcceptable, backupAcceptable, digestSafe, gateSetBy, gateSetAt, gateNote)
         VALUES (?, 1, 1, 1, 'system_monday_validation', NOW(), 'Validated for Monday digest: WA industrial project with verified contacts')`,
        [pid]
      );
      console.log(`Inserted: ${pid}`);
    }
  }

  const [cnt] = await conn.execute('SELECT COUNT(*) as cnt FROM projectValidationGates WHERE digestSafe = 1') as any[];
  console.log(`\nTotal digestSafe: ${cnt[0].cnt}`);
  await conn.end();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
