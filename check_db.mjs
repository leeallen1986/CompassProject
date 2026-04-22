import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(
  "SELECT sourcePurpose, COUNT(*) as cnt FROM projects WHERE sourcePurpose = 'live_tender' GROUP BY sourcePurpose"
);
console.log("live_tender projects:", JSON.stringify(rows));

const [total] = await conn.execute("SELECT COUNT(*) as cnt FROM projects");
console.log("total projects:", JSON.stringify(total));

const [recent] = await conn.execute(
  "SELECT name, sourcePurpose, tenderNumber, createdAt FROM projects WHERE sourcePurpose = 'live_tender' ORDER BY createdAt DESC LIMIT 10"
);
console.log("Recent live_tender projects:");
recent.forEach(r => console.log(`  [${r.tenderNumber}] ${r.name.substring(0, 60)}`));

await conn.end();
