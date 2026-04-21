/**
 * Stage 5C — Diagnostic: find near-duplicate project clusters in the live database.
 * Uses name substring matching within same sector to identify candidates.
 * Output saved to scripts/duplicate_clusters.json for analysis.
 */
import * as dotenv from "dotenv";
import { createConnection } from "mysql2/promise";
import { writeFileSync } from "fs";

dotenv.config();
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

// Parse DATABASE_URL
const url = new URL(DATABASE_URL);
const sslParam = url.searchParams.get("ssl");
const conn = await createConnection({
  host: url.hostname,
  port: parseInt(url.port || "3306"),
  user: url.username,
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  ssl: sslParam ? { rejectUnauthorized: false } : undefined,
});

console.log("[DupeFinder] Connected to database");

// Step 1: Get all non-archived projects
const [allProjects] = await conn.execute(`
  SELECT id, name, location, sector, lifecycleStatus, priority, actionTier, 
         sourceLastSeenAt, createdAt, keepFlag
  FROM projects
  WHERE lifecycleStatus NOT IN ('archived')
  ORDER BY id
`);

console.log(`[DupeFinder] Loaded ${allProjects.length} non-archived projects`);

// Step 2: Find clusters using name similarity
const clusters = [];
const clustered = new Set();

for (let i = 0; i < allProjects.length; i++) {
  const p1 = allProjects[i];
  if (clustered.has(p1.id)) continue;

  const norm1 = p1.name.toLowerCase().trim().replace(/\s+/g, " ");
  const cluster = [p1];

  for (let j = i + 1; j < allProjects.length; j++) {
    const p2 = allProjects[j];
    if (clustered.has(p2.id)) continue;

    const norm2 = p2.name.toLowerCase().trim().replace(/\s+/g, " ");

    // Exact match
    if (norm1 === norm2) {
      cluster.push(p2);
      continue;
    }

    // Same sector + substring match (one name contains the other, min 20 chars)
    if (p1.sector === p2.sector) {
      const minLen = Math.min(norm1.length, norm2.length);
      if (minLen >= 20) {
        if (norm1.includes(norm2) || norm2.includes(norm1)) {
          cluster.push(p2);
          continue;
        }
      }
    }

    // Same sector + location + significant word overlap
    if (p1.sector === p2.sector && p1.location && p2.location) {
      const loc1 = p1.location.toLowerCase();
      const loc2 = p2.location.toLowerCase();
      const locMatch = loc1.includes(loc2.split(",")[0]) || loc2.includes(loc1.split(",")[0]);

      if (locMatch) {
        // Check word overlap
        const words1 = new Set(norm1.split(/\s+/).filter(w => w.length > 4));
        const words2 = norm2.split(/\s+/).filter(w => w.length > 4);
        const overlap = words2.filter(w => words1.has(w)).length;
        const overlapRatio = overlap / Math.max(words1.size, words2.length, 1);
        if (overlapRatio >= 0.6 && overlap >= 3) {
          cluster.push(p2);
          continue;
        }
      }
    }
  }

  if (cluster.length > 1) {
    cluster.forEach(p => clustered.add(p.id));
    clusters.push({
      clusterSize: cluster.length,
      projects: cluster.map(p => ({
        id: p.id,
        name: p.name,
        location: p.location,
        sector: p.sector,
        lifecycleStatus: p.lifecycleStatus,
        priority: p.priority,
        actionTier: p.actionTier,
        sourceLastSeenAt: p.sourceLastSeenAt,
        createdAt: p.createdAt,
        keepFlag: p.keepFlag,
      })),
    });
  }
}

console.log(`[DupeFinder] Found ${clusters.length} duplicate clusters`);
console.log(`[DupeFinder] Total projects in clusters: ${clusters.reduce((s, c) => s + c.clusterSize, 0)}`);

// Print summary
clusters.forEach((c, i) => {
  console.log(`\nCluster ${i + 1} (${c.clusterSize} projects):`);
  c.projects.forEach(p => console.log(`  [${p.id}] ${p.name} | ${p.location} | ${p.lifecycleStatus} | ${p.priority}`));
});

writeFileSync(
  "/home/ubuntu/atlas-copco-intelligence/scripts/duplicate_clusters.json",
  JSON.stringify({ total: clusters.length, clusters }, null, 2)
);
console.log("\n[DupeFinder] Results saved to scripts/duplicate_clusters.json");

await conn.end();
