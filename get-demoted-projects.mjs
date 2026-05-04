import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute(`
  SELECT id, name, priority, discoveryStatus
  FROM projects
  WHERE discoveryStatus = 'named_contact_no_email'
    AND priority IN ('hot','warm')
  ORDER BY FIELD(priority,'hot','warm'), name
  LIMIT 20
`);

console.log('Demoted projects (named_contact_no_email, hot/warm):');
console.log(JSON.stringify(rows, null, 2));
console.log(`\nTotal: ${rows.length}`);

await conn.end();
