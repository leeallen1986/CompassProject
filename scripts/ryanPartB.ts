import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  // Get Portable Air business line keywords from DB
  const [blRows]: any = await conn.query(
    `SELECT id, name, keywords FROM businessLines WHERE name = 'Portable Air'`
  );
  const paKeywords: string[] = blRows[0]?.keywords || [];
  console.log(`=== PART B: RSS KEYWORD GATE AUDIT ===\n`);
  console.log(`Portable Air keyword count: ${paKeywords.length}\n`);

  // Group keywords by category
  const groups: Record<string, string[]> = {
    drilling: [],
    blasting: [],
    waterwell: [],
    piling: [],
    shutdown: [],
    commissioning: [],
    abrasive_blasting: [],
    temporary_plant_air: [],
    dryers_air_treatment: [],
    nitrogen_inerting_purging_testing: [],
    compressor_generic: [],
    mining_generic: [],
    oil_gas_pipeline: [],
    other: [],
  };

  for (const kw of paKeywords) {
    const k = kw.toLowerCase();
    if (/drill|rc drill|blast.?hole|core drill|diamond drill|auger|rig/.test(k) && !/abrasive|sand/.test(k)) {
      groups.drilling.push(kw);
    } else if (/blast|explo|detonat|shot.?fir/.test(k) && !/abrasive|sand/.test(k)) {
      groups.blasting.push(kw);
    } else if (/water.?well|bore.?hole|groundwater/.test(k)) {
      groups.waterwell.push(kw);
    } else if (/pil(e|ing)|bored pile|driven pile|CFA|sheet pile/.test(k)) {
      groups.piling.push(kw);
    } else if (/shutdown|turnaround|outage|maintenance shut/.test(k)) {
      groups.shutdown.push(kw);
    } else if (/commission|pre.?commission|dry.?out|dehydrat/.test(k)) {
      groups.commissioning.push(kw);
    } else if (/abrasive|sand.?blast|grit.?blast|surface prep/.test(k)) {
      groups.abrasive_blasting.push(kw);
    } else if (/plant air|site air|temporary.*air|construction air/.test(k)) {
      groups.temporary_plant_air.push(kw);
    } else if (/dryer|aftercooler|dew point|instrument air|oil.?free|moisture|desiccant|refrigerant/.test(k)) {
      groups.dryers_air_treatment.push(kw);
    } else if (/nitrogen|n2|purg|inert|pipeline test|pressure test|leak test|hydrostatic|pigging|dry.?out|booster|high.?pressure/.test(k)) {
      groups.nitrogen_inerting_purging_testing.push(kw);
    } else if (/compressor|compressed air|air supply|portable air|cfm|psi|bar/.test(k)) {
      groups.compressor_generic.push(kw);
    } else if (/mine|mining|gold|iron|lithium|copper|nickel|ore/.test(k)) {
      groups.mining_generic.push(kw);
    } else if (/oil|gas|lng|fpso|offshore|pipeline|petroleum|refin|subsea/.test(k)) {
      groups.oil_gas_pipeline.push(kw);
    } else {
      groups.other.push(kw);
    }
  }

  for (const [group, keywords] of Object.entries(groups)) {
    console.log(`--- ${group} (${keywords.length}) ---`);
    if (keywords.length <= 20) {
      console.log(`  ${keywords.join(', ')}`);
    } else {
      console.log(`  ${keywords.slice(0, 20).join(', ')}`);
      console.log(`  ... and ${keywords.length - 20} more`);
    }
    console.log('');
  }

  // Get RSS sources
  const [sources]: any = await conn.query(
    `SELECT id, name, url, isActive, lastFetchedAt FROM rssSources WHERE isActive = 1 ORDER BY lastFetchedAt DESC`
  );
  console.log(`\n=== ACTIVE RSS SOURCES (${sources.length}) ===\n`);
  for (const s of sources) {
    console.log(`  [${s.id}] ${s.name} | last: ${s.lastFetchedAt ? new Date(s.lastFetchedAt).toISOString().slice(0, 10) : 'never'}`);
  }

  // Check which sources have produced WA/OFFSHORE_AU projects
  const [sourceProjects]: any = await conn.query(`
    SELECT 
      rs.name as sourceName,
      COUNT(DISTINCT a.id) as articleCount,
      COUNT(DISTINCT p.id) as projectCount
    FROM rssSources rs
    LEFT JOIN rssArticles a ON a.sourceId = rs.id
    LEFT JOIN projects p ON p.id IN (
      SELECT DISTINCT projectId FROM projectArticles WHERE articleId = a.id
    ) AND p.projectState IN ('WA', 'OFFSHORE_AU') AND (p.suppressed IS NULL OR p.suppressed = 0 OR p.suppressed = '') AND p.lifecycleStatus != 'dead'
    WHERE rs.isActive = 1
    GROUP BY rs.id, rs.name
    ORDER BY projectCount DESC
  `);
  console.log(`\n=== RSS SOURCE → WA PROJECT CONVERSION ===\n`);
  console.log('SOURCE                              | ARTICLES | WA PROJECTS');
  console.log('------------------------------------|----------|------------');
  for (const sp of sourceProjects) {
    const name = sp.sourceName.padEnd(36).slice(0, 36);
    console.log(`${name}| ${String(sp.articleCount).padStart(8)} | ${String(sp.projectCount).padStart(11)}`);
  }

  // Check articles table existence
  const [tables]: any = await conn.query("SHOW TABLES LIKE 'rssArticles'");
  console.log(`\nrssArticles table exists: ${tables.length > 0}`);
  
  const [tables2]: any = await conn.query("SHOW TABLES LIKE 'projectArticles'");
  console.log(`projectArticles table exists: ${tables2.length > 0}`);

  await conn.end();
}
main().catch(e => { console.error(e); process.exit(1); });
