import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

const db = await createConnection(process.env.DATABASE_URL);

const [sources] = await db.execute(`
  SELECT id, name, isActive, lastSuccessAt, totalArticles, consecutiveErrors, failureCount
  FROM rssSources
  WHERE isActive = 1
  ORDER BY lastSuccessAt ASC
`);

const cutoff = new Date("2026-03-01");
const dead = sources.filter(s => !s.lastSuccessAt || new Date(s.lastSuccessAt) < cutoff || (s.consecutiveErrors ?? 0) >= 3);
const alive = sources.filter(s => s.lastSuccessAt && new Date(s.lastSuccessAt) >= cutoff && (s.consecutiveErrors ?? 0) < 3);

console.log("\n=== DEAD SOURCES (zero yield since March 2026 or 3+ consecutive errors) ===");
console.log(JSON.stringify(dead.map(s => ({ id: s.id, name: s.name, lastSuccessAt: s.lastSuccessAt, consecutiveErrors: s.consecutiveErrors, totalArticles: s.totalArticles })), null, 2));

console.log("\n=== ALIVE SOURCES ===");
console.log(JSON.stringify(alive.map(s => ({ id: s.id, name: s.name, lastSuccessAt: s.lastSuccessAt, totalArticles: s.totalArticles })), null, 2));

console.log(`\nTotal active: ${sources.length}, Dead: ${dead.length}, Alive: ${alive.length}`);

await db.end();
