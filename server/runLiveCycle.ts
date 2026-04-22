/**
 * Live cycle runner — captures detailed output from Tenders WA and QTOL NT
 * Run with: npx tsx server/runLiveCycle.ts
 */
import { runDailyPipeline } from "./dailyPipeline";
import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { eq, desc, gte, isNotNull, and } from "drizzle-orm";

async function main() {
  console.log("=".repeat(60));
  console.log("LIVE CYCLE — First run with Tenders WA + QTOL NT");
  console.log("=".repeat(60));
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Snapshot DB state before run
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const beforeCount = await db.select().from(projects);
  const beforeTotal = beforeCount.length;
  const beforeLiveTenders = beforeCount.filter((p: any) => p.sourcePurpose === "live_tender").length;

  console.log(`[Pre-run] Total projects in DB: ${beforeTotal}`);
  console.log(`[Pre-run] Live tender projects: ${beforeLiveTenders}\n`);

  // Run the pipeline
  const result = await runDailyPipeline("live-cycle-validation");

  console.log("\n" + "=".repeat(60));
  console.log("PIPELINE COMPLETE — Analysing new source output");
  console.log("=".repeat(60));

  // Post-run snapshot
  const db2 = await getDb();
  if (!db2) throw new Error("DB not available");
  const afterCount = await db2.select().from(projects);
  const afterTotal = afterCount.length;
  const afterLiveTenders = afterCount.filter((p: any) => p.sourcePurpose === "live_tender").length;

  console.log(`\n[Post-run] Total projects in DB: ${afterTotal} (+${afterTotal - beforeTotal})`);
  console.log(`[Post-run] Live tender projects: ${afterLiveTenders} (+${afterLiveTenders - beforeLiveTenders})`);

  // Tenders WA results
  const tendersWA = (result as any).tendersWA;
  if (tendersWA) {
    console.log("\n── Tenders WA ──────────────────────────────────────");
    if (tendersWA.degraded) {
      console.log(`  STATUS: DEGRADED — ${tendersWA.degradedReason}`);
    } else {
      console.log(`  Tenders found (raw):     ${tendersWA.tendersFound}`);
      console.log(`  Kept after filtering:    ${tendersWA.tendersRelevant}`);
      console.log(`  Projects created:        ${tendersWA.projectsCreated}`);
      console.log(`  Projects updated:        ${tendersWA.projectsUpdated}`);
      if (tendersWA.errors?.length > 0) {
        console.log(`  Errors (${tendersWA.errors.length}):`);
        tendersWA.errors.slice(0, 5).forEach((e: string) => console.log(`    - ${e}`));
      }
      // Show sample of ingested tenders
      if (tendersWA.samples?.length > 0) {
        console.log(`  Sample tenders ingested:`);
        tendersWA.samples.slice(0, 5).forEach((s: any) => {
          console.log(`    [${s.tenderNumber}] ${s.title} — ${s.agency}`);
          console.log(`      Close: ${s.closeDate || "unknown"} | Relevant: ${s.relevant}`);
        });
      }
    }
  } else {
    console.log("\n── Tenders WA: not in result (check pipeline wiring)");
  }

  // QTOL NT results
  const qtolNT = (result as any).qtolNT;
  if (qtolNT) {
    console.log("\n── QTOL NT ──────────────────────────────────────────");
    if (qtolNT.degraded) {
      console.log(`  STATUS: DEGRADED — ${qtolNT.degradedReason}`);
    } else {
      console.log(`  Tenders found (raw):     ${qtolNT.tendersFound}`);
      console.log(`  Kept after filtering:    ${qtolNT.tendersRelevant}`);
      console.log(`  Projects created:        ${qtolNT.projectsCreated}`);
      console.log(`  Projects updated:        ${qtolNT.projectsUpdated}`);
      if (qtolNT.errors?.length > 0) {
        console.log(`  Errors (${qtolNT.errors.length}):`);
        qtolNT.errors.slice(0, 5).forEach((e: string) => console.log(`    - ${e}`));
      }
      if (qtolNT.samples?.length > 0) {
        console.log(`  Sample tenders ingested:`);
        qtolNT.samples.slice(0, 5).forEach((s: any) => {
          console.log(`    [${s.tenderNumber}] ${s.title} — ${s.agency}`);
          console.log(`      Close: ${s.closeDate || "unknown"} | Power&Water: ${s.isPowerAndWater}`);
        });
      }
    }
  } else {
    console.log("\n── QTOL NT: not in result (check pipeline wiring)");
  }

  // Show live tenders closing soon
  const now = Date.now();
  const in14days = now + 14 * 24 * 60 * 60 * 1000;
  const closingSoon = afterCount.filter((p: any) =>
    p.sourcePurpose === "live_tender" &&
    p.tenderCloseDate &&
    new Date(p.tenderCloseDate).getTime() <= in14days &&
    new Date(p.tenderCloseDate).getTime() >= now
  );

  console.log("\n── Closing Soon (live tenders within 14 days) ───────");
  if (closingSoon.length === 0) {
    console.log("  None found.");
  } else {
    closingSoon.forEach((p: any) => {
      const closeDate = new Date(p.tenderCloseDate).toLocaleDateString("en-AU");
      console.log(`  [${p.priority?.toUpperCase() || "?"}] ${p.name}`);
      console.log(`    Close: ${closeDate} | Source: ${p.tenderNumber || "no tender#"}`);
    });
  }

  // Health summary
  console.log("\n── Pipeline Health Summary ──────────────────────────");
  const health = (result as any).healthSummary;
  if (health) {
    console.log(`  Core status:      ${health.coreStatus}`);
    console.log(`  Enrichment:       ${health.enrichmentStatus}`);
    if (health.degradedSources?.length > 0) {
      console.log(`  Degraded sources: ${health.degradedSources.join(", ")}`);
    } else {
      console.log(`  Degraded sources: none`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Completed: ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  process.exit(0);
}

main().catch(err => {
  console.error("Live cycle failed:", err);
  process.exit(1);
});
