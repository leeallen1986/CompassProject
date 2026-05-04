import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env
try {
  const env = readFileSync(resolve('/home/ubuntu/atlas-copco-intelligence/.env'), 'utf8');
  for (const line of env.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
} catch {}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }

const conn = await createConnection(dbUrl);

// Check pipeline_runs table exists
const [tables] = await conn.execute("SHOW TABLES LIKE 'pipelineRuns'");
if (tables.length === 0) {
  console.log('No pipelineRuns table found');
  await conn.end();
  process.exit(0);
}

// Get column names first
const [cols] = await conn.execute("DESCRIBE pipelineRuns");
console.log('Columns:', cols.map(c => c.Field));

// Get recent runs
const [rows] = await conn.execute(`
  SELECT * FROM pipelineRuns ORDER BY startedAt DESC LIMIT 5
`);

console.log('\n=== PIPELINE RUN HISTORY (last 5) ===\n');
for (const row of rows) {
  const durationMin = row.durationMs ? Math.round(row.durationMs / 60000) : 
    row.startedAt ? Math.round((Date.now() - new Date(row.startedAt).getTime()) / 60000) : 'N/A';
  console.log(`Run #${row.id}`);
  console.log(`  Status:       ${row.status}`);
  console.log(`  Triggered by: ${row.triggeredBy || 'N/A'}`);
  console.log(`  Started:      ${row.startedAt}`);
  console.log(`  Completed:    ${row.completedAt || 'STILL RUNNING'}`);
  console.log(`  Duration:     ${durationMin} min`);
  console.log(`  Articles:     ${row.articlesExtracted ?? 'N/A'} extracted`);
  console.log(`  Projects:     ${row.projectsCreated ?? 'N/A'} created, ${row.projectsDuplicate ?? 'N/A'} dupes`);
  console.log(`  Contacts:     ${row.contactsEnriched ?? 'N/A'} enriched`);
  console.log(`  Apollo:       ${row.apolloCreditsUsed ?? 'N/A'} credits used`);
  if (row.errors) console.log(`  Errors:       ${typeof row.errors === 'string' ? row.errors.substring(0, 200) : JSON.stringify(row.errors).substring(0, 200)}`);
  if (row.steps) {
    const steps = typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps;
    if (Array.isArray(steps)) {
      const lastStep = steps[steps.length - 1];
      console.log(`  Last step:    ${lastStep?.name || lastStep?.step || JSON.stringify(lastStep).substring(0, 100)}`);
    }
  }
  console.log('');
}

await conn.end();
