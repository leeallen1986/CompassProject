import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

// First check actual column names
const [cols] = await conn.execute(`SHOW COLUMNS FROM campaignContacts`);
const colNames = cols.map(c => c.Field);
console.log("COLUMNS:", colNames.join(", "));
await conn.end();
