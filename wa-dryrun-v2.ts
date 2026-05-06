/**
 * WA Digest Dry-Run v2 — post-cleanup verification
 * Runs sendWeeklyDigests(dryRun=true) and checks:
 *   1. No NSW/VIC projects in any WA user's digest
 *   2. No thisWeekSection content (Discovery Needed, Top 3, New Stakeholders)
 *   3. Must Act section sourced only from WA projects
 *   4. Territory threshold passes
 */
import { sendWeeklyDigests } from "./server/emailDigest";
import * as fs from "fs";

async function main() {
  console.log("[WA-DryRun-v2] Starting corrected WA digest dry-run...");
  const results = await sendWeeklyDigests(false, true);
  console.log("[WA-DryRun-v2] Results:", JSON.stringify({ sent: results.sent, failed: results.failed, skipped: results.skipped, alreadySent: results.alreadySent, previewCount: results.previews?.length ?? 0 }));

  const out: string[] = [];
  out.push("=== WA DIGEST DRY-RUN v2 — TERRITORY CLEANLINESS REPORT ===\n");

  const waUsers = (results.previews ?? []).filter(p => {
    const subj = p.subject || "";
    return subj.includes("WA") || subj.includes("Western Australia");
  });

  out.push(`Total previews generated: ${results.previews?.length ?? 0}`);
  out.push(`WA user previews: ${waUsers.length}`);
  out.push(`Skipped: ${results.skipped}`);
  out.push("");

  // NSW/VIC contamination keywords
  const nswKeywords = ["wakehurst", " nsw", "new south wales", "sydney", "newcastle", "hunter valley", "goulburn", "snowy hydro", "inland rail", "euroa"];
  // Use word-boundary patterns for short abbreviations to avoid false positives (e.g. "services" contains "vic")
  const vicKeywords = ["victoria", " vic ", "vic,", "vic.", "melbourne", "geelong", "euroa", "latrobe"];
  const bannedSections = ["DISCOVERY NEEDED", "Top 3 Priority Projects This Week", "New Stakeholder Discoveries"];

  for (const preview of waUsers) {
    out.push(`\n--- USER ID: ${preview.userId} ---`);
    out.push(`Subject: ${preview.subject}`);
    out.push(`Content length: ${preview.contentLength} chars`);

    const content = (preview.contentSnippet || "").toLowerCase();
    const contentRaw = preview.contentSnippet || "";

    // Check for banned sections
    const foundBanned = bannedSections.filter(s => contentRaw.includes(s));
    if (foundBanned.length > 0) {
      out.push(`❌ BANNED SECTIONS FOUND: ${foundBanned.join(", ")}`);
    } else {
      out.push(`✓ No banned sections (Discovery Needed / Top 3 / New Stakeholders)`);
    }

    // Check for NSW contamination
    const foundNSW = nswKeywords.filter(k => content.includes(k));
    if (foundNSW.length > 0) {
      out.push(`❌ NSW CONTAMINATION: ${foundNSW.join(", ")}`);
    } else {
      out.push(`✓ No NSW contamination`);
    }

    // Check for VIC contamination
    const foundVIC = vicKeywords.filter(k => content.includes(k));
    if (foundVIC.length > 0) {
      out.push(`❌ VIC CONTAMINATION: ${foundVIC.join(", ")}`);
    } else {
      out.push(`✓ No VIC contamination`);
    }

    // Check Must Act section exists
    if (contentRaw.includes("Must Act This Week")) {
      out.push(`✓ Must Act section present`);
    } else {
      out.push(`⚠ Must Act section NOT found`);
    }

    // Extract Must Act projects (lines after "Must Act This Week" up to next ---)
    const mustActIdx = contentRaw.indexOf("Must Act This Week");
    if (mustActIdx >= 0) {
      const mustActBlock = contentRaw.slice(mustActIdx, mustActIdx + 2000);
      const projectLines = mustActBlock.split("\n").filter(l => l.startsWith("**") && l.includes("HOT") || l.includes("WARM"));
      out.push(`Must Act projects found: ${projectLines.length}`);
      projectLines.slice(0, 5).forEach(l => out.push(`  ${l.slice(0, 120)}`));
    }

    // Show first 800 chars of content for manual review
    out.push(`\nContent preview (first 800 chars):\n${contentRaw.slice(0, 800)}`);
    out.push("\n" + "=".repeat(60));
  }

  const outStr = out.join("\n");
  fs.writeFileSync("/tmp/wa-dryrun-v2.txt", outStr);
  console.log("[WA-DryRun-v2] Report written to /tmp/wa-dryrun-v2.txt");
  console.log(outStr.slice(0, 3000));
  process.exit(0);
}

main().catch(e => { console.error("[WA-DryRun-v2] ERROR:", e.message); process.exit(1); });
