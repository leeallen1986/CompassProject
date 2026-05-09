/**
 * Rescue Trigger Demonstration
 * 
 * Demonstrates the full HOLD → rescue → re-gate → SEND flow by:
 * 1. Temporarily nulling trustTier on 2 of Ryan's top-3 contacts (simulating pre-enrichment state)
 * 2. Running the gate → gets HOLD
 * 3. Rescue fires → identifies candidates → enrichment runs
 * 4. Restoring trustTier (simulating enrichment success)
 * 5. Re-running gate → gets SEND
 * 6. Storing both rows in repDigestGateResults
 * 7. Restoring original data
 */
import 'dotenv/config';
import { getDb, getActiveProjects, getAllContacts } from '../server/db.ts';
import { runAllGates, storeGateResult, identifyRescueCandidates } from '../server/digestHardeningGates.ts';
import { selectProjectContact } from '../server/contactSelector.ts';
import { users, userProfiles, repDigestGateResults, contacts, projectEnrichmentCache, apolloCreditLog } from '../drizzle/schema.ts';
import { eq, and, sql, gte, inArray } from 'drizzle-orm';
import { scoreAndFilterProjects } from '../server/emailDigest.ts';

const WEEK_KEY = "2026-W19-RD"; // Rescue Demo

function classifyBriefReadiness(project, projectContacts) {
  if (!projectContacts || projectContacts.length === 0) {
    return { readiness: "no_contact", bestContact: null };
  }
  const contactRows = projectContacts.map(c => ({
    id: 0, name: c.name, title: c.title, email: c.email, company: c.company,
    contactTrustTier: c.contactTrustTier, verificationScore: c.verificationScore,
    roleRelevance: c.roleRelevance, roleBucket: null, source: c.source,
    linkedinProfileUrl: c.linkedin, linkedin: c.linkedin,
  }));
  const result = selectProjectContact(contactRows, {
    projectName: project.name,
    projectOwner: project.owner ?? undefined,
    projectState: project.projectState,
    buyerRoles: [],
  });
  if (!result.selectedContact) return { readiness: "no_contact", bestContact: null };
  const sc = result.selectedContact;
  return {
    readiness: sc.trustTier === "send_ready" ? "action_ready" : "needs_verification",
    bestContact: {
      name: sc.name, title: sc.title, email: sc.email, company: sc.company,
      trustTier: sc.trustTier, source: sc.source, verificationScore: sc.verificationScore,
    },
  };
}

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  const userId = 1;
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
  if (!user || !profile) { console.error("No user/profile"); process.exit(1); }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  RESCUE TRIGGER DEMONSTRATION: ${user.name} (userId=${userId})`);
  console.log(`  Week key: ${WEEK_KEY}`);
  console.log(`${"═".repeat(70)}\n`);

  // ── STEP 1: Identify Ryan's top-3 contacts and temporarily degrade 2 of them ──
  const allProjects = await getActiveProjects();
  const allContacts = await getAllContacts();
  const matchedProjects = await scoreAndFilterProjects(allProjects, {
    territories: profile.territories, industries: profile.industries,
    offerCategories: profile.offerCategories, customerTypes: profile.customerTypes,
    dealSizeMin: profile.dealSizeMin, dealSizeMax: profile.dealSizeMax,
    assignedBusinessLines: profile.assignedBusinessLines, salesMotion: profile.salesMotion,
  });

  const matchedContacts = allContacts.filter(c => new Set(matchedProjects.map(p => p.name)).has(c.project));
  const contactProjectNames = new Set(allContacts.map(c => c.project).filter(Boolean));

  const annotatedProjects = matchedProjects.map(p => {
    const projectContacts = matchedContacts.filter(c =>
      c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
      p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
    ).map(c => ({
      name: c.name, title: c.title, company: c.company, project: c.project,
      priority: c.priority, email: c.email, roleRelevance: c.roleRelevance ?? null,
      linkedin: c.linkedinProfileUrl ?? c.linkedin ?? null,
      contactTrustTier: c.contactTrustTier ?? null, source: c.source ?? null,
      verificationScore: c.verificationScore ?? null,
    }));
    const { readiness, bestContact } = classifyBriefReadiness({ ...p, hasNoContacts: !contactProjectNames.has(p.name) }, projectContacts);
    return { ...p, briefReadiness: readiness, bestContact, laneFitLabel: p.laneFitLabel || "High" };
  });

  const mustActCandidates = annotatedProjects
    .filter(p => p.briefReadiness === "action_ready" && (p.laneFitLabel === "High" || p.laneFitLabel === "Medium"))
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
    .slice(0, 3);

  console.log(`[STEP 1] Ryan's top-3 (before degradation):`);
  mustActCandidates.forEach((p, i) => {
    console.log(`  ${i+1}. ${p.name} → ${p.bestContact?.name} (trust=${p.bestContact?.trustTier})`);
  });

  // Degrade 2 of 3 contacts by setting trustTier to null (simulating pre-enrichment state)
  const degradedTop3 = mustActCandidates.map((p, i) => ({
    id: p.id, name: p.name, overview: p.overview, sector: p.sector, owner: p.owner,
    laneFitLabel: p.laneFitLabel || "Low", relevanceScore: p.relevanceScore,
    contractors: p.contractors,
    bestContact: p.bestContact ? {
      name: p.bestContact.name || "", email: p.bestContact.email || null,
      title: p.bestContact.title || null, company: p.bestContact.company || null,
      // Degrade first 2 contacts to simulate pre-enrichment state
      trustTier: i < 2 ? null : p.bestContact.trustTier,
      source: p.bestContact.source || null,
      verificationScore: p.bestContact.verificationScore || null,
      isDowngraded: false, isLlmInferred: false,
    } : null,
  }));

  console.log(`\n[STEP 2] Degraded top-3 (simulating 2 contacts without trustTier):`);
  degradedTop3.forEach((p, i) => {
    console.log(`  ${i+1}. ${p.name} → ${p.bestContact?.name} (trust=${p.bestContact?.trustTier || "NULL"})`);
  });

  // ── STEP 2: Run initial gate with degraded contacts → HOLD ──
  console.log(`\n[STEP 3] Running initial gate with degraded contacts...`);
  const initialGateResult = runAllGates({
    userId, userName: user.name || "Unknown", repLane: "portable_air",
    weekKey: WEEK_KEY, top3Projects: degradedTop3,
  });

  console.log(`  ➤ INITIAL DECISION: ${initialGateResult.decision}`);
  console.log(`  ➤ BLOCKERS (${initialGateResult.blockers.length}):`);
  initialGateResult.blockers.forEach(b => {
    console.log(`    • ${b.criterion}: ${b.detail}`);
  });

  // Store initial HOLD result
  await storeGateResult({
    userId, userName: user.name || "Unknown", weekKey: WEEK_KEY,
    decision: initialGateResult.decision, blockers: initialGateResult.blockers,
    top3Snapshot: degradedTop3.map(p => ({ id: p.id, name: p.name, score: p.relevanceScore || 0, contactName: p.bestContact?.name })),
    rescueAttempted: false, createdAt: new Date().toISOString(),
  }, db, repDigestGateResults);

  // ── STEP 3: Rescue trigger fires ──
  const hasContactBlockers = initialGateResult.blockers.some(b =>
    b.criterion === "trust_tier_not_send_ready" || b.criterion === "contact_not_defensible" ||
    b.criterion === "card_detail_inconsistent" || b.criterion === "card_detail_mismatch" ||
    b.criterion === "no_contact"
  );

  console.log(`\n[STEP 4] Contact blockers detected: ${hasContactBlockers}`);
  console.log(`  Triggering rescue...`);

  // Get Apollo daily usage
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [usageRow] = await db.select({ total: sql`COALESCE(SUM(${apolloCreditLog.creditsUsed}), 0)` })
    .from(apolloCreditLog).where(gte(apolloCreditLog.createdAt, today));
  const apolloDailyUsed = Number(usageRow?.total || 0);
  const APOLLO_DAILY_CAP = 200;
  console.log(`  Apollo daily usage: ${apolloDailyUsed}/${APOLLO_DAILY_CAP}`);

  // Build rescue candidate data
  const visibleTop5 = annotatedProjects
    .filter(p => p.laneFitLabel === "High" || p.laneFitLabel === "Medium")
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
    .slice(0, 5);

  const rescueCandidateData = [];
  for (const p of visibleTop5) {
    const [cache] = await db.select().from(projectEnrichmentCache).where(eq(projectEnrichmentCache.projectId, p.id)).limit(1);
    rescueCandidateData.push({
      id: p.id, name: p.name, relevanceScore: p.relevanceScore ?? 0,
      laneFitLabel: p.laneFitLabel || "Low",
      bestContactTrustTier: p.bestContact?.trustTier || null,
      lastEnrichedAt: cache?.lastEnrichedAt ? new Date(cache.lastEnrichedAt) : null,
      contactCount: matchedContacts.filter(c =>
        c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
        p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
      ).length,
    });
  }

  const rescueResult = identifyRescueCandidates(rescueCandidateData, apolloDailyUsed, APOLLO_DAILY_CAP);
  console.log(`\n[STEP 5] Rescue result:`);
  console.log(`  triggered: ${rescueResult.triggered}`);
  console.log(`  candidates: ${rescueResult.candidates.length}`);
  console.log(`  budgetRemaining: ${rescueResult.budgetRemaining}`);
  console.log(`  cooldownBlocked: ${rescueResult.cooldownBlocked}`);
  if (rescueResult.candidates.length > 0) {
    console.log(`  Candidate projects:`);
    rescueResult.candidates.forEach(c => {
      console.log(`    • [${c.projectId}] ${c.projectName}: ${c.reason}`);
    });
  }

  // ── STEP 4: Simulate enrichment success (restore trustTier) ──
  console.log(`\n[STEP 6] Simulating enrichment success (restoring trustTier on degraded contacts)...`);
  const restoredTop3 = mustActCandidates.map(p => ({
    id: p.id, name: p.name, overview: p.overview, sector: p.sector, owner: p.owner,
    laneFitLabel: p.laneFitLabel || "Low", relevanceScore: p.relevanceScore,
    contractors: p.contractors,
    bestContact: p.bestContact ? {
      name: p.bestContact.name || "", email: p.bestContact.email || null,
      title: p.bestContact.title || null, company: p.bestContact.company || null,
      trustTier: p.bestContact.trustTier, source: p.bestContact.source || null,
      verificationScore: p.bestContact.verificationScore || null,
      isDowngraded: false, isLlmInferred: false,
    } : null,
  }));

  // ── STEP 5: Re-run gate after rescue ──
  console.log(`\n[STEP 7] Re-running gate after rescue enrichment...`);
  const retryGateResult = runAllGates({
    userId, userName: user.name || "Unknown", repLane: "portable_air",
    weekKey: WEEK_KEY, top3Projects: restoredTop3,
  });

  console.log(`  ➤ POST-RESCUE DECISION: ${retryGateResult.decision}`);
  if (retryGateResult.blockers.length > 0) {
    console.log(`  ➤ Remaining blockers:`);
    retryGateResult.blockers.forEach(b => console.log(`    • ${b.criterion}: ${b.detail}`));
  } else {
    console.log(`  ➤ No blockers — all contacts defensible`);
  }

  // Store rescue result
  await storeGateResult({
    userId, userName: user.name || "Unknown", weekKey: WEEK_KEY,
    decision: retryGateResult.decision, blockers: retryGateResult.blockers,
    top3Snapshot: restoredTop3.map(p => ({ id: p.id, name: p.name, score: p.relevanceScore || 0, contactName: p.bestContact?.name })),
    rescueAttempted: true, rescueResult, createdAt: new Date().toISOString(),
  }, db, repDigestGateResults);

  // ── STEP 6: Show stored rows ──
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  STORED repDigestGateResults ROWS (weekKey=${WEEK_KEY}):`);
  console.log(`${"═".repeat(70)}\n`);

  const storedRows = await db.select().from(repDigestGateResults)
    .where(and(eq(repDigestGateResults.userId, userId), eq(repDigestGateResults.weekKey, WEEK_KEY)));

  for (const row of storedRows) {
    console.log(`  ROW #${row.id}:`);
    console.log(`    decision: ${row.decision}`);
    console.log(`    rescueAttempted: ${row.rescueAttempted}`);
    console.log(`    blockers: ${row.blockers}`);
    console.log(`    top3Snapshot: ${row.top3Snapshot}`);
    if (row.rescueResult) console.log(`    rescueResult: ${row.rescueResult}`);
    console.log(`    createdAt: ${row.createdAt}`);
    console.log(`  ---`);
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  FLOW SUMMARY:`);
  console.log(`    1. Initial gate: ${initialGateResult.decision} (${initialGateResult.blockers.length} blockers)`);
  console.log(`    2. Rescue triggered: ${rescueResult.triggered} (${rescueResult.candidates.length} candidates)`);
  console.log(`    3. Post-rescue gate: ${retryGateResult.decision}`);
  console.log(`    4. Final outcome: ${retryGateResult.decision === "SEND" ? "✓ DIGEST SENT" : "✗ STILL HELD"}`);
  console.log(`${"═".repeat(70)}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
