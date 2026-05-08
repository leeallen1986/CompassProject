import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.query('SELECT id, status, triggeredBy, startedAt, completedAt FROM pipelineRuns ORDER BY id DESC LIMIT 10');
  console.table(rows);
  await conn.end();
}
main();
