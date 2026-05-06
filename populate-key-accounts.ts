import "dotenv/config";
import { getDb } from "./server/db";
import { userProfiles } from "./drizzle/schema";
import { eq } from "drizzle-orm";

// Ryan Pemberton — Portable Air, WA
// Key accounts: major WA mining contractors and owners known to buy Atlas Copco portable air
const RYAN_KEY_ACCOUNTS = [
  "Monadelphous",
  "Macmahon",
  "Byrnecut",
  "Meeka Metals",
  "Pantoro Gold",
  "BHP",
  "Fortescue",
  "Newmont",
  "Mineral Resources",
  "Perenti",
  "NRW Holdings",
  "Thiess",
  "MACA",
  "AGL Energy",
  "Strike Energy",
];

// Brett Hansen — Pump/Flow, WA+NT
// Key accounts: major WA/NT dewatering and fluid management contractors and owners
const BRETT_KEY_ACCOUNTS = [
  "Monadelphous",
  "Macmahon",
  "Byrnecut",
  "Meeka Metals",
  "Water Corporation",
  "Chevron",
  "Woodside",
  "Bhagwan Marine",
  "BHP",
  "Fortescue",
  "Newmont",
  "Perenti",
  "Thiess",
  "MACA",
  "Mineral Resources",
];

// Ryan sector focus: mining, oil_gas, energy, infrastructure
const RYAN_SECTOR_FOCUS = ["mining", "oil_gas", "energy", "infrastructure"];

// Brett sector focus: mining, oil_gas, water, infrastructure
const BRETT_SECTOR_FOCUS = ["mining", "oil_gas", "water", "infrastructure"];

// Ryan buyer roles: procurement, project_manager, maintenance_manager, engineering
const RYAN_BUYER_ROLES = ["procurement", "project_manager", "maintenance_manager", "engineering", "operations_manager"];

// Brett buyer roles: procurement, project_manager, site_manager, engineering, dewatering_superintendent
const BRETT_BUYER_ROLES = ["procurement", "project_manager", "site_manager", "engineering", "dewatering_superintendent", "underground_manager"];

// Ryan stage timing: early_signal, tender_live, awarded_mobilizing, construction
const RYAN_STAGE_TIMING = ["early_signal", "tender_live", "awarded_mobilizing", "construction", "commissioning"];

// Brett stage timing: tender_live, awarded_mobilizing, construction, commissioning
const BRETT_STAGE_TIMING = ["tender_live", "awarded_mobilizing", "construction", "commissioning", "operations"];

async function main() {
  const db = await getDb();

  // Update Ryan (ID: 2340043)
  const ryanResult = await db.update(userProfiles)
    .set({
      keyAccounts: RYAN_KEY_ACCOUNTS,
      sectorFocus: RYAN_SECTOR_FOCUS,
      buyerRoles: RYAN_BUYER_ROLES,
      stageTiming: RYAN_STAGE_TIMING,
    })
    .where(eq(userProfiles.userId, 2340043));

  console.log("✓ Ryan Pemberton (2340043) profile updated:");
  console.log(`  keyAccounts: ${RYAN_KEY_ACCOUNTS.length} accounts`);
  console.log(`  sectorFocus: ${RYAN_SECTOR_FOCUS.join(", ")}`);
  console.log(`  buyerRoles: ${RYAN_BUYER_ROLES.join(", ")}`);
  console.log(`  stageTiming: ${RYAN_STAGE_TIMING.join(", ")}`);

  // Update Brett (ID: 2550006)
  const brettResult = await db.update(userProfiles)
    .set({
      keyAccounts: BRETT_KEY_ACCOUNTS,
      sectorFocus: BRETT_SECTOR_FOCUS,
      buyerRoles: BRETT_BUYER_ROLES,
      stageTiming: BRETT_STAGE_TIMING,
    })
    .where(eq(userProfiles.userId, 2550006));

  console.log("\n✓ Brett Hansen (2550006) profile updated:");
  console.log(`  keyAccounts: ${BRETT_KEY_ACCOUNTS.length} accounts`);
  console.log(`  sectorFocus: ${BRETT_SECTOR_FOCUS.join(", ")}`);
  console.log(`  buyerRoles: ${BRETT_BUYER_ROLES.join(", ")}`);
  console.log(`  stageTiming: ${BRETT_STAGE_TIMING.join(", ")}`);

  // Verify
  const profiles = await db.select().from(userProfiles).where(eq(userProfiles.userId, 2340043));
  const ryanProfile = profiles[0];
  console.log("\nVerification — Ryan keyAccounts stored:", ryanProfile?.keyAccounts);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
