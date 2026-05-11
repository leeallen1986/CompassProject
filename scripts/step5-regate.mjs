// Step 5: Re-evaluate digest hardening gates for 5 target reps
// Replicates the EXACT same annotation pipeline as sendWeeklyDigestsForUser
import { register } from "tsx/esm/api";
const unregister = register();

const TARGET_REPS = [
  { id: 2340043, name: "Ryan Pemberton" },
  { id: 2550006, name: "Brett Hansen" },
  { id: 2820073, name: "Daniel Zec" },
  { id: 3630009, name: "Dan Day" },
  { id: 3870014, name: "Amit Bhargava" },
];

const start = new Date();
console.log(`[ReGate] START: ${start.toISOString()}`);

try {
  const { runAllGates, storeGateResult } = await import("../server/digestHardeningGates.ts");
  const { getDb, getActiveProjects, getAllContacts } = await import("../server/db.ts");
  const { scoreAndFilterProjects, classifyBriefReadiness } = await import("../server/emailDigest.ts");
  const { repDigestGateResults } = await import("../drizzle/schema.ts");

  const db = await getDb();
  if (!db) throw new Error("No DB");

  // Fetch all active projects and contacts once (same as digest send path)
  const allProjects = await getActiveProjects();
  const allContacts = await getAllContacts();
  console.log(`[ReGate] Loaded ${allProjects.length} projects, ${allContacts.length} contacts`);

  // Build contact lookup sets (same as digest send path)
  const contactProjectNames = new Set(allContacts.map(c => c.project).filter(Boolean));

  // Get profiles for target reps
  const [profiles] = await db.execute(
    `SELECT up.*, u.name as userName
     FROM userProfiles up
     JOIN users u ON u.id = up.userId
     WHERE up.userId IN (${TARGET_REPS.map(r => r.id).join(",")})`
  );

  const results = [];

  for (const profile of profiles) {
    const userId = profile.userId;
    const userName = profile.userName || TARGET_REPS.find(r => r.id === userId)?.name || "Unknown";

    // Parse BLs
    let bls = [];
    try {
      const raw = profile.assignedBusinessLines;
      if (typeof raw === "string") bls = JSON.parse(raw);
      else if (Buffer.isBuffer(raw)) bls = JSON.parse(raw.toString("utf-8"));
      else if (Array.isArray(raw)) bls = raw;
    } catch { bls = []; }

    // Parse territories
    let territories = [];
    try {
      const raw = profile.territories;
      if (typeof raw === "string") territories = JSON.parse(raw);
      else if (Buffer.isBuffer(raw)) territories = JSON.parse(raw.toString("utf-8"));
      else if (Array.isArray(raw)) territories = raw;
    } catch { territories = []; }

    // Determine lane
    const repLane = bls.some(b => b.includes("Pump"))
      ? "pumps"
      : bls.some(b => b === "PAL" || b === "BESS")
        ? "pal_bess"
        : "portable_air";

    // Score projects for this user (same as digest send path)
    const matchedProjects = await scoreAndFilterProjects(allProjects, {
      territories: profile.territories ? (typeof profile.territories === "string" ? JSON.parse(profile.territories) : (Buffer.isBuffer(profile.territories) ? JSON.parse(profile.territories.toString("utf-8")) : profile.territories)) : null,
      industries: profile.industries ? (typeof profile.industries === "string" ? JSON.parse(profile.industries) : (Buffer.isBuffer(profile.industries) ? JSON.parse(profile.industries.toString("utf-8")) : profile.industries)) : null,
      offerCategories: profile.offerCategories ? (typeof profile.offerCategories === "string" ? JSON.parse(profile.offerCategories) : (Buffer.isBuffer(profile.offerCategories) ? JSON.parse(profile.offerCategories.toString("utf-8")) : profile.offerCategories)) : null,
      customerTypes: profile.customerTypes ? (typeof profile.customerTypes === "string" ? JSON.parse(profile.customerTypes) : (Buffer.isBuffer(profile.customerTypes) ? JSON.parse(profile.customerTypes.toString("utf-8")) : profile.customerTypes)) : null,
      dealSizeMin: profile.dealSizeMin || null,
      dealSizeMax: profile.dealSizeMax || null,
      assignedBusinessLines: bls,
      sectorFocus: profile.sectorFocus ? (typeof profile.sectorFocus === "string" ? JSON.parse(profile.sectorFocus) : (Buffer.isBuffer(profile.sectorFocus) ? JSON.parse(profile.sectorFocus.toString("utf-8")) : profile.sectorFocus)) : null,
      stageTiming: profile.stageTiming ? (typeof profile.stageTiming === "string" ? JSON.parse(profile.stageTiming) : (Buffer.isBuffer(profile.stageTiming) ? JSON.parse(profile.stageTiming.toString("utf-8")) : profile.stageTiming)) : null,
      buyerRoles: profile.buyerRoles ? (typeof profile.buyerRoles === "string" ? JSON.parse(profile.buyerRoles) : (Buffer.isBuffer(profile.buyerRoles) ? JSON.parse(profile.buyerRoles.toString("utf-8")) : profile.buyerRoles)) : null,
      keyAccounts: profile.keyAccounts ? (typeof profile.keyAccounts === "string" ? JSON.parse(profile.keyAccounts) : (Buffer.isBuffer(profile.keyAccounts) ? JSON.parse(profile.keyAccounts.toString("utf-8")) : profile.keyAccounts)) : null,
      salesMotion: profile.salesMotion || null,
    });

    console.log(`[ReGate] ${userName}: ${matchedProjects.length} matched projects`);

    // Get matched contacts (same as digest send path)
    const matchedProjectNames = new Set(matchedProjects.map(p => p.name));
    const matchedContacts = allContacts.filter(c => matchedProjectNames.has(c.project));

    // Annotate each project with contacts + briefReadiness (EXACT same logic as digest path)
    const annotatedProjects = matchedProjects.map(p => {
      const hasNoContacts = !contactProjectNames.has(p.name);
      // Find contacts for this project (fuzzy name match — same as digest path)
      const projectContacts = matchedContacts
        .filter(c =>
          c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
          p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
        )
        .map(c => ({
          ...c,
          roleRelevance: c.roleRelevance ?? null,
          linkedin: c.linkedinProfileUrl ?? c.linkedin ?? null,
          contactTrustTier: c.contactTrustTier ?? null,
          source: c.source ?? null,
          verificationScore: c.verificationScore ?? null,
        }));
      const { readiness, bestContact } = classifyBriefReadiness(
        { ...p, hasNoContacts },
        projectContacts,
      );
      return {
        ...p,
        hasNoContacts,
        briefReadiness: readiness,
        bestContact,
      };
    });

    // Filter for Must Act candidates (same as gate path)
    const mustAct = annotatedProjects
      .filter(p => p.briefReadiness === "action_ready" && (p.laneFitLabel === "High" || p.laneFitLabel === "Medium"))
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, 3);

    console.log(`[ReGate] ${userName}: ${annotatedProjects.filter(p => p.briefReadiness === "action_ready").length} action_ready, ${mustAct.length} mustAct (High/Med lane fit)`);

    // Build gate input with bestContact data (same as digest send path)
    const gateTop3 = mustAct.map(p => ({
      id: p.id,
      name: p.name,
      overview: p.overview,
      sector: p.sector,
      owner: p.owner,
      laneFitLabel: p.laneFitLabel || "Low",
      relevanceScore: p.relevanceScore,
      contractors: p.contractors || null,
      bestContact: p.bestContact ? {
        name: p.bestContact.name || "",
        email: p.bestContact.email || null,
        title: p.bestContact.title || null,
        company: p.bestContact.company || null,
        trustTier: p.bestContact.trustTier || null,
        source: p.bestContact.source || null,
        verificationScore: p.bestContact.verificationScore || null,
        isDowngraded: p.bestContact.isDowngraded || false,
        isLlmInferred: p.bestContact.isLlmInferred || false,
      } : null,
    }));

    // Get week key
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((now.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7);
    const weekKey = `${now.getFullYear()}W${String(weekNum).padStart(2, "0")}`;

    // Run the gate
    const gateResult = runAllGates({
      userId,
      userName,
      repLane,
      weekKey,
      top3Projects: gateTop3,
    });

    // Store the updated gate result
    await storeGateResult(
      {
        userId,
        userName,
        weekKey,
        decision: gateResult.decision,
        blockers: gateResult.blockers,
        top3Snapshot: gateTop3.map(p => ({ id: p.id, name: p.name, score: p.relevanceScore || 0, contactName: p.bestContact?.name })),
        rescueAttempted: false,
        phase: "manual_refresh",
        createdAt: new Date().toISOString(),
      },
      db,
      repDigestGateResults,
    );

    results.push({
      userId,
      userName,
      decision: gateResult.decision,
      blockers: gateResult.blockers,
      top3: gateTop3.map(p => ({
        name: p.name,
        score: p.relevanceScore,
        laneFit: p.laneFitLabel,
        contact: p.bestContact?.name || "NONE",
        contactEmail: p.bestContact?.email || "NONE",
        trustTier: p.bestContact?.trustTier || "NONE",
        company: p.bestContact?.company || "NONE",
      })),
    });

    console.log(`[ReGate] ${userName}: ${gateResult.decision} (blockers: ${gateResult.blockers.length})`);
    if (gateResult.blockers.length > 0) {
      for (const b of gateResult.blockers) {
        console.log(`  - [${b.severity}] ${b.criterion}: ${b.detail}`);
      }
    }
  }

  const end = new Date();
  console.log(`\n[ReGate] FINISH: ${end.toISOString()}`);
  console.log(`[ReGate] Duration: ${((end - start) / 1000).toFixed(1)}s`);
  console.log(`\n=== SUMMARY ===`);
  for (const r of results) {
    console.log(`${r.userName}: ${r.decision}`);
    for (const p of r.top3) {
      console.log(`  ${p.name} | score=${p.score} | ${p.laneFit} | ${p.contact} (${p.trustTier}) @ ${p.company} | ${p.contactEmail}`);
    }
  }
  console.log(`\n=== JSON ===`);
  console.log(JSON.stringify(results, null, 2));
} catch (err) {
  console.error(`[ReGate] FAILED: ${err.message}`);
  console.error(err.stack);
}

process.exit(0);
