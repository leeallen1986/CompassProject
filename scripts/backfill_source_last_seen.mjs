/**
 * Stage 5B — One-off migration: backfill sourceLastSeenAt for all existing projects.
 * Sets sourceLastSeenAt = lastActivityAt ?? createdAt for every project where
 * sourceLastSeenAt is currently NULL.
 *
 * Safe to run multiple times (only touches NULL rows).
 */
import * as dotenv from "dotenv";
import { createConnection } from "mysql2/promise";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

// Parse mysql2 connection from DATABASE_URL
// Format: mysql://user:pass@host:port/dbname?ssl=...
const url = new URL(DATABASE_URL);
const connection = await createConnection({
  host: url.hostname,
  port: parseInt(url.port || "3306"),
  user: url.username,
  password: url.password,
  database: url.pathname.replace("/", ""),
  ssl: { rejectUnauthorized: false },
});

console.log("[Backfill] Connected to database");

// Count how many projects need backfilling
const [countRows] = await connection.execute(
  "SELECT COUNT(*) as cnt FROM projects WHERE sourceLastSeenAt IS NULL"
);
const total = countRows[0].cnt;
console.log(`[Backfill] Found ${total} projects with NULL sourceLastSeenAt`);

if (total === 0) {
  console.log("[Backfill] Nothing to do — all projects already have sourceLastSeenAt set");
  await connection.end();
  process.exit(0);
}

// Backfill: use COALESCE(lastActivityAt, createdAt) as the fallback freshness date
const [result] = await connection.execute(
  `UPDATE projects
   SET sourceLastSeenAt = COALESCE(lastActivityAt, createdAt)
   WHERE sourceLastSeenAt IS NULL`
);

console.log(`[Backfill] Updated ${result.affectedRows} projects`);

// Verify
const [verifyRows] = await connection.execute(
  "SELECT COUNT(*) as cnt FROM projects WHERE sourceLastSeenAt IS NULL"
);
const remaining = verifyRows[0].cnt;
console.log(`[Backfill] Remaining NULL rows: ${remaining}`);

// Show sample of updated rows
const [sampleRows] = await connection.execute(
  `SELECT id, name, lifecycleStatus, sourceLastSeenAt, lastActivityAt, createdAt
   FROM projects
   ORDER BY sourceLastSeenAt DESC
   LIMIT 5`
);
console.log("[Backfill] Sample of updated projects:");
for (const row of sampleRows) {
  console.log(`  [${row.lifecycleStatus}] ${row.name} → sourceLastSeenAt: ${row.sourceLastSeenAt}`);
}

await connection.end();
console.log("[Backfill] Done.");
