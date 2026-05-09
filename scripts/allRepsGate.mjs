/**
 * Run the real gate for all 5 priority reps to show the actual Monday-visible top-3 per rep.
 * Uses the corrected cardDetailConsistent check (trustTier instead of source).
 */
import 'dotenv/config';
import { getDb, getActiveProjects, getAllContacts } from '../server/db.ts';
import { runAllGates } from '../server/digestHardeningGates.ts';
import { selectProjectContact } from '../server/contactSelector.ts';
import { users, userProfiles } from '../drizzle/schema.ts';
import { eq } from 'drizzle-orm';
import { scoreAndFilterProjects } from '../server/emailDigest.ts';

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

  const REP_IDS = [2340043, 2550006, 2820073, 3630009, 3870014]; // Ryan, Brett, Daniel, Dan Day, Amit
  const allProjects = await getActiveProjects();
  const allContacts = await getAllContacts();
  const contactProjectNames = new Set(allContacts.map(c => c.project).filter(Boolean));

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ALL 5 REPS — MONDAY-VISIBLE GATE RESULTS (LIVE)`);
  console.log(`${"═".repeat(70)}\n`);

  for (const userId of REP_IDS) {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    if (!user || !profile) { console.log(`  [userId=${userId}] No user/profile found\n`); continue; }

    const matchedProjects = await scoreAndFilterProjects(allProjects, {
      territories: profile.territories, industries: profile.industries,
      offerCategories: profile.offerCategories, customerTypes: profile.customerTypes,
      dealSizeMin: profile.dealSizeMin, dealSizeMax: profile.dealSizeMax,
      assignedBusinessLines: profile.assignedBusinessLines, salesMotion: profile.salesMotion,
    });

    const matchedContacts = allContacts.filter(c => new Set(matchedProjects.map(p => p.name)).has(c.project));

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

    const repBLs = (profile.assignedBusinessLines) || [];
    const repLane = repBLs.includes("Pump") || repBLs.includes("Pump (Flow)") || repBLs.includes("Pump (Dewatering)")
      ? "pumps" : repBLs.includes("PAL") || repBLs.includes("BESS") ? "pal_bess" : "portable_air";

    const mustActCandidates = annotatedProjects
      .filter(p => p.briefReadiness === "action_ready" && (p.laneFitLabel === "High" || p.laneFitLabel === "Medium"))
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, 3);

    // Also get ALL visible Monday projects (top 5) for the "visible but not gated" distinction
    const allVisible = annotatedProjects
      .filter(p => p.laneFitLabel === "High" || p.laneFitLabel === "Medium")
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, 5);

    const gateTop3 = mustActCandidates.map(p => ({
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

    const gateResult = runAllGates({
      userId, userName: user.name || "Unknown", repLane,
      weekKey: "2026-W19", top3Projects: gateTop3,
    });

    const territories = (profile.territories || []).join("/") || "National";
    console.log(`  ┌─ ${user.name} (${territories}, ${repLane}) ─ GATE: ${gateResult.decision}`);
    console.log(`  │  Matched: ${matchedProjects.length} projects, Action-ready: ${mustActCandidates.length}`);
    console.log(`  │`);
    console.log(`  │  GATED TOP-3 (used for SEND decision):`);
    mustActCandidates.forEach((p, i) => {
      const status = gateTop3[i]?.bestContact?.trustTier === "send_ready" ? "✓" : "✗";
      console.log(`  │    ${status} ${i+1}. ${p.name}`);
      console.log(`  │       Contact: ${p.bestContact?.name} (${p.bestContact?.trustTier}) — ${p.bestContact?.email || "no email"}`);
      console.log(`  │       Score: ${p.relevanceScore}, Lane: ${p.laneFitLabel}`);
    });
    
    // Show visible projects NOT in the gated top-3
    const nonGatedVisible = allVisible.filter(v => !mustActCandidates.some(m => m.id === v.id));
    if (nonGatedVisible.length > 0) {
      console.log(`  │`);
      console.log(`  │  VISIBLE BUT NOT IN GATED TOP-3 (Monday dashboard only):`);
      nonGatedVisible.forEach((p, i) => {
        console.log(`  │    ${i+1}. ${p.name} (readiness=${p.briefReadiness}, contact=${p.bestContact?.name || "NONE"}, trust=${p.bestContact?.trustTier || "N/A"})`);
      });
    }

    if (gateResult.blockers.length > 0) {
      console.log(`  │`);
      console.log(`  │  BLOCKERS:`);
      gateResult.blockers.forEach(b => console.log(`  │    • ${b.criterion}: ${b.detail}`));
    }
    console.log(`  └${"─".repeat(68)}\n`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
