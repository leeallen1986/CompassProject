/**
 * Find Dan Day's top qualifying projects that have send_ready contacts
 * but no digestSafe gate — these need to be marked digestSafe=true
 */
import { getDb } from '../db.js';
import { projects, contacts, contactProjects, projectValidationGates } from '../../drizzle/schema.js';
import { eq, and, inArray, sql, desc, or, isNull, notInArray } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) throw new Error('No DB connection');

  const danTerritories = ['SA', 'QLD', 'VIC', 'NSW', 'TAS'];
  const AUSTRALIAN_STATES = ["WA", "QLD", "NSW", "VIC", "SA", "TAS", "NT", "ACT"];

  // Get all projects with digestSafe gates
  const allGates = await db
    .select({ projectId: projectValidationGates.projectId, digestSafe: projectValidationGates.digestSafe })
    .from(projectValidationGates);
  const digestSafeSet = new Set(allGates.filter(g => g.digestSafe).map(g => g.projectId));
  const gatedSet = new Set(allGates.map(g => g.projectId));

  // Get Dan Day's pump projects with send_ready contacts
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      priority: projects.priority,
      projectState: projects.projectState,
      productLane: projects.productLane,
      location: projects.location,
      owner: projects.owner,
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
        or(
          inArray(projects.projectState as any, danTerritories),
          isNull(projects.projectState)
        )
      )
    )
    .groupBy(projects.id, projects.name, projects.priority, projects.projectState, projects.productLane, projects.location, projects.owner)
    .having(sql`SUM(CASE WHEN ${contacts.contactTrustTier} = 'send_ready' AND ${contacts.rejectionReason} IS NULL THEN 1 ELSE 0 END) > 0`)
    .orderBy(
      sql`CASE ${projects.priority} WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 ELSE 3 END`,
      desc(sql`SUM(CASE WHEN ${contacts.contactTrustTier} = 'send_ready' AND ${contacts.rejectionReason} IS NULL THEN 1 ELSE 0 END)`)
    )
    .limit(30);

  // Filter to territory-matching projects without digestSafe gate
  const candidates = rows.filter(row => {
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
    return passesTerritory && !digestSafeSet.has(row.id!);
  });

  console.log('Dan Day territory-matching projects with send_ready contacts but NO digestSafe gate:');
  console.log('='.repeat(90));
  for (const row of candidates) {
    const sr = Number(row.send_ready) || 0;
    const hasGate = gatedSet.has(row.id!);
    console.log(`[${row.id}] ${row.name}`);
    console.log(`  Priority: ${row.priority} | State: ${row.projectState} | Lane: ${row.productLane} | SR: ${sr}`);
    console.log(`  Owner: ${row.owner}`);
    console.log(`  Gate exists: ${hasGate} | digestSafe: false`);
    console.log('');
  }
  console.log(`Total candidates needing digestSafe=true: ${candidates.length}`);
  console.log('Top 3 to mark digestSafe:');
  for (const c of candidates.slice(0, 3)) {
    console.log(`  [${c.id}] ${c.name} (${c.priority}, ${c.projectState}, SR=${Number(c.send_ready)})`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
