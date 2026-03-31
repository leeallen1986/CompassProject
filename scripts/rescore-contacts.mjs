/**
 * Re-score all campaign contacts with the updated scoring logic.
 * Adds company-level blasting relevance and adjusts tier thresholds.
 * Run with: node scripts/rescore-contacts.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

// ── Scoring Constants (mirrored from campaignService.ts) ──

const BLASTING_TITLE_PATTERNS = [
  /blast/i, /paint(?:ing|er)?/i, /coat(?:ing|s)?/i, /surface\s*(treat|protect|prep)/i,
  /corrosion/i, /abrasive/i, /sandblast/i, /uhp/i, /nace/i,
];

const DECISION_MAKER_PATTERNS = [
  /managing\s*director/i, /general\s*manager/i, /\bceo\b/i, /\bcoo\b/i,
  /\bdirector\b/i, /\bowner\b/i, /proprietor/i,
  /operations\s*manager/i, /project\s*manager/i, /project\s*director/i,
  /procurement/i, /purchasing/i, /supply\s*chain/i,
  /business\s*development/i, /commercial\s*manager/i,
  /fleet\s*manager/i, /equipment\s*manager/i,
  /maintenance\s*manager/i, /workshop\s*manager/i,
];

const OPERATIONS_PATTERNS = [
  /supervisor/i, /superintendent/i, /coordinator/i, /foreman/i,
  /estimator/i, /engineer/i, /inspector/i, /planner/i,
  /site\s*manager/i, /area\s*manager/i, /branch\s*manager/i,
  /production\s*manager/i, /factory\s*manager/i,
];

const EXCLUDE_TITLE_PATTERNS = [
  /^accounts?\s*(payable|receivable)?$/i, /^admin(istrat)?/i,
  /^store[s]?$/i, /^reception/i, /^office\s*manager/i,
  /customer\s*care/i, /^sales$/i, /^sales\s*rep/i,
];

const BLASTING_COMPANY_PATTERNS = [
  /blast/i, /abrasive/i, /surface\s*(prep|treat|protect)/i, /corrosion/i,
  /coat(?:ing|s)/i, /paint(?:ing)?\s*(service|contractor|solution)/i,
  /sandblast/i, /uhp/i, /hydro\s*blast/i, /grit\s*blast/i,
  /rope\s*access/i, /scaffold/i, /insulation/i, /fireproof/i,
  /\bkaefer\b/i, /\baltrad\b/i, /\bmonadelphous\b/i, /\blinkforce\b/i,
  /\bmaster\s*flow\b/i, /\brema\s*tip/i, /\bcleanco\b/i,
  /\bwa\s*corrosion/i, /\bmatrix\s*corrosion/i,
];

function classifyTitle(title) {
  if (!title || !title.trim()) return { relevance: 'unknown', score: 0 };
  const t = title.trim();
  for (const p of EXCLUDE_TITLE_PATTERNS) {
    if (p.test(t)) return { relevance: 'other', score: 5 };
  }
  for (const p of BLASTING_TITLE_PATTERNS) {
    if (p.test(t)) return { relevance: 'blasting_specialist', score: 40 };
  }
  for (const p of DECISION_MAKER_PATTERNS) {
    if (p.test(t)) return { relevance: 'decision_maker', score: 35 };
  }
  for (const p of OPERATIONS_PATTERNS) {
    if (p.test(t)) return { relevance: 'operations', score: 20 };
  }
  return { relevance: 'other', score: 10 };
}

function isBlastingCompany(company) {
  if (!company) return false;
  return BLASTING_COMPANY_PATTERNS.some(p => p.test(company));
}

function computeScore(contact) {
  const titleResult = classifyTitle(contact.title);
  let score = titleResult.score;

  if (contact.email) score += 15;
  if (contact.mobile) score += 5;

  if (isBlastingCompany(contact.company)) {
    score += 20;
  }

  const matchCount = contact.matchedProjectCount ?? 0;
  if (matchCount > 0) score += Math.min(matchCount * 5, 30);

  if (titleResult.relevance === 'blasting_specialist' && isBlastingCompany(contact.company)) {
    score += 10;
  }

  score = Math.min(score, 100);

  let tier;
  if (score >= 55 && contact.email) {
    tier = 'tier1_hot';
  } else if (score >= 35 && contact.email) {
    tier = 'tier2_warm';
  } else if (score >= 15) {
    tier = 'tier3_enrich';
  } else {
    tier = 'tier4_low';
  }

  return { score, tier, titleRelevance: titleResult.relevance };
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const conn = await mysql.createConnection(dbUrl);
  console.log('Connected to database');

  // Fetch all contacts
  const [rows] = await conn.execute(
    'SELECT id, title, email, mobile, company, reviewedCompanyName, matchedProjectCount FROM campaignContacts'
  );
  console.log(`Found ${rows.length} contacts to re-score`);

  let updated = 0;
  const tierCounts = { tier1_hot: 0, tier2_warm: 0, tier3_enrich: 0, tier4_low: 0 };

  for (const row of rows) {
    const result = computeScore({
      title: row.title,
      email: row.email,
      mobile: row.mobile,
      company: row.reviewedCompanyName || row.company,
      matchedProjectCount: row.matchedProjectCount ?? 0,
    });

    await conn.execute(
      'UPDATE campaignContacts SET score = ?, tier = ?, titleRelevance = ? WHERE id = ?',
      [result.score, result.tier, result.titleRelevance, row.id]
    );

    tierCounts[result.tier]++;
    updated++;
  }

  console.log(`\nRe-scored ${updated} contacts:`);
  console.log(`  Hot:     ${tierCounts.tier1_hot}`);
  console.log(`  Warm:    ${tierCounts.tier2_warm}`);
  console.log(`  Enrich:  ${tierCounts.tier3_enrich}`);
  console.log(`  Low:     ${tierCounts.tier4_low}`);

  await conn.end();
  console.log('\nDone!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
