import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  
  // Check users table columns
  const [cols]: any = await conn.query('SHOW COLUMNS FROM users');
  console.log('=== USERS TABLE COLUMNS ===');
  for (const c of cols) console.log(c.Field);
  
  // Find Ryan
  const [users]: any = await conn.query("SELECT * FROM users WHERE name LIKE '%Ryan%' OR name LIKE '%Lee%'");
  console.log('\n=== USERS MATCHING RYAN/LEE ===');
  for (const u of users) console.log(JSON.stringify(u));
  
  // Get Ryan's profile
  const [profiles]: any = await conn.query("SELECT up.*, u.name, u.email FROM userProfiles up JOIN users u ON up.userId = u.id WHERE u.name LIKE '%Ryan%' OR u.name LIKE '%Lee%'");
  console.log('\n=== RYAN PROFILE ===');
  for (const p of profiles) {
    console.log(`userId: ${p.userId}, name: ${p.name}`);
    console.log(`territories: ${p.territories}`);
    console.log(`assignedBusinessLines: ${p.assignedBusinessLines}`);
    console.log(`salesMotion: ${p.salesMotion}`);
  }
  
  await conn.end();
}
main();
