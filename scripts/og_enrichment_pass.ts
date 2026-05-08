/**
 * Targeted O&G Apollo enrichment pass.
 * Runs Apollo email reveal on Woodside/Santos/Chevron/Strike/FPSO/Barossa/Scarborough/
 * Gorgon/Pluto/Prelude projects that have named_unverified contacts but no send_ready emails.
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { enrichProjectContacts } from "../server/apolloEnrichment";
import { apolloCreditLog } from "../drizzle/schema";
import { gte } from "drizzle-orm";

async function run() {
  const db = await getDb();

  // Get the latest report ID
  const reportRows = await db.execute(sql`SELECT id FROM reports ORDER BY id DESC LIMIT 1`);
  const reportId = (reportRows as any)[0]?.[0]?.id || 1;
  console.log("Using report ID:", reportId);

  // Get O&G projects using raw SQL to avoid template literal issues
  const ogProjects = await db.execute(sql`
    SELECT p.id, p.name, p.sector, p.owner, p.projectState, pbls.score
    FROM projects p
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    WHERE (p.projectState IN ('WA','OFFSHORE_AU') OR p.location LIKE '%Western Australia%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 60
      AND p.lifecycleStatus = 'active'
      AND (p.sector = 'oil_gas'
           OR p.name LIKE '%Woodside%' OR p.name LIKE '%Santos%'
           OR p.name LIKE '%Chevron%' OR p.name LIKE '%Strike%'
           OR p.name LIKE '%FPSO%' OR p.name LIKE '%Barossa%'
           OR p.name LIKE '%Scarborough%' OR p.name LIKE '%Gorgon%'
           OR p.name LIKE '%Pluto%' OR p.name LIKE '%NWS%' OR p.name LIKE '%Prelude%')
    ORDER BY pbls.score DESC
  `);

  const ogRows = (ogProjects as any)[0] as any[];
  console.log(`\nFound ${ogRows.length} O&G projects for Apollo enrichment pass:`);
  ogRows.forEach((p: any) =>
    console.log(`  [${p.projectState}] PA:${p.score} ${p.name.substring(0, 55)} | owner:${(p.owner || 'unknown').substring(0, 30)}`)
  );

  let totalNewSendReady = 0;
  let totalCreditsUsed = 0;

  for (const proj of ogRows) {
    // Check Apollo budget
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [budgetRow] = await db
      .select({ total: sql<number>`COALESCE(SUM(${apolloCreditLog.creditsUsed}), 0)` })
      .from(apolloCreditLog)
      .where(gte(apolloCreditLog.createdAt, today));
    const dailyUsed = Number(budgetRow?.total ?? 0);
    if (dailyUsed >= 50) {
      console.log(`\nApollo daily cap reached (${dailyUsed}/50) — stopping O&G pass`);
      break;
    }
    console.log(`\n  [${50 - dailyUsed} credits remaining] Processing: ${proj.name.substring(0, 60)}`);

    try {
      const result = await enrichProjectContacts(proj.id, reportId, {
        enrichEmails: true,
        maxPerCompany: 8,
      });
      const newSendReady = result.people.filter((p: any) => p.status === "enriched").length;
      totalNewSendReady += newSendReady;
      totalCreditsUsed += result.enrichCreditsUsed || 0;
      console.log(`    ${result.people.length} people found, ${newSendReady} enriched, ${result.enrichCreditsUsed} credits used`);
    } catch (e: any) {
      console.warn(`    Apollo failed: ${e.message}`);
    }
  }

  console.log(`\n=== O&G enrichment summary ===`);
  console.log(`  Projects processed: ${ogRows.length}`);
  console.log(`  New send_ready contacts: ${totalNewSendReady}`);
  console.log(`  Apollo credits used: ${totalCreditsUsed}`);

  // Final state
  const finalSendReady = await db.execute(sql`
    SELECT COUNT(DISTINCT c.id) as cnt
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    JOIN projects p ON p.id = cp.projectId
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    WHERE (p.projectState = 'WA' OR p.location LIKE '%Western Australia%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 60
      AND c.email IS NOT NULL AND c.email != ''
      AND (c.contactTrustTier IS NULL OR c.contactTrustTier != 'llm_inferred')
  `);
  console.log("\nSend-ready contacts now:", (finalSendReady as any)[0][0].cnt);

  // O&G specific send_ready
  const ogSendReady = await db.execute(sql`
    SELECT p.name, COUNT(DISTINCT c.id) as send_ready
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    JOIN projects p ON p.id = cp.projectId
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    WHERE (p.projectState IN ('WA','OFFSHORE_AU') OR p.location LIKE '%Western Australia%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 60
      AND (p.sector = 'oil_gas' OR p.name LIKE '%Woodside%' OR p.name LIKE '%Santos%'
           OR p.name LIKE '%Chevron%' OR p.name LIKE '%Scarborough%' OR p.name LIKE '%Gorgon%'
           OR p.name LIKE '%Pluto%' OR p.name LIKE '%Barossa%')
      AND c.email IS NOT NULL AND c.email != ''
      AND (c.contactTrustTier IS NULL OR c.contactTrustTier != 'llm_inferred')
    GROUP BY p.name
    ORDER BY send_ready DESC
  `);
  console.log("\nO&G send_ready contacts by project:");
  (ogSendReady as any)[0].forEach((r: any) =>
    console.log(`  ${r.name.substring(0, 55)}: ${r.send_ready}`)
  );

  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
