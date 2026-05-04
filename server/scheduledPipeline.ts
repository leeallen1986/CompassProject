/**
 * Scheduled Pipeline Endpoint Handler
 *
 * Provides POST /api/scheduled/pipeline — an externally callable endpoint
 * that triggers the daily pipeline from a Manus scheduled task.
 *
 * This is the production trigger path. The in-process setTimeout scheduler
 * in dailyPipeline.ts is kept as a development/fallback convenience only.
 *
 * Auth:   Manus scheduled-task cookie (app_session_id JWT, role=user)
 * Method: POST
 * Path:   /api/scheduled/pipeline
 *
 * Idempotency:
 *   - If a pipeline run with status "running" was started within the last
 *     4 hours, returns 409 with the in-progress run ID.
 *   - If a "completed" run exists within the last IDEMPOTENCY_WINDOW_HOURS
 *     (default 4h), returns 200 with status="already_ran" and the run ID.
 *     This handles Manus scheduler retries without creating duplicate runs.
 *
 * Response shape (always JSON):
 *   { status, runId, message, triggeredAt, pipelineResult? }
 *
 * Status values:
 *   "started"     — pipeline launched successfully
 *   "already_ran" — a completed run exists within the idempotency window
 *   "in_progress" — a run is already executing (409)
 *   "error"       — unexpected failure (500)
 */

import type { Request, Response } from "express";
import { getDb } from "./db";
import { pipelineRuns } from "../drizzle/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { sdk } from "./_core/sdk";
import { runDailyPipeline } from "./dailyPipeline";

/** Hours within which a completed run counts as "already ran" for idempotency. */
const IDEMPOTENCY_WINDOW_HOURS = 4;

/** Hours within which a "running" status is considered genuinely in-progress. */
const IN_PROGRESS_WINDOW_HOURS = 4;

export type ScheduledPipelineResponse = {
  status: "started" | "already_ran" | "in_progress" | "error";
  runId: number | null;
  message: string;
  triggeredAt: string;
  pipelineResult?: Record<string, unknown>;
};

/**
 * Authenticate the scheduled-task request.
 *
 * The Manus platform injects an app_session_id cookie for scheduled tasks,
 * which resolves to a user with role="user". We verify the JWT is valid
 * (same mechanism as all other requests) and then confirm the request
 * carries the X-Scheduled-Task header as an additional signal.
 *
 * Returns the authenticated user or null if auth fails.
 */
async function authenticateScheduledRequest(req: Request): Promise<boolean> {
  // Must carry the scheduled-task marker header
  const scheduledHeader = req.headers["x-scheduled-task"];
  if (!scheduledHeader) {
    console.warn("[ScheduledPipeline] Missing X-Scheduled-Task header — rejecting");
    return false;
  }

  // Verify the session cookie (same JWT verification as all other requests)
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user) {
      console.warn("[ScheduledPipeline] No user resolved from session cookie — rejecting");
      return false;
    }
    console.log(`[ScheduledPipeline] Authenticated as user: ${user.name || user.openId} (role=${user.role})`);
    return true;
  } catch (err) {
    console.warn("[ScheduledPipeline] Auth failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Check if a pipeline run is currently in progress.
 * Returns the run ID if one is running, null otherwise.
 */
async function getInProgressRunId(): Promise<number | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const windowStart = new Date(Date.now() - IN_PROGRESS_WINDOW_HOURS * 3600000);
    const [running] = await db
      .select({ id: pipelineRuns.id, startedAt: pipelineRuns.startedAt })
      .from(pipelineRuns)
      .where(
        and(
          eq(pipelineRuns.status, "running"),
          gte(pipelineRuns.startedAt, windowStart)
        )
      )
      .orderBy(desc(pipelineRuns.startedAt))
      .limit(1);
    return running ? running.id : null;
  } catch {
    return null;
  }
}

/**
 * Check if a completed run exists within the idempotency window.
 * Returns the run ID if one exists, null otherwise.
 */
async function getRecentCompletedRunId(): Promise<number | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const windowStart = new Date(Date.now() - IDEMPOTENCY_WINDOW_HOURS * 3600000);
    const [completed] = await db
      .select({ id: pipelineRuns.id, completedAt: pipelineRuns.completedAt })
      .from(pipelineRuns)
      .where(
        and(
          eq(pipelineRuns.status, "completed"),
          gte(pipelineRuns.completedAt, windowStart)
        )
      )
      .orderBy(desc(pipelineRuns.completedAt))
      .limit(1);
    return completed ? completed.id : null;
  } catch {
    return null;
  }
}

/**
 * Express route handler for POST /api/scheduled/pipeline
 *
 * The pipeline is run asynchronously — the endpoint responds immediately
 * with status="started" and the run ID, then the pipeline executes in the
 * background. This prevents the Manus scheduler from timing out waiting
 * for a 35-minute pipeline to complete.
 */
export async function handleScheduledPipelineTrigger(
  req: Request,
  res: Response
): Promise<void> {
  const triggeredAt = new Date().toISOString();
  const logPrefix = "[ScheduledPipeline]";

  console.log(`${logPrefix} POST /api/scheduled/pipeline received at ${triggeredAt}`);

  // ── Auth ──
  const isAuthed = await authenticateScheduledRequest(req);
  if (!isAuthed) {
    const body: ScheduledPipelineResponse = {
      status: "error",
      runId: null,
      message: "Unauthorized — valid session cookie and X-Scheduled-Task header required",
      triggeredAt,
    };
    res.status(401).json(body);
    return;
  }

  // ── Idempotency: in-progress check ──
  const inProgressId = await getInProgressRunId();
  if (inProgressId !== null) {
    console.log(`${logPrefix} Pipeline already in progress (run ID ${inProgressId}) — returning 409`);
    const body: ScheduledPipelineResponse = {
      status: "in_progress",
      runId: inProgressId,
      message: `Pipeline run ${inProgressId} is already executing — skipping duplicate trigger`,
      triggeredAt,
    };
    res.status(409).json(body);
    return;
  }

  // ── Idempotency: recently completed check ──
  const recentId = await getRecentCompletedRunId();
  if (recentId !== null) {
    console.log(
      `${logPrefix} Pipeline already completed within ${IDEMPOTENCY_WINDOW_HOURS}h window (run ID ${recentId}) — returning 200 already_ran`
    );
    const body: ScheduledPipelineResponse = {
      status: "already_ran",
      runId: recentId,
      message: `Pipeline run ${recentId} completed within the last ${IDEMPOTENCY_WINDOW_HOURS}h — no duplicate run needed`,
      triggeredAt,
    };
    res.status(200).json(body);
    return;
  }

  // ── Launch pipeline asynchronously ──
  // Respond immediately so the Manus scheduler doesn't time out.
  // The pipeline logs its own run ID to the database.
  console.log(`${logPrefix} Launching daily pipeline (triggered by: scheduled-task)...`);

  // We need to get the run ID before responding. Insert a placeholder row
  // synchronously, then kick off the pipeline with that ID.
  let runId: number | null = null;
  try {
    const db = await getDb();
    if (db) {
      const [inserted] = await db.insert(pipelineRuns).values({
        runType: "daily",
        status: "running",
        triggeredBy: "scheduled-task",
      });
      runId = inserted.insertId;
      console.log(`${logPrefix} Pipeline run registered: ID ${runId}`);
    }
  } catch (err) {
    console.error(`${logPrefix} Failed to register pipeline run:`, err);
    // Continue anyway — runDailyPipeline will create its own entry
  }

  // Respond immediately with "started"
  const body: ScheduledPipelineResponse = {
    status: "started",
    runId,
    message: `Daily pipeline launched (run ID: ${runId ?? "pending"})`,
    triggeredAt,
  };
  res.status(202).json(body);

  // Run pipeline in background — do NOT await in the request handler
  runDailyPipeline("scheduled-task").then(result => {
    console.log(
      `${logPrefix} ✓ Pipeline completed (run ID ${runId}): ` +
      `${result.extraction.extracted} new projects extracted, ` +
      `${result.enrichment.enriched} contacts enriched, ` +
      `duration=${Math.round((result.duration || 0) / 1000)}s`
    );
  }).catch(err => {
    console.error(
      `${logPrefix} ✗ Pipeline failed (run ID ${runId}):`,
      err instanceof Error ? err.message : String(err)
    );
  });
}

/**
 * Exported constants for tests
 */
export { IDEMPOTENCY_WINDOW_HOURS, IN_PROGRESS_WINDOW_HOURS };
