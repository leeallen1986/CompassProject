import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';
const db = drizzle(process.env.DATABASE_URL as string);
const r = await db.execute(sql`SELECT COUNT(*) as cnt FROM contacts WHERE contactTrustTier = 'send_ready'`);
console.log(JSON.stringify(r[0]));
process.exit(0);
