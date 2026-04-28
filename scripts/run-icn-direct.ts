/**
 * Direct ICN Upsert Engine invocation script.
 * Run with: pnpm tsx scripts/run-icn-direct.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { runIcnScraper } from "../server/icnScraper";
import { getDb } from "../server/db";
import { projects } from "../drizzle/schema";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== ICN UPSERT ENGINE — DIRECT RUN ===");
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log("");

  // Capture before state
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const beforeRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      priority: projects.priority,
      lifecycleStatus: projects.lifecycleStatus,
      lastActivityAt: projects.lastActivityAt,
      lastIcnSeenAt: projects.lastIcnSeenAt,
    })
    .from(projects)
    .where(sql`${projects.projectKey} LIKE 'icn-%'`);

  const now = new Date();
  const beforeMap = new Map(beforeRows.map(r => [r.id, {
    ...r,
    daysSince: r.lastActivityAt ? Math.round((now.getTime() - new Date(r.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24)) : 999,
  }]));

  console.log(`BEFORE: ${beforeRows.length} ICN projects in DB`);
  const beforeVisible = beforeRows.filter(r => {
    const days = r.lastActivityAt ? Math.round((now.getTime() - new Date(r.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24)) : 999;
    return days <= 30;
  });
  console.log(`BEFORE: ${beforeVisible.length}/${beforeRows.length} visible (lastActivityAt <= 30 days)`);
  console.log("");

  // Run the scraper
  console.log("Running ICN upsert engine...");
  const result = await runIcnScraper();
  console.log("");
  console.log("=== SCRAPER RESULT ===");
  console.log(`  totalFetched:     ${result.totalFetched}`);
  console.log(`  totalNewProjects: ${result.totalNewProjects}`);
  console.log(`  totalUpdated:     ${result.totalUpdated}`);
  console.log(`  reactivated:      ${result.reactivated.length}`);
  console.log(`  totalErrors:      ${result.totalErrors}`);
  console.log(`  duration:         ${result.duration}s`);
  if (result.errors.length > 0) {
    console.log(`  errors: ${result.errors.join(", ")}`);
  }
  console.log("");

  // Capture after state
  const afterRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      priority: projects.priority,
      lifecycleStatus: projects.lifecycleStatus,
      lastActivityAt: projects.lastActivityAt,
      lastIcnSeenAt: projects.lastIcnSeenAt,
    })
    .from(projects)
    .where(sql`${projects.projectKey} LIKE 'icn-%'`);

  const afterNow = new Date();
  const afterVisible = afterRows.filter(r => {
    const days = r.lastActivityAt ? Math.round((afterNow.getTime() - new Date(r.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24)) : 999;
    return days <= 30;
  });

  console.log(`AFTER: ${afterRows.length} ICN projects in DB`);
  console.log(`AFTER: ${afterVisible.length}/${afterRows.length} visible (lastActivityAt <= 30 days)`);
  console.log("");

  // Before/after comparison for high-value projects
  const highValueKeywords = ["AUKUS", "BAE Systems", "Sydney Metro", "North East Link", "Snowy Mountains"];
  console.log("=== HIGH-VALUE PROJECTS BEFORE/AFTER ===");
  for (const kw of highValueKeywords) {
    const afterRow = afterRows.find(r => r.name.toLowerCase().includes(kw.toLowerCase()));
    if (!afterRow) {
      console.log(`  ${kw}: NOT IN DB`);
      continue;
    }
    const beforeRow = beforeMap.get(afterRow.id);
    const afterDays = afterRow.lastActivityAt
      ? Math.round((afterNow.getTime() - new Date(afterRow.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24))
      : 999;
    const beforeDays = beforeRow?.daysSince ?? 999;
    const wasStale = beforeDays > 30;
    const nowVisible = afterDays <= 30;
    const status = wasStale && nowVisible ? "REACTIVATED ✓" : nowVisible ? "VISIBLE" : "STILL STALE";
    console.log(`  [${status}] ${afterRow.name.slice(0, 55)}`);
    console.log(`    id=${afterRow.id} priority=${afterRow.priority}`);
    console.log(`    BEFORE: lastActivityAt=${beforeRow?.lastActivityAt ? new Date(beforeRow.lastActivityAt).toISOString() : 'NULL'} (${beforeDays}d ago)`);
    console.log(`    AFTER:  lastActivityAt=${afterRow.lastActivityAt ? new Date(afterRow.lastActivityAt).toISOString() : 'NULL'} (${afterDays}d ago)`);
    console.log(`    lastIcnSeenAt=${afterRow.lastIcnSeenAt ? new Date(afterRow.lastIcnSeenAt).toISOString() : 'NULL'}`);
    console.log("");
  }

  // Full before/after table
  console.log("=== FULL BEFORE/AFTER TABLE ===");
  console.log(`${"Name".padEnd(55)} | ${"BEFORE".padEnd(14)} | ${"AFTER".padEnd(14)} | Change`);
  console.log("-".repeat(110));
  for (const afterRow of afterRows.sort((a, b) => a.name.localeCompare(b.name))) {
    const beforeRow = beforeMap.get(afterRow.id);
    const afterDays = afterRow.lastActivityAt
      ? Math.round((afterNow.getTime() - new Date(afterRow.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24))
      : 999;
    const beforeDays = beforeRow?.daysSince ?? 999;
    const wasStale = beforeDays > 30;
    const nowVisible = afterDays <= 30;
    const change = !beforeRow ? "NEW" : wasStale && nowVisible ? "REACTIVATED" : wasStale && !nowVisible ? "STILL STALE" : "REFRESHED";
    const beforeLabel = beforeRow ? `${beforeDays}d ago` : "NEW";
    const afterLabel = `${afterDays}d ago`;
    console.log(`${afterRow.name.slice(0, 55).padEnd(55)} | ${beforeLabel.padEnd(14)} | ${afterLabel.padEnd(14)} | ${change}`);
  }

  console.log("");
  console.log("=== DUPLICATE CHECK ===");
  // Check for any duplicates by name similarity
  const allIcnRows = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(sql`${projects.projectKey} LIKE 'icn-%'`);
  
  const namesSeen = new Map<string, number[]>();
  for (const r of allIcnRows) {
    const key = r.name.toLowerCase().trim();
    if (!namesSeen.has(key)) namesSeen.set(key, []);
    namesSeen.get(key)!.push(r.id);
  }
  const dupes = [...namesSeen.entries()].filter(([, ids]) => ids.length > 1);
  if (dupes.length === 0) {
    console.log("  No duplicate ICN projects found ✓");
  } else {
    console.log(`  WARNING: ${dupes.length} duplicate project names found:`);
    for (const [name, ids] of dupes) {
      console.log(`    "${name}" — ids: ${ids.join(", ")}`);
    }
  }

  console.log("");
  console.log("=== STALENESS RULE VALIDATION ===");
  console.log("Rule: Projects not re-seen in 21 days (3 missed weekly runs) age out naturally.");
  console.log("Projects with lastIcnSeenAt set (seen in this run):");
  const seenCount = afterRows.filter(r => r.lastIcnSeenAt !== null).length;
  console.log(`  ${seenCount}/${afterRows.length} ICN projects have lastIcnSeenAt set`);
  console.log("Projects NOT in current ICN_PROJECTS list (not seen in this run):");
  const notSeen = afterRows.filter(r => r.lastIcnSeenAt === null);
  if (notSeen.length === 0) {
    console.log("  None — all ICN projects were seen in this run");
  } else {
    for (const r of notSeen) {
      console.log(`  ${r.name} (id=${r.id}) — lastIcnSeenAt=NULL, will age out naturally`);
    }
  }

  console.log("");
  console.log(`Completed at: ${new Date().toISOString()}`);
  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
