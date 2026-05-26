/**
 * run-digest-safe-promotion.ts
 * 
 * One-shot runner for the digestSafe auto-promotion pass.
 * Run after Apollo enrichment to unlock new digest-safe projects.
 * 
 * Usage: tsx scripts/run-digest-safe-promotion.ts
 */
import "dotenv/config";
import { runDigestSafePromotion } from "../server/digestSafePromotion";

async function main() {
  console.log("[Runner] Starting digestSafe promotion pass...");
  const result = await runDigestSafePromotion();
  console.log("[Runner] Result:", JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error("[Runner] Fatal error:", err);
  process.exit(1);
});
