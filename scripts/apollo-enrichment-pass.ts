/**
 * apollo-enrichment-pass.ts
 *
 * Targeted Apollo email reveal pass for hot/warm projects with 0 send_ready contacts.
 * Runs as a one-shot script on the cloud computer or locally.
 *
 * Strategy:
 *   1. Find hot projects with Apollo-sourced or LinkedIn-linked named_unverified contacts
 *      (0 send_ready, sorted by eligible contact count desc)
 *   2. For each project, reveal emails on the top named_unverified contacts
 *   3. Respect daily/monthly credit budget (100/day, 2200/month)
 *   4. Stop when budget is exhausted or all targets processed
 *
 * Usage (from project root):
 *   tsx scripts/apollo-enrichment-pass.ts [--dry-run] [--max-projects=20] [--priority=hot]
 */

import "dotenv/config";
import { getDb } from "../server/db";
import { eq, and, sql, isNull, or, lt, isNotNull } from "drizzle-orm";
import { contacts, contactProjects } from "../drizzle/schema";
import { revealContactEmail } from "../server/apolloEnrichment";
import { getBudgetStatus } from "../server/apolloEligibility";

const DRY_RUN = process.argv.includes("--dry-run");
const MAX_PROJECTS = parseInt(process.argv.find(a => a.startsWith("--max-projects="))?.split("=")[1] ?? "30");
const PRIORITY_FILTER = (process.argv.find(a => a.startsWith("--priority="))?.split("=")[1] ?? "hot") as "hot" | "warm" | "all";
const MAX_CONTACTS_PER_PROJECT = 10;

const LOG = (...args: unknown[]) => console.log(new Date().toISOString(), "[ApolloPass]", ...args);

async function main() {
  LOG(`Starting Apollo enrichment pass (dry_run=${DRY_RUN}, max_projects=${MAX_PROJECTS}, priority=${PRIORITY_FILTER})`);

  const db = await getDb();
  if (!db) {
    LOG("ERROR: Database not available");
    process.exit(1);
  }

  // Check budget
  const budget = await getBudgetStatus();
  LOG(`Budget: daily ${budget.dailyUsed}/${budget.dailyCap} used, monthly ${budget.monthlyUsed}/${budget.monthlyCap} used`);
  if (!budget.withinBudget) {
    LOG("Budget exhausted — aborting pass");
    process.exit(0);
  }

  // Build priority filter
  const priorityValues: string[] = PRIORITY_FILTER === "all" ? ["hot", "warm"] : [PRIORITY_FILTER];
  const prioritySql = priorityValues.map(v => `'${v}'`).join(", ");

  // Single batch query: find projects with 0 send_ready contacts but >0 Apollo/LinkedIn named_unverified
  // Uses GROUP BY + HAVING to avoid N+1 queries
  const [targetRows] = await db.execute(sql`
    SELECT 
      p.id AS projectId,
      p.name AS projectName,
      p.projectState,
      p.priority,
      SUM(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) AS send_ready_count,
      SUM(CASE WHEN 
        c.contactTrustTier = 'named_unverified'
        AND c.rejectionReason IS NULL
        AND c.crmOrphan = 0
        AND (c.enrichmentSource = 'apollo' OR c.linkedin IS NOT NULL)
        AND (
          c.enrichmentStatus IS NULL
          OR (c.enrichmentStatus NOT IN ('enriched', 'not_found') AND c.enrichedAt IS NULL)
          OR c.enrichedAt < DATE_SUB(NOW(), INTERVAL 7 DAY)
        )
      THEN 1 ELSE 0 END) AS eligible_contact_count
    FROM projects p
    JOIN contactProjects cp ON cp.projectId = p.id
    JOIN contacts c ON c.id = cp.contactId AND c.rejectionReason IS NULL AND c.crmOrphan = 0
    LEFT JOIN projectBusinessLineScores bls ON bls.projectId = p.id
    WHERE p.priority IN (${sql.raw(prioritySql)})
      AND p.lifecycleStatus = 'active'
      AND (p.suppressed IS NULL OR p.suppressed = 0)
      AND p.enrichmentBlockedReason IS NULL
    GROUP BY p.id, p.name, p.projectState, p.priority
    HAVING send_ready_count = 0 AND eligible_contact_count > 0
      AND COALESCE(MAX(bls.score), 0) >= 50
    ORDER BY p.priority ASC, eligible_contact_count DESC
    LIMIT ${MAX_PROJECTS}
  `) as unknown as {
    projectId: number;
    projectName: string;
    projectState: string | null;
    priority: string;
    send_ready_count: number;
    eligible_contact_count: number;
  }[];

  LOG(`Found ${targetRows.length} target projects with eligible named_unverified contacts`);

  let totalRevealed = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalCreditsUsed = 0;
  let projectsProcessed = 0;

  for (const proj of targetRows) {
    // Re-check budget before each project
    const currentBudget = await getBudgetStatus();
    if (!currentBudget.withinBudget) {
      LOG(`Budget exhausted after ${projectsProcessed} projects — stopping`);
      break;
    }

    LOG(`\n--- Project ${proj.projectId}: ${proj.projectName} (${proj.priority}, ${proj.projectState ?? "??"}) ---`);
    LOG(`  eligible_contacts: ${proj.eligible_contact_count}`);
    LOG(`  Budget remaining: daily ${currentBudget.dailyRemaining}, monthly ${currentBudget.monthlyRemaining}`);

    // Get the top eligible contacts for this project
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const namedContacts = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        title: contacts.title,
        company: contacts.company,
        linkedin: contacts.linkedin,
        enrichmentStatus: contacts.enrichmentStatus,
      })
      .from(contacts)
      .innerJoin(contactProjects, and(
        eq(contactProjects.contactId, contacts.id),
        eq(contactProjects.projectId, proj.projectId)
      ))
      .where(
        and(
          eq(contacts.contactTrustTier, "named_unverified"),
          isNull(contacts.rejectionReason),
          eq(contacts.crmOrphan, false),
          or(
            eq(contacts.enrichmentSource, "apollo"),
            isNotNull(contacts.linkedin)
          ),
          or(
            isNull(contacts.enrichmentStatus),
            and(
              sql`${contacts.enrichmentStatus} NOT IN ('enriched', 'not_found')`,
              isNull(contacts.enrichedAt)
            ),
            lt(contacts.enrichedAt, sevenDaysAgo)
          )
        )
      )
      .orderBy(
        sql`CASE WHEN ${contacts.linkedin} IS NOT NULL THEN 0 ELSE 1 END`,
        sql`CASE WHEN ${contacts.enrichmentStatus} IS NULL THEN 0 ELSE 1 END`
      )
      .limit(MAX_CONTACTS_PER_PROJECT);

    if (namedContacts.length === 0) {
      LOG(`  No eligible contacts found (race condition or all recently attempted) — skipping`);
      continue;
    }

    LOG(`  Processing ${namedContacts.length} contacts...`);

    let projectRevealed = 0;
    let projectSkipped = 0;
    let projectFailed = 0;

    for (const contact of namedContacts) {
      const budgetNow = await getBudgetStatus();
      if (!budgetNow.withinBudget) {
        LOG(`  Budget exhausted mid-project — stopping`);
        break;
      }

      if (DRY_RUN) {
        LOG(`  [DRY RUN] Would reveal: ${contact.name} (${contact.title} @ ${contact.company}) [linkedin: ${contact.linkedin ? "yes" : "no"}]`);
        projectSkipped++;
        continue;
      }

      try {
        const result = await revealContactEmail(contact.id, {
          userId: 0,
          userName: "apollo-enrichment-pass",
        });

        if (result && result.hasEmail) {
          LOG(`  ✓ Revealed: ${contact.name} → ${result.email}`);
          projectRevealed++;
          totalCreditsUsed++;
        } else if (result) {
          LOG(`  ✗ Not found: ${contact.name} (${contact.title})`);
          projectSkipped++;
        } else {
          LOG(`  ~ Skipped (dedup/invalid): ${contact.name}`);
          projectSkipped++;
        }
      } catch (err) {
        LOG(`  ✗ Error revealing ${contact.name}:`, err instanceof Error ? err.message : String(err));
        projectFailed++;
      }

      // Small delay to avoid hammering the API
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    LOG(`  Project result: revealed=${projectRevealed}, skipped=${projectSkipped}, failed=${projectFailed}`);
    totalRevealed += projectRevealed;
    totalSkipped += projectSkipped;
    totalFailed += projectFailed;
    projectsProcessed++;
  }

  const finalBudget = await getBudgetStatus();
  LOG(`\n=== Pass Complete ===`);
  LOG(`Projects processed: ${projectsProcessed}/${targetRows.length}`);
  LOG(`Contacts revealed: ${totalRevealed}`);
  LOG(`Contacts skipped/not_found: ${totalSkipped}`);
  LOG(`Contacts failed: ${totalFailed}`);
  LOG(`Credits used this pass: ${totalCreditsUsed}`);
  LOG(`Budget after pass: daily ${finalBudget.dailyUsed}/${finalBudget.dailyCap}, monthly ${finalBudget.monthlyUsed}/${finalBudget.monthlyCap}`);

  if (totalRevealed > 0) {
    LOG(`\n${totalRevealed} new send_ready contacts created. Run digestSafe promotion to unlock new digest-safe projects.`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
