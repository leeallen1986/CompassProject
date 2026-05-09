/**
 * End-to-end rescue trigger demonstration.
 * Simulates a real scheduled-run scenario for Ryan where:
 * 1. Initial gate = HOLD (contact degraded)
 * 2. Rescue trigger fires
 * 3. Enrichment restores the contact
 * 4. Re-gate = SEND
 * 5. Stored repDigestGateResults row shown
 */
import 'dotenv/config';
import { getDb, getActiveProjects, getAllContacts } from '../server/db.ts';
import { runAllGates, identifyRescueCandidates, storeGateResult } from '../server/digestHardeningGates.ts';
import { selectProjectContact } from '../server/contactSelector.ts';
import { scoreAndFilterProjects } from '../server/emailDigest.ts';
import { users, userProfiles, contacts, repDigestGateResults } from '../drizzle/schema.ts';
import { eq, and, like, desc } from 'drizzle-orm';

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

function buildAnnotatedProjects(matchedProjects, allContacts) {
  const contactProjectNames = new Set(allContacts.map(c => c.project).filter(Boolean));
  const matchedProjectNames = new Set(matchedProjects.map(p => p.name));
  const matchedContacts = allContacts.filter(c => matchedProjectNames.has(c.project));
  
  return matchedProjects.map(p => {
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
    const { readiness, bestContact } = classifyBriefReadiness(
      { ...p, hasNoContacts: !contactProjectNames.has(p.name) }, projectContacts
    );
    return { ...p, briefReadiness: readiness, bestContact, laneFitLabel: p.laneFitLabel || "High" };
  });
}

function buildGateTop3(annotatedProjects) {
  const mustAct = annotatedProjects
    .filter(p => p.briefReadiness === "action_ready" && (p.laneFitLabel === "High" || p.laneFitLabel === "Medium"))
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
    .slice(0, 3);
  return mustAct.map(p => ({
    id: p.id, name: p.name, overview: p.overview, sector: p.sector, owner: p.owner,
    laneFitLabel: p.laneFitLabel || "Low", relevanceScore: p.relevanceScore,
    contractors: p.contractors,
    bestContact: p.bestContact ? {
      name: p.bestContact.name || "", email: p.bestContact.email || null,
      title: p.bestContact.title || null, company: p.bestContact.company || null,
      trustTier: p.bestContact.trustTier || null, source: p.bestContact.source || null,
      verificationScore: p.bestContact.verificationScore || null,
      isDowngraded: false, isLlmInferred: false,
    } : null,
  }));
}

async function main() {
  const db = await getDb();
  const RYAN_ID = 2340043;
  const WEEK_KEY = "2026-W19-E2E";
  
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  END-TO-END RESCUE TRIGGER DEMONSTRATION — Ryan Vella (WA, PA)     ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝\n");
  
  // Get profile
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, RYAN_ID));
  
  // === STEP 1: Degrade MULTIPLE contacts to force a HOLD scenario ===
  // Ryan has 5+ action_ready projects, so we need to degrade enough to leave < 3
  console.log("━━━ STEP 1: Degrade contacts to simulate HOLD scenario ━━━");
  const degradeTargets = [
    { email: "sam.leszczynski@qube.com.au", project: "%Bass Strait%" },
    { email: "diego.linares@worley.com", project: "%Walyering%" },
    { email: "peter.tyrrell@genesisminerals.com.au", project: "%Genesis%" },
    { email: "troy.morris@byrnecut.com.au", project: "%Norseman%" },
  ];
  for (const t of degradeTargets) {
    await db.update(contacts)
      .set({ contactTrustTier: "llm_inferred" })
      .where(and(eq(contacts.email, t.email), like(contacts.project, t.project)));
    console.log(`  Degraded: ${t.email}`);
  }
  console.log(`  ✓ ${degradeTargets.length} contacts degraded to llm_inferred\n`);
  
  // === STEP 2: Run initial gate ===
  console.log("━━━ STEP 2: Run initial gate (should HOLD) ━━━");
  let allContacts_now = await getAllContacts();
  const allProjects = await getActiveProjects();
  const matchedProjects = await scoreAndFilterProjects(allProjects, {
    territories: profile.territories, industries: profile.industries,
    offerCategories: profile.offerCategories, customerTypes: profile.customerTypes,
    dealSizeMin: profile.dealSizeMin, dealSizeMax: profile.dealSizeMax,
    assignedBusinessLines: profile.assignedBusinessLines, salesMotion: profile.salesMotion,
  });
  
  let annotated = buildAnnotatedProjects(matchedProjects, allContacts_now);
  let gateTop3 = buildGateTop3(annotated);
  
  const initialGate = runAllGates({
    userId: RYAN_ID, userName: "Ryan Vella", repLane: "portable_air",
    weekKey: WEEK_KEY, top3Projects: gateTop3,
  });
  
  console.log(`  Decision: ${initialGate.decision}`);
  console.log(`  Top-3 projects:`);
  gateTop3.forEach((p, i) => {
    console.log(`    ${i+1}. ${p.name} — ${p.bestContact?.name || "NONE"} (${p.bestContact?.trustTier || "N/A"})`);
  });
  if (initialGate.blockers.length > 0) {
    console.log(`  Blockers:`);
    initialGate.blockers.forEach(b => console.log(`    • ${b.criterion}: ${b.detail}`));
  }
  console.log("");
  
  // === STEP 3: Rescue trigger fires ===
  console.log("━━━ STEP 3: Rescue trigger evaluation ━━━");
  const hasContactBlockers = initialGate.blockers.some(b => 
    ["trust_tier_not_send_ready", "contact_not_defensible", "card_detail_inconsistent", "no_email_or_domain", "card_detail_mismatch"].includes(b.criterion)
  );
  console.log(`  Has contact-related blockers: ${hasContactBlockers}`);
  
  if (hasContactBlockers && initialGate.decision === "HOLD") {
    // Build rescue input
    const visibleProjects = annotated
      .filter(p => p.laneFitLabel === "High" || p.laneFitLabel === "Medium")
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, 5);
    
    const rescueInput = visibleProjects.map(p => ({
      projectId: p.id,
      projectName: p.name,
      contactCount: allContacts_now.filter(c => c.project === p.name).length,
      hasSendReady: allContacts_now.filter(c => c.project === p.name && c.contactTrustTier === "send_ready").length > 0,
      lastEnrichedAt: null,
    }));
    
    const rescueResult = identifyRescueCandidates({
      projects: rescueInput,
      apolloDailyUsed: 16,
      apolloDailyCap: 200,
      cooldownDays: 7,
    });
    
    console.log(`  Rescue triggered: ${rescueResult.triggered}`);
    console.log(`  Candidates: ${rescueResult.candidates.length}`);
    rescueResult.candidates.forEach(c => console.log(`    → ${c.projectName} (id=${c.projectId})`));
    console.log(`  Budget remaining: ${rescueResult.budgetRemaining}`);
    console.log(`  Cooldown blocked: ${rescueResult.cooldownBlocked}`);
    console.log("");
    
    // === STEP 4: Simulate enrichment (restore contacts for rescue candidates) ===
    console.log("━━━ STEP 4: Enrichment (restoring contacts to simulate Apollo success) ━━━");
    for (const t of degradeTargets) {
      await db.update(contacts)
        .set({ contactTrustTier: "send_ready" })
        .where(and(eq(contacts.email, t.email), like(contacts.project, t.project)));
      console.log(`  ✓ Restored: ${t.email}`);
    }
    console.log("  (Simulating Apollo verification success for rescue candidates)\n");
    
    // === STEP 5: Re-gate with fresh data ===
    console.log("━━━ STEP 5: Re-run gate after rescue enrichment ━━━");
    allContacts_now = await getAllContacts();
    annotated = buildAnnotatedProjects(matchedProjects, allContacts_now);
    gateTop3 = buildGateTop3(annotated);
    
    const retryGate = runAllGates({
      userId: RYAN_ID, userName: "Ryan Vella", repLane: "portable_air",
      weekKey: WEEK_KEY, top3Projects: gateTop3,
    });
    
    console.log(`  Decision: ${retryGate.decision}`);
    console.log(`  Top-3 projects:`);
    gateTop3.forEach((p, i) => {
      console.log(`    ${i+1}. ${p.name} — ${p.bestContact?.name || "NONE"} (${p.bestContact?.trustTier || "N/A"})`);
    });
    if (retryGate.blockers.length > 0) {
      console.log(`  Remaining blockers:`);
      retryGate.blockers.forEach(b => console.log(`    • ${b.criterion}: ${b.detail}`));
    }
    console.log("");
    
    // === STEP 6: Store the result ===
    console.log("━━━ STEP 6: Store repDigestGateResults row ━━━");
    try {
      await storeGateResult(
        {
          userId: RYAN_ID,
          userName: "Ryan Vella",
          weekKey: WEEK_KEY,
          decision: retryGate.decision,
          blockers: retryGate.blockers,
          top3Snapshot: gateTop3.map(p => ({ id: p.id, name: p.name, score: p.relevanceScore || 0, contactName: p.bestContact?.name })),
          rescueAttempted: true,
          rescueResult,
          createdAt: new Date().toISOString(),
        },
        db,
        repDigestGateResults,
      );
      console.log("  ✓ Row stored successfully\n");
    } catch (e) {
      console.log(`  ⚠ Store failed (weekKey length): ${e.message}`);
      console.log("  (In production, weekKey is '2026-W19' which fits varchar(16))\n");
    }
    
    // === STEP 7: Read back the stored row ===
    console.log("━━━ STEP 7: Read stored repDigestGateResults row ━━━");
    const [storedRow] = await db.select().from(repDigestGateResults)
      .where(eq(repDigestGateResults.userId, RYAN_ID))
      .orderBy(desc(repDigestGateResults.createdAt))
      .limit(1);
    
    if (storedRow) {
      console.log("  Stored row:");
      console.log(`    userId: ${storedRow.userId}`);
      console.log(`    userName: ${storedRow.userName}`);
      console.log(`    weekKey: ${storedRow.weekKey}`);
      console.log(`    decision: ${storedRow.decision}`);
      console.log(`    rescueAttempted: ${storedRow.rescueAttempted}`);
      console.log(`    blockers: ${JSON.stringify(storedRow.blockers)}`);
      console.log(`    top3Snapshot: ${JSON.stringify(storedRow.top3Snapshot)}`);
      console.log(`    rescueResult: ${JSON.stringify(storedRow.rescueResult)}`);
      console.log(`    createdAt: ${storedRow.createdAt}`);
    } else {
      console.log("  (No stored row found — weekKey may have been too long for varchar(16))");
      console.log("  Showing what WOULD be stored in production:");
      console.log(JSON.stringify({
        userId: RYAN_ID,
        userName: "Ryan Vella",
        weekKey: "2026-W19",
        decision: retryGate.decision,
        rescueAttempted: true,
        blockers: retryGate.blockers,
        top3Snapshot: gateTop3.map(p => ({ id: p.id, name: p.name, score: p.relevanceScore || 0, contactName: p.bestContact?.name })),
        rescueResult: { triggered: rescueResult.triggered, candidates: rescueResult.candidates.length, budgetRemaining: rescueResult.budgetRemaining },
      }, null, 2));
    }
  } else {
    // Gate passed without rescue needed — restore and exit
    console.log("  Gate passed without needing rescue. Restoring contacts...");
    for (const t of degradeTargets) {
      await db.update(contacts)
        .set({ contactTrustTier: "send_ready" })
        .where(and(eq(contacts.email, t.email), like(contacts.project, t.project)));
    }
    console.log("  ✓ All contacts restored");
  }
  
  console.log("\n╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  DEMONSTRATION COMPLETE                                             ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
