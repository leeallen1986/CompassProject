import * as dotenv from "dotenv";
dotenv.config();

import { getProjectScoresBatch } from "../server/businessLineScoring";

const ids = [4, 7, 8, 120229, 120230, 510034, 120007, 120008];

async function main() {
  const map = await getProjectScoresBatch(ids);
  for (const id of ids) {
    const scores = map.get(id) ?? [];
    const pa = scores.find(s => s.dimension === "Portable Air & Low Pressure");
    const all = scores.map(s => `${s.dimension}:${s.score}`).join(" | ");
    console.log(`ID ${id} | PA score: ${pa?.score ?? "NONE"} | All: ${all}`);
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
