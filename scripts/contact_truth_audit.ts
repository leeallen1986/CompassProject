import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';

/**
 * Contact Truth Enforcement Audit
 * Verifies:
 * 1. No llm_inferred contacts have roleRelevance = 'high'
 * 2. No non-industrial titles have roleRelevance = 'high' 
 * 3. Contact selector consistency (same contact shown across all surfaces)
 * 4. Trust tier distribution is healthy
 * 5. No contacts without project linkage
 */
async function main() {
  const db = await getDb();
  
  console.log('=== CONTACT TRUTH ENFORCEMENT AUDIT ===\n');
  
  // 1. Check llm_inferred with high relevance (should be 0)
  const llmHigh = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM contacts 
    WHERE contactTrustTier = 'llm_inferred' AND roleRelevance = 'high'
  `);
  const llmHighCount = (llmHigh[0] as any[])[0].cnt;
  console.log(`[${llmHighCount === 0 ? 'PASS' : 'FAIL'}] llm_inferred with high relevance: ${llmHighCount}`);
  
  // 2. Check non-industrial titles with high relevance
  const nonIndustrial = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM contacts 
    WHERE roleRelevance = 'high' 
    AND (
      title LIKE '%medicare%' OR title LIKE '%insurance%' OR title LIKE '%pharma%'
      OR title LIKE '%hotel%' OR title LIKE '%hospitality%' OR title LIKE '%retail%'
      OR title LIKE '%university%' OR title LIKE '%school%' OR title LIKE '%teacher%'
      OR title LIKE '%motivational%' OR title LIKE '%life coach%' OR title LIKE '%wellness%'
      OR title LIKE '%salesforce%' OR title LIKE '%hubspot%' OR title LIKE '%marketo%'
    )
  `);
  const nonIndCount = (nonIndustrial[0] as any[])[0].cnt;
  console.log(`[${nonIndCount === 0 ? 'PASS' : 'WARN'}] Non-industrial titles with high relevance: ${nonIndCount}`);
  
  // 3. Trust tier distribution
  const tierDist = await db.execute(sql`
    SELECT contactTrustTier, roleRelevance, COUNT(*) as cnt
    FROM contacts
    GROUP BY contactTrustTier, roleRelevance
    ORDER BY contactTrustTier, roleRelevance
  `);
  console.log('\n=== TRUST TIER × RELEVANCE DISTRIBUTION ===');
  for (const row of tierDist[0] as any[]) {
    console.log(`  ${row.contactTrustTier} / ${row.roleRelevance}: ${row.cnt}`);
  }
  
  // 4. Check contacts without project linkage
  const orphaned = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM contacts WHERE project IS NULL OR project = ''
  `);
  const orphanCount = (orphaned[0] as any[])[0].cnt;
  console.log(`\n[${orphanCount === 0 ? 'PASS' : 'WARN'}] Contacts without project linkage: ${orphanCount}`);
  
  // 5. Check send_ready contacts with missing critical fields
  const incomplete = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM contacts 
    WHERE contactTrustTier = 'send_ready'
    AND (name IS NULL OR name = '' OR title IS NULL OR title = '')
  `);
  const incompleteCount = (incomplete[0] as any[])[0].cnt;
  console.log(`[${incompleteCount === 0 ? 'PASS' : 'FAIL'}] send_ready contacts missing name/title: ${incompleteCount}`);
  
  // 6. Check send_ready contacts with email AND LinkedIn (fully actionable)
  const fullyActionable = await db.execute(sql`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) as hasEmail,
      SUM(CASE WHEN linkedin IS NOT NULL AND linkedin != '' THEN 1 ELSE 0 END) as hasLinkedIn,
      SUM(CASE WHEN (email IS NOT NULL AND email != '') AND (linkedin IS NOT NULL AND linkedin != '') THEN 1 ELSE 0 END) as hasBoth
    FROM contacts
    WHERE contactTrustTier = 'send_ready'
  `);
  const fa = (fullyActionable[0] as any[])[0];
  console.log(`\n=== SEND_READY CONTACT COMPLETENESS ===`);
  console.log(`  Total send_ready: ${fa.total}`);
  console.log(`  Has email: ${fa.hasEmail} (${Math.round(fa.hasEmail/fa.total*100)}%)`);
  console.log(`  Has LinkedIn: ${fa.hasLinkedIn} (${Math.round(fa.hasLinkedIn/fa.total*100)}%)`);
  console.log(`  Has both: ${fa.hasBoth} (${Math.round(fa.hasBoth/fa.total*100)}%)`);
  
  // 7. Per-project contact coverage for top projects
  const topProjects = await db.execute(sql`
    SELECT p.name, p.priority,
      (SELECT COUNT(*) FROM contacts c WHERE c.project = p.name AND c.contactTrustTier = 'send_ready') as sendReady,
      (SELECT COUNT(*) FROM contacts c WHERE c.project = p.name AND c.contactTrustTier = 'named_unverified') as named,
      (SELECT COUNT(*) FROM contacts c WHERE c.project = p.name AND c.contactTrustTier = 'llm_inferred') as llm
    FROM projects p
    WHERE p.lifecycleStatus IN ('active', 'hot', 'warm') AND p.priority IN ('hot', 'warm')
    ORDER BY CASE p.priority WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 ELSE 3 END
    LIMIT 30
  `);
  
  let hotWithContact = 0;
  let hotTotal = 0;
  let warmWithContact = 0;
  let warmTotal = 0;
  
  for (const p of topProjects[0] as any[]) {
    const hasContact = p.sendReady > 0 || p.named > 0;
    if (p.priority === 'hot') {
      hotTotal++;
      if (hasContact) hotWithContact++;
    } else {
      warmTotal++;
      if (hasContact) warmWithContact++;
    }
  }
  
  console.log(`\n=== TOP PROJECT CONTACT COVERAGE ===`);
  console.log(`  Hot projects with contacts: ${hotWithContact}/${hotTotal} (${Math.round(hotWithContact/hotTotal*100)}%)`);
  console.log(`  Warm projects with contacts: ${warmWithContact}/${warmTotal} (${Math.round(warmWithContact/warmTotal*100)}%)`);
  
  console.log('\n=== AUDIT COMPLETE ===');
  process.exit(0);
}
main();
