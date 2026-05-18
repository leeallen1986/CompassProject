/**
 * Refresh Digest Previews — 18 May 2026
 * Regenerates all 9 rep digest previews to include newly enriched contacts.
 * Uses dryRun=true so no emails are sent.
 */

import { sendWeeklyDigests } from "../emailDigest.js";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  log("=== REFRESHING DIGEST PREVIEWS ===");
  log("Running sendWeeklyDigests(force=false, dryRun=true)...");

  const result = await sendWeeklyDigests(false, true);

  const previews = result.previews ?? [];
  log(`\n✓ ${previews.length} recipient previews generated`);

  if (previews.length > 0) {
    log("\nPer-rep preview summary:");
    for (const p of previews) {
      const repName = (p as any).repName ?? (p as any).userName ?? (p as any).userId ?? "unknown";
      const itemCount = (p as any).itemCount ?? (p as any).projects?.length ?? 0;
      const topProject = (p as any).projects?.[0]?.name ?? (p as any).topProject ?? "";
      log(`  ${repName}: ${itemCount} items${topProject ? ` | top: ${topProject}` : ""}`);
    }
  }

  log(`\nCompleted: ${new Date().toISOString()}`);
  process.exit(0);
}

main().catch(err => {
  console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
