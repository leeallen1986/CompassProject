import { eq } from "drizzle-orm";
import { pipelineRuns, type PipelineStep } from "../drizzle/schema";
import { evaluateExtractionHealth, failureCategoryStepCounts } from "./aiExtractionHealth";
import { runExtractionPipeline } from "./aiExtractor";
import { getDb, markStaleProjects } from "./db";
import { harvestAllFeeds } from "./rssHarvester";
import { classifyAllProjects } from "./tierClassification";

const RECOVERY_CRITICAL_STEPS = new Set([
  "RSS Harvest",
  "AI Extraction",
  "Tier Classification",
  "Staleness Check",
  "Source Monitoring Snapshot",
]);

export interface RecoveryPipelineResult {
  runId: number;
  status: "completed" | "failed";
  steps: PipelineStep[];
  extraction: {
    selected: number;
    processed: number;
    extracted: number;
    duplicates: number;
    skipped: number;
    failed: number;
    deferred: number;
    providerCallsAttempted: number;
    providerCallsSucceeded: number;
    provider: string | null;
    model: string | null;
  };
}

function startStep(name: string): PipelineStep {
  return {
    name,
    status: "skipped",
    startedAt: new Date().toISOString(),
  };
}

function completeStep(step: PipelineStep, counts?: Record<string, number>): void {
  step.status = "completed";
  step.completedAt = new Date().toISOString();
  step.durationMs = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
  if (counts) step.counts = counts;
}

function failStep(step: PipelineStep, safeError: string, counts?: Record<string, number>): void {
  step.status = "failed";
  step.completedAt = new Date().toISOString();
  step.durationMs = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
  step.error = safeError;
  if (counts) step.counts = counts;
}

/**
 * Recovery intentionally refreshes only the critical discovery/truth chain.
 * Contact enrichment, Apollo, discovery queues and Contractor Engine are left
 * to the next natural full worker run so self-healing cannot repeat the same
 * expensive non-critical workload that previously stalled in the web plane.
 */
export async function runRecoveryPipeline(): Promise<RecoveryPipelineResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const startedAt = new Date();
  const [inserted] = await db.insert(pipelineRuns).values({
    runType: "daily",
    status: "running",
    triggeredBy: "self-healing-retry",
    lastProgressAt: startedAt,
    currentStep: "Recovery bootstrap",
    lastActivityNote: "Worker recovery profile started; non-critical enrichment is intentionally excluded.",
  });
  const runId = Number(inserted.insertId);
  const steps: PipelineStep[] = [];
  const errors: string[] = [];

  async function checkpoint(currentStep: string | null, note: string): Promise<void> {
    await db.update(pipelineRuns)
      .set({
        steps,
        errors: errors.length > 0 ? errors : null,
        currentStep,
        lastProgressAt: new Date(),
        lastActivityNote: note,
      })
      .where(eq(pipelineRuns.id, runId));
  }

  let harvestResult = {
    totalSources: 0,
    totalNew: 0,
    totalDuplicates: 0,
    totalErrors: 0,
  };
  const harvestStep = startStep("RSS Harvest");
  await checkpoint("RSS Harvest", "Recovery: starting RSS harvest.");
  try {
    const result = await harvestAllFeeds();
    harvestResult = {
      totalSources: result.totalSources,
      totalNew: result.totalNew,
      totalDuplicates: result.totalDuplicates,
      totalErrors: result.totalErrors,
    };
    completeStep(harvestStep, {
      sources: result.totalSources,
      newArticles: result.totalNew,
      duplicates: result.totalDuplicates,
      errors: result.totalErrors,
    });
  } catch (error) {
    const safe = "RSS Harvest failed during worker recovery";
    errors.push(safe);
    failStep(harvestStep, safe);
  }
  steps.push(harvestStep);
  await checkpoint("AI Extraction", `Recovery harvest complete: ${harvestResult.totalNew} new articles.`);

  let extractionResult: Awaited<ReturnType<typeof runExtractionPipeline>>;
  const extractionStep = startStep("AI Extraction");
  try {
    extractionResult = await runExtractionPipeline({ pipelineRunId: runId });
    const health = evaluateExtractionHealth(extractionResult);
    const counts = {
      selected: extractionResult.selected,
      processed: extractionResult.processed,
      extracted: extractionResult.extracted,
      duplicates: extractionResult.duplicates,
      skipped: extractionResult.skipped,
      failed: extractionResult.failed,
      deferred: extractionResult.deferred,
      sideEffectFailures: extractionResult.sideEffectFailures,
      providerCallsAttempted: extractionResult.providerCallsAttempted,
      providerCallsSucceeded: extractionResult.providerCallsSucceeded,
      creditsUsed: extractionResult.creditsUsed,
      degraded: health.state === "degraded" ? 1 : 0,
      ...failureCategoryStepCounts(extractionResult.failureCategories),
    };
    if (health.shouldFailStage) {
      const safe = health.safeReason || "AI extraction quality threshold failed";
      errors.push(`Extraction: ${safe}`);
      failStep(extractionStep, safe, counts);
    } else {
      completeStep(extractionStep, counts);
    }
  } catch {
    const safe = "AI Extraction failed during worker recovery";
    errors.push(safe);
    failStep(extractionStep, safe);
    extractionResult = {
      selected: 0,
      processed: 0,
      extracted: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
      sideEffectFailures: 0,
      providerCallsAttempted: 0,
      providerCallsSucceeded: 0,
      provider: null,
      model: null,
      creditsUsed: 0,
      failureCategories: {},
      awardedProjectsInserted: 0,
      drillingCampaignsInserted: 0,
      results: [],
    };
  }
  steps.push(extractionStep);
  await checkpoint(
    "Tier Classification",
    `Recovery extraction: ${extractionResult.processed} attempted, ${extractionResult.extracted} extracted, ${extractionResult.skipped} skipped, ${extractionResult.failed} failed, ${extractionResult.deferred} deferred via ${extractionResult.provider ?? "unknown"}/${extractionResult.model ?? "unknown"}.`,
  );

  const tierStep = startStep("Tier Classification");
  try {
    const tiers = await classifyAllProjects();
    completeStep(tierStep, {
      classified: tiers.classified,
      tier1: tiers.tier1Count,
      tier2: tiers.tier2Count,
      tier3: tiers.tier3Count,
    });
  } catch {
    const safe = "Tier Classification failed during worker recovery";
    errors.push(safe);
    failStep(tierStep, safe);
  }
  steps.push(tierStep);
  await checkpoint("Staleness Check", "Recovery tier classification finished.");

  const stalenessStep = startStep("Staleness Check");
  try {
    const stale = await markStaleProjects();
    completeStep(stalenessStep, {
      markedStale: stale.staled,
      archived: stale.archived,
    });
  } catch {
    const safe = "Staleness Check failed during worker recovery";
    errors.push(safe);
    failStep(stalenessStep, safe);
  }
  steps.push(stalenessStep);
  await checkpoint("Source Monitoring Snapshot", "Recovery staleness check finished.");

  const monitorStep = startStep("Source Monitoring Snapshot");
  completeStep(monitorStep, {
    totalSteps: steps.length,
    completed: steps.filter(step => step.status === "completed").length,
    failed: steps.filter(step => step.status === "failed").length,
  });
  steps.push(monitorStep);

  const hasCriticalFailure = steps.some(
    step => RECOVERY_CRITICAL_STEPS.has(step.name) && step.status === "failed",
  );
  const status: "completed" | "failed" = hasCriticalFailure ? "failed" : "completed";
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  await db.update(pipelineRuns)
    .set({
      status,
      completedAt,
      durationMs,
      feedsFetched: harvestResult.totalSources,
      feedErrors: harvestResult.totalErrors,
      articlesIngested: harvestResult.totalNew,
      articlesDuplicate: harvestResult.totalDuplicates,
      articlesExtracted: extractionResult.extracted,
      projectsCreated: extractionResult.extracted,
      projectsDuplicate: extractionResult.duplicates,
      drillingCampaignsCreated: extractionResult.drillingCampaignsInserted,
      awardedProjectsCreated: extractionResult.awardedProjectsInserted,
      steps,
      errors: errors.length > 0 ? errors : null,
      currentStep: null,
      lastProgressAt: completedAt,
      lastActivityNote: `Worker recovery ${status}: ${extractionResult.extracted} projects extracted via ${extractionResult.provider ?? "unknown"}/${extractionResult.model ?? "unknown"}; non-critical enrichment was intentionally skipped.`,
    })
    .where(eq(pipelineRuns.id, runId));

  return {
    runId,
    status,
    steps,
    extraction: {
      selected: extractionResult.selected,
      processed: extractionResult.processed,
      extracted: extractionResult.extracted,
      duplicates: extractionResult.duplicates,
      skipped: extractionResult.skipped,
      failed: extractionResult.failed,
      deferred: extractionResult.deferred,
      providerCallsAttempted: extractionResult.providerCallsAttempted,
      providerCallsSucceeded: extractionResult.providerCallsSucceeded,
      provider: extractionResult.provider,
      model: extractionResult.model,
    },
  };
}
