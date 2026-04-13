import 'dotenv/config';
import mysql from 'mysql2/promise';
const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Check the latest failed pipeline run details
const [runs] = await conn.execute("SELECT * FROM pipelineRuns WHERE id = 390001");
const r = runs[0];
console.log("Latest pipeline run (390001):");
console.log(`  Status: ${r.status}`);
console.log(`  Started: ${r.startedAt}`);
console.log(`  Completed: ${r.completedAt}`);
if (r.error) console.log(`  Error: ${r.error}`);
if (r.stats) {
  try {
    const stats = typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats;
    console.log(`  Stats: ${JSON.stringify(stats, null, 2)}`);
  } catch(e) { console.log(`  Stats (raw): ${String(r.stats).substring(0, 500)}`); }
}

// Check all columns in pipelineRuns
const [cols] = await conn.execute("DESCRIBE pipelineRuns");
console.log("\npipelineRuns columns:");
for (const c of cols) console.log(`  ${c.Field} (${c.Type})`);

// Show all fields of the latest run
console.log("\nAll fields of run 390001:");
for (const [key, val] of Object.entries(r)) {
  const v = val ? String(val).substring(0, 300) : 'null';
  console.log(`  ${key}: ${v}`);
}

// Check project freshness
const [projCount] = await conn.execute("SELECT COUNT(*) as cnt FROM projects");
const [latestProj] = await conn.execute("SELECT id, name, updatedAt, createdAt FROM projects ORDER BY updatedAt DESC LIMIT 3");
console.log(`\nTotal projects: ${projCount[0].cnt}`);
console.log("Latest updated projects:");
for (const p of latestProj) {
  console.log(`  ${p.name} | Updated: ${p.updatedAt} | Created: ${p.createdAt}`);
}

await conn.end();
