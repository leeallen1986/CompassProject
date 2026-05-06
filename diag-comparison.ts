/**
 * Before/After Comparison Script
 * ================================
 * Demonstrates the lane scoring model's per-rep ranking behaviour using
 * synthetic project fixtures that mirror real project types in the DB.
 *
 * Outputs:
 *   1. Daniel (WA Portable Air) top 10
 *   2. Pump rep (QLD Dewatering Pumps) top 10 — same territory, different lane
 *   3. Ryan (WA Portable Air) vs Brett (QLD Dewatering Pumps) comparison
 *   4. Suppressed examples by lane and why
 */

import {
  computePerUserFinalScore,
  classifyVisibility,
  applyTieBreaker,
} from "./server/laneScoring";

// ── Rep profiles ──

const DANIEL = {
  name: "Daniel",
  profile: {
    territories: ["WA"],
    assignedBusinessLines: ["Portable Air"],
    sectorFocus: ["mining", "oil_gas"],
    stageTiming: null,
    keyAccounts: ["BHP", "Rio Tinto", "Fortescue"],
    buyerRoles: null,
  },
};

const RYAN = {
  name: "Ryan",
  profile: {
    territories: ["WA"],
    assignedBusinessLines: ["Portable Air"],
    sectorFocus: ["mining"],
    stageTiming: null,
    keyAccounts: null,
    buyerRoles: null,
  },
};

const BRETT = {
  name: "Brett",
  profile: {
    territories: ["QLD"],
    assignedBusinessLines: ["Dewatering Pumps"],
    sectorFocus: ["mining", "infrastructure"],
    stageTiming: null,
    keyAccounts: null,
    buyerRoles: null,
  },
};

const QLD_PUMP_REP = {
  name: "QLD Pump Rep",
  profile: {
    territories: ["QLD"],
    assignedBusinessLines: ["Dewatering Pumps"],
    sectorFocus: ["mining"],
    stageTiming: null,
    keyAccounts: null,
    buyerRoles: null,
  },
};

// ── Project fixtures ──

const PROJECTS = [
  {
    id: 1,
    name: "Pilbara Iron Ore Expansion — Underground Development",
    location: "Western Australia, Pilbara",
    priority: "hot",
    sector: "mining",
    stage: "construction",
    opportunityRoute: "EPC contractor fleet supply",
    isNew: false,
    owner: "BHP",
    value: "$2.4B",
    overview: "Major iron ore mine expansion requiring drilling, blasting, and compressed air for underground development. MACA confirmed as contractor.",
    equipmentSignals: ["compressed air", "drilling", "blasting"],
    contractors: [{ name: "MACA Limited", status: "confirmed" }],
    blScores: [
      { dimension: "Portable Air", score: 88, confidence: 0.95, reasoning: "drilling and blasting" },
      { dimension: "Dewatering Pumps", score: 18, confidence: 0.4, reasoning: "minimal water" },
      { dimension: "PAL", score: 20, confidence: 0.4, reasoning: "shutdown lighting" },
      { dimension: "BESS", score: 5, confidence: 0.2, reasoning: "no BESS" },
    ],
    contacts: [
      { contactTrustTier: "send_ready", roleRelevance: "high", name: "John Smith", title: "Procurement Manager", email: "jsmith@bhp.com", linkedin: "https://linkedin.com/in/jsmith" },
    ],
  },
  {
    id: 2,
    name: "Moranbah Coal Mine Dewatering Expansion",
    location: "Queensland, Moranbah",
    priority: "hot",
    sector: "mining",
    stage: "construction",
    opportunityRoute: "Direct to mine operator",
    isNew: false,
    owner: "Anglo American",
    value: "$180M",
    overview: "Open cut coal mine expansion requiring extensive dewatering, groundwater management, and slurry pumping. No contractor confirmed yet.",
    equipmentSignals: ["dewatering", "pump", "groundwater", "slurry"],
    contractors: [],
    blScores: [
      { dimension: "Portable Air", score: 12, confidence: 0.3, reasoning: "minimal air" },
      { dimension: "Dewatering Pumps", score: 90, confidence: 0.97, reasoning: "dewatering and slurry" },
      { dimension: "PAL", score: 10, confidence: 0.3, reasoning: "no PAL" },
      { dimension: "BESS", score: 5, confidence: 0.2, reasoning: "no BESS" },
    ],
    contacts: [
      { contactTrustTier: "named_unverified", roleRelevance: "medium", name: "Jane Doe", title: "Site Manager", email: null, linkedin: null },
    ],
  },
  {
    id: 3,
    name: "Snowy 2.0 Tunnel Boring — Compressed Air Supply",
    location: "New South Wales, Snowy Mountains",
    priority: "hot",
    sector: "infrastructure",
    stage: "construction",
    opportunityRoute: "Subcontractor supply to Future Generation JV",
    isNew: false,
    owner: "Snowy Hydro",
    value: "$5.1B",
    overview: "Major hydroelectric tunnel boring project requiring high-volume compressed air for TBM operations, shotcrete, and pneumatic tools.",
    equipmentSignals: ["compressed air", "tunnel", "TBM", "pneumatic", "shotcrete"],
    contractors: [{ name: "Future Generation JV", status: "confirmed" }],
    blScores: [
      { dimension: "Portable Air", score: 82, confidence: 0.9, reasoning: "TBM and shotcrete" },
      { dimension: "Dewatering Pumps", score: 35, confidence: 0.6, reasoning: "tunnel dewatering" },
      { dimension: "PAL", score: 25, confidence: 0.5, reasoning: "tunnel lighting" },
      { dimension: "BESS", score: 8, confidence: 0.2, reasoning: "no BESS" },
    ],
    contacts: [],
  },
  {
    id: 4,
    name: "Fortescue Iron Bridge Magnetite — Shutdown Services",
    location: "Western Australia, Pilbara",
    priority: "warm",
    sector: "mining",
    stage: "production",
    opportunityRoute: "Shutdown contractor fleet",
    isNew: true,
    owner: "Fortescue",
    value: "$3.8B",
    overview: "Annual shutdown maintenance at Iron Bridge magnetite project. Requires portable air, lighting towers, and temporary power for maintenance activities.",
    equipmentSignals: ["shutdown", "maintenance", "temporary power", "lighting"],
    contractors: [],
    blScores: [
      { dimension: "Portable Air", score: 65, confidence: 0.8, reasoning: "shutdown air" },
      { dimension: "Dewatering Pumps", score: 10, confidence: 0.3, reasoning: "minimal water" },
      { dimension: "PAL", score: 70, confidence: 0.85, reasoning: "shutdown lighting" },
      { dimension: "BESS", score: 15, confidence: 0.3, reasoning: "no BESS" },
    ],
    contacts: [
      { contactTrustTier: "send_ready", roleRelevance: "high", name: "Mike Johnson", title: "Maintenance Manager", email: "mjohnson@fmg.com.au", linkedin: null },
    ],
  },
  {
    id: 5,
    name: "Queensland Copper Mine — New Dewatering System",
    location: "Queensland, Mount Isa",
    priority: "hot",
    sector: "mining",
    stage: "procurement",
    opportunityRoute: "Direct to mine owner",
    isNew: false,
    owner: "Glencore",
    value: "$45M",
    overview: "Underground copper mine requires new dewatering system to manage groundwater ingress. Pump selection underway.",
    equipmentSignals: ["dewatering", "underground", "pump", "groundwater"],
    contractors: [],
    blScores: [
      { dimension: "Portable Air", score: 30, confidence: 0.5, reasoning: "some air use" },
      { dimension: "Dewatering Pumps", score: 85, confidence: 0.92, reasoning: "dewatering system" },
      { dimension: "PAL", score: 12, confidence: 0.3, reasoning: "minimal PAL" },
      { dimension: "BESS", score: 5, confidence: 0.2, reasoning: "no BESS" },
    ],
    contacts: [
      { contactTrustTier: "send_ready", roleRelevance: "high", name: "Sarah Chen", title: "Mine Engineer", email: "schen@glencore.com", linkedin: "https://linkedin.com/in/schen" },
    ],
  },
  {
    id: 6,
    name: "Perth Airport Terminal Expansion",
    location: "Western Australia, Perth",
    priority: "warm",
    sector: "infrastructure",
    stage: "construction",
    opportunityRoute: "Main contractor supply",
    isNew: false,
    owner: "Perth Airport",
    value: "$1.2B",
    overview: "Major terminal expansion at Perth Airport. Commercial construction project with standard building services.",
    equipmentSignals: [],
    contractors: [{ name: "Multiplex", status: "confirmed" }],
    blScores: [
      { dimension: "Portable Air", score: 25, confidence: 0.4, reasoning: "construction air" },
      { dimension: "Dewatering Pumps", score: 15, confidence: 0.3, reasoning: "some drainage" },
      { dimension: "PAL", score: 30, confidence: 0.5, reasoning: "construction lighting" },
      { dimension: "BESS", score: 10, confidence: 0.2, reasoning: "no BESS" },
    ],
    contacts: [],
  },
  {
    id: 7,
    name: "Woodside Pluto LNG — Turnaround 2026",
    location: "Western Australia, Karratha",
    priority: "hot",
    sector: "oil_gas",
    stage: "planning",
    opportunityRoute: "Turnaround contractor fleet",
    isNew: true,
    owner: "Woodside",
    value: "$200M",
    overview: "Major LNG plant turnaround at Pluto. Requires large-volume portable air for vessel purging, pipeline commissioning, and pneumatic testing.",
    equipmentSignals: ["turnaround", "LNG", "compressed air", "pipeline commissioning", "pneumatic"],
    contractors: [],
    blScores: [
      { dimension: "Portable Air", score: 92, confidence: 0.97, reasoning: "LNG turnaround air" },
      { dimension: "Dewatering Pumps", score: 8, confidence: 0.2, reasoning: "no dewatering" },
      { dimension: "PAL", score: 45, confidence: 0.7, reasoning: "turnaround lighting" },
      { dimension: "BESS", score: 12, confidence: 0.3, reasoning: "no BESS" },
    ],
    contacts: [],
  },
  {
    id: 8,
    name: "Sydney CBD Office Tower — Commercial Fitout",
    location: "New South Wales, Sydney",
    priority: "cold",
    sector: "infrastructure",
    stage: "planning",
    opportunityRoute: "commercial fitout",
    isNew: false,
    owner: "Mirvac",
    value: "$50M",
    overview: "Commercial office fitout in Sydney CBD. Retail and office space renovation. Standard building services only.",
    equipmentSignals: [],
    contractors: [],
    blScores: [
      { dimension: "Portable Air", score: 5, confidence: 0.2, reasoning: "office fitout" },
      { dimension: "Dewatering Pumps", score: 3, confidence: 0.1, reasoning: "no water works" },
      { dimension: "PAL", score: 8, confidence: 0.2, reasoning: "minimal lighting" },
      { dimension: "BESS", score: 2, confidence: 0.1, reasoning: "no BESS" },
    ],
    contacts: [],
  },
  {
    id: 9,
    name: "Carmichael Coal Mine — Exploration Drilling Program",
    location: "Queensland, Galilee Basin",
    priority: "warm",
    sector: "mining",
    stage: "exploration",
    opportunityRoute: "Drilling contractor supply",
    isNew: false,
    owner: "Adani",
    value: "$30M",
    overview: "Ongoing exploration drilling program at Carmichael. Requires portable air compressors for RC and diamond drilling rigs.",
    equipmentSignals: ["drilling", "exploration", "RC drilling", "compressed air"],
    contractors: [{ name: "Swick Mining Services", status: "predicted" }],
    blScores: [
      { dimension: "Portable Air", score: 78, confidence: 0.88, reasoning: "RC drilling air" },
      { dimension: "Dewatering Pumps", score: 20, confidence: 0.4, reasoning: "some site drainage" },
      { dimension: "PAL", score: 15, confidence: 0.3, reasoning: "minimal lighting" },
      { dimension: "BESS", score: 5, confidence: 0.2, reasoning: "no BESS" },
    ],
    contacts: [],
  },
  {
    id: 10,
    name: "North West Shelf Gas Pipeline — Pre-commissioning",
    location: "Western Australia, Pilbara",
    priority: "warm",
    sector: "oil_gas",
    stage: "construction",
    opportunityRoute: "Pipeline contractor supply",
    isNew: false,
    owner: "Chevron",
    value: "$800M",
    overview: "Gas pipeline pre-commissioning requiring high-pressure compressed air for hydrostatic testing and purging.",
    equipmentSignals: ["pipeline commissioning", "compressed air", "hydrostatic testing"],
    contractors: [],
    blScores: [
      { dimension: "Portable Air", score: 75, confidence: 0.85, reasoning: "pipeline commissioning" },
      { dimension: "Dewatering Pumps", score: 10, confidence: 0.3, reasoning: "minimal water" },
      { dimension: "PAL", score: 20, confidence: 0.4, reasoning: "site lighting" },
      { dimension: "BESS", score: 8, confidence: 0.2, reasoning: "no BESS" },
    ],
    contacts: [],
  },
  {
    id: 11,
    name: "Gladstone LNG — Dewatering for New Pond",
    location: "Queensland, Gladstone",
    priority: "warm",
    sector: "oil_gas",
    stage: "planning",
    opportunityRoute: "Direct to operator",
    isNew: true,
    owner: "Santos",
    value: "$25M",
    overview: "New evaporation pond construction at GLNG facility. Requires dewatering pumps for site preparation and groundwater management.",
    equipmentSignals: ["dewatering", "groundwater", "pump"],
    contractors: [],
    blScores: [
      { dimension: "Portable Air", score: 15, confidence: 0.3, reasoning: "minimal air" },
      { dimension: "Dewatering Pumps", score: 72, confidence: 0.85, reasoning: "pond dewatering" },
      { dimension: "PAL", score: 18, confidence: 0.3, reasoning: "site lighting" },
      { dimension: "BESS", score: 10, confidence: 0.2, reasoning: "no BESS" },
    ],
    contacts: [],
  },
  {
    id: 12,
    name: "Brisbane Cross River Rail — Tunnel Dewatering",
    location: "Queensland, Brisbane",
    priority: "hot",
    sector: "infrastructure",
    stage: "construction",
    opportunityRoute: "Tunnel contractor supply",
    isNew: false,
    owner: "Queensland Government",
    value: "$6.3B",
    overview: "Major rail tunnel project in Brisbane CBD requiring continuous dewatering and groundwater management throughout construction.",
    equipmentSignals: ["dewatering", "tunnel", "groundwater", "drainage"],
    contractors: [{ name: "CPB Contractors", status: "confirmed" }],
    blScores: [
      { dimension: "Portable Air", score: 35, confidence: 0.5, reasoning: "tunnel air" },
      { dimension: "Dewatering Pumps", score: 88, confidence: 0.93, reasoning: "tunnel dewatering" },
      { dimension: "PAL", score: 30, confidence: 0.5, reasoning: "tunnel lighting" },
      { dimension: "BESS", score: 8, confidence: 0.2, reasoning: "no BESS" },
    ],
    contacts: [
      { contactTrustTier: "send_ready", roleRelevance: "high", name: "Tom Wilson", title: "Plant Manager", email: "twilson@cpb.com.au", linkedin: null },
    ],
  },
];

// ── Scoring helper ──

function scoreProject(project: typeof PROJECTS[0], rep: typeof DANIEL) {
  const scored = computePerUserFinalScore(
    project,
    rep.profile,
    project.blScores,
    project.contacts,
  );
  const visibility = classifyVisibility(scored, (rep.profile.assignedBusinessLines?.length ?? 0) > 0);
  return { project, scored, visibility };
}

function rankProjects(rep: typeof DANIEL) {
  return PROJECTS
    .map(p => scoreProject(p, rep))
    .sort((a, b) => b.scored.finalScore - a.scored.finalScore);
}

// ── Output ──

function printTop10(rep: typeof DANIEL) {
  const ranked = rankProjects(rep);
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${rep.name} (${rep.profile.assignedBusinessLines?.join(", ")} | ${rep.profile.territories?.join(", ")}) — Top 10`);
  console.log("=".repeat(70));
  console.log(
    `${"#".padEnd(3)} ${"Score".padEnd(6)} ${"Lane".padEnd(6)} ${"Vis".padEnd(22)} ${"Channel".padEnd(12)} ${"Project".padEnd(45)} ${"Reason codes"}`
  );
  console.log("-".repeat(130));
  ranked.slice(0, 10).forEach((r, i) => {
    const { project, scored, visibility } = r;
    console.log(
      `${String(i + 1).padEnd(3)} ${String(scored.finalScore).padEnd(6)} ${scored.laneFitLabel.padEnd(6)} ${visibility.padEnd(22)} ${scored.channel.padEnd(12)} ${project.name.slice(0, 44).padEnd(45)} ${scored.reasonCodes.slice(0, 4).join(", ")}`
    );
  });
}

function printSuppressedExamples(rep: typeof DANIEL) {
  const ranked = rankProjects(rep);
  const suppressed = ranked.filter(r => r.visibility === "suppress" || r.visibility === "monitor_only");
  console.log(`\n--- ${rep.name}: Suppressed/Monitor-only examples ---`);
  suppressed.slice(0, 4).forEach(r => {
    console.log(`  [${r.visibility}] ${r.project.name.slice(0, 50)} | score=${r.scored.finalScore} | lane=${r.scored.primaryLaneScore} | crosssell=${r.scored.laneScores.crossSellFit} | codes=${r.scored.reasonCodes.join(", ")}`);
  });
}

// ── Run ──

printTop10(DANIEL);
printTop10(QLD_PUMP_REP);

// Ryan vs Brett comparison
console.log(`\n${"=".repeat(70)}`);
console.log("Ryan (WA PA) vs Brett (QLD Pump) — Head-to-head on shared projects");
console.log("=".repeat(70));
console.log(`${"Project".padEnd(48)} ${"Ryan".padEnd(8)} ${"Brett".padEnd(8)} ${"Winner"}`);
console.log("-".repeat(80));
PROJECTS.forEach(p => {
  const ryan = computePerUserFinalScore(p, RYAN.profile, p.blScores, p.contacts);
  const brett = computePerUserFinalScore(p, BRETT.profile, p.blScores, p.contacts);
  const winner = ryan.finalScore > brett.finalScore ? "Ryan" : brett.finalScore > ryan.finalScore ? "Brett" : "Tie";
  console.log(`${p.name.slice(0, 47).padEnd(48)} ${String(ryan.finalScore).padEnd(8)} ${String(brett.finalScore).padEnd(8)} ${winner}`);
});

printSuppressedExamples(DANIEL);
printSuppressedExamples(QLD_PUMP_REP);
