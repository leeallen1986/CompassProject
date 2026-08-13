import * as fs from "fs";
import { getProjectBuyerRouteInputs } from "../db";
import { buildProjectBuyerRoute } from "../projectBuyerRoute";

async function main() {
  // Load the frozen dashboard to get project IDs
  const dashDir = fs.readdirSync("artifacts").filter(d => d.startsWith("ryan-current-dashboard-audit-")).sort().pop();
  if (!dashDir) throw new Error("No dashboard artifact found");
  const raw = JSON.parse(fs.readFileSync(`artifacts/${dashDir}/ryan-dashboard-raw.json`, "utf-8"));
  const projectIds = raw.topProjects.map((p: any) => p.id);
  console.log(`Processing ${projectIds.length} projects: ${projectIds.join(", ")}`);
  
  const dossiers: any[] = [];
  for (const pid of projectIds) {
    try {
      const inputs = await getProjectBuyerRouteInputs(pid);
      const route = buildProjectBuyerRoute(inputs);
      dossiers.push({ projectId: pid, inputs, route });
    } catch (e: any) {
      dossiers.push({ projectId: pid, error: e.message });
    }
  }
  
  fs.writeFileSync(`artifacts/${dashDir}/ryan-buyer-dossiers.json`, JSON.stringify(dossiers, null, 2));
  console.log(`DOSSIERS_WRITTEN=${dossiers.length}`);
  console.log(`ERRORS=${dossiers.filter(d => d.error).length}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
