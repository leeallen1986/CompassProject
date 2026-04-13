import 'dotenv/config';
import mysql from 'mysql2/promise';
const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Check pipeline runs
const [runs] = await conn.execute("SELECT * FROM pipelineRuns ORDER BY startedAt DESC LIMIT 5");
console.log("Recent pipeline runs:");
for (const r of runs) {
  console.log(`  ID: ${r.id} | Type: ${r.type} | Status: ${r.status} | Started: ${r.startedAt} | Completed: ${r.completedAt}`);
  if (r.stats) {
    try {
      const stats = typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats;
      console.log(`    Stats: ${JSON.stringify(stats).substring(0, 200)}`);
    } catch(e) { console.log(`    Stats: ${String(r.stats).substring(0, 200)}`); }
  }
  if (r.error) console.log(`    Error: ${r.error}`);
}

// Check latest report date
const [reports] = await conn.execute("SELECT id, weekEnding, generatedAt, projectCount FROM weeklyReports ORDER BY generatedAt DESC LIMIT 3");
console.log("\nLatest weekly reports:");
for (const r of reports) {
  console.log(`  ID: ${r.id} | Week ending: ${r.weekEnding} | Generated: ${r.generatedAt} | Projects: ${r.projectCount}`);
}

// Check project count and latest project dates
const [projCount] = await conn.execute("SELECT COUNT(*) as cnt FROM projects");
const [latestProj] = await conn.execute("SELECT id, name, updatedAt, createdAt FROM projects ORDER BY updatedAt DESC LIMIT 3");
console.log(`\nTotal projects: ${projCount[0].cnt}`);
console.log("Latest updated projects:");
for (const p of latestProj) {
  console.log(`  ${p.name} | Updated: ${p.updatedAt} | Created: ${p.createdAt}`);
}

await conn.end();
