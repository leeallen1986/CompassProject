import type { Request, Response } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { pipelineRuns } from "../drizzle/schema";
import { handleScheduledPipelineTrigger as handleExistingScheduledPipelineTrigger } from "./scheduledPipeline";
import {
  classifyPipelineRun,
  scheduledTriggerDecision,
  staleRunMessage,
} from "./pipelineRunReliability";

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
 * The legacy handler ignores `running` rows older than four hours. V2 does not:
 * every persisted running writer blocks a second automatic trigger. Fresh
 * progress returns an ordinary in-progress response; stale progress returns a
 * stronger operator-intervention response. This is deliberately fail-closed.
 */
export async function handleScheduledPipelineTrigger(req: Request, res: Response): Promise<void> {
  try {
    const running = await latestRunningRun();
    if (running) {
      const classified = classifyPipelineRun(running);
      const decision = scheduledTriggerDecision(classified.health);

      if (decision === "block_healthy_running") {
        console.log(`[ScheduledPipelineGuard] Pipeline run ${classified.runId} is still active; refusing duplicate trigger`);
        res.status(409).json({
          status: "in_progress",
          runId: classified.runId,
          message: `Pipeline run ${classified.runId} is already executing — duplicate execution is blocked`,
          triggeredAt: new Date().toISOString(),
        });
        return;
      }

      if (decision === "block_stale_running") {
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
