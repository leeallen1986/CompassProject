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
 * Execution model:
 *   The endpoint uses NDJSON streaming to keep the HTTP connection alive
 *   while the pipeline runs. CloudRun kills instances when there are no
 *   active HTTP connections, so we must keep this connection open for the
 *   full pipeline duration (30-60 minutes).
 *
 *   Stream format:
 *     Line 1: {"event":"started","runId":123,"triggeredAt":"..."}
 *     Lines 2-N: {"event":"heartbeat","elapsed":30,"status":"running"}
 *     Last line: {"event":"completed","runId":123,"duration":1800,"summary":{...}}
 *     OR:       {"event":"failed","runId":123,"error":"..."}
 *
 * Idempotency:
 *   - If a pipeline run with status "running" was started within the last
 *     4 hours, returns 409 with the in-progress run ID.
 *   - If a "completed" run exists within the last IDEMPOTENCY_WINDOW_HOURS
 *     (default 4h), returns 200 with status="already_ran" and the run ID.
 *     This handles Manus scheduler retries without creating duplicate runs.
 *
 * Status values:
 *   "started"     — pipeline launched, streaming progress
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

/** Heartbeat interval in milliseconds (30 seconds). */
const HEARTBEAT_INTERVAL_MS = 30_000;

export type ScheduledPipelineResponse = {
  status: "started" | "already_ran" | "in_progress" | "error";
  runId: number | null;
  message: string;
  triggeredAt: string;
  pipelineResult?: Record<string, unknown>;
};

/**
 * Authenticate the request.
 * Accepts:
 *   1. Scheduled-task cookie + X-Scheduled-Task header (automated trigger)
 *   2. Admin/owner session cookie (manual trigger from Admin panel)
 *
 * Returns { authenticated, triggeredBy } or null if auth fails.
 */
async function authenticateRequest(req: Request): Promise<{ triggeredBy: string } | null> {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user) {
      console.warn("[ScheduledPipeline] No user resolved from session cookie — rejecting");
      return null;
    }

    // Scheduled-task path: requires X-Scheduled-Task header
    const scheduledHeader = req.headers["x-scheduled-task"];
    if (scheduledHeader) {
      console.log(`[ScheduledPipeline] Authenticated as scheduled-task user: ${user.name || user.openId}`);
      return { triggeredBy: "scheduled-task" };
    }

    // Admin path: requires admin role (owner)
    if (user.role === "admin") {
      console.log(`[ScheduledPipeline] Authenticated as admin: ${user.name || user.openId}`);
      return { triggeredBy: user.name || user.openId || "admin" };
    }

    // Regular user without scheduled-task header — reject
    console.warn(`[ScheduledPipeline] User ${user.name || user.openId} is not admin and missing X-Scheduled-Task header — rejecting`);
    return null;
  } catch (err) {
    console.warn("[ScheduledPipeline] Auth failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Check if a pipeline run is currently in progress.
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
 * Write a line of NDJSON to the response stream.
 * Returns false if the connection is closed.
 */
function writeLine(res: Response, data: Record<string, unknown>): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(JSON.stringify(data) + "\n");
    return true;
  } catch {
    return false;
  }
}

/**
 * Express route handler for POST /api/scheduled/pipeline
 *
 * Uses NDJSON streaming to keep the CloudRun connection alive while the
 * pipeline runs. Sends heartbeat lines every 30 seconds.
 */
export async function handleScheduledPipelineTrigger(
  req: Request,
  res: Response
): Promise<void> {
  const triggeredAt = new Date().toISOString();
  const logPrefix = "[ScheduledPipeline]";
  const startMs = Date.now();

  console.log(`${logPrefix} POST /api/scheduled/pipeline received at ${triggeredAt}`);

  // ── Auth ──
  const authResult = await authenticateRequest(req);
  if (!authResult) {
    res.status(401).json({
      status: "error",
      runId: null,
      message: "Unauthorized — valid admin session or scheduled-task cookie required",
      triggeredAt,
    } satisfies ScheduledPipelineResponse);
    return;
  }
  const { triggeredBy } = authResult;

  // ── Idempotency: in-progress check ──
  const inProgressId = await getInProgressRunId();
  if (inProgressId !== null) {
    console.log(`${logPrefix} Pipeline already in progress (run ID ${inProgressId}) — returning 409`);
    res.status(409).json({
      status: "in_progress",
      runId: inProgressId,
      message: `Pipeline run ${inProgressId} is already executing — skipping duplicate trigger`,
      triggeredAt,
    } satisfies ScheduledPipelineResponse);
    return;
  }

  // ── Idempotency: recently completed check ──
  const recentId = await getRecentCompletedRunId();
  if (recentId !== null) {
    console.log(
      `${logPrefix} Pipeline already completed within ${IDEMPOTENCY_WINDOW_HOURS}h window (run ID ${recentId}) — returning 200 already_ran`
    );
    res.status(200).json({
      status: "already_ran",
      runId: recentId,
      message: `Pipeline run ${recentId} completed within the last ${IDEMPOTENCY_WINDOW_HOURS}h — no duplicate run needed`,
      triggeredAt,
    } satisfies ScheduledPipelineResponse);
    return;
  }

  // ── Start streaming response ──
  // Set headers for NDJSON streaming — prevents CloudRun from buffering
  // and keeps the connection alive for the full pipeline duration.
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  res.setHeader("Transfer-Encoding", "chunked");
  res.status(200);
  res.flushHeaders();

  console.log(`${logPrefix} Launching daily pipeline with streaming heartbeat (triggered by: ${triggeredBy})...`);

  // Send initial "started" event
  writeLine(res, { event: "started", triggeredAt, message: "Pipeline launched" });

  // Start heartbeat timer
  let heartbeatCount = 0;
  const heartbeatTimer = setInterval(() => {
    heartbeatCount++;
    const elapsed = Math.round((Date.now() - startMs) / 1000);
    const alive = writeLine(res, {
      event: "heartbeat",
      seq: heartbeatCount,
      elapsedSeconds: elapsed,
      status: "running",
    });
    if (!alive) {
      console.warn(`${logPrefix} Connection closed by client after ${elapsed}s — heartbeat stopped`);
      clearInterval(heartbeatTimer);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Run pipeline synchronously within the streaming request
  try {
    const result = await runDailyPipeline(triggeredBy);
    clearInterval(heartbeatTimer);

    const durationSec = Math.round((Date.now() - startMs) / 1000);
    console.log(
      `${logPrefix} ✓ Pipeline completed: ` +
      `${result.extraction.extracted} new projects, ` +
      `${result.enrichment.enriched} contacts enriched, ` +
      `duration=${durationSec}s`
    );

    // ── Post-Pipeline Delta Gate ──
    // After pipeline completes, snapshot the current top 3 per rep for delta comparison.
    // This allows the Monday digest hardening gate to detect regressions.
    let deltaSnapshotCount = 0;
    try {
      const { snapshotPostPipelineState } = await import("./digestHardeningGates");
      const deltaResult = await snapshotPostPipelineState();
      deltaSnapshotCount = deltaResult.repsSnapshotted;
      console.log(`${logPrefix} \u2713 Post-pipeline delta snapshot stored for ${deltaSnapshotCount} reps`);
    } catch (deltaErr) {
      console.warn(`${logPrefix} \u26A0 Post-pipeline delta snapshot failed (non-fatal):`, deltaErr);
    }

    writeLine(res, {
      event: "completed",
      durationSeconds: durationSec,
      summary: {
        projectsExtracted: result.extraction.extracted,
        contactsEnriched: result.enrichment.enriched,
        discoveryQueued: result.discoveryQueue?.slaQueued ?? 0,
        errorCount: result.steps.filter(s => s.status === 'failed').length,
        deltaSnapshotReps: deltaSnapshotCount,
      },
    });
  } catch (err) {
    clearInterval(heartbeatTimer);

    const durationSec = Math.round((Date.now() - startMs) / 1000);
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`${logPrefix} ✗ Pipeline failed after ${durationSec}s:`, errorMsg);

    writeLine(res, {
      event: "failed",
      durationSeconds: durationSec,
      error: errorMsg,
    });
  } finally {
    // End the streaming response
    if (!res.writableEnded) {
      res.end();
    }
  }
}

/**
 * Exported constants for tests
 */
export { IDEMPOTENCY_WINDOW_HOURS, IN_PROGRESS_WINDOW_HOURS };
