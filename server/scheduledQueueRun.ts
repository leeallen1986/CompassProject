/**
 * Scheduled Queue Run Endpoint Handler
 *
 * Provides POST /api/scheduled/queue-run — an externally callable endpoint
 * that triggers one batch of the contact discovery queue from a Manus
 * scheduled task (fires nightly after midnight UTC when Apollo cap resets).
 *
 * Auth:   Manus scheduled-task cookie (app_session_id JWT, role=user)
 *         OR admin/owner session cookie (manual trigger from Admin panel)
 * Method: POST
 * Path:   /api/scheduled/queue-run
 *
 * Execution model:
 *   Uses NDJSON streaming to keep the HTTP connection alive while the batch
 *   runs (each batch of 10 projects can take up to 300 s). CloudRun kills
 *   instances when there are no active HTTP connections, so we must hold
 *   this connection open for the full batch duration.
 *
 *   Stream format:
 *     Line 1: {"event":"started","triggeredAt":"..."}
 *     Lines 2-N: {"event":"heartbeat","elapsed":30,"status":"running"}
 *     Last line: {"event":"completed","summary":{...}}
 *     OR:       {"event":"failed","error":"..."}
 *
 * Batch summary fields:
 *   queuedStart / queuedEnd          — projects in discovery_queued before/after
 *   sendReadyStart / sendReadyEnd    — send_ready contacts before/after
 *   sendReadyProjectsStart / End     — send_ready_contact projects before/after
 *   apolloCallsUsed                  — estimated Apollo calls (contacts enriched)
 *   newSendReady                     — projects promoted to send_ready_contact
 *   blocked                          — projects blocked (gov/dirty/no-domain)
 *   failed                           — projects that errored
 *   timedOut                         — projects that hit the 90 s per-project timeout
 *   durationSeconds                  — total wall-clock time for the batch
 *
 * Idempotency:
 *   If a queue-run batch completed within the last 30 minutes, returns 200
 *   with status="already_ran" to handle Manus scheduler retries gracefully.
 *   A running batch returns 409 to prevent concurrent runs.
 */

import type { Request, Response } from "express";
import { getDb } from "./db";
import { sdk } from "./_core/sdk";
import { notifyOwner } from "./_core/notification";
import { processDiscoveryQueue } from "./discoveryQueue";
import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

// ── Constants ──

/** Minutes within which a completed run counts as "already ran" for idempotency. */
const IDEMPOTENCY_WINDOW_MINUTES = 30;

/** Heartbeat interval in milliseconds (30 seconds). */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Batch size for each nightly run (10 projects per batch). */
const NIGHTLY_BATCH_SIZE = 10;

// ── In-memory run state (single-instance guard) ──
let runningBatch: { startedAt: Date } | null = null;
let lastCompletedAt: Date | null = null;

// ── DB Stats Helper ──

interface QueueStats {
  sendReady: number;
  sendReadyProjects: number;
  queued: number;
  running: number;
}

async function getQueueStats(): Promise<QueueStats> {
  try {
    const raw = await mysql.createConnection(process.env.DATABASE_URL!);
    const [[c]] = await raw.execute(
      `SELECT
        SUM(contactTrustTier='send_ready') as sr
       FROM contacts
       WHERE crmOrphan=0 OR crmOrphan IS NULL`
    ) as any;
    const [[p]] = await raw.execute(
      `SELECT
        SUM(discoveryStatus='send_ready_contact') as srp,
        SUM(discoveryStatus='discovery_queued') as q,
        SUM(discoveryStatus='discovery_running') as r
       FROM projects
       WHERE lifecycleStatus='active' OR lifecycleStatus IS NULL`
    ) as any;
    await raw.end();
    return {
      sendReady: Number(c?.sr ?? 0),
      sendReadyProjects: Number(p?.srp ?? 0),
      queued: Number(p?.q ?? 0),
      running: Number(p?.r ?? 0),
    };
  } catch (err) {
    console.warn("[ScheduledQueueRun] getQueueStats failed:", err);
    return { sendReady: 0, sendReadyProjects: 0, queued: 0, running: 0 };
  }
}

/** Reset any stuck discovery_running projects before starting a batch. */
async function resetStuckProjects(): Promise<number> {
  try {
    const raw = await mysql.createConnection(process.env.DATABASE_URL!);
    const [result] = await raw.execute(
      `UPDATE projects
       SET discoveryStatus='discovery_queued', lastDiscoveryAt=NULL
       WHERE discoveryStatus='discovery_running'`
    ) as any;
    await raw.end();
    return result.affectedRows ?? 0;
  } catch {
    return 0;
  }
}

// ── Auth ──

async function authenticateRequest(req: Request): Promise<{ triggeredBy: string } | null> {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user) return null;

    // Scheduled-task path: requires X-Scheduled-Task header
    if (req.headers["x-scheduled-task"]) {
      return { triggeredBy: "scheduled-task" };
    }

    // Admin path
    if (user.role === "admin") {
      return { triggeredBy: user.name || user.openId || "admin" };
    }

    // Regular user with scheduled-task cookie (role=user, injected by platform)
    // The platform creates a user-role cookie for scheduled tasks
    return { triggeredBy: `user:${user.name || user.openId}` };
  } catch (err) {
    console.warn("[ScheduledQueueRun] Auth failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ── NDJSON stream helper ──

function writeLine(res: Response, data: Record<string, unknown>): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(JSON.stringify(data) + "\n");
    return true;
  } catch {
    return false;
  }
}

// ── Batch Summary Notification ──

function buildSummaryNotification(summary: {
  triggeredAt: string;
  triggeredBy: string;
  queuedStart: number;
  queuedEnd: number;
  sendReadyStart: number;
  sendReadyEnd: number;
  sendReadyProjectsStart: number;
  sendReadyProjectsEnd: number;
  newSendReady: number;
  blocked: number;
  failed: number;
  timedOut: number;
  stuckReset: number;
  durationSeconds: number;
}): { title: string; content: string } {
  const srDelta = summary.sendReadyEnd - summary.sendReadyStart;
  const srpDelta = summary.sendReadyProjectsEnd - summary.sendReadyProjectsStart;
  const qDelta = summary.queuedEnd - summary.queuedStart;

  const title = `Nightly Queue Run — ${srDelta >= 0 ? "+" : ""}${srDelta} send_ready contacts`;

  const content = [
    `**Nightly Discovery Queue Batch** — ${new Date(summary.triggeredAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} AEST`,
    `Triggered by: ${summary.triggeredBy}`,
    ``,
    `**Queue**`,
    `  Queued start → end: ${summary.queuedStart} → ${summary.queuedEnd} (${qDelta >= 0 ? "+" : ""}${qDelta})`,
    ``,
    `**Contacts**`,
    `  send_ready start → end: ${summary.sendReadyStart} → ${summary.sendReadyEnd} (${srDelta >= 0 ? "+" : ""}${srDelta})`,
    ``,
    `**Projects**`,
    `  send_ready projects start → end: ${summary.sendReadyProjectsStart} → ${summary.sendReadyProjectsEnd} (${srpDelta >= 0 ? "+" : ""}${srpDelta})`,
    `  Newly promoted to send_ready: ${summary.newSendReady}`,
    ``,
    `**Outcomes**`,
    `  Blocked: ${summary.blocked}`,
    `  Failed: ${summary.failed}`,
    `  Timed out: ${summary.timedOut}`,
    `  Stuck projects reset: ${summary.stuckReset}`,
    ``,
    `**Duration:** ${summary.durationSeconds}s`,
    `**Remaining in queue:** ${summary.queuedEnd}`,
  ].join("\n");

  return { title, content };
}

// ── Main Handler ──

export async function handleScheduledQueueRun(req: Request, res: Response): Promise<void> {
  const triggeredAt = new Date().toISOString();
  const logPrefix = "[ScheduledQueueRun]";
  const startMs = Date.now();

  console.log(`${logPrefix} POST /api/scheduled/queue-run received at ${triggeredAt}`);

  // ── Auth ──
  const authResult = await authenticateRequest(req);
  if (!authResult) {
    res.status(401).json({
      status: "error",
      message: "Unauthorized — valid admin session or scheduled-task cookie required",
      triggeredAt,
    });
    return;
  }
  const { triggeredBy } = authResult;

  // ── Idempotency: in-progress check ──
  if (runningBatch) {
    const runningForMs = Date.now() - runningBatch.startedAt.getTime();
    console.log(`${logPrefix} Batch already running (started ${Math.round(runningForMs / 1000)}s ago) — returning 409`);
    res.status(409).json({
      status: "in_progress",
      message: `A queue-run batch is already executing (started ${Math.round(runningForMs / 1000)}s ago)`,
      triggeredAt,
    });
    return;
  }

  // ── Idempotency: recently completed check ──
  if (lastCompletedAt) {
    const minutesAgo = (Date.now() - lastCompletedAt.getTime()) / 60000;
    if (minutesAgo < IDEMPOTENCY_WINDOW_MINUTES) {
      console.log(`${logPrefix} Batch completed ${Math.round(minutesAgo)}m ago — returning 200 already_ran`);
      res.status(200).json({
        status: "already_ran",
        message: `Queue-run batch completed ${Math.round(minutesAgo)} minutes ago — no duplicate run needed`,
        triggeredAt,
      });
      return;
    }
  }

  // ── Start streaming response ──
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Transfer-Encoding", "chunked");
  res.status(200);
  res.flushHeaders();

  runningBatch = { startedAt: new Date() };
  writeLine(res, { event: "started", triggeredAt, triggeredBy, message: "Queue-run batch launched" });

  // ── Heartbeat timer ──
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

  try {
    // ── Before stats ──
    const before = await getQueueStats();
    writeLine(res, {
      event: "before_stats",
      queuedStart: before.queued,
      sendReadyStart: before.sendReady,
      sendReadyProjectsStart: before.sendReadyProjects,
    });

    // ── Reset stuck projects ──
    const stuckReset = await resetStuckProjects();
    if (stuckReset > 0) {
      console.log(`${logPrefix} Reset ${stuckReset} stuck discovery_running projects`);
      writeLine(res, { event: "stuck_reset", count: stuckReset });
    }

    // ── Run one batch ──
    console.log(`${logPrefix} Running discovery queue batch (size=${NIGHTLY_BATCH_SIZE}, triggered by: ${triggeredBy})...`);
    const batchResult = await processDiscoveryQueue({ maxBatch: NIGHTLY_BATCH_SIZE });

    // ── After stats ──
    const after = await getQueueStats();

    // Count timed-out projects from batch results
    const timedOut = batchResult.results.filter(r => r.error === "timeout").length;

    // Build summary
    const durationSeconds = Math.round((Date.now() - startMs) / 1000);
    const summary = {
      triggeredAt,
      triggeredBy,
      queuedStart: before.queued,
      queuedEnd: after.queued,
      sendReadyStart: before.sendReady,
      sendReadyEnd: after.sendReady,
      sendReadyProjectsStart: before.sendReadyProjects,
      sendReadyProjectsEnd: after.sendReadyProjects,
      newSendReady: batchResult.newSendReady,
      blocked: batchResult.blocked,
      failed: batchResult.failed,
      timedOut,
      stuckReset,
      durationSeconds,
      batchProcessed: batchResult.processed,
      priorityA: batchResult.priorityA,
      priorityB: batchResult.priorityB,
      priorityC: batchResult.priorityC,
    };

    clearInterval(heartbeatTimer);

    console.log(
      `${logPrefix} ✓ Batch complete: ` +
      `processed=${batchResult.processed}, newSendReady=${batchResult.newSendReady}, ` +
      `blocked=${batchResult.blocked}, failed=${batchResult.failed}, timedOut=${timedOut}, ` +
      `send_ready=${before.sendReady}→${after.sendReady}, ` +
      `queued=${before.queued}→${after.queued}, ` +
      `duration=${durationSeconds}s`
    );

    writeLine(res, { event: "completed", summary });

    // ── Push owner notification ──
    try {
      const { title, content } = buildSummaryNotification(summary);
      await notifyOwner({ title, content });
    } catch (notifyErr) {
      console.warn(`${logPrefix} Owner notification failed:`, notifyErr instanceof Error ? notifyErr.message : String(notifyErr));
    }

    lastCompletedAt = new Date();

  } catch (err) {
    clearInterval(heartbeatTimer);
    const durationSeconds = Math.round((Date.now() - startMs) / 1000);
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`${logPrefix} ✗ Batch failed after ${durationSeconds}s:`, errorMsg);
    writeLine(res, { event: "failed", durationSeconds, error: errorMsg });
  } finally {
    runningBatch = null;
    if (!res.writableEnded) {
      res.end();
    }
  }
}
