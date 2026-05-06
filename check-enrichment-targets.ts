import "dotenv/config";
import { getDb } from "./server/db";
import { projects } from "./drizzle/schema";
import { inArray } from "drizzle-orm";

async function main() {
  const db = await getDb();
  const rows = await db.select().from(projects).where(inArray(projects.id, [660052, 690069]));
  for (const r of rows) {
    console.log(`\nProject: ${r.name} (ID: ${r.id})`);
    console.log(`  Location: ${r.location} | State: ${(r as any).projectState}`);
    console.log(`  Priority: ${r.priority} | Owner: ${r.owner} | Contractor: ${r.contractor}`);
    console.log(`  Discovery: ${(r as any).discoveryStatus}`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
