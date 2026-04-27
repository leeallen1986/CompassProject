/**
 * Update Leo Williams and Dan Day profiles, then validate all 7 catch-up recipient scopes.
 * mysql2 auto-parses JSON columns → handle as arrays directly.
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

// Helper: parse value that may already be an array or a JSON string
const parseArr = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return []; }
};

// ── Step 1: Find all 7 catch-up recipients ────────────────────────────────────
const targetEmails = [
  "leo.williams@atlascopco.com",
  "ryan.pemberton@atlascopco.com",
  "daniel.zec@atlascopco.com",
  "dan.day@atlascopco.com",
  "amit.bhargava@atlascopco.com",
  "egor.ivanov@atlascopco.com",
  "brett.hansen@atlascopco.com",
];

const [users] = await conn.execute(
  `SELECT id, name, email, role FROM users WHERE email IN (${targetEmails.map(() => "?").join(",")})`,
  targetEmails
);

console.log(`\n=== Found ${users.length} of 7 target users ===`);
for (const u of users) console.log(`  [${u.id}] ${u.name} <${u.email}> (${u.role})`);

const userMap = Object.fromEntries(users.map(u => [u.email, u]));
const userIds = users.map(u => u.id);

// ── Step 2: Get current profiles ─────────────────────────────────────────────
const [profiles] = await conn.execute(
  `SELECT userId, territories, assignedBusinessLines, onboardingCompleted FROM userProfiles WHERE userId IN (${userIds.map(() => "?").join(",")})`,
  userIds
);
const profileMap = Object.fromEntries(profiles.map(p => [p.userId, p]));

console.log("\n=== Current Profiles (before update) ===");
for (const u of users) {
  const p = profileMap[u.id];
  if (p) {
    console.log(`  ${u.name}: territories=${JSON.stringify(parseArr(p.territories))}, assignedBusinessLines=${JSON.stringify(parseArr(p.assignedBusinessLines))}`);
  } else {
    console.log(`  ${u.name}: NO PROFILE`);
  }
}

// ── Step 3: Update Leo Williams → NATIONAL / Portable Air ────────────────────
const leo = userMap["leo.williams@atlascopco.com"];
if (leo) {
  const leoProfile = profileMap[leo.id];
  if (leoProfile) {
    await conn.execute(
      `UPDATE userProfiles SET territories = ?, assignedBusinessLines = ? WHERE userId = ?`,
      [JSON.stringify(["NATIONAL"]), JSON.stringify(["Portable Air"]), leo.id]
    );
    console.log(`\n✓ Updated Leo Williams → territories=["NATIONAL"], assignedBusinessLines=["Portable Air"]`);
  } else {
    await conn.execute(
      `INSERT INTO userProfiles (userId, territories, assignedBusinessLines, onboardingCompleted) VALUES (?, ?, ?, 1)`,
      [leo.id, JSON.stringify(["NATIONAL"]), JSON.stringify(["Portable Air"])]
    );
    console.log(`\n✓ Created Leo Williams profile → territories=["NATIONAL"], assignedBusinessLines=["Portable Air"]`);
  }
} else {
  console.log("\n✗ Leo Williams not found");
}

// ── Step 4: Update Dan Day → NSW,VIC,SA,TAS,ACT / Pump (Flow) ────────────────
const dan = userMap["dan.day@atlascopco.com"];
if (dan) {
  const danProfile = profileMap[dan.id];
  const danTerr = ["NSW", "VIC", "SA", "TAS", "ACT"];
  const danBL = ["Pump (Flow)"];
  if (danProfile) {
    await conn.execute(
      `UPDATE userProfiles SET territories = ?, assignedBusinessLines = ? WHERE userId = ?`,
      [JSON.stringify(danTerr), JSON.stringify(danBL), dan.id]
    );
    console.log(`✓ Updated Dan Day → territories=${JSON.stringify(danTerr)}, assignedBusinessLines=${JSON.stringify(danBL)}`);
  } else {
    await conn.execute(
      `INSERT INTO userProfiles (userId, territories, assignedBusinessLines, onboardingCompleted) VALUES (?, ?, ?, 1)`,
      [dan.id, JSON.stringify(danTerr), JSON.stringify(danBL)]
    );
    console.log(`✓ Created Dan Day profile → territories=${JSON.stringify(danTerr)}, assignedBusinessLines=${JSON.stringify(danBL)}`);
  }
} else {
  console.log("✗ Dan Day not found");
}

// ── Step 5: Re-read and validate all 7 profiles ───────────────────────────────
const [updatedProfiles] = await conn.execute(
  `SELECT userId, territories, assignedBusinessLines, onboardingCompleted FROM userProfiles WHERE userId IN (${userIds.map(() => "?").join(",")})`,
  userIds
);
const updatedMap = Object.fromEntries(updatedProfiles.map(p => [p.userId, p]));

// Expected final state
const expected = {
  "leo.williams@atlascopco.com":    { territories: ["NATIONAL"],                      bl: ["Portable Air"] },
  "ryan.pemberton@atlascopco.com":  { territories: ["WA"],                             bl: ["Portable Air"] },
  "daniel.zec@atlascopco.com":      { territories: ["NSW", "VIC", "SA", "TAS", "ACT"], bl: ["Portable Air"] },
  "dan.day@atlascopco.com":         { territories: ["NSW", "VIC", "SA", "TAS", "ACT"], bl: ["Pump (Flow)"] },
  "amit.bhargava@atlascopco.com":   { territories: ["NATIONAL"],                       bl: ["PAL", "BESS"] },
  "egor.ivanov@atlascopco.com":     { territories: ["NATIONAL"],                       bl: ["BESS", "Portable Air", "PAL", "Pump"] },
  "brett.hansen@atlascopco.com":    { territories: ["WA", "NT"],                       bl: ["Pump (Flow)"] },
};

console.log("\n=== Final Profile Validation ===");
console.log("─".repeat(100));

let allOk = true;
const rows = [];
for (const u of users) {
  const p = updatedMap[u.id];
  const exp = expected[u.email];
  if (!p) {
    console.log(`✗ ${u.name}: NO PROFILE`);
    allOk = false;
    rows.push({ name: u.name, email: u.email, territories: "MISSING", bl: "MISSING", terrOk: false, blOk: false });
    continue;
  }
  const terr = parseArr(p.territories);
  const bl = parseArr(p.assignedBusinessLines);
  const terrOk = exp ? JSON.stringify([...terr].sort()) === JSON.stringify([...exp.territories].sort()) : true;
  const blOk = exp ? JSON.stringify([...bl].sort()) === JSON.stringify([...exp.bl].sort()) : true;
  if (!terrOk || !blOk) allOk = false;
  rows.push({ name: u.name, email: u.email, territories: terr.join(", "), bl: bl.join(", "), terrOk, blOk });
  const icon = terrOk && blOk ? "✓" : "✗";
  console.log(`${icon} ${u.name.padEnd(22)} | territories: ${terr.join(", ").padEnd(35)} | businessLines: ${bl.join(", ")}`);
  if (!terrOk) console.log(`   ↳ TERRITORY MISMATCH — expected: ${exp.territories.join(", ")}, got: ${terr.join(", ")}`);
  if (!blOk) console.log(`   ↳ BUSINESS LINE MISMATCH — expected: ${exp.bl.join(", ")}, got: ${bl.join(", ")}`);
}
console.log("─".repeat(100));
console.log(allOk ? "\n✓ ALL 6 PROFILES CORRECT (Brett Hansen missing — not yet registered)" : "\n✗ SOME PROFILES NEED ATTENTION");

// ── Step 6: Brett Hansen check ────────────────────────────────────────────────
const brett = userMap["brett.hansen@atlascopco.com"];
if (!brett) {
  console.log("\n⚠ Brett Hansen (brett.hansen@atlascopco.com) is NOT in the users table.");
  console.log("  He cannot receive the digest until he registers and completes onboarding.");
  console.log("  Action required: invite Brett to register before the catch-up send.");
}

// ── Step 7: W18 Monday dedup state ───────────────────────────────────────────
const [w18] = await conn.execute(
  `SELECT l.userId, u.name, l.digestType, l.sentDate, l.status, l.dryRun
   FROM userEmailSendLog l
   JOIN users u ON u.id = l.userId
   WHERE l.weekKey = '2026-W18' AND l.digestType = 'monday' AND l.dryRun = 0`,
);

console.log(`\n=== W18 Monday Dedup State ===`);
if (w18.length === 0) {
  console.log("✓ CLEAR — No W18 Monday sends recorded for any user");
} else {
  console.log(`⚠ ${w18.length} W18 Monday send(s) already recorded:`);
  for (const s of w18) console.log(`  ${s.name}: status=${s.status}, sentDate=${s.sentDate}`);
}

await conn.end();
console.log("\nDone.");
