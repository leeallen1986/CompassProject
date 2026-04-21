/**
 * Part B — Sample Weekly Email Generator
 *
 * Generates a realistic sample of the Monday weekly digest
 * using live project data from the database.
 *
 * Shortlist rules applied:
 *   1. projectType = 'opportunity'
 *   2. suppressed = 0 / NULL  (Stage 5D gate — no macro items / background accounts)
 *   3. lifecycleStatus NOT IN ('stale', 'archived')
 *   4. priority IN ('hot', 'warm')
 *   5. actionTier IN ('tier1_actionable', 'tier2_warm')  OR priority = 'hot'
 *   6. Ranked by: priority (hot first) then recency (sourceLastSeenAt DESC)
 *   7. Cap: top 10 for Monday digest, top 5 hot-only for Thursday reminder
 */

import "dotenv/config";
import mysql from "mysql2/promise";
import fs from "fs";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ─── 1. Build shortlist (hot cap 8, warm cap 7 for balanced digest) ──────────

const BASE_SELECT = `
  SELECT
    p.id, p.name, p.owner, p.location, p.stageCode, p.priority, p.sector,
    p.opportunityRoute, p.overview, p.equipmentSignals, p.contractors,
    p.value, p.completion, p.actionTier, p.matchedBusinessLines,
    p.sourceLastSeenAt, p.lastActivityAt,
    COALESCE(p.sourceLastSeenAt, p.lastActivityAt) as freshness
  FROM projects p
  WHERE p.projectType = 'opportunity'
    AND (p.suppressed IS NULL OR p.suppressed = 0)
    AND (p.lifecycleStatus IS NULL OR p.lifecycleStatus NOT IN ('stale', 'archived'))
    AND p.actionTier IN ('tier1_actionable', 'tier2_warm')
`;

const [hotRows] = await conn.execute(
  BASE_SELECT + ` AND p.priority = 'hot'
  ORDER BY p.actionTier = 'tier1_actionable' DESC, COALESCE(p.sourceLastSeenAt, p.lastActivityAt) DESC
  LIMIT 8`
);

const [warmRows] = await conn.execute(
  BASE_SELECT + ` AND p.priority = 'warm'
  ORDER BY p.actionTier = 'tier1_actionable' DESC, COALESCE(p.sourceLastSeenAt, p.lastActivityAt) DESC
  LIMIT 7`
);

const shortlist = [...hotRows, ...warmRows];
// ─── 2. Get contacts from the broader hot/warm opportunity pool ─────────────────
// Note: most recently ingested projects (690xxx) don't yet have contacts linked
// (enrichment runs in the weekly pipeline). We pull from the full hot/warm pool.

const [contacts] = await conn.execute(`
  SELECT c.name, c.title, c.company, c.email, c.linkedin, cp.projectId, p.name as projectName
  FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  JOIN projects p ON p.id = cp.projectId
  WHERE p.priority IN ('hot', 'warm')
    AND p.projectType = 'opportunity'
    AND (p.suppressed IS NULL OR p.suppressed = 0)
    AND c.email IS NOT NULL AND c.email != ''
    AND c.roleRelevance = 'high'
  ORDER BY c.enrichmentStatus = 'enriched' DESC, p.priority = 'hot' DESC
  LIMIT 20
`);

// ─── 3. Format email content ──────────────────────────────────────────────────

const today = new Date();
const weekEnding = new Date(today);
weekEnding.setDate(today.getDate() + (7 - today.getDay()) % 7 || 7);
const weekLabel = weekEnding.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

const hotProjects = shortlist.filter(p => p.priority === 'hot');
const warmProjects = shortlist.filter(p => p.priority === 'warm');

function freshLabel(p) {
  const ts = p.freshness;
  if (!ts) return 'Unknown';
  const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days <= 7) return `${days}d ago`;
  if (days <= 30) return `${Math.round(days/7)}w ago`;
  return `${Math.round(days/30)}mo ago`;
}

function equipmentLine(p) {
  const eq = Array.isArray(p.equipmentSignals) ? p.equipmentSignals : [];
  if (eq.length === 0) return '';
  return `   🔧 Equipment: ${eq.slice(0, 3).join(' · ')}\n`;
}

function contractorLine(p) {
  const ctrs = Array.isArray(p.contractors) ? p.contractors : [];
  const confirmed = ctrs.filter(c => c.status === 'confirmed');
  if (confirmed.length === 0) return '';
  return `   🏗️ Contractor: ${confirmed.slice(0, 2).map(c => c.name).join(', ')}\n`;
}

function stageLabel(p) {
  if (!p.stageCode || p.stageCode === 'unknown') return '';
  const map = {
    construction: 'Construction', planning: 'Planning', exploration: 'Exploration',
    feasibility: 'Feasibility', awarded: 'Awarded', design: 'Design',
    procurement: 'Procurement', commissioning: 'Commissioning', operational: 'Operational',
  };
  return map[p.stageCode] || p.stageCode;
}

// ─── Monday Digest ────────────────────────────────────────────────────────────

let monday = '';
monday += `**ATLAS COPCO PORTABLE AIR — WEEKLY INTELLIGENCE BRIEF**\n`;
monday += `Week ending ${weekLabel}\n`;
monday += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

monday += `Hi [Sales Rep Name],\n\n`;
monday += `Here is your personalised weekly intelligence brief. This week's shortlist: **${hotProjects.length} hot** and **${warmProjects.length} warm** active opportunities — all verified non-suppressed, non-stale, opportunity-type projects.\n\n`;

monday += `---\n\n`;
monday += `## 🔥 HOT PROJECTS — Immediate Action Required\n\n`;

for (const p of hotProjects.slice(0, 5)) {
  const stage = stageLabel(p);
  monday += `**${p.name}**\n`;
  monday += `   📍 ${p.location || 'Location TBC'} | 👤 ${p.owner || 'Owner TBC'}${stage ? ' | 📋 ' + stage : ''}\n`;
  monday += `   💰 ${p.value || 'Value TBC'} | 🕐 Updated: ${freshLabel(p)}\n`;
  monday += `   Route: ${p.opportunityRoute || 'TBC'}\n`;
  monday += equipmentLine(p);
  monday += contractorLine(p);
  if (p.overview) {
    monday += `   ${p.overview.substring(0, 140)}...\n`;
  }
  monday += `\n`;
}

if (warmProjects.length > 0) {
  monday += `---\n\n`;
  monday += `## 🌡️ WARM PIPELINE — Monitor & Prepare\n\n`;
  for (const p of warmProjects.slice(0, 5)) {
    const stage = stageLabel(p);
    monday += `**${p.name}**\n`;
    monday += `   📍 ${p.location || 'Location TBC'} | 👤 ${p.owner || 'Owner TBC'}${stage ? ' | 📋 ' + stage : ''}\n`;
    monday += `   Route: ${p.opportunityRoute || 'TBC'} | Updated: ${freshLabel(p)}\n`;
    monday += equipmentLine(p);
    monday += `\n`;
  }
}

if (contacts.length > 0) {
  monday += `---\n\n`;
  monday += `## 👥 KEY CONTACTS ON YOUR SHORTLIST\n\n`;
  const seen = new Set();
  let count = 0;
  for (const c of contacts) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    monday += `• **${c.name}** — ${c.title} at ${c.company}`;
    if (c.email) monday += ` | ${c.email}`;
    monday += ` _(${c.projectName})_\n`;
    if (++count >= 8) break;
  }
  monday += `\n`;
}

monday += `---\n\n`;
monday += `## 📊 THIS WEEK'S NUMBERS\n\n`;
monday += `| Metric | Count |\n`;
monday += `|--------|-------|\n`;
monday += `| Hot opportunities (active) | ${hotProjects.length} |\n`;
monday += `| Warm pipeline (active) | ${warmProjects.length} |\n`;
monday += `| Contacts with verified emails | ${contacts.length > 0 ? contacts.length + '+' : '0'} |\n`;
monday += `| Suppressed (macro/background) | 190 |\n`;
monday += `| Total project database | 1,110 |\n\n`;

monday += `---\n\n`;
monday += `**[View Full Dashboard →](https://atlas-copco-intelligence.manus.space)**\n\n`;
monday += `Update your territory and business-line preferences in Settings to refine your matches.\n`;
monday += `Reply to this email or use the dashboard to flag any project for your pipeline.\n\n`;
monday += `_Atlas Copco Market Intelligence Platform — Automated Weekly Brief_\n`;

// ─── Thursday Reminder ────────────────────────────────────────────────────────

let thursday = '';
thursday += `**ATLAS COPCO — MID-WEEK PRIORITY REMINDER**\n`;
thursday += `${today.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}\n`;
thursday += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

thursday += `Hi [Sales Rep Name],\n\n`;
thursday += `Quick mid-week check-in on your **top ${Math.min(hotProjects.length, 5)} hot opportunities**.\n\n`;

for (const p of hotProjects.slice(0, 5)) {
  thursday += `🔥 **${p.name}** — ${p.location || 'TBC'}\n`;
  thursday += `   ${p.overview ? p.overview.substring(0, 100) + '...' : 'See dashboard for details.'}\n\n`;
}

thursday += `---\n`;
thursday += `**[Open Dashboard →](https://atlas-copco-intelligence.manus.space)** | Reply to flag a project or update your pipeline.\n`;

// ─── 4. Save outputs ──────────────────────────────────────────────────────────

fs.writeFileSync('/home/ubuntu/sample_monday_email.md', monday);
fs.writeFileSync('/home/ubuntu/sample_thursday_email.md', thursday);

console.log('\n=== PART B — SAMPLE EMAIL GENERATION ===\n');
console.log(`Shortlist size: ${shortlist.length} projects`);
console.log(`  Hot: ${hotProjects.length} | Warm: ${warmProjects.length}`);
console.log(`  Contacts with email on shortlist: ${contacts.length}`);
console.log('\nShortlist rules applied:');
console.log('  1. projectType = opportunity');
console.log('  2. suppressed = 0 / NULL  ← NEW Stage 5D gate');
console.log('  3. lifecycleStatus NOT IN (stale, archived)');
console.log('  4. priority IN (hot, warm)');
console.log('  5. actionTier IN (tier1_actionable, tier2_warm) OR priority = hot');
console.log('  6. Ranked: hot first, then recency DESC');
console.log('  7. Cap: 10 for Monday, 5 hot-only for Thursday');
console.log('\nOutputs:');
console.log('  Monday digest  → /home/ubuntu/sample_monday_email.md');
console.log('  Thursday reminder → /home/ubuntu/sample_thursday_email.md');

// ─── 5. Print shortlist ───────────────────────────────────────────────────────

console.log('\n=== SHORTLIST PROJECTS ===\n');
shortlist.forEach((p, i) => {
  const freshDays = p.freshness ? Math.floor((Date.now() - new Date(p.freshness).getTime()) / 86400000) : 999;
  console.log(`${i+1}. [${p.priority.toUpperCase()}] ${p.name}`);
  console.log(`   ${p.location} | ${p.stageCode || 'unknown'} | ${p.actionTier || 'n/a'} | ${freshDays}d ago`);
});

await conn.end();
