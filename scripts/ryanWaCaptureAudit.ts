import 'dotenv/config';
import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL!;

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);

  // Get Ryan's profile
  const [ryanRows]: any = await conn.query(
    `SELECT id, firstName, lastName, assignedBusinessLines, territories, salesMotion FROM userProfiles WHERE firstName = 'Ryan' LIMIT 1`
  );
  const ryan = ryanRows[0];
  console.log('=== RYAN PROFILE ===');
  console.log(`ID: ${ryan.id}, Name: ${ryan.firstName} ${ryan.lastName}`);
  console.log(`BLs: ${ryan.assignedBusinessLines}`);
  console.log(`Territories: ${ryan.territories}`);
  console.log(`Sales Motion: ${ryan.salesMotion}`);
  console.log('');

  // Get all active WA + OFFSHORE_AU projects (Ryan's territory)
  const [projects]: any = await conn.query(`
    SELECT 
      p.id, p.name, p.projectState, p.sector, p.priority, p.lifecycleStatus,
      p.equipmentSignals, p.matchedBusinessLines, p.suppressed, p.stage,
      p.overview, p.sourceUrl, p.createdAt
    FROM projects p
    WHERE p.projectState IN ('WA', 'OFFSHORE_AU')
      AND (p.suppressed IS NULL OR p.suppressed = 0 OR p.suppressed = '')
      AND p.lifecycleStatus != 'dead'
    ORDER BY p.priority DESC, p.createdAt DESC
  `);

  console.log(`=== TOTAL ACTIVE WA/OFFSHORE_AU PROJECTS: ${projects.length} ===\n`);

  // Classify each project by application family
  const families = {
    core_pa_drilling: [] as any[],
    core_pa_blasting: [] as any[],
    core_pa_piling: [] as any[],
    core_pa_shotcrete: [] as any[],
    core_pa_pneumatic: [] as any[],
    core_pa_temp_plant_air: [] as any[],
    core_pa_abrasive_blasting: [] as any[],
    air_treatment: [] as any[],
    specialty_air_nitrogen: [] as any[],
    specialty_air_purging: [] as any[],
    specialty_air_pipeline_testing: [] as any[],
    specialty_air_commissioning: [] as any[],
    specialty_air_booster: [] as any[],
    specialty_air_package: [] as any[],
    generic_mining: [] as any[],
    generic_construction: [] as any[],
    oil_gas_generic: [] as any[],
    unclassified: [] as any[],
  };

  for (const p of projects) {
    const text = `${p.name} ${p.overview || ''}`.toLowerCase();
    let equip: string[] = [];
    try {
      equip = typeof p.equipmentSignals === 'string' ? JSON.parse(p.equipmentSignals) : (p.equipmentSignals || []);
    } catch { equip = []; }
    const equipText = equip.map((e: string) => e.toLowerCase()).join(' ');
    const combined = `${text} ${equipText}`;

    let classified = false;

    // Core PA - Drilling
    if (/\b(drill|drilling|rc drill|blast.?hole|core drill|waterwell|water well|diamond drill|exploration drill|auger)\b/.test(combined)) {
      families.core_pa_drilling.push(p);
      classified = true;
    }
    // Core PA - Blasting
    if (/\b(blast|blasting|explosive|detonation|shot.?fir)\b/.test(combined) && !/abrasive/.test(combined)) {
      families.core_pa_blasting.push(p);
      classified = true;
    }
    // Core PA - Piling
    if (/\b(pil(e|ing)|bored pile|driven pile|CFA pile|sheet pile)\b/.test(combined)) {
      families.core_pa_piling.push(p);
      classified = true;
    }
    // Core PA - Shotcrete
    if (/\b(shotcrete|underground develop|tunnel|decline|shaft sink)\b/.test(combined)) {
      families.core_pa_shotcrete.push(p);
      classified = true;
    }
    // Core PA - Pneumatic
    if (/\b(pneumatic|jack.?hammer|rock.?break|demolition)\b/.test(combined)) {
      families.core_pa_pneumatic.push(p);
      classified = true;
    }
    // Core PA - Temp plant air
    if (/\b(temporary.*(air|compressor)|plant air|site air|construction air)\b/.test(combined)) {
      families.core_pa_temp_plant_air.push(p);
      classified = true;
    }
    // Core PA - Abrasive blasting
    if (/\b(abrasive blast|sand.?blast|surface prep|grit blast|protective coat)\b/.test(combined)) {
      families.core_pa_abrasive_blasting.push(p);
      classified = true;
    }
    // Air Treatment
    if (/\b(dryer|aftercooler|line dry|dew point|instrument air|oil.?free|moisture)\b/.test(combined)) {
      families.air_treatment.push(p);
      classified = true;
    }
    // Specialty - Nitrogen
    if (/\b(nitrogen|n2 membrane|n2 gen|nitrogen gen)\b/.test(combined)) {
      families.specialty_air_nitrogen.push(p);
      classified = true;
    }
    // Specialty - Purging/Inerting
    if (/\b(purg|inert|inerting|purging)\b/.test(combined)) {
      families.specialty_air_purging.push(p);
      classified = true;
    }
    // Specialty - Pipeline testing
    if (/\b(pipeline test|pressure test|leak test|hydrostatic|pneumatic test|pigging)\b/.test(combined)) {
      families.specialty_air_pipeline_testing.push(p);
      classified = true;
    }
    // Specialty - Commissioning
    if (/\b(commission|pre.?commission|dry.?out|dehydrat)\b/.test(combined)) {
      families.specialty_air_commissioning.push(p);
      classified = true;
    }
    // Specialty - Booster
    if (/\b(booster|high.?pressure air|high.?pressure compressor|hp air)\b/.test(combined)) {
      families.specialty_air_booster.push(p);
      classified = true;
    }
    // Specialty - Package (LNG/FPSO/offshore)
    if (/\b(lng|fpso|subsea|offshore|gas plant|gas processing|liquefaction)\b/.test(combined)) {
      families.specialty_air_package.push(p);
      classified = true;
    }

    if (!classified) {
      // Generic classification
      if (/\b(mine|mining|gold|iron ore|lithium|nickel|copper|rare earth)\b/.test(combined)) {
        families.generic_mining.push(p);
      } else if (/\b(oil|gas|petroleum|hydrocarbon|refiner)\b/.test(combined)) {
        families.oil_gas_generic.push(p);
      } else if (/\b(construct|road|bridge|rail|building|civil)\b/.test(combined)) {
        families.generic_construction.push(p);
      } else {
        families.unclassified.push(p);
      }
    }
  }

  console.log('=== PART A: APPLICATION FAMILY COUNTS ===\n');
  console.log('--- CORE PORTABLE AIR ---');
  console.log(`  Drilling:           ${families.core_pa_drilling.length}`);
  console.log(`  Blasting:           ${families.core_pa_blasting.length}`);
  console.log(`  Piling:             ${families.core_pa_piling.length}`);
  console.log(`  Shotcrete/UG:       ${families.core_pa_shotcrete.length}`);
  console.log(`  Pneumatic:          ${families.core_pa_pneumatic.length}`);
  console.log(`  Temp Plant Air:     ${families.core_pa_temp_plant_air.length}`);
  console.log(`  Abrasive Blasting:  ${families.core_pa_abrasive_blasting.length}`);
  console.log('');
  console.log('--- AIR TREATMENT ---');
  console.log(`  Dryers/Aftercoolers: ${families.air_treatment.length}`);
  console.log('');
  console.log('--- SPECIALTY AIR/GAS ---');
  console.log(`  Nitrogen/N2:        ${families.specialty_air_nitrogen.length}`);
  console.log(`  Purging/Inerting:   ${families.specialty_air_purging.length}`);
  console.log(`  Pipeline Testing:   ${families.specialty_air_pipeline_testing.length}`);
  console.log(`  Commissioning:      ${families.specialty_air_commissioning.length}`);
  console.log(`  Booster/HP:         ${families.specialty_air_booster.length}`);
  console.log(`  Package (LNG/FPSO): ${families.specialty_air_package.length}`);
  console.log('');
  console.log('--- GENERIC (no specific PA signal) ---');
  console.log(`  Generic Mining:     ${families.generic_mining.length}`);
  console.log(`  Generic O&G:        ${families.oil_gas_generic.length}`);
  console.log(`  Generic Construction: ${families.generic_construction.length}`);
  console.log(`  Unclassified:       ${families.unclassified.length}`);
  console.log('');

  // Source type analysis
  const [sourceRows]: any = await conn.query(`
    SELECT 
      p.id, p.name, p.sourceUrl,
      CASE 
        WHEN p.sourceUrl LIKE '%tenders%' OR p.sourceUrl LIKE '%procurement%' OR p.sourceUrl LIKE '%eprocure%' OR p.sourceUrl LIKE '%austender%' OR p.sourceUrl LIKE '%ictender%' OR p.sourceUrl LIKE '%tenderlink%' THEN 'tender'
        WHEN p.sourceUrl LIKE '%rss%' OR p.sourceUrl LIKE '%feed%' OR p.sourceUrl IS NULL THEN 'rss_or_unknown'
        ELSE 'rss_or_other'
      END as source_type
    FROM projects p
    WHERE p.projectState IN ('WA', 'OFFSHORE_AU')
      AND (p.suppressed IS NULL OR p.suppressed = 0 OR p.suppressed = '')
      AND p.lifecycleStatus != 'dead'
  `);

  const sourceCounts = { tender: 0, rss_or_unknown: 0, rss_or_other: 0 };
  for (const r of sourceRows) {
    sourceCounts[r.source_type as keyof typeof sourceCounts]++;
  }
  console.log('=== SOURCE TYPE BREAKDOWN ===');
  console.log(`  Tender-sourced:     ${sourceCounts.tender}`);
  console.log(`  RSS/News-sourced:   ${sourceCounts.rss_or_other}`);
  console.log(`  Unknown/null source: ${sourceCounts.rss_or_unknown}`);
  console.log('');

  // Priority breakdown
  const priorityCounts = { hot: 0, warm: 0, cold: 0, other: 0 };
  for (const p of projects) {
    if (p.priority === 'hot') priorityCounts.hot++;
    else if (p.priority === 'warm') priorityCounts.warm++;
    else if (p.priority === 'cold') priorityCounts.cold++;
    else priorityCounts.other++;
  }
  console.log('=== PRIORITY BREAKDOWN ===');
  console.log(`  Hot:   ${priorityCounts.hot}`);
  console.log(`  Warm:  ${priorityCounts.warm}`);
  console.log(`  Cold:  ${priorityCounts.cold}`);
  console.log(`  Other: ${priorityCounts.other}`);
  console.log('');

  // Show top projects in each specialty family
  console.log('=== TOP PROJECTS BY FAMILY (first 5 each) ===\n');
  
  const showFamily = (name: string, items: any[]) => {
    if (items.length === 0) return;
    console.log(`--- ${name} (${items.length} total) ---`);
    for (const p of items.slice(0, 5)) {
      console.log(`  [${p.id}] ${p.name} | ${p.priority} | ${p.projectState} | ${p.sector || 'n/a'}`);
    }
    console.log('');
  };

  showFamily('Core PA - Drilling', families.core_pa_drilling);
  showFamily('Core PA - Blasting', families.core_pa_blasting);
  showFamily('Core PA - Piling', families.core_pa_piling);
  showFamily('Core PA - Shotcrete/UG', families.core_pa_shotcrete);
  showFamily('Core PA - Abrasive Blasting', families.core_pa_abrasive_blasting);
  showFamily('Air Treatment', families.air_treatment);
  showFamily('Specialty - Nitrogen', families.specialty_air_nitrogen);
  showFamily('Specialty - Purging/Inerting', families.specialty_air_purging);
  showFamily('Specialty - Pipeline Testing', families.specialty_air_pipeline_testing);
  showFamily('Specialty - Commissioning', families.specialty_air_commissioning);
  showFamily('Specialty - Package (LNG/FPSO)', families.specialty_air_package);
  showFamily('Generic Mining (no PA signal)', families.generic_mining);
  showFamily('Unclassified', families.unclassified);

  await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
