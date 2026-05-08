import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  // Get all active reps with profiles
  const [repRows] = await db.execute(sql`
    SELECT u.id, u.name, up.territories, up.assignedBusinessLines, up.buyerRoles
    FROM users u
    JOIN userProfiles up ON up.userId = u.id
    WHERE u.role != 'admin' OR u.role IS NULL
  `);
  const reps = repRows as any[];

  console.log(`\n=== FULL SALES-TEAM QA MATRIX ===`);
  console.log(`Total reps with profiles: ${reps.length}\n`);

  for (const rep of reps) {
    const territories = rep.territories ?? [];
    const businessLines = rep.assignedBusinessLines ?? [];
    const territoryStr = territories.join(", ") || "ALL";
    const blStr = businessLines.join(", ") || "ALL";

    console.log(`\n${"=".repeat(70)}`);
    console.log(`REP: ${rep.name} | Territory: ${territoryStr} | BLs: ${blStr}`);
    console.log(`${"=".repeat(70)}`);

    // Build territory filter
    let territoryClause = "";
    if (territories.length > 0) {
      const stateList = territories.map((t: string) => `'${t}'`).join(",");
      territoryClause = `AND p.projectState IN (${stateList})`;
    }

    // Build BL filter - use the first business line for scoring
    const primaryBL = businessLines[0] || "Portable Air";

    // Get project counts
    const [totalRows] = await db.execute(sql.raw(`
      SELECT COUNT(*) as cnt FROM projects p
      JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
      WHERE p.lifecycleStatus = 'active'
        AND p.suppressed = 0
        AND pbs.scoringDimension = '${primaryBL}'
        AND pbs.score >= 60
        ${territoryClause}
    `));
    const totalProjects = (totalRows as any[])[0]?.cnt ?? 0;

    const [digestRows] = await db.execute(sql.raw(`
      SELECT COUNT(*) as cnt FROM projects p
      JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
      WHERE p.lifecycleStatus = 'active'
        AND p.suppressed = 0
        AND pbs.scoringDimension = '${primaryBL}'
        AND pbs.score >= 70
        ${territoryClause}
    `));
    const digestProjects = (digestRows as any[])[0]?.cnt ?? 0;

    // Get send_ready contacts count
    const [sendReadyRows] = await db.execute(sql.raw(`
      SELECT COUNT(DISTINCT c.id) as cnt
      FROM contacts c
      JOIN contactProjects cp ON cp.contactId = c.id
      JOIN projects p ON p.id = cp.projectId
      JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
      WHERE p.lifecycleStatus = 'active'
        AND p.suppressed = 0
        AND pbs.scoringDimension = '${primaryBL}'
        AND pbs.score >= 60
        AND c.contactTrustTier = 'send_ready'
        ${territoryClause}
    `));
    const sendReadyContacts = (sendReadyRows as any[])[0]?.cnt ?? 0;

    // Get projects WITH send_ready contacts
    const [projWithContactRows] = await db.execute(sql.raw(`
      SELECT COUNT(DISTINCT p.id) as cnt
      FROM projects p
      JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
      JOIN contactProjects cp ON cp.projectId = p.id
      JOIN contacts c ON c.id = cp.contactId
      WHERE p.lifecycleStatus = 'active'
        AND p.suppressed = 0
        AND pbs.scoringDimension = '${primaryBL}'
        AND pbs.score >= 60
        AND c.contactTrustTier = 'send_ready'
        ${territoryClause}
    `));
    const projectsWithContacts = (projWithContactRows as any[])[0]?.cnt ?? 0;

    // Get projects with NO contacts at all
    const [noContactRows] = await db.execute(sql.raw(`
      SELECT COUNT(DISTINCT p.id) as cnt
      FROM projects p
      JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
      LEFT JOIN contactProjects cp ON cp.projectId = p.id
      WHERE p.lifecycleStatus = 'active'
        AND p.suppressed = 0
        AND pbs.scoringDimension = '${primaryBL}'
        AND pbs.score >= 60
        AND cp.id IS NULL
        ${territoryClause}
    `));
    const projectsNoContacts = (noContactRows as any[])[0]?.cnt ?? 0;

    // Get named_unverified only projects (have contacts but none send_ready)
    const projectsNeedVerification = totalProjects - projectsWithContacts - projectsNoContacts;

    // Get sector breakdown of top projects
    const [sectorRows] = await db.execute(sql.raw(`
      SELECT p.sector, COUNT(*) as cnt
      FROM projects p
      JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
      WHERE p.lifecycleStatus = 'active'
        AND p.suppressed = 0
        AND pbs.scoringDimension = '${primaryBL}'
        AND pbs.score >= 70
        ${territoryClause}
      GROUP BY p.sector
      ORDER BY cnt DESC
      LIMIT 5
    `));
    const sectors = sectorRows as any[];

    // Get top 5 projects for this rep
    const [top5Rows] = await db.execute(sql.raw(`
      SELECT p.id, p.name, pbs.score as paScore, p.sector,
             (SELECT COUNT(*) FROM contactProjects cp2
              JOIN contacts c2 ON c2.id = cp2.contactId
              WHERE cp2.projectId = p.id AND c2.contactTrustTier = 'send_ready') as sendReadyCnt
      FROM projects p
      JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
      WHERE p.lifecycleStatus = 'active'
        AND p.suppressed = 0
        AND pbs.scoringDimension = '${primaryBL}'
        AND pbs.score >= 70
        ${territoryClause}
      ORDER BY pbs.score DESC
      LIMIT 5
    `));
    const top5 = top5Rows as any[];

    // Check for false positives (hospitals, schools, parking in their pool)
    const [fpRows] = await db.execute(sql.raw(`
      SELECT p.id, p.name FROM projects p
      JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
      WHERE p.lifecycleStatus = 'active'
        AND p.suppressed = 0
        AND pbs.scoringDimension = '${primaryBL}'
        AND pbs.score >= 60
        ${territoryClause}
        AND (p.name LIKE '%hospital%' OR p.name LIKE '%school%' OR p.name LIKE '%college%'
             OR p.name LIKE '%parking%' OR p.name LIKE '%disabled%')
      LIMIT 5
    `));
    const falsePositives = fpRows as any[];

    // Check for territory leaks (projects from wrong state)
    let territoryLeaks: any[] = [];
    if (territories.length > 0) {
      const excludeStates = ["WA", "QLD", "NSW", "VIC", "SA", "NT", "TAS", "ACT"]
        .filter(s => !territories.includes(s))
        .map(s => `'${s}'`).join(",");
      if (excludeStates) {
        const [leakRows] = await db.execute(sql.raw(`
          SELECT p.id, p.name, p.projectState FROM projects p
          JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
          WHERE p.lifecycleStatus = 'active'
            AND p.suppressed = 0
            AND pbs.scoringDimension = '${primaryBL}'
            AND pbs.score >= 60
            AND p.projectState IN (${excludeStates})
            ${territoryClause.replace(/AND p\.projectState.*?\)/, "")}
          LIMIT 5
        `));
        territoryLeaks = leakRows as any[];
      }
    }

    // Print summary
    console.log(`\n  METRICS:`);
    console.log(`    Total active projects (PA≥60): ${totalProjects}`);
    console.log(`    Digest-eligible (PA≥70):       ${digestProjects}`);
    console.log(`    Projects with send_ready:      ${projectsWithContacts} (${totalProjects > 0 ? Math.round(projectsWithContacts/totalProjects*100) : 0}%)`);
    console.log(`    Projects need verification:    ${projectsNeedVerification}`);
    console.log(`    Projects with NO contacts:     ${projectsNoContacts}`);
    console.log(`    Send-ready contacts total:     ${sendReadyContacts}`);
    console.log(`    Contact coverage ratio:        ${totalProjects > 0 ? Math.round(projectsWithContacts/totalProjects*100) : 0}%`);

    console.log(`\n  SECTOR BREAKDOWN (PA≥70):`);
    for (const s of sectors) {
      console.log(`    ${s.sector ?? "unknown"}: ${s.cnt}`);
    }

    console.log(`\n  TOP 5 PROJECTS:`);
    for (const p of top5) {
      const contactLabel = p.sendReadyCnt > 0 ? `${p.sendReadyCnt} send_ready` : "NO contacts";
      console.log(`    [PA:${p.paScore}] ${p.name.substring(0, 50)} | ${p.sector ?? "?"} | ${contactLabel}`);
    }

    if (falsePositives.length > 0) {
      console.log(`\n  ⚠️  FALSE POSITIVES DETECTED:`);
      for (const fp of falsePositives) {
        console.log(`    - ${fp.name}`);
      }
    } else {
      console.log(`\n  ✓ No false positives detected`);
    }

    if (territoryLeaks.length > 0) {
      console.log(`\n  ⚠️  TERRITORY LEAKS:`);
      for (const tl of territoryLeaks) {
        console.log(`    - [${tl.projectState}] ${tl.name}`);
      }
    } else {
      console.log(`\n  ✓ No territory leaks`);
    }
  }

  console.log(`\n\n${"=".repeat(70)}`);
  console.log("QA COMPLETE");
  console.log(`${"=".repeat(70)}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
