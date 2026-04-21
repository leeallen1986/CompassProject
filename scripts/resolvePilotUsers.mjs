/**
 * resolvePilotUsers.mjs — Resolve pilot user IDs and emails from the Atlas DB
 * Usage: npx tsx scripts/resolvePilotUsers.mjs
 */
import { config } from "dotenv";
config({ path: ".env" });

import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// Import the getDb helper
const { getDb } = await import(path.join(projectRoot, "server/db.ts"));

const db = await getDb();
if (!db) {
  console.error("❌ Could not connect to database");
  process.exit(1);
}

// Import drizzle schema
const { users } = await import(path.join(projectRoot, "drizzle/schema.ts"));
const { or, like, eq } = await import("drizzle-orm");

// Search for the four pilot users by name or email pattern
const pilotNames = [
  { name: "Lee Allen", email: "lee.allen@atlascopco.com" },
  { name: "Ryan Pemberton", email: "ryan.pemberton@atlascopco.com" },
  { name: "Amit Bhargava", email: "amit.bhargava@atlascopco.com" },
  { name: "Leo Williams", email: null }, // email format unknown
];

console.log("\nResolving pilot users from Atlas DB...\n");

// Query all users and filter
const allUsers = await db
  .select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    openId: users.openId,
  })
  .from(users);

console.log(`Total users in DB: ${allUsers.length}\n`);

// Try to match each pilot user
const resolved = [];
for (const pilot of pilotNames) {
  // Match by email first, then by name (case-insensitive)
  let match = null;
  if (pilot.email) {
    match = allUsers.find(u => u.email?.toLowerCase() === pilot.email.toLowerCase());
  }
  if (!match) {
    // Try name match
    const nameParts = pilot.name.toLowerCase().split(" ");
    match = allUsers.find(u => {
      const uname = (u.name ?? "").toLowerCase();
      return nameParts.every(part => uname.includes(part));
    });
  }
  if (!match) {
    // Try partial email match (first.last pattern)
    const emailPrefix = pilot.name.toLowerCase().replace(" ", ".");
    match = allUsers.find(u => u.email?.toLowerCase().startsWith(emailPrefix));
  }

  resolved.push({
    pilotName: pilot.name,
    expectedEmail: pilot.email,
    found: !!match,
    userId: match?.id ?? null,
    dbName: match?.name ?? null,
    dbEmail: match?.email ?? null,
    dbRole: match?.role ?? null,
  });
}

// Print resolved users
console.log("Pilot User Resolution Results:");
console.log("=".repeat(70));
for (const r of resolved) {
  const status = r.found ? "✅ FOUND" : "❌ NOT FOUND";
  console.log(`\n${status}: ${r.pilotName}`);
  if (r.found) {
    console.log(`  User ID:   ${r.userId}`);
    console.log(`  DB Name:   ${r.dbName}`);
    console.log(`  DB Email:  ${r.dbEmail}`);
    console.log(`  DB Role:   ${r.dbRole}`);
  } else {
    console.log(`  Expected email: ${r.expectedEmail ?? "unknown"}`);
    console.log(`  → Not found in DB. User may need to register first.`);
  }
}
console.log("\n" + "=".repeat(70));

// Also show all atlascopco.com users for reference
const atlasUsers = allUsers.filter(u => u.email?.includes("atlascopco.com") || u.email?.includes("atlas.copco"));
if (atlasUsers.length > 0) {
  console.log(`\nAll Atlas Copco users in DB (${atlasUsers.length}):`);
  for (const u of atlasUsers) {
    console.log(`  [${u.role}] ${u.name ?? "(no name)"} — ${u.email} (id: ${u.id})`);
  }
}

// Output JSON for use in pilot script
const output = {
  resolvedAt: new Date().toISOString(),
  pilotReps: resolved.filter(r => r.pilotName !== "Lee Allen" && r.found).map(r => ({ userId: r.userId, name: r.dbName, email: r.dbEmail })),
  managerUser: resolved.find(r => r.pilotName === "Lee Allen" && r.found) ? {
    userId: resolved.find(r => r.pilotName === "Lee Allen").userId,
    name: resolved.find(r => r.pilotName === "Lee Allen").dbName,
    email: resolved.find(r => r.pilotName === "Lee Allen").dbEmail,
  } : null,
  allResolved: resolved,
};

import { writeFileSync } from "fs";
writeFileSync(
  path.join(projectRoot, "scripts/pilotUsers.json"),
  JSON.stringify(output, null, 2)
);
console.log("\n✅ Saved to scripts/pilotUsers.json\n");

process.exit(0);
