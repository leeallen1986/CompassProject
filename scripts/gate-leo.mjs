// Gate evaluation for Leo Williams (userId: 840008)
import { register } from "tsx/esm/api";
const unregister = register();

const TARGET_REPS = [
  { id: 840008, name: "Leo Williams" },
];

const start = new Date();
console.log(`[ReGate-Leo] START: ${start.toISOString()}`);

try {
  const { runAllGates, storeGateResult } = await import("../server/digestHardeningGates.ts");
  const { getDb, getActiveProjects, getAllContacts } = await import("../server/db.ts");
  const { scoreAndFilterProjects, classifyBriefReadiness } = await import("../server/emailDigest.ts");
  const { repDigestGateResults } = await import("../drizzle/schema.ts");

  const db = await getDb();
  if (!db) throw new Error("No DB");

  const allProjects = await getActiveProjects();
  const allContacts = await getAllContacts();
  console.log(`[ReGate-Leo] Loaded ${allProjects.length} projects, ${allContacts.length} contacts`);

  const contactProjectNames = new Set(allContacts.map(c => c.project).filter(Boolean));

  const [profiles] = await db.execute(
    `SELECT up.*, u.name as userName
     FROM userProfiles up
     JOIN users u ON u.id = up.userId
     WHERE up.userId = 840008`
  );

  for (const profile of profiles) {
    const userId = profile.userId;
    const userName = profile.userName || "Leo Williams";

    let bls = [];
    try {
      bls = typeof profile.assignedBusinessLines === "string"
        ? JSON.parse(profile.assignedBusinessLines)
        : (profile.assignedBusinessLines || []);
    } catch { bls = []; }

    let territories = [];
    try {
      territories = typeof profile.territories === "string"
        ? JSON.parse(profile.territories)
        : (profile.territories || []);
    } catch { territories = []; }

    let sectorFocus = [];
    try {
      sectorFocus = typeof profile.sectorFocus === "string"
        ? JSON.parse(profile.sectorFocus)
        : (profile.sectorFocus || []);
    } catch { sectorFocus = []; }

    console.log(`[ReGate-Leo] ${userName}: territories=${JSON.stringify(territories)}, BLs=${JSON.stringify(bls)}, sectors=${JSON.stringify(sectorFocus)}`);

    // Score and filter projects for this rep (async function)
    const scored = await scoreAndFilterProjects(allProjects, {
      territories,
      industries: typeof profile.industries === 'string' ? JSON.parse(profile.industries) : (profile.industries || []),
      offerCategories: typeof profile.offerCategories === 'string' ? JSON.parse(profile.offerCategories) : (profile.offerCategories || []),
      customerTypes: typeof profile.customerTypes === 'string' ? JSON.parse(profile.customerTypes) : (profile.customerTypes || []),
      dealSizeMin: profile.dealSizeMin || null,
      dealSizeMax: profile.dealSizeMax || null,
      assignedBusinessLines: bls,
      sectorFocus,
      stageTiming: typeof profile.stageTiming === 'string' ? JSON.parse(profile.stageTiming) : (profile.stageTiming || []),
      buyerRoles: typeof profile.buyerRoles === 'string' ? JSON.parse(profile.buyerRoles) : (profile.buyerRoles || []),
      keyAccounts: typeof profile.keyAccounts === 'string' ? JSON.parse(profile.keyAccounts) : (profile.keyAccounts || []),
      salesMotion: profile.salesMotion || null,
    });

    // Take top 3
    const top3 = scored.slice(0, 3);
    console.log(`[ReGate-Leo] ${userName}: ${scored.length} scored projects, top3: ${top3.map(p => p.name || p.title).join(", ")}`);

    // Build top3Projects in the format DigestGateInput expects
    const top3Projects = top3.map(p => {
      const projectContacts = allContacts.filter(c => c.project === p.name || c.project === p.title);
      // Find the best contact (highest trust tier)
      const tierOrder = ['send_ready', 'verified', 'named_verified', 'named_unverified', 'unknown'];
      const sorted = [...projectContacts].sort((a, b) => {
        const aIdx = tierOrder.indexOf(a.trustTier || 'unknown');
        const bIdx = tierOrder.indexOf(b.trustTier || 'unknown');
        return aIdx - bIdx;
      });
      const best = sorted[0] || null;
      return {
        id: p.id,
        name: p.name || p.title,
        overview: p.overview || p.description || '',
        sector: p.sector || '',
        owner: p.owner || '',
        laneFitLabel: 'Portable Air',
        relevanceScore: p.relevanceScore || 0,
        contractors: p.contractors || null,
        bestContact: best ? {
          name: best.name || '',
          email: best.email || null,
          title: best.title || null,
          company: best.company || null,
          trustTier: best.trustTier || null,
          source: best.source || null,
          verificationScore: best.verificationScore || null,
        } : null,
      };
    });

    // Run gates with correct DigestGateInput shape
    const gateResult = runAllGates({
      userId,
      userName,
      repLane: 'Portable Air',
      weekKey: '2026W19',
      top3Projects,
      previousTop3: null,
    });

    console.log(`[ReGate-Leo] ${userName}: ${gateResult.decision} (${gateResult.blockers.length} blockers)`);
    if (gateResult.blockers.length > 0) {
      for (const b of gateResult.blockers) {
        console.log(`  BLOCKER: ${b.criterion} — ${b.detail}`);
      }
    }

    // Store result
    await storeGateResult(db, {
      userId,
      weekKey: "2026W19",
      decision: gateResult.decision,
      blockers: gateResult.blockers,
      top3Snapshot: annotated.map(p => ({
        id: p.id,
        name: p.name || p.title,
        score: p.relevanceScore,
        readiness: p.briefReadiness,
      })),
      phase: "manual_refresh",
    });

    console.log(`[ReGate-Leo] Stored gate result: ${gateResult.decision}`);
  }
} catch (err) {
  console.error("[ReGate-Leo] FATAL:", err);
  process.exit(1);
}

const end = new Date();
console.log(`[ReGate-Leo] DONE in ${((end - start) / 1000).toFixed(1)}s`);
process.exit(0);
