/**
 * Generate email render proofs for the 5 confirmed SEND reps.
 * Replicates the full annotation flow from sendWeeklyDigests:
 *   scoreAndFilterProjects → match contacts → classifyBriefReadiness → buildEmailSignals → buildDigestEmailHtml
 */
import { getActiveProjects, getAllContacts } from "../server/db";
import { buildEmailSignals, scoreAndFilterProjects, classifyBriefReadiness } from "../server/emailDigest";
import { buildDigestEmailHtml, type DigestEmailData } from "../server/emailTemplate";
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";

const TARGET_REPS = [
  { userId: 2340043, name: "Ryan Pemberton" },
  { userId: 2550006, name: "Brett Hansen" },
  { userId: 2820073, name: "Daniel Zec" },
  { userId: 3630009, name: "Dan Day" },
  { userId: 3870014, name: "Amit Bhargava" },
];

async function main() {
  const c = await mysql.createConnection(process.env.DATABASE_URL!);
  const outputDir = path.resolve(import.meta.dirname, "../docs/render-proofs");
  fs.mkdirSync(outputDir, { recursive: true });

  const allProjects = await getActiveProjects();
  const allContacts = await getAllContacts();

  // Get the latest report for week label
  const [reports] = await c.query<any[]>(
    "SELECT weekEnding FROM reports ORDER BY id DESC LIMIT 1"
  );
  const weekLabel = reports[0]?.weekEnding || "Week of 12 May 2026";

  // Build a set of project names that have contacts
  const contactProjectNames = new Set(allContacts.map((c: any) => c.project).filter(Boolean));

  for (const rep of TARGET_REPS) {
    console.log(`\n--- Generating render proof for ${rep.name} (${rep.userId}) ---`);

    // Get user profile
    const [profiles] = await c.query<any[]>(
      "SELECT * FROM userProfiles WHERE userId = ?",
      [rep.userId]
    );
    if (!profiles.length) {
      console.log(`  SKIP: No profile found`);
      continue;
    }
    const profile = profiles[0];

    // Fields are already parsed by mysql2 JSON column handling
    const territories = profile.territories || [];
    const industries = profile.industries || [];
    const offerCategories = profile.offerCategories || [];
    const customerTypes = profile.customerTypes || [];
    const buyerRoles = profile.buyerRoles || [];
    const keyAccounts = profile.keyAccounts || [];
    const sectorFocus = profile.sectorFocus || [];
    const stageTiming = profile.stageTiming || [];
    const assignedBusinessLines = profile.assignedBusinessLines || [];

    // Score and filter projects
    const matchedProjects = await scoreAndFilterProjects(allProjects, {
      territories,
      industries,
      offerCategories,
      customerTypes,
      dealSizeMin: profile.dealSizeMin,
      dealSizeMax: profile.dealSizeMax,
      assignedBusinessLines,
      sectorFocus,
      stageTiming,
      buyerRoles,
      keyAccounts,
      salesMotion: profile.salesMotion,
    });

    if (matchedProjects.length === 0) {
      console.log(`  SKIP: No matching projects`);
      continue;
    }

    // Match contacts to projects (same logic as main send flow)
    const matchedProjectNames = new Set(matchedProjects.map((p: any) => p.name));
    const matchedContacts = allContacts.filter((c: any) => matchedProjectNames.has(c.project));

    // Annotate projects with briefReadiness + bestContact (same as main send flow)
    const annotatedProjects = matchedProjects.map((p: any) => {
      const hasNoContacts = !contactProjectNames.has(p.name);
      // Find contacts for this project (fuzzy name match — same as main flow)
      const projectContacts = matchedContacts
        .filter((c: any) =>
          c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
          p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
        )
        .map((c: any) => ({
          ...c,
          roleRelevance: c.roleRelevance ?? null,
          linkedin: c.linkedinProfileUrl ?? c.linkedin ?? null,
          contactTrustTier: c.contactTrustTier ?? null,
          source: c.source ?? c.enrichmentSource ?? null,
          verificationScore: c.verificationScore ?? null,
        }));

      const { readiness, bestContact } = classifyBriefReadiness(
        { ...p, hasNoContacts },
        projectContacts,
      );
      return {
        ...p,
        hasNoContacts,
        briefReadiness: readiness,
        bestContact,
      };
    });

    // Take top annotated projects (action_ready first, then discovery_needed)
    const actionReady = annotatedProjects.filter((p: any) => p.briefReadiness === "action_ready");
    const discoveryNeeded = annotatedProjects.filter((p: any) => p.briefReadiness === "discovery_needed");
    const monitorOnly = annotatedProjects.filter((p: any) => p.briefReadiness === "monitor_only");

    console.log(`  Scored ${matchedProjects.length} projects`);
    console.log(`  Annotated: ${actionReady.length} action_ready, ${discoveryNeeded.length} discovery_needed, ${monitorOnly.length} monitor_only`);
    console.log(`  Top 3 action_ready:`);
    for (const p of actionReady.slice(0, 3)) {
      console.log(`    - ${p.name} (score: ${p.relevanceScore?.toFixed(1)}, contact: ${p.bestContact?.name || "none"})`);
    }

    // Build email signals from annotated projects
    const emailSignals = buildEmailSignals(annotatedProjects, territories);
    const actionReadyCount = emailSignals.filter((s: any) => s.badge === "action_ready").length;
    const discoveryCount = emailSignals.filter((s: any) => s.badge === "discovery_needed").length;
    const summaryParts: string[] = [];
    if (actionReadyCount > 0) summaryParts.push(`${actionReadyCount} action-ready opportunit${actionReadyCount === 1 ? "y" : "ies"}`);
    if (discoveryCount > 0) summaryParts.push(`${discoveryCount} need${discoveryCount === 1 ? "s" : ""} contact discovery`);
    const summaryLine = summaryParts.length > 0
      ? `${summaryParts.join(" and ")} this week.`
      : "Here's your weekly intelligence update.";

    // Territory label
    const territoryLabel = territories.length > 3
      ? `${territories.slice(0, 3).join(", ")} +${territories.length - 3}`
      : territories.join(", ") || "National";

    const emailData: DigestEmailData = {
      userName: rep.name.split(" ")[0],
      territory: territoryLabel,
      weekLabel,
      summaryLine,
      signals: emailSignals,
      dashboardUrl: "https://compasspt.manus.space",
    };

    const html = buildDigestEmailHtml(emailData);

    // Write HTML file
    const filename = `${rep.name.replace(/\s+/g, "-").toLowerCase()}-digest-proof.html`;
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, html, "utf-8");
    console.log(`  ✓ Written: ${filepath}`);
    console.log(`  Signals: ${emailSignals.length} | Action-ready: ${actionReadyCount} | Discovery: ${discoveryCount}`);
  }

  await c.end();
  console.log(`\n=== All render proofs generated in ${outputDir} ===`);
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
