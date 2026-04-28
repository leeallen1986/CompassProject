/**
 * ICN Commercial Usefulness Audit
 * Validates that the repaired ICN source is now improving rep-facing intelligence.
 */

import { createConnection } from "mysql2/promise";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const ICN_PROJECT_NAMES = [
  "AUKUS", "Hunter Class Frigate", "Osborne Naval Shipyard",
  "Snowy Mountains", "Snowy 2.0",
  "Olympic Dam", "Carrapateena",
  "Western Sydney Airport", "Sydney Metro",
  "North East Link", "Suburban Rail Loop",
  "Cross River Rail", "Bruce Highway",
  "Marinus Link", "Battery of the Nation",
  "Ichthys", "Scarborough", "Barossa",
  "Pilbara", "Roy Hill", "South Flank",
  "Inland Rail", "Gorgon",
];

const DIGEST_RECIPIENTS = [
  { name: "Leo",     territories: ["WA", "OFFSHORE_AU"],       businessLines: ["Portable Air", "Pump"] },
  { name: "Ryan",    territories: ["NSW", "ACT", "VIC"],        businessLines: ["Portable Air", "PAL", "BESS"] },
  { name: "Daniel",  territories: ["QLD"],                      businessLines: ["Portable Air", "Pump"] },
  { name: "Dan",     territories: ["SA", "NT", "TAS"],          businessLines: ["Portable Air", "PAL"] },
  { name: "Amit",    territories: ["NSW", "VIC"],               businessLines: ["BESS", "Pump"] },
  { name: "Egor",    territories: ["WA", "QLD"],                businessLines: ["Portable Air", "PAL", "Pump"] },
  { name: "Brett",   territories: ["National", "VIC", "NSW"],   businessLines: ["Portable Air", "PAL", "BESS", "Pump"] },
];

const HIGH_VALUE_NAMES = [
  "AUKUS", "Hunter Class Frigate", "Sydney Metro",
  "North East Link", "Snowy Mountains", "Western Sydney Airport",
  "Cross River Rail", "Olympic Dam",
];

const STALE_DAYS = 21;
const ACTIVE_DAYS = 14;
const NOW = Date.now();

function daysSince(ts: number | Date | null): number {
  if (!ts) return 999;
  const ms = ts instanceof Date ? ts.getTime() : ts;
  return Math.floor((NOW - ms) / (1000 * 60 * 60 * 24));
}

function statusBucket(p: any): string {
  const days = daysSince(p.lastActivityAt);
  if (p.geoBlockedReason) return "suppressed";
  if (days <= ACTIVE_DAYS) return "active";
  if (days <= STALE_DAYS) return "monitor-only";
  return "stale";
}

function isDigestEligible(p: any): boolean {
  const days = daysSince(p.lastActivityAt);
  return !p.geoBlockedReason && days <= 14 && (p.priority === "hot" || p.priority === "warm");
}

function isActionReady(p: any): boolean {
  return isDigestEligible(p) && (p.contactCount ?? 0) > 0 && hasBL(p);
}

function isDiscoveryNeeded(p: any): boolean {
  const days = daysSince(p.lastActivityAt);
  return !p.geoBlockedReason && days <= STALE_DAYS && (p.contactCount ?? 0) === 0;
}

function parseBL(p: any): string[] {
  if (Array.isArray(p.matchedBusinessLines)) return p.matchedBusinessLines;
  try { return JSON.parse(p.matchedBusinessLines ?? "[]"); } catch { return []; }
}

function hasBL(p: any): boolean {
  return parseBL(p).length > 0;
}

function repInScope(rep: typeof DIGEST_RECIPIENTS[0], p: any): { inScope: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const projState = p.projectState ?? "National";
  const territoryMatch = rep.territories.some(t =>
    t === "National" || t === projState || projState === "National"
  );
  if (territoryMatch) reasons.push(`territory:${projState}`);
  let projBLs: string[] = [];
  try { projBLs = JSON.parse(p.matchedBusinessLines ?? "[]"); } catch {}
  const blMatch = rep.businessLines.some(bl =>
    projBLs.some((pbl: string) => pbl.toLowerCase().includes(bl.toLowerCase()) || bl.toLowerCase().includes(pbl.toLowerCase()))
  );
  if (blMatch) reasons.push(`BL:${projBLs.join("+")}`);
  return { inScope: territoryMatch || blMatch, reasons };
}

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL!);

  // ── Fetch ICN projects by lastIcnSeenAt (definitive ICN marker) ──
  const [icnRows] = await conn.execute<any[]>(`
    SELECT 
      p.id, p.name, p.owner, p.location, p.projectState, p.projectCountry,
      p.priority, p.sector, p.overview, p.stage, p.capexGrade,
      p.matchedBusinessLines, p.geoBlockedReason, p.locationConfidence,
      p.lastActivityAt, p.lastIcnSeenAt, p.updatedAt, p.createdAt,
      p.contractors, p.value, p.opportunityNote,
      COUNT(DISTINCT cp.contactId) as contactCount,
      GROUP_CONCAT(DISTINCT c.name ORDER BY c.name SEPARATOR '|') as contactNames,
      GROUP_CONCAT(DISTINCT c.title ORDER BY c.title SEPARATOR '|') as contactTitles
    FROM projects p
    LEFT JOIN contactProjects cp ON cp.projectId = p.id
    LEFT JOIN contacts c ON c.id = cp.contactId
    WHERE p.lastIcnSeenAt IS NOT NULL
    GROUP BY p.id
    ORDER BY p.lastActivityAt DESC
  `);

  const icnProjects = icnRows;

  // ── Compute status buckets ──
  const buckets = { active: 0, stale: 0, suppressed: 0, digestEligible: 0, actionReady: 0, discoveryNeeded: 0, monitorOnly: 0 };
  for (const p of icnProjects) {
    const b = statusBucket(p);
    if (b === "active") buckets.active++;
    else if (b === "stale") buckets.stale++;
    else if (b === "suppressed") buckets.suppressed++;
    else if (b === "monitor-only") buckets.monitorOnly++;
    if (isDigestEligible(p)) buckets.digestEligible++;
    if (isActionReady(p)) buckets.actionReady++;
    if (isDiscoveryNeeded(p)) buckets.discoveryNeeded++;
  }

  // ── OUTPUT ──
  const sep = "=".repeat(70);

  console.log(`\n${sep}`);
  console.log(`ICN COMMERCIAL USEFULNESS AUDIT — ${new Date().toISOString().split("T")[0]}`);
  console.log(`${sep}\n`);

  // SECTION 1
  console.log(`SECTION 1: ICN PROJECT STATE (${icnProjects.length} projects found)\n`);
  console.log(`  Active (≤${ACTIVE_DAYS}d):               ${buckets.active}`);
  console.log(`  Monitor-only (${ACTIVE_DAYS+1}-${STALE_DAYS}d):         ${buckets.monitorOnly}`);
  console.log(`  Stale (>${STALE_DAYS}d):                  ${buckets.stale}`);
  console.log(`  Suppressed (geo-blocked):          ${buckets.suppressed}`);
  console.log(`  Digest-eligible:                   ${buckets.digestEligible}`);
  console.log(`  Action-ready (BL+contacts):        ${buckets.actionReady}`);
  console.log(`  Discovery-needed (no contacts):    ${buckets.discoveryNeeded}`);
  console.log(``);

  console.log(`  ID     | Days | Status       | Priority | BL                    | Contacts | Project`);
  console.log(`  -------|------|--------------|----------|-----------------------|----------|--------`);
  for (const p of [...icnProjects].sort((a, b) => daysSince(a.lastActivityAt) - daysSince(b.lastActivityAt))) {
    const days = daysSince(p.lastActivityAt);
    const bucket = statusBucket(p);
    const bls: string[] = parseBL(p);
    const blStr = bls.join(",") || "—";
    const pri = p.priority ?? "—";
    const contacts = p.contactCount ?? 0;
    console.log(`  ${String(p.id).padEnd(6)} | ${String(days).padStart(4)} | ${bucket.padEnd(12)} | ${pri.padEnd(8)} | ${blStr.slice(0,21).padEnd(21)} | ${String(contacts).padStart(8)} | ${p.name.slice(0, 50)}`);
  }
  console.log(``);

  // SECTION 2
  console.log(`\n${sep}`);
  console.log(`SECTION 2: REP-FACING IMPACT\n`);

  for (const rep of DIGEST_RECIPIENTS) {
    const inScopeProjects: Array<{ project: any; reasons: string[] }> = [];
    for (const p of icnProjects) {
      const { inScope, reasons } = repInScope(rep, p);
      if (inScope && !p.geoBlockedReason) inScopeProjects.push({ project: p, reasons });
    }
    console.log(`  ${rep.name.toUpperCase()} (territories: ${rep.territories.join(", ")} | BL: ${rep.businessLines.join(", ")})`);
    if (inScopeProjects.length === 0) {
      console.log(`    → No ICN projects in scope`);
    } else {
      for (const { project: p, reasons } of inScopeProjects.sort((a, b) => daysSince(a.project.lastActivityAt) - daysSince(b.project.lastActivityAt))) {
        const days = daysSince(p.lastActivityAt);
        const bucket = statusBucket(p);
        const contacts = p.contactCount ?? 0;
        console.log(`    [${p.id}] ${p.name.slice(0, 45).padEnd(45)} | ${bucket.padEnd(12)} | ${String(days).padStart(3)}d | contacts:${contacts} | ${reasons.join(", ")}`);
      }
    }
    console.log(``);
  }

  // SECTION 3
  console.log(`\n${sep}`);
  console.log(`SECTION 3: HIGH-VALUE PROJECT DEEP DIVE\n`);

  for (const hvName of HIGH_VALUE_NAMES) {
    const p = icnProjects.find(r => r.name.toLowerCase().includes(hvName.toLowerCase()));
    if (!p) {
      console.log(`  [NOT FOUND IN DB] ${hvName}`);
      console.log(``);
      continue;
    }
    const days = daysSince(p.lastActivityAt);
    const bucket = statusBucket(p);
    const bls: string[] = parseBL(p);
    let contractors: any[] = [];
    if (Array.isArray(p.contractors)) contractors = p.contractors;
    else { try { contractors = JSON.parse(p.contractors ?? "[]"); } catch {} }
    const contacts = p.contactCount ?? 0;
    const contactNames = (p.contactNames ?? "").split("|").filter(Boolean);
    const contactTitles = (p.contactTitles ?? "").split("|").filter(Boolean);

    const digestFlag = isDigestEligible(p) ? "DIGEST" : "";
    const thisWeekFlag = days <= 7 ? "THIS WEEK" : "";
    const accountAttackFlag = contacts >= 3 && p.priority === "hot" ? "ACCOUNT ATTACK" : "";
    const flags = [digestFlag, thisWeekFlag, accountAttackFlag].filter(Boolean).join(" + ") || "MONITOR";

    const routeToBuy = bls.length > 0 && contacts > 0 ? "STRONG — BL match + contacts present"
      : bls.length > 0 ? "PARTIAL — BL match but no contacts"
      : contacts > 0 ? "PARTIAL — contacts but no BL match"
      : "WEAK — no BL match, no contacts";

    console.log(`  ── ${p.name.toUpperCase()} ──`);
    console.log(`  ID: ${p.id} | Status: ${bucket} | Days since activity: ${days}`);
    console.log(`  Owner: ${p.owner}`);
    console.log(`  Location: ${p.location} (${p.projectState ?? "unknown state"})`);
    console.log(`  Priority: ${p.priority ?? "—"} | Stage: ${p.stage ?? "—"} | CAPEX Grade: ${p.capexGrade ?? "—"} | Value: ${p.value ?? "—"}`);
    console.log(`  BL Match: ${bls.length > 0 ? bls.join(", ") : "NONE — needs BL tagging"}`);
    console.log(`  Contractors: ${contractors.length > 0 ? contractors.map((c: any) => (typeof c === "object" ? c.name ?? JSON.stringify(c) : c)).join(", ") : "none recorded"}`);
    console.log(`  Opportunity Note: ${(p.opportunityNote ?? "").slice(0, 150) || "none recorded"}`);
    console.log(`  Contact Coverage: ${contacts} contacts`);
    if (contactNames.length > 0) {
      for (let i = 0; i < Math.min(contactNames.length, 5); i++) {
        console.log(`    - ${contactNames[i]} | ${contactTitles[i] ?? "—"}`);
      }
    }
    console.log(`  Overview: ${(p.overview ?? "").slice(0, 200)}`);
    console.log(`  Route-to-buy: ${routeToBuy}`);
    console.log(`  Classification: ${flags}`);
    console.log(``);
  }

  // SECTION 4
  console.log(`\n${sep}`);
  console.log(`SECTION 4: QUALITY CHECK\n`);

  const withBL = icnProjects.filter(p => hasBL(p));
  const withContacts = icnProjects.filter(p => (p.contactCount ?? 0) > 0);
  const withBoth = icnProjects.filter(p => hasBL(p) && (p.contactCount ?? 0) > 0);
  const withOverview = icnProjects.filter(p => (p.overview ?? "").length > 100);
  const withContractors = icnProjects.filter(p => {
    if (Array.isArray(p.contractors)) return p.contractors.length > 0;
    try { return (JSON.parse(p.contractors ?? "[]") as any[]).length > 0; } catch { return false; }
  });

  console.log(`  BL-tagged:                             ${withBL.length}/${icnProjects.length}`);
  console.log(`  Has contacts:                          ${withContacts.length}/${icnProjects.length}`);
  console.log(`  Has both BL + contacts (action-ready): ${withBoth.length}/${icnProjects.length}`);
  console.log(`  Has substantive overview (>100 chars): ${withOverview.length}/${icnProjects.length}`);
  console.log(`  Has contractor data:                   ${withContractors.length}/${icnProjects.length}`);
  console.log(``);

  const noBL = icnProjects.filter(p => !hasBL(p));
  if (noBL.length > 0) {
    console.log(`  Projects with NO BL match (need tagging):`);
    for (const p of noBL) {
      console.log(`    [${p.id}] ${p.name.slice(0, 55)} | priority:${p.priority ?? "—"} | sector:${p.sector}`);
    }
    console.log(``);
  }

  // SECTION 5
  console.log(`\n${sep}`);
  console.log(`SECTION 5: EXECUTIVE SUMMARY\n`);
  console.log(`  Total ICN projects in DB: ${icnProjects.length}`);
  console.log(`  Active (≤${ACTIVE_DAYS}d): ${buckets.active} — appear in rep dashboards now`);
  console.log(`  Digest-eligible: ${buckets.digestEligible} — appear in Monday digest`);
  console.log(`  Action-ready (BL+contacts): ${buckets.actionReady} — rep can act immediately`);
  console.log(`  Discovery-needed (no contacts): ${buckets.discoveryNeeded} — need enrichment before outreach`);
  console.log(``);

  await conn.end();
}

main().catch(console.error);
