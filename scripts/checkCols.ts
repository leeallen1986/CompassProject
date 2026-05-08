import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [cols]: any = await conn.query('SHOW COLUMNS FROM userProfiles');
  for (const c of cols) console.log(c.Field);
  await conn.end();
}
main();
