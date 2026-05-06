import "dotenv/config";
import { getDb } from "./server/db";
import { contacts, contactProjects, projects } from "./drizzle/schema";
import { eq, inArray } from "drizzle-orm";

async function main() {
  const db = await getDb();

  for (const projectId of [660052, 690069]) {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Project: ${project?.name} (ID: ${projectId})`);

    // Get contacts linked to this project
    const linked = await db
      .select({
        contactId: contactProjects.contactId,
        relevance: contactProjects.relevance,
      })
      .from(contactProjects)
      .where(eq(contactProjects.projectId, projectId));

    console.log(`  Linked contacts: ${linked.length}`);

    if (linked.length > 0) {
      const contactIds = linked.map(l => l.contactId);
      const contactRows = await db.select().from(contacts).where(inArray(contacts.id, contactIds));
      for (const c of contactRows) {
        console.log(`  - ${c.name} | ${c.title} | ${c.company} | email: ${c.email || "none"} | tier: ${(c as any).contactTrustTier} | verScore: ${(c as any).verificationScore}`);
      }
    } else {
      console.log(`  No contacts found for this project`);
    }

    // Also check enrichment log
    const enrichLog = await db
      .select()
      .from(require("../drizzle/schema").projectEnrichmentCache)
      .where(eq(require("../drizzle/schema").projectEnrichmentCache.projectId, projectId));
    console.log(`  Enrichment cache entries: ${enrichLog.length}`);
    for (const e of enrichLog) {
      console.log(`    - enrichedAt: ${e.enrichedAt} | contactsFound: ${e.contactsFound} | companies: ${JSON.stringify(e.companiesSearched)}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
