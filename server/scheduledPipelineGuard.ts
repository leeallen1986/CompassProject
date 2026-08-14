import type { Request, Response } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { pipelineRuns } from "../drizzle/schema";
import { handleScheduledPipelineTrigger as handleExistingScheduledPipelineTrigger } from "./scheduledPipeline";
import { classifyPipelineRun, staleRunMessage } from "./pipelineRunReliability";

async function latestRunningRun() {
  const db = await getDb();
  if (!db) return null;
  const [run] = await db
    .select({
      id: pipelineRuns.id,
      status: pipelineRuns.status,
      startedAt: pipelineRuns.startedAt,
      completedAt: pipelineRuns.completedAt,
      lastProgressAt: pipelineRuns.lastProgressAt,
      currentStep: pipelineRuns.currentStep,
      triggeredBy: pipelineRuns.triggeredBy,
    })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.status, "running"))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  return run ?? null;
}

/**
 * Safety preflight for the existing scheduled-pipeline handler.
 *
 * The legacy handler ignores `running` rows older than four hours. That means a
 * 27-hour orphan can silently permit a second writer. We fail closed instead:
 * a healthy running row remains handled by the existing 409 guard; a stale
 * running row is explicitly blocked until the old worker is terminated or a
 * process restart performs stale-run cleanup.
 */
export async function handleScheduledPipelineTrigger(req: Request, res: Response): Promise<void> {
  try {
    const running = await latestRunningRun();
    if (running) {
      const classified = classifyPipelineRun(running);
      if (classified.health === "stale_running") {
        const message = staleRunMessage(classified);
        console.error(`[ScheduledPipelineGuard] ${message}; refusing a second pipeline writer`);
        res.status(409).json({
          status: "stale_run_blocked",
          runId: classified.runId,
          message: `${message}. Automatic duplicate execution is blocked until the stale worker is safely cleared.`,
          triggeredAt: new Date().toISOString(),
        });
        return;
      }
    }
  } catch (error) {
    // Fail closed if we cannot establish whether an existing writer is active.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ScheduledPipelineGuard] Preflight failed: ${message}`);
    res.status(503).json({
      status: "reliability_preflight_failed",
      runId: null,
      message: "Could not safely determine whether a pipeline writer is already active.",
      triggeredAt: new Date().toISOString(),
    });
    return;
  }

  return handleExistingScheduledPipelineTrigger(req, res);
}
