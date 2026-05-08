import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await conn.query(
    'SELECT id, status, currentStep, lastProgressAt, lastActivityNote, articlesExtracted, projectsCreated, contactsEnriched FROM pipelineRuns WHERE id=990001'
  );
  console.table(rows);
  await conn.end();
}
main();
