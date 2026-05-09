import 'dotenv/config';
import { getDb } from '../server/db.ts';
import { projects } from '../drizzle/schema.ts';
import { like } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  const results = await db.select({
    id: projects.id,
    name: projects.name,
    owner: projects.owner,
    contractor: projects.contractor,
    lifecycleStatus: projects.lifecycleStatus
  }).from(projects).where(like(projects.name, '%Blind Creek%'));
  console.log('=== BLIND CREEK PROJECT ===');
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}
main();
