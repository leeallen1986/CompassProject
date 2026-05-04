/**
 * Contact Discovery Funnel Audit — corrected for actual schema
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const db = await createConnection(process.env.DATABASE_URL);

// ── 1. Top 20 priority active projects ──────────────────────────────────────
const [top20] = await db.execute(`
  SELECT
    p.id,
    p.name as projectName,
    p.priority,
    p.discoveryPriority,
    p.discoveryStatus,
    p.discoveryAttempts,
    p.lastDiscoveryAt,
    p.owner as ownerCompany,
    p.contractors,
    p.stage,
    p.sector,
    p.projectState,
    p.projectType,
    p.suppressed,
    p.geoBlockedReason,
    p.matchedBusinessLines,
    p.capexGrade,
    p.lastActivityAt,
    p.createdAt,
    p.actionTier,
    p.lifecycleStatus
  FROM projects p
  WHERE p.suppressed = false
    AND (p.projectType = 'opportunity' OR p.projectType IS NULL)
    AND (p.geoBlockedReason IS NULL)
    AND p.matchedBusinessLines IS NOT NULL
    AND JSON_LENGTH(p.matchedBusinessLines) > 0
    AND (p.lifecycleStatus IS NULL OR p.lifecycleStatus NOT IN ('archived', 'stale'))
  ORDER BY
    FIELD(p.priority, 'hot', 'warm', 'cold'),
    FIELD(p.discoveryPriority, 'A', 'B', 'C'),
    FIELD(p.capexGrade, 'A', 'B', 'C', 'D'),
    p.lastActivityAt DESC
  LIMIT 20
`);

console.log("\n=== TOP 20 PRIORITY PROJECTS ===\n");
for (let i = 0; i < top20.length; i++) {
  const p = top20[i];
  const contractors = p.contractors ? JSON.parse(p.contractors) : [];
  const contractorNames = contractors.map(c => typeof c === 'string' ? c : c.name || c.company || JSON.stringify(c)).join('; ');
  console.log(`${i+1}. [${p.priority}/${p.discoveryPriority||'?'}] ID=${p.id} "${p.projectName?.substring(0,50)}"`);
  console.log(`   Owner: ${p.ownerCompany||'?'} | Contractors: ${contractorNames||'none'} | Stage: ${p.stage||'?'} | DiscStatus: ${p.discoveryStatus||'null'} | Attempts: ${p.discoveryAttempts||0}`);
}

// ── 2. Per-project contact funnel trace ─────────────────────────────────────
const projectIds = top20.map(p => p.id);
const idList = projectIds.join(",");

// All contacts linked to these projects (excluding manual/junk)
const [linkedContacts] = await db.execute(`
  SELECT
    cp.projectId,
    c.id as contactId,
    c.name,
    c.company,
    c.title,
    c.email,
    c.linkedin as linkedinUrl,
    c.enrichmentStatus,
    c.enrichmentSource,
    c.verificationScore,
    c.roleBucket,
    c.roleRelevance,
    c.source
  FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  WHERE cp.projectId IN (${idList})
    AND (c.enrichmentSource != 'manual' OR c.enrichmentSource IS NULL)
`);

const contactsByProject = {};
for (const c of linkedContacts) {
  if (!contactsByProject[c.projectId]) contactsByProject[c.projectId] = [];
  contactsByProject[c.projectId].push(c);
}

// Apollo credit usage per project (last 30 days)
const [apolloActivity] = await db.execute(`
  SELECT
    projectId,
    COUNT(*) as totalActions,
    SUM(creditsUsed) as totalCredits,
    MAX(createdAt) as lastActionAt
  FROM apolloCreditLog
  WHERE projectId IN (${idList})
  GROUP BY projectId
`);
const apolloByProject = {};
for (const a of apolloActivity) apolloByProject[a.projectId] = a;

// Enrichment cache per project
const [enrichCache] = await db.execute(`
  SELECT projectId, MAX(enrichedAt) as lastEnrichedAt, SUM(contactsFound) as totalFound, SUM(apiCallsMade) as totalApiCalls
  FROM projectEnrichmentCache
  WHERE projectId IN (${idList})
  GROUP BY projectId
`);
const enrichCacheByProject = {};
for (const e of enrichCache) enrichCacheByProject[e.projectId] = e;

// Funnel counts
const funnelCounts = {
  s1_exists: 0, s2_owner: 0, s3_contractor: 0, s4_route: 0,
  s5_role: 0, s6_apollo: 0, s7_reveal: 0, s8_saved: 0, s9_verified: 0, s10_linked: 0
};

const projectFunnels = [];

for (const p of top20) {
  const contacts = contactsByProject[p.id] || [];
  const apollo = apolloByProject[p.id] || null;
  const cache = enrichCacheByProject[p.id] || null;

  // Parse contractors JSON
  let contractors = [];
  try { contractors = p.contractors ? JSON.parse(p.contractors) : []; } catch(e) {}
  const contractorNames = contractors.map(c => typeof c === 'string' ? c : c.name || c.company || '').filter(Boolean);

  const hasOwner = !!(p.ownerCompany && p.ownerCompany.trim() && p.ownerCompany !== "Unknown" && p.ownerCompany !== "TBC");
  const hasContractor = contractorNames.length > 0;

  const ownerIsGov = p.ownerCompany && /government|council|department|authority|state|federal|shire|city of|minister|commission|transport for|roads and maritime|main roads/i.test(p.ownerCompany);
  const hasRouteToBuy = hasContractor || (hasOwner && !ownerIsGov);

  const hasRoleHypothesis = contacts.some(c => c.roleBucket && c.roleBucket !== "Unknown" && c.roleBucket !== "Other");
  const apolloAttempted = !!(apollo && apollo.totalActions > 0) || !!(cache && cache.totalApiCalls > 0);
  const revealAttempted = !!(apollo && apollo.totalCredits > 0);
  const contactSaved = contacts.length > 0;

  // Verified = enriched + has real email
  const verifiedContacts = contacts.filter(c =>
    c.enrichmentStatus === "enriched" &&
    c.email &&
    !c.email.includes("@unknown") &&
    !c.email.includes("placeholder") &&
    !c.email.includes("@example")
  );
  const contactVerified = verifiedContacts.length > 0;
  const contactLinked = contactSaved;

  // Send-ready: has email + enriched + high/medium role relevance
  const sendReadyContacts = contacts.filter(c =>
    c.email &&
    c.enrichmentStatus === "enriched" &&
    (c.roleRelevance === "high" || c.roleRelevance === "medium") &&
    !c.email.includes("@unknown") &&
    !c.email.includes("placeholder")
  );

  const namedNoEmail = contacts.filter(c => c.name && c.name !== "Unknown" && !c.email);
  const roleOnly = contacts.filter(c => !c.name || c.name === "Unknown" || c.name.startsWith("Role:"));

  funnelCounts.s1_exists++;
  if (hasOwner) funnelCounts.s2_owner++;
  if (hasContractor) funnelCounts.s3_contractor++;
  if (hasRouteToBuy) funnelCounts.s4_route++;
  if (hasRoleHypothesis) funnelCounts.s5_role++;
  if (apolloAttempted) funnelCounts.s6_apollo++;
  if (revealAttempted) funnelCounts.s7_reveal++;
  if (contactSaved) funnelCounts.s8_saved++;
  if (contactVerified) funnelCounts.s9_verified++;
  if (contactLinked) funnelCounts.s10_linked++;

  projectFunnels.push({
    id: p.id, name: p.projectName, priority: p.priority,
    discoveryPriority: p.discoveryPriority, discoveryStatus: p.discoveryStatus,
    discoveryAttempts: p.discoveryAttempts || 0, lastDiscoveryAt: p.lastDiscoveryAt,
    ownerCompany: p.ownerCompany, contractorNames, hasOwner, hasContractor,
    hasRouteToBuy, ownerIsGov, hasRoleHypothesis, apolloAttempted, revealAttempted,
    contactSaved, contactVerified, contactLinked,
    totalContacts: contacts.length, sendReadyCount: sendReadyContacts.length,
    namedNoEmailCount: namedNoEmail.length, roleOnlyCount: roleOnly.length,
    apolloActions: apollo?.totalActions || 0, apolloCredits: apollo?.totalCredits || 0,
    lastApolloAt: apollo?.lastActionAt || null,
    contacts, sendReadyContacts, namedNoEmail, roleOnly,
  });
}

// ── 3. Funnel drop-off ───────────────────────────────────────────────────────
console.log("\n\n=== FUNNEL DROP-OFF SUMMARY (top 20 projects) ===\n");
const n = 20;
const pct = v => `${v}/${n} (${Math.round(v/n*100)}%)`;
console.log(`Stage 1  — Project exists:                    ${pct(funnelCounts.s1_exists)}`);
console.log(`Stage 2  — Owner/account identified:          ${pct(funnelCounts.s2_owner)}`);
console.log(`Stage 3  — Contractor identified:             ${pct(funnelCounts.s3_contractor)}`);
console.log(`Stage 4  — Route-to-buy identified:           ${pct(funnelCounts.s4_route)}`);
console.log(`Stage 5  — Role hypothesis created:           ${pct(funnelCounts.s5_role)}`);
console.log(`Stage 6  — Apollo/search attempted:           ${pct(funnelCounts.s6_apollo)}`);
console.log(`Stage 7  — Reveal (email credit) attempted:   ${pct(funnelCounts.s7_reveal)}`);
console.log(`Stage 8  — Contact saved:                     ${pct(funnelCounts.s8_saved)}`);
console.log(`Stage 9  — Contact verified (enriched+email): ${pct(funnelCounts.s9_verified)}`);
console.log(`Stage 10 — Contact linked to project:         ${pct(funnelCounts.s10_linked)}`);

// ── 4. Coverage metrics ──────────────────────────────────────────────────────
const withSendReady = projectFunnels.filter(f => f.sendReadyCount > 0).length;
const withOnlyRoleGap = projectFunnels.filter(f => f.roleOnlyCount > 0 && f.sendReadyCount === 0 && f.namedNoEmailCount === 0).length;
const withNamedNoEmail = projectFunnels.filter(f => f.namedNoEmailCount > 0 && f.sendReadyCount === 0).length;
const withNoContacts = projectFunnels.filter(f => f.totalContacts === 0).length;
const withGovBlock = projectFunnels.filter(f => f.ownerIsGov && !f.hasContractor).length;
const withAttemptedNoResult = projectFunnels.filter(f => f.apolloAttempted && f.sendReadyCount === 0).length;

console.log("\n\n=== COVERAGE METRICS ===\n");
console.log(`Projects with ≥1 send-ready contact:                ${withSendReady}/${n} (${Math.round(withSendReady/n*100)}%)`);
console.log(`Projects with only role-gap (no named person):       ${withOnlyRoleGap}/${n} (${Math.round(withOnlyRoleGap/n*100)}%)`);
console.log(`Projects with named contact but no email:            ${withNamedNoEmail}/${n} (${Math.round(withNamedNoEmail/n*100)}%)`);
console.log(`Projects with zero contacts:                         ${withNoContacts}/${n} (${Math.round(withNoContacts/n*100)}%)`);
console.log(`Projects blocked by government owner (no contractor):${withGovBlock}/${n} (${Math.round(withGovBlock/n*100)}%)`);
console.log(`Projects where Apollo ran but still no send-ready:   ${withAttemptedNoResult}/${n} (${Math.round(withAttemptedNoResult/n*100)}%)`);

// ── 5. Per-project detail ────────────────────────────────────────────────────
console.log("\n\n=== PER-PROJECT FUNNEL DETAIL ===\n");
const yn = v => v ? "Y" : "N";
console.log(`${"#".padEnd(3)} ${"Pri".padEnd(5)} ${"DP".padEnd(4)} ${"Own".padEnd(4)} ${"Ctr".padEnd(4)} ${"Rte".padEnd(4)} ${"Rol".padEnd(4)} ${"Apl".padEnd(4)} ${"Rev".padEnd(4)} ${"Svd".padEnd(4)} ${"Vrf".padEnd(4)} ${"SR".padEnd(4)} ${"NE".padEnd(4)} ${"RO".padEnd(4)} ${"Att".padEnd(4)} ${"Status".padEnd(28)} ${"Name"}`);
console.log("-".repeat(160));
for (let i = 0; i < projectFunnels.length; i++) {
  const f = projectFunnels[i];
  console.log(
    `${String(i+1).padEnd(3)} ${(f.priority||"?").padEnd(5)} ${(f.discoveryPriority||"?").padEnd(4)} ` +
    `${yn(f.hasOwner).padEnd(4)} ${yn(f.hasContractor).padEnd(4)} ${yn(f.hasRouteToBuy).padEnd(4)} ${yn(f.hasRoleHypothesis).padEnd(4)} ` +
    `${yn(f.apolloAttempted).padEnd(4)} ${yn(f.revealAttempted).padEnd(4)} ${yn(f.contactSaved).padEnd(4)} ${yn(f.contactVerified).padEnd(4)} ` +
    `${String(f.sendReadyCount).padEnd(4)} ${String(f.namedNoEmailCount).padEnd(4)} ${String(f.roleOnlyCount).padEnd(4)} ${String(f.discoveryAttempts).padEnd(4)} ` +
    `${(f.discoveryStatus||"null").padEnd(28)} ${(f.name||"").substring(0,50)}`
  );
}
console.log("Columns: Pri=priority, DP=discoveryPriority, Own=hasOwner, Ctr=hasContractor, Rte=hasRouteToBuy, Rol=hasRoleHypothesis, Apl=apolloAttempted, Rev=revealAttempted, Svd=contactSaved, Vrf=contactVerified, SR=sendReady, NE=namedNoEmail, RO=roleOnly, Att=discoveryAttempts");

// ── 6. Zero-contact projects detail ─────────────────────────────────────────
console.log("\n\n=== ZERO-CONTACT PROJECTS (top 20) ===\n");
for (const f of projectFunnels) {
  if (f.totalContacts === 0) {
    console.log(`  [${f.priority}/${f.discoveryPriority}] ID=${f.id} "${f.name?.substring(0,50)}"`);
    console.log(`    Owner: ${f.ownerCompany||"?"} | Contractors: ${f.contractorNames.join('; ')||"none"}`);
    console.log(`    DiscStatus: ${f.discoveryStatus} | Attempts: ${f.discoveryAttempts} | GovBlock: ${f.ownerIsGov} | HasRoute: ${f.hasRouteToBuy}`);
  }
}

// ── 7. Send-ready contact detail ─────────────────────────────────────────────
console.log("\n\n=== SEND-READY CONTACTS (top 20 projects) ===\n");
for (const f of projectFunnels) {
  if (f.sendReadyCount > 0) {
    console.log(`[${f.priority}/${f.discoveryPriority}] ID=${f.id} "${f.name?.substring(0,50)}" — ${f.sendReadyCount} send-ready:`);
    for (const c of f.sendReadyContacts) {
      console.log(`  - ${c.name} | ${c.title} | ${c.email} | relevance=${c.roleRelevance} | source=${c.enrichmentSource}`);
    }
  }
}

// ── 8. Named-no-email contacts ───────────────────────────────────────────────
console.log("\n\n=== NAMED-NO-EMAIL CONTACTS (top 20 projects) ===\n");
for (const f of projectFunnels) {
  if (f.namedNoEmailCount > 0) {
    console.log(`[${f.priority}/${f.discoveryPriority}] ID=${f.id} "${f.name?.substring(0,50)}" — ${f.namedNoEmailCount} named, no email:`);
    for (const c of f.namedNoEmail) {
      console.log(`  - ${c.name} | ${c.title} | source=${c.enrichmentSource} | enrichStatus=${c.enrichmentStatus}`);
    }
  }
}

// ── 9. Apollo credit usage (last 7 days) ────────────────────────────────────
console.log("\n\n=== APOLLO CREDIT LOG (last 7 days) ===\n");

const [apolloLast7] = await db.execute(`
  SELECT
    COUNT(*) as totalActions,
    SUM(creditsUsed) as totalCredits,
    COUNT(DISTINCT projectId) as distinctProjects,
    COUNT(DISTINCT contactId) as distinctContacts,
    SUM(CASE WHEN creditsUsed > 0 THEN 1 ELSE 0 END) as revealActions,
    SUM(CASE WHEN creditsUsed = 0 THEN 1 ELSE 0 END) as searchActions
  FROM apolloCreditLog
  WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
`);
console.log("Last 7 days totals:", JSON.stringify(apolloLast7[0], null, 2));

// Repeated project searches
const [apolloDupes] = await db.execute(`
  SELECT
    projectId,
    projectName,
    COUNT(*) as actionCount,
    SUM(creditsUsed) as totalCredits,
    MIN(createdAt) as firstAction,
    MAX(createdAt) as lastAction
  FROM apolloCreditLog
  WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
  GROUP BY projectId, projectName
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC
  LIMIT 15
`);
console.log("\nRepeated project actions (last 7 days):");
for (const d of apolloDupes) {
  console.log(`  ${d.actionCount}x project ${d.projectId} "${d.projectName?.substring(0,40)}" — ${d.totalCredits} credits`);
}

// Apollo actions by day
const [apolloByDay] = await db.execute(`
  SELECT
    DATE(createdAt) as day,
    COUNT(*) as actions,
    SUM(creditsUsed) as credits,
    COUNT(DISTINCT projectId) as projects
  FROM apolloCreditLog
  WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 14 DAY)
  GROUP BY DATE(createdAt)
  ORDER BY day DESC
`);
console.log("\nApollo actions by day (last 14 days):");
for (const r of apolloByDay) {
  console.log(`  ${r.day}: ${r.actions} actions, ${r.credits} credits, ${r.projects} projects`);
}

// ── 10. Orphan contacts ──────────────────────────────────────────────────────
console.log("\n\n=== ORPHAN CONTACTS ===\n");

const [orphanStats] = await db.execute(`
  SELECT
    COUNT(*) as totalContacts,
    SUM(CASE WHEN cp.contactId IS NULL THEN 1 ELSE 0 END) as orphanContacts,
    SUM(CASE WHEN cp.contactId IS NOT NULL THEN 1 ELSE 0 END) as linkedContacts,
    SUM(CASE WHEN c.email IS NOT NULL AND c.enrichmentStatus = 'enriched' AND cp.contactId IS NOT NULL THEN 1 ELSE 0 END) as linkedEnrichedWithEmail,
    SUM(CASE WHEN c.email IS NOT NULL AND c.enrichmentStatus = 'enriched' AND cp.contactId IS NULL THEN 1 ELSE 0 END) as orphanEnrichedWithEmail
  FROM contacts c
  LEFT JOIN contactProjects cp ON cp.contactId = c.id
`);
console.log("Contact linkage:", JSON.stringify(orphanStats[0], null, 2));

// ── 11. Discovery status distribution (all active projects) ─────────────────
console.log("\n\n=== DISCOVERY STATUS DISTRIBUTION (all active AU opportunity projects) ===\n");

const [discStatusDist] = await db.execute(`
  SELECT
    COALESCE(discoveryStatus, 'null/unset') as discoveryStatus,
    COUNT(*) as total,
    SUM(CASE WHEN priority = 'hot' THEN 1 ELSE 0 END) as hot,
    SUM(CASE WHEN priority = 'warm' THEN 1 ELSE 0 END) as warm,
    SUM(CASE WHEN priority = 'cold' THEN 1 ELSE 0 END) as cold
  FROM projects
  WHERE suppressed = false
    AND (projectType = 'opportunity' OR projectType IS NULL)
    AND (geoBlockedReason IS NULL)
    AND matchedBusinessLines IS NOT NULL
    AND JSON_LENGTH(matchedBusinessLines) > 0
    AND (lifecycleStatus IS NULL OR lifecycleStatus NOT IN ('archived', 'stale'))
  GROUP BY discoveryStatus
  ORDER BY total DESC
`);
console.log(`${"Status".padEnd(35)} ${"Total".padEnd(8)} ${"Hot".padEnd(6)} ${"Warm".padEnd(6)} ${"Cold"}`);
console.log("-".repeat(60));
let grandTotal = 0;
for (const row of discStatusDist) {
  grandTotal += Number(row.total);
  console.log(`${row.discoveryStatus.padEnd(35)} ${String(row.total).padEnd(8)} ${String(row.hot).padEnd(6)} ${String(row.warm).padEnd(6)} ${row.cold}`);
}
console.log(`${"TOTAL".padEnd(35)} ${String(grandTotal).padEnd(8)}`);

// ── 12. Discovery queue eligibility right now ────────────────────────────────
console.log("\n\n=== DISCOVERY QUEUE ELIGIBILITY RIGHT NOW ===\n");

const [queueEligible] = await db.execute(`
  SELECT
    COALESCE(discoveryStatus, 'null/unset') as discoveryStatus,
    COUNT(*) as total,
    SUM(CASE WHEN priority = 'hot' THEN 1 ELSE 0 END) as hot,
    SUM(CASE WHEN priority = 'warm' THEN 1 ELSE 0 END) as warm,
    SUM(CASE WHEN discoveryAttempts >= 3 THEN 1 ELSE 0 END) as exhausted,
    SUM(CASE WHEN lastDiscoveryAt IS NULL OR lastDiscoveryAt < DATE_SUB(NOW(), INTERVAL 72 HOUR) THEN 1 ELSE 0 END) as cooldownOk
  FROM projects
  WHERE discoveryStatus IN ('no_contacts', 'discovery_queued', 'role_only', 'named_contact_no_email')
    AND (geoBlockedReason IS NULL)
    AND (projectCountry = 'AU' OR projectCountry IS NULL)
    AND (suppressed = false OR suppressed IS NULL)
    AND (projectType = 'opportunity' OR projectType IS NULL)
    AND matchedBusinessLines IS NOT NULL
    AND JSON_LENGTH(matchedBusinessLines) > 0
    AND (lifecycleStatus IS NULL OR lifecycleStatus NOT IN ('archived', 'stale'))
  GROUP BY discoveryStatus
`);
for (const r of queueEligible) {
  console.log(`  ${r.discoveryStatus.padEnd(30)} total=${r.total}, hot=${r.hot}, warm=${r.warm}, exhausted=${r.exhausted}, cooldownOk=${r.cooldownOk}`);
}

const [queueTotal] = await db.execute(`
  SELECT COUNT(*) as eligible
  FROM projects
  WHERE discoveryStatus IN ('no_contacts', 'discovery_queued', 'role_only', 'named_contact_no_email')
    AND (geoBlockedReason IS NULL)
    AND (projectCountry = 'AU' OR projectCountry IS NULL)
    AND (suppressed = false OR suppressed IS NULL)
    AND (projectType = 'opportunity' OR projectType IS NULL)
    AND matchedBusinessLines IS NOT NULL
    AND JSON_LENGTH(matchedBusinessLines) > 0
    AND (discoveryAttempts < 3 OR discoveryAttempts IS NULL)
    AND (lastDiscoveryAt IS NULL OR lastDiscoveryAt < DATE_SUB(NOW(), INTERVAL 72 HOUR))
    AND (lifecycleStatus IS NULL OR lifecycleStatus NOT IN ('archived', 'stale'))
`);
console.log(`\nTotal immediately eligible for queue processing: ${queueTotal[0].eligible}`);

// ── 13. Exhausted attempts ───────────────────────────────────────────────────
console.log("\n\n=== PROJECTS WITH EXHAUSTED DISCOVERY ATTEMPTS (≥3) ===\n");

const [exhausted] = await db.execute(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN priority = 'hot' THEN 1 ELSE 0 END) as hot,
    SUM(CASE WHEN priority = 'warm' THEN 1 ELSE 0 END) as warm,
    SUM(CASE WHEN discoveryStatus = 'no_contacts' THEN 1 ELSE 0 END) as stillNoContacts,
    SUM(CASE WHEN discoveryStatus = 'role_only' THEN 1 ELSE 0 END) as roleOnly,
    SUM(CASE WHEN discoveryStatus = 'named_contact_no_email' THEN 1 ELSE 0 END) as namedNoEmail
  FROM projects
  WHERE discoveryAttempts >= 3
    AND suppressed = false
    AND (projectType = 'opportunity' OR projectType IS NULL)
    AND (geoBlockedReason IS NULL)
    AND (lifecycleStatus IS NULL OR lifecycleStatus NOT IN ('archived', 'stale'))
`);
console.log("Exhausted attempts:", JSON.stringify(exhausted[0], null, 2));

// ── 14. Recent pipeline runs ─────────────────────────────────────────────────
console.log("\n\n=== RECENT PIPELINE RUNS ===\n");

const [recentRuns] = await db.execute(`
  SELECT id, status, startedAt, completedAt, projectsCreated, contactsEnriched, apolloCreditsUsed, currentStep, lastActivityNote
  FROM pipelineRuns
  ORDER BY startedAt DESC
  LIMIT 10
`);
console.log(`${"ID".padEnd(10)} ${"Status".padEnd(12)} ${"Started".padEnd(22)} ${"Projects".padEnd(10)} ${"Contacts".padEnd(10)} ${"Apollo$".padEnd(9)} ${"Note"}`);
console.log("-".repeat(120));
for (const r of recentRuns) {
  const started = r.startedAt ? new Date(r.startedAt).toISOString().substring(0,19) : "—";
  console.log(`${String(r.id).padEnd(10)} ${(r.status||"?").padEnd(12)} ${started.padEnd(22)} ${String(r.projectsCreated||0).padEnd(10)} ${String(r.contactsEnriched||0).padEnd(10)} ${String(r.apolloCreditsUsed||0).padEnd(9)} ${(r.lastActivityNote||"").substring(0,60)}`);
}

// ── 15. Contact enrichment status breakdown ──────────────────────────────────
console.log("\n\n=== CONTACT ENRICHMENT STATUS BREAKDOWN ===\n");

const [enrichStats] = await db.execute(`
  SELECT
    COALESCE(enrichmentStatus, 'null/pending') as enrichmentStatus,
    COALESCE(enrichmentSource, 'null') as enrichmentSource,
    COUNT(*) as count,
    SUM(CASE WHEN email IS NOT NULL THEN 1 ELSE 0 END) as withEmail,
    SUM(CASE WHEN linkedin IS NOT NULL THEN 1 ELSE 0 END) as withLinkedIn
  FROM contacts
  GROUP BY enrichmentStatus, enrichmentSource
  ORDER BY count DESC
  LIMIT 30
`);
console.log(`${"Status".padEnd(18)} ${"Source".padEnd(22)} ${"Count".padEnd(8)} ${"WithEmail".padEnd(12)} ${"WithLinkedIn"}`);
console.log("-".repeat(70));
for (const r of enrichStats) {
  console.log(`${r.enrichmentStatus.padEnd(18)} ${r.enrichmentSource.padEnd(22)} ${String(r.count).padEnd(8)} ${String(r.withEmail).padEnd(12)} ${r.withLinkedIn}`);
}

// ── 16. [object Object] bug check ───────────────────────────────────────────
console.log("\n\n=== [object Object] BUG CHECK ===\n");

// Check contacts table for object-stringified data
const [objObjContacts] = await db.execute(`
  SELECT COUNT(*) as count FROM contacts
  WHERE name LIKE '%[object%' OR title LIKE '%[object%' OR company LIKE '%[object%'
`);
console.log("Contacts with [object...] in name/title/company:", objObjContacts[0]);

// Check projects for contactGaps or similar fields
const [projCols] = await db.execute("DESCRIBE projects");
const projColNames = projCols.map(c => c.Field);
const hasContactGaps = projColNames.includes('contactGaps');
console.log("Projects table has contactGaps column:", hasContactGaps);
if (hasContactGaps) {
  const [objObjProj] = await db.execute(`SELECT COUNT(*) as count FROM projects WHERE contactGaps LIKE '%[object Object]%'`);
  console.log("Projects with [object Object] in contactGaps:", objObjProj[0]);
}

// Check if opportunityRoute or equipmentSignals has object-stringified data
const [objObjRoute] = await db.execute(`
  SELECT COUNT(*) as count FROM projects
  WHERE opportunityRoute LIKE '%[object Object]%'
     OR equipmentSignals LIKE '%[object Object]%'
`);
console.log("Projects with [object Object] in opportunityRoute/equipmentSignals:", objObjRoute[0]);

// ── 17. Is discovery part of standard daily pipeline? ───────────────────────
console.log("\n\n=== PIPELINE STEP ANALYSIS: DISCOVERY STEPS ===\n");

const [pipelineSteps] = await db.execute(`
  SELECT id, startedAt, steps
  FROM pipelineRuns
  WHERE status = 'completed'
  ORDER BY startedAt DESC
  LIMIT 3
`);

for (const run of pipelineSteps) {
  console.log(`\nRun ${run.id} (${run.startedAt?.toISOString?.()?.substring(0,10)}):`);
  try {
    const steps = JSON.parse(run.steps || '[]');
    for (const s of steps) {
      const isDiscovery = /enrich|discover|apollo|hunter|contact|second.pass|contractor.enrich|discovery.queue/i.test(s.name);
      if (isDiscovery) {
        console.log(`  ${s.name.padEnd(35)} status=${s.status.padEnd(12)} counts=${JSON.stringify(s.counts||{})}`);
      }
    }
  } catch(e) {
    console.log("  (could not parse steps)");
  }
}

await db.end();
console.log("\n=== AUDIT COMPLETE ===\n");
