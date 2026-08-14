from pathlib import Path

path = Path("server/dailyPipeline.ts")
text = path.read_text()

replacements = [
    (
        'import { runContractorEngine } from "./contractorEngine";',
        'import { runContractorEngineIsolated } from "./contractorEngineSubprocess";',
    ),
    (
        'import { runDigestSafePromotion } from "./digestSafePromotion";',
        'import { runDigestSafePromotion } from "./digestSafePromotion";\nimport { selectPipelineRuntimeBudgetMs } from "./pipelineRuntimePolicy";',
    ),
    (
        'const PIPELINE_TIMEOUT_MS = 90 * 60 * 1000; // 90 minutes max (enrichment is downstream and bounded)\n',
        '',
    ),
    (
        '''export async function runDailyPipeline(triggeredBy?: string): Promise<DailyPipelineResult> {
  // Start keepalive at the outer level so it's cleaned up even on timeout
  const keepalive = startKeepalive();
  try {
    return await withTimeout(_runDailyPipelineInner(triggeredBy), PIPELINE_TIMEOUT_MS, "Daily pipeline global timeout");
  } finally {
    keepalive.stop();
  }
}''',
        '''export async function runDailyPipeline(triggeredBy?: string): Promise<DailyPipelineResult> {
  // Scheduled cron/self-healing runs get a larger execution-plane budget while
  // manual/web-triggered runs retain the existing 90-minute safety limit.
  const runtimeBudgetMs = selectPipelineRuntimeBudgetMs(triggeredBy);
  const keepalive = startKeepalive();
  try {
    return await withTimeout(
      _runDailyPipelineInner(triggeredBy),
      runtimeBudgetMs,
      `Daily pipeline global timeout (${Math.round(runtimeBudgetMs / 60000)} min budget)`,
    );
  } finally {
    keepalive.stop();
  }
}''',
    ),
    (
        '''  // ── Step 15: Contractor & Delivery Pattern Engine (Wednesdays + Saturdays) ──
  const contractorStep = startStep("Contractor Engine");
  if (dayOfWeek === 3 || dayOfWeek === 6) {
    console.log("[DailyPipeline] Step 15: Running contractor & delivery pattern engine...");
    try {
      const ceResult = await runContractorEngine();
      completeStep(contractorStep, {
        companies: ceResult.registry.totalCompanies,
        newCompanies: ceResult.registry.newCompanies,
        pairings: ceResult.pairings.totalPairings,
        patterns: ceResult.patterns.totalPatterns,
      });
      console.log(`[DailyPipeline] Contractor engine complete: ${ceResult.registry.totalCompanies} companies, ${ceResult.pairings.totalPairings} pairings, ${ceResult.patterns.totalPatterns} patterns`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      failStep(contractorStep, errMsg);
      errors.push(`Contractor engine: ${errMsg}`);
      console.error("[DailyPipeline] Contractor engine failed:", errMsg);
    }
  } else {
    skipStep(contractorStep, "Runs on Wednesdays and Saturdays");
    console.log("[DailyPipeline] Step 15: Skipping contractor engine (runs Wed/Sat)");
  }
  steps.push(contractorStep);''',
        '''  // ── Step 15: Contractor & Delivery Pattern Engine (Wednesdays + Saturdays) ──
  markStepStarted("Contractor Engine");
  const contractorStep = startStep("Contractor Engine");
  if (dayOfWeek === 3 || dayOfWeek === 6) {
    console.log("[DailyPipeline] Step 15: Running contractor & delivery pattern engine in isolated subprocess...");
    try {
      const isolated = await runContractorEngineIsolated();
      if (isolated.status !== "success") {
        throw new Error(isolated.errorSummary);
      }
      const ceResult = isolated.data;
      completeStep(contractorStep, {
        companies: ceResult.registry.totalCompanies,
        newCompanies: ceResult.registry.newCompanies,
        pairings: ceResult.pairings.totalPairings,
        patterns: ceResult.patterns.totalPatterns,
      });
      console.log(`[DailyPipeline] Contractor engine complete: ${ceResult.registry.totalCompanies} companies, ${ceResult.pairings.totalPairings} pairings, ${ceResult.patterns.totalPatterns} patterns`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      failStep(contractorStep, errMsg);
      errors.push(`Contractor engine: ${errMsg}`);
      console.error("[DailyPipeline] Contractor engine failed:", errMsg);
    }
  } else {
    skipStep(contractorStep, "Runs on Wednesdays and Saturdays");
    console.log("[DailyPipeline] Step 15: Skipping contractor engine (runs Wed/Sat)");
  }
  steps.push(contractorStep);''',
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match, found {count}: {old[:100]!r}")
    text = text.replace(old, new, 1)

path.write_text(text)
