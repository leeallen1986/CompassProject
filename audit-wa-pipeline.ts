import { getDb } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();

  const result = await db.execute(sql`
    SELECT 
      p.id,
      p.name,
      p.priority,
      p.discoveryStatus,
      p.sector,
      p.location,
      p.projectState,
      p.stage,
      p.stageCode,
      p.owner,
      p.value,
      p.capexGrade,
      p.opportunityRoute,
      p.actionTier,
      p.enrichmentBlockedReason,
      p.geoBlockedReason,
      p.lifecycleStatus,
      p.suppressed,
      (SELECT COUNT(*) FROM contacts c 
       JOIN contactProjects cp ON cp.contactId = c.id 
       WHERE cp.projectId = p.id AND c.contactTrustTier = 'send_ready') as sendReadyCount,
      (SELECT COUNT(*) FROM contacts c 
       JOIN contactProjects cp ON cp.contactId = c.id 
       WHERE cp.projectId = p.id AND c.contactTrustTier = 'named_unverified') as namedUnverifiedCount
    FROM projects p
    WHERE p.projectState = 'WA'
      AND p.priority IN ('hot', 'warm')
      AND p.lifecycleStatus = 'active'
      AND (p.suppressed IS NULL OR p.suppressed = 0)
      AND p.geoBlockedReason IS NULL
      AND p.id NOT IN (570024, 510033, 480054, 690075, 450043, 480010, 480072, 570022)
    ORDER BY 
      CASE p.priority WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 ELSE 3 END,
      CASE p.actionTier WHEN 'tier1_actionable' THEN 1 WHEN 'tier2_warm' THEN 2 ELSE 3 END,
      p.id
    LIMIT 20
  `);

  const data = (result as any)[0] as any[];
  console.log('WA hot/warm active projects NOT in the 8 enriched set:', data.length);
  for (const r of data) {
    console.log('ID:', r.id, '|', r.priority.toUpperCase(), '|', r.sector);
    console.log('  Name:', r.name);
    console.log('  Location:', r.location, '| State:', r.projectState);
    console.log('  Stage:', r.stage, '(' + r.stageCode + ')');
    console.log('  Owner:', r.owner);
    console.log('  Value:', r.value, '| Grade:', r.capexGrade);
    console.log('  Route:', r.opportunityRoute, '| ActionTier:', r.actionTier);
    console.log('  EnrichBlocked:', r.enrichmentBlockedReason || 'none');
    console.log('  Send-Ready:', r.sendReadyCount, '| Named UV:', r.namedUnverifiedCount);
  }

  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
