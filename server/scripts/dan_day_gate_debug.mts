/**
 * Dan Day Gate Debug — 18 May 2026
 * Simulates the territory threshold gate to find why Dan Day only gets 2 qualifying projects
 */
import { getDb } from '../db.js';
import { projects, contacts, contactProjects, projectValidationGates } from '../../drizzle/schema.js';
import { eq, and, inArray, sql, desc, or, isNull } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) throw new Error('No DB connection');

  // Step 1: Get all projects that pass the lane filter for Dan Day
  // Dan Day: SA/QLD/VIC/NSW/TAS, pump lane (pump + multi_lane_pt)
  const danTerritories = ['SA', 'QLD', 'VIC', 'NSW', 'TAS'];
  
  // Step 2: Get projectValidationGates for all projects
  const allGates = await db
    .select({ projectId: projectValidationGates.projectId, digestSafe: projectValidationGates.digestSafe })
    .from(projectValidationGates);
  
  const digestSafeSet = new Set(allGates.filter(g => g.digestSafe).map(g => g.projectId));
  const gatedSet = new Set(allGates.map(g => g.projectId));
  
  console.log(`Total projects with validation gates: ${gatedSet.size}`);
  console.log(`Total projects marked digestSafe=true: ${digestSafeSet.size}`);
  console.log('');

  // Step 3: Get Dan Day's pump projects with send_ready contacts
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      priority: projects.priority,
      projectState: projects.projectState,
      productLane: projects.productLane,
      location: projects.location,
      send_ready: sql<number>`SUM(CASE WHEN ${contacts.contactTrustTier} = 'send_ready' AND ${contacts.rejectionReason} IS NULL THEN 1 ELSE 0 END)`,
    })
    .from(projects)
    .leftJoin(contactProjects, eq(contactProjects.projectId, projects.id))
    .leftJoin(contacts, eq(contacts.id, contactProjects.contactId))
    .where(
      and(
        eq(projects.suppressed, false),
        inArray(projects.priority, ['hot', 'warm']),
        inArray(projects.productLane as any, ['pump', 'multi_lane_pt']),
      )
    )
    .groupBy(projects.id, projects.name, projects.priority, projects.projectState, projects.productLane, projects.location)
    .having(sql`SUM(CASE WHEN ${contacts.contactTrustTier} = 'send_ready' AND ${contacts.rejectionReason} IS NULL THEN 1 ELSE 0 END) > 0`)
    .orderBy(desc(sql`SUM(CASE WHEN ${contacts.contactTrustTier} = 'send_ready' AND ${contacts.rejectionReason} IS NULL THEN 1 ELSE 0 END)`))
    .limit(50);

  console.log(`Projects with send_ready contacts (pump/multi_lane_pt, not suppressed): ${rows.length}`);
  console.log('');
  
  // Step 4: Apply the same logic as checkTerritoryThreshold
  const AUSTRALIAN_STATES = ["WA", "QLD", "NSW", "VIC", "SA", "TAS", "NT", "ACT"];
  
  let digestSafeCount = 0;
  let territoryPassCount = 0;
  
  for (const row of rows) {
    const sr = Number(row.send_ready) || 0;
    const hasGate = gatedSet.has(row.id!);
    const isDigestSafe = digestSafeSet.has(row.id!);
    
    // Territory check
    const projectState = (row.projectState || "").toUpperCase();
    const loc = (row.location || "").toLowerCase();
    const passesTerritory = danTerritories.some(t => {
      const tUpper = t.toUpperCase();
      if (projectState && AUSTRALIAN_STATES.includes(projectState) && projectState !== tUpper) return false;
      const tLower = t.toLowerCase();
      if (tLower.length <= 3) {
        const re = new RegExp(`\\b${tLower}\\b`, "i");
        return re.test(loc);
      }
      return loc.includes(tLower);
    });
    
    if (isDigestSafe) digestSafeCount++;
    if (isDigestSafe && passesTerritory) territoryPassCount++;
    
    const gateStatus = !hasGate ? 'NO_GATE' : isDigestSafe ? 'DIGEST_SAFE' : 'GATE_NOT_SAFE';
    const terrStatus = passesTerritory ? 'TERR_OK' : 'TERR_FAIL';
    const qualifies = isDigestSafe && passesTerritory;
    
    console.log(`[${row.id}] ${row.name}`);
    console.log(`  State: ${row.projectState || 'null'} | Lane: ${row.productLane} | SR: ${sr}`);
    console.log(`  Gate: ${gateStatus} | Territory: ${terrStatus} | QUALIFIES: ${qualifies ? '✓ YES' : '✗ NO'}`);
    if (!qualifies) {
      if (!hasGate) console.log(`  ⚠ No validation gate row — digestSafe defaults to false`);
      else if (!isDigestSafe) console.log(`  ⚠ Gate exists but digestSafe=false`);
      else if (!passesTerritory) console.log(`  ⚠ Territory mismatch: projectState=${row.projectState}, location=${row.location}`);
    }
    console.log('');
  }
  
  console.log('='.repeat(80));
  console.log(`Summary: ${rows.length} projects with send_ready contacts`);
  console.log(`  digestSafe=true: ${digestSafeCount}`);
  console.log(`  digestSafe=true AND territory matches: ${territoryPassCount}`);
  console.log(`  Dan Day needs 3 qualifying projects`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
