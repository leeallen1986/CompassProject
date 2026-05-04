import 'dotenv/config';
import mysql from 'mysql2/promise';

const db = await mysql.createConnection(process.env.DATABASE_URL);

const DAYS = 14;
const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
console.log(`\n=== SOURCE-BY-SOURCE CONTACT DISCOVERY BREAKDOWN ===`);
console.log(`Period: last ${DAYS} days (since ${cutoff})\n`);

// ═══════════════════════════════════════════════════════════════
// 1. APOLLO
// ═══════════════════════════════════════════════════════════════
console.log("═══ 1. APOLLO ═══");

// Apollo credit log breakdown
const [apolloActions] = await db.execute(`
  SELECT action, COUNT(*) as cnt, COUNT(DISTINCT projectId) as projects
  FROM apolloCreditLog
  WHERE createdAt >= ?
  GROUP BY action
  ORDER BY cnt DESC
`, [cutoff]);
console.log("\nApollo actions (last 14d):");
console.table(apolloActions);

// Total credits spent
const [[apolloCredits]] = await db.execute(`
  SELECT SUM(creditsUsed) as totalCredits FROM apolloCreditLog WHERE createdAt >= ?
`, [cutoff]);
console.log(`Total Apollo credits spent: ${apolloCredits?.totalCredits || 0}`);

// Reveals with null contactId
const [[nullReveals]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM apolloCreditLog
  WHERE createdAt >= ? AND action = 'reveal' AND contactId IS NULL
`, [cutoff]);
console.log(`Reveals with null contactId: ${nullReveals.cnt}`);

// Duplicate reveals (same contact revealed more than once)
const [dupReveals] = await db.execute(`
  SELECT contactId, COUNT(*) as reveals
  FROM apolloCreditLog
  WHERE createdAt >= ? AND action = 'reveal' AND contactId IS NOT NULL
  GROUP BY contactId HAVING reveals > 1
  ORDER BY reveals DESC LIMIT 10
`, [cutoff]);
console.log(`\nDuplicate reveals (contactId revealed >1 time): ${dupReveals.length} contacts`);
if (dupReveals.length > 0) console.table(dupReveals.slice(0, 5));

// Apollo-sourced contacts saved in last 14d
const [[apolloSaved]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM contacts
  WHERE enrichmentSource = 'apollo' AND createdAt >= ?
`, [cutoff]);
console.log(`\nApollo contacts saved (new): ${apolloSaved.cnt}`);

// Apollo contacts with verified email
const [[apolloVerified]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM contacts
  WHERE enrichmentSource = 'apollo' AND createdAt >= ? AND email IS NOT NULL AND email != ''
`, [cutoff]);
console.log(`Apollo contacts with email: ${apolloVerified.cnt}`);

// Apollo contacts linked to projects
const [[apolloLinked]] = await db.execute(`
  SELECT COUNT(DISTINCT c.id) as cnt FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  WHERE c.enrichmentSource = 'apollo' AND c.createdAt >= ?
`, [cutoff]);
console.log(`Apollo contacts linked to projects: ${apolloLinked.cnt}`);

// ═══════════════════════════════════════════════════════════════
// 2. HUNTER
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ 2. HUNTER ═══");

// Check if there's a hunter log table
const [hunterTables] = await db.execute(`
  SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '%hunter%'
`);
console.log("Hunter-related tables:", hunterTables.map(t => t.TABLE_NAME));

// Check contacts sourced from hunter
const [[hunterContacts]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM contacts
  WHERE enrichmentSource LIKE '%hunter%' AND createdAt >= ?
`, [cutoff]);
console.log(`Hunter-sourced contacts (last 14d): ${hunterContacts.cnt}`);

// Check all enrichmentSource values to find hunter
const [allSources] = await db.execute(`
  SELECT enrichmentSource, COUNT(*) as cnt FROM contacts
  WHERE createdAt >= ?
  GROUP BY enrichmentSource ORDER BY cnt DESC
`, [cutoff]);
console.log("\nAll contact enrichmentSource values (last 14d):");
console.table(allSources);

// Check if hunter is referenced anywhere in contacts
const [[hunterAny]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM contacts
  WHERE enrichmentSource LIKE '%hunter%'
`);
console.log(`Contacts with enrichmentSource=hunter (all time): ${hunterAny.cnt}`);

// ═══════════════════════════════════════════════════════════════
// 3. WEB STAKEHOLDER DISCOVERY
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ 3. WEB STAKEHOLDER DISCOVERY ═══");

// Contacts from web_search / stakeholder_search
const [[webStakeholders]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM contacts
  WHERE (enrichmentSource LIKE '%web%' OR enrichmentSource LIKE '%stakeholder%' OR enrichmentSource = 'discovery_queue')
    AND createdAt >= ?
`, [cutoff]);
console.log(`Web/stakeholder discovery contacts (last 14d): ${webStakeholders.cnt}`);

// Named vs role-only
const [[webNamed]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM contacts
  WHERE (enrichmentSource LIKE '%web%' OR enrichmentSource LIKE '%stakeholder%' OR enrichmentSource = 'discovery_queue')
    AND createdAt >= ?
    AND name IS NOT NULL AND name != ''
    AND name NOT LIKE '%Manager%' AND name NOT LIKE '%Director%' AND name NOT LIKE '%Superintendent%'
    AND name NOT REGEXP '^[A-Z][a-z]+ [A-Z][a-z]+ (Manager|Director|Superintendent|Engineer|Supervisor)'
`, [cutoff]);
console.log(`Named stakeholders (real names): ${webNamed.cnt}`);

const [[webRoleOnly]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM contacts
  WHERE (enrichmentSource LIKE '%web%' OR enrichmentSource LIKE '%stakeholder%' OR enrichmentSource = 'discovery_queue')
    AND createdAt >= ?
    AND (name IS NULL OR name = '' OR name LIKE '%Manager%' OR name LIKE '%Director%' OR name LIKE '%Superintendent%')
`, [cutoff]);
console.log(`Role-only stakeholders (no real name): ${webRoleOnly.cnt}`);

// Linked to projects
const [[webLinked]] = await db.execute(`
  SELECT COUNT(DISTINCT c.id) as cnt FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  WHERE (c.enrichmentSource LIKE '%web%' OR c.enrichmentSource LIKE '%stakeholder%' OR c.enrichmentSource = 'discovery_queue')
    AND c.createdAt >= ?
`, [cutoff]);
console.log(`Web stakeholders linked to projects: ${webLinked.cnt}`);

// Discovery queue projects processed
const [[dqProcessed]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM projects
  WHERE discoveryStatus IN ('send_ready_contact', 'named_no_email', 'role_gap_only', 'no_contacts_found', 'discovery_failed')
    AND lastDiscoveryAt >= ?
`, [cutoff]);
console.log(`Discovery queue: projects processed (last 14d): ${dqProcessed.cnt}`);

// ═══════════════════════════════════════════════════════════════
// 4. CONTACT ENRICHMENT / LINKEDIN PATH
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ 4. CONTACT ENRICHMENT / LINKEDIN PATH ═══");

// Contacts processed by enrichment pipeline
const [[enrichProcessed]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM contacts
  WHERE enrichmentStatus = 'enriched' AND enrichedAt >= ?
`, [cutoff]);
console.log(`Contacts enriched (last 14d): ${enrichProcessed.cnt}`);

// Enriched with email
const [[enrichWithEmail]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM contacts
  WHERE enrichmentStatus = 'enriched' AND enrichedAt >= ?
    AND email IS NOT NULL AND email != ''
`, [cutoff]);
console.log(`Enriched with email: ${enrichWithEmail.cnt}`);

// Enriched and linked to projects
const [[enrichLinked]] = await db.execute(`
  SELECT COUNT(DISTINCT c.id) as cnt FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  WHERE c.enrichmentStatus = 'enriched' AND c.enrichedAt >= ?
`, [cutoff]);
console.log(`Enriched and linked to projects: ${enrichLinked.cnt}`);

// Enriched but orphan (no project link)
const [[enrichOrphan]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM contacts c
  LEFT JOIN contactProjects cp ON cp.contactId = c.id
  WHERE c.enrichmentStatus = 'enriched' AND c.enrichedAt >= ?
    AND cp.id IS NULL
`, [cutoff]);
console.log(`Enriched but orphan (no project link): ${enrichOrphan.cnt}`);

// LinkedIn-sourced contacts
const [[linkedinContacts]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM contacts
  WHERE enrichmentSource = 'linkedin'
    AND createdAt >= ?
`, [cutoff]);
console.log(`LinkedIn-sourced contacts (last 14d): ${linkedinContacts.cnt}`);

// ═══════════════════════════════════════════════════════════════
// 5. CONTRACTOR ENRICHMENT
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ 5. CONTRACTOR ENRICHMENT ═══");

// Check pipeline steps for contractor enrichment results
const [ceSteps] = await db.execute(`
  SELECT id, startedAt, status,
    JSON_EXTRACT(steps, '$[*]') as allSteps
  FROM pipelineRuns
  WHERE startedAt >= ?
  ORDER BY startedAt DESC
`, [cutoff]);

let ceTotal = 0, ceEnriched = 0, ceContractorsFound = 0;
for (const run of ceSteps) {
  try {
    const steps = JSON.parse(run.allSteps || '[]');
    // steps is array of arrays (one per step)
    const flat = Array.isArray(steps[0]) ? steps.flat() : steps;
    for (const s of flat) {
      if (s && s.name && s.name.includes('Contractor Enrichment Pass')) {
        if (s.result) {
          ceTotal += s.result.total || 0;
          ceEnriched += s.result.enriched || 0;
          ceContractorsFound += s.result.contractorsDiscovered || 0;
        }
      }
    }
  } catch {}
}
console.log(`Contractor Enrichment Pass (last 14d across all pipeline runs):`);
console.log(`  Projects processed: ${ceTotal}`);
console.log(`  Projects enriched: ${ceEnriched}`);
console.log(`  Contractors discovered: ${ceContractorsFound}`);

// Projects that gained contractors in last 14d
const [[newContractors]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM projects
  WHERE contractors IS NOT NULL AND JSON_LENGTH(contractors) > 0
    AND updatedAt >= ?
    AND JSON_EXTRACT(contractors, '$[0].name') != 'Unknown'
`, [cutoff]);
console.log(`Projects with non-Unknown contractors updated: ${newContractors.cnt}`);

// ═══════════════════════════════════════════════════════════════
// 6. SECOND-PASS CONTACT SEARCH
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ 6. SECOND-PASS CONTACT SEARCH ═══");

// Check pipeline steps for second pass results
let spProcessed = 0, spContacts = 0, spSendReady = 0;
for (const run of ceSteps) {
  try {
    const steps = JSON.parse(run.allSteps || '[]');
    const flat = Array.isArray(steps[0]) ? steps.flat() : steps;
    for (const s of flat) {
      if (s && s.name && (s.name.includes('Second-Pass') || s.name.includes('Second Pass'))) {
        if (s.result) {
          spProcessed += s.result.processed || s.result.projectsProcessed || 0;
          spContacts += s.result.contactsFound || s.result.contacts || 0;
          spSendReady += s.result.sendReady || s.result.newSendReady || 0;
        }
      }
    }
  } catch {}
}
console.log(`Second-Pass Contact Search (last 14d):`);
console.log(`  Projects processed: ${spProcessed}`);
console.log(`  Contacts produced: ${spContacts}`);
console.log(`  Send-ready outputs: ${spSendReady}`);

// Also check discovery queue results
let dqTotal = 0, dqSendReady = 0, dqNamedNoEmail = 0;
for (const run of ceSteps) {
  try {
    const steps = JSON.parse(run.allSteps || '[]');
    const flat = Array.isArray(steps[0]) ? steps.flat() : steps;
    for (const s of flat) {
      if (s && s.name && s.name.includes('Discovery Queue')) {
        if (s.result) {
          dqTotal += s.result.processed || 0;
          dqSendReady += s.result.newSendReady || 0;
          dqNamedNoEmail += s.result.newNamedNoEmail || 0;
        }
      }
    }
  } catch {}
}
console.log(`\nDiscovery Queue Processing (last 14d):`);
console.log(`  Projects processed: ${dqTotal}`);
console.log(`  New send-ready: ${dqSendReady}`);
console.log(`  Named-no-email: ${dqNamedNoEmail}`);

// ═══════════════════════════════════════════════════════════════
// OVERALL HEALTH METRICS
// ═══════════════════════════════════════════════════════════════
console.log("\n═══ OVERALL HEALTH METRICS ═══");

// Total send-ready contacts (all time vs last 14d)
const [[sendReadyAll]] = await db.execute(`
  SELECT COUNT(DISTINCT c.id) as cnt FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  WHERE c.email IS NOT NULL AND c.email != ''
    AND c.name IS NOT NULL AND c.name != ''
    AND c.enrichmentStatus = 'enriched'
`);
console.log(`Total send-ready contacts (all time, linked to projects): ${sendReadyAll.cnt}`);

const [[sendReady14d]] = await db.execute(`
  SELECT COUNT(DISTINCT c.id) as cnt FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  WHERE c.email IS NOT NULL AND c.email != ''
    AND c.name IS NOT NULL AND c.name != ''
    AND c.enrichmentStatus = 'enriched'
    AND c.createdAt >= ?
`, [cutoff]);
console.log(`Send-ready contacts created in last 14d: ${sendReady14d.cnt}`);

// Hot projects with send-ready contacts
const [[hotWithContact]] = await db.execute(`
  SELECT COUNT(DISTINCT p.id) as cnt FROM projects p
  JOIN contactProjects cp ON cp.projectId = p.id
  JOIN contacts c ON c.id = cp.contactId
  WHERE p.priority = 'hot'
    AND (p.lifecycleStatus = 'active' OR p.lifecycleStatus IS NULL)
    AND c.email IS NOT NULL AND c.email != ''
    AND c.name IS NOT NULL AND c.name != ''
    AND c.enrichmentStatus = 'enriched'
`);
const [[hotTotal]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM projects
  WHERE priority = 'hot' AND (lifecycleStatus = 'active' OR lifecycleStatus IS NULL)
`);
console.log(`Hot projects with send-ready contact: ${hotWithContact.cnt} / ${hotTotal.cnt} (${Math.round(hotWithContact.cnt/hotTotal.cnt*100)}%)`);

// Contacts found but lost (have email, enriched, but no project link)
const [[lostContacts]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM contacts c
  LEFT JOIN contactProjects cp ON cp.contactId = c.id
  WHERE c.email IS NOT NULL AND c.email != ''
    AND c.enrichmentStatus = 'enriched'
    AND cp.id IS NULL
`);
console.log(`Contacts with email + enriched but NO project link (lost): ${lostContacts.cnt}`);

// By enrichmentSource
const [lostBySource] = await db.execute(`
  SELECT c.enrichmentSource, COUNT(*) as cnt FROM contacts c
  LEFT JOIN contactProjects cp ON cp.contactId = c.id
  WHERE c.email IS NOT NULL AND c.email != ''
    AND c.enrichmentStatus = 'enriched'
    AND cp.id IS NULL
  GROUP BY c.enrichmentSource ORDER BY cnt DESC
`);
console.log("\nLost contacts by source:");
console.table(lostBySource);

await db.end();
console.log("\n=== AUDIT COMPLETE ===");
