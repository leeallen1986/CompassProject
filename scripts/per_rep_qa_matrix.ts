/**
 * Per-Rep QA Matrix — Full Pipeline Test
 * Tests gate pass, contact quality, territory coverage, digest readiness for each active rep.
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { laneOpportunityGate } from "../server/laneScoring";

function getPrimaryDimension(businessLines: any): string {
  // businessLines comes from DB as JSON array or string
  const raw = Array.isArray(businessLines) ? businessLines.join(",") : String(businessLines || "");
  const bl = raw.toLowerCase();
  if (bl.includes("pump") || bl.includes("dewatering")) return "pump_dewatering";
  if (bl.includes("pal") || bl.includes("bess")) return "pal_bess";
  if (bl.includes("portable air") || bl.includes("pt all") || bl.includes("pt capital")) return "portable_air";
  return "portable_air";
}

function matchesTerritory(projectState: string, territories: string): boolean {
  const terr = territories.toUpperCase();
  if (terr.includes("NATIONAL") || terr.includes("ALL")) return true;
  const state = (projectState || "").toUpperCase().trim();
  if (!state) return false;
  // Direct state abbreviation match
  const userStates = terr.split(",").map(s => s.trim());
  return userStates.includes(state);
}

async function main() {
  const db = await getDb();

  // Get all active users with profiles
  const [users] = await db.execute(sql`
    SELECT u.id, u.name, u.email, up.territories, up.assignedBusinessLines, up.sectorFocus
    FROM users u
    JOIN userProfiles up ON u.id = up.userId
    WHERE up.onboardingCompleted = 1
  `);

  // Get hot/warm projects with BL scores for each dimension
  const [projectsPA] = await db.execute(sql`
    SELECT p.id, p.name, p.overview, p.sector, p.opportunityRoute, p.owner, p.stage, p.equipmentSignals,
      p.projectState, COALESCE(pbs.score, 0) as laneScore
    FROM projects p
    LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Portable Air'
    WHERE p.lifecycleStatus = 'active'
    AND (p.priority = 'hot' OR p.priority = 'warm')
    AND p.suppressed = 0
    ORDER BY p.priority ASC, pbs.score DESC
    LIMIT 100
  `);
  const [projectsPump] = await db.execute(sql`
    SELECT p.id, p.name, p.overview, p.sector, p.opportunityRoute, p.owner, p.stage, p.equipmentSignals,
      p.projectState, COALESCE(pbs.score, 0) as laneScore
    FROM projects p
    LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Pump/Dewatering'
    WHERE p.lifecycleStatus = 'active'
    AND (p.priority = 'hot' OR p.priority = 'warm')
    AND p.suppressed = 0
    ORDER BY p.priority ASC, pbs.score DESC
    LIMIT 100
  `);
  const [projectsPAL] = await db.execute(sql`
    SELECT p.id, p.name, p.overview, p.sector, p.opportunityRoute, p.owner, p.stage, p.equipmentSignals,
      p.projectState, COALESCE(pbs.score, 0) as laneScore
    FROM projects p
    LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'PAL'
    WHERE p.lifecycleStatus = 'active'
    AND (p.priority = 'hot' OR p.priority = 'warm')
    AND p.suppressed = 0
    ORDER BY p.priority ASC, pbs.score DESC
    LIMIT 100
  `);
  const projectsByDim: Record<string, any[]> = {
    portable_air: projectsPA as any[],
    pump_dewatering: projectsPump as any[],
    pal_bess: projectsPAL as any[],
  };

  // Get digest preferences
  const [digestPrefs] = await db.execute(sql`
    SELECT userId, enabled FROM emailDigestPrefs
  `);
  const digestMap = new Map((digestPrefs as any[]).map(d => [d.userId, d.enabled]));

  // Get contact stats per project
  const [contactStats] = await db.execute(sql`
    SELECT project,
      COUNT(*) as total,
      SUM(CASE WHEN contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) as sendReady,
      SUM(CASE WHEN roleRelevance = 'high' AND contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) as highSendReady
    FROM contacts
    GROUP BY project
  `);
  const contactMap = new Map((contactStats as any[]).map(c => [c.project, c]));

  console.log("\n╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                              PER-REP QA MATRIX — FULL PIPELINE TEST                               ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝\n");

  const results: any[] = [];

  for (const user of users as any[]) {
    const rawTerr = user.territories;
    const territories = Array.isArray(rawTerr) ? rawTerr.join(",") : String(rawTerr || "");
    const businessLines = user.assignedBusinessLines || "";
    const primaryDim = getPrimaryDimension(businessLines) || "portable_air";

    // Filter projects by territory using the correct dimension's project list
    const dimProjects = projectsByDim[primaryDim] || projectsByDim.portable_air;
    const territoryProjects = (dimProjects).filter((p: any) =>
      matchesTerritory(p.projectState || "", territories)
    ).slice(0, 20);

    // Run gate
    let passed = 0;
    let passedProjects: string[] = [];
    for (const p of territoryProjects) {
      const result = laneOpportunityGate(
        {
          name: p.name || "",
          overview: p.overview || "",
          sector: p.sector || "",
          opportunityRoute: p.opportunityRoute || "",
          owner: p.owner || "",
          stage: p.stage || "",
          equipmentSignals: p.equipmentSignals || "",
        },
        primaryDim,
        p.laneScore || 0
      );
      if (result.pass) {
        passed++;
        passedProjects.push(p.name);
      }
    }

    // Contact quality for passed projects
    let totalSendReady = 0;
    let totalHighSendReady = 0;
    for (const pName of passedProjects) {
      const stats = contactMap.get(pName);
      if (stats) {
        totalSendReady += Number(stats.sendReady || 0);
        totalHighSendReady += Number(stats.highSendReady || 0);
      }
    }

    const passRate = territoryProjects.length > 0
      ? Math.round((passed / territoryProjects.length) * 100)
      : 0;

    let verdict = "PASS";
    if (passRate === 0) verdict = "FAIL";
    else if (passRate < 25) verdict = "WARN";
    else if (primaryDim === "pal_bess" && passRate < 15) verdict = "WARN (niche)";

    results.push({
      name: user.name,
      email: user.email,
      territories,
      businessLines,
      primaryDim,
      gatePass: `${passed}/${territoryProjects.length}`,
      passRate: `${passRate}%`,
      sendReady: totalSendReady,
      highSendReady: totalHighSendReady,
      digestEnabled: digestMap.get(user.id) === 1,
      verdict,
      topProjects: passedProjects.slice(0, 3),
    });
  }

  // Print table
  console.log("┌──────────────────────┬──────────────────┬──────────────┬────────┬──────────┬─────────┬─────────────┐");
  console.log("│ Rep                  │ Primary Lane     │ Territory    │ Gate   │ Pass %   │ Digest  │ Verdict     │");
  console.log("├──────────────────────┼──────────────────┼──────────────┼────────┼──────────┼─────────┼─────────────┤");
  for (const r of results) {
    const name = r.name.slice(0, 20).padEnd(20);
    const lane = r.primaryDim.slice(0, 16).padEnd(16);
    const terr = r.territories.slice(0, 12).padEnd(12);
    const gate = r.gatePass.padEnd(6);
    const pct = r.passRate.padEnd(8);
    const digest = (r.digestEnabled ? "YES" : "NO").padEnd(7);
    const verdict = r.verdict.padEnd(11);
    console.log(`│ ${name} │ ${lane} │ ${terr} │ ${gate} │ ${pct} │ ${digest} │ ${verdict} │`);
  }
  console.log("└──────────────────────┴──────────────────┴──────────────┴────────┴──────────┴─────────┴─────────────┘");

  // Contact quality per rep
  console.log("\n┌──────────────────────┬──────────────────┬────────────────────┬──────────────────────────────────────┐");
  console.log("│ Rep                  │ Send-Ready       │ High+Send-Ready    │ Top 3 Projects                       │");
  console.log("├──────────────────────┼──────────────────┼────────────────────┼──────────────────────────────────────┤");
  for (const r of results) {
    const name = r.name.slice(0, 20).padEnd(20);
    const sr = String(r.sendReady).padEnd(16);
    const hsr = String(r.highSendReady).padEnd(18);
    const top = r.topProjects.map((p: string) => p.slice(0, 30)).join(", ").slice(0, 36).padEnd(36);
    console.log(`│ ${name} │ ${sr} │ ${hsr} │ ${top} │`);
  }
  console.log("└──────────────────────┴──────────────────┴────────────────────┴──────────────────────────────────────┘");

  // Summary
  const passing = results.filter(r => r.verdict === "PASS").length;
  const warnings = results.filter(r => r.verdict.startsWith("WARN")).length;
  const failing = results.filter(r => r.verdict === "FAIL").length;
  console.log(`\n━━━ Summary: ${passing} PASS, ${warnings} WARN, ${failing} FAIL out of ${results.length} reps ━━━`);

  if (failing > 0) {
    console.log("\nFAILING REPS:");
    results.filter(r => r.verdict === "FAIL").forEach(r => {
      console.log(`  ${r.name} (${r.primaryDim}, ${r.territories}) — 0 projects pass gate`);
    });
  }

  process.exit(0);
}

main();
