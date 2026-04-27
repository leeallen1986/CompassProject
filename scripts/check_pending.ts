import { getDb } from "../server/db";
import { contacts, pipelineRuns } from "../drizzle/schema";
import { eq, isNull, or, sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.log("No DB"); return; }
  
  const [pending] = await db.select({ count: sql<number>`count(*)` }).from(contacts)
    .where(or(eq(contacts.enrichmentStatus, "pending"), isNull(contacts.enrichmentStatus)));
  console.log("Pending contacts:", pending.count);
  
  const [total] = await db.select({ count: sql<number>`count(*)` }).from(contacts);
  console.log("Total contacts:", total.count);
  
  // Check for @unknown.com.au contacts
  const unknownContacts = await db.select({ id: contacts.id, name: contacts.name, email: contacts.email, company: contacts.company })
    .from(contacts)
    .where(sql`email LIKE '%@unknown.com.au%' OR email LIKE '%.com.au.com.au%'`)
    .limit(20);
  console.log("\n@unknown.com.au / malformed contacts:", unknownContacts.length);
  for (const c of unknownContacts) {
    console.log(`  ID ${c.id}: ${c.name} | ${c.email} | ${c.company}`);
  }

  // Check stuck pipeline run
  const stuckRuns = await db.select().from(pipelineRuns)
    .where(eq(pipelineRuns.status, "running"))
    .limit(5);
  console.log("\nStuck running pipeline runs:", stuckRuns.length);
  for (const r of stuckRuns) {
    const age = Math.round((Date.now() - new Date(r.startedAt).getTime()) / 60000);
    console.log(`  ID ${r.id}: started ${r.startedAt} (${age} min ago), triggered by: ${r.triggeredBy}`);
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
