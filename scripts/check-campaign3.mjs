import 'dotenv/config';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: false } });

const [tables] = await conn.execute("SHOW TABLES LIKE '%campaign%'");
console.log("Campaign tables:", tables);

const [tables2] = await conn.execute("SHOW TABLES");
console.log("\nAll tables:", tables2.map(t => Object.values(t)[0]));

await conn.end();
