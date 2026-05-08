import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function baseline() {
  const db = await getDb();

  const sendReadyContacts = await db.execute(sql`
    SELECT COUNT(DISTINCT c.id) as cnt
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    JOIN projects p ON p.id = cp.projectId
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    WHERE (p.projectState = 'WA' OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 60
      AND c.email IS NOT NULL AND c.email != ''
      AND (c.contactTrustTier IS NULL OR c.contactTrustTier != 'llm_inferred')
  `);

  const sendReadyProjects = await db.execute(sql`
    SELECT COUNT(DISTINCT p.id) as cnt
    FROM projects p
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    WHERE (p.projectState = 'WA' OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 60
      AND p.lifecycleStatus = 'active'
      AND EXISTS (
        SELECT 1 FROM contactProjects cp
        JOIN contacts c ON c.id = cp.contactId
        WHERE cp.projectId = p.id
          AND c.email IS NOT NULL AND c.email != ''
      )
  `);

  const ryanDigestSafe = await db.execute(sql`
    SELECT COUNT(DISTINCT p.id) as cnt
    FROM projects p
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    WHERE (p.projectState = 'WA' OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 70
      AND p.lifecycleStatus = 'active'
      AND EXISTS (
        SELECT 1 FROM contactProjects cp
        JOIN contacts c ON c.id = cp.contactId
        WHERE cp.projectId = p.id
          AND c.email IS NOT NULL AND c.email != ''
      )
  `);

  const queueStatus = await db.execute(sql`
    SELECT p.discoveryStatus as status, p.discoveryPriority as priority, COUNT(*) as cnt
    FROM projects p
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    WHERE (p.projectState = 'WA' OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 70
    GROUP BY p.discoveryStatus, p.discoveryPriority
    ORDER BY p.discoveryPriority ASC, p.discoveryStatus ASC
  `);

  const totalWAPA = await db.execute(sql`
    SELECT COUNT(DISTINCT p.id) as cnt
    FROM projects p
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    WHERE (p.projectState = 'WA' OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 60
      AND p.lifecycleStatus = 'active'
  `);

  const ogNoContacts = await db.execute(sql`
    SELECT COUNT(DISTINCT p.id) as cnt
    FROM projects p
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    WHERE (p.projectState IN ('WA','OFFSHORE_AU') OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 60
      AND p.lifecycleStatus = 'active'
      AND (p.sector = 'oil_gas' OR p.name LIKE '%Woodside%' OR p.name LIKE '%Santos%'
           OR p.name LIKE '%Chevron%' OR p.name LIKE '%Strike%'
           OR p.name LIKE '%FPSO%' OR p.name LIKE '%Barossa%'
           OR p.name LIKE '%Scarborough%' OR p.name LIKE '%Gorgon%')
      AND NOT EXISTS (
        SELECT 1 FROM contactProjects cp WHERE cp.projectId = p.id
      )
  `);

  // O&G projects with contacts for comparison
  const ogWithContacts = await db.execute(sql`
    SELECT COUNT(DISTINCT p.id) as cnt
    FROM projects p
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    WHERE (p.projectState IN ('WA','OFFSHORE_AU') OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 60
      AND p.lifecycleStatus = 'active'
      AND (p.sector = 'oil_gas' OR p.name LIKE '%Woodside%' OR p.name LIKE '%Santos%'
           OR p.name LIKE '%Chevron%' OR p.name LIKE '%Strike%'
           OR p.name LIKE '%FPSO%' OR p.name LIKE '%Barossa%'
           OR p.name LIKE '%Scarborough%' OR p.name LIKE '%Gorgon%')
      AND EXISTS (
        SELECT 1 FROM contactProjects cp
        JOIN contacts c ON c.id = cp.contactId
        WHERE cp.projectId = p.id AND c.email IS NOT NULL AND c.email != ''
      )
  `);

  console.log("=== BASELINE SNAPSHOT (before queue run) ===");
  console.log(`Send-ready contacts (WA, PA>=60, has email):    ${(sendReadyContacts as any)[0][0].cnt}`);
  console.log(`Send-ready WA projects (PA>=60, has email):     ${(sendReadyProjects as any)[0][0].cnt}`);
  console.log(`Ryan digest-safe projects (WA, PA>=70, email):  ${(ryanDigestSafe as any)[0][0].cnt}`);
  console.log(`Total WA active projects (PA>=60):              ${(totalWAPA as any)[0][0].cnt}`);
  console.log(`O&G WA/OFFSHORE with NO contacts:               ${(ogNoContacts as any)[0][0].cnt}`);
  console.log(`O&G WA/OFFSHORE with email contacts:            ${(ogWithContacts as any)[0][0].cnt}`);
  console.log("\n=== WA PA>=70 Discovery Queue (Priority A first) ===");
  const rows = (queueStatus as any)[0] as any[];
  if (rows.length === 0) console.log("  (no queue entries found)");
  rows.forEach(r => console.log(`  Priority ${r.priority} | ${r.status}: ${r.cnt}`));
  process.exit(0);
}

baseline().catch(e => { console.error(e); process.exit(1); });
