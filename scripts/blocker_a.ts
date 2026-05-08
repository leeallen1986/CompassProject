import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';

async function audit() {
  const db = await getDb();

  // db.execute returns [rows, fields] for mysql2
  const [allTables] = await db.execute(sql`SHOW TABLES`) as any;
  const tableNames = allTables.map((r: any) => Object.values(r)[0] as string);
  
  const relevant = tableNames.filter((t: string) => 
    t.includes('digest') || t.includes('email') || t.includes('pref') || 
    t.includes('notification') || t.includes('send') || t.includes('Digest') ||
    t.includes('Email') || t.includes('Send')
  );
  console.log('=== RELEVANT TABLES ===');
  console.log(relevant);

  // Check each relevant table
  for (const t of relevant) {
    const [cols] = await db.execute(sql.raw(`DESCRIBE \`${t}\``)) as any;
    console.log(`\n=== ${t} ===`);
    console.log('Columns:', cols.map((r: any) => `${r.Field} (${r.Type})`).join(', '));
    
    const [count] = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM \`${t}\``)) as any;
    console.log(`Rows: ${count[0].cnt}`);
    
    // Show sample data
    const [sample] = await db.execute(sql.raw(`SELECT * FROM \`${t}\` LIMIT 3`)) as any;
    if (sample.length > 0) {
      console.log('Sample:', JSON.stringify(sample, null, 2));
    }
  }

  // Get all users with profiles
  const [users] = await db.execute(sql`SELECT u.id, u.name, u.email, u.role FROM users u`) as any;
  console.log('\n=== ALL USERS ===');
  console.log(users.map((u: any) => `${u.id}: ${u.name} (${u.email}) role=${u.role}`).join('\n'));

  // Get user profiles
  const [profiles] = await db.execute(sql`SELECT userId, territories, assignedBusinessLines FROM user_profiles`) as any;
  console.log('\n=== USER PROFILES (active reps) ===');
  for (const p of profiles) {
    const user = users.find((u: any) => u.id === p.userId);
    console.log(`${user?.name || p.userId}: territories=${p.territories}, BLs=${p.assignedBusinessLines}`);
  }

  process.exit(0);
}
audit();
