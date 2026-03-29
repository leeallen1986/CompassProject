/**
 * Backfill region classification on existing contacts.
 * Uses batch SQL updates for performance.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

// Non-AU title patterns
const NON_AU_TITLE_PATTERNS = [
  /\blatam\b/i, /\blatin\s*america/i, /\bsouth\s*america/i, /\bcentral\s*america/i,
  /\bbrazil/i, /\bchile\b/i, /\bperu\b/i, /\bcolombia\b/i, /\bargentin/i,
  /\bmexico\b/i, /\bmexican\b/i,
  /\bemea\b/i, /\beurope\b/i, /\beuropean\b/i, /\bmiddle\s*east/i,
  /\bafrica\b/i, /\bafrican\b/i, /\bsub-saharan/i,
  /\bamericas\b/i, /\bnorth\s*america/i, /\busa\b/i, /\bunited\s*states/i,
  /\bcanada\b/i, /\bcanadian\b/i,
  /\bchina\b/i, /\bchinese\b/i, /\bindia\b/i, /\bindian\b/i, /\bjapan/i, /\bkorea/i,
];

const AU_APAC_TITLE_PATTERNS = [
  /\baustrali/i, /\bapac\b/i, /\basia[- ]?pacific/i, /\banz\b/i, /\boceania/i,
  /\bnew\s*zealand/i, /\bperth\b/i, /\bsydney\b/i, /\bmelbourne\b/i, /\bbrisbane\b/i,
  /\bqueensland\b/i, /\bwestern\s*australia/i, /\bnsw\b/i, /\bvictoria\b/i,
  /\bwa\b/i, /\bqld\b/i, /\bpilbara\b/i, /\bkarratha\b/i, /\bnewcastle\b/i,
];

const NON_AU_LOCATION_PATTERNS = [
  /\bbrazil/i, /\bchile\b/i, /\bperu\b/i, /\bcolombia\b/i, /\bargentin/i,
  /\bmexico\b/i, /\bbogot/i, /\blima\b/i, /\bsantiago\b/i, /\bsao\s*paulo/i,
  /\brio\s*de/i, /\bbuenos\s*aires/i,
  /\bunited\s*states/i, /\bcanada\b/i, /\btoronto\b/i, /\bvancouver\b/i,
  /\bcalgary\b/i, /\bhouston\b/i, /\bdenver\b/i, /\bnew\s*york/i,
  /\bunited\s*kingdom/i, /\blondon\b/i, /\bgermany\b/i, /\bfrance\b/i,
  /\bsweden\b/i, /\bstockholm\b/i, /\bbelgium\b/i, /\bnetherlands\b/i,
  /\bsouth\s*africa/i, /\bjohannesburg/i, /\bcape\s*town/i,
  /\bghana\b/i, /\btanzania/i, /\bkenya\b/i,
  /\bindia\b/i, /\bmumbai\b/i, /\bdelhi\b/i,
  /\bchina\b/i, /\bbeijing\b/i, /\bshanghai\b/i,
];

const AU_LOCATION_PATTERNS = [
  /\baustrali/i, /\bperth\b/i, /\bsydney\b/i, /\bmelbourne\b/i,
  /\bbrisbane\b/i, /\badelaide\b/i, /\bdarwin\b/i, /\bhobart\b/i,
  /\bcanberra\b/i, /\bqueensland\b/i, /\bwestern\s*australia/i,
  /\bnew\s*south\s*wales/i, /\bvictoria\b/i, /\btasmania/i,
  /\bnorthern\s*territory/i, /\bsouth\s*australia/i,
  /\bpilbara\b/i, /\bkarratha\b/i, /\bnewcastle\b/i,
  /\bwollongong\b/i, /\btownsville\b/i, /\bmackay\b/i,
  /\bgladstone\b/i, /\bgeelong\b/i, /\bkalgoorlie\b/i,
];

function classifyContact(title, headline, location) {
  const titleToCheck = headline || title || '';
  const locationToCheck = location || '';

  const hasAuTitle = AU_APAC_TITLE_PATTERNS.some(p => p.test(titleToCheck));
  let titleNonAu = false;
  let titleSignal = null;
  for (const pattern of NON_AU_TITLE_PATTERNS) {
    if (pattern.test(titleToCheck)) {
      titleNonAu = true;
      const match = titleToCheck.match(pattern);
      titleSignal = match ? match[0] : null;
      break;
    }
  }

  const hasAuLocation = AU_LOCATION_PATTERNS.some(p => p.test(locationToCheck));
  let locationNonAu = false;
  let locationSignal = null;
  for (const pattern of NON_AU_LOCATION_PATTERNS) {
    if (pattern.test(locationToCheck)) {
      locationNonAu = true;
      const match = locationToCheck.match(pattern);
      locationSignal = match ? match[0] : null;
      break;
    }
  }

  // Title says non-AU, but AU override from title or location
  if (titleNonAu && (hasAuTitle || hasAuLocation)) {
    return { classification: 'australia', reason: 'Has non-AU title signal but AU override' };
  }
  if (titleNonAu) {
    return { classification: 'non_australia', reason: `Title: "${titleSignal}"` };
  }
  // Location says non-AU, but AU override from title
  if (locationNonAu && hasAuTitle) {
    return { classification: 'australia', reason: 'Non-AU location but AU title signal' };
  }
  if (locationNonAu) {
    return { classification: 'non_australia', reason: `Location: "${locationSignal}"` };
  }
  if (hasAuTitle || hasAuLocation) {
    return { classification: 'australia', reason: 'Has AU/APAC signal' };
  }
  return { classification: 'unknown', reason: null };
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const connection = await mysql.createConnection(dbUrl);
  
  const [rows] = await connection.execute(
    'SELECT id, title, linkedinHeadline, linkedinLocation FROM contacts'
  );
  
  console.log(`Processing ${rows.length} contacts for region classification...`);
  
  // Classify all contacts in memory first
  const auIds = [];
  const nonAuUpdates = []; // { id, reason }
  const unknownIds = [];
  const nonAuDetails = [];

  for (const row of rows) {
    const result = classifyContact(row.title, row.linkedinHeadline, row.linkedinLocation);
    
    if (result.classification === 'australia') {
      auIds.push(row.id);
    } else if (result.classification === 'non_australia') {
      nonAuUpdates.push({ id: row.id, reason: result.reason });
      nonAuDetails.push({ id: row.id, title: row.title, headline: row.linkedinHeadline, location: row.linkedinLocation, reason: result.reason });
    } else {
      unknownIds.push(row.id);
    }
  }

  console.log(`\nClassification results:`);
  console.log(`  Australia:     ${auIds.length}`);
  console.log(`  Non-Australia: ${nonAuUpdates.length}`);
  console.log(`  Unknown:       ${unknownIds.length}`);

  // Batch update in chunks of 500
  const BATCH_SIZE = 500;

  // Update Australia contacts
  for (let i = 0; i < auIds.length; i += BATCH_SIZE) {
    const batch = auIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    await connection.execute(
      `UPDATE contacts SET regionClassification = 'australia', geoFilterReason = 'Has AU/APAC signal' WHERE id IN (${placeholders})`,
      batch
    );
    process.stdout.write(`\r  Updated AU: ${Math.min(i + BATCH_SIZE, auIds.length)}/${auIds.length}`);
  }
  if (auIds.length > 0) console.log('');

  // Update Unknown contacts
  for (let i = 0; i < unknownIds.length; i += BATCH_SIZE) {
    const batch = unknownIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    await connection.execute(
      `UPDATE contacts SET regionClassification = 'unknown', geoFilterReason = NULL WHERE id IN (${placeholders})`,
      batch
    );
    process.stdout.write(`\r  Updated Unknown: ${Math.min(i + BATCH_SIZE, unknownIds.length)}/${unknownIds.length}`);
  }
  if (unknownIds.length > 0) console.log('');

  // Update Non-Australia contacts (need individual reasons)
  for (let i = 0; i < nonAuUpdates.length; i++) {
    const { id, reason } = nonAuUpdates[i];
    await connection.execute(
      `UPDATE contacts SET regionClassification = 'non_australia', geoFilterReason = ? WHERE id = ?`,
      [reason, id]
    );
    if ((i + 1) % 50 === 0 || i === nonAuUpdates.length - 1) {
      process.stdout.write(`\r  Updated Non-AU: ${i + 1}/${nonAuUpdates.length}`);
    }
  }
  if (nonAuUpdates.length > 0) console.log('');

  // Print non-AU details
  if (nonAuDetails.length > 0) {
    console.log(`\nNon-Australian contacts detected:`);
    for (const c of nonAuDetails.slice(0, 50)) {
      console.log(`  ID ${c.id}: "${c.title}" | headline: "${c.headline || 'N/A'}" | location: "${c.location || 'N/A'}" | reason: ${c.reason}`);
    }
    if (nonAuDetails.length > 50) {
      console.log(`  ... and ${nonAuDetails.length - 50} more`);
    }
  }

  await connection.end();
  console.log('\nBackfill complete!');
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
