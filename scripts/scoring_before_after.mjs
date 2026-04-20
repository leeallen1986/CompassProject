/**
 * Stage 2 Before/After Scoring Comparison
 * Runs the new computeScore on all 10 required Atlas examples.
 * Also shows what the v1 logic would have produced.
 */

import { createRequire } from "module";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Use tsx to handle TypeScript imports
const { execSync } = await import("child_process");
const result = execSync(
  `cd /home/ubuntu/atlas-copco-intelligence && npx tsx --eval "
import { classifyTitle, computeScore, classifyCompany } from './server/campaignService.ts';

const cases = [
  // ── v1 Known Misfires ──
  {
    label: 'BDM at blasting company (v1 misfire: tier1_hot)',
    contact: { title: 'Business Development Manager', email: 'james@orontide.com.au', company: 'Orontide Alphablast', matchedProjectCount: 2 },
  },
  {
    label: 'Director / Accounts Payable (v1 misfire: tier1_hot)',
    contact: { title: 'Director / Accounts Payable', email: 'sarah@bhp.com', company: 'BHP Group', matchedProjectCount: 1 },
  },
  {
    label: 'Generic Engineer at blasting company (v1 misfire: tier1_hot)',
    contact: { title: 'Engineer', email: 'david@allblast.com.au', company: 'Allblast Services', matchedProjectCount: 1 },
  },
  {
    label: 'Scaffolding company receiving blasting bonus (v1 misfire)',
    contact: { title: 'Operations Manager', email: 'mike@scaffold.com.au', company: 'WA Scaffold Services', matchedProjectCount: 0 },
  },
  // ── Required Atlas Examples ──
  {
    label: 'MD at primary blasting company (should be tier1_hot)',
    contact: { title: 'Managing Director', email: 'ceo@orontide.com.au', company: 'Orontide Alphablast', matchedProjectCount: 3 },
  },
  {
    label: 'Blasting Supervisor at primary company (should be tier1_hot)',
    contact: { title: 'Blasting Supervisor', email: 'sup@allblast.com.au', company: 'Allblast Services', matchedProjectCount: 2 },
  },
  {
    label: 'Procurement Manager at secondary company (should be tier2_warm)',
    contact: { title: 'Procurement Manager', email: 'pm@monadelphous.com.au', company: 'Monadelphous', matchedProjectCount: 1 },
  },
  {
    label: 'IT Director (should be score=5, excluded from tier1)',
    contact: { title: 'Director of IT', email: 'it@bhp.com', company: 'BHP Group', matchedProjectCount: 5 },
  },
  {
    label: 'Accounts Payable (should be excluded tier)',
    contact: { title: 'Accounts Payable', email: 'ap@cimic.com.au', company: 'CIMIC Group', matchedProjectCount: 0 },
  },
  {
    label: 'No title, no email (should be tier4_low)',
    contact: { title: null, email: null, company: 'Unknown Company', matchedProjectCount: 0 },
  },
  {
    label: 'Fleet Manager at primary company, no email (should be tier3_enrich)',
    contact: { title: 'Fleet Manager', email: null, company: 'Orontide Alphablast', matchedProjectCount: 1 },
  },
  {
    label: 'Coating Specialist at non-blasting company (should be tier2_warm)',
    contact: { title: 'Coating Specialist', email: 'cs@thiess.com.au', company: 'Thiess', matchedProjectCount: 0 },
  },
];

const rows = [];
for (const c of cases) {
  const bd = computeScore(c.contact);
  rows.push({
    label: c.label,
    title: c.contact.title,
    company: c.contact.company,
    hasEmail: !!c.contact.email,
    projects: c.contact.matchedProjectCount,
    titleScore: bd.titleScore,
    emailBonus: bd.emailBonus,
    mobileBonus: bd.mobileBonus,
    companyBonus: bd.companyBonus,
    companyTier: bd.companyTier,
    projectBonus: bd.projectMatchBonus,
    finalScore: bd.finalScore,
    finalTier: bd.finalTier,
    roleBucket: bd.roleBucket,
    companyBonusBlocked: bd.companyBonusBlocked,
    tier1Blocked: bd.tier1Blocked,
    reasoning: bd.reasoningSummary,
  });
}
console.log(JSON.stringify(rows, null, 2));
"`,
  { encoding: "utf8" }
);

const rows = JSON.parse(result);

// Print as a table
console.log("\n=== Stage 2 Scoring: Before/After Results ===\n");
for (const r of rows) {
  console.log(`▶ ${r.label}`);
  console.log(`  Title: "${r.title}" | Company: "${r.company}" | Email: ${r.hasEmail} | Projects: ${r.projects}`);
  console.log(`  Score breakdown: title=${r.titleScore} + email=${r.emailBonus} + mobile=${r.mobileBonus} + company=${r.companyBonus}(${r.companyTier}) + projects=${r.projectBonus}`);
  if (r.companyBonusBlocked) console.log(`  ⚠ Company bonus BLOCKED (title gate)`);
  if (r.tier1Blocked) console.log(`  ⚠ tier1_hot BLOCKED (${r.roleBucket} bucket)`);
  console.log(`  → FINAL: score=${r.finalScore}, tier=${r.finalTier}, bucket=${r.roleBucket}`);
  console.log(`  Reasoning: ${r.reasoning}`);
  console.log();
}
