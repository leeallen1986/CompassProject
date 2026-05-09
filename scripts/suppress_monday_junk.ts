/**
 * Suppress junk projects from Monday digest visibility
 * Sets suppressed=1 on projects that are schools, prisons, hospitals, etc.
 */
import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

const JUNK_PROJECTS = [
  'Victory Metals Rare Earths Project',
  'West Kimberley Regional Prison Fence Construction',
  'Fremantle Prison Fire and Life Services Upgrades',
  'Minor Works - Toodyay Police Station',
  'Broome Regional Prison Cell Replacement & Associated Works',
  'Samphire Uranium Project - Field Recovery Trial (FRT)',
  'NEXTDC S4 Sydney Data Centre',
];

// Also find more junk by pattern matching
const JUNK_SQL_PATTERNS = [
  '%prison%',
  '%police station%',
  '%detention%',
  '%correction%',
  '%data centre%',
  '%data center%',
  '%feasibility study%',
  '%master plan%',
  '%office fit out%',
  '%office fit-out%',
];

async function main() {
  const db = drizzle(process.env.DATABASE_URL as string);

  console.log('# PART C — Suppress Monday Junk\n');

  // 1. Suppress known junk projects by name
  let totalSuppressed = 0;
  console.log('## Named Junk Projects\n');
  console.log('| Project | Action | Result |');
  console.log('|---------|--------|--------|');

  for (const name of JUNK_PROJECTS) {
    const result = await db.execute(sql`
      UPDATE projects SET suppressed = 1 WHERE name LIKE ${name + '%'} AND suppressed = 0
    `);
    const affected = (result[0] as any).affectedRows || 0;
    totalSuppressed += affected;
    console.log(`| ${name.substring(0, 55)} | suppress | ${affected > 0 ? '✅ suppressed' : 'already suppressed'} |`);
  }

  // 2. Pattern-based suppression
  console.log('\n## Pattern-Based Suppression\n');
  console.log('| Pattern | Projects Found | Suppressed |');
  console.log('|---------|----------------|------------|');

  for (const pattern of JUNK_SQL_PATTERNS) {
    // First check what would be affected
    const check = await db.execute(sql`
      SELECT id, name FROM projects 
      WHERE (name LIKE ${pattern} OR overview LIKE ${pattern})
        AND suppressed = 0
      LIMIT 10
    `);
    const rows = check[0] as any[];
    
    if (rows.length > 0) {
      const result = await db.execute(sql`
        UPDATE projects SET suppressed = 1 
        WHERE (name LIKE ${pattern} OR overview LIKE ${pattern})
          AND suppressed = 0
      `);
      const affected = (result[0] as any).affectedRows || 0;
      totalSuppressed += affected;
      console.log(`| ${pattern} | ${rows.length} | ${affected} |`);
      for (const r of rows) {
        console.log(`|   → ${r.name.substring(0, 50)} | | |`);
      }
    } else {
      console.log(`| ${pattern} | 0 | 0 |`);
    }
  }

  // 3. Also suppress "Infrastructure Priority List (IPL) Rail Projects" — it's a wrapper, not actionable
  const iplResult = await db.execute(sql`
    UPDATE projects SET suppressed = 1 
    WHERE name = 'Infrastructure Priority List (IPL) Rail Projects' AND suppressed = 0
  `);
  const iplAffected = (iplResult[0] as any).affectedRows || 0;
  if (iplAffected > 0) {
    totalSuppressed += iplAffected;
    console.log(`\n**Also suppressed:** "Infrastructure Priority List (IPL) Rail Projects" — big wrapper with no lane-specific package signal`);
  }

  console.log(`\n## Summary`);
  console.log(`Total projects suppressed this pass: **${totalSuppressed}**`);

  // 4. Verify: show remaining top projects for priority reps after suppression
  console.log('\n## Post-Suppression Top 3 for Priority Reps\n');
  
  const priorityChecks = [
    { name: 'Ryan Pemberton', dim: 'Portable Air', states: ['WA'] },
    { name: 'Daniel Zec', dim: 'Portable Air', states: ['NSW', 'VIC', 'SA', 'TAS'] },
    { name: 'Brett Hansen', dim: 'Pump/Dewatering', states: ['WA', 'NT'] },
    { name: 'Dan Day', dim: 'Pump/Dewatering', states: ['SA', 'QLD', 'VIC', 'NSW', 'TAS'] },
    { name: 'Amit Bhargava', dim: 'BESS', states: [] }, // national
  ];

  for (const rep of priorityChecks) {
    const stateFilter = rep.states.length > 0 
      ? sql`AND p.projectState IN (${sql.join(rep.states.map(s => sql`${s}`), sql`, `)})`
      : sql``;
    
    const topProjects = await db.execute(sql`
      SELECT p.name, p.projectState, pbs.score
      FROM projects p
      JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = ${rep.dim}
      WHERE p.suppressed = 0 AND pbs.score >= 50
      ${stateFilter}
      ORDER BY pbs.score DESC
      LIMIT 3
    `);
    
    console.log(`**${rep.name}** (${rep.dim}): ${(topProjects[0] as any[]).map(p => p.name.substring(0, 40)).join(' | ')}`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
