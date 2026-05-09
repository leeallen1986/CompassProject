import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const db = await createConnection(process.env.DATABASE_URL!);
  const [rows] = await db.query(
    "SELECT u.name, up.assignedBusinessLines FROM users u JOIN userProfiles up ON up.userId = u.id WHERE u.name IN (?, ?) LIMIT 2",
    ["Ryan Pemberton", "Brett Hansen"]
  ) as any[];
  for (const r of rows as any[]) {
    const raw = r.assignedBusinessLines;
    console.log(r.name, "type:", typeof raw, "isBuffer:", Buffer.isBuffer(raw));
    if (Buffer.isBuffer(raw)) console.log("  buffer value:", raw.toString("utf8"));
    else console.log("  value:", JSON.stringify(raw));
  }
  await db.end();
}
main().catch(console.error);
