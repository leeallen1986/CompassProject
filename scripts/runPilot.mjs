/**
 * runPilot.mjs — Full pilot enrichment + email preview run
 *
 * Steps:
 *  1. Set pilot env vars (PILOT_MODE, PILOT_ALLOW_LIST, EMAIL_DIGESTS_ENABLED)
 *  2. Build dry-run enrichment plan (shortlist, gating, credit estimate)
 *  3. Run live pilot enrichment (hot-first, conservative cap, post-batch QA)
 *  4. Generate Monday/Thursday/Manager Rollup email previews (dry-run)
 *  5. Run 6 quality checks on email content
 *  6. Send live emails to pilot allow-list
 *  7. Return pilot summary
 *
 * Usage:
 *   npx tsx scripts/runPilot.mjs --dry-run-only    # plan only, no enrichment or email
 *   npx tsx scripts/runPilot.mjs --skip-enrichment # skip enrichment, do email preview + send
 *   npx tsx scripts/runPilot.mjs                   # full run: enrich + email preview + send
 */
import { config } from "dotenv";
config({ path: ".env" });

// Pilot user IDs resolved from Atlas DB
const PILOT_REPS = [
  { userId: 2340043, name: "Ryan Pemberton", email: "ryan.pemberton@atlascopco.com" },
  { userId: 3870014, name: "Amit Bhargava",  email: "amit.bhargava@atlascopco.com" },
  { userId: 840008,  name: "Leo Williams",   email: "leo.williams@atlascopco.com" },
];
const PILOT_MANAGER = { userId: 1, name: "Lee Allen", email: "lee.allen@atlascopco.com" };
const ALL_PILOT_EMAILS = [...PILOT_REPS.map(u => u.email), PILOT_MANAGER.email];

// Set pilot env vars before any imports
process.env.PILOT_MODE = "true";
process.env.PILOT_ALLOW_LIST = ALL_PILOT_EMAILS.join(",");
process.env.EMAIL_DIGESTS_ENABLED = "true";

const args = process.argv.slice(2);
const DRY_RUN_ONLY    = args.includes("--dry-run-only");
const SKIP_ENRICHMENT = args.includes("--skip-enrichment");
const CONSERVATIVE_CREDIT_CAP = 25;

import path from "path";
import { fileURLToPath } from "url";
import { writeFileSync } from "fs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// Dynamic imports (after env vars are set)
const { buildPilotEnrichmentPlan, pilotEnrichmentRun } = await import(
  path.join(projectRoot, "server/pilotEnrichment.ts")
);
const { sendWeeklyDigests, sendThursdayReminders, sendManagerRollupEmail } = await import(
  path.join(projectRoot, "server/emailDigest.ts")
);

function sep(title) {
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(line);
}

function qcCheck(label, pass) {
  const icon = pass ? "✅" : "❌";
  console.log(`    ${icon} ${label}`);
  return pass;
}

// STEP 1: Pilot user resolution
sep("STEP 1 — Pilot User Resolution");
console.log("\n  Pilot Reps (Monday + Thursday digest):");
for (const u of PILOT_REPS) console.log(`    [${u.userId}] ${u.name} — ${u.email}`);
console.log("\n  Manager Rollup recipient:");
console.log(`    [${PILOT_MANAGER.userId}] ${PILOT_MANAGER.name} — ${PILOT_MANAGER.email}`);
console.log(`\n  PILOT_MODE=true`);
console.log(`  PILOT_ALLOW_LIST=${ALL_PILOT_EMAILS.join(", ")}`);

// STEP 2: Build enrichment plan
sep("STEP 2 — Dry-Run Enrichment Plan");
let plan;
try {
  plan = await buildPilotEnrichmentPlan({ creditCap: CONSERVATIVE_CREDIT_CAP });
} catch (err) {
  console.error("  ❌ buildPilotEnrichmentPlan failed:", err.message);
  process.exit(1);
}

const hotEligible  = plan.decisions.filter(d => d.eligible && d.priority === "hot").length;
const warmEligible = plan.decisions.filter(d => d.eligible && d.priority === "warm").length;

console.log(`\n  Shortlist size:              ${plan.totalShortlisted} projects`);
console.log(`  Eligible to enrich:          ${plan.eligible} (${hotEligible} hot, ${warmEligible} warm)`);
console.log(`  Soft-skipped:                ${plan.softSkipped} (sufficient contacts already)`);
console.log(`  Hard-blocked:                ${plan.hardBlocked} (Apollo ineligible)`);
console.log(`  Estimated total credits:     ${plan.estimatedTotalCredits}`);
console.log(`  Conservative cap:            ${CONSERVATIVE_CREDIT_CAP}`);
console.log(`  Projects to enrich (capped): ${plan.toEnrich.length}`);
console.log(`  Budget insufficient:         ${plan.budgetInsufficient}`);
console.log(`  Daily remaining:             ${plan.creditBudget.dailyRemaining}`);
console.log(`  Monthly remaining:           ${plan.creditBudget.monthlyRemaining}`);

if (plan.toEnrich.length > 0) {
  console.log("\n  Projects queued for enrichment:");
  for (const d of plan.toEnrich) {
    console.log(`    [${d.priority.toUpperCase()}] ${d.projectName} (est. ${d.estimatedCredits} credits)`);
  }
}

if (DRY_RUN_ONLY) {
  console.log("\n  --dry-run-only flag set. Stopping after plan.");
  process.exit(0);
}

// STEP 3: Live enrichment
let enrichmentResult = null;
if (SKIP_ENRICHMENT) {
  sep("STEP 3 — Enrichment (SKIPPED via --skip-enrichment)");
  console.log("  Skipping enrichment. Proceeding to email previews.");
} else {
  sep("STEP 3 — Live Pilot Enrichment Run");
  console.log(`  Running live enrichment (dryRun=false, creditCap=${CONSERVATIVE_CREDIT_CAP})...`);
  try {
    enrichmentResult = await pilotEnrichmentRun({
      dryRun: false,
      creditCap: CONSERVATIVE_CREDIT_CAP,
      userId: PILOT_MANAGER.userId,
    });
    const s = enrichmentResult.summary;
    console.log(`\n  Run ID:               ${enrichmentResult.runId}`);
    console.log(`  Projects attempted:   ${s.projectsAttempted}`);
    console.log(`  Projects enriched:    ${s.projectsEnriched}`);
    console.log(`  Projects failed:      ${s.projectsFailed}`);
    console.log(`  Projects skipped:     ${s.projectsSkipped}`);
    console.log(`  Contacts added:       ${s.totalContactsAdded}`);
    console.log(`  Credits used:         ${s.totalCreditsUsed}`);
    console.log(`  Send-ready contacts:  ${s.totalSendReady}`);
    console.log(`  No-contact projects:  ${s.noContactProjects}`);
    const failed = enrichmentResult.results.filter(r => r.status === "failed");
    if (failed.length > 0) {
      console.log("\n  Failed projects:");
      for (const r of failed) console.log(`    ❌ [${r.projectId}] ${r.projectName}: ${r.error ?? "unknown"}`);
    }
  } catch (err) {
    console.error("  ❌ pilotEnrichmentRun failed:", err.message);
    process.exit(1);
  }
}

// STEP 4: Email previews (dry-run)
sep("STEP 4 — Email Previews (dry-run=true, force=true)");
let mondayResult, thursdayResult, managerResult;

console.log("  Generating Monday digest preview...");
try {
  // sendWeeklyDigests(force: boolean, dryRun: boolean)
  mondayResult = await sendWeeklyDigests(true, true);
  console.log(`  Monday previews generated: ${mondayResult.previews?.length ?? 0}`);
} catch (err) { console.error("  ❌ sendWeeklyDigests preview failed:", err.message); }

console.log("  Generating Thursday reminder preview...");
try {
  // sendThursdayReminders(force: boolean, dryRun: boolean)
  thursdayResult = await sendThursdayReminders(true, true);
  console.log(`  Thursday previews generated: ${thursdayResult.previews?.length ?? 0}`);
} catch (err) { console.error("  ❌ sendThursdayReminders preview failed:", err.message); }

console.log("  Generating manager rollup preview...");
try {
  // sendManagerRollupEmail(force: boolean, dryRun: boolean)
  managerResult = await sendManagerRollupEmail(true, true);
  console.log(`  Manager rollup previews generated: ${managerResult.previews?.length ?? 0}`);
} catch (err) { console.error("  ❌ sendManagerRollupEmail preview failed:", err.message); }

// STEP 5: Quality checks
sep("STEP 5 — Email Quality Checks");

const allPreviews = [
  ...(mondayResult?.previews ?? []).map(p => ({ ...p, type: "monday" })),
  ...(thursdayResult?.previews ?? []).map(p => ({ ...p, type: "thursday" })),
  ...(managerResult?.previews ?? []).map(p => ({ ...p, type: "manager_rollup" })),
];

let qcPassed = 0, qcFailed = 0;
const hasNoContactDecisions = plan.decisions.some(d => d.hasNoContacts);

for (const preview of allPreviews) {
  const userName = [...PILOT_REPS, PILOT_MANAGER].find(u => u.userId === preview.userId)?.name ?? `User ${preview.userId}`;
  console.log(`\n  [${preview.type.toUpperCase()}] ${userName}:`);
  console.log(`    Subject: ${preview.subject}`);
  console.log(`    Content length: ${preview.contentLength} chars`);
  const content = preview.contentSnippet ?? "";

  const q1 = qcCheck("Subject contains PT Capital Sales", preview.subject.includes("PT Capital Sales"));
  if (q1) qcPassed++; else qcFailed++;

  const q2 = qcCheck("Freshness line present",
    /data.*refreshed|data.*as of|pipeline.*ran|last.*run|freshness/i.test(content));
  if (q2) qcPassed++; else qcFailed++;

  if (preview.type !== "manager_rollup" && preview.contentLength > 500) {
    const q3 = qcCheck("ActionId reference present (ACT- prefix)",
      /ACT-[A-Z0-9]{6}/.test(content) || content.includes("actionId") || content.includes("Ref:"));
    if (q3) qcPassed++; else qcFailed++;

    const q4 = qcCheck("Deep-link to /this-week present",
      /\/this-week|this-week|View in Atlas|compasspt\.manus\.space/i.test(content));
    if (q4) qcPassed++; else qcFailed++;
  }

  if (preview.type === "monday" && hasNoContactDecisions) {
    const q5 = qcCheck("Contact-discovery advisory present",
      /stakeholder discovery needed|discovery needed|no high-relevance contacts|contact.*needed/i.test(content));
    if (q5) qcPassed++; else qcFailed++;
  }

  if (preview.type !== "manager_rollup") {
    const q6 = qcCheck("Non-empty content (> 200 chars)", preview.contentLength > 200);
    if (q6) qcPassed++; else qcFailed++;
  }
}

if (allPreviews.length === 0) {
  console.log("  ⚠ No previews generated — zero-item suppression or no pilot recipients matched.");
}
console.log(`\n  Quality check summary: ${qcPassed} passed, ${qcFailed} failed`);

// STEP 6: Live send
sep("STEP 6 — Live Send to Pilot Allow-List");
console.log(`  Sending to: ${ALL_PILOT_EMAILS.join(", ")}`);

let liveMondayResult   = { sent: 0, failed: 0, skipped: 0, alreadySent: 0 };
let liveThursdayResult = { sent: 0, failed: 0, skipped: 0, alreadySent: 0 };
let liveManagerResult  = { sent: 0, failed: 0, skipped: 0, alreadySent: 0 };

console.log("\n  Sending Monday PT Capital Sales digest...");
try {
  liveMondayResult = await sendWeeklyDigests(true, false);
  console.log(`  Monday: sent=${liveMondayResult.sent}, failed=${liveMondayResult.failed}, skipped=${liveMondayResult.skipped}, alreadySent=${liveMondayResult.alreadySent}`);
} catch (err) { console.error("  ❌ Monday live send failed:", err.message); }

console.log("\n  Sending Thursday reminder...");
try {
  liveThursdayResult = await sendThursdayReminders(true, false);
  console.log(`  Thursday: sent=${liveThursdayResult.sent}, failed=${liveThursdayResult.failed}, skipped=${liveThursdayResult.skipped}, alreadySent=${liveThursdayResult.alreadySent}`);
} catch (err) { console.error("  ❌ Thursday live send failed:", err.message); }

console.log("\n  Sending manager rollup to Lee Allen...");
try {
  liveManagerResult = await sendManagerRollupEmail(true, false);
  console.log(`  Manager rollup: sent=${liveManagerResult.sent}, failed=${liveManagerResult.failed}`);
} catch (err) { console.error("  ❌ Manager rollup live send failed:", err.message); }

// STEP 7: Summary
sep("STEP 7 — Pilot Summary");

const enrichSummary = enrichmentResult?.summary ?? {
  projectsAttempted: 0, projectsEnriched: 0, projectsFailed: 0,
  projectsSkipped: 0, totalContactsAdded: 0, totalCreditsUsed: 0,
  totalSendReady: 0, noContactProjects: 0,
};

const blockedDecisions = plan.decisions.filter(d => d.hardBlocked).map(d => ({
  projectId: d.projectId, projectName: d.projectName, reason: d.reason,
}));

const summary = {
  pilotRunDate: new Date().toISOString(),
  pilotUsers: { reps: PILOT_REPS, manager: PILOT_MANAGER },
  enrichment: {
    shortlistSize: plan.totalShortlisted,
    eligible: plan.eligible,
    softSkipped: plan.softSkipped,
    hardBlocked: plan.hardBlocked,
    projectsEnriched: enrichSummary.projectsEnriched,
    projectsFailed: enrichSummary.projectsFailed,
    contactsAdded: enrichSummary.totalContactsAdded,
    sendReadyCount: enrichSummary.totalSendReady,
    contactDiscoveryNeeded: enrichSummary.noContactProjects,
    creditsUsed: enrichSummary.totalCreditsUsed,
    blockedDecisions,
  },
  emailSend: {
    monday:        { sent: liveMondayResult.sent,   failed: liveMondayResult.failed   },
    thursday:      { sent: liveThursdayResult.sent, failed: liveThursdayResult.failed },
    managerRollup: { sent: liveManagerResult.sent,  failed: liveManagerResult.failed  },
  },
  qualityChecks: { passed: qcPassed, failed: qcFailed },
};

console.log("\n  ENRICHMENT:");
console.log(`    Shortlist size:           ${summary.enrichment.shortlistSize}`);
console.log(`    Eligible:                 ${summary.enrichment.eligible}`);
console.log(`    Soft-skipped:             ${summary.enrichment.softSkipped}`);
console.log(`    Hard-blocked:             ${summary.enrichment.hardBlocked}`);
console.log(`    Projects enriched:        ${summary.enrichment.projectsEnriched}`);
console.log(`    Projects failed:          ${summary.enrichment.projectsFailed}`);
console.log(`    Contacts added:           ${summary.enrichment.contactsAdded}`);
console.log(`    Send-ready contacts:      ${summary.enrichment.sendReadyCount}`);
console.log(`    Contact-discovery-needed: ${summary.enrichment.contactDiscoveryNeeded}`);
console.log(`    Credits used:             ${summary.enrichment.creditsUsed}`);

if (blockedDecisions.length > 0) {
  console.log("\n    Blocked items:");
  for (const b of blockedDecisions) console.log(`      [${b.projectId}] ${b.projectName}: ${b.reason}`);
}

console.log("\n  EMAIL SEND:");
console.log(`    Monday digest:     sent=${summary.emailSend.monday.sent}, failed=${summary.emailSend.monday.failed}`);
console.log(`    Thursday reminder: sent=${summary.emailSend.thursday.sent}, failed=${summary.emailSend.thursday.failed}`);
console.log(`    Manager rollup:    sent=${summary.emailSend.managerRollup.sent}, failed=${summary.emailSend.managerRollup.failed}`);

console.log("\n  QUALITY CHECKS:");
console.log(`    ${qcPassed} passed, ${qcFailed} failed`);

const summaryPath = path.join(projectRoot, "scripts/pilotRunSummary.json");
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`\n  ✅ Pilot summary saved to scripts/pilotRunSummary.json`);

const border = "═".repeat(60);
console.log(`\n${border}`);
console.log("  PILOT RUN COMPLETE");
console.log(`${border}\n`);

process.exit(0);
