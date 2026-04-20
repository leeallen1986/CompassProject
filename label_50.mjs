import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
import fs from "fs";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

// Pull 50 diverse contacts across all campaigns for labelling
const [rows] = await conn.execute(`
  SELECT 
    cc.id, cc.firstName, cc.lastName, cc.title, cc.company, 
    cc.email, cc.enrichedEmail, cc.enrichmentSource,
    cc.score, cc.tier, cc.roleBucket, cc.titleRelevance,
    cc.outreachStatus, cc.matchedProjectIds,
    c.name AS campaignName, c.collateralName
  FROM campaignContacts cc
  JOIN campaigns c ON cc.campaignId = c.id
  ORDER BY cc.score DESC
  LIMIT 200
`);

// Write raw data for labelling
const csv = [
  "id,firstName,lastName,title,company,email,enrichedEmail,enrichmentSource,score,tier,roleBucket,titleRelevance,outreachStatus,hasProjectMatch,campaignName,collateralName"
];
for (const r of rows) {
  const hasMatch = r.matchedProjectIds && r.matchedProjectIds !== '[]' && r.matchedProjectIds !== '';
  csv.push([
    r.id, r.firstName, r.lastName,
    `"${(r.title||'').replace(/"/g,'""')}"`,
    `"${(r.company||'').replace(/"/g,'""')}"`,
    r.email || '', r.enrichedEmail || '', r.enrichmentSource || '',
    r.score, r.tier, r.roleBucket, r.titleRelevance, r.outreachStatus,
    hasMatch ? 'yes' : 'no',
    `"${(r.campaignName||'').replace(/"/g,'""')}"`,
    `"${(r.collateralName||'').replace(/"/g,'""')}"`
  ].join(','));
}
fs.writeFileSync('/home/ubuntu/raw_200_contacts.csv', csv.join('\n'));
console.log(`Wrote ${rows.length} rows to raw_200_contacts.csv`);

// Print summary for manual labelling
console.log('\n=== TIER BREAKDOWN ===');
const tierCount = {};
for (const r of rows) { tierCount[r.tier] = (tierCount[r.tier]||0)+1; }
console.log(tierCount);

console.log('\n=== ROLE BUCKET BREAKDOWN ===');
const rbCount = {};
for (const r of rows) { rbCount[r.roleBucket] = (rbCount[r.roleBucket]||0)+1; }
console.log(rbCount);

console.log('\n=== ENRICHMENT SOURCE ===');
const esCount = {};
for (const r of rows) { esCount[r.enrichmentSource||'none'] = (esCount[r.enrichmentSource||'none']||0)+1; }
console.log(esCount);

// Print first 50 for review
console.log('\n=== FIRST 50 CONTACTS FOR LABELLING ===');
for (let i = 0; i < Math.min(50, rows.length); i++) {
  const r = rows[i];
  const hasMatch = r.matchedProjectIds && r.matchedProjectIds !== '[]' && r.matchedProjectIds !== '';
  const email = r.enrichedEmail || r.email || 'NO EMAIL';
  console.log(`${String(i+1).padStart(2)}. [${r.tier}|${r.score}] ${r.firstName} ${r.lastName} | ${r.title} | ${r.company} | ${email} | ${r.enrichmentSource||'none'} | match:${hasMatch?'Y':'N'}`);
}

await conn.end();
