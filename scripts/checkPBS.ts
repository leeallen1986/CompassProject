import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [cols]: any = await conn.query('SHOW COLUMNS FROM projectBusinessLineScores');
  console.log('=== projectBusinessLineScores COLUMNS ===');
  for (const c of cols) console.log(c.Field);
  
  // Sample row
  const [sample]: any = await conn.query('SELECT * FROM projectBusinessLineScores LIMIT 1');
  if (sample.length > 0) {
    console.log('\n=== SAMPLE ROW ===');
    console.log(JSON.stringify(sample[0], null, 2));
  }
  
  // Also check contacts columns
  const [cCols]: any = await conn.query('SHOW COLUMNS FROM contacts');
  console.log('\n=== contacts COLUMNS ===');
  for (const c of cCols) console.log(c.Field);
  
  await conn.end();
}
main();
