/**
 * Stage 5D Backfill Script
 * Classifies all projects in the database with projectType, stageCode,
 * stageConfidence, suppressed, and suppressionReason.
 *
 * Run: node scripts/backfill_stage5d.mjs
 */

import "dotenv/config";
import { createConnection } from "mysql2/promise";

// ─── Inline classification logic (mirrors server/db.ts Stage 5D functions) ───

function normalizeStageCode(stage) {
  if (!stage || stage.trim() === "") return { code: "unknown", confidence: 0.3 };
  const s = stage.toLowerCase().trim();

  if (/\bdecommission(ed|ing)?\b/.test(s)) return { code: "cancelled", confidence: 0.95 };
  if (/\bcancell?ed?\b/.test(s)) return { code: "cancelled", confidence: 0.95 };
  if (/\bwithdrawn\b/.test(s)) return { code: "cancelled", confidence: 0.9 };
  if (/\bclosed\b/.test(s) && !/\bclose to\b/.test(s)) return { code: "cancelled", confidence: 0.85 };
  if (/\bfully complete[d]?\b/.test(s)) return { code: "completed", confidence: 0.95 };
  if (/^completed$/.test(s)) return { code: "completed", confidence: 0.98 };
  if (/\bcomplete[d]?\s*(and\s*operational|\/\s*operational)?\b/.test(s) && !/\bnear(ing)?\s*complet\b/.test(s) && !/\bearly works near completion\b/.test(s)) return { code: "completed", confidence: 0.9 };
  if (/\bcommission(ed|ing)?\b/.test(s) && /\bcomplete[d]?\b/.test(s)) return { code: "completed", confidence: 0.9 };
  if (/\bcommissioning\b/.test(s)) return { code: "commissioning", confidence: 0.9 };
  if (/\bcommission(ed)?\b/.test(s) && !/\bpre-?commission\b/.test(s)) return { code: "commissioning", confidence: 0.85 };

  if (/\boperational\s*\/\s*(expan|upgrad|extend)/.test(s)) return { code: "operational", confidence: 0.85 };
  if (/\boperational\b/.test(s)) return { code: "operational", confidence: 0.8 };
  if (/\boperating\b/.test(s)) return { code: "operational", confidence: 0.75 };
  if (/\bongoing\s*(operations|production)\b/.test(s)) return { code: "operational", confidence: 0.8 };
  if (/\bramp.?up\b/.test(s) && !/\bpre.?construction\b/.test(s)) return { code: "operational", confidence: 0.7 };

  if (/\bunder\s*construction\b/.test(s)) return { code: "construction", confidence: 0.95 };
  if (/\bconstruction\s*(commenced|started|underway|ongoing|progressing|has\s*begun)\b/.test(s)) return { code: "construction", confidence: 0.95 };
  if (/\bconstruction\b/.test(s) && !/\bpre.?construction\b/.test(s)) return { code: "construction", confidence: 0.85 };
  if (/\bunderway\b/.test(s)) return { code: "construction", confidence: 0.7 };
  if (/\btunnell?ing\b/.test(s)) return { code: "construction", confidence: 0.85 };

  if (/\bawarded?\b/.test(s)) return { code: "awarded", confidence: 0.9 };
  if (/\bcontract\s*(award|signed|executed)\b/.test(s)) return { code: "awarded", confidence: 0.9 };
  if (/\bcommitted\b/.test(s)) return { code: "awarded", confidence: 0.75 };

  if (/\bprocurement\b/.test(s)) return { code: "procurement", confidence: 0.9 };
  if (/\btender(ing)?\b/.test(s)) return { code: "procurement", confidence: 0.85 };
  if (/\bdesign\s*\/?\s*procurement\b/.test(s)) return { code: "procurement", confidence: 0.85 };
  if (/\bdesign\b/.test(s) && !/\bpre.?design\b/.test(s)) return { code: "design", confidence: 0.8 };

  if (/\bplanning\b/.test(s)) return { code: "planning", confidence: 0.85 };
  if (/\bpre.?construction\b/.test(s)) return { code: "planning", confidence: 0.8 };
  if (/\bearly\s*works?\b/.test(s)) return { code: "planning", confidence: 0.75 };
  if (/\bdevelopment\b/.test(s)) return { code: "planning", confidence: 0.7 };
  if (/\bfunding\s*(secured|committed|approved)\b/.test(s)) return { code: "planning", confidence: 0.7 };
  if (/\bpermits?\s*(secured|approved|received)\b/.test(s)) return { code: "planning", confidence: 0.75 };
  if (/\bfast.?track\b/.test(s)) return { code: "planning", confidence: 0.7 };

  if (/\bfeasibility\b/.test(s)) return { code: "feasibility", confidence: 0.9 };
  if (/\benvironmental\s*(approvals?|assessment|impact)\b/.test(s)) return { code: "feasibility", confidence: 0.8 };
  if (/\bpre.?feasibility\b/.test(s)) return { code: "feasibility", confidence: 0.85 };
  if (/\bscoping\b/.test(s)) return { code: "feasibility", confidence: 0.75 };
  if (/\bproposed\b/.test(s)) return { code: "feasibility", confidence: 0.65 };
  if (/\bconcept\b/.test(s)) return { code: "feasibility", confidence: 0.6 };
  if (/\badvocating?\b/.test(s)) return { code: "feasibility", confidence: 0.55 };

  if (/\bexploration\b/.test(s)) return { code: "exploration", confidence: 0.9 };
  if (/\bdrilling\b/.test(s) && !/\bdrilling\s*complete\b/.test(s)) return { code: "exploration", confidence: 0.85 };
  if (/\bresource\s*(definition|extension|delineation)\b/.test(s)) return { code: "exploration", confidence: 0.85 };
  if (/\bspudded?\b/.test(s)) return { code: "exploration", confidence: 0.9 };
  if (/\bregional\s*exploration\b/.test(s)) return { code: "exploration", confidence: 0.9 };

  return { code: "unknown", confidence: 0.3 };
}

function computeStageConfidence({ stage, owner, contractors, sources, priority }) {
  const { code, confidence: base } = normalizeStageCode(stage);
  let score = base;
  const genericOwners = new Set(["unknown", "n/a", "tbc", "tbd", "various", "multiple", "national electricity market (nem)"]);
  const ownerLower = (owner ?? "").toLowerCase().trim();
  if (ownerLower && !genericOwners.has(ownerLower) && !ownerLower.startsWith("various") && !ownerLower.startsWith("multiple")) {
    score += 0.10;
  } else if (!ownerLower || genericOwners.has(ownerLower)) {
    score -= 0.10;
  }
  if (contractors && contractors.length > 0) {
    const named = contractors.filter(c => c.name && c.name.toLowerCase() !== "unknown" && c.name.toLowerCase() !== "tbc");
    if (named.length > 0) score += 0.10;
  }
  if (sources && sources.length > 0) score += 0.05;
  if (priority === "hot") score += 0.05;
  if (code === "unknown") score -= 0.15;
  return Math.min(0.99, Math.max(0.05, Math.round(score * 100) / 100));
}

const MACRO_NAME_PATTERNS = [
  /\broadmap\b/, /\bstrategy\b/, /\bpolicy\b/, /\bframework\b/,
  /\bcritical\s*minerals?\s*(strategy|policy|roadmap|for\s*defence)\b/,
  /\bnational\s+rollout\b/, /\bmarket\s*(update|commentary|analysis|trend)\b/,
  /\bindustry\s*(update|commentary|trend)\b/, /\btransition\s*(plan|roadmap|strategy)\b/,
  /\bclimate\s*(policy|strategy|plan)\b/, /\bnet\s*zero\s*(strategy|roadmap|plan|target)\b/,
  /\brenewable\s*energy\s*(target|policy|zone)\b/, /\belectricity\s*(market|network)\s*(reform|update|plan)\b/,
  /\bhydrogen\s*(strategy|roadmap|policy)\b/, /\boffshore\s*wind\s*(zone|policy|roadmap)\b/,
];
const MACRO_STAGE_PATTERNS = [
  /\bpolicy.?driven\b/, /\badvocating?\b/, /\bconcept\s*\/?\s*advocacy\b/, /\bearly.?stage.*policy\b/,
];
const PROGRAM_WRAPPER_PATTERNS = [
  /\bprogram(me)?\b.*\bfunding\b/, /\bfunding\s*(program(me)?|round|package|pool)\b/,
  /\bportfolio\s*of\b/, /\bblack\s*spot\s*program\b/, /\binfrastructure\s*(fund|package|program(me)?)\b/,
  /\bclean\s*energy\s*finance\s*corporation\b/, /\bcefc\b/, /\baren[ae]\b.*\bfund\b/,
  /\bsage\s*fund\b/, /\bstate\s*(government)?\s*(initiative|program(me)?|fund)\b/,
];
const BACKGROUND_STAGE_PATTERNS = [
  /^operational$/, /\boperational\s*-?\s*(maintenance|monitoring|outage)\b/,
  /\bongoing\s*operations?\b/, /\boperating\b/, /\bcompleted?\s*\/?\s*operational\b/,
  /\boperational\s*\(post.?incident\)\b/, /\boperational,?\s*scheme\s*closing\b/,
];
const BACKGROUND_NAME_PATTERNS = [
  /\boperations?\b.*\b(ramp.?up|ongoing|post.?earthquake)\b/,
  /\bdischarge\s*records?\b/, /\bmonitoring\b/, /\boutage[s]?\b/,
  /\brefinery\s*operations?\b/, /\bquarry\s*operation\b/,
];
const AUSTENDER_CONTRACT_ID_PATTERN = /^\d{5,}(\/\d+)?\s*—/;

function inferProjectType({ name, stage, owner, location, stageCode }) {
  const nameLower = name.toLowerCase();
  const stageLower = (stage ?? "").toLowerCase();
  const ownerLower = (owner ?? "").toLowerCase();
  const locationLower = (location ?? "").toLowerCase();

  if (AUSTENDER_CONTRACT_ID_PATTERN.test(name)) {
    if (/department\s*of|government|dfat|home\s*affairs|foreign\s*affairs/.test(ownerLower)) {
      return "macro_item";
    }
  }
  for (const p of MACRO_NAME_PATTERNS) if (p.test(nameLower)) return "macro_item";
  for (const p of MACRO_STAGE_PATTERNS) if (p.test(stageLower)) return "macro_item";

  const isNational = /\bnational\b/.test(locationLower) || locationLower === "national";
  const isVagueOwner = /^(various|multiple|nem|national electricity market|state government|federal government|australian government)/.test(ownerLower.trim());
  const isVagueName = /\brecords?\b|\bmonitoring\b|\brollout\b|\bexpansion\b/.test(nameLower) && isNational && isVagueOwner;
  if (isVagueName) return "macro_item";

  for (const p of PROGRAM_WRAPPER_PATTERNS) if (p.test(nameLower)) return "program_wrapper";

  const hasExpansionSignal = /\bexpan(d|sion)\b|\bupgrad(e|ing)\b|\bnew\s*(package|stage|phase|contract|work)\b|\bextension\b/.test(nameLower) ||
    /\bexpan(d|sion)\b|\bupgrad(e|ing)\b|\bnew\s*(package|stage|phase|contract|work)\b|\bextension\b/.test(stageLower);

  if (stageCode === "operational" && !hasExpansionSignal) return "background_account";
  for (const p of BACKGROUND_STAGE_PATTERNS) if (p.test(stageLower) && !hasExpansionSignal) return "background_account";
  for (const p of BACKGROUND_NAME_PATTERNS) if (p.test(nameLower) && !hasExpansionSignal) return "background_account";

  return "opportunity";
}

function evaluateSuppression({ projectType, stageCode, stageConfidence, owner }) {
  const ownerLower = (owner ?? "").toLowerCase().trim();
  const genericOwners = new Set(["unknown", "n/a", "tbc", "tbd", ""]);
  const hasNamedOwner = ownerLower.length > 0 && !genericOwners.has(ownerLower);

  if (stageCode === "completed") return { suppressed: true, suppressionReason: "Project is completed — no active opportunity" };
  if (stageCode === "cancelled") return { suppressed: true, suppressionReason: "Project is cancelled or decommissioned" };
  if (projectType === "macro_item") return { suppressed: true, suppressionReason: "Macro/policy item — no specific buying route or target entity" };
  if (projectType === "program_wrapper") return { suppressed: true, suppressionReason: "Programme wrapper — umbrella funding item, specific packages should be tracked separately" };
  if (projectType === "background_account") return { suppressed: true, suppressionReason: "Background operational account — no new opportunity signal" };
  if (stageConfidence < 0.25 && !hasNamedOwner) return { suppressed: true, suppressionReason: "Very low confidence and no named owner — insufficient signal for rep action" };

  return { suppressed: false, suppressionReason: null };
}

function classifyProject({ name, stage, owner, location, contractors, sources, priority }) {
  const { code: stageCode } = normalizeStageCode(stage);
  const stageConfidence = computeStageConfidence({ stage, owner, contractors, sources, priority });
  const projectType = inferProjectType({ name, stage, owner, location, stageCode });
  const { suppressed, suppressionReason } = evaluateSuppression({ projectType, stageCode, stageConfidence, owner });
  return { projectType, stageCode, stageConfidence, suppressed, suppressionReason };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const conn = await createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute(
  "SELECT id, name, stage, owner, location, contractors, sources, priority FROM projects"
);

console.log(`\nClassifying ${rows.length} projects...\n`);

const byType = { opportunity: 0, background_account: 0, macro_item: 0, program_wrapper: 0 };
const byStageCode = {};
let suppressedCount = 0;
let errors = 0;

const BATCH = 50;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  for (const p of batch) {
    try {
      let contractors = null, sources = null;
      try { contractors = p.contractors ? JSON.parse(p.contractors) : null; } catch {}
      try { sources = p.sources ? JSON.parse(p.sources) : null; } catch {}

      const result = classifyProject({
        name: p.name,
        stage: p.stage,
        owner: p.owner,
        location: p.location,
        contractors,
        sources,
        priority: p.priority,
      });

      await conn.execute(
        `UPDATE projects SET projectType = ?, stageCode = ?, stageConfidence = ?, suppressed = ?, suppressionReason = ? WHERE id = ?`,
        [result.projectType, result.stageCode, result.stageConfidence, result.suppressed ? 1 : 0, result.suppressionReason, p.id]
      );

      byType[result.projectType] = (byType[result.projectType] ?? 0) + 1;
      byStageCode[result.stageCode] = (byStageCode[result.stageCode] ?? 0) + 1;
      if (result.suppressed) suppressedCount++;
    } catch (err) {
      errors++;
      console.error(`  Error on project ${p.id}: ${err.message}`);
    }
  }
  process.stdout.write(`  Processed ${Math.min(i + BATCH, rows.length)} / ${rows.length}\r`);
}

await conn.end();

console.log(`\n\n=== STAGE 5D BACKFILL COMPLETE ===`);
console.log(`Total projects classified: ${rows.length}`);
console.log(`Errors: ${errors}`);
console.log(`\n--- By projectType ---`);
for (const [k, v] of Object.entries(byType)) console.log(`  ${k}: ${v}`);
console.log(`\n--- By stageCode ---`);
for (const [k, v] of Object.entries(byStageCode).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log(`\n--- Suppression ---`);
console.log(`  Suppressed: ${suppressedCount}`);
console.log(`  Visible (not suppressed): ${rows.length - suppressedCount}`);
console.log(`\n  Suppression rate: ${((suppressedCount / rows.length) * 100).toFixed(1)}%`);
