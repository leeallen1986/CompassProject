import { computePerUserFinalScore, classifyVisibility, LANE_SUPPRESS_THRESHOLD, LANE_CROSSSELL_THRESHOLD, LANE_ACTIONABILITY_THRESHOLD } from "./server/laneScoring";

const DEWATER_PROJECT = {
  id: 2, name: "Moranbah Coal Mine Dewatering", location: "Queensland, Moranbah",
  priority: "hot", sector: "mining", stage: "construction",
  opportunityRoute: "EPC contractor fleet supply", isNew: false, owner: "BHP",
  value: "1B", overview: "Open cut coal mine expansion requiring extensive dewatering, groundwater management, and slurry pumping.",
  equipmentSignals: ["dewatering", "pump", "groundwater"], contractors: [] as unknown[],
};
const DEWATER_BL = [
  { dimension: "Portable Air", score: 15, confidence: 0.4, reasoning: "minimal air" },
  { dimension: "Dewatering Pumps", score: 88, confidence: 0.95, reasoning: "dewatering and slurry" },
  { dimension: "PAL", score: 10, confidence: 0.3, reasoning: "no PAL" },
  { dimension: "BESS", score: 5, confidence: 0.2, reasoning: "no BESS" },
];
const QLD_PUMP = { territories: ["QLD"], assignedBusinessLines: ["Dewatering Pumps"], sectorFocus: ["mining"] };
const WA_PA = { territories: ["WA"], assignedBusinessLines: ["Portable Air"], sectorFocus: ["mining"] };

const qld = computePerUserFinalScore(DEWATER_PROJECT, QLD_PUMP, DEWATER_BL, []);
const wa = computePerUserFinalScore(DEWATER_PROJECT, WA_PA, DEWATER_BL, []);
console.log("=== QLD Pump rep on QLD dewatering project ===");
console.log("finalScore:", qld.finalScore, "primaryLaneScore:", qld.primaryLaneScore);
console.log("baseScore:", qld.baseScore.total, "breakdown:", JSON.stringify(qld.baseScore.breakdown));
console.log("laneScores:", JSON.stringify(qld.laneScores));
console.log("laneSuppressed:", qld.laneSuppressed, "laneFitLabel:", qld.laneFitLabel);
console.log("reasonCodes:", qld.reasonCodes);

console.log("\n=== WA Portable Air rep on QLD dewatering project ===");
console.log("finalScore:", wa.finalScore, "primaryLaneScore:", wa.primaryLaneScore);
console.log("baseScore:", wa.baseScore.total, "breakdown:", JSON.stringify(wa.baseScore.breakdown));
console.log("laneScores:", JSON.stringify(wa.laneScores));
console.log("laneSuppressed:", wa.laneSuppressed, "laneFitLabel:", wa.laneFitLabel);
console.log("reasonCodes:", wa.reasonCodes);

console.log("\n=== Suppression thresholds ===");
console.log("LANE_SUPPRESS_THRESHOLD:", LANE_SUPPRESS_THRESHOLD);
console.log("LANE_CROSSSELL_THRESHOLD:", LANE_CROSSSELL_THRESHOLD);
console.log("LANE_ACTIONABILITY_THRESHOLD:", LANE_ACTIONABILITY_THRESHOLD);

// Cross-sell check for QLD Pump
console.log("\n=== Cross-sell check for QLD Pump on WA mining project ===");
const BASE_PROJECT = {
  id: 1, name: "Pilbara Iron Ore Expansion", location: "Western Australia, Pilbara",
  priority: "hot", sector: "mining", stage: "construction",
  opportunityRoute: "EPC contractor fleet supply", isNew: false, owner: "BHP",
  value: "2.4B", overview: "Major iron ore mine expansion requiring drilling, blasting, and compressed air for underground development.",
  equipmentSignals: ["compressed air", "drilling"],
  contractors: [{ name: "MACA Limited", status: "confirmed" }] as unknown[],
};
const MINING_BL = [
  { dimension: "Portable Air", score: 85, confidence: 0.9, reasoning: "drilling and blasting" },
  { dimension: "Dewatering Pumps", score: 20, confidence: 0.5, reasoning: "minimal water works" },
  { dimension: "PAL", score: 15, confidence: 0.4, reasoning: "some shutdown work" },
  { dimension: "BESS", score: 5, confidence: 0.3, reasoning: "no energy storage" },
];
const qldOnMining = computePerUserFinalScore(BASE_PROJECT, QLD_PUMP, MINING_BL, []);
console.log("QLD Pump on WA mining project:");
console.log("finalScore:", qldOnMining.finalScore, "primaryLaneScore:", qldOnMining.primaryLaneScore);
console.log("laneScores.crossSellFit:", qldOnMining.laneScores.crossSellFit);
console.log("laneSuppressed:", qldOnMining.laneSuppressed);
console.log("actionabilityScore:", qldOnMining.baseScore.breakdown.contactQuality + qldOnMining.baseScore.breakdown.routeToBuyClarity);
console.log("reasonCodes:", qldOnMining.reasonCodes);
