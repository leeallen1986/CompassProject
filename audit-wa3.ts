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
      p.projectCountry,
      p.locationConfidence,
      p.geoBlockedReason,
      p.stage,
      p.stageCode,
      p.owner,
      p.contractors,
      p.value,
      p.capexGrade,
      p.tenderCloseDate,
      p.overview,
      p.equipmentSignals,
      p.opportunityRoute,
      p.lifecycleStatus,
      p.actionTier,
      p.enrichmentBlockedReason,
      (SELECT COUNT(*) FROM contacts c 
       JOIN contactProjects cp ON cp.contactId = c.id 
       WHERE cp.projectId = p.id AND c.contactTrustTier = 'send_ready') as sendReadyCount,
      (SELECT COUNT(*) FROM contacts c 
       JOIN contactProjects cp ON cp.contactId = c.id 
       WHERE cp.projectId = p.id AND c.contactTrustTier = 'named_unverified') as namedUnverifiedCount
    FROM projects p
    WHERE p.id IN (570024, 510033, 480054, 690075, 450043, 480010, 480072, 570022)
    ORDER BY FIELD(p.id, 570024, 510033, 480054, 690075, 450043, 480010, 480072, 570022)
  `);

  console.log('Result type:', typeof result, 'isArray:', Array.isArray(result));
  console.log('Result length:', (result as any).length);
  
  let rows: any[];
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0])) {
    rows = result[0] as any[];
    console.log('Format: [rows, fields] tuple, rows count:', rows.length);
  } else if (Array.isArray(result)) {
    rows = result as any[];
    console.log('Format: direct array, rows count:', rows.length);
  } else {
    rows = [];
    console.log('Unknown format');
  }

  if (rows.length > 0) {
    console.log('First row keys:', Object.keys(rows[0]));
    console.log('First row sample:', JSON.stringify(rows[0]).substring(0, 500));
  }

  for (const r of rows) {
    console.log('\n=== PROJECT ID:', r.id, '===');
    console.log('Name:', r.name);
    console.log('Priority:', r.priority);
    console.log('Status:', r.discoveryStatus);
    console.log('Sector:', r.sector);
    console.log('Location:', r.location);
    console.log('ProjectState:', r.projectState);
    console.log('ProjectCountry:', r.projectCountry);
    console.log('LocationConfidence:', r.locationConfidence);
    console.log('GeoBlockedReason:', r.geoBlockedReason);
    console.log('Stage:', r.stage);
    console.log('StageCode:', r.stageCode);
    console.log('Owner:', r.owner);
    console.log('Contractors:', typeof r.contractors === 'string' ? r.contractors.substring(0, 300) : JSON.stringify(r.contractors)?.substring(0, 300));
    console.log('Value:', r.value);
    console.log('CapexGrade:', r.capexGrade);
    console.log('TenderCloseDate:', r.tenderCloseDate);
    console.log('OpportunityRoute:', r.opportunityRoute);
    console.log('LifecycleStatus:', r.lifecycleStatus);
    console.log('ActionTier:', r.actionTier);
    console.log('EnrichmentBlocked:', r.enrichmentBlockedReason);
    console.log('Overview (first 400):', (r.overview || '').substring(0, 400));
    console.log('EquipmentSignals:', r.equipmentSignals);
    console.log('Send-Ready Contacts:', r.sendReadyCount);
    console.log('Named Unverified:', r.namedUnverifiedCount);
  }

  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
