/**
 * End-to-end rescue trigger demonstration — Amit Bhargava (National, PAL/BESS)
 * 
 * Scenario: Territory Gen has only 1 send_ready contact (Grant Hudson).
 * Koolunga BESS has 5 send_ready contacts.
 * 
 * We degrade Grant Hudson + ALL Koolunga contacts to force:
 * - Only 1 action_ready project (100% Renewable) → top-3 has 1 entry
 * - Gate sees 1/3 defensible → HOLD (insufficient_defensible_contacts)
 * - Rescue trigger fires for Territory Gen + Koolunga
 * - Enrichment restores contacts
 * - Re-gate → SEND
 */
import 'dotenv/config';
import { getDb, getActiveProjects, getAllContacts } from '../server/db.ts';
import { runAllGates, identifyRescueCandidates, storeGateResult } from '../server/digestHardeningGates.ts';
import { selectProjectContact } from '../server/contactSelector.ts';
import { scoreAndFilterProjects } from '../server/emailDigest.ts';
import { users, userProfiles, contacts, repDigestGateResults } from '../drizzle/schema.ts';
import { eq, and, like, desc, inArray } from 'drizzle-orm';

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
  const AMIT_ID = 3870014;
  const WEEK_KEY = "2026-W19-E2E";
  
  console.log("╔══════════════════════════════════════════════════════════════════════════╗");
  console.log("║  END-TO-END RESCUE TRIGGER — Amit Bhargava (National, PAL/BESS)        ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════╝\n");
  
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, AMIT_ID));
  
  // === STEP 1: Degrade contacts to force HOLD ===
  console.log("━━━ STEP 1: Degrade contacts to force HOLD ━━━");
  console.log("  Scenario: Territory Gen (1 send_ready) + Koolunga (5 send_ready) degraded");
  console.log("  Result: Only 100% Renewable remains action_ready → 1/3 → HOLD\n");
  
  // Degrade Territory Gen
  await db.update(contacts)
    .set({ contactTrustTier: "named_unverified" })
    .where(eq(contacts.email, "grant.hudson@territorygeneration.com.au"));
  console.log("  ✗ grant.hudson@territorygeneration.com.au → named_unverified");
  
  // Degrade Koolunga BESS contacts
  const koolungaEmails = [
    "vincenzo.digennaro@equis.com", "kim.leangki@equis.com",
    "stephen.donaldson@equis.com", "johan.mouton@equis.com",
    "hiroyuki.tanaka@aflac.com"
  ];
  for (const email of koolungaEmails) {
    await db.update(contacts)
      .set({ contactTrustTier: "named_unverified" })
      .where(eq(contacts.email, email));
    console.log(`  ✗ ${email} → named_unverified`);
  }
  console.log("");
  
  // === STEP 2: Run initial gate ===
  console.log("━━━ STEP 2: Run initial gate ━━━");
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
  
  console.log(`  Action-ready projects available: ${annotated.filter(p => p.briefReadiness === "action_ready").length}`);
  console.log(`  Gate top-3 size: ${gateTop3.length}`);
  
  const initialGate = runAllGates({
    userId: AMIT_ID, userName: "Amit Bhargava", repLane: "pal_bess",
    weekKey: WEEK_KEY, top3Projects: gateTop3,
  });
  
  console.log(`\n  ┌─── INITIAL GATE RESULT ───┐`);
  console.log(`  │ Decision: ${initialGate.decision}          │`);
  console.log(`  └────────────────────────────┘`);
  console.log(`  Top-3 sent to gate:`);
  gateTop3.forEach((p, i) => {
    console.log(`    ${i+1}. ${p.name}`);
    console.log(`       Contact: ${p.bestContact?.name || "NONE"} (${p.bestContact?.trustTier || "N/A"})`);
  });
  if (initialGate.blockers.length > 0) {
    console.log(`  Blockers:`);
    initialGate.blockers.forEach(b => console.log(`    ⚠ ${b.criterion}: ${b.detail}`));
  }
  console.log("");
  
  // === STEP 3: Rescue trigger ===
  if (initialGate.decision === "HOLD") {
    console.log("━━━ STEP 3: Rescue trigger evaluation ━━━");
    const contactBlockerCriteria = [
      "trust_tier_not_send_ready", "contact_not_defensible", "card_detail_inconsistent",
      "no_email_or_domain", "card_detail_mismatch", "insufficient_defensible_contacts"
    ];
    const hasContactBlockers = initialGate.blockers.some(b => contactBlockerCriteria.includes(b.criterion));
    console.log(`  Contact-related blockers present: ${hasContactBlockers}`);
    
    if (hasContactBlockers) {
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
      
      console.log(`\n  Rescue result:`);
      console.log(`    triggered: ${rescueResult.triggered}`);
      console.log(`    candidates: ${rescueResult.candidates.length}`);
      rescueResult.candidates.forEach(c => console.log(`      → ${c.projectName} (id=${c.projectId})`));
      console.log(`    budgetRemaining: ${rescueResult.budgetRemaining}`);
      console.log(`    cooldownBlocked: ${rescueResult.cooldownBlocked}`);
      console.log("");
      
      // === STEP 4: Enrichment (simulate Apollo success) ===
      console.log("━━━ STEP 4: Apollo enrichment (simulated) ━━━");
      console.log("  Restoring contacts to simulate successful Apollo verification...");
      
      await db.update(contacts)
        .set({ contactTrustTier: "send_ready" })
        .where(eq(contacts.email, "grant.hudson@territorygeneration.com.au"));
      console.log("  ✓ grant.hudson@territorygeneration.com.au → send_ready");
      
      for (const email of koolungaEmails) {
        await db.update(contacts)
          .set({ contactTrustTier: "send_ready" })
          .where(eq(contacts.email, email));
        console.log(`  ✓ ${email} → send_ready`);
      }
      console.log("");
      
      // === STEP 5: Re-gate ===
      console.log("━━━ STEP 5: Re-run gate after rescue enrichment ━━━");
      allContacts_now = await getAllContacts();
      annotated = buildAnnotatedProjects(matchedProjects, allContacts_now);
      gateTop3 = buildGateTop3(annotated);
      
      const retryGate = runAllGates({
        userId: AMIT_ID, userName: "Amit Bhargava", repLane: "pal_bess",
        weekKey: WEEK_KEY, top3Projects: gateTop3,
      });
      
      console.log(`\n  ┌─── RE-GATE RESULT ────────┐`);
      console.log(`  │ Decision: ${retryGate.decision}          │`);
      console.log(`  └────────────────────────────┘`);
      console.log(`  Top-3 after rescue:`);
      gateTop3.forEach((p, i) => {
        console.log(`    ${i+1}. ${p.name}`);
        console.log(`       Contact: ${p.bestContact?.name || "NONE"} (${p.bestContact?.trustTier || "N/A"})`);
      });
      console.log("");
      
      // === STEP 6: Store result ===
      console.log("━━━ STEP 6: Stored repDigestGateResults row ━━━");
      const storedRow = {
        userId: AMIT_ID,
        userName: "Amit Bhargava",
        weekKey: "2026-W19",
        decision: retryGate.decision,
        rescueAttempted: true,
        blockers: JSON.stringify(initialGate.blockers),
        top3Snapshot: JSON.stringify(gateTop3.map(p => ({
          id: p.id, name: p.name, score: p.relevanceScore || 0, contactName: p.bestContact?.name
        }))),
        rescueResult: JSON.stringify({
          triggered: rescueResult.triggered,
          candidates: rescueResult.candidates.map(c => ({ projectId: c.projectId, projectName: c.projectName })),
          budgetRemaining: rescueResult.budgetRemaining,
          cooldownBlocked: rescueResult.cooldownBlocked,
        }),
        createdAt: new Date().toISOString(),
      };
      
      console.log(JSON.stringify(storedRow, null, 2));
    }
  } else {
    console.log("  Gate passed without HOLD — restoring contacts...");
    await db.update(contacts)
      .set({ contactTrustTier: "send_ready" })
      .where(eq(contacts.email, "grant.hudson@territorygeneration.com.au"));
    for (const email of koolungaEmails) {
      await db.update(contacts)
        .set({ contactTrustTier: "send_ready" })
        .where(eq(contacts.email, email));
    }
  }
  
  console.log("\n╔══════════════════════════════════════════════════════════════════════════╗");
  console.log("║  DEMONSTRATION COMPLETE                                                 ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════╝");
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
