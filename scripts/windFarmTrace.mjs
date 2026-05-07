/**
 * windFarmTrace.mjs
 * Traces the exact digest assembly path for "WA's Largest Wind Farm Construction"
 * and every project in Ryan's current digest pool.
 *
 * Run: node scripts/windFarmTrace.mjs
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ── 1. Find Ryan's user profile ──
const [ryanRows] = await conn.execute(
  `SELECT u.id, u.name, u.email,
          up.territories, up.assignedBusinessLines, up.sectorFocus,
          up.stageTiming, up.buyerRoles, up.keyAccounts, up.salesMotion,
          up.industries, up.offerCategories, up.customerTypes,
          up.dealSizeMin, up.dealSizeMax
   FROM users u
   JOIN userProfiles up ON up.userId = u.id
   WHERE u.name LIKE '%Ryan%' OR u.email LIKE '%ryan%'
   LIMIT 3`
);
console.log("\n=== Ryan's profile candidates ===");
for (const r of ryanRows) {
  const terr = typeof r.territories === 'string' ? JSON.parse(r.territories) : r.territories;
  const bls  = typeof r.assignedBusinessLines === 'string' ? JSON.parse(r.assignedBusinessLines) : r.assignedBusinessLines;
  console.log(`  id=${r.id} name=${r.name} email=${r.email}`);
  console.log(`  territories=${JSON.stringify(terr)}`);
  console.log(`  assignedBLs=${JSON.stringify(bls)}`);
  console.log(`  salesMotion=${r.salesMotion}`);
}

// ── 2. Find the wind farm project ──
const [windRows] = await conn.execute(
  `SELECT id, name, location, sector, stage, priority, overview, owner, opportunityRoute,
          actionTier, projectState, equipmentSignals
   FROM projects
   WHERE name LIKE '%Wind Farm%' OR name LIKE '%wind farm%'
   LIMIT 5`
);
console.log("\n=== Wind Farm project(s) found ===");
for (const w of windRows) {
  console.log(`  id=${w.id} name=${w.name}`);
  console.log(`  sector=${w.sector} stage=${w.stage} priority=${w.priority}`);
  console.log(`  location=${w.location} projectState=${w.projectState}`);
  console.log(`  actionTier=${w.actionTier}`);
  console.log(`  owner=${w.owner}`);
  console.log(`  overview=${(w.overview || "").substring(0, 200)}`);
  console.log(`  equipmentSignals=${w.equipmentSignals}`);
}

// ── 3. Fetch BL scores for the wind farm project ──
if (windRows.length > 0) {
  const windId = windRows[0].id;
  const [blRows] = await conn.execute(
    `SELECT scoringDimension, score FROM projectBusinessLineScores WHERE projectId = ?`,
    [windId]
  );
  console.log(`\n=== BL scores for project id=${windId} ===`);
  for (const b of blRows) {
    console.log(`  ${b.scoringDimension}: ${b.score}`);
  }

  // ── 4. Simulate the gate call ──
  // Import the compiled gate function
  // Since we can't import TS directly, we'll replicate the gate logic here
  const name = windRows[0].name || "";
  const overview = windRows[0].overview || "";
  const sector = windRows[0].sector || "";
  const stage = windRows[0].stage || "";
  const owner = windRows[0].owner || "";
  const opportunityRoute = windRows[0].opportunityRoute || "";
  const equipmentSignals = windRows[0].equipmentSignals || "";
  const portableAirScore = blRows.find(b => b.scoringDimension === "Portable Air")?.score ?? 0;

  const combined = `${name} ${overview} ${sector} ${stage} ${owner} ${opportunityRoute} ${equipmentSignals}`.toLowerCase();

  // Hard suppress patterns (from laneScoring.ts)
  const hardSuppressPatterns = [
    /\bschool\b|\bprimary school\b|\bhigh school\b|\bsecondary school\b|\bpublic school\b|\bstate school\b|\bcollege\b.*\b(school|education|learning|campus)\b/i,
    /\bhospital\b|\bhealth campus\b|\bmedical centre\b|\bclinical\b|\bhealthcare facility\b|\baged care\b|\bnursing home\b|\bpalliative\b/i,
    /\bcommunity centre\b|\bcivic centre\b|\brecreation centre\b|\bsports centre\b|\baquatic centre\b|\bswimming pool\b|\bstadium\b|\barena\b/i,
    /\bseismic survey\b|\bgeophysical survey\b|\b2d seismic\b|\b3d seismic\b|\bseismic acquisition\b/i,
    /\bpartnering agreement\b|\bframework agreement\b|\bmaster services agreement\b|\bpanel contract\b|\bstanding offer\b|\bprequalification\b/i,
    /\binfrastructure priority list\b|\bipl\b.*\bprojects?\b|\bpriority list\b.*\bprojects?\b/i,
    /\bresearch facility\b|\bresearch centre\b|\buniversity research\b|\bacademic research\b|\bscience facility\b/i,
  ];

  // Property developer suppress
  const propertyDeveloperOwners = ["stockland", "mirvac", "lendlease", "scentre", "vicinity", "dexus", "charter hall", "goodman", "frasers property", "gpT group", "investa", "cromwell"];
  const ownerLower = owner.toLowerCase();
  const isPropertyDeveloper = propertyDeveloperOwners.some(d => ownerLower.includes(d));

  // Wind farm patterns
  const isWindFarm = /\bwind farm\b|\bwind turbine\b|\bwind energy\b|\boffshore wind\b|\bonshore wind\b/i.test(combined);
  const hasSolarOnly = /\bsolar farm\b|\bsolar park\b|\bphotovoltaic\b|\bpv farm\b/i.test(combined) && !/(compressor|compressed air|drilling|blasting|mining|gas|lng|oil|shutdown|maintenance|contractor fleet)/i.test(combined);
  const hasBessOnly = /\bbattery energy storage\b|\bbess\b|\benergy storage system\b/i.test(combined) && !/(compressor|compressed air|drilling|blasting|mining|gas|lng|oil|shutdown|maintenance|contractor fleet)/i.test(combined);

  // Positive signals
  const positiveSignals = [
    /\bdrilling\b|\bblasting\b|\bexcavation\b|\bquarrying\b|\bopen cut\b|\bopen pit\b|\bpit mining\b|\bunderground mining\b/i,
    /\bshutdown\b|\bturnaround\b|\bmaintenance shutdown\b|\bplant shutdown\b|\bscheduled maintenance\b/i,
    /\bcommissioning\b|\bstart.?up\b|\bpre.?commissioning\b|\bfirst gas\b|\bfirst oil\b/i,
    /\bcontractor fleet\b|\bcontractor camp\b|\bremote site\b|\bfly.?in fly.?out\b|\bfifo\b|\bcamp power\b/i,
    /\bcompressed air\b|\bair compressor\b|\bportable compressor\b|\bcompressor package\b|\bair supply\b|\bpneumatic\b/i,
    /\bgas plant\b|\blng plant\b|\bgas processing\b|\bgas compression\b|\bgas pipeline\b|\bgas field\b/i,
    /\bmine site\b|\bmine development\b|\bmining project\b|\bmine expansion\b|\bmine construction\b|\bmining camp\b/i,
    /\brefinery\b|\bprocess plant\b|\bprocess facility\b|\bchemical plant\b|\bpetro.?chemical\b/i,
    /\bdewatering\b|\bwater treatment\b|\bdesalination\b.*\b(mining|industrial|oil|gas)\b/i,
    /\bnaval\b|\bfrigate\b|\bsubmarine\b|\bwarship\b|\bdefence vessel\b|\bmilitary vessel\b/i,
    /\bgold mine\b|\bcopper mine\b|\bnickel mine\b|\biron ore\b|\bbauxite\b|\blithium\b|\bspodumene\b|\brare earth\b/i,
    /\bport development\b|\bport expansion\b|\bport construction\b|\bterminal construction\b|\bwharf\b|\bjetty\b/i,
  ];

  const hardSuppressMatch = hardSuppressPatterns.find(p => p.test(combined));
  const hasPositiveSignal = positiveSignals.some(p => p.test(combined));

  console.log(`\n=== Gate simulation for "${name}" ===`);
  console.log(`  portableAirScore: ${portableAirScore}`);
  console.log(`  isWindFarm: ${isWindFarm}`);
  console.log(`  hasSolarOnly: ${hasSolarOnly}`);
  console.log(`  hasBessOnly: ${hasBessOnly}`);
  console.log(`  isPropertyDeveloper: ${isPropertyDeveloper}`);
  console.log(`  hardSuppressMatch: ${hardSuppressMatch ? hardSuppressMatch.toString() : "none"}`);
  console.log(`  hasPositiveSignal: ${hasPositiveSignal}`);

  if (isWindFarm && !hasPositiveSignal) {
    console.log(`  => GATE RESULT: monitor_only (wind farm, no positive signal)`);
  } else if (isWindFarm && hasPositiveSignal) {
    console.log(`  => GATE RESULT: PASS (wind farm BUT has positive signal override)`);
    // Show which positive signal matched
    for (const p of positiveSignals) {
      if (p.test(combined)) {
        console.log(`     Positive signal matched: ${p.toString()}`);
      }
    }
  } else if (hardSuppressMatch) {
    console.log(`  => GATE RESULT: suppress (hard suppress pattern matched)`);
  } else if (portableAirScore < 15 && !hasPositiveSignal) {
    console.log(`  => GATE RESULT: monitor_only (low portableAirScore + no positive signal)`);
  } else {
    console.log(`  => GATE RESULT: PASS`);
  }
}

// ── 5. Get Ryan's full tier1/tier2 pool with gate simulation ──
const ryanId = ryanRows[0]?.id;
if (ryanId) {
  const ryanProfile = ryanRows[0];
  const territories = typeof ryanProfile.territories === 'string' ? JSON.parse(ryanProfile.territories) : ryanProfile.territories || [];

  // Build territory WHERE clause
  const waKeywords = ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha", "port hedland", "newman", "geraldton", "bunbury", "broome", "norseman", "murchison", "kwinana"];
  const locationClauses = waKeywords.map(k => `LOWER(p.location) LIKE '%${k}%'`).join(" OR ");

  const [pool] = await conn.execute(
    `SELECT p.id, p.name, p.sector, p.stage, p.priority, p.actionTier, p.location,
            p.projectState, p.owner, p.overview, p.equipmentSignals, p.opportunityRoute,
            COALESCE(pbs.score, 0) AS portableAirScore
     FROM projects p
     LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Portable Air'
     WHERE p.lifecycleStatus = 'active'
       AND p.actionTier IN ('tier1_actionable', 'tier2_warm')
       AND (p.projectState = 'WA' OR ${locationClauses})
     ORDER BY p.actionTier ASC, p.priority DESC, portableAirScore DESC
     LIMIT 60`
  );

  console.log(`\n=== Ryan's WA tier1/tier2 pool (${pool.length} projects) ===`);
  console.log(`${"ID".padEnd(6)} ${"Name".padEnd(55)} ${"Sector".padEnd(15)} ${"Stage".padEnd(20)} ${"PaScore".padEnd(8)} ${"Gate".padEnd(15)} Reason`);
  console.log("-".repeat(160));

  let passCount = 0, monitorCount = 0, suppressCount = 0;

  for (const p of pool) {
    const combined = `${p.name} ${p.overview || ""} ${p.sector} ${p.stage || ""} ${p.owner || ""} ${p.opportunityRoute || ""} ${p.equipmentSignals || ""}`.toLowerCase();
    const portableAirScore = Number(p.portableAirScore) || 0;

    // Hard suppress patterns
    const hardSuppressPatterns = [
      { label: "school/education", re: /\bschool\b|\bprimary school\b|\bhigh school\b|\bsecondary school\b|\bpublic school\b|\bstate school\b/i },
      { label: "hospital/health", re: /\bhospital\b|\bhealth campus\b|\bmedical centre\b|\bclinical\b|\bhealthcare facility\b|\baged care\b/i },
      { label: "community/sport", re: /\bcommunity centre\b|\bcivic centre\b|\brecreation centre\b|\bsports centre\b|\baquatic centre\b|\bswimming pool\b|\bstadium\b/i },
      { label: "seismic survey", re: /\bseismic survey\b|\bgeophysical survey\b|\b2d seismic\b|\b3d seismic\b/i },
      { label: "framework/agreement", re: /\bpartnering agreement\b|\bframework agreement\b|\bmaster services agreement\b|\bpanel contract\b|\bstanding offer\b/i },
      { label: "IPL/priority list", re: /\binfrastructure priority list\b|\bipl\b.*\bprojects?\b|\bpriority list\b.*\bprojects?\b/i },
      { label: "research facility", re: /\bresearch facility\b|\bresearch centre\b|\buniversity research\b|\bacademic research\b/i },
    ];

    const propertyDeveloperOwners = ["stockland", "mirvac", "lendlease", "scentre", "vicinity", "dexus", "charter hall", "goodman", "frasers property", "gpt group", "investa", "cromwell"];
    const ownerLower = (p.owner || "").toLowerCase();
    const isPropertyDeveloper = propertyDeveloperOwners.some(d => ownerLower.includes(d));

    const isWindFarm = /\bwind farm\b|\bwind turbine\b|\bwind energy\b|\boffshore wind\b|\bonshore wind\b/i.test(combined);
    const hasSolarOnly = /\bsolar farm\b|\bsolar park\b|\bphotovoltaic\b|\bpv farm\b/i.test(combined) && !/(compressor|compressed air|drilling|blasting|mining|gas|lng|oil|shutdown|maintenance|contractor fleet)/i.test(combined);
    const hasBessOnly = /\bbattery energy storage\b|\bbess\b|\benergy storage system\b/i.test(combined) && !/(compressor|compressed air|drilling|blasting|mining|gas|lng|oil|shutdown|maintenance|contractor fleet)/i.test(combined);

    const positiveSignals = [
      /\bdrilling\b|\bblasting\b|\bexcavation\b|\bquarrying\b|\bopen cut\b|\bopen pit\b|\bpit mining\b|\bunderground mining\b/i,
      /\bshutdown\b|\bturnaround\b|\bmaintenance shutdown\b|\bplant shutdown\b|\bscheduled maintenance\b/i,
      /\bcommissioning\b|\bstart.?up\b|\bpre.?commissioning\b|\bfirst gas\b|\bfirst oil\b/i,
      /\bcontractor fleet\b|\bcontractor camp\b|\bremote site\b|\bfly.?in fly.?out\b|\bfifo\b|\bcamp power\b/i,
      /\bcompressed air\b|\bair compressor\b|\bportable compressor\b|\bcompressor package\b|\bair supply\b|\bpneumatic\b/i,
      /\bgas plant\b|\blng plant\b|\bgas processing\b|\bgas compression\b|\bgas pipeline\b|\bgas field\b/i,
      /\bmine site\b|\bmine development\b|\bmining project\b|\bmine expansion\b|\bmine construction\b|\bmining camp\b/i,
      /\brefinery\b|\bprocess plant\b|\bprocess facility\b|\bchemical plant\b|\bpetro.?chemical\b/i,
      /\bnaval\b|\bfrigate\b|\bsubmarine\b|\bwarship\b|\bdefence vessel\b|\bmilitary vessel\b/i,
      /\bgold mine\b|\bcopper mine\b|\bnickel mine\b|\biron ore\b|\bbauxite\b|\blithium\b|\bspodumene\b|\brare earth\b/i,
      /\bport development\b|\bport expansion\b|\bport construction\b|\bterminal construction\b|\bwharf\b|\bjetty\b/i,
    ];

    const hardMatch = hardSuppressPatterns.find(hp => hp.re.test(combined));
    const hasPositiveSignal = positiveSignals.some(p => p.test(combined));

    let gateResult, gateReason;
    if (hardMatch) {
      gateResult = "SUPPRESS";
      gateReason = `hard: ${hardMatch.label}`;
      suppressCount++;
    } else if (isPropertyDeveloper) {
      gateResult = "SUPPRESS";
      gateReason = `hard: property developer owner`;
      suppressCount++;
    } else if (isWindFarm && !hasPositiveSignal) {
      gateResult = "MONITOR";
      gateReason = "wind farm, no positive signal";
      monitorCount++;
    } else if (hasSolarOnly) {
      gateResult = "MONITOR";
      gateReason = "solar only, no industrial signal";
      monitorCount++;
    } else if (hasBessOnly) {
      gateResult = "MONITOR";
      gateReason = "BESS only, no industrial signal";
      monitorCount++;
    } else if (portableAirScore < 15 && !hasPositiveSignal) {
      gateResult = "MONITOR";
      gateReason = `low PA score (${portableAirScore}), no positive signal`;
      monitorCount++;
    } else {
      gateResult = "PASS";
      gateReason = hasPositiveSignal ? "positive signal" : `PA score ${portableAirScore}`;
      passCount++;
    }

    const nameShort = (p.name || "").substring(0, 54);
    const sectorShort = (p.sector || "").substring(0, 14);
    const stageShort = (p.stage || "").substring(0, 19);
    const gateShort = gateResult.padEnd(14);
    console.log(`${String(p.id).padEnd(6)} ${nameShort.padEnd(55)} ${sectorShort.padEnd(15)} ${stageShort.padEnd(20)} ${String(portableAirScore).padEnd(8)} ${gateShort} ${gateReason}`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`  PASS:    ${passCount}`);
  console.log(`  MONITOR: ${monitorCount}`);
  console.log(`  SUPPRESS: ${suppressCount}`);
  console.log(`  Total:   ${pool.length}`);
}

await conn.end();
