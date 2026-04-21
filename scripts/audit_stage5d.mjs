/**
 * Stage 5D — Live data audit
 * Samples current project data to understand:
 *  1. Distribution of free-text stage values
 *  2. Distribution of sector, priority, lifecycleStatus
 *  3. Projects with no owner/location (suppression candidates)
 *  4. Current active project count (before/after baseline)
 *  5. Sample project names for macro/background classification
 */
import * as dotenv from "dotenv";
import { createConnection } from "mysql2/promise";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

console.log("\n=== 1. LIFECYCLE STATUS DISTRIBUTION ===");
const [lifecycle] = await conn.execute(
  `SELECT lifecycleStatus, COUNT(*) as cnt FROM projects GROUP BY lifecycleStatus ORDER BY cnt DESC`
);
console.table(lifecycle);

console.log("\n=== 2. PRIORITY DISTRIBUTION (active only) ===");
const [priority] = await conn.execute(
  `SELECT priority, COUNT(*) as cnt FROM projects WHERE lifecycleStatus = 'active' GROUP BY priority ORDER BY cnt DESC`
);
console.table(priority);

console.log("\n=== 3. SECTOR DISTRIBUTION (active only) ===");
const [sector] = await conn.execute(
  `SELECT sector, COUNT(*) as cnt FROM projects WHERE lifecycleStatus = 'active' GROUP BY sector ORDER BY cnt DESC LIMIT 20`
);
console.table(sector);

console.log("\n=== 4. FREE-TEXT STAGE VALUE DISTRIBUTION (all, top 40) ===");
const [stages] = await conn.execute(
  `SELECT stage, COUNT(*) as cnt FROM projects GROUP BY stage ORDER BY cnt DESC LIMIT 40`
);
console.table(stages);

console.log("\n=== 5. PROJECTS WITH NO OWNER AND GENERIC LOCATION (suppression candidates) ===");
const [noOwner] = await conn.execute(
  `SELECT COUNT(*) as cnt FROM projects 
   WHERE lifecycleStatus = 'active'
   AND (owner IS NULL OR TRIM(owner) = '' OR LOWER(owner) IN ('unknown','n/a','tbc','tbd'))
   AND (location IS NULL OR TRIM(location) = '' OR LOWER(location) IN ('unknown','n/a','australia','national','tbc','tbd'))`
);
console.table(noOwner);

console.log("\n=== 6. SAMPLE PROJECT NAMES — likely macro/policy items ===");
const [macroSamples] = await conn.execute(
  `SELECT id, name, stage, sector, priority, owner, location FROM projects
   WHERE lifecycleStatus = 'active'
   AND (
     LOWER(name) LIKE '%roadmap%' OR
     LOWER(name) LIKE '%strategy%' OR
     LOWER(name) LIKE '%policy%' OR
     LOWER(name) LIKE '%framework%' OR
     LOWER(name) LIKE '%critical mineral%' OR
     LOWER(name) LIKE '%national rollout%' OR
     LOWER(name) LIKE '%market update%' OR
     LOWER(name) LIKE '%industry update%' OR
     LOWER(name) LIKE '%transition%' AND LOWER(name) NOT LIKE '%energy transition project%'
   )
   LIMIT 20`
);
console.table(macroSamples);

console.log("\n=== 7. SAMPLE PROJECT NAMES — likely completed/cancelled ===");
const [completedSamples] = await conn.execute(
  `SELECT id, name, stage, sector, priority, lifecycleStatus FROM projects
   WHERE (
     LOWER(stage) LIKE '%complet%' OR
     LOWER(stage) LIKE '%commission%' OR
     LOWER(stage) LIKE '%decommission%' OR
     LOWER(stage) LIKE '%cancel%' OR
     LOWER(stage) LIKE '%closed%' OR
     LOWER(stage) LIKE '%withdrawn%' OR
     LOWER(name) LIKE '%completed%' OR
     LOWER(name) LIKE '%commissioned%'
   )
   LIMIT 20`
);
console.table(completedSamples);

console.log("\n=== 8. SAMPLE PROJECT NAMES — likely background/operational accounts ===");
const [opSamples] = await conn.execute(
  `SELECT id, name, stage, sector, priority, owner, location FROM projects
   WHERE lifecycleStatus = 'active'
   AND (
     LOWER(stage) LIKE '%operational%' OR
     LOWER(stage) LIKE '%operating%' OR
     LOWER(name) LIKE '%operations%' AND LOWER(name) NOT LIKE '%expansion%' AND LOWER(name) NOT LIKE '%upgrade%'
   )
   LIMIT 20`
);
console.table(opSamples);

console.log("\n=== 9. SAMPLE PROJECT NAMES — AusTender generic contract IDs ===");
const [austenderSamples] = await conn.execute(
  `SELECT id, name, stage, sector, priority, owner, location FROM projects
   WHERE lifecycleStatus = 'active'
   AND (
     name REGEXP '^[0-9]{4,}' OR
     name REGEXP '^CN[0-9]+' OR
     name REGEXP '^AT[0-9]+' OR
     LOWER(name) LIKE 'contract %' AND LENGTH(name) < 30
   )
   LIMIT 15`
);
console.table(austenderSamples);

console.log("\n=== 10. TOTAL ACTIVE PROJECT COUNT (current default view baseline) ===");
const [total] = await conn.execute(
  `SELECT COUNT(*) as total_active FROM projects WHERE lifecycleStatus = 'active'`
);
console.table(total);

console.log("\n=== 11. SAMPLE HIGH-QUALITY OPPORTUNITIES (hot, active, with owner) ===");
const [hotSamples] = await conn.execute(
  `SELECT id, name, stage, sector, priority, owner, location FROM projects
   WHERE lifecycleStatus = 'active' AND priority = 'hot'
   AND owner IS NOT NULL AND TRIM(owner) != ''
   ORDER BY id DESC
   LIMIT 15`
);
console.table(hotSamples);

await conn.end();
console.log("\n=== AUDIT COMPLETE ===");
