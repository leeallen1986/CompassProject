import { getDb } from "../server/db.ts";
import { users, userProfiles } from "../drizzle/schema.ts";

const db = await getDb();
const rows = await db.select().from(users);
console.log("Users in DB:", JSON.stringify(rows.map(u => ({ id: u.id, name: u.name, email: u.email })), null, 2));

const profiles = await db.select().from(userProfiles);
console.log("User profiles:", JSON.stringify(profiles.map(p => ({ userId: p.userId, territories: p.territories, assignedBusinessLines: p.assignedBusinessLines })), null, 2));
