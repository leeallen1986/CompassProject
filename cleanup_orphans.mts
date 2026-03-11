import { getDb } from './server/db.ts';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  
  // Find contacts that have NO remaining contactProjects links
  const orphans = await db.execute(sql`
    SELECT c.id FROM contacts c
    LEFT JOIN contactProjects cp ON cp.contactId = c.id
    WHERE cp.id IS NULL
  `);
  const orphanIds = (orphans[0] as any[]).map((r: any) => r.id);
  console.log('Orphaned contacts (no project links):', orphanIds.length);
  
  if (orphanIds.length > 0) {
    const idList = orphanIds.join(',');
    await db.execute(sql`DELETE FROM outreachEmails WHERE contactId IN (${sql.raw(idList)})`);
    await db.execute(sql`DELETE FROM apolloCreditLog WHERE contactId IN (${sql.raw(idList)})`);
    const r = await db.execute(sql`DELETE FROM contacts WHERE id IN (${sql.raw(idList)})`);
    console.log('Deleted orphaned contacts:', (r[0] as any).affectedRows);
  }
  
  console.log('\nProjects:', ((await db.execute(sql`SELECT COUNT(*) as cnt FROM projects`))[0] as any[])[0].cnt);
  console.log('Contacts:', ((await db.execute(sql`SELECT COUNT(*) as cnt FROM contacts`))[0] as any[])[0].cnt);
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
