/**
 * Bulk Apollo Enrichment Script
 *
 * Runs Apollo enrichment on the top hot/warm projects to add verified emails
 * to existing contacts that are missing them.
 *
 * Usage: npx tsx server/scripts/runBulkApolloEnrichment.ts
 *
 * Strategy:
 * 1. Get top 50 hot projects ordered by value (highest first)
 * 2. For each project, use revealContactEmail on existing contacts missing verified email
 * 3. Respect the daily credit cap (50 credits/day)
 * 4. Log progress to /tmp/bulk_apollo_enrichment.log
 */

import "dotenv/config";
import { getDb } from "../db";
import { projects, contacts } from "../../drizzle/schema";
import { eq, and, isNull, or, sql, desc } from "drizzle-orm";
import { revealContactEmail } from "../apolloEnrichment";
import { getBudgetStatus } from "../apolloEligibility";

const LOG_FILE = "/tmp/bulk_apollo_enrichment.log";
const MAX_PROJECTS = 50;
const MAX_CREDITS_PER_PROJECT = 5; // Conservative: 5 credits per project = 50 credits for 10 projects
const DELAY_BETWEEN_CONTACTS_MS = 1500;

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  // Append to log file
  import("fs").then(fs => fs.appendFileSync(LOG_FILE, line + "\n"));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  log("=== BULK APOLLO ENRICHMENT STARTED ===");

  const db = await getDb();
  if (!db) {
    log("ERROR: Database not available");
    process.exit(1);
  }

  // Check budget
  const budget = await getBudgetStatus();
  log(`Budget: ${budget.dailyUsed}/${budget.dailyCap} credits used today, ${budget.dailyRemaining} remaining`);
  log(`Monthly: ${budget.monthlyUsed}/${budget.monthlyCap} credits used`);

  if (!budget.withinBudget) {
    log("ERROR: Daily or monthly budget exhausted. Exiting.");
    process.exit(0);
  }

  // Get top hot projects ordered by estimated value (descending)
  const hotProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      priority: projects.priority,
      value: projects.value,
      owner: projects.owner,
    })
    .from(projects)
    .where(
      and(
        eq(projects.lifecycleStatus, "active"),
        eq(projects.priority, "hot")
      )
    )
    .orderBy(desc(projects.id))
    .limit(MAX_PROJECTS);

  log(`Found ${hotProjects.length} hot projects to process`);

  let totalCreditsUsed = 0;
  let totalContactsEnriched = 0;
  let totalEmailsFound = 0;
  let projectsProcessed = 0;

  for (const project of hotProjects) {
    // Check remaining budget
    const currentBudget = await getBudgetStatus();
    if (!currentBudget.withinBudget || currentBudget.dailyRemaining <= 0) {
      log(`Budget exhausted after ${projectsProcessed} projects. Stopping.`);
      break;
    }

    // Get contacts for this project that are missing verified emails
    const contactsMissingEmail = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        company: contacts.company,
        email: contacts.email,
        emailVerified: contacts.emailVerified,
        enrichmentSource: contacts.enrichmentSource,
        enrichmentStatus: contacts.enrichmentStatus,
      })
      .from(contacts)
      .where(
        and(
          sql`${contacts.project} = ${project.name}`,
          // Target contacts with unverified emails (emailVerified=0) from non-Apollo sources
          eq(contacts.emailVerified, false),
          // Only enrich contacts from linkedin or web_search (not already apollo-enriched)
          or(
            eq(contacts.enrichmentSource, "linkedin"),
            eq(contacts.enrichmentSource, "web_search"),
            eq(contacts.enrichmentSource, "llm")
          )
        )
      )
      .limit(MAX_CREDITS_PER_PROJECT);

    if (contactsMissingEmail.length === 0) {
      log(`Project "${project.name}": no contacts need email enrichment — skipping`);
      continue;
    }

    log(`Project "${project.name}" (${project.priority}): ${contactsMissingEmail.length} contacts to enrich`);
    projectsProcessed++;

    let projectCreditsUsed = 0;

    for (const contact of contactsMissingEmail) {
      if (projectCreditsUsed >= MAX_CREDITS_PER_PROJECT) {
        log(`  Project credit cap reached (${MAX_CREDITS_PER_PROJECT})`);
        break;
      }

      const currentBudget2 = await getBudgetStatus();
      if (!currentBudget2.withinBudget || currentBudget2.dailyRemaining <= 0) {
        log("  Daily budget exhausted. Stopping.");
        break;
      }

      try {
        log(`  Enriching: ${contact.name} at ${contact.company}`);
        const result = await revealContactEmail(contact.id, {
          userId: 0,
          userName: "bulk_enrichment_script",
        });

        if (result) {
          if (result.email) {
            log(`  ✓ Found email for ${result.name}: ${result.email} (${result.emailStatus})`);
            totalEmailsFound++;
          } else {
            log(`  ~ No email found for ${result.name} (status: ${result.status})`);
          }
          totalContactsEnriched++;
          projectCreditsUsed++;
          totalCreditsUsed++;
        } else {
          log(`  ✗ Apollo returned null for ${contact.name}`);
        }

        await sleep(DELAY_BETWEEN_CONTACTS_MS);
      } catch (err: unknown) {
        log(`  ERROR enriching ${contact.name}: ${err instanceof Error ? err.message : String(err)}`);
        await sleep(DELAY_BETWEEN_CONTACTS_MS);
      }
    }

    log(`  Project complete: ${projectCreditsUsed} credits used`);
  }

  log("=== BULK APOLLO ENRICHMENT COMPLETE ===");
  log(`Projects processed: ${projectsProcessed}`);
  log(`Total contacts attempted: ${totalContactsEnriched}`);
  log(`Emails found: ${totalEmailsFound}`);
  log(`Total credits used: ${totalCreditsUsed}`);
}

main().catch(err => {
  log(`FATAL ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
