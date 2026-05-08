import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [cols]: any = await conn.query('SHOW COLUMNS FROM rssSources');
  console.log('=== rssSources COLUMNS ===');
  for (const c of cols) console.log(c.Field);
  
  // Get active sources
  const [sources]: any = await conn.query('SELECT * FROM rssSources WHERE isActive = 1 LIMIT 5');
  console.log('\n=== SAMPLE ACTIVE SOURCE ===');
  if (sources.length > 0) console.log(JSON.stringify(sources[0], null, 2));
  
  // Check if projectArticles or rssArticles exist
  const [tables]: any = await conn.query("SHOW TABLES");
  console.log('\n=== ALL TABLES ===');
  for (const t of tables) console.log(Object.values(t)[0]);
  
  await conn.end();
}
main();
