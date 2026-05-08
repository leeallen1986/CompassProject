/**
 * Part A+B: Check current keyword coverage and update Portable Air business line
 * with missing application-family keywords for Ryan's WA universe.
 */
import { getDb } from "../server/db";
import { businessLines } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  const [bl] = await db.select().from(businessLines).where(eq(businessLines.id, 1));
  const currentKws = (bl.keywords as string[]).map(k => k.toLowerCase());
  console.log("=== CURRENT PORTABLE AIR KEYWORD COUNT:", currentKws.length, "===\n");

  // ── Keywords to ADD (application-family gaps) ──
  const toAdd: string[] = [
    // Waterwell / Bore
    "water well", "waterwell", "water bore", "groundwater bore", "bore hole", "borehole",
    "dewatering bore", "water well drilling", "bore drilling", "water supply bore",
    // Piling
    "piling", "driven pile", "bored pile", "CFA pile", "sheet pile", "foundation pile",
    "piling rig", "pile driving", "pile installation", "deep foundation",
    // Shutdown / Turnaround
    "shutdown", "turnaround", "planned outage", "maintenance shutdown", "plant turnaround",
    "annual shutdown", "plant shutdown", "facility shutdown", "refinery shutdown",
    "scheduled shutdown", "maintenance outage", "plant maintenance",
    // Abrasive Blasting / Surface Prep
    "abrasive blasting", "grit blasting", "surface preparation", "blast and paint",
    "corrosion protection", "protective coating", "blast cleaning", "sand blasting",
    "steel preparation", "surface treatment", "coating application",
    // Temporary Plant Air / Site Air
    "site air", "construction air", "temporary air supply", "plant air", "workshop air",
    "temporary compressor", "hire compressor", "rental compressor", "portable air hire",
    "air supply contract", "compressed air supply",
    // Specialty Air / Gas
    "nitrogen", "n2 membrane", "purging", "inerting", "inert gas", "dry-out", "dryout",
    "pre-commissioning", "precommissioning", "commissioning air", "pipeline testing",
    "pressure testing", "leak testing", "booster compressor", "high-pressure testing",
    "high pressure air", "nitrogen purge", "pipeline purge", "gas purge",
    "pipeline commissioning", "pipeline pre-commissioning",
  ];

  // ── Keywords to REMOVE (false positives / too generic) ──
  const toRemove: string[] = [
    "school construction", "hospital construction", "prison construction",
    "airport construction", "fitout", "refurbishment", "demolition",
    "remediation", "precinct", "development approval",
    "tops out", "construction begins", "construction starts",
    "motorway", "freeway", "interchange", "bypass",
    "sewerage", "stormwater",
    "underground power", "underground cable", "cable laying", "cable installation",
    "HV feeder", "HV cable", "LV cable", "substation construction",
    "cable hauling", "cable jointing", "underground reticulation",
    "transmission line construction", "distribution network construction",
    "underground utility", "conduit installation", "cable duct",
    "power reticulation", "underground electrical", "feeder upgrade",
    "pit and pipe", "cable trenching", "underground infrastructure contractor",
    "cable layer", "cable contractor", "underground power contractor",
  ];

  // Check which adds are actually new
  const genuinelyNew = toAdd.filter(k => !currentKws.includes(k.toLowerCase()));
  const genuinelyRemoved = toRemove.filter(k => currentKws.includes(k.toLowerCase()));

  console.log("=== KEYWORDS TO ADD (" + genuinelyNew.length + " new) ===");
  genuinelyNew.forEach(k => console.log("  +", k));

  console.log("\n=== KEYWORDS TO REMOVE (" + genuinelyRemoved.length + " removed) ===");
  genuinelyRemoved.forEach(k => console.log("  -", k));

  // Build new keyword list
  const removeSet = new Set(toRemove.map(k => k.toLowerCase()));
  const existingKws = bl.keywords as string[];
  const filtered = existingKws.filter(k => !removeSet.has(k.toLowerCase()));
  const newKws = [...filtered, ...genuinelyNew];

  console.log("\n=== KEYWORD COUNT: " + existingKws.length + " → " + newKws.length + " ===");

  // Apply update
  await db.update(businessLines)
    .set({ keywords: newKws, updatedAt: new Date() })
    .where(eq(businessLines.id, 1));

  console.log("\n✓ Portable Air keywords updated successfully");
  console.log("  Before:", existingKws.length, "keywords");
  console.log("  Added:", genuinelyNew.length, "new keywords");
  console.log("  Removed:", genuinelyRemoved.length, "false-positive keywords");
  console.log("  After:", newKws.length, "keywords");

  // Verify key application families are now covered
  const verifyKws = (bl.keywords as string[]).map(k => k.toLowerCase());
  const newKwsLower = newKws.map(k => k.toLowerCase());
  const checks: [string, string[]][] = [
    ["Waterwell/Bore", ["water well", "borehole", "water bore"]],
    ["Piling", ["piling", "driven pile", "bored pile"]],
    ["Shutdown/Turnaround", ["shutdown", "turnaround", "plant shutdown"]],
    ["Abrasive Blasting", ["abrasive blasting", "grit blasting", "blast and paint"]],
    ["Temporary Plant Air", ["site air", "construction air", "temporary air supply"]],
    ["Specialty Air/Gas", ["nitrogen", "purging", "inerting", "commissioning air", "pipeline testing"]],
  ];

  console.log("\n=== APPLICATION FAMILY COVERAGE VERIFICATION ===");
  for (const [family, terms] of checks) {
    const covered = terms.filter(t => newKwsLower.includes(t.toLowerCase()));
    console.log(`  ${family}: ${covered.length}/${terms.length} terms covered`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
