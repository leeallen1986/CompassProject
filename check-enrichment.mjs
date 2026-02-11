import { getDb } from './server/db.ts';
import { contacts } from './drizzle/schema.ts';
import { sql, eq, or, and } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [result] = await db.select({ count: sql`count(*)` }).from(contacts).where(
    and(
      or(eq(contacts.enrichmentStatus, 'enriched'), eq(contacts.enrichmentStatus, 'not_found')),
      sql`${contacts.enrichedAt} >= ${today}`
    )
  );
  console.log('Daily enrichment count:', result.count);

  const [total] = await db.select({ count: sql`count(*)` }).from(contacts);
  console.log('Total contacts:', total.count);

  const [enriched] = await db.select({ count: sql`count(*)` }).from(contacts).where(eq(contacts.enrichmentStatus, 'enriched'));
  console.log('Enriched contacts:', enriched.count);

  const [pending] = await db.select({ count: sql`count(*)` }).from(contacts).where(or(eq(contacts.enrichmentStatus, 'pending'), sql`${contacts.enrichmentStatus} IS NULL`));
  console.log('Pending contacts:', pending.count);

  process.exit(0);
}

main().catch(console.error);
