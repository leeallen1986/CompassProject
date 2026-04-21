/**
 * Quick diagnostic: check owner and contractors fields for raw HTML/URLs
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

// Check for owner fields with URLs or HTML
const [urlOwners] = await conn.execute(
  "SELECT id, name, SUBSTRING(owner, 1, 300) as owner FROM projects WHERE owner LIKE '%http%' OR owner LIKE '%<a %' OR owner LIKE '%href%' LIMIT 10"
);
console.log("=== Owner fields with URLs/HTML ===");
console.log(JSON.stringify(urlOwners, null, 2));

// Sample 5 owner fields to see typical format
const [sampleOwners] = await conn.execute(
  "SELECT id, name, SUBSTRING(owner, 1, 200) as owner FROM projects ORDER BY id DESC LIMIT 5"
);
console.log("\n=== Sample owner fields ===");
console.log(JSON.stringify(sampleOwners, null, 2));

// Check contractors JSON field for raw URLs
const [urlContractors] = await conn.execute(
  "SELECT id, name, SUBSTRING(contractors, 1, 500) as contractors FROM projects WHERE contractors LIKE '%http%' OR contractors LIKE '%<a %' LIMIT 5"
);
console.log("\n=== Contractors with URLs/HTML ===");
console.log(JSON.stringify(urlContractors, null, 2));

await conn.end();
