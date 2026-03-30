/**
 * runCampaignActions.mjs — Execute the three campaign actions:
 * 1. Apollo enrichment on top 25 Tier 1 contacts
 * 2. Cross-reference contacts against XAVS1800-matched projects
 * 3. Generate pilot emails for top 5 enriched contacts
 */

import "dotenv/config";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// Parse the DATABASE_URL
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

async function main() {
  console.log("=== XAVS1800 Campaign Actions ===\n");

  // Find the XAVS1800 campaign
  const [campaigns] = await pool.query("SELECT * FROM campaigns WHERE name LIKE '%XAVS1800%' LIMIT 1");
  if (!campaigns.length) {
    console.error("No XAVS1800 campaign found");
    process.exit(1);
  }
  const campaign = campaigns[0];
  console.log(`Campaign: ${campaign.name} (ID: ${campaign.id})`);
  console.log(`Total contacts: ${campaign.totalContacts}\n`);

  // ── Step 1: Apollo Enrichment on Top 25 Tier 1 Contacts ──
  console.log("━━━ STEP 1: Apollo Enrichment (Top 25 Tier 1) ━━━\n");

  // Get top 25 contacts needing enrichment, ordered by score
  const [toEnrich] = await pool.query(
    `SELECT id, firstName, lastName, title, company, reviewedCompanyName, email, score, tier, enrichmentStatus
     FROM campaignContacts 
     WHERE campaignId = ? AND enrichmentStatus = 'pending'
     ORDER BY score DESC 
     LIMIT 25`,
    [campaign.id]
  );

  console.log(`Found ${toEnrich.length} contacts needing enrichment\n`);

  const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
  if (!APOLLO_API_KEY) {
    console.error("APOLLO_API_KEY not set — skipping enrichment");
  } else {
    let enriched = 0;
    let notFound = 0;
    let failed = 0;

    for (const contact of toEnrich) {
      const fullName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim();
      const companyName = contact.reviewedCompanyName || contact.company;
      console.log(`  Enriching: ${fullName} @ ${companyName} (score: ${contact.score}, tier: ${contact.tier})`);

      try {
        // Apollo People Search
        const searchBody = {
          person_titles: contact.title ? [contact.title] : undefined,
          q_keywords: `${fullName} ${companyName}`.trim(),
          organization_locations: ["Australia"],
          per_page: 5,
        };

        const searchRes = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": APOLLO_API_KEY,
          },
          body: JSON.stringify(searchBody),
        });

        if (!searchRes.ok) {
          console.log(`    ✗ Apollo search failed: ${searchRes.status}`);
          await pool.query(
            "UPDATE campaignContacts SET enrichmentStatus = 'failed', enrichedAt = NOW() WHERE id = ?",
            [contact.id]
          );
          failed++;
          continue;
        }

        const searchData = await searchRes.json();
        const people = searchData.people || [];

        if (people.length === 0) {
          console.log(`    ✗ No results found`);
          await pool.query(
            "UPDATE campaignContacts SET enrichmentStatus = 'not_found', enrichedAt = NOW() WHERE id = ?",
            [contact.id]
          );
          notFound++;
          continue;
        }

        // Find best match by name
        const contactNameLower = fullName.toLowerCase();
        let bestMatch = people[0];
        for (const person of people) {
          const personName = `${person.first_name || ""} ${person.last_name || ""}`.trim().toLowerCase();
          if (personName === contactNameLower || personName.includes(contactNameLower) || contactNameLower.includes(person.first_name?.toLowerCase() || "")) {
            bestMatch = person;
            break;
          }
        }

        const matchName = `${bestMatch.first_name || ""} ${bestMatch.last_name || ""}`.trim();
        console.log(`    Found: ${matchName} — ${bestMatch.title || "N/A"} @ ${bestMatch.organization?.name || "N/A"}`);

        // If they have email, enrich to get it
        if (bestMatch.email) {
          console.log(`    ✓ Email found: ${bestMatch.email}`);
          await pool.query(
            `UPDATE campaignContacts SET 
              enrichmentStatus = 'enriched',
              apolloPersonId = ?,
              enrichedEmail = ?,
              enrichedTitle = ?,
              enrichedLinkedin = ?,
              enrichedAt = NOW()
            WHERE id = ?`,
            [
              bestMatch.id,
              bestMatch.email,
              bestMatch.title || null,
              bestMatch.linkedin_url || null,
              contact.id,
            ]
          );

          // Re-score with email now available
          const newScore = Math.min(
            (contact.score || 0) + 15, // email bonus
            100
          );
          const newTier = newScore >= 60 ? "tier1_hot" : newScore >= 40 ? "tier2_warm" : "tier3_enrich";
          await pool.query(
            "UPDATE campaignContacts SET score = ?, tier = ? WHERE id = ?",
            [newScore, newTier, contact.id]
          );

          enriched++;
        } else if (bestMatch.has_email) {
          // Need to call the enrichment endpoint to reveal email
          console.log(`    → Has email, enriching to reveal...`);
          const enrichRes = await fetch("https://api.apollo.io/api/v1/people/match", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Api-Key": APOLLO_API_KEY,
            },
            body: JSON.stringify({
              id: bestMatch.id,
              reveal_personal_emails: false,
              reveal_phone_number: false,
            }),
          });

          if (enrichRes.ok) {
            const enrichData = await enrichRes.json();
            const person = enrichData.person || {};
            const email = person.email || null;
            const linkedinUrl = person.linkedin_url || bestMatch.linkedin_url || null;
            const enrichedTitle = person.title || bestMatch.title || null;

            if (email) {
              console.log(`    ✓ Email revealed: ${email}`);
              await pool.query(
                `UPDATE campaign_contacts SET 
                  enrichmentStatus = 'enriched',
                  apolloPersonId = ?,
                  enrichedEmail = ?,
                  enrichedTitle = ?,
                  enrichedLinkedin = ?,
                  enrichedAt = NOW()
                WHERE id = ?`,
                [person.id || bestMatch.id, email, enrichedTitle, linkedinUrl, contact.id]
              );

              const newScore = Math.min((contact.score || 0) + 15, 100);
              const newTier = newScore >= 60 ? "tier1_hot" : newScore >= 40 ? "tier2_warm" : "tier3_enrich";
              await pool.query(
                "UPDATE campaignContacts SET score = ?, tier = ? WHERE id = ?",
                [newScore, newTier, contact.id]
              );

              enriched++;
            } else {
              console.log(`    ✗ Email not revealed`);
              await pool.query(
                `UPDATE campaign_contacts SET 
                  enrichmentStatus = 'not_found',
                  apolloPersonId = ?,
                  enrichedTitle = ?,
                  enrichedLinkedin = ?,
                  enrichedAt = NOW()
                WHERE id = ?`,
                [bestMatch.id, enrichedTitle, linkedinUrl, contact.id]
              );
              notFound++;
            }
          } else {
            console.log(`    ✗ Enrichment API failed: ${enrichRes.status}`);
            notFound++;
          }
        } else {
          console.log(`    ✗ No email available for this person`);
          await pool.query(
            `UPDATE campaignContacts SET 
              enrichmentStatus = 'not_found',
              apolloPersonId = ?,
              enrichedTitle = ?,
              enrichedLinkedin = ?,
              enrichedAt = NOW()
            WHERE id = ?`,
            [bestMatch.id, bestMatch.title || null, bestMatch.linkedin_url || null, contact.id]
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

    console.log(`\n  Enrichment Results: ${enriched} enriched, ${notFound} not found, ${failed} failed\n`);
  }

  // ── Step 2: Match Contacts to XAVS1800 Projects ──
  console.log("━━━ STEP 2: Match Contacts to XAVS1800 Projects ━━━\n");

  // Get collateral-matched project IDs
  const collateralId = campaign.collateralId;
  if (!collateralId) {
    console.log("  No collateral linked to campaign — skipping project matching\n");
  } else {
    const [projectMatches] = await pool.query(
      "SELECT projectId FROM collateralProjectMatches WHERE collateralId = ?",
      [collateralId]
    );

    console.log(`  Found ${projectMatches.length} projects matched to XAVS1800 collateral\n`);

    if (projectMatches.length > 0) {
      const matchedProjectIds = projectMatches.map(m => m.projectId);

      // Get project details for company matching
      const [matchedProjects] = await pool.query(
        `SELECT id, name, owner, location FROM projects WHERE id IN (${matchedProjectIds.map(() => "?").join(",")})`,
        matchedProjectIds
      );

      console.log(`  Project owners to match against:`);
      const uniqueOwners = [...new Set(matchedProjects.map(p => p.owner).filter(Boolean))];
      for (const owner of uniqueOwners.slice(0, 20)) {
        console.log(`    - ${owner}`);
      }
      console.log();

      // Get all campaign contacts
      const [allContacts] = await pool.query(
        "SELECT id, company, reviewedCompanyName, score, title, email, mobile, matchedProjectCount FROM campaignContacts WHERE campaignId = ?",
        [campaign.id]
      );

      let matched = 0;
      for (const contact of allContacts) {
        const companyName = (contact.reviewedCompanyName || contact.company || "").toLowerCase().trim();
        if (!companyName) continue;

        const contactProjectIds = [];
        for (const proj of matchedProjects) {
          const ownerLower = (proj.owner || "").toLowerCase().trim();
          if (!ownerLower) continue;

          // Fuzzy match: company name contains project owner or vice versa
          if (companyName.includes(ownerLower) || ownerLower.includes(companyName)) {
            contactProjectIds.push(proj.id);
          }
        }

        if (contactProjectIds.length > 0) {
          matched++;
          await pool.query(
            "UPDATE campaignContacts SET matchedProjectIds = ?, matchedProjectCount = ? WHERE id = ?",
            [JSON.stringify(contactProjectIds), contactProjectIds.length, contact.id]
          );

          // Re-score with project match bonus
          const titleScore = contact.title ? (
            /blast|paint|coat|surface|corrosion|abrasive/i.test(contact.title) ? 40 :
            /managing\s*director|general\s*manager|ceo|coo|director|owner|operations\s*manager|project\s*manager|procurement|fleet|equipment|maintenance/i.test(contact.title) ? 35 :
            /supervisor|superintendent|coordinator|engineer|inspector|planner|site\s*manager/i.test(contact.title) ? 20 : 10
          ) : 0;

          let newScore = titleScore;
          const emailAddr = contact.email; // check enrichedEmail too
          if (emailAddr) newScore += 15;
          if (contact.mobile) newScore += 5;
          if (contact.title) newScore += 10;
          newScore += Math.min(contactProjectIds.length * 5, 30);
          newScore = Math.min(newScore, 100);

          const newTier = (newScore >= 60 && emailAddr) ? "tier1_hot" :
                          (newScore >= 40 && emailAddr) ? "tier2_warm" :
                          newScore >= 20 ? "tier3_enrich" : "tier4_low";

          await pool.query(
            "UPDATE campaignContacts SET score = ?, tier = ? WHERE id = ?",
            [newScore, newTier, contact.id]
          );
        }
      }

      console.log(`  Matched ${matched} contacts to projects out of ${allContacts.length} total\n`);
    }
  }

  // Update campaign stats
  const [statsResult] = await pool.query(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN enrichmentStatus IN ('enriched', 'not_needed') THEN 1 ELSE 0 END) as enriched,
      SUM(CASE WHEN outreachStatus != 'not_started' THEN 1 ELSE 0 END) as drafted,
      SUM(CASE WHEN outreachStatus IN ('approved', 'sent') THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN outreachStatus = 'sent' THEN 1 ELSE 0 END) as sent
    FROM campaignContacts WHERE campaignId = ?`,
    [campaign.id]
  );
  const stats = statsResult[0];
  await pool.query(
    `UPDATE campaigns SET 
      totalContacts = ?, enrichedContacts = ?, emailsDrafted = ?, emailsApproved = ?, emailsSent = ?,
      updatedAt = NOW()
    WHERE id = ?`,
    [stats.total, stats.enriched, stats.drafted, stats.approved, stats.sent, campaign.id]
  );

  // ── Step 3: Show Top 5 Contacts Ready for Pilot Emails ──
  console.log("━━━ STEP 3: Top 5 Contacts for Pilot Emails ━━━\n");

  // Get top 5 contacts with emails (enriched or original), highest score
  const [topContacts] = await pool.query(
    `SELECT id, firstName, lastName, title, company, reviewedCompanyName, 
            email, enrichedEmail, enrichedTitle, enrichedLinkedin,
            score, tier, titleRelevance, matchedProjectCount, outreachStatus
     FROM campaignContacts 
     WHERE campaignId = ? AND (email IS NOT NULL OR enrichedEmail IS NOT NULL)
     ORDER BY score DESC 
     LIMIT 5`,
    [campaign.id]
  );

  console.log(`  Top 5 contacts ready for pilot emails:\n`);
  for (let i = 0; i < topContacts.length; i++) {
    const c = topContacts[i];
    const name = `${c.firstName || ""} ${c.lastName || ""}`.trim();
    const emailAddr = c.enrichedEmail || c.email;
    const title = c.enrichedTitle || c.title || "N/A";
    const company = c.reviewedCompanyName || c.company;
    console.log(`  ${i + 1}. ${name}`);
    console.log(`     Title: ${title}`);
    console.log(`     Company: ${company}`);
    console.log(`     Email: ${emailAddr}`);
    console.log(`     Score: ${c.score} | Tier: ${c.tier} | Relevance: ${c.titleRelevance}`);
    console.log(`     Project Matches: ${c.matchedProjectCount || 0}`);
    if (c.enrichedLinkedin) console.log(`     LinkedIn: ${c.enrichedLinkedin}`);
    console.log();
  }

  // Print final tier breakdown
  const [tierBreakdown] = await pool.query(
    "SELECT tier, COUNT(*) as cnt FROM campaignContacts WHERE campaignId = ? GROUP BY tier ORDER BY tier",
    [campaign.id]
  );
  console.log("━━━ Final Tier Breakdown ━━━\n");
  for (const row of tierBreakdown) {
    console.log(`  ${row.tier}: ${row.cnt}`);
  }

  // Print IDs of top 5 for email generation
  console.log("\n━━━ Contact IDs for Email Generation ━━━\n");
  console.log(`  ${topContacts.map(c => c.id).join(", ")}`);

  await pool.end();
  console.log("\n✓ All campaign actions complete!");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
