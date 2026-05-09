/**
 * Per-Rep Real Outputs — generates actual rep-facing data for each active rep
 * Shows top 3 projects, primary contact, trust tier, route-to-buy, and commercial verdict
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { laneOpportunityGate } from "../server/laneScoring";

function getGateDim(bls: string[]): { primaryDim: string; gateDim: string } {
  const blStr = bls.join(",").toLowerCase();
  if (blStr.includes("pump") || blStr.includes("dewatering"))
    return { primaryDim: "Pump/Dewatering", gateDim: "pump_dewatering" };
  if (blStr.includes("pal") || blStr.includes("bess"))
    return { primaryDim: "PAL", gateDim: "pal_bess" };
  return { primaryDim: "Portable Air", gateDim: "portable_air" };
}

async function main() {
  const db = await getDb();

  const [users] = await db.execute(sql`
    SELECT u.id, u.name, u.email, up.territories, up.assignedBusinessLines
    FROM users u
    JOIN userProfiles up ON u.id = up.userId
    WHERE up.onboardingCompleted = 1
  `);

  const output: string[] = [];
  output.push("# Per-Rep QA Outputs — Real Rep-Facing Data\n");
  output.push(`Generated: ${new Date().toISOString()}\n`);

  for (const user of users as any[]) {
    const territories: string[] = Array.isArray(user.territories) ? user.territories : [];
    const bls: string[] = Array.isArray(user.assignedBusinessLines) ? user.assignedBusinessLines : [];
    const { primaryDim, gateDim } = getGateDim(bls);

    // Build territory filter
    let terrFilter = "";
    if (territories.includes("NATIONAL") || territories.length === 0) {
      terrFilter = "AND 1=1";
    } else {
      const stateList = territories.map(t => `'${t}'`).join(",");
      terrFilter = `AND p.projectState IN (${stateList})`;
    }

    // Get top projects for this rep's dimension
    const [projects] = await db.execute(sql.raw(`
      SELECT p.id, p.name, p.overview, p.sector, p.opportunityRoute, p.owner, p.stage,
             p.equipmentSignals, p.projectState, p.priority, p.value,
             COALESCE(pbs.score, 0) as laneScore
      FROM projects p
      LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = '${primaryDim}'
      WHERE p.lifecycleStatus = 'active'
      AND (p.priority = 'hot' OR p.priority = 'warm')
      AND p.suppressed = 0
      ${terrFilter}
      ORDER BY p.priority ASC, pbs.score DESC
      LIMIT 15
    `));

    // Run gate and take top 3 that pass
    const passed: any[] = [];
    for (const p of projects as any[]) {
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
        gateDim,
        p.laneScore || 0
      );
      if (result.pass) {
        passed.push(p);
        if (passed.length >= 3) break;
      }
    }

    output.push(`\n## ${user.name}`);
    output.push(`- **Territory**: ${territories.join(", ") || "NATIONAL"}`);
    output.push(`- **Lane**: ${primaryDim}`);
    output.push(`- **Email**: ${user.email}`);
    output.push("");

    if (passed.length === 0) {
      output.push("| # | Project | Priority | BL Score | Contact | Trust | Verdict |");
      output.push("|---|---------|----------|----------|---------|-------|---------|");
      output.push("| - | NO PROJECTS PASS GATE | - | - | - | - | POOR |");
      output.push("");
      continue;
    }

    output.push("| # | Project | Priority | BL Score | State | Route |");
    output.push("|---|---------|----------|----------|-------|-------|");
    for (let i = 0; i < passed.length; i++) {
      const p = passed[i];
      output.push(`| ${i + 1} | ${(p.name || "").slice(0, 45)} | ${p.priority} | ${p.laneScore}/100 | ${p.projectState} | ${p.opportunityRoute} |`);
    }
    output.push("");

    // Get primary contact for each project
    output.push("**Selected Primary Contacts:**\n");
    output.push("| Project | Contact | Title | Company | Trust Tier | Relevance | Email | LinkedIn |");
    output.push("|---------|---------|-------|---------|------------|-----------|-------|----------|");

    let hasGoodContact = false;
    let hasBadContact = false;

    for (const p of passed) {
      const projName = (p.name || "").replace(/'/g, "''");
      const [contacts] = await db.execute(sql.raw(`
        SELECT name, title, company, contactTrustTier, roleRelevance, email, linkedin
        FROM contacts
        WHERE project = '${projName}'
        AND roleRelevance IN ('high', 'medium')
        AND contactTrustTier IN ('send_ready', 'named_unverified')
        ORDER BY
          CASE contactTrustTier WHEN 'send_ready' THEN 1 WHEN 'named_unverified' THEN 2 ELSE 3 END,
          CASE roleRelevance WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
        LIMIT 1
      `));
      const contact = (contacts as any[])[0];
      if (contact) {
        hasGoodContact = true;
        const emailStatus = contact.email ? "YES" : "NO";
        const liStatus = contact.linkedin ? "YES" : "NO";
        output.push(`| ${(p.name || "").slice(0, 30)} | ${contact.name} | ${(contact.title || "").slice(0, 30)} | ${contact.company} | ${contact.contactTrustTier} | ${contact.roleRelevance} | ${emailStatus} | ${liStatus} |`);
      } else {
        hasBadContact = true;
        output.push(`| ${(p.name || "").slice(0, 30)} | NONE AVAILABLE | - | - | - | - | - | - |`);
      }
    }
    output.push("");

    // Commercial verdict
    let verdict = "GOOD";
    if (passed.length < 2) verdict = "BORDERLINE";
    if (passed.length === 0) verdict = "POOR";
    if (hasBadContact && !hasGoodContact) verdict = "BORDERLINE";
    if (passed.length >= 3 && hasGoodContact) verdict = "GOOD";

    output.push(`**Commercial Verdict**: ${verdict}`);
    output.push("");
  }

  // Write output
  const report = output.join("\n");
  console.log(report);

  // Also write to file
  const fs = await import("fs");
  fs.writeFileSync("/home/ubuntu/atlas-copco-intelligence/scripts/per_rep_outputs.md", report);
  console.log("\n\n--- Written to scripts/per_rep_outputs.md ---");

  process.exit(0);
}

main();
