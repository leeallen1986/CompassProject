/**
 * Pull user + userProfile table from production DB
 * to select the three test accounts for live ranking verification.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { users as usersTable, userProfiles } from "./drizzle/schema";
import { eq } from "drizzle-orm";
import { ENV } from "./server/_core/env";

const conn = await mysql.createConnection(ENV.databaseUrl);
const db = drizzle(conn, { mode: "default" });

// Pull all users with their profiles via left join
const rows = await db
  .select()
  .from(usersTable)
  .leftJoin(userProfiles, eq(usersTable.id, userProfiles.userId));

const users = rows.map(r => ({ ...r.users, profile: r.user_profiles }));

console.log(`\nTotal users: ${users.length}\n`);
console.log("=".repeat(110));
console.log(
  `${"Name".padEnd(22)} ${"Email".padEnd(32)} ${"Role".padEnd(8)} ${"Territories".padEnd(18)} ${"Business Lines".padEnd(32)} ${"Sector Focus".padEnd(20)} ${"Key Accounts"}`
);
console.log("-".repeat(110));

for (const u of users) {
  const p = (u as any).profile;
  const territories = p?.territories ? JSON.parse(p.territories).join(", ") : "—";
  const bls = p?.assignedBusinessLines ? JSON.parse(p.assignedBusinessLines).join(", ") : "—";
  const sectors = p?.sectorFocus ? JSON.parse(p.sectorFocus).join(", ") : "—";
  const accounts = p?.keyAccounts ? JSON.parse(p.keyAccounts).slice(0, 3).join(", ") : "—";
  console.log(
    `${(u.name ?? "").slice(0, 21).padEnd(22)} ${(u.email ?? "").slice(0, 31).padEnd(32)} ${(u.role ?? "").padEnd(8)} ${territories.slice(0, 17).padEnd(18)} ${bls.slice(0, 31).padEnd(32)} ${sectors.slice(0, 19).padEnd(20)} ${accounts}`
  );
}

console.log("\n=== Profiles with populated ptLaneFocus / assignedBusinessLines ===");
for (const u of users) {
  const p = (u as any).profile;
  if (!p) continue;
  const bls = p.assignedBusinessLines ? JSON.parse(p.assignedBusinessLines) : [];
  const ptLane = p.ptLaneFocus ?? null;
  if (bls.length > 0 || ptLane) {
    const territories = p.territories ? JSON.parse(p.territories) : [];
    const sectors = p.sectorFocus ? JSON.parse(p.sectorFocus) : [];
    const accounts = p.keyAccounts ? JSON.parse(p.keyAccounts) : [];
    console.log(`\n  ${u.name} (${u.email})`);
    console.log(`    territories:     ${territories.join(", ") || "—"}`);
    console.log(`    businessLines:   ${bls.join(", ") || "—"}`);
    console.log(`    ptLaneFocus:     ${ptLane ?? "—"}`);
    console.log(`    sectorFocus:     ${sectors.join(", ") || "—"}`);
    console.log(`    keyAccounts:     ${accounts.slice(0, 5).join(", ") || "—"}`);
    console.log(`    buyerRoles:      ${p.buyerRoles ? JSON.parse(p.buyerRoles).join(", ") : "—"}`);
  }
}

await conn.end();
