import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();

  console.log('=== PART D: CONTACT INTEGRITY AUDIT ===\n');

  // 1. Trust tier distribution
  const [tiers] = await db.execute(sql.raw(`
    SELECT contactTrustTier, COUNT(*) as cnt 
    FROM contacts 
    GROUP BY contactTrustTier 
    ORDER BY cnt DESC
  `)) as any;
  console.log('TRUST TIER DISTRIBUTION:');
  for (const t of tiers) {
    console.log(`  ${t.contactTrustTier || 'NULL'}: ${t.cnt}`);
  }

  // 2. Contacts with email vs without
  const [emailStats] = await db.execute(sql.raw(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) as hasEmail,
      SUM(CASE WHEN linkedin IS NOT NULL AND linkedin != '' THEN 1 ELSE 0 END) as hasLinkedin,
      SUM(CASE WHEN email IS NOT NULL AND email != '' AND linkedin IS NOT NULL AND linkedin != '' THEN 1 ELSE 0 END) as hasBoth
    FROM contacts
  `)) as any;
  console.log('\nCONTACT COMPLETENESS:');
  console.log(`  Total: ${emailStats[0].total}`);
  console.log(`  Has email: ${emailStats[0].hasEmail} (${(emailStats[0].hasEmail/emailStats[0].total*100).toFixed(1)}%)`);
  console.log(`  Has LinkedIn: ${emailStats[0].hasLinkedin} (${(emailStats[0].hasLinkedin/emailStats[0].total*100).toFixed(1)}%)`);
  console.log(`  Has both: ${emailStats[0].hasBoth} (${(emailStats[0].hasBoth/emailStats[0].total*100).toFixed(1)}%)`);

  // 3. send_ready contacts - are they actually usable?
  const [sendReady] = await db.execute(sql.raw(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) as hasEmail,
      SUM(CASE WHEN linkedin IS NOT NULL AND linkedin != '' THEN 1 ELSE 0 END) as hasLinkedin,
      SUM(CASE WHEN name IS NOT NULL AND name != '' THEN 1 ELSE 0 END) as hasName,
      SUM(CASE WHEN title IS NOT NULL AND title != '' THEN 1 ELSE 0 END) as hasTitle
    FROM contacts
    WHERE contactTrustTier = 'send_ready'
  `)) as any;
  console.log('\nSEND_READY QUALITY:');
  console.log(`  Total send_ready: ${sendReady[0].total}`);
  console.log(`  Has email: ${sendReady[0].hasEmail} (${(sendReady[0].hasEmail/sendReady[0].total*100).toFixed(1)}%)`);
  console.log(`  Has LinkedIn: ${sendReady[0].hasLinkedin} (${(sendReady[0].hasLinkedin/sendReady[0].total*100).toFixed(1)}%)`);
  console.log(`  Has name: ${sendReady[0].hasName} (${(sendReady[0].hasName/sendReady[0].total*100).toFixed(1)}%)`);
  console.log(`  Has title: ${sendReady[0].hasTitle} (${(sendReady[0].hasTitle/sendReady[0].total*100).toFixed(1)}%)`);

  // 4. Sample of send_ready contacts — are they real people?
  const [sampleSendReady] = await db.execute(sql.raw(`
    SELECT name, title, company, email, linkedin, contactTrustTier, roleRelevance
    FROM contacts
    WHERE contactTrustTier = 'send_ready'
    ORDER BY RAND()
    LIMIT 15
  `)) as any;
  console.log('\nSAMPLE SEND_READY CONTACTS (random 15):');
  for (const c of sampleSendReady) {
    const emailDomain = c.email ? c.email.split('@')[1] : 'NO_EMAIL';
    console.log(`  ${c.name} | ${c.title} | ${c.company} | ${emailDomain} | LI:${c.linkedin ? 'YES' : 'NO'} | role:${c.roleRelevance || 'null'}`);
  }

  // 5. llm_inferred contacts — are they being shown to reps?
  const [llmInferred] = await db.execute(sql.raw(`
    SELECT c.name, c.title, c.company, c.email, c.contactTrustTier,
           cp.projectName
    FROM contacts c
    LEFT JOIN contactProjects cp ON cp.contactId = c.id
    WHERE c.contactTrustTier = 'llm_inferred'
    LIMIT 10
  `)) as any;
  console.log('\nSAMPLE LLM_INFERRED CONTACTS:');
  for (const c of llmInferred) {
    console.log(`  ${c.name} | ${c.title} | ${c.company} | tier:${c.contactTrustTier} | project:${c.projectName || 'NONE'}`);
  }

  // 6. Projects with contacts vs without
  const [projContacts] = await db.execute(sql.raw(`
    SELECT 
      COUNT(DISTINCT p.id) as totalProjects,
      COUNT(DISTINCT CASE WHEN cp.contactId IS NOT NULL THEN p.id END) as withContacts,
      COUNT(DISTINCT CASE WHEN cp.contactId IS NULL THEN p.id END) as withoutContacts
    FROM projects p
    LEFT JOIN contactProjects cp ON cp.projectId = p.id
    WHERE p.priority IN ('hot', 'warm')
  `)) as any;
  console.log('\nPROJECT CONTACT COVERAGE (hot+warm):');
  console.log(`  Total: ${projContacts[0].totalProjects}`);
  console.log(`  With contacts: ${projContacts[0].withContacts} (${(projContacts[0].withContacts/projContacts[0].totalProjects*100).toFixed(1)}%)`);
  console.log(`  Without contacts: ${projContacts[0].withoutContacts} (${(projContacts[0].withoutContacts/projContacts[0].totalProjects*100).toFixed(1)}%)`);

  // 7. Top projects by contact count
  const [topByContacts] = await db.execute(sql.raw(`
    SELECT p.name, p.priority, COUNT(cp.contactId) as contactCount
    FROM projects p
    JOIN contactProjects cp ON cp.projectId = p.id
    WHERE p.priority IN ('hot', 'warm')
    GROUP BY p.id, p.name, p.priority
    ORDER BY contactCount DESC
    LIMIT 10
  `)) as any;
  console.log('\nTOP 10 PROJECTS BY CONTACT COUNT:');
  for (const p of topByContacts) {
    console.log(`  [${p.priority}] ${p.name}: ${p.contactCount} contacts`);
  }

  // 8. Contacts per rep's top 5 projects (are reps seeing contacts or empty cards?)
  const [reps] = await db.execute(sql.raw(`
    SELECT u.id, u.name FROM users u
    JOIN userProfiles up ON up.userId = u.id
    WHERE up.isActive = 1
  `)) as any;
  
  console.log('\n=== REP-FACING CONTACT AVAILABILITY ===');
  for (const rep of reps.slice(0, 6)) {
    const [topProjects] = await db.execute(sql.raw(`
      SELECT p.id, p.name, 
        (SELECT COUNT(*) FROM contactProjects cp WHERE cp.projectId = p.id) as linkedContacts,
        (SELECT COUNT(*) FROM contactProjects cp 
         JOIN contacts c ON c.id = cp.contactId 
         WHERE cp.projectId = p.id AND c.contactTrustTier = 'send_ready') as sendReadyContacts
      FROM projects p
      WHERE p.priority IN ('hot', 'warm')
      ORDER BY p.priority ASC, p.id DESC
      LIMIT 5
    `)) as any;
    
    const hasContacts = topProjects.filter((p: any) => p.linkedContacts > 0).length;
    const hasSendReady = topProjects.filter((p: any) => p.sendReadyContacts > 0).length;
    console.log(`  ${rep.name}: ${hasContacts}/5 projects have contacts, ${hasSendReady}/5 have send_ready`);
  }

  process.exit(0);
}
main();
