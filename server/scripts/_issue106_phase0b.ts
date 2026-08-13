import { getThisWeekSummary } from "../thisWeekService.js";
import { getAllUsers } from "../db.js";
import * as crypto from "crypto";
import * as fs from "fs";

async function main() {
  const allUsers = await getAllUsers();
  
  const ryan = allUsers.find(u => u.name?.includes("Ryan"));
  const paul = allUsers.find(u => u.name?.includes("Paul"));
  const dan = allUsers.find(u => u.name?.includes("Dan"));
  
  console.log("=== ACTIVE USERS ===");
  console.log(`Ryan: id=${ryan?.id}, name=${ryan?.name}`);
  console.log(`Paul: id=${paul?.id}, name=${paul?.name}`);
  console.log(`Dan:  id=${dan?.id}, name=${dan?.name}`);
  
  if (!paul?.id || !dan?.id) { console.log("ERROR: Paul or Dan not found"); process.exit(1); }
  
  const paulSummary = await getThisWeekSummary(paul.id);
  const paulCompact = {
    userId: paul.id, weekLabel: paulSummary.weekLabel,
    topProjects: paulSummary.topProjects.map((p: any) => ({
      projectId: p.projectId, priority: p.priority, airFit: p.airFit,
      opportunityType: p.opportunityType, channel: p.channel,
      contactCTAAction: p.contactCTA?.action, bestStakeholderPresent: !!p.bestStakeholder,
    })),
    suggestedActions: paulSummary.suggestedActions?.map((a: any) => ({ action: a.action, type: a.type })) || [],
  };
  const paulHash = crypto.createHash("sha256").update(JSON.stringify(paulCompact)).digest("hex");
  console.log(`\nPaul hash: ${paulHash}`);
  console.log(`Paul projects (${paulCompact.topProjects.length}): ${paulCompact.topProjects.map((p: any) => p.projectId).join(", ")}`);
  
  const danSummary = await getThisWeekSummary(dan.id);
  const danCompact = {
    userId: dan.id, weekLabel: danSummary.weekLabel,
    topProjects: danSummary.topProjects.map((p: any) => ({
      projectId: p.projectId, priority: p.priority, airFit: p.airFit,
      opportunityType: p.opportunityType, channel: p.channel,
      contactCTAAction: p.contactCTA?.action, bestStakeholderPresent: !!p.bestStakeholder,
    })),
    suggestedActions: danSummary.suggestedActions?.map((a: any) => ({ action: a.action, type: a.type })) || [],
  };
  const danHash = crypto.createHash("sha256").update(JSON.stringify(danCompact)).digest("hex");
  console.log(`\nDan hash: ${danHash}`);
  console.log(`Dan projects (${danCompact.topProjects.length}): ${danCompact.topProjects.map((p: any) => p.projectId).join(", ")}`);
  
  const control = { paul: { compact: paulCompact, stableHash: paulHash }, dan: { compact: danCompact, stableHash: danHash } };
  fs.writeFileSync("/tmp/issue106-non-ryan-control-before.json", JSON.stringify(control, null, 2));
  console.log("\nSaved to /tmp/issue106-non-ryan-control-before.json");
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
