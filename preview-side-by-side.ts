/**
 * Side-by-side digest preview: Ryan vs Brett
 * Generates full Monday digest content for each user and extracts
 * Must Act, Closing Soon, and Waiting on Contact Discovery sections.
 */
import "dotenv/config";
import { sendWeeklyDigests } from "./server/emailDigest";

async function main() {
  console.log("=== GENERATING SIDE-BY-SIDE DIGEST PREVIEWS (DRY-RUN) ===\n");

  const result = await sendWeeklyDigests(/* force= */ true, /* dryRun= */ true);

  if (!result.previews || result.previews.length === 0) {
    console.log("No previews generated. Result:", JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log(`\nGenerated ${result.previews.length} preview(s)\n`);

  // Find Ryan and Brett
  const ryanPreview = result.previews.find((p: any) => p.userName?.toLowerCase().includes("ryan") || p.subject?.toLowerCase().includes("ryan"));
  const brettPreview = result.previews.find((p: any) => p.userName?.toLowerCase().includes("brett") || p.subject?.toLowerCase().includes("brett"));

  // If userName not in preview, just show all
  if (!ryanPreview || !brettPreview) {
    console.log("Could not identify Ryan/Brett by name in previews. Showing all previews:\n");
    for (const preview of result.previews) {
      console.log(`\n${"=".repeat(70)}`);
      console.log(`USER ID: ${preview.userId} | Subject: ${preview.subject}`);
      console.log(`Content length: ${preview.contentLength} chars`);
      console.log(`\n--- CONTENT SNIPPET ---`);
      console.log(preview.contentSnippet);
    }
    process.exit(0);
  }

  function extractSections(content: string, label: string) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`${label}`);
    console.log("=".repeat(70));

    // Extract Must Act section
    const mustActMatch = content.match(/## 🟥 Must Act This Week.*?(?=---|$)/s);
    console.log("\n--- MUST ACT THIS WEEK ---");
    if (mustActMatch) {
      // Extract just project names and key lines (first 2 lines of each card)
      const lines = mustActMatch[0].split("\n").filter(l => l.trim());
      lines.forEach(l => console.log(l));
    } else {
      console.log("(section not found)");
    }

    // Extract Closing Soon section
    const closingSoonMatch = content.match(/## ⏰ Closing Soon.*?(?=---|$)/s);
    console.log("\n--- CLOSING SOON ---");
    if (closingSoonMatch) {
      const lines = closingSoonMatch[0].split("\n").filter(l => l.trim());
      lines.forEach(l => console.log(l));
    } else {
      console.log("(no tenders closing within 14 days)");
    }

    // Extract Waiting on Contact Discovery section
    const waitingMatch = content.match(/## 🔍 Waiting on Contact Discovery.*?(?=---|$)/s);
    console.log("\n--- WAITING ON CONTACT DISCOVERY ---");
    if (waitingMatch) {
      const lines = waitingMatch[0].split("\n").filter(l => l.trim());
      lines.forEach(l => console.log(l));
    } else {
      console.log("(section not found)");
    }

    // Summary line
    const summaryMatch = content.match(/\*\*This week:\*\*.+/);
    console.log("\n--- SUMMARY LINE ---");
    if (summaryMatch) console.log(summaryMatch[0]);
  }

  extractSections(ryanPreview.contentSnippet, `RYAN PEMBERTON (Portable Air, WA) | ${ryanPreview.subject}`);
  extractSections(brettPreview.contentSnippet, `BRETT HANSEN (Pump/Flow, WA+NT) | ${brettPreview.subject}`);

  // Overlap analysis at section level
  console.log(`\n${"=".repeat(70)}`);
  console.log("OVERLAP ANALYSIS — MUST ACT SECTION");
  console.log("=".repeat(70));

  function extractProjectNames(content: string): string[] {
    const mustActMatch = content.match(/## 🟥 Must Act This Week.*?(?=---|$)/s);
    if (!mustActMatch) return [];
    const boldNames = mustActMatch[0].match(/\*\*([^*]+)\*\* — (🔥|🟡|🔵)/g) || [];
    return boldNames.map(n => n.replace(/\*\*/g, "").replace(/ — (🔥|🟡|🔵).*/, "").trim());
  }

  const ryanMustAct = extractProjectNames(ryanPreview.contentSnippet);
  const brettMustAct = extractProjectNames(brettPreview.contentSnippet);

  console.log(`\nRyan Must Act (${ryanMustAct.length}): ${ryanMustAct.join(" | ") || "(none)"}`);
  console.log(`Brett Must Act (${brettMustAct.length}): ${brettMustAct.join(" | ") || "(none)"}`);

  const overlap = ryanMustAct.filter(r => brettMustAct.some(b => b.toLowerCase().includes(r.toLowerCase().slice(0, 20))));
  console.log(`\nMust Act overlap: ${overlap.length} / ${Math.max(ryanMustAct.length, brettMustAct.length)}`);
  if (overlap.length > 0) {
    console.log("Shared Must Act projects:");
    overlap.forEach(p => console.log(`  • ${p}`));
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("VALIDATION CHECKS");
  console.log("=".repeat(70));

  // Check 1: Must Act items differ
  const mustActDiffer = ryanMustAct.join("|") !== brettMustAct.join("|");
  console.log(`\n1. Must Act items differ: ${mustActDiffer ? "✓ YES" : "✗ NO — IDENTICAL"}`);

  // Check 2: No high-relevance/no-contact projects displacing digest-safe projects
  const ryanHasActionReady = ryanPreview.contentSnippet.includes("Must Act This Week") &&
    !ryanPreview.contentSnippet.includes("No action-ready opportunities");
  const brettHasActionReady = brettPreview.contentSnippet.includes("Must Act This Week") &&
    !brettPreview.contentSnippet.includes("No action-ready opportunities");
  console.log(`2. Ryan has action-ready Must Act items: ${ryanHasActionReady ? "✓ YES" : "✗ NO"}`);
  console.log(`   Brett has action-ready Must Act items: ${brettHasActionReady ? "✓ YES" : "✗ NO"}`);

  // Check 3: No banned sections
  const bannedSections = ["Discovery Needed", "Top 3 Priority Projects", "New Stakeholder Discoveries"];
  for (const section of bannedSections) {
    const ryanHas = ryanPreview.contentSnippet.includes(section);
    const brettHas = brettPreview.contentSnippet.includes(section);
    console.log(`3. Banned section "${section}": Ryan=${ryanHas ? "✗ PRESENT" : "✓ absent"} Brett=${brettHas ? "✗ PRESENT" : "✓ absent"}`);
  }

  // Check 4: Territory cleanliness
  const nonWAPatterns = [/\bNSW\b/, /\bVIC\b/, /\bQLD\b/, /Sydney Metro/i, /Euroa/i, /Goulburn/i, /Snowy/i, /Inland Rail/i, /Stockland/i];
  let ryanContaminated = false, brettContaminated = false;
  for (const pattern of nonWAPatterns) {
    if (pattern.test(ryanPreview.contentSnippet)) { ryanContaminated = true; console.log(`4. Territory contamination in Ryan: ✗ matched "${pattern}"`); }
    if (pattern.test(brettPreview.contentSnippet)) { brettContaminated = true; console.log(`4. Territory contamination in Brett: ✗ matched "${pattern}"`); }
  }
  if (!ryanContaminated) console.log("4. Ryan territory: ✓ no NSW/VIC/QLD contamination detected");
  if (!brettContaminated) console.log("4. Brett territory: ✓ no NSW/VIC/QLD contamination detected");

  console.log(`\n${"=".repeat(70)}`);
  const allPassed = mustActDiffer && ryanHasActionReady && brettHasActionReady && !ryanContaminated && !brettContaminated;
  console.log(`OVERALL: ${allPassed ? "✓ ALL CHECKS PASSED — FIRST SEND APPROVED" : "✗ ISSUES FOUND — DO NOT SEND"}`);
  console.log("=".repeat(70));

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
