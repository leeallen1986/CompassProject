import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [cols] = await conn.execute("DESCRIBE pipelineRuns");
console.log("pipelineRuns columns:", cols.map(c => c.Field).join(", "));
const [scols] = await conn.execute("SHOW TABLES");
console.log("All tables:", scols.map(r => Object.values(r)[0]).join(", "));
await conn.end();
process.exit(0);
