import 'dotenv/config';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: false } });

// Get columns
const [cols] = await conn.execute("DESCRIBE campaignContacts");
console.log("Campaign contact columns:", cols.map(c => c.Field));

await conn.end();
