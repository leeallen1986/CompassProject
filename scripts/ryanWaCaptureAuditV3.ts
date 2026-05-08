import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  // Ryan's profile: userId=2340043, territories=WA, BLs=Portable Air,PT Capital Sales
  console.log('=== RYAN PEMBERTON PROFILE ===');
  console.log('userId: 2340043');
  console.log('territories: WA');
  console.log('assignedBusinessLines: Portable Air, PT Capital Sales');
  console.log('salesMotion: direct_only');
  console.log('');

  // Get all active WA + OFFSHORE_AU projects
  const [projects]: any = await conn.query(`
    SELECT 
      p.id, p.name, p.projectState, p.sector, p.priority, p.lifecycleStatus,
      p.equipmentSignals, p.matchedBusinessLines, p.suppressed, p.stage,
      p.overview, p.sources, p.sourcePurpose, p.tenderNumber, p.createdAt
    FROM projects p
    WHERE p.projectState IN ('WA', 'OFFSHORE_AU')
      AND (p.suppressed IS NULL OR p.suppressed = 0 OR p.suppressed = '')
      AND p.lifecycleStatus != 'dead'
    ORDER BY p.priority DESC, p.createdAt DESC
  `);

  console.log(`=== TOTAL ACTIVE WA/OFFSHORE_AU PROJECTS: ${projects.length} ===\n`);

  // Classify each project by application family
  interface FamilyEntry { id: number; name: string; priority: string; projectState: string; sector: string; sourceUrl: string; }
  const families: Record<string, FamilyEntry[]> = {
    core_pa_drilling: [],
    core_pa_blasting: [],
    core_pa_piling: [],
    core_pa_shotcrete_ug: [],
    core_pa_pneumatic: [],
    core_pa_temp_plant_air: [],
    core_pa_abrasive_blasting: [],
    air_treatment: [],
    specialty_nitrogen: [],
    specialty_purging_inerting: [],
    specialty_pipeline_testing: [],
    specialty_commissioning: [],
    specialty_booster: [],
    specialty_package_lng_fpso: [],
    generic_mining: [],
    generic_oil_gas: [],
    generic_construction: [],
    unclassified: [],
  };

  for (const p of projects) {
    const text = `${p.name} ${p.overview || ''}`.toLowerCase();
    let equip: string[] = [];
    try {
      equip = typeof p.equipmentSignals === 'string' ? JSON.parse(p.equipmentSignals) : (p.equipmentSignals || []);
    } catch { equip = []; }
    const equipText = (equip as string[]).map(e => e.toLowerCase()).join(' ');
    const combined = `${text} ${equipText}`;

    const entry: FamilyEntry = { id: p.id, name: p.name, priority: p.priority, projectState: p.projectState, sector: p.sector || '', sourceUrl: p.sources || '' };
    let classified = false;

    if (/\b(drill|drilling|rc drill|blast.?hole|core drill|waterwell|water well|diamond drill|exploration drill|auger)\b/.test(combined)) {
      families.core_pa_drilling.push(entry); classified = true;
    }
    if (/\b(blast|blasting|explosive|detonation|shot.?fir)\b/.test(combined) && !/abrasive/.test(combined)) {
      families.core_pa_blasting.push(entry); classified = true;
    }
    if (/\b(pil(e|ing)|bored pile|driven pile|CFA|sheet pile)\b/i.test(combined)) {
      families.core_pa_piling.push(entry); classified = true;
    }
    if (/\b(shotcrete|underground develop|tunnel|decline|shaft sink|raise bore)\b/.test(combined)) {
      families.core_pa_shotcrete_ug.push(entry); classified = true;
    }
    if (/\b(pneumatic|jack.?hammer|rock.?break|demolition)\b/.test(combined)) {
      families.core_pa_pneumatic.push(entry); classified = true;
    }
    if (/\b(temporary.*(air|compressor)|plant air|site air|construction air)\b/.test(combined)) {
      families.core_pa_temp_plant_air.push(entry); classified = true;
    }
    if (/\b(abrasive blast|sand.?blast|surface prep|grit blast|protective coat)\b/.test(combined)) {
      families.core_pa_abrasive_blasting.push(entry); classified = true;
    }
    if (/\b(dryer|aftercooler|line dry|dew point|instrument air|oil.?free|moisture)\b/.test(combined)) {
      families.air_treatment.push(entry); classified = true;
    }
    if (/\b(nitrogen|n2 membrane|n2 gen|nitrogen gen)\b/.test(combined)) {
      families.specialty_nitrogen.push(entry); classified = true;
    }
    if (/\b(purg|inert|inerting|purging)\b/.test(combined)) {
      families.specialty_purging_inerting.push(entry); classified = true;
    }
    if (/\b(pipeline test|pressure test|leak test|hydrostatic|pneumatic test|pigging)\b/.test(combined)) {
      families.specialty_pipeline_testing.push(entry); classified = true;
    }
    if (/\b(commission|pre.?commission|dry.?out|dehydrat)\b/.test(combined)) {
      families.specialty_commissioning.push(entry); classified = true;
    }
    if (/\b(booster|high.?pressure air|high.?pressure compressor|hp air)\b/.test(combined)) {
      families.specialty_booster.push(entry); classified = true;
    }
    if (/\b(lng|fpso|subsea|offshore platform|gas plant|gas processing|liquefaction)\b/.test(combined)) {
      families.specialty_package_lng_fpso.push(entry); classified = true;
    }

    if (!classified) {
      if (/\b(mine|mining|gold|iron ore|lithium|nickel|copper|rare earth|mineral)\b/.test(combined)) {
        families.generic_mining.push(entry);
      } else if (/\b(oil|gas|petroleum|hydrocarbon|refiner)\b/.test(combined)) {
        families.generic_oil_gas.push(entry);
      } else if (/\b(construct|road|bridge|rail|building|civil)\b/.test(combined)) {
        families.generic_construction.push(entry);
      } else {
        families.unclassified.push(entry);
      }
    }
  }

  console.log('=== PART A: APPLICATION FAMILY COUNTS ===\n');
  console.log('FAMILY                         | COUNT');
  console.log('-------------------------------|------');
  console.log(`Core PA - Drilling             | ${families.core_pa_drilling.length}`);
  console.log(`Core PA - Blasting             | ${families.core_pa_blasting.length}`);
  console.log(`Core PA - Piling               | ${families.core_pa_piling.length}`);
  console.log(`Core PA - Shotcrete/UG         | ${families.core_pa_shotcrete_ug.length}`);
  console.log(`Core PA - Pneumatic            | ${families.core_pa_pneumatic.length}`);
  console.log(`Core PA - Temp Plant Air       | ${families.core_pa_temp_plant_air.length}`);
  console.log(`Core PA - Abrasive Blasting    | ${families.core_pa_abrasive_blasting.length}`);
  console.log(`Air Treatment                  | ${families.air_treatment.length}`);
  console.log(`Specialty - Nitrogen/N2        | ${families.specialty_nitrogen.length}`);
  console.log(`Specialty - Purging/Inerting   | ${families.specialty_purging_inerting.length}`);
  console.log(`Specialty - Pipeline Testing   | ${families.specialty_pipeline_testing.length}`);
  console.log(`Specialty - Commissioning      | ${families.specialty_commissioning.length}`);
  console.log(`Specialty - Booster/HP         | ${families.specialty_booster.length}`);
  console.log(`Specialty - Package (LNG/FPSO) | ${families.specialty_package_lng_fpso.length}`);
  console.log(`Generic Mining (no PA signal)  | ${families.generic_mining.length}`);
  console.log(`Generic O&G (no PA signal)     | ${families.generic_oil_gas.length}`);
  console.log(`Generic Construction           | ${families.generic_construction.length}`);
  console.log(`Unclassified                   | ${families.unclassified.length}`);
  console.log('');

  // Totals
  const coreTotal = families.core_pa_drilling.length + families.core_pa_blasting.length + families.core_pa_piling.length + families.core_pa_shotcrete_ug.length + families.core_pa_pneumatic.length + families.core_pa_temp_plant_air.length + families.core_pa_abrasive_blasting.length;
  const airTreatTotal = families.air_treatment.length;
  const specTotal = families.specialty_nitrogen.length + families.specialty_purging_inerting.length + families.specialty_pipeline_testing.length + families.specialty_commissioning.length + families.specialty_booster.length + families.specialty_package_lng_fpso.length;
  const genericTotal = families.generic_mining.length + families.generic_oil_gas.length + families.generic_construction.length + families.unclassified.length;
  console.log(`TOTALS: Core PA=${coreTotal}, Air Treatment=${airTreatTotal}, Specialty Air=${specTotal}, Generic/Unclassified=${genericTotal}`);
  console.log('');

  // Source type analysis
  let tenderCount = 0, rssCount = 0, unknownCount = 0;
  for (const p of projects) {
    const rawSrc = typeof p.sources === 'string' ? p.sources : JSON.stringify(p.sources || '');
    const src = rawSrc.toLowerCase();
    const purpose = (p.sourcePurpose || '').toLowerCase();
    const hasTender = p.tenderNumber || src.includes('tender') || src.includes('procurement') || src.includes('austender') || src.includes('tenderlink') || src.includes('eprocure') || src.includes('icn') || purpose.includes('tender');
    if (hasTender) {
      tenderCount++;
    } else if (src === '' || src === 'null' || !src) {
      unknownCount++;
    } else {
      rssCount++;
    }
  }
  console.log('=== SOURCE TYPE BREAKDOWN ===');
  console.log(`  Tender-sourced:      ${tenderCount}`);
  console.log(`  RSS/News-sourced:    ${rssCount}`);
  console.log(`  Unknown/null source: ${unknownCount}`);
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

  // Show top projects in key families
  console.log('=== SAMPLE PROJECTS BY FAMILY ===\n');
  const showFamily = (name: string, items: FamilyEntry[]) => {
    if (items.length === 0) { console.log(`--- ${name}: EMPTY ---\n`); return; }
    console.log(`--- ${name} (${items.length}) ---`);
    for (const p of items.slice(0, 3)) {
      console.log(`  [${p.id}] ${p.name} | ${p.priority} | ${p.projectState}`);
    }
    if (items.length > 3) console.log(`  ... and ${items.length - 3} more`);
    console.log('');
  };

  showFamily('Core PA - Drilling', families.core_pa_drilling);
  showFamily('Core PA - Blasting', families.core_pa_blasting);
  showFamily('Core PA - Piling', families.core_pa_piling);
  showFamily('Core PA - Shotcrete/UG', families.core_pa_shotcrete_ug);
  showFamily('Core PA - Pneumatic', families.core_pa_pneumatic);
  showFamily('Core PA - Temp Plant Air', families.core_pa_temp_plant_air);
  showFamily('Core PA - Abrasive Blasting', families.core_pa_abrasive_blasting);
  showFamily('Air Treatment', families.air_treatment);
  showFamily('Specialty - Nitrogen', families.specialty_nitrogen);
  showFamily('Specialty - Purging/Inerting', families.specialty_purging_inerting);
  showFamily('Specialty - Pipeline Testing', families.specialty_pipeline_testing);
  showFamily('Specialty - Commissioning', families.specialty_commissioning);
  showFamily('Specialty - Booster/HP', families.specialty_booster);
  showFamily('Specialty - Package (LNG/FPSO)', families.specialty_package_lng_fpso);
  showFamily('Generic Mining', families.generic_mining);
  showFamily('Generic O&G', families.generic_oil_gas);
  showFamily('Generic Construction', families.generic_construction);
  showFamily('Unclassified', families.unclassified);

  await conn.end();
}
main().catch(e => { console.error(e); process.exit(1); });
