/**
 * Hunter.io enrichment for Hot tier campaign contacts that Apollo missed.
 * Runs Hunter domain search + email finder on contacts with enrichmentStatus = "not_found".
 * 
 * Usage: npx tsx scripts/hunter-enrich-hot.ts
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, desc } from "drizzle-orm";
import { campaignContacts } from "../drizzle/schema";
import { batchHunterEnrich } from "../server/hunterService";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL not set");
  if (!process.env.HUNTER_API_KEY) throw new Error("HUNTER_API_KEY not set");

  const connection = await mysql.createConnection(connectionString);
  const db = drizzle(connection);

  // Get Hot tier contacts that Apollo missed (not_found status)
  const hotNotFound = await db
    .select()
    .from(campaignContacts)
    .where(
      and(
        eq(campaignContacts.tier, "tier1_hot"),
        eq(campaignContacts.enrichmentStatus, "not_found"),
      )
    )
    .orderBy(desc(campaignContacts.score));

  console.log(`\n🔥 Found ${hotNotFound.length} Hot tier contacts that Apollo missed\n`);

  if (hotNotFound.length === 0) {
    console.log("Nothing to enrich. Exiting.");
    await connection.end();
    return;
  }

  // Prepare contacts for Hunter enrichment
  const hunterContacts = hotNotFound.map(c => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    company: c.reviewedCompanyName || c.company,
  }));

  console.log(`🔍 Running Hunter.io enrichment on ${hunterContacts.length} contacts...\n`);

  const hunterResults = await batchHunterEnrich(hunterContacts, {
    useFallbackFinder: true,
    rateLimitMs: 250,
  });

  console.log(`\n📊 Hunter.io Results:`);
  console.log(`   Found: ${hunterResults.results.length}`);
  console.log(`   Domain searches: ${hunterResults.domainSearches}`);
  console.log(`   Email finder calls: ${hunterResults.emailFinderCalls}`);

  // Build lookup of Hunter results by contact ID
  const hunterById = new Map<number, (typeof hunterResults.results)[0]>();
  for (const r of hunterResults.results) {
    hunterById.set(r.contactId, r);
  }

  // Update contacts with Hunter results
  let enriched = 0;
  let stillNotFound = 0;

  for (const contact of hotNotFound) {
    const hunterResult = hunterById.get(contact.id);

    if (hunterResult && hunterResult.email) {
      await db.update(campaignContacts).set({
        enrichmentStatus: "enriched",
        enrichmentSource: "hunter",
        enrichedEmail: hunterResult.email,
        enrichedLinkedin: hunterResult.linkedin || undefined,
        hunterConfidence: hunterResult.confidence,
        hunterVerificationStatus: hunterResult.verificationStatus,
        enrichedAt: new Date(),
      }).where(eq(campaignContacts.id, contact.id));

      enriched++;
      console.log(`  ✅ ${contact.firstName} ${contact.lastName} @ ${contact.company} → ${hunterResult.email} (${hunterResult.confidence}% confidence, ${hunterResult.source})`);
    } else {
      stillNotFound++;
    }
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`🎯 ENRICHMENT SUMMARY`);
  console.log(`═══════════════════════════════════════`);
  console.log(`   Total Hot contacts processed: ${hotNotFound.length}`);
  console.log(`   ✅ Enriched by Hunter.io: ${enriched}`);
  console.log(`   ❌ Still not found: ${stillNotFound}`);
  console.log(`   📧 Domain searches used: ${hunterResults.domainSearches}`);
  console.log(`   🔍 Email finder calls used: ${hunterResults.emailFinderCalls}`);
  console.log(`═══════════════════════════════════════\n`);

  await connection.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
