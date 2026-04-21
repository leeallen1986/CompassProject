/**
 * Part A — Scrape/Detail QA Audit Script
 *
 * Samples the most recent 50 opportunity-type, non-suppressed projects
 * and scores each against 8 QA dimensions:
 *   1. Named owner
 *   2. Specific site/location
 *   3. Usable stageCode
 *   4. Contractor / EPC / EPCM path
 *   5. Route-to-buy signal
 *   6. Equipment / application signal
 *   7. Freshness / recency
 *   8. Specificity vs generic noise
 *
 * Also produces a per-source scorecard.
 */

import "dotenv/config";
import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ─── 1. Sample 50 most-recent opportunity projects ───────────────────────────

const [projects] = await conn.execute(`
  SELECT
    id, name as title, sector, stageCode, stageConfidence, projectType,
    suppressed, suppressionReason,
    owner, location, NULL as state, contractors as contractor, NULL as epcm,
    opportunityRoute as routeToBuy, equipmentSignals as equipmentSignal, NULL as applicationSignal,
    sourceLastSeenAt, lastActivityAt, createdAt,
    overview as description, NULL as rawContent,
    NULL as sourceUrl, NULL as sourceName,
    priority, actionTier as tier,
    keepFlag
  FROM projects
  WHERE projectType = 'opportunity'
    AND (suppressed IS NULL OR suppressed = 0)
    AND (lifecycleStatus IS NULL OR lifecycleStatus NOT IN ('archived', 'completed'))
  ORDER BY COALESCE(sourceLastSeenAt, lastActivityAt, createdAt) DESC
  LIMIT 50
`);

// ─── 2. Get source distribution for the sample ───────────────────────────────

const [allSources] = await conn.execute(`
  SELECT
    sector as sourceName,
    COUNT(*) as total,
    SUM(CASE WHEN projectType='opportunity' AND (suppressed IS NULL OR suppressed=0) THEN 1 ELSE 0 END) as opportunities
  FROM projects
  WHERE sector IS NOT NULL
  GROUP BY sector
  ORDER BY total DESC
  LIMIT 30
`);

// ─── 3. Score each project ────────────────────────────────────────────────────

function hasNamedOwner(p) {
  if (p.owner && p.owner.trim().length > 3) return true;
  const text = `${p.description || ''} ${p.rawContent || ''}`.toLowerCase();
  const patterns = [/owned by/i, /proponent[:\s]/i, /developer[:\s]/i, /\bowner[:\s]/i];
  return patterns.some(r => r.test(text));
}

function hasSpecificLocation(p) {
  if (p.location && p.location.trim().length > 3) return true;
  if (p.state && p.state.trim().length > 0) return true;
  const text = `${p.title || ''} ${p.description || ''}`;
  // Named mine, site, suburb, or coordinates
  return /\b(mine|site|port|terminal|refinery|plant|station|depot|hub|precinct|estate|park|wharf|berth|pit|field|basin|creek|ridge|range|bay|inlet|harbour|harbor)\b/i.test(text);
}

function hasUsableStage(p) {
  if (p.stageCode && p.stageCode !== 'unknown') return true;
  return false;
}

function hasContractorPath(p) {
  const contractorStr = typeof p.contractor === 'string' ? p.contractor : JSON.stringify(p.contractor || '');
  if (contractorStr && contractorStr.length > 2 && contractorStr !== '[]' && contractorStr !== 'null') return true;
  const text = `${p.description || ''} ${p.rawContent || ''}`.toLowerCase();
  return /\b(epc|epcm|contractor|driller|drilling contractor|civil contractor|awarded to|contract awarded|tender|tenderer|head contractor)\b/i.test(text);
}

function hasRouteToBuy(p) {
  const rtbStr = typeof p.routeToBuy === 'string' ? p.routeToBuy : JSON.stringify(p.routeToBuy || '');
  if (rtbStr && rtbStr.length > 2 && rtbStr !== '[]' && rtbStr !== 'null') return true;
  const text = `${p.description || ''} ${p.rawContent || ''}`.toLowerCase();
  return /\b(tender|rfq|rfp|expression of interest|eoi|procurement|contract award|awarded|capex|purchase order|supply contract|equipment supply)\b/i.test(text);
}

function hasEquipmentSignal(p) {
  const eqStr = typeof p.equipmentSignal === 'string' ? p.equipmentSignal : JSON.stringify(p.equipmentSignal || '');
  if (eqStr && eqStr.length > 2 && eqStr !== '[]' && eqStr !== 'null') return true;
  const text = `${p.title || ''} ${p.description || ''} ${p.rawContent || ''}`.toLowerCase();
  return /\b(compressor|air|drill|drilling|blasting|pneumatic|generator|pump|borehole|rc drill|rotary|dth|hammer|waterwell|water well|dewatering|ventilation|nitrogen|n2|gas|bess|battery|energy storage|solar|wind|conveyor|crusher|mill|excavat|haul|dozer|grader|loader|scraper|bore|piling|grouting|shotcrete|tunneling|tunnelling)\b/i.test(text);
}

function getFreshnessDays(p) {
  const ts = p.sourceLastSeenAt || p.lastActivityAt || p.createdAt;
  if (!ts) return 9999;
  const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
  return Math.floor((Date.now() - ms) / 86400000);
}

function isSpecific(p) {
  const text = `${p.title || ''} ${p.description || ''}`;
  const wordCount = text.split(/\s+/).length;
  if (wordCount < 20) return false;
  // Generic noise patterns
  const noisy = /\b(market overview|industry update|sector report|roundup|outlook|forecast|trend|analysis|review|summary|update|news|announcement|press release|media release)\b/i;
  if (noisy.test(p.title || '')) return false;
  // Must have at least 3 of: owner, location, stage, contractor, equipment
  const signals = [
    hasNamedOwner(p),
    hasSpecificLocation(p),
    hasUsableStage(p),
    hasContractorPath(p),
    hasEquipmentSignal(p),
  ];
  return signals.filter(Boolean).length >= 3;
}

const scored = projects.map(p => {
  const freshDays = getFreshnessDays(p);
  return {
    ...p,
    qa: {
      namedOwner: hasNamedOwner(p),
      specificLocation: hasSpecificLocation(p),
      usableStage: hasUsableStage(p),
      contractorPath: hasContractorPath(p),
      routeToBuy: hasRouteToBuy(p),
      equipmentSignal: hasEquipmentSignal(p),
      freshDays,
      isFresh: freshDays <= 30,
      isSpecific: isSpecific(p),
    }
  };
});

// ─── 4. Per-source scorecard ──────────────────────────────────────────────────

const bySource = {};
for (const p of scored) {
  const src = p.sector || 'unknown';
  if (!bySource[src]) {
    bySource[src] = {
      source: src,
      count: 0,
      namedOwner: 0,
      specificLocation: 0,
      usableStage: 0,
      contractorPath: 0,
      routeToBuy: 0,
      equipmentSignal: 0,
      fresh: 0,
      specific: 0,
    };
  }
  const b = bySource[src];
  b.count++;
  if (p.qa.namedOwner) b.namedOwner++;
  if (p.qa.specificLocation) b.specificLocation++;
  if (p.qa.usableStage) b.usableStage++;
  if (p.qa.contractorPath) b.contractorPath++;
  if (p.qa.routeToBuy) b.routeToBuy++;
  if (p.qa.equipmentSignal) b.equipmentSignal++;
  if (p.qa.isFresh) b.fresh++;
  if (p.qa.isSpecific) b.specific++;
}

// ─── 5. Classify projects ─────────────────────────────────────────────────────

function classifyProject(p) {
  const q = p.qa;
  const score = [q.namedOwner, q.specificLocation, q.usableStage, q.contractorPath, q.routeToBuy, q.equipmentSignal, q.isFresh, q.isSpecific].filter(Boolean).length;
  if (score >= 6) return 'STRONG';
  if (score >= 4) return 'GOOD';
  if (score >= 2) return 'WEAK';
  return 'NOISE';
}

const classified = scored.map(p => ({ ...p, qaClass: classifyProject(p) }));

// ─── 6. Print results ─────────────────────────────────────────────────────────

console.log('\n=== PART A — PROJECT QA SAMPLE ===\n');
console.log(`Total sampled: ${classified.length}`);
console.log(`STRONG: ${classified.filter(p => p.qaClass === 'STRONG').length}`);
console.log(`GOOD:   ${classified.filter(p => p.qaClass === 'GOOD').length}`);
console.log(`WEAK:   ${classified.filter(p => p.qaClass === 'WEAK').length}`);
console.log(`NOISE:  ${classified.filter(p => p.qaClass === 'NOISE').length}`);

console.log('\n=== PER-SOURCE SCORECARD ===\n');
const sourceRows = Object.values(bySource).sort((a, b) => b.count - a.count);
for (const s of sourceRows) {
  const pct = v => s.count > 0 ? Math.round(100 * v / s.count) : 0;
  const specificPct = pct(s.specific);
  let rec;
  if (specificPct >= 70) rec = 'KEEP — strong source';
  else if (specificPct >= 40) rec = 'KEEP WITH CAUTION';
  else if (specificPct >= 20) rec = 'DEPRIORITIZE';
  else rec = 'QUARANTINE / REDUCE WEIGHT';
  console.log(`${s.source} (n=${s.count})`);
  console.log(`  Named owner: ${pct(s.namedOwner)}% | Location: ${pct(s.specificLocation)}% | Stage: ${pct(s.usableStage)}% | Contractor: ${pct(s.contractorPath)}% | Equipment: ${pct(s.equipmentSignal)}% | Specific: ${specificPct}% | Fresh: ${pct(s.fresh)}%`);
  console.log(`  → ${rec}\n`);
}

console.log('\n=== STRONG PROJECTS (top 5) ===\n');
for (const p of classified.filter(p => p.qaClass === 'STRONG').slice(0, 5)) {
  console.log(`[${p.id}] ${p.title}`);
  console.log(`  Source: ${p.sector} | Stage: ${p.stageCode} | Priority: ${p.priority}`);
  console.log(`  Owner: ${p.owner || 'n/a'} | Location: ${p.location || p.state || 'n/a'}`);
  console.log(`  Contractor: ${p.contractor || 'n/a'} | Equipment: ${p.equipmentSignal || 'n/a'}`);
  console.log(`  Fresh: ${p.qa.freshDays}d ago`);
  console.log();
}

console.log('\n=== WEAK / NOISE PROJECTS (examples) ===\n');
for (const p of classified.filter(p => p.qaClass === 'NOISE' || p.qaClass === 'WEAK').slice(0, 5)) {
  console.log(`[${p.id}] ${p.title}`);
  console.log(`  Sector: ${p.sector} | Stage: ${p.stageCode || 'none'} | QA: ${p.qaClass}`);
  console.log(`  Missing: ${[
    !p.qa.namedOwner && 'owner',
    !p.qa.specificLocation && 'location',
    !p.qa.usableStage && 'stage',
    !p.qa.contractorPath && 'contractor',
    !p.qa.equipmentSignal && 'equipment',
  ].filter(Boolean).join(', ')}`);
  console.log();
}

console.log('\n=== SHORTLIST CANDIDATES (STRONG + GOOD, priority hot/warm) ===\n');
const shortlist = classified.filter(p =>
  (p.qaClass === 'STRONG' || p.qaClass === 'GOOD') &&
  (p.priority === 'hot' || p.priority === 'warm')
).slice(0, 15);
console.log(`Shortlist size: ${shortlist.length}`);
for (const p of shortlist) {
  console.log(`[${p.id}] [${p.priority?.toUpperCase()}] ${p.title} — ${p.stageCode || 'unknown stage'} — ${p.qa.freshDays}d ago`);
}

// ─── 7. Overall summary stats ─────────────────────────────────────────────────

const total = classified.length;
const pct = v => total > 0 ? Math.round(100 * v / total) : 0;
console.log('\n=== OVERALL QA SUMMARY ===\n');
console.log(`Sample size: ${total}`);
console.log(`Named owner:      ${pct(classified.filter(p => p.qa.namedOwner).length)}%`);
console.log(`Specific location:${pct(classified.filter(p => p.qa.specificLocation).length)}%`);
console.log(`Usable stage:     ${pct(classified.filter(p => p.qa.usableStage).length)}%`);
console.log(`Contractor path:  ${pct(classified.filter(p => p.qa.contractorPath).length)}%`);
console.log(`Route-to-buy:     ${pct(classified.filter(p => p.qa.routeToBuy).length)}%`);
console.log(`Equipment signal: ${pct(classified.filter(p => p.qa.equipmentSignal).length)}%`);
console.log(`Fresh (≤30d):     ${pct(classified.filter(p => p.qa.isFresh).length)}%`);
console.log(`Specific (≥3 sig):${pct(classified.filter(p => p.qa.isSpecific).length)}%`);

// ─── 8. Before/after counts ───────────────────────────────────────────────────

const [countRows] = await conn.execute(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN projectType='opportunity' AND (suppressed IS NULL OR suppressed=0) THEN 1 ELSE 0 END) as opportunities,
    SUM(CASE WHEN suppressed=1 THEN 1 ELSE 0 END) as suppressed,
    SUM(CASE WHEN projectType='background_account' THEN 1 ELSE 0 END) as background,
    SUM(CASE WHEN projectType='macro_item' THEN 1 ELSE 0 END) as macro,
    SUM(CASE WHEN lifecycleStatus='stale' THEN 1 ELSE 0 END) as stale,
    SUM(CASE WHEN lifecycleStatus='archived' THEN 1 ELSE 0 END) as archived
  FROM projects
`);
console.log('\n=== DATABASE BEFORE/AFTER COUNTS ===\n');
const c = countRows[0];
console.log(`Total projects:     ${c.total}`);
console.log(`Opportunities:      ${c.opportunities}`);
console.log(`Suppressed:         ${c.suppressed}`);
console.log(`Background accts:   ${c.background}`);
console.log(`Macro items:        ${c.macro}`);
console.log(`Stale:              ${c.stale}`);
console.log(`Archived:           ${c.archived}`);
console.log(`Shortlist (hot+warm STRONG/GOOD): ${shortlist.length}`);

await conn.end();
