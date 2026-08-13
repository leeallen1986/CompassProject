import { getThisWeekSummary } from "../thisWeekService";
import * as fs from "fs";

async function main() {
  const RYAN_USER_ID = 2340043;
  const summary = await getThisWeekSummary(RYAN_USER_ID);
  const outDir = "artifacts/ryan-current-dashboard-audit-" + new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/ryan-dashboard-raw.json`, JSON.stringify(summary, null, 2));
  console.log(`OUTDIR=${outDir}`);
  console.log(`PROJECTS=${(summary as any).projects?.length ?? 0}`);
  console.log(`WEEK_LABEL=${(summary as any).weekLabel ?? "unknown"}`);
  console.log(`GENERATED=${(summary as any).generatedAt ?? (summary as any).lastUpdated ?? "unknown"}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
