/**
 * Expand business line keywords and re-queue skipped articles that match
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { sql } from 'drizzle-orm';

const pool = mysql.createPool(process.env.DATABASE_URL);
const db = drizzle(pool);

// Expanded keyword sets — much broader to capture more relevant articles
const expandedKeywords = {
  // Portable Air (id: 1)
  1: [
    "compressor", "portable air", "compressed air", "drilling", "RC drilling", "diamond drilling",
    "blasting", "pneumatic", "CFM", "air compressor", "sandblasting", "shotcrete", "tunnelling",
    "mining equipment", "construction equipment", "atlas copco", "portable compressor", "air receiver",
    "aftercooler", "drill rig",
    // NEW: broader mining/construction/infrastructure terms
    "mining project", "mine site", "mine expansion", "mine development", "mining contract",
    "mining contractor", "mining award", "mineral exploration", "exploration drilling",
    "quarry", "quarrying", "aggregate", "crusher", "screening plant",
    "tunnel boring", "TBM", "underground mining", "open pit", "open cut",
    "construction project", "infrastructure project", "road construction", "highway construction",
    "rail project", "bridge construction", "dam construction", "pipeline construction",
    "gas pipeline", "LNG", "oil and gas", "offshore", "onshore",
    "defence project", "defence contract", "military base",
    "concrete", "formwork", "earthworks", "excavation",
    "major project", "billion dollar", "contract award", "contract win",
    "mobilisation", "mobilization", "site preparation", "ground works",
    "BHP", "Rio Tinto", "Fortescue", "South32", "Newmont", "Gold Fields",
    "Glencore", "Anglo American", "Mineral Resources", "Pilbara", "Bowen Basin",
    "iron ore", "gold mine", "copper mine", "lithium mine", "nickel mine", "coal mine",
    "rare earth", "critical minerals",
    "Western Australia", "Queensland", "New South Wales", "Northern Territory",
    "contractor", "subcontractor", "EPC", "EPCM", "procurement",
    "Thiess", "Downer", "CIMIC", "Monadelphous", "NRW Holdings", "Macmahon",
    "Perenti", "Byrnecut", "Barminco", "Decmil", "SRG Global",
    "Bechtel", "Fluor", "Worley", "Wood", "Jacobs",
    "hire fleet", "equipment hire", "rental fleet"
  ],
  // PAL (id: 3)
  3: [
    "generator", "power generation", "diesel generator", "portable generator", "lighting tower",
    "light tower", "temporary power", "standby power", "backup power", "construction power",
    "mine site power", "battery energy storage", "BESS", "energy storage system", "hybrid power",
    "solar hybrid", "ZenergiZe",
    // NEW
    "power supply", "genset", "power plant", "electricity generation", "off-grid",
    "remote power", "site power", "emergency power", "load shedding",
    "solar farm", "wind farm", "renewable energy", "clean energy",
    "data centre", "data center", "grid connection", "transmission line",
    "substation", "transformer", "electrical infrastructure",
    "hydrogen", "green hydrogen", "electrolysis", "fuel cell"
  ],
  // Pump Flow (id: 30001)
  30001: [
    "dewatering pump", "submersible pump", "wellpoint dewatering", "pump station", "water pump",
    "mine dewatering", "flood pump", "centrifugal pump", "drainage pump", "slurry pump",
    "water management", "pit dewatering",
    // NEW
    "water treatment", "wastewater", "sewage", "stormwater", "irrigation",
    "desalination", "water infrastructure", "water pipeline", "water supply",
    "dam", "reservoir", "flood mitigation", "flood protection",
    "tailings", "tailings dam", "process water", "recycled water",
    "pump", "pumping", "flow control", "valve", "pipe",
    "TasWater", "SA Water", "Sydney Water", "Melbourne Water", "Water Corporation"
  ],
  // BESS (id: 30002)
  30002: [
    "battery energy storage", "BESS", "energy storage system", "battery storage", "hybrid power",
    "solar hybrid", "ZenergiZe", "peak shaving", "load management", "microgrid", "off-grid power",
    "renewable energy storage", "lithium battery", "containerised power",
    // NEW
    "battery", "energy storage", "grid scale battery", "utility scale battery",
    "MW battery", "MWh", "gigawatt", "GW", "megawatt",
    "solar project", "wind project", "renewable project", "clean energy project",
    "AEMO", "NEM", "national electricity market", "capacity market",
    "inverter", "power conversion", "grid stability", "frequency control",
    "virtual power plant", "VPP", "distributed energy", "DER",
    "Neoen", "AGL", "Origin Energy", "Snowy Hydro", "Transgrid",
    "ElectraNet", "Powerlink", "Ausgrid", "Endeavour Energy"
  ]
};

// Update each business line
for (const [id, keywords] of Object.entries(expandedKeywords)) {
  const uniqueKeywords = [...new Set(keywords)];
  const jsonStr = JSON.stringify(uniqueKeywords);
  await db.execute(sql`UPDATE businessLines SET keywords = ${jsonStr} WHERE id = ${Number(id)}`);
  console.log(`Updated BL ${id}: ${uniqueKeywords.length} keywords`);
}

// Now re-evaluate skipped articles against new keywords
console.log("\n=== RE-EVALUATING SKIPPED ARTICLES ===\n");

const [skipped] = await db.execute(sql`
  SELECT id, title, summary FROM rawArticles WHERE status = 'skipped'
`);

// Load updated business lines
const [bls] = await db.execute(sql`SELECT id, name, keywords FROM businessLines WHERE isActive = true`);

let requeued = 0;
for (const article of skipped) {
  const text = `${article.title} ${article.summary || ''}`.toLowerCase();
  const matchedKeywords = [];
  const matchedBLIds = [];
  
  for (const bl of bls) {
    const kw = typeof bl.keywords === 'string' ? JSON.parse(bl.keywords) : bl.keywords;
    if (!kw) continue;
    const hits = kw.filter(k => text.includes(k.toLowerCase()));
    if (hits.length > 0) {
      matchedKeywords.push(...hits);
      matchedBLIds.push(bl.id);
    }
  }
  
  if (matchedKeywords.length > 0) {
    const uniqueKW = [...new Set(matchedKeywords)];
    const uniqueBL = [...new Set(matchedBLIds)];
    await db.execute(sql`
      UPDATE rawArticles 
      SET status = 'queued', 
          matchedKeywords = ${JSON.stringify(uniqueKW)},
          matchedBusinessLines = ${JSON.stringify(uniqueBL)}
      WHERE id = ${article.id}
    `);
    requeued++;
  }
}

console.log(`Re-queued ${requeued} of ${skipped.length} skipped articles`);

// Check new queue
const [queuedCount] = await db.execute(sql`SELECT COUNT(*) as cnt FROM rawArticles WHERE status = 'queued'`);
console.log(`Total queued for extraction: ${queuedCount[0].cnt}`);

await pool.end();
process.exit(0);
