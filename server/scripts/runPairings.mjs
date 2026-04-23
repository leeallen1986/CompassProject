import { createConnection } from "mysql2/promise";

// Use DATABASE_URL from process.env (already injected by the platform)
const db = await createConnection(process.env.DATABASE_URL);

// Get max co-occurrence for normalisation
const [maxRows] = await db.execute("SELECT MAX(coOccurrenceCount) as maxCount FROM contractorPairings");
const maxCount = maxRows[0].maxCount || 1;
console.log(`Max co-occurrence: ${maxCount}`);

// Re-score all pairings with the logarithmic formula
const [allPairings] = await db.execute("SELECT id, coOccurrenceCount FROM contractorPairings");
console.log(`Re-scoring ${allPairings.length} pairings...`);

for (const p of allPairings) {
  // Log-normalised base score (0-80) + fixed diversity bonus (10) = max 90
  // Pairs with count=1 get ~0, count=max get ~80, rest spread logarithmically
  const logScore = Math.log(p.coOccurrenceCount + 1) / Math.log(maxCount + 1) * 80;
  const newScore = Math.min(100, Math.round(logScore + 10));
  await db.execute("UPDATE contractorPairings SET strengthScore = ? WHERE id = ?", [newScore, p.id]);
}

// Verify top 20
const [updated] = await db.execute(
  "SELECT companyAName, companyBName, coOccurrenceCount, strengthScore FROM contractorPairings ORDER BY coOccurrenceCount DESC LIMIT 20"
);
console.log("\nUpdated top 20 pairings:");
for (const r of updated) {
  console.log(`  ${r.companyAName} <-> ${r.companyBName}: count=${r.coOccurrenceCount}, score=${r.strengthScore}`);
}

// Check score distribution
const [dist] = await db.execute(
  "SELECT FLOOR(strengthScore/10)*10 as bucket, COUNT(*) as cnt FROM contractorPairings GROUP BY bucket ORDER BY bucket"
);
console.log("\nScore distribution (bucket: count):");
for (const d of dist) {
  console.log(`  ${d.bucket}-${d.bucket+9}: ${d.cnt}`);
}

await db.end();
console.log("\nDone.");
