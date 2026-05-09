/**
 * Live Gate Replay — runs the actual digestHardeningGates logic against real DB data
 * for the 5 Monday-target reps and produces a before/after report.
 *
 * Uses the real gate functions with correct API signatures.
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
import * as fs from "fs";
dotenv.config();

import {
  runAllGates,
  checkContactDefensibility,
  checkJunkSuppression,
  type RepSendGateResult,
  type DigestGateInput,
} from "../server/digestHardeningGates";

const TARGET_REPS = ["Ryan Pemberton", "Brett Hansen", "Daniel Zec", "Dan Day", "Amit Bhargava"];

const BL_MAP: Record<string, string[]> = {
  "Portable Air": ["portable_air"],
  "PAL": ["pal"],
  "Pump (Flow)": ["pump"],
  "Pump": ["pump"],
  "BESS": ["bess"],
  "PT Capital Sales": ["portable_air", "pal", "pump", "bess"],
};

const BL_TO_LANE: Record<string, string> = {
  "Portable Air": "Portable Air",
  "PAL": "PAL",
  "Pump (Flow)": "Pump",
  "Pump": "Pump",
  "BESS": "BESS",
  "PT Capital Sales": "Portable Air",
};

const BL_TO_SCORE_DIM: Record<string, string> = {
  "Portable Air": "portable_air",
  "PAL": "pal",
  "Pump (Flow)": "pump",
  "Pump": "pump",
  "BESS": "bess",
  "PT Capital Sales": "portable_air",
};

function parseBLs(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Buffer.isBuffer(raw)) raw = raw.toString("utf8");
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return raw.split(",").map((s: string) => s.trim());
    }
  }
  return [];
}

function parseTerritories(raw: any): string[] {
  if (!raw) return [];
  if (Buffer.isBuffer(raw)) raw = raw.toString("utf8");
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return raw.split(",").map((s: string) => s.trim()); }
  }
  if (Array.isArray(raw)) return raw;
  return [];
}

function getPrimaryLane(bls: string[]): string {
  for (const bl of bls) {
    if (BL_TO_LANE[bl]) return BL_TO_LANE[bl];
  }
  return "Portable Air";
}

function getPrimaryScoreDim(bls: string[]): string {
  for (const bl of bls) {
    if (BL_TO_SCORE_DIM[bl]) return BL_TO_SCORE_DIM[bl];
  }
  return "portable_air";
}

async function main() {
  const db = await createConnection(process.env.DATABASE_URL!);

  const [repRows] = await db.query(`
    SELECT u.id, u.name, up.assignedBusinessLines, up.territories
    FROM users u
    JOIN userProfiles up ON up.userId = u.id
    WHERE u.name IN (${TARGET_REPS.map(() => "?").join(",")})
    ORDER BY FIELD(u.name, ${TARGET_REPS.map(() => "?").join(",")})
  `, [...TARGET_REPS, ...TARGET_REPS]) as any[];

  const output: string[] = [];
  output.push("# Live Gate Replay — Monday Hardening Gates\n");
  output.push(`**Generated:** ${new Date().toISOString()}\n`);
  output.push("---\n");

  const summaryRows: string[] = [];

  for (const rep of repRows as any[]) {
    const repName = rep.name;
    const bls = parseBLs(rep.assignedBusinessLines);
    const territories = parseTerritories(rep.territories);
    const isNational = territories.includes("NATIONAL") || territories.length === 0;
    const primaryLane = getPrimaryLane(bls);
    const scoreDim = getPrimaryScoreDim(bls);

    output.push(`\n## ${repName}`);
    output.push(`**Lane:** ${primaryLane} | **Territories:** ${isNational ? "NATIONAL" : territories.join(", ")}\n`);

    // Get top 5 digestSafe action_ready projects
    let stateFilter = "";
    let stateParams: string[] = [];
    if (!isNational && territories.length > 0) {
      stateFilter = `AND (p.projectState IN (${territories.map(() => "?").join(",")}) OR p.projectState IS NULL)`;
      stateParams = territories;
    }

    const [projectRows] = await db.query(`
      SELECT p.id, p.name, p.owner, p.contractors, p.projectState, p.lifecycleStatus,
             p.suppressed, pvg.digestSafe,
             COALESCE(pbl.score, 0) as blScore
      FROM projects p
      LEFT JOIN projectValidationGates pvg ON pvg.projectId = p.id
      LEFT JOIN projectBusinessLineScores pbl ON pbl.projectId = p.id AND pbl.scoringDimension = ?
      WHERE p.lifecycleStatus = 'action_ready'
        AND p.suppressed = 0
        AND pvg.digestSafe = 1
        ${stateFilter}
      ORDER BY blScore DESC, p.id ASC
      LIMIT 5
    `, [scoreDim, ...stateParams]) as any[];

    if ((projectRows as any[]).length === 0) {
      output.push(`> ⚠ **No digestSafe action_ready projects found.**`);
      summaryRows.push(`| ${repName} | ${primaryLane} | 0 projects | — | — | ⚠ NO POOL |`);
      continue;
    }

    // For each project, get top contact
    const enrichedProjects: Array<{
      id: number;
      name: string;
      owner: string | null;
      contractors: string[] | null;
      blScore: number;
      contact: {
        id: number;
        name: string;
        email: string | null;
        title: string | null;
        company: string | null;
        trustTier: string | null;
        source: string | null;
        verificationScore: number | null;
        isLlmInferred: boolean;
      } | null;
    }> = [];

    for (const proj of projectRows as any[]) {
      let contractors: string[] = [];
      try {
        if (proj.contractors) {
          const raw = Buffer.isBuffer(proj.contractors) ? proj.contractors.toString("utf8") : proj.contractors;
          contractors = JSON.parse(raw);
        }
      } catch {}

      const [contactRows] = await db.query(`
        SELECT c.id, c.name, c.email, c.title, c.company, c.trustTier,
               c.verificationScore, c.source, c.isLlmInferred
        FROM contacts c
        WHERE c.projectId = ?
          AND c.trustTier = 'send_ready'
        ORDER BY c.verificationScore DESC
        LIMIT 1
      `, [proj.id]) as any[];

      const contact = (contactRows as any[])[0] ?? null;

      enrichedProjects.push({
        id: proj.id,
        name: proj.name,
        owner: proj.owner ?? null,
        contractors,
        blScore: proj.blScore,
        contact: contact ? {
          id: contact.id,
          name: contact.name,
          email: contact.email,
          title: contact.title,
          company: contact.company,
          trustTier: contact.trustTier,
          source: contact.source,
          verificationScore: contact.verificationScore,
          isLlmInferred: !!contact.isLlmInferred,
        } : null,
      });
    }

    const top3 = enrichedProjects.slice(0, 3);
    const backups = enrichedProjects.slice(3, 5);

    // BEFORE table
    output.push(`### Before Gates — Top 3 Must Act`);
    output.push(`| # | Project | BL Score | Contact | Email (truncated) | Source | Verified |`);
    output.push(`|---|---------|----------|---------|-------------------|--------|----------|`);
    for (let i = 0; i < top3.length; i++) {
      const p = top3[i];
      const c = p.contact;
      const emailDisplay = c?.email ? c.email.replace(/(?<=.{3}).+(?=@)/, "***") : "—";
      output.push(`| ${i+1} | ${p.name.substring(0, 42)} | ${p.blScore} | ${c?.name ?? "**NONE**"} | ${emailDisplay} | ${c?.source ?? "—"} | ${c?.verificationScore ?? "—"} |`);
    }

    // Run individual gate checks
    output.push(`\n### Gate Results`);

    // Junk check
    let junkCount = 0;
    const junkDetails: string[] = [];
    for (const p of top3) {
      const r = checkJunkSuppression({ name: p.name, owner: p.owner ?? undefined }, primaryLane);
      if (r.isJunk) {
        junkCount++;
        junkDetails.push(`"${p.name.substring(0, 40)}" → ${r.pattern}`);
      }
    }
    output.push(`\n**Junk Gate:** ${junkCount === 0 ? "✅ PASS (0 junk in top 3)" : `❌ FAIL — ${junkCount} junk: ${junkDetails.join("; ")}`}`);

    // Contact defensibility
    let defensibleCount = 0;
    const defDetails: string[] = [];
    for (let i = 0; i < top3.length; i++) {
      const p = top3[i];
      const c = p.contact;
      if (!c) {
        defDetails.push(`#${i+1} NO CONTACT`);
        continue;
      }
      const r = checkContactDefensibility(
        { name: c.name, email: c.email, title: c.title, company: c.company, trustTier: c.trustTier, source: c.source, verificationScore: c.verificationScore, isDowngraded: false },
        { name: p.name, owner: p.owner, contractors: p.contractors },
        primaryLane
      );
      if (r.passes) {
        defensibleCount++;
        defDetails.push(`#${i+1} ✅ ${c.name} @ ${c.company}`);
      } else {
        defDetails.push(`#${i+1} ❌ ${c.name}: ${r.failedChecks.join(", ")}`);
      }
    }
    output.push(`**Contact Defensibility:** ${defensibleCount}/3 defensible`);
    for (const d of defDetails) output.push(`  - ${d}`);

    // Run full gate orchestrator
    const gateInput: DigestGateInput = {
      userId: rep.id,
      userName: repName,
      repLane: primaryLane,
      weekKey: new Date().toISOString().substring(0, 10),
      top3Projects: top3.map(p => ({
        id: p.id,
        name: p.name,
        owner: p.owner ?? undefined,
        contractors: p.contractors,
        laneFitLabel: primaryLane,
        relevanceScore: p.blScore,
        bestContact: p.contact ? {
          name: p.contact.name,
          email: p.contact.email,
          title: p.contact.title,
          company: p.contact.company,
          trustTier: p.contact.trustTier,
          source: p.contact.source,
          verificationScore: p.contact.verificationScore,
          isLlmInferred: p.contact.isLlmInferred,
        } : null,
      })),
      previousTop3: null,
    };

    const result = runAllGates(gateInput);

    output.push(`\n**Full Gate Decision: ${result.decision === "SEND" ? "✅ SEND" : "🚫 HOLD"}**`);
    if (result.blockers.length > 0) {
      output.push(`**Blockers:**`);
      for (const b of result.blockers) {
        output.push(`  - [${b.severity.toUpperCase()}] \`${b.criterion}\`: ${b.detail}`);
      }
    } else {
      output.push(`**Blockers:** none`);
    }

    // After: show what would be sent
    output.push(`\n### After Gates — What Gets Sent`);
    if (result.decision === "SEND") {
      output.push(`| # | Project | Contact | Company | Email Domain | Defensible |`);
      output.push(`|---|---------|---------|---------|--------------|------------|`);
      for (let i = 0; i < top3.length; i++) {
        const p = top3[i];
        const c = p.contact;
        const domain = c?.email?.split("@")[1] ?? "—";
        const defResult = c ? checkContactDefensibility(
          { name: c.name, email: c.email, title: c.title, company: c.company, trustTier: c.trustTier, source: c.source, verificationScore: c.verificationScore },
          { name: p.name, owner: p.owner, contractors: p.contractors },
          primaryLane
        ) : null;
        output.push(`| ${i+1} | ${p.name.substring(0, 42)} | ${c?.name ?? "NONE"} | ${c?.company ?? "—"} | ${domain} | ${defResult?.passes ? "✅" : "❌"} |`);
      }
    } else {
      output.push(`> 🚫 **HELD** — digest not sent for this rep.`);
      output.push(`> Backups available: ${backups.map(b => b.name.substring(0, 30)).join(", ") || "none"}`);
    }

    // Backup projects
    if (backups.length > 0) {
      output.push(`\n### Backup Projects (positions 4–5)`);
      output.push(`| # | Project | BL Score | Contact | Defensible |`);
      output.push(`|---|---------|----------|---------|------------|`);
      for (let i = 0; i < backups.length; i++) {
        const p = backups[i];
        const c = p.contact;
        const defResult = c ? checkContactDefensibility(
          { name: c.name, email: c.email, title: c.title, company: c.company, trustTier: c.trustTier, source: c.source, verificationScore: c.verificationScore },
          { name: p.name, owner: p.owner, contractors: p.contractors },
          primaryLane
        ) : null;
        output.push(`| ${i+4} | ${p.name.substring(0, 42)} | ${p.blScore} | ${c?.name ?? "NONE"} | ${defResult?.passes ? "✅" : c ? "❌" : "NO CONTACT"} |`);
      }
    }

    summaryRows.push(`| ${repName} | ${primaryLane} | ${top3.length}/3 | ${defensibleCount}/3 | ${junkCount} | ${result.decision === "SEND" ? "✅ SEND" : "🚫 HOLD"} |`);

    output.push("\n---");
  }

  // Summary table
  const summaryHeader = `\n## Summary\n\n| Rep | Lane | Top 3 | Defensible | Junk | Decision |\n|-----|------|-------|------------|------|----------|`;
  const fullOutput = output.join("\n");
  const finalOutput = fullOutput.replace("---\n", `---\n${summaryHeader}\n${summaryRows.join("\n")}\n`);

  fs.writeFileSync("/tmp/live_gate_replay.md", finalOutput);
  console.log(finalOutput);

  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
