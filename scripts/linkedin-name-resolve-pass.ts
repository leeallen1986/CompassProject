/**
 * linkedin-name-resolve-pass.ts
 *
 * Resolves privacy-restricted LinkedIn contacts (single-letter last name)
 * by:
 *   1. Extracting the LinkedIn username from the contact's linkedin URL
 *   2. Calling the Manus LinkedIn Profile API to get the full name
 *   3. Updating the contact's name in the DB with the resolved full name
 *   4. Re-running Apollo enrichment on the contact with the full name
 *
 * Usage:
 *   tsx scripts/linkedin-name-resolve-pass.ts [--dry-run]
 */

import "dotenv/config"; // load .env file
import { getDb } from "../server/db";
import { contacts, contactProjects, projects } from "../drizzle/schema";
import { eq, and, isNotNull, ne, sql } from "drizzle-orm";
import { revealContactEmail } from "../server/apolloEnrichment";
import { getBudgetStatus } from "../server/apolloEligibility";

const DRY_RUN = process.argv.includes("--dry-run");
const LINKEDIN_API_URL = process.env.BUILT_IN_FORGE_API_URL || "";
const LINKEDIN_API_KEY = process.env.BUILT_IN_FORGE_API_KEY || "";
const DELAY_MS = 1200; // Respect LinkedIn API rate limits

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract LinkedIn username from a LinkedIn URL.
 * Handles formats like:
 *   https://www.linkedin.com/in/username/
 *   https://linkedin.com/in/username
 *   linkedin.com/in/username
 */
function extractLinkedInUsername(url: string): string | null {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return match ? match[1].replace(/\/$/, "") : null;
}

/**
 * Check if a name has a privacy-restricted last name (single letter + period).
 */
function isPrivacyRestricted(name: string): boolean {
  // Matches: "First L." or "First M. L." or "First-Name L."
  return /^[\w\s-]+ [A-Z]\.$/.test(name.trim());
}

/**
 * Call the Manus LinkedIn Profile API to get full name.
 */
async function getLinkedInFullName(username: string): Promise<{ firstName: string; lastName: string } | null> {
  if (!LINKEDIN_API_URL || !LINKEDIN_API_KEY) {
    console.warn("[LinkedIn] API not configured — skipping");
    return null;
  }

  try {
    const url = `${LINKEDIN_API_URL}/data_api/LinkedIn/get_user_profile_by_username?username=${encodeURIComponent(username)}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${LINKEDIN_API_KEY}`,
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      console.warn(`[LinkedIn] API error ${resp.status} for ${username}`);
      return null;
    }

    const data = await resp.json();

    // Handle nested response structure
    const profile = data?.data || data;
    const firstName = profile?.firstName || profile?.first_name;
    const lastName = profile?.lastName || profile?.last_name;

    if (!firstName || !lastName) {
      console.log(`[LinkedIn] No name found for ${username} (got: ${JSON.stringify({ firstName, lastName })})`);
      return null;
    }

    return { firstName: String(firstName), lastName: String(lastName) };
  } catch (err: any) {
    console.warn(`[LinkedIn] Fetch error for ${username}: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log(`\n=== LinkedIn Name Resolution Pass (${DRY_RUN ? "DRY RUN" : "LIVE"}) ===\n`);

  const db = await getDb();
  if (!db) {
    console.error("DB connection failed");
    process.exit(1);
  }

  // Check Apollo budget
  const budget = await getBudgetStatus();
  console.log(`Apollo Budget: daily ${budget.dailyUsed}/${budget.dailyCap} used (${budget.dailyRemaining} remaining), monthly ${budget.monthlyUsed}/2200`);

  // Find all named_unverified contacts with LinkedIn URLs and privacy-restricted names
  const [rows] = await db.execute(sql`
    SELECT DISTINCT
      c.id, c.name, c.company, c.title, c.linkedin, c.contactTrustTier,
      cp.projectId,
      p.name AS projectName,
      p.priority
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    JOIN projects p ON p.id = cp.projectId
    WHERE 
      c.contactTrustTier = 'named_unverified'
      AND c.linkedin IS NOT NULL
      AND c.linkedin != ''
      AND c.name IS NOT NULL
      AND (
        c.name REGEXP '^[A-Za-z][A-Za-z\\-]* [A-Z]\\.$'
        OR c.name REGEXP '^[A-Za-z][A-Za-z\\-]* [A-Za-z]+ [A-Z]\\.$'
      )
    ORDER BY
      CASE p.priority WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 ELSE 3 END,
      c.id ASC
    LIMIT 50
  `) as any;

  const candidates = Array.isArray(rows) ? rows : [];
  console.log(`Found ${candidates.length} privacy-restricted contacts with LinkedIn URLs\n`);

  if (candidates.length === 0) {
    console.log("No candidates found — nothing to do.");
    process.exit(0);
  }

  let resolved = 0;
  let apolloRevealed = 0;
  let failed = 0;

  for (const contact of candidates) {
    const username = extractLinkedInUsername(contact.linkedin);
    if (!username) {
      console.log(`  ✗ ${contact.name} — cannot extract username from: ${contact.linkedin}`);
      failed++;
      continue;
    }

    console.log(`\n--- Contact: ${contact.name} (${contact.company || "no company"}) ---`);
    console.log(`  LinkedIn: ${contact.linkedin} → username: ${username}`);
    console.log(`  Project: ${contact.projectName} (${contact.priority})`);

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would call LinkedIn API for username: ${username}`);
      continue;
    }

    await sleep(DELAY_MS);

    const fullName = await getLinkedInFullName(username);
    if (!fullName) {
      console.log(`  ✗ Could not resolve full name from LinkedIn`);
      failed++;
      continue;
    }

    const resolvedName = `${fullName.firstName} ${fullName.lastName}`;
    console.log(`  ✓ Resolved: "${contact.name}" → "${resolvedName}"`);
    resolved++;

    // Update the contact name in the DB
    await db.update(contacts).set({
      name: resolvedName,
    }).where(eq(contacts.id, contact.id));

    // Now retry Apollo enrichment with the full name
    if (budget.dailyRemaining > 0) {
      console.log(`  → Retrying Apollo enrichment with full name...`);
      try {
        const result = await revealContactEmail(contact.id, contact.projectId, {
          forceRetry: true,
        });

        if (result.status === "revealed") {
          console.log(`  ✓ Apollo revealed: ${result.email}`);
          apolloRevealed++;
          budget.dailyRemaining--;
        } else {
          console.log(`  ✗ Apollo: ${result.status} (${result.reason || ""})`);
        }
      } catch (err: any) {
        console.warn(`  ✗ Apollo error: ${err.message}`);
      }
    } else {
      console.log(`  ⚠ Apollo budget exhausted — name updated but not enriched yet`);
    }
  }

  console.log(`\n=== Pass Complete ===`);
  console.log(`Contacts resolved: ${resolved}/${candidates.length}`);
  console.log(`Apollo emails revealed: ${apolloRevealed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Apollo budget after pass: daily ${budget.dailyUsed}/${budget.dailyCap}`);

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
