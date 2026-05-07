/**
 * Amit Corrected Digest Audit
 * Shows which projects pass/fail the PAL/BESS gate and what the corrected digest looks like.
 */
import { getDb, getActiveProjects } from "../server/db";
import { projects, userProfiles, contacts } from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { portableAirOpportunityGate, palBessOpportunityGate } from "../server/laneScoring";
import { getProjectScoresBatch } from "../server/businessLineScoring";
import { computePerUserFinalScore } from "../server/laneScoring";

async function main() {
  const db = await getDb();

  // Get Amit's profile (userId=3870014, amit.bhargava@atlascopco.com)
  const amitProfiles = await db.select().from(userProfiles).where(eq(userProfiles.userId, 3870014));
  if (!amitProfiles.length) {
    console.log("Amit profile not found (userId=3870014)");
    process.exit(1);
  }
  const amit = amitProfiles[0];
  console.log(`\nAmit profile: userId=${amit.userId}`);
  console.log(`Assigned BLs: ${JSON.stringify(amit.assignedBusinessLines)}`);
  console.log(`Territories: ${JSON.stringify(amit.territories)}`);
  console.log(`Sector focus: ${JSON.stringify(amit.sectorFocus)}`);

  const assignedBLs = (amit.assignedBusinessLines || []) as string[];
  const isPalBessRep = assignedBLs.some(bl => ['PAL', 'BESS', 'pal', 'bess'].includes(bl));
  console.log(`Is PAL/BESS rep: ${isPalBessRep}`);

  // Get all active projects
  const allProjects = await db.select().from(projects).where(
    and(
      eq(projects.lifecycleStatus, "active"),
    )
  );
  console.log(`\nTotal active projects: ${allProjects.length}`);

  // Get BL scores for all projects
  const projectIds = allProjects.map(p => p.id);
  const blScoresMap = await getProjectScoresBatch(projectIds);

  // Score all projects
  const results: Array<{
    id: number;
    name: string;
    sector: string;
    priority: string;
    location: string;
    finalScore: number;
    portableAirGate: { pass: boolean; reason?: string; suppressionLevel?: string };
    palBessGate: { pass: boolean; reason?: string; suppressionLevel?: string } | null;
    visibilityTier: string;
    section: string;
  }> = [];

  for (const p of allProjects) {
    const projectBLScores = blScoresMap.get(p.id) || [];
    
    const laneResult = computePerUserFinalScore(
      {
        id: p.id,
        name: p.name,
        location: p.location,
        value: p.value,
        owner: p.owner,
        priority: p.priority,
        sector: p.sector,
        opportunityRoute: p.opportunityRoute,
        isNew: p.isNew,
        stage: p.stage,
        overview: p.overview,
        equipmentSignals: (p as any).equipmentSignals ?? null,
        contractors: (p as any).contractors ?? null,
      },
      {
        territories: amit.territories,
        assignedBusinessLines: amit.assignedBusinessLines,
        sectorFocus: amit.sectorFocus,
        stageTiming: amit.stageTiming,
        keyAccounts: amit.keyAccounts,
        buyerRoles: amit.buyerRoles,
        salesMotion: amit.salesMotion as any,
      },
      projectBLScores,
      [],
    );

    const finalScore = laneResult.finalScoreWithTieBreaker;
    if (finalScore < 20) continue; // Skip very low scores

    // New gate architecture: PAL/BESS reps skip PA gate, only PAL/BESS gate runs
    let paGate: { pass: boolean; reason?: string; suppressionLevel?: string } = { pass: true };
    let palBessGate: { pass: boolean; reason?: string; suppressionLevel?: string } | null = null;

    if (isPalBessRep) {
      palBessGate = palBessOpportunityGate({
        name: p.name,
        overview: p.overview,
        sector: p.sector,
        opportunityRoute: p.opportunityRoute,
        equipmentSignals: (p as any).equipmentSignals ?? null,
        stage: p.stage ?? null,
        priority: p.priority ?? null,
      });
    } else {
      const portableAirScore = laneResult.laneScores?.portableAir ?? 0;
      paGate = portableAirOpportunityGate(
        {
          name: p.name,
          overview: p.overview,
          sector: p.sector,
          stage: p.stage,
          opportunityRoute: p.opportunityRoute,
          owner: p.owner,
          equipmentSignals: (p as any).equipmentSignals ?? null,
        },
        portableAirScore,
      );
    }

    let visibilityTier = "action_ready";
    if (isPalBessRep) {
      if (palBessGate && !palBessGate.pass) {
        visibilityTier = palBessGate.suppressionLevel === 'suppress' ? 'suppress' : 'monitor_only';
      }
    } else {
      if (!paGate.pass) {
        visibilityTier = paGate.suppressionLevel === 'suppress' ? 'suppress' : 'monitor_only';
      }
    }

    let section = "suppressed";
    if (visibilityTier === 'action_ready' && finalScore >= 35) section = "must_act";
    else if (visibilityTier === 'action_ready' && finalScore >= 25) section = "closing_soon_candidate";
    else if (visibilityTier === 'monitor_only') section = "waiting_monitor";
    else if (visibilityTier === 'suppress') section = "suppressed";

    results.push({
      id: p.id,
      name: p.name,
      sector: p.sector || "unknown",
      priority: p.priority || "unknown",
      location: p.location || "",
      finalScore,
      portableAirGate: paGate,
      palBessGate,
      visibilityTier,
      section,
    });
  }

  results.sort((a, b) => b.finalScore - a.finalScore);

  // Print suppression report
  const mustAct = results.filter(r => r.section === "must_act");
  const closingSoon = results.filter(r => r.section === "closing_soon_candidate");
  const waiting = results.filter(r => r.section === "waiting_monitor");
  const suppressed = results.filter(r => r.section === "suppressed");

  console.log(`\n${"=".repeat(80)}`);
  console.log(`CORRECTED AMIT DIGEST — PAL/BESS GATE APPLIED`);
  console.log(`${"=".repeat(80)}`);

  console.log(`\n✅ MUST ACT (${mustAct.length} projects):`);
  for (const r of mustAct.slice(0, 10)) {
    const palStatus = r.palBessGate ? (r.palBessGate.pass ? "✓ PAL/BESS" : `✗ ${r.palBessGate.reason}`) : "n/a";
    console.log(`  [${r.finalScore}] ${r.name} | ${r.sector} | ${r.location} | PAL/BESS: ${palStatus}`);
  }

  console.log(`\n⏰ CLOSING SOON CANDIDATES (${closingSoon.length} projects):`);
  for (const r of closingSoon.slice(0, 5)) {
    const palStatus = r.palBessGate ? (r.palBessGate.pass ? "✓ PAL/BESS" : `✗ ${r.palBessGate.reason}`) : "n/a";
    console.log(`  [${r.finalScore}] ${r.name} | ${r.sector} | PAL/BESS: ${palStatus}`);
  }

  console.log(`\n⏳ WAITING / MONITOR (${waiting.length} projects — top 10):`);
  for (const r of waiting.slice(0, 10)) {
    const palReason = r.palBessGate ? (r.palBessGate.pass ? "✓" : `✗ ${r.palBessGate.reason}`) : "PA gate failed";
    console.log(`  [${r.finalScore}] ${r.name} | ${r.sector} | Reason: ${palReason}`);
  }

  console.log(`\n🚫 SUPPRESSED (${suppressed.length} projects — top 10 by score):`);
  for (const r of suppressed.slice(0, 10)) {
    const paReason = r.portableAirGate.pass ? "PA ok" : r.portableAirGate.reason;
    console.log(`  [${r.finalScore}] ${r.name} | ${r.sector} | Reason: ${paReason}`);
  }

  // Check specific problem projects
  console.log(`\n${"=".repeat(80)}`);
  console.log(`SPECIFIC PROBLEM PROJECT AUDIT`);
  console.log(`${"=".repeat(80)}`);
  const problemProjects = ["Bruce Highway", "Inland Rail Euroa", "Olympic Dam"];
  for (const keyword of problemProjects) {
    const found = results.find(r => r.name.toLowerCase().includes(keyword.toLowerCase()));
    if (found) {
      console.log(`\n${found.name}:`);
      console.log(`  Score: ${found.finalScore} | Section: ${found.section} | Visibility: ${found.visibilityTier}`);
      console.log(`  PA Gate: ${found.portableAirGate.pass ? "PASS" : `FAIL — ${found.portableAirGate.reason}`}`);
      console.log(`  PAL/BESS Gate: ${found.palBessGate ? (found.palBessGate.pass ? "PASS" : `FAIL — ${found.palBessGate.reason}`) : "not run"}`);
    } else {
      console.log(`\n${keyword}: NOT FOUND in pool (score < 20 or suppressed early)`);
    }
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`SUMMARY`);
  console.log(`${"=".repeat(80)}`);
  console.log(`Total scored (>20): ${results.length}`);
  console.log(`Must Act: ${mustAct.length}`);
  console.log(`Closing Soon candidates: ${closingSoon.length}`);
  console.log(`Waiting/Monitor: ${waiting.length}`);
  console.log(`Suppressed: ${suppressed.length}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
