import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const hunterKey = process.env.HUNTER_API_KEY;
console.log('HUNTER_API_KEY present:', !!hunterKey, hunterKey ? `(length: ${hunterKey.length})` : '(missing)');

const [tables] = await conn.query("SHOW TABLES LIKE 'contactValidation%'");
console.log('contactValidation tables:', JSON.stringify(tables));

const [enumVals] = await conn.query("SHOW COLUMNS FROM projects LIKE 'discoveryStatus'");
console.log('discoveryStatus enum:', enumVals[0]?.Type);

const [contactCols] = await conn.query("SHOW COLUMNS FROM contacts");
console.log('contacts columns:', contactCols.map(c => c.Field).join(', '));

// Check if contactValidationActions table exists
const [valTables] = await conn.query("SHOW TABLES LIKE '%validation%'");
console.log('all validation tables:', JSON.stringify(valTables));

await conn.end();
