/**
 * Ryan vs Brett per-user scoring comparison
 * Proves divergence between two WA users with different lane focus.
 */
import "dotenv/config";
import { getDb } from "./server/db";
import { userProfiles, users } from "./drizzle/schema";
import { eq } from "drizzle-orm";
import { getProjectScoresBatch } from "./server/businessLineScoring";

// ── Inline the scoring functions (copied from emailDigest.ts) ──

const BL_TO_DIMENSION_MAP: Record<string, string[]> = {
  "Portable Air": ["Portable Air"],
  "PAL": ["PAL", "Generators"],
  "Pump (Flow)": ["Pump/Dewatering"],
  "BESS": ["BESS"],
  "Nitrogen": ["Nitrogen"],
  "Booster": ["Booster"],
};

type ActionTier = "tier1_actionable" | "tier2_warm" | "tier3_monitor";

interface DimensionScore { dimension: string; score: number; }

interface DigestProject {
  id: number;
  name: string;
  location: string;
  value: string;
  owner: string;
  priority: string;
  sector: string;
  opportunityRoute: string;
  isNew: boolean;
  stage: string | null;
  overview: string | null;
  actionTier: ActionTier | null;
  tenderCloseDate?: string | null;
}

interface DigestContact {
  name: string;
  title: string;
  email?: string | null;
  contactTrustTier?: string | null;
}

function classifyLaneTier(
  assignedBusinessLines: string[] | null | undefined,
  blScores: DimensionScore[] | undefined,
): "primary" | "secondary" | "crosssell" | "poor" {
  if (!assignedBusinessLines || assignedBusinessLines.length === 0 || !blScores || blScores.length === 0) return "crosssell";
  const userDimensions = new Set<string>();
  for (const bl of assignedBusinessLines) {
    const dims = BL_TO_DIMENSION_MAP[bl];
    if (dims) dims.forEach(d => userDimensions.add(d));
  }
  if (userDimensions.size === 0) return "crosssell";
  let maxScore = 0;
  for (const dim of Array.from(userDimensions)) {
    const s = blScores.find(b => b.dimension === dim)?.score ?? 0;
    if (s > maxScore) maxScore = s;
  }
  if (maxScore >= 60) return "primary";
  if (maxScore >= 35) return "secondary";
  if (maxScore >= 15) return "crosssell";
  return "poor";
}

function computeRelevanceScore(
  project: DigestProject,
  profile: {
    territories?: string[] | null;
    industries?: string[] | null;
    offerCategories?: string[] | null;
    assignedBusinessLines?: string[] | null;
    sectorFocus?: string[] | null;
    stageTiming?: string[] | null;
    buyerRoles?: string[] | null;
    keyAccounts?: string[] | null;
  },
  blScores?: DimensionScore[],
): { relevance: number; laneTier: string; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let score = 0;

  const laneTier = classifyLaneTier(profile.assignedBusinessLines, blScores);
  const lanePoints = laneTier === "primary" ? 32 : laneTier === "secondary" ? 22 : laneTier === "crosssell" ? 12 : 0;
  const lanePenalty = laneTier === "poor" ? -8 : 0;
  breakdown["lane"] = lanePoints + lanePenalty;
  score += lanePoints + lanePenalty;

  if (profile.stageTiming && profile.stageTiming.length > 0) {
    const stagePref = profile.stageTiming.map(s => s.toLowerCase());
    const projStage = (project.stage || "").toLowerCase();
    const stageAliases: Record<string, string[]> = {
      early_signal:       ["planning", "feasibility", "study", "announcement", "early", "concept", "pre-feasibility", "scoping"],
      tender_live:        ["tender", "rfq", "rfp", "eoi", "bid", "procurement", "expression of interest"],
      awarded_mobilizing: ["awarded", "mobilizing", "mobilisation", "construction", "execution", "active", "underway", "commenced"],
      commissioning:      ["commissioning", "startup", "start-up", "handover", "testing"],
      operations:         ["operations", "production", "operating", "operational", "mro", "shutdown", "maintenance"],
    };
    let stageScore = 0;
    const [firstPref, ...restPrefs] = stagePref;
    const firstAliases = stageAliases[firstPref] || [firstPref];
    if (firstAliases.some(a => projStage.includes(a))) {
      stageScore = 15;
    } else {
      for (const pref of restPrefs) {
        const aliases = stageAliases[pref] || [pref];
        if (aliases.some(a => projStage.includes(a))) { stageScore = 8; break; }
      }
    }
    breakdown["stage"] = stageScore;
    score += stageScore;
  }

  const effectiveSectors = (profile.sectorFocus && profile.sectorFocus.length > 0)
    ? profile.sectorFocus
    : (profile.industries || []).map(i => i.split("_")[0]);
  if (effectiveSectors.length > 0) {
    const projSector = project.sector.toLowerCase();
    const sectorAliases: Record<string, string[]> = {
      mining:         ["mining", "exploration", "development", "production", "shutdown", "contractors"],
      oil_gas:        ["oil_gas", "oil", "gas", "lng", "fpso", "offshore", "energy_oil_gas", "energy_transmission"],
      infrastructure: ["infrastructure", "rail", "road", "port", "construction", "water"],
      energy:         ["energy", "renewable", "solar", "wind", "hydrogen", "bess", "energy_renewables"],
      defence:        ["defence", "defense", "military", "naval"],
    };
    const projAliases = sectorAliases[projSector] || [projSector];
    const matched = effectiveSectors.some(s =>
      projAliases.some(a => a.includes(s.toLowerCase()) || s.toLowerCase().includes(a))
    );
    breakdown["sector"] = matched ? 12 : 0;
    score += matched ? 12 : 0;
  }

  if (blScores && blScores.length > 0) {
    const serviceScore = blScores.find(s => s.dimension === "Service Potential")?.score ?? 0;
    const rentalScore  = blScores.find(s => s.dimension === "Rental Influence")?.score ?? 0;
    const offerCats = (profile.offerCategories || []).map(c => c.toLowerCase());
    const wantsRental  = offerCats.some(c => c.includes("rental") || c.includes("hire"));
    const wantsService = offerCats.some(c => c.includes("service") || c.includes("parts") || c.includes("engineering") || c.includes("consumable"));
    let crossSell = 0;
    if (wantsRental)  crossSell += Math.round((rentalScore  / 100) * 5);
    if (wantsService) crossSell += Math.round((serviceScore / 100) * 5);
    crossSell = Math.min(crossSell, 8);
    breakdown["crosssell"] = crossSell;
    score += crossSell;
  }

  if (profile.keyAccounts && profile.keyAccounts.length > 0) {
    const accounts = profile.keyAccounts.map(a => a.toLowerCase());
    const ownerLower = (project.owner || "").toLowerCase();
    const nameLower  = project.name.toLowerCase();
    const isStrategic = accounts.some(a => a.length > 3 && (ownerLower.includes(a) || nameLower.includes(a)));
    const strategicPts = isStrategic ? 6 : 0;
    breakdown["strategic"] = strategicPts;
    score += strategicPts;
  }

  const priorityPts = project.priority === "hot" ? 5 : project.priority === "warm" ? 3 : 0;
  const newPts = project.isNew ? 2 : 0;
  breakdown["priority"] = priorityPts + newPts;
  score += priorityPts + newPts;

  if (profile.territories && profile.territories.length > 0) {
    const territories = profile.territories;
    const loc = project.location.toLowerCase();
    const stateMap: Record<string, string[]> = {
      WA:  ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha", "port hedland", "newman", "geraldton", "bunbury", "broome", "norseman", "murchison", "kwinana"],
      NT:  ["northern territory", "nt", "darwin", "alice springs", "tennant creek", "katherine"],
    };
    let terrPts = 0;
    for (const terr of territories) {
      if (terr === "National" || terr === "NATIONAL") { terrPts = 3; break; }
      const keywords = stateMap[terr] || [terr.toLowerCase()];
      const exactMatch = keywords.some(k => {
        if (k.length <= 3) {
          const re = new RegExp(`(?:^|[\\s,;/|()\\-])${k}(?:$|[\\s,;/|()\\-])`, "i");
          return re.test(loc);
        }
        return loc.includes(k);
      });
      if (exactMatch) { terrPts = 5; break; }
    }
    breakdown["territory"] = terrPts;
    score += terrPts;
  }

  return { relevance: Math.max(0, Math.min(100, score)), laneTier, breakdown };
}

function computeActionabilityScore(
  project: DigestProject,
  projectContacts: DigestContact[],
  profile: { buyerRoles?: string[] | null },
): { actionability: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let score = 0;

  const sendReadyContacts = projectContacts.filter(c => c.contactTrustTier === "send_ready" && c.email);
  const namedContacts     = projectContacts.filter(c => c.contactTrustTier === "named_unverified");
  let contactPts = 0;
  if (sendReadyContacts.length > 0)  contactPts = 30;
  else if (namedContacts.length > 0) contactPts = 12;
  breakdown["contact"] = contactPts;
  score += contactPts;

  if (sendReadyContacts.length > 0 && profile.buyerRoles && profile.buyerRoles.length > 0) {
    const buyerRoles = profile.buyerRoles.map(r => r.toLowerCase());
    const roleAliases: Record<string, string[]> = {
      procurement:          ["procurement", "commercial", "supply chain", "contracts", "purchasing"],
      fleet_manager:        ["fleet", "equipment manager", "plant manager", "asset"],
      operations_site:      ["operations", "site manager", "project manager", "construction manager", "site supervisor"],
      maintenance_shutdown: ["maintenance", "shutdown", "turnaround", "reliability", "mechanical"],
      project_manager:      ["project manager", "pm", "project director", "project engineer"],
      engineering:          ["engineer", "technical", "design", "process"],
    };
    const bestContact = sendReadyContacts[0];
    const titleLower  = (bestContact.title || "").toLowerCase();
    const roleMatched = buyerRoles.some(role => {
      const aliases = roleAliases[role] || [role];
      return aliases.some(a => titleLower.includes(a));
    });
    breakdown["buyerRole"] = roleMatched ? 15 : 0;
    score += roleMatched ? 15 : 0;
  }

  if (project.tenderCloseDate) {
    const daysUntilClose = Math.ceil(
      (new Date(project.tenderCloseDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    let closingPts = 0;
    if (daysUntilClose >= 0 && daysUntilClose <= 7)  closingPts = 20;
    else if (daysUntilClose <= 14)                   closingPts = 16;
    else if (daysUntilClose <= 21)                   closingPts = 10;
    else if (daysUntilClose <= 30)                   closingPts = 6;
    breakdown["closing"] = closingPts;
    score += closingPts;
  }

  const hasContractor = !!(project as any).contractor || !!(project as any).confirmedContractor;
  breakdown["contractor"] = hasContractor ? 15 : 0;
  score += hasContractor ? 15 : 0;

  const tierPts = project.actionTier === "tier1_actionable" ? 20
    : project.actionTier === "tier2_warm"    ? 10
    : project.actionTier === "tier3_monitor" ? 4
    : 0;
  breakdown["actionTier"] = tierPts;
  score += tierPts;

  return { actionability: Math.max(0, Math.min(100, score)), breakdown };
}

async function main() {
  // Load Ryan and Brett profiles
  const db = await getDb();
  const [ryanUser] = await db.select().from(users).where(eq(users.name, "Ryan Pemberton")).limit(1);
  const [brettUser] = await db.select().from(users).where(eq(users.name, "Brett Hansen")).limit(1);

  if (!ryanUser || !brettUser) {
    console.error("Could not find Ryan or Brett in users table");
    process.exit(1);
  }

  const [ryanProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, ryanUser.id)).limit(1);
  const [brettProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, brettUser.id)).limit(1);

  if (!ryanProfile || !brettProfile) {
    console.error("Could not find profiles for Ryan or Brett");
    process.exit(1);
  }

  console.log("\n=== USER PROFILES ===");
  console.log(`Ryan (id=${ryanUser.id}): BL=${JSON.stringify(ryanProfile.assignedBusinessLines)}, territory=${JSON.stringify(ryanProfile.territories)}, sector=${JSON.stringify((ryanProfile as any).sectorFocus)}, stage=${JSON.stringify((ryanProfile as any).stageTiming)}`);
  console.log(`Brett (id=${brettUser.id}): BL=${JSON.stringify(brettProfile.assignedBusinessLines)}, territory=${JSON.stringify(brettProfile.territories)}, sector=${JSON.stringify((brettProfile as any).sectorFocus)}, stage=${JSON.stringify((brettProfile as any).stageTiming)}`);

  // Load WA projects
  const { getActiveProjects, getAllContacts } = await import("./server/db");
  const allProjects = await getActiveProjects();
  const allContacts = await getAllContacts();

  // Hard filter to WA/NT
  const WA_KEYWORDS = ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha", "port hedland", "newman", "geraldton", "bunbury", "broome", "norseman", "murchison", "kwinana"];
  const NT_KEYWORDS = ["northern territory", "nt", "darwin", "alice springs", "tennant creek", "katherine"];

  function isInTerritory(loc: string, state: string | null, territories: string[]): boolean {
    const locLower = (loc || "").toLowerCase();
    const stateLower = (state || "").toUpperCase();
    const AU_STATES = new Set(["WA", "QLD", "NSW", "VIC", "SA", "TAS", "NT", "ACT"]);
    for (const t of territories) {
      const tUpper = t.toUpperCase();
      if (stateLower && AU_STATES.has(stateLower) && stateLower !== tUpper) continue;
      const keywords = tUpper === "WA" ? WA_KEYWORDS : tUpper === "NT" ? NT_KEYWORDS : [t.toLowerCase()];
      if (keywords.some(k => {
        if (k.length <= 3) return new RegExp(`(?:^|[\\s,;/|()\\-])${k}(?:$|[\\s,;/|()\\-])`, "i").test(locLower);
        return locLower.includes(k);
      })) return true;
    }
    return false;
  }

  const ryanTerritories = (ryanProfile.territories as string[] | null) || ["WA"];
  const brettTerritories = (brettProfile.territories as string[] | null) || ["WA", "NT"];

  const ryanProjects = allProjects.filter(p => isInTerritory(p.location, (p as any).projectState, ryanTerritories));
  const brettProjects = allProjects.filter(p => isInTerritory(p.location, (p as any).projectState, brettTerritories));

  console.log(`\nWA projects for Ryan: ${ryanProjects.length}, WA/NT projects for Brett: ${brettProjects.length}`);

  // Get BL scores for all projects
  const allIds = [...new Set([...ryanProjects.map(p => p.id), ...brettProjects.map(p => p.id)])];
  const blScoresMap = await getProjectScoresBatch(allIds);

  // Score each project for each user
  function scoreForUser(projects: any[], profile: any, contacts: any[]) {
    return projects.map(p => {
      const blScores = blScoresMap.get(p.id) || [];
      const projectContacts = contacts
        .filter(c => c.project && (
          c.project.toLowerCase().includes(p.name.toLowerCase().slice(0, 30)) ||
          p.name.toLowerCase().includes(c.project.toLowerCase().slice(0, 30))
        ))
        .map(c => ({ ...c, contactTrustTier: (c as any).contactTrustTier ?? null }));

      const { relevance, laneTier, breakdown: rBd } = computeRelevanceScore(
        { ...p, actionTier: (p as any).actionTier ?? null, tenderCloseDate: (p as any).tenderCloseDate ?? null },
        profile,
        blScores,
      );
      const { actionability, breakdown: aBd } = computeActionabilityScore(
        { ...p, actionTier: (p as any).actionTier ?? null, tenderCloseDate: (p as any).tenderCloseDate ?? null },
        projectContacts,
        { buyerRoles: (profile as any).buyerRoles },
      );
      const combined = actionability >= 50
        ? Math.round(0.5 * relevance + 0.5 * actionability)
        : Math.round(0.8 * relevance + 0.2 * actionability);

      return {
        id: p.id,
        name: p.name,
        location: p.location,
        sector: p.sector,
        stage: p.stage,
        priority: p.priority,
        relevance,
        actionability,
        combined,
        laneTier,
        rBd,
        aBd,
        sendReadyCount: projectContacts.filter(c => c.contactTrustTier === "send_ready" && (c as any).email).length,
      };
    }).sort((a, b) => b.combined - a.combined);
  }

  const ryanScored = scoreForUser(ryanProjects, {
    territories: ryanTerritories,
    industries: ryanProfile.industries,
    offerCategories: ryanProfile.offerCategories,
    customerTypes: ryanProfile.customerTypes,
    dealSizeMin: ryanProfile.dealSizeMin,
    dealSizeMax: ryanProfile.dealSizeMax,
    assignedBusinessLines: ryanProfile.assignedBusinessLines,
    sectorFocus: (ryanProfile as any).sectorFocus,
    stageTiming: (ryanProfile as any).stageTiming,
    buyerRoles: (ryanProfile as any).buyerRoles,
    keyAccounts: (ryanProfile as any).keyAccounts,
  }, allContacts);

  const brettScored = scoreForUser(brettProjects, {
    territories: brettTerritories,
    industries: brettProfile.industries,
    offerCategories: brettProfile.offerCategories,
    customerTypes: brettProfile.customerTypes,
    dealSizeMin: brettProfile.dealSizeMin,
    dealSizeMax: brettProfile.dealSizeMax,
    assignedBusinessLines: brettProfile.assignedBusinessLines,
    sectorFocus: (brettProfile as any).sectorFocus,
    stageTiming: (brettProfile as any).stageTiming,
    buyerRoles: (brettProfile as any).buyerRoles,
    keyAccounts: (brettProfile as any).keyAccounts,
  }, allContacts);

  function printTop10(label: string, scored: any[]) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`${label} — TOP 10`);
    console.log(`${"=".repeat(70)}`);
    scored.slice(0, 10).forEach((p, i) => {
      console.log(`\n#${i + 1}. ${p.name}`);
      console.log(`   Location: ${p.location} | Sector: ${p.sector} | Stage: ${p.stage || "?"} | Priority: ${p.priority}`);
      console.log(`   Lane tier: ${p.laneTier} | Send-ready contacts: ${p.sendReadyCount}`);
      console.log(`   SCORES → Relevance: ${p.relevance} | Actionability: ${p.actionability} | Combined: ${p.combined}`);
      const rBdStr = Object.entries(p.rBd).map(([k, v]) => `${k}:${v}`).join(", ");
      const aBdStr = Object.entries(p.aBd).map(([k, v]) => `${k}:${v}`).join(", ");
      console.log(`   Relevance breakdown: ${rBdStr}`);
      console.log(`   Actionability breakdown: ${aBdStr}`);
    });
  }

  printTop10("RYAN PEMBERTON (Portable Air, WA)", ryanScored);
  printTop10("BRETT HANSEN (Pump/Flow, WA+NT)", brettScored);

  // Overlap analysis
  const ryanTop10Ids = new Set(ryanScored.slice(0, 10).map(p => p.id));
  const brettTop10Ids = new Set(brettScored.slice(0, 10).map(p => p.id));
  const overlapIds = [...ryanTop10Ids].filter(id => brettTop10Ids.has(id));

  console.log(`\n${"=".repeat(70)}`);
  console.log(`OVERLAP ANALYSIS`);
  console.log(`${"=".repeat(70)}`);
  console.log(`Ryan top-10 IDs:  ${[...ryanTop10Ids].join(", ")}`);
  console.log(`Brett top-10 IDs: ${[...brettTop10Ids].join(", ")}`);
  console.log(`Overlap count: ${overlapIds.length} / 10`);
  if (overlapIds.length > 0) {
    console.log(`\nOverlapping projects:`);
    for (const id of overlapIds) {
      const rp = ryanScored.find(p => p.id === id)!;
      const bp = brettScored.find(p => p.id === id)!;
      const rRank = ryanScored.findIndex(p => p.id === id) + 1;
      const bRank = brettScored.findIndex(p => p.id === id) + 1;
      console.log(`  • ${rp.name}`);
      console.log(`    Ryan: #${rRank} (combined=${rp.combined}, lane=${rp.laneTier}) | Brett: #${bRank} (combined=${bp.combined}, lane=${bp.laneTier})`);
      console.log(`    Why both: sector=${rp.sector}, stage=${rp.stage}, priority=${rp.priority}, sendReady=${rp.sendReadyCount}`);
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`DIVERGENCE SUMMARY`);
  console.log(`${"=".repeat(70)}`);
  const ryanOnly = ryanScored.slice(0, 10).filter(p => !brettTop10Ids.has(p.id));
  const brettOnly = brettScored.slice(0, 10).filter(p => !ryanTop10Ids.has(p.id));
  console.log(`\nRyan-only top-10 projects (${ryanOnly.length}):`);
  ryanOnly.forEach(p => console.log(`  • ${p.name} (lane=${p.laneTier}, R=${p.relevance}, A=${p.actionability}, combined=${p.combined})`));
  console.log(`\nBrett-only top-10 projects (${brettOnly.length}):`);
  brettOnly.forEach(p => console.log(`  • ${p.name} (lane=${p.laneTier}, R=${p.relevance}, A=${p.actionability}, combined=${p.combined})`));

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
