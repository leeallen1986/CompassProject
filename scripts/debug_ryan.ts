import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL as string);
  const [allProjects] = await conn.execute('SELECT id, name, projectState, priority, suppressed, owner, actionTier FROM projects WHERE suppressed = 0') as any[];
  const [blScores] = await conn.execute('SELECT projectId, scoringDimension as dimension, score FROM projectBusinessLineScores') as any[];
  
  const scoreMap = new Map<number, Map<string, number>>();
  for (const s of blScores) {
    if (scoreMap.has(s.projectId) === false) scoreMap.set(s.projectId, new Map());
    scoreMap.get(s.projectId)!.set(s.dimension, s.score);
  }
  
  console.log('Total projects:', allProjects.length);
  console.log('Total BL scores:', blScores.length);
  console.log('ScoreMap entries:', scoreMap.size);
  
  // Test Ryan: WA, dimensions = Portable Air + all
  const dimensions = new Set(['Portable Air', 'PAL', 'BESS', 'Pump/Dewatering', 'Generators', 'Nitrogen', 'Booster']);
  const terr = ['WA'];
  
  let matchCount = 0;
  let terrFail = 0;
  let blFail = 0;
  let noScores = 0;
  
  for (const p of allProjects) {
    const pState = (p.projectState || '').toUpperCase();
    if (pState && terr.map(t => t.toUpperCase()).includes(pState) === false) { terrFail++; continue; }
    const projScores = scoreMap.get(p.id);
    if (projScores === undefined) { noScores++; blFail++; continue; }
    let hasLane = false;
    for (const dim of dimensions) {
      if ((projScores.get(dim) || 0) >= 50) { hasLane = true; break; }
    }
    if (hasLane === false) { blFail++; continue; }
    matchCount++;
  }
  
  console.log('Ryan filter results:');
  console.log('  Territory fail:', terrFail);
  console.log('  BL fail (no scores):', noScores);
  console.log('  BL fail (low scores):', blFail - noScores);
  console.log('  Match:', matchCount);
  
  // Check Norseman specifically
  const norseman = allProjects.find((p: any) => p.name.includes('Norseman'));
  if (norseman) {
    console.log('\nNorseman project:', norseman.id, '| state:', norseman.projectState);
    const ns = scoreMap.get(norseman.id);
    if (ns) {
      for (const [k, v] of ns.entries()) {
        console.log(`  ${k}: ${v}`);
      }
    } else {
      console.log('  NO SCORES');
    }
  }
  
  // Check if the issue is that the script's for-of-reps loop is using a different allProjects
  // Let me check what the script actually sees
  const waProjects = allProjects.filter((p: any) => (p.projectState || '').toUpperCase() === 'WA');
  console.log('\nWA projects in allProjects:', waProjects.length);
  const waWithScores = waProjects.filter((p: any) => scoreMap.has(p.id));
  console.log('WA projects with scores:', waWithScores.length);
  const waWithPA = waWithScores.filter((p: any) => {
    const s = scoreMap.get(p.id);
    return s && (s.get('Portable Air') || 0) >= 50;
  });
  console.log('WA projects with PA >= 50:', waWithPA.length);
  
  await conn.end();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
