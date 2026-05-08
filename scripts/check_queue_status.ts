import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function check() {
  const db = await getDb();

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
  console.log("=== Current WA PA>=70 queue status ===");
  (queueStatus as any)[0].forEach((r: any) => console.log(`  Priority ${r.priority} | ${r.status}: ${r.cnt}`));

  const sendReady = await db.execute(sql`
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
  console.log("\nSend-ready contacts now:", (sendReady as any)[0][0].cnt);

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
        WHERE cp.projectId = p.id AND c.email IS NOT NULL AND c.email != ''
      )
  `);
  console.log("Send-ready WA projects:", (sendReadyProjects as any)[0][0].cnt);

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
        WHERE cp.projectId = p.id AND c.email IS NOT NULL AND c.email != ''
      )
  `);
  console.log("Ryan digest-safe projects (PA>=70):", (ryanDigestSafe as any)[0][0].cnt);

  const newContacts = await db.execute(sql`
    SELECT c.name, c.title, c.company, c.email, c.contactTrustTier, p.name as project
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    JOIN projects p ON p.id = cp.projectId
    WHERE (p.projectState = 'WA' OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
      AND c.email IS NOT NULL AND c.email != ''
      AND c.createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    ORDER BY c.createdAt DESC
    LIMIT 20
  `);
  const newContactRows = (newContacts as any)[0] as any[];
  console.log(`\nNew WA contacts (last 24h): ${newContactRows.length}`);
  newContactRows.forEach(c => console.log(`  ${c.name} | ${c.title} | ${c.company} | ${c.project}`));

  process.exit(0);
}
check().catch(e => { console.error(e.message); process.exit(1); });
