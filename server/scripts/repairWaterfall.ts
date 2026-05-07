/**
 * repairWaterfall.ts
 *
 * One-time repair script that fixes the three structural failures in the
 * contact discovery waterfall:
 *
 * Fix 1 — Backfill orphaned contactProjects rows
 *   web_search: 832 orphans, linkedin: 537 orphans, llm: 39 orphans
 *   All have a matching project name in the projects table but no junction row.
 *
 * Fix 2 — Promote discoveryStatus for projects that already have send_ready contacts
 *   9 projects have ≥1 send_ready contact but discoveryStatus != 'send_ready_contact'.
 *
 * Fix 3 — Remove junk CRM contacts from project linkage
 *   Manual/CRM contacts with phone-number roleBuckets, internal Atlas Copco emails,
 *   or noreply/portal.invoices addresses should not appear in project contact views.
 *
 * Run: npx tsx server/scripts/repairWaterfall.ts
 */

import { getDb } from "../db";
import { contacts, contactProjects, projects } from "../../drizzle/schema";
import { eq, and, sql, inArray, isNull } from "drizzle-orm";

// ── Fix 1: Backfill orphaned contactProjects rows ──

async function backfillOrphanLinks(db: any): Promise<{ fixed: number; skipped: number }> {
  console.log("[Repair] Fix 1: Backfilling orphaned contactProjects rows...");

  // Find all contacts from web_search / linkedin / llm that have a project name
  // matching a real project but no contactProjects row for that project.
  const [orphanRows] = await db.execute(sql`
    SELECT DISTINCT c.id as contactId, p.id as projectId, p.name as projectName,
      CASE WHEN p.owner = c.company THEN 'primary' ELSE 'secondary' END as relevance
    FROM contacts c
    JOIN projects p ON p.name = c.project
    LEFT JOIN contactProjects cp ON cp.contactId = c.id AND cp.projectId = p.id
    WHERE cp.id IS NULL
      AND c.enrichmentSource IN ('web_search', 'linkedin', 'llm')
  `) as any[];

  const rows = (Array.isArray(orphanRows) ? orphanRows : []) as any[];
  console.log(`[Repair] Found ${rows.length} orphaned contacts to backfill`);

  let fixed = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      await db.insert(contactProjects).values({
        contactId: row.contactId,
        projectId: row.projectId,
        projectName: row.projectName,
        relevance: row.relevance || "secondary",
      });
      fixed++;
    } catch (err: any) {
      // Duplicate key — already exists, skip
      if (err.code === "ER_DUP_ENTRY" || err.message?.includes("Duplicate entry")) {
        skipped++;
      } else {
        console.warn(`[Repair] Failed to insert contactProjects for contact ${row.contactId} / project ${row.projectId}: ${err.message}`);
        skipped++;
      }
    }
  }

  console.log(`[Repair] Fix 1 complete: ${fixed} rows inserted, ${skipped} skipped`);
  return { fixed, skipped };
}

// ── Fix 2: Promote discoveryStatus for projects with send_ready contacts ──

async function promoteDiscoveryStatus(db: any): Promise<{ promoted: number }> {
  console.log("[Repair] Fix 2: Promoting discoveryStatus for projects with send_ready contacts...");

  // Find projects that have at least one send_ready contact linked via contactProjects
  // but whose discoveryStatus is not 'send_ready_contact'
  const [stuckRows] = await db.execute(sql`
    SELECT DISTINCT p.id, p.name, p.discoveryStatus, COUNT(DISTINCT c.id) as send_ready_count
    FROM projects p
    JOIN contactProjects cp ON cp.projectId = p.id
    JOIN contacts c ON c.id = cp.contactId
      AND c.contactTrustTier = 'send_ready'
      AND c.enrichmentSource != 'manual'
      AND (c.email NOT LIKE '%atlascopco.com' OR c.email IS NULL)
      AND (c.email NOT LIKE '%noreply%' OR c.email IS NULL)
      AND (c.email NOT LIKE '%portal.invoices%' OR c.email IS NULL)
    WHERE p.discoveryStatus != 'send_ready_contact'
    GROUP BY p.id, p.name, p.discoveryStatus
    HAVING send_ready_count > 0
  `) as any[];

  const rows = (Array.isArray(stuckRows) ? stuckRows : []) as any[];
  console.log(`[Repair] Found ${rows.length} projects to promote`);

  let promoted = 0;
  for (const row of rows) {
    await db.update(projects)
      .set({ discoveryStatus: "send_ready_contact" })
      .where(eq(projects.id, row.id));
    console.log(`[Repair] Promoted: "${row.name}" (${row.discoveryStatus} → send_ready_contact, ${row.send_ready_count} send_ready contacts)`);
    promoted++;
  }

  console.log(`[Repair] Fix 2 complete: ${promoted} projects promoted`);
  return { promoted };
}

// ── Fix 3: Unlink junk CRM contacts from project views ──

async function unlinkJunkCrmContacts(db: any): Promise<{ unlinked: number }> {
  console.log("[Repair] Fix 3: Unlinking junk CRM contacts from project views...");

  // Identify junk CRM contacts: phone-number roleBuckets, internal emails, noreply
  // We don't DELETE them — we remove their contactProjects links so they don't
  // pollute project coverage views.
  const [junkRows] = await db.execute(sql`
    SELECT cp.id as cpId, c.id as contactId, c.name, c.email, c.roleBucket, cp.projectId
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    WHERE c.enrichmentSource = 'manual'
      AND (
        (c.roleBucket REGEXP '^[0-9+() -]+$')
        OR (c.email LIKE '%atlascopco.com')
        OR (c.email LIKE '%noreply%')
        OR (c.email LIKE '%no-reply%')
        OR (c.email LIKE '%portal.invoices%')
      )
  `) as any[];

  const rows = (Array.isArray(junkRows) ? junkRows : []) as any[];
  console.log(`[Repair] Found ${rows.length} junk CRM contactProjects rows to unlink`);

  let unlinked = 0;
  const batchSize = 100;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const ids = batch.map((r: any) => r.cpId);
    if (ids.length > 0) {
      await db.delete(contactProjects).where(inArray(contactProjects.id, ids));
      unlinked += ids.length;
    }
  }

  console.log(`[Repair] Fix 3 complete: ${unlinked} junk CRM contactProjects rows removed`);
  return { unlinked };
}

// ── Fix 4: Backfill Apollo orphans (apollo contacts missing contactProjects) ──

async function backfillApolloOrphans(db: any): Promise<{ fixed: number }> {
  console.log("[Repair] Fix 4: Backfilling Apollo orphaned contacts...");

  const [orphanRows] = await db.execute(sql`
    SELECT DISTINCT c.id as contactId, p.id as projectId, p.name as projectName,
      CASE WHEN p.owner = c.company THEN 'primary' ELSE 'secondary' END as relevance
    FROM contacts c
    JOIN projects p ON p.name = c.project
    LEFT JOIN contactProjects cp ON cp.contactId = c.id AND cp.projectId = p.id
    WHERE cp.id IS NULL
      AND c.enrichmentSource = 'apollo'
  `) as any[];

  const rows = (Array.isArray(orphanRows) ? orphanRows : []) as any[];
  console.log(`[Repair] Found ${rows.length} Apollo orphaned contacts to backfill`);

  let fixed = 0;
  for (const row of rows) {
    try {
      await db.insert(contactProjects).values({
        contactId: row.contactId,
        projectId: row.projectId,
        projectName: row.projectName,
        relevance: row.relevance || "secondary",
      });
      fixed++;
    } catch (err: any) {
      if (!err.message?.includes("Duplicate entry")) {
        console.warn(`[Repair] Apollo orphan fix failed for contact ${row.contactId}: ${err.message}`);
      }
    }
  }

  console.log(`[Repair] Fix 4 complete: ${fixed} Apollo orphan rows inserted`);
  return { fixed };
}

// ── Main ──

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("[Repair] Database not available");
    process.exit(1);
  }

  console.log("=== Waterfall Repair Script ===");
  console.log(`Started at: ${new Date().toISOString()}`);

  const fix1 = await backfillOrphanLinks(db);
  const fix4 = await backfillApolloOrphans(db);
  const fix2 = await promoteDiscoveryStatus(db);
  const fix3 = await unlinkJunkCrmContacts(db);

  console.log("\n=== REPAIR SUMMARY ===");
  console.log(`Fix 1 (web/linkedin/llm orphan backfill): ${fix1.fixed} rows inserted, ${fix1.skipped} skipped`);
  console.log(`Fix 4 (apollo orphan backfill):           ${fix4.fixed} rows inserted`);
  console.log(`Fix 2 (discoveryStatus promotion):        ${fix2.promoted} projects promoted`);
  console.log(`Fix 3 (CRM junk unlink):                  ${fix3.unlinked} rows removed`);
  console.log(`\nCompleted at: ${new Date().toISOString()}`);
}

main().catch(err => {
  console.error("[Repair] Fatal error:", err);
  process.exit(1);
});
