import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';

/**
 * Corrected Ryan WA Top-10 Report
 * - Only includes projects with ACTUAL send_ready contacts (verified email)
 * - Excludes suppressed, hospitals, NSW leaks
 * - Shows application family breakdown
 */
async function main() {
  const db = await getDb();

  // ── Top 10: WA projects with send_ready contacts, PA≥70 ──
  const [top10] = await db.execute(sql`
    SELECT 
      p.id, p.name, p.projectState, p.location, p.sector,
      p.discoveryStatus, p.matchedBusinessLines,
      (SELECT MAX(s.score) FROM projectBusinessLineScores s 
       WHERE s.projectId = p.id AND s.scoringDimension = 'Portable Air') AS paScore,
      (SELECT COUNT(*) FROM contacts c 
       WHERE c.projectId = p.id AND c.contactTrustTier = 'send_ready') AS sendReadyCount
    FROM projects p
    WHERE p.lifecycleStatus = 'active'
      AND (p.suppressed = false OR p.suppressed IS NULL)
      AND p.projectState = 'WA'
      AND p.discoveryStatus = 'send_ready_contact'
      AND EXISTS (
        SELECT 1 FROM projectBusinessLineScores s 
        WHERE s.projectId = p.id AND s.scoringDimension = 'Portable Air' AND s.score >= 70
      )
    ORDER BY (SELECT MAX(s.score) FROM projectBusinessLineScores s 
              WHERE s.projectId = p.id AND s.scoringDimension = 'Portable Air') DESC
    LIMIT 10
  `) as any;

  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  RYAN WA TOP-10 — CORRECTED (send_ready contacts only)");
  console.log("═══════════════════════════════════════════════════════════════════\n");

  let miningDrilling = 0, ogSpecialtyAir = 0, pilingWaterwell = 0, other = 0;

  (top10 as any[]).forEach((p: any, i: number) => {
    const sector = (p.sector || "unknown").toLowerCase();
    const name = (p.name || "").toLowerCase();
    
    // Classify application family
    if (sector.includes("mining") || name.includes("drill") || name.includes("underground") || name.includes("gold") || name.includes("lithium")) {
      miningDrilling++;
    } else if (sector.includes("oil") || sector.includes("gas") || name.includes("lng") || name.includes("fpso") || name.includes("offshore")) {
      ogSpecialtyAir++;
    } else if (name.includes("piling") || name.includes("waterwell") || name.includes("bore")) {
      pilingWaterwell++;
    } else {
      other++;
    }

    console.log(`  #${i + 1} | PA:${p.paScore} | ${p.sendReadyCount} contacts | ${p.sector}`);
    console.log(`       ${p.name}`);
    console.log(`       ${p.location || 'Unknown location'}`);
    console.log("");
  });

  console.log("───────────────────────────────────────────────────────────────────");
  console.log("  APPLICATION FAMILY BREAKDOWN:");
  console.log(`    Mining/Drilling:       ${miningDrilling}`);
  console.log(`    O&G/Specialty Air:     ${ogSpecialtyAir}`);
  console.log(`    Piling/Waterwell:      ${pilingWaterwell}`);
  console.log(`    Other:                 ${other}`);
  console.log("───────────────────────────────────────────────────────────────────\n");

  // ── Must Act: PA≥85, send_ready, WA ──
  const [mustAct] = await db.execute(sql`
    SELECT 
      p.id, p.name, p.sector,
      (SELECT MAX(s.score) FROM projectBusinessLineScores s 
       WHERE s.projectId = p.id AND s.scoringDimension = 'Portable Air') AS paScore,
      (SELECT COUNT(*) FROM contacts c 
       WHERE c.projectId = p.id AND c.contactTrustTier = 'send_ready') AS sendReadyCount
    FROM projects p
    WHERE p.lifecycleStatus = 'active'
      AND (p.suppressed = false OR p.suppressed IS NULL)
      AND p.projectState = 'WA'
      AND p.discoveryStatus = 'send_ready_contact'
      AND EXISTS (
        SELECT 1 FROM projectBusinessLineScores s 
        WHERE s.projectId = p.id AND s.scoringDimension = 'Portable Air' AND s.score >= 85
      )
    ORDER BY (SELECT MAX(s.score) FROM projectBusinessLineScores s 
              WHERE s.projectId = p.id AND s.scoringDimension = 'Portable Air') DESC
  `) as any;

  console.log("  MUST ACT (PA≥85, send_ready contacts):");
  (mustAct as any[]).forEach((p: any) => {
    console.log(`    PA:${p.paScore} | ${p.sendReadyCount} contacts | ${p.name}`);
  });
  console.log(`  Total Must Act: ${(mustAct as any[]).length}\n`);

  // ── Waiting on Contact Discovery: PA≥70, WA, NOT send_ready ──
  const [waiting] = await db.execute(sql`
    SELECT 
      p.id, p.name, p.sector, p.discoveryStatus,
      (SELECT MAX(s.score) FROM projectBusinessLineScores s 
       WHERE s.projectId = p.id AND s.scoringDimension = 'Portable Air') AS paScore
    FROM projects p
    WHERE p.lifecycleStatus = 'active'
      AND (p.suppressed = false OR p.suppressed IS NULL)
      AND p.projectState = 'WA'
      AND p.discoveryStatus IN ('discovery_queued', 'no_contacts', 'named_contact_no_email', 'role_only')
      AND EXISTS (
        SELECT 1 FROM projectBusinessLineScores s 
        WHERE s.projectId = p.id AND s.scoringDimension = 'Portable Air' AND s.score >= 70
      )
    ORDER BY (SELECT MAX(s.score) FROM projectBusinessLineScores s 
              WHERE s.projectId = p.id AND s.scoringDimension = 'Portable Air') DESC
    LIMIT 15
  `) as any;

  console.log("  WAITING ON CONTACT DISCOVERY (PA≥70, no send_ready contacts yet):");
  (waiting as any[]).forEach((p: any) => {
    console.log(`    PA:${p.paScore} | status:${p.discoveryStatus} | ${p.name}`);
  });
  console.log(`  Total Waiting: ${(waiting as any[]).length}\n`);

  // ── Tender suppression confirmation ──
  const [suppressed] = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM projects 
    WHERE suppressed = 1 AND projectState = 'WA' AND lifecycleStatus = 'active'
  `) as any;
  
  const [falsePosCheck] = await db.execute(sql`
    SELECT id, name FROM projects 
    WHERE lifecycleStatus = 'active'
      AND (suppressed = false OR suppressed IS NULL)
      AND projectState = 'WA'
      AND (
        LOWER(name) LIKE '%hospital%' OR LOWER(name) LIKE '%school%' 
        OR LOWER(name) LIKE '%college%' OR LOWER(name) LIKE '%parking%'
        OR LOWER(name) LIKE '%fire upgrade%' OR LOWER(name) LIKE '%minor roadworks%'
      )
  `) as any;

  console.log("  TENDER SUPPRESSION STATUS:");
  console.log(`    Total suppressed WA projects: ${(suppressed as any[])[0]?.cnt}`);
  console.log(`    Remaining false positives (hospital/school/parking/fire): ${(falsePosCheck as any[]).length}`);
  if ((falsePosCheck as any[]).length > 0) {
    (falsePosCheck as any[]).forEach((p: any) => console.log(`      LEAK: ${p.id} | ${p.name}`));
  } else {
    console.log("      ✓ All false positives suppressed");
  }

  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
