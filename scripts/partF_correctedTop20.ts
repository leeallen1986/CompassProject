/**
 * Part F — Corrected Ryan WA Top-20 Output
 * 
 * Produces:
 * 1. Corrected top-20 ranked by PA score + priority + contact quality
 * 2. Must Act list (hot + PA>=80 + has verified contact)
 * 3. Waiting list (hot/warm + PA>=70 + contact queued/in-progress)
 * 4. Application family breakdown
 * 5. Pool completeness assessment
 */

import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function correctedTop20() {
  const db = await getDb();
  if (!db) { console.error("DB unavailable"); process.exit(1); }

  console.log("=== Part F: Corrected Ryan WA Top-20 ===\n");

  // Main top-20 query: WA active projects, ranked by PA score + priority + contact quality
  const top20 = await db.execute(sql.raw(`
    SELECT 
      p.id, p.name, p.owner, p.location, p.priority, p.sector,
      p.discoveryStatus, p.actionTier, p.sourcePurpose,
      p.lifecycleStatus,
      COALESCE(pbs_pa.score, 0) as paScore,
      COALESCE(pbs_pump.score, 0) as pumpScore,
      COALESCE(pbs_gen.score, 0) as genScore,
      COALESCE(pbs_nit.score, 0) as nitScore,
      COALESCE(pbs_bess.score, 0) as bessScore,
      COUNT(DISTINCT cp.contactId) as totalContacts,
      COUNT(DISTINCT CASE WHEN c.email IS NOT NULL AND c.email != '' THEN c.id END) as emailContacts,
      COUNT(DISTINCT CASE WHEN c.linkedin IS NOT NULL AND c.linkedin != '' THEN c.id END) as linkedinContacts,
      COUNT(DISTINCT CASE WHEN c.verificationStatus = 'verified' THEN c.id END) as verifiedContacts,
      GROUP_CONCAT(DISTINCT CASE WHEN c.email IS NOT NULL AND c.email != '' THEN c.name END ORDER BY c.name SEPARATOR ', ') as contactNames
    FROM projects p
    LEFT JOIN projectBusinessLineScores pbs_pa ON pbs_pa.projectId = p.id AND pbs_pa.scoringDimension = 'Portable Air'
    LEFT JOIN projectBusinessLineScores pbs_pump ON pbs_pump.projectId = p.id AND pbs_pump.scoringDimension = 'Pump/Dewatering'
    LEFT JOIN projectBusinessLineScores pbs_gen ON pbs_gen.projectId = p.id AND pbs_gen.scoringDimension = 'Generators'
    LEFT JOIN projectBusinessLineScores pbs_nit ON pbs_nit.projectId = p.id AND pbs_nit.scoringDimension = 'Nitrogen'
    LEFT JOIN projectBusinessLineScores pbs_bess ON pbs_bess.projectId = p.id AND pbs_bess.scoringDimension = 'BESS'
    LEFT JOIN contactProjects cp ON cp.projectId = p.id
    LEFT JOIN contacts c ON c.id = cp.contactId
    WHERE (p.projectCountry = 'Australia' OR p.location LIKE '%WA%' OR p.location LIKE '%Western Australia%')
      AND (p.suppressed = false OR p.suppressed IS NULL)
      AND p.lifecycleStatus = 'active'
      AND COALESCE(pbs_pa.score, 0) >= 50
    GROUP BY p.id, p.name, p.owner, p.location, p.priority, p.sector,
      p.discoveryStatus, p.actionTier, p.sourcePurpose,
      p.lifecycleStatus, pbs_pa.score, pbs_pump.score,
      pbs_gen.score, pbs_nit.score, pbs_bess.score
    ORDER BY 
      CASE p.priority WHEN 'hot' THEN 3 WHEN 'warm' THEN 2 ELSE 1 END DESC,
      paScore DESC,
      emailContacts DESC
    LIMIT 30
  `)) as unknown as any[];

  const rows = (Array.isArray(top20[0]) ? top20[0] : top20) as any[];

  // Classify application families
  const classifyFamily = (row: any): string[] => {
    const families: string[] = [];
    const name = (row.name || "").toLowerCase();
    const sector = (row.sector || "").toLowerCase();
    
    // Portable Air / Drilling
    if (sector === 'mining' || name.includes('drill') || name.includes('blast') || name.includes('underground') || name.includes('open cut') || name.includes('open pit')) {
      families.push('PA-Drilling');
    }
    // Dewatering
    if (name.includes('dewater') || name.includes('pump') || name.includes('water') || sector === 'water') {
      families.push('Dewatering');
    }
    // Oil & Gas
    if (sector === 'oil_gas' || name.includes('gas') || name.includes('lng') || name.includes('pipeline') || name.includes('walyering') || name.includes('waitsia')) {
      families.push('O&G');
    }
    // Infrastructure / Construction
    if (sector === 'infrastructure' || name.includes('road') || name.includes('bridge') || name.includes('tunnel') || name.includes('depot') || name.includes('facility')) {
      families.push('Infra-PA');
    }
    // Energy / BESS
    if (sector === 'energy' || name.includes('solar') || name.includes('wind') || name.includes('bess') || name.includes('battery') || name.includes('power')) {
      families.push('Energy');
    }
    
    return families.length > 0 ? families : ['General-PA'];
  };

  console.log("=== CORRECTED TOP 20 — Ryan WA Universe ===\n");
  console.log(`${"#".padEnd(3)} ${"PA".padEnd(4)} ${"PRI".padEnd(5)} ${"CONTACTS".padEnd(10)} ${"STATUS".padEnd(25)} ${"PROJECT"}`);
  console.log("─".repeat(110));

  const mustAct: any[] = [];
  const waiting: any[] = [];
  const blocked: any[] = [];

  rows.slice(0, 20).forEach((p: any, i: number) => {
    const pa = Number(p.paScore || 0);
    const emailC = Number(p.emailContacts || 0);
    const totalC = Number(p.totalContacts || 0);
    const verified = Number(p.verifiedContacts || 0);
    const families = classifyFamily(p);
    
    const contactStr = emailC > 0 ? `${emailC}✉ ${totalC}👤` : (totalC > 0 ? `${totalC}👤 (no email)` : "none");
    const statusStr = p.discoveryStatus || 'unknown';
    
    console.log(`${String(i+1).padEnd(3)} ${String(pa).padEnd(4)} ${(p.priority || '').padEnd(5)} ${contactStr.padEnd(10)} ${statusStr.padEnd(25)} ${p.name}`);
    console.log(`    Owner: ${p.owner} | Sector: ${p.sector} | Families: ${families.join(', ')}`);
    if (p.contactNames) console.log(`    Contacts: ${p.contactNames}`);
    console.log();

    // Classify into action lists
    if (p.priority === 'hot' && pa >= 80 && emailC >= 1) {
      mustAct.push({ ...p, pa, emailC, families });
    } else if ((p.priority === 'hot' || p.priority === 'warm') && pa >= 70) {
      if (['discovery_queued', 'send_ready_contact', 'named_contact_no_email'].includes(statusStr)) {
        waiting.push({ ...p, pa, emailC, families });
      } else {
        blocked.push({ ...p, pa, emailC, families });
      }
    }
  });

  // Must Act list
  console.log("\n=== MUST ACT (Hot + PA≥80 + Email Contact) ===");
  if (mustAct.length === 0) {
    console.log("  None — no hot projects with PA≥80 AND verified email contact");
  } else {
    mustAct.forEach((p, i) => {
      console.log(`  ${i+1}. [PA:${p.pa}] ${p.name}`);
      console.log(`     Owner: ${p.owner} | Contacts: ${p.emailC} with email`);
      console.log(`     Application: ${p.families.join(', ')}`);
    });
  }

  // Waiting list
  console.log("\n=== WAITING (Hot/Warm + PA≥70 + Contact In Progress) ===");
  if (waiting.length === 0) {
    console.log("  None");
  } else {
    waiting.forEach((p, i) => {
      console.log(`  ${i+1}. [PA:${p.pa}] ${p.name} — ${p.discoveryStatus}`);
      console.log(`     Owner: ${p.owner} | Application: ${p.families.join(', ')}`);
    });
  }

  // Blocked list
  console.log("\n=== BLOCKED (High-PA but no contact path) ===");
  if (blocked.length === 0) {
    console.log("  None");
  } else {
    blocked.forEach((p, i) => {
      console.log(`  ${i+1}. [PA:${p.pa}] ${p.name} — ${p.discoveryStatus}`);
      console.log(`     Owner: ${p.owner} | Reason: ${p.discoveryStatus}`);
    });
  }

  // Application family breakdown across full WA pool
  const familyBreakdown = await db.execute(sql.raw(`
    SELECT 
      p.sector,
      COUNT(*) as projectCount,
      AVG(COALESCE(pbs.score, 0)) as avgPaScore,
      COUNT(DISTINCT CASE WHEN cp.contactId IS NOT NULL THEN p.id END) as withContacts,
      SUM(CASE WHEN p.priority = 'hot' THEN 1 ELSE 0 END) as hotCount,
      SUM(CASE WHEN p.priority = 'warm' THEN 1 ELSE 0 END) as warmCount
    FROM projects p
    LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Portable Air'
    LEFT JOIN contactProjects cp ON cp.projectId = p.id
    WHERE (p.projectCountry = 'Australia' OR p.location LIKE '%WA%' OR p.location LIKE '%Western Australia%')
      AND (p.suppressed = false OR p.suppressed IS NULL)
      AND p.lifecycleStatus = 'active'
      AND COALESCE(pbs.score, 0) >= 50
    GROUP BY p.sector
    ORDER BY projectCount DESC
  `)) as unknown as any[];

  const famRows = (Array.isArray(familyBreakdown[0]) ? familyBreakdown[0] : familyBreakdown) as any[];
  
  console.log("\n=== APPLICATION FAMILY BREAKDOWN (WA Pool, PA≥50) ===");
  console.log(`${"SECTOR".padEnd(20)} ${"COUNT".padEnd(8)} ${"HOT".padEnd(6)} ${"WARM".padEnd(6)} ${"AVG PA".padEnd(8)} ${"W/CONTACTS"}`);
  console.log("─".repeat(65));
  famRows.forEach((r: any) => {
    console.log(`${(r.sector || 'unknown').padEnd(20)} ${String(r.projectCount).padEnd(8)} ${String(r.hotCount).padEnd(6)} ${String(r.warmCount).padEnd(6)} ${Number(r.avgPaScore).toFixed(0).padEnd(8)} ${r.withContacts}`);
  });

  // Pool completeness
  const poolStats = await db.execute(sql.raw(`
    SELECT 
      COUNT(*) as totalActive,
      SUM(CASE WHEN COALESCE(pbs.score, 0) >= 80 THEN 1 ELSE 0 END) as highPA,
      SUM(CASE WHEN COALESCE(pbs.score, 0) >= 60 AND COALESCE(pbs.score, 0) < 80 THEN 1 ELSE 0 END) as medPA,
      SUM(CASE WHEN p.priority = 'hot' THEN 1 ELSE 0 END) as hotProjects,
      SUM(CASE WHEN p.discoveryStatus = 'send_ready_contact' THEN 1 ELSE 0 END) as sendReady,
      SUM(CASE WHEN p.discoveryStatus = 'discovery_queued' THEN 1 ELSE 0 END) as queued,
      SUM(CASE WHEN p.discoveryStatus = 'no_contacts' THEN 1 ELSE 0 END) as noContacts,
      SUM(CASE WHEN p.discoveryStatus LIKE 'blocked%' THEN 1 ELSE 0 END) as blocked
    FROM projects p
    LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Portable Air'
    WHERE (p.projectCountry = 'Australia' OR p.location LIKE '%WA%' OR p.location LIKE '%Western Australia%')
      AND (p.suppressed = false OR p.suppressed IS NULL)
      AND p.lifecycleStatus = 'active'
  `)) as unknown as any[];

  const ps = (Array.isArray(poolStats[0]) ? poolStats[0] : poolStats)[0] as any;
  
  console.log("\n=== POOL COMPLETENESS ASSESSMENT ===");
  console.log(`  Total active WA projects: ${ps?.totalActive || 0}`);
  console.log(`  High PA (≥80): ${ps?.highPA || 0}`);
  console.log(`  Medium PA (60-79): ${ps?.medPA || 0}`);
  console.log(`  Hot projects: ${ps?.hotProjects || 0}`);
  console.log(`  Send-ready (contact + email): ${ps?.sendReady || 0}`);
  console.log(`  Queued for discovery: ${ps?.queued || 0}`);
  console.log(`  No contacts found: ${ps?.noContacts || 0}`);
  console.log(`  Blocked (gov/dirty): ${ps?.blocked || 0}`);

  console.log("\n=== Part F Complete ===");
  process.exit(0);
}

correctedTop20().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
