import "dotenv/config";
import { getDb } from "./server/db";
import { digestSendControl } from "./drizzle/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();

  // Check current state
  const existing = await db.select().from(digestSendControl).where(eq(digestSendControl.territory, "WA"));
  console.log("Current WA digestSendControl state:", existing);

  if (existing.length === 0) {
    // Create the record with firstSendApproved=true
    await db.insert(digestSendControl).values({
      territory: "WA",
      firstSendApproved: true,
      firstSendApprovedAt: new Date(),
      firstSendApprovedBy: "admin-validation-2026-05-06",
      autoSendEnabled: false, // Will be set to true after first live send completes
      lastPreviewAt: new Date(),
    });
    console.log("✓ Created WA digestSendControl with firstSendApproved=true");
  } else {
    // Update existing record
    await db.update(digestSendControl)
      .set({
        firstSendApproved: true,
        firstSendApprovedAt: new Date(),
        firstSendApprovedBy: "admin-validation-2026-05-06",
        lastPreviewAt: new Date(),
      })
      .where(eq(digestSendControl.territory, "WA"));
    console.log("✓ Updated WA digestSendControl: firstSendApproved=true");
  }

  // Verify
  const updated = await db.select().from(digestSendControl).where(eq(digestSendControl.territory, "WA"));
  console.log("\nVerified WA digestSendControl after update:");
  console.log("  territory:", updated[0].territory);
  console.log("  firstSendApproved:", updated[0].firstSendApproved);
  console.log("  firstSendApprovedAt:", updated[0].firstSendApprovedAt);
  console.log("  firstSendApprovedBy:", updated[0].firstSendApprovedBy);
  console.log("  autoSendEnabled:", updated[0].autoSendEnabled);
  console.log("  lastPreviewAt:", updated[0].lastPreviewAt);

  console.log("\n✓ WA first send approved. Next Monday digest (2026-05-11 06:00 AWST) will send live.");

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
