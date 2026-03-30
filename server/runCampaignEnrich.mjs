/**
 * runCampaignEnrich.mjs — Apollo enrichment for top 25 Tier 1 campaign contacts
 * Uses the people/match endpoint (1 credit each) with first_name, last_name, organization_name
 */

import "dotenv/config";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const url = new URL(DATABASE_URL);
const pool = mysql.createPool({
  host: url.hostname,
  port: parseInt(url.port || "3306"),
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: true },
  waitForConnections: true,
  connectionLimit: 5,
});

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
if (!APOLLO_API_KEY) { console.error("APOLLO_API_KEY not set"); process.exit(1); }

async function main() {
  console.log("=== Apollo Enrichment for XAVS1800 Campaign ===\n");

  // Find the campaign
  const [campaigns] = await pool.query("SELECT * FROM campaigns WHERE name LIKE '%XAVS1800%' LIMIT 1");
  if (!campaigns.length) { console.error("No XAVS1800 campaign found"); process.exit(1); }
  const campaign = campaigns[0];

  // Reset previously failed contacts so we can retry
  await pool.query(
    "UPDATE campaignContacts SET enrichmentStatus = 'pending' WHERE campaignId = ? AND enrichmentStatus = 'failed'",
    [campaign.id]
  );

  // Get top 25 contacts needing enrichment, ordered by score
  const [toEnrich] = await pool.query(
    `SELECT id, firstName, lastName, title, company, reviewedCompanyName, email, score, tier
     FROM campaignContacts 
     WHERE campaignId = ? AND enrichmentStatus = 'pending'
     ORDER BY score DESC 
     LIMIT 25`,
    [campaign.id]
  );

  console.log(`Found ${toEnrich.length} contacts to enrich\n`);

  let enriched = 0;
  let notFound = 0;
  let failed = 0;

  for (const contact of toEnrich) {
    const fullName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim();
    const companyName = contact.reviewedCompanyName || contact.company || "";
    
    // Clean company name — remove PTY LTD, LIMITED, etc for better matching
    const cleanCompany = companyName
      .replace(/\s*(PTY|LTD|LIMITED|PROPRIETARY|INCORPORATED|INC|CORP|CORPORATION|AUSTRALIA|GROUP)\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    console.log(`  ${fullName} @ ${companyName}`);

    try {
      // Use people/match endpoint — this is the enrichment endpoint
      // It costs 1 credit but returns full data including email
      const body = {
        first_name: contact.firstName || undefined,
        last_name: contact.lastName || undefined,
        organization_name: cleanCompany || undefined,
        reveal_phone_number: false,
        reveal_personal_emails: false,
      };

      // Remove undefined fields
      Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

      const res = await fetch("https://api.apollo.io/api/v1/people/match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Api-Key": APOLLO_API_KEY,
          "accept": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown");
        console.log(`    ✗ API error ${res.status}: ${errText.substring(0, 100)}`);
        await pool.query(
          "UPDATE campaignContacts SET enrichmentStatus = 'failed', enrichedAt = NOW() WHERE id = ?",
          [contact.id]
        );
        failed++;
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      const data = await res.json();
      const person = data.person;

      if (!person) {
        console.log(`    ✗ No match found`);
        await pool.query(
          "UPDATE campaignContacts SET enrichmentStatus = 'not_found', enrichedAt = NOW() WHERE id = ?",
          [contact.id]
        );
        notFound++;
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      const email = person.email || null;
      const linkedinUrl = person.linkedin_url || null;
      const enrichedTitle = person.title || null;
      const apolloId = person.id || null;
      const personName = `${person.first_name || ""} ${person.last_name || ""}`.trim();
      const personOrg = person.organization?.name || "";

      if (email) {
        console.log(`    ✓ ENRICHED: ${personName} — ${enrichedTitle || "N/A"} @ ${personOrg}`);
        console.log(`      Email: ${email}`);
        if (linkedinUrl) console.log(`      LinkedIn: ${linkedinUrl}`);

        await pool.query(
          `UPDATE campaignContacts SET 
            enrichmentStatus = 'enriched',
            apolloPersonId = ?,
            enrichedEmail = ?,
            enrichedTitle = ?,
            enrichedLinkedin = ?,
            enrichedAt = NOW()
          WHERE id = ?`,
          [apolloId, email, enrichedTitle, linkedinUrl, contact.id]
        );

        // Re-score with email now available
        const newScore = Math.min((contact.score || 0) + 15, 100);
        const newTier = newScore >= 60 ? "tier1_hot" : newScore >= 40 ? "tier2_warm" : "tier3_enrich";
        await pool.query(
          "UPDATE campaignContacts SET score = ?, tier = ? WHERE id = ?",
          [newScore, newTier, contact.id]
        );

        enriched++;
      } else {
        console.log(`    ~ Found ${personName} @ ${personOrg} but no email available`);
        await pool.query(
          `UPDATE campaignContacts SET 
            enrichmentStatus = 'not_found',
            apolloPersonId = ?,
            enrichedTitle = ?,
            enrichedLinkedin = ?,
            enrichedAt = NOW()
          WHERE id = ?`,
          [apolloId, enrichedTitle, linkedinUrl, contact.id]
        );
        notFound++;
      }

      // Rate limit — 500ms between requests
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`    ✗ Error: ${err.message}`);
      await pool.query(
        "UPDATE campaignContacts SET enrichmentStatus = 'failed', enrichedAt = NOW() WHERE id = ?",
        [contact.id]
      );
      failed++;
    }
  }

  // Update campaign stats
  const [statsResult] = await pool.query(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN enrichmentStatus IN ('enriched', 'not_needed') THEN 1 ELSE 0 END) as enrichedCount
    FROM campaignContacts WHERE campaignId = ?`,
    [campaign.id]
  );
  const stats = statsResult[0];
  await pool.query(
    "UPDATE campaigns SET enrichedContacts = ?, updatedAt = NOW() WHERE id = ?",
    [stats.enrichedCount, campaign.id]
  );

  console.log(`\n━━━ Enrichment Results ━━━`);
  console.log(`  Enriched: ${enriched}`);
  console.log(`  Not Found: ${notFound}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Credits Used: ~${enriched} (1 per enriched contact)`);

  await pool.end();
  console.log("\n✓ Done!");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
