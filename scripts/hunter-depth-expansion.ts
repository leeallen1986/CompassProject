/**
 * Company Depth Expansion — Hunter.io Domain Search
 *
 * Finds additional contacts in relevant roles at companies where
 * we already have verified Hot contacts.
 *
 * Strategy:
 * 1. Get unique domains from verified Hunter Hot contacts
 * 2. Domain Search each domain (1 credit per domain, returns up to 100 emails)
 * 3. Filter for relevant roles (blasting, coating, operations, procurement, project mgmt)
 * 4. Deduplicate against existing campaign contacts
 * 5. Insert new contacts as Tier 1 Hot with Hunter enrichment source
 */

import * as dotenv from "dotenv";
dotenv.config();

import mysql from "mysql2/promise";
import { domainSearch, type HunterEmail } from "../server/hunterService";

const HUNTER_API_BASE = "https://api.hunter.io/v2";

// Relevant role keywords for blasting/coating/industrial services
const RELEVANT_ROLE_KEYWORDS = [
  // Blasting & Coating specific
  "blast", "blasting", "coating", "paint", "surface", "corrosion",
  "abrasive", "sandblast", "uhp", "protective",
  // Operations & Management
  "operations", "general manager", "managing director", "director",
  "branch manager", "site manager", "project manager", "works manager",
  // Procurement & Purchasing
  "procurement", "purchasing", "buyer", "supply chain",
  // Technical & Engineering
  "engineer", "technical", "supervisor", "coordinator", "inspector",
  "quality", "qaqc", "qa/qc", "estimator", "planner",
  // Safety & Compliance
  "safety", "hse", "whs", "environment",
  // Business Development
  "business development", "sales", "commercial",
];

// Generic email addresses to skip
const GENERIC_PREFIXES = [
  "info", "admin", "contact", "office", "reception", "accounts",
  "support", "hello", "enquiries", "enquiry", "mail", "general",
  "hr", "jobs", "careers", "marketing", "sales", "team",
  "noreply", "no-reply", "webmaster", "postmaster",
];

function isRelevantRole(position: string | null): boolean {
  if (!position) return false;
  const lower = position.toLowerCase();
  return RELEVANT_ROLE_KEYWORDS.some(kw => lower.includes(kw));
}

function isGenericEmail(email: string): boolean {
  const prefix = email.split("@")[0].toLowerCase();
  return GENERIC_PREFIXES.some(g => prefix === g || prefix.startsWith(g + "."));
}

function classifyTitleRelevance(position: string | null): string {
  if (!position) return "unknown";
  const lower = position.toLowerCase();
  if (/blast|coating|paint|surface|corrosion|abrasive|uhp|protective/.test(lower)) return "blasting_specialist";
  if (/director|general manager|managing director|ceo|coo|owner|principal/.test(lower)) return "decision_maker";
  if (/operations|site manager|branch manager|works manager|supervisor|coordinator/.test(lower)) return "operations";
  return "other";
}

function computeScore(email: HunterEmail): number {
  let score = 50; // base
  // Confidence boost
  if (email.confidence >= 95) score += 20;
  else if (email.confidence >= 85) score += 15;
  else if (email.confidence >= 70) score += 10;
  // Verification boost
  if (email.verification?.status === "valid") score += 15;
  else if (email.verification?.status === "accept_all") score += 5;
  // LinkedIn boost
  if (email.linkedin) score += 5;
  // Role relevance boost
  const relevance = classifyTitleRelevance(email.position);
  if (relevance === "blasting_specialist") score += 10;
  else if (relevance === "decision_maker") score += 8;
  else if (relevance === "operations") score += 5;
  return Math.min(score, 100);
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  // Step 1: Get unique domains from verified Hunter Hot contacts
  const [domainRows] = await conn.execute<any[]>(`
    SELECT DISTINCT 
      SUBSTRING_INDEX(enrichedEmail, '@', -1) as domain, 
      company,
      COUNT(*) as existingCount
    FROM campaignContacts 
    WHERE tier = 'tier1_hot' 
      AND enrichmentStatus = 'enriched' 
      AND enrichmentSource_cc = 'hunter' 
      AND hunterVerificationStatus IN ('valid', 'accept_all')
      AND enrichedEmail IS NOT NULL
    GROUP BY domain, company
    ORDER BY existingCount DESC
  `);

  console.log(`\n=== Company Depth Expansion ===`);
  console.log(`Found ${domainRows.length} unique domains from verified Hot contacts\n`);

  // Step 2: Get ALL existing emails in the campaign to deduplicate
  const [existingEmails] = await conn.execute<any[]>(`
    SELECT LOWER(COALESCE(enrichedEmail, email)) as existingEmail
    FROM campaignContacts 
    WHERE campaignId = 1
      AND (enrichedEmail IS NOT NULL OR email IS NOT NULL)
  `);
  const existingEmailSet = new Set(
    existingEmails.map((r: any) => r.existingEmail?.toLowerCase()).filter(Boolean)
  );
  console.log(`Existing emails in campaign: ${existingEmailSet.size}`);

  // Also get existing name+company combos for dedup
  const [existingNames] = await conn.execute<any[]>(`
    SELECT LOWER(CONCAT(COALESCE(firstName,''), '|', COALESCE(lastName,''), '|', company)) as nameKey
    FROM campaignContacts 
    WHERE campaignId = 1
  `);
  const existingNameSet = new Set(existingNames.map((r: any) => r.nameKey));

  // Check Hunter credits remaining
  const creditsRes = await fetch(`${HUNTER_API_BASE}/account?api_key=${process.env.HUNTER_API_KEY}`);
  const creditsData = await creditsRes.json();
  const searchesUsed = creditsData.data?.requests?.searches?.used ?? 0;
  const searchesAvail = creditsData.data?.requests?.searches?.available ?? 0;
  console.log(`Hunter.io credits: ${searchesUsed}/${searchesAvail} searches used\n`);

  if (searchesAvail - searchesUsed < domainRows.length) {
    console.log(`⚠ Not enough credits for all ${domainRows.length} domains. Will process as many as possible.`);
  }

  // Step 3: Domain Search each domain and collect new contacts
  let totalNew = 0;
  let totalSkippedDuplicate = 0;
  let totalSkippedGeneric = 0;
  let totalSkippedIrrelevant = 0;
  let domainsProcessed = 0;
  let domainsFailed = 0;
  const newContacts: any[] = [];

  for (const row of domainRows) {
    const domain = row.domain;
    const company = row.company;
    domainsProcessed++;

    try {
      console.log(`[${domainsProcessed}/${domainRows.length}] Searching ${domain} (${company})...`);

      const result = await domainSearch(domain, { type: "personal", limit: 100 });

      let domainNew = 0;
      for (const email of result.emails) {
        // Skip generic emails
        if (isGenericEmail(email.value)) {
          totalSkippedGeneric++;
          continue;
        }

        // Skip if email already exists
        if (existingEmailSet.has(email.value.toLowerCase())) {
          totalSkippedDuplicate++;
          continue;
        }

        // Skip if not a relevant role (but keep if no position — we'll classify later)
        if (email.position && !isRelevantRole(email.position)) {
          totalSkippedIrrelevant++;
          continue;
        }

        // Skip if no first/last name
        if (!email.first_name || !email.last_name) {
          continue;
        }

        // Check name+company dedup
        const nameKey = `${(email.first_name || "").toLowerCase()}|${(email.last_name || "").toLowerCase()}|${company}`;
        if (existingNameSet.has(nameKey)) {
          totalSkippedDuplicate++;
          continue;
        }

        // New contact! Add to batch
        const score = computeScore(email);
        const titleRelevance = classifyTitleRelevance(email.position);

        newContacts.push({
          campaignId: 1,
          firstName: email.first_name,
          lastName: email.last_name,
          title: email.position || null,
          company: company,
          enrichedEmail: email.value,
          enrichedTitle: email.position || null,
          enrichedLinkedin: email.linkedin || null,
          score,
          tier: "tier1_hot",
          titleRelevance,
          enrichmentStatus: "enriched",
          enrichmentSource: "hunter",
          hunterConfidence: email.confidence,
          hunterVerificationStatus: email.verification?.status || null,
          enrichedAt: new Date(),
          outreachStatus: "not_started",
        });

        // Track to avoid inserting same email twice
        existingEmailSet.add(email.value.toLowerCase());
        existingNameSet.add(nameKey);
        domainNew++;
        totalNew++;
      }

      if (domainNew > 0) {
        console.log(`  → Found ${domainNew} new contacts (${result.emails.length} total from domain)`);
      } else {
        console.log(`  → No new contacts (${result.emails.length} total, all existing/filtered)`);
      }

      // Rate limit: 250ms between requests
      await new Promise(r => setTimeout(r, 250));

    } catch (err: any) {
      console.error(`  ✗ Failed: ${err.message}`);
      domainsFailed++;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\n=== Domain Search Complete ===`);
  console.log(`Domains processed: ${domainsProcessed} (${domainsFailed} failed)`);
  console.log(`New contacts found: ${totalNew}`);
  console.log(`Skipped (duplicate): ${totalSkippedDuplicate}`);
  console.log(`Skipped (generic): ${totalSkippedGeneric}`);
  console.log(`Skipped (irrelevant role): ${totalSkippedIrrelevant}`);

  // Step 4: Insert new contacts in batches
  if (newContacts.length > 0) {
    console.log(`\nInserting ${newContacts.length} new contacts into campaign...`);

    const BATCH_SIZE = 25;
    let inserted = 0;

    for (let i = 0; i < newContacts.length; i += BATCH_SIZE) {
      const batch = newContacts.slice(i, i + BATCH_SIZE);

      const placeholders = batch.map(() =>
        "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).join(", ");

      const values = batch.flatMap(c => [
        c.campaignId,
        c.firstName,
        c.lastName,
        c.title,
        c.company,
        c.enrichedEmail,
        c.enrichedTitle,
        c.enrichedLinkedin,
        c.score,
        c.tier,
        c.titleRelevance,
        c.enrichmentStatus,
        c.enrichmentSource,
        c.hunterConfidence,
        c.hunterVerificationStatus,
        c.enrichedAt,
        c.outreachStatus,
      ]);

      await conn.execute(
        `INSERT INTO campaignContacts 
         (campaignId, firstName, lastName, title, company, enrichedEmail, enrichedTitle, enrichedLinkedin, score, tier, titleRelevance, enrichmentStatus, enrichmentSource_cc, hunterConfidence, hunterVerificationStatus, enrichedAt, outreachStatus)
         VALUES ${placeholders}`,
        values
      );

      inserted += batch.length;
      console.log(`  Inserted batch ${Math.ceil((i + 1) / BATCH_SIZE)}: ${inserted}/${newContacts.length}`);
    }

    console.log(`\n✓ Successfully inserted ${inserted} new contacts`);
  }

  // Step 5: Summary stats
  const [finalStats] = await conn.execute<any[]>(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN enrichmentStatus = 'enriched' THEN 1 ELSE 0 END) as enriched,
      SUM(CASE WHEN enrichmentSource_cc = 'hunter' THEN 1 ELSE 0 END) as hunterTotal,
      SUM(CASE WHEN enrichmentSource_cc = 'apollo' THEN 1 ELSE 0 END) as apolloTotal,
      SUM(CASE WHEN hunterVerificationStatus = 'valid' THEN 1 ELSE 0 END) as verified
    FROM campaignContacts 
    WHERE tier = 'tier1_hot'
  `);

  console.log(`\n=== Final Hot Tier Stats ===`);
  console.log(`Total Hot contacts: ${finalStats[0].total}`);
  console.log(`Enriched: ${finalStats[0].enriched}`);
  console.log(`  - Apollo: ${finalStats[0].apolloTotal}`);
  console.log(`  - Hunter: ${finalStats[0].hunterTotal}`);
  console.log(`Verified (valid): ${finalStats[0].verified}`);

  // Show top new contacts by score
  if (newContacts.length > 0) {
    console.log(`\n=== Top New Contacts (by score) ===`);
    const sorted = [...newContacts].sort((a, b) => b.score - a.score).slice(0, 20);
    for (const c of sorted) {
      console.log(`  ${c.firstName} ${c.lastName} — ${c.title || "N/A"} @ ${c.company}`);
      console.log(`    Email: ${c.enrichedEmail} (${c.hunterConfidence}% ${c.hunterVerificationStatus || "unverified"})`);
      if (c.enrichedLinkedin) console.log(`    LinkedIn: ${c.enrichedLinkedin}`);
    }
  }

  await conn.end();
  console.log("\nDone!");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
