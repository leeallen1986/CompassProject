/**
 * Operations Reliability Module
 *
 * Provides self-healing capabilities for the weekly pipeline:
 *
 * 1. Warm-up endpoint — GET /api/warmup — lightweight health check that wakes the container
 *    before the pipeline trigger arrives. The external scheduled task should call this
 *    2-3 minutes before the pipeline POST.
 *
 * 2. Self-healing retry — If no pipelineRuns row is created within the expected window
 *    (20:00-20:10 UTC daily), the app itself retries the pipeline trigger internally.
 *    This handles the case where the external scheduled task fails (proxy 403, timeout, etc.)
 *
 * 3. Missed-run detection + alert — A periodic check (every 30 min) that fires notifyOwner()
 *    if no run completes within the expected window (26h from last completion).
 *
 * 4. Operator status — A tRPC query that returns a comprehensive operations status view:
 *    last successful run, last scheduled attempt, next scheduled run, missed-run state.
 *
 * Design principles:
 * - All timers are resilient to container restarts (state is in DB, not memory)
 * - Idempotent: multiple retries don't create duplicate runs (handled by scheduledPipeline)
 * - Non-blocking: all checks run in background, never block request handling
 * - Observable: all actions are logged with [OpsReliability] prefix
 */

import { getDb, getSystemKv, setSystemKv, checkPipelineFreshness } from "./db";
import { pipelineRuns } from "../drizzle/schema";
import { desc, eq, gte, and } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";
import { runDailyPipeline } from "./dailyPipeline";

const LOG_PREFIX = "[OpsReliability]";

// ── Configuration ──────────────────────────────────────────────────────────────

/** Hour (UTC) when the pipeline is expected to run. */
const EXPECTED_RUN_HOUR_UTC = 20;

/** Minutes after EXPECTED_RUN_HOUR_UTC to wait before self-healing retry. */
const RETRY_DELAY_MINUTES = 10;

/** Maximum age (hours) of a completed run before it's considered stale/missed. */
const FRESHNESS_WINDOW_HOURS = 26;

/** How often to check for missed runs (milliseconds). */
const MISSED_RUN_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/** Cooldown between missed-run notifications (hours) — prevents alert spam. */
const NOTIFICATION_COOLDOWN_HOURS = 12;

// ── State ──────────────────────────────────────────────────────────────────────

let selfHealingTimerActive = false;
let missedRunCheckerActive = false;
// NOTE: lastNotificationSentAt is intentionally NOT stored in memory.
// It is persisted to the DB via systemKv so it survives container restarts.
// In-memory caching of the last-checked value is used only to reduce DB reads.
let _cachedLastNotificationAt: Date | null = null;
let selfHealingAttemptCount = 0;
let lastSelfHealingAttemptAt: Date | null = null;

// ── Warm-up Endpoint ───────────────────────────────────────────────────────────

/**
 * GET /api/warmup — Lightweight endpoint that wakes the container.
 * Returns container readiness state and time since last pipeline run.
 * The external scheduled task should call this 2-3 minutes before the pipeline POST.
 */
export function handleWarmup(_req: any, res: any): void {
  const now = new Date();
  res.json({
    ok: true,
    ts: now.toISOString(),
    uptime: process.uptime(),
    selfHealingActive: selfHealingTimerActive,
    missedRunCheckerActive: missedRunCheckerActive,
    lastSelfHealingAttempt: lastSelfHealingAttemptAt?.toISOString() ?? null,
    selfHealingAttempts: selfHealingAttemptCount,
  });
}

// ── Self-Healing Retry ─────────────────────────────────────────────────────────

/**
 * Check if a pipeline run was started today (within the expected window).
 * Returns true if a run exists with startedAt >= today's EXPECTED_RUN_HOUR_UTC.
 */
async function wasRunStartedToday(): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const now = new Date();
    const todayWindow = new Date(now);
    todayWindow.setUTCHours(EXPECTED_RUN_HOUR_UTC, 0, 0, 0);
    // If we haven't reached the expected hour yet, check yesterday
    if (now < todayWindow) {
      todayWindow.setUTCDate(todayWindow.getUTCDate() - 1);
    }
    const [run] = await db
      .select({ id: pipelineRuns.id })
      .from(pipelineRuns)
      .where(gte(pipelineRuns.startedAt, todayWindow))
      .limit(1);
    return !!run;
  } catch (err) {
    console.error(`${LOG_PREFIX} Error checking today's run:`, err);
    return false; // Assume no run on error — will trigger retry
  }
}

/**
 * Attempt a self-healing pipeline run.
 * This is called when no run was detected in the expected window.
 */
async function attemptSelfHealingRun(): Promise<void> {
  selfHealingAttemptCount++;
  lastSelfHealingAttemptAt = new Date();
  console.log(`${LOG_PREFIX} Self-healing attempt #${selfHealingAttemptCount} at ${lastSelfHealingAttemptAt.toISOString()}`);

  // Double-check: maybe the run was created between the check and now
  const alreadyRan = await wasRunStartedToday();
  if (alreadyRan) {
    console.log(`${LOG_PREFIX} Run already exists — self-healing not needed`);
    return;
  }

  try {
    console.log(`${LOG_PREFIX} No run detected in expected window — launching self-healing pipeline...`);
    const result = await runDailyPipeline("self-healing-retry");
    console.log(
      `${LOG_PREFIX} ✓ Self-healing run completed: ` +
      `${result.extraction?.extracted ?? 0} extracted, ` +
      `${result.enrichment?.enriched ?? 0} enriched`
    );
  } catch (err) {
    console.error(
      `${LOG_PREFIX} ✗ Self-healing run failed:`,
      err instanceof Error ? err.message : String(err)
    );
    // Notify owner about the failure
    try {
      await notifyOwner({
        title: "⚠️ Pipeline Self-Healing Failed",
        content: `The scheduled pipeline did not run at ${EXPECTED_RUN_HOUR_UTC}:00 UTC, and the self-healing retry also failed.\n\nError: ${err instanceof Error ? err.message : String(err)}\n\nManual intervention may be required.`,
      });
    } catch {
      console.error(`${LOG_PREFIX} Failed to send self-healing failure notification`);
    }
  }
}

/**
 * Start the self-healing timer.
 * Checks at EXPECTED_RUN_HOUR_UTC + RETRY_DELAY_MINUTES whether a run exists.
 * If not, triggers a self-healing run.
 */
function startSelfHealingTimer(): void {
  if (selfHealingTimerActive) return;
  selfHealingTimerActive = true;

  // In production, DISABLE_DEV_SCHEDULER is true but we still want self-healing
  const isDisabled = process.env.DISABLE_SELF_HEALING === "true";
  if (isDisabled) {
    console.log(`${LOG_PREFIX} Self-healing DISABLED (DISABLE_SELF_HEALING=true)`);
    selfHealingTimerActive = false;
    return;
  }

  function scheduleCheck(): void {
    const now = new Date();
    const checkTime = new Date(now);
    checkTime.setUTCHours(EXPECTED_RUN_HOUR_UTC, RETRY_DELAY_MINUTES, 0, 0);

    // If the check time has already passed today, schedule for tomorrow
    if (checkTime <= now) {
      checkTime.setUTCDate(checkTime.getUTCDate() + 1);
    }

    const delay = checkTime.getTime() - now.getTime();
    const hoursUntil = Math.round(delay / 3600000 * 10) / 10;
    console.log(`${LOG_PREFIX} Self-healing check scheduled in ${hoursUntil}h at ${checkTime.toISOString()}`);

    setTimeout(async () => {
      await attemptSelfHealingRun();
      // Schedule next check for tomorrow
      scheduleCheck();
    }, delay);
  }

  scheduleCheck();
}

// ── Missed-Run Detection ───────────────────────────────────────────────────────

/**
 * Check if the pipeline has missed its expected run window.
 * A run is "missed" if:
 * 1. No completed run exists within FRESHNESS_WINDOW_HOURS
 * 2. We haven't already sent a notification within NOTIFICATION_COOLDOWN_HOURS
 */
async function checkForMissedRun(): Promise<void> {
  try {
    const freshness = await checkPipelineFreshness(FRESHNESS_WINDOW_HOURS);

    // Only alert on stale/failed/never_run — not on running or fresh
    if (freshness.status === "fresh" || freshness.status === "running") {
      return;
    }

    // Check notification cooldown — read from DB so restarts don't reset the cooldown
    const storedTs = await getSystemKv("ops.lastMissedRunNotificationAt");
    const persistedAt = storedTs ? new Date(storedTs) : _cachedLastNotificationAt;
    if (persistedAt) {
      const hoursSinceNotification = (Date.now() - persistedAt.getTime()) / 3600000;
      if (hoursSinceNotification < NOTIFICATION_COOLDOWN_HOURS) {
        return; // Already notified recently — cooldown active
      }
    }

    // Send missed-run notification
    const statusLabel = freshness.status === "never_run" ? "NEVER RAN" :
                        freshness.status === "failed" ? "LAST RUN FAILED" :
                        `STALE (${freshness.ageHours}h since last success)`;

    console.warn(`${LOG_PREFIX} MISSED RUN DETECTED — status: ${statusLabel}`);

    try {
      await notifyOwner({
        title: "⚠️ Pipeline Missed Run Alert",
        content: [
          `Pipeline status: ${statusLabel}`,
          freshness.lastCompletedAt ? `Last successful: ${freshness.lastCompletedAt.toUTCString()}` : "Never completed successfully",
          freshness.lastRunAt ? `Last attempt: ${freshness.lastRunAt.toUTCString()}` : "No attempts recorded",
          freshness.blockedReason ? `Reason: ${freshness.blockedReason}` : "",
          "",
          "The self-healing retry will attempt to run the pipeline. If this alert persists, manual intervention is required.",
        ].filter(Boolean).join("\n"),
      });
      const now = new Date();
      _cachedLastNotificationAt = now;
      await setSystemKv("ops.lastMissedRunNotificationAt", now.toISOString());
      console.log(`${LOG_PREFIX} Missed-run notification sent`);
    } catch (notifyErr) {
      console.error(`${LOG_PREFIX} Failed to send missed-run notification:`, notifyErr);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} Error in missed-run check:`, err);
  }
}

/**
 * Start the periodic missed-run checker.
 * Runs every MISSED_RUN_CHECK_INTERVAL_MS (30 min).
 */
function startMissedRunChecker(): void {
  if (missedRunCheckerActive) return;
  missedRunCheckerActive = true;

  const isDisabled = process.env.DISABLE_MISSED_RUN_CHECKER === "true";
  if (isDisabled) {
    console.log(`${LOG_PREFIX} Missed-run checker DISABLED`);
    missedRunCheckerActive = false;
    return;
  }

  console.log(`${LOG_PREFIX} Missed-run checker started (interval: ${MISSED_RUN_CHECK_INTERVAL_MS / 60000} min)`);

  // Run first check after 5 minutes (let the server stabilize)
  setTimeout(() => {
    checkForMissedRun();
    // Then run periodically
    setInterval(checkForMissedRun, MISSED_RUN_CHECK_INTERVAL_MS);
  }, 5 * 60 * 1000);
}

// ── Operator Status ────────────────────────────────────────────────────────────

export interface OperatorStatus {
  /** Current pipeline freshness status */
  pipelineStatus: "fresh" | "stale" | "failed" | "never_run" | "running";
  /** Whether the pipeline data is within the freshness window */
  isFresh: boolean;
  /** Whether a run is currently in progress */
  isRunning: boolean;
  /** Whether a missed run has been detected */
  isMissedRun: boolean;
  /** Last successful pipeline completion */
  lastSuccessfulRun: {
    completedAt: string | null;
    ageHours: number | null;
  };
  /** Last pipeline attempt (any status) */
  lastAttempt: {
    startedAt: string | null;
    status: string | null;
    triggeredBy: string | null;
  };
  /** Next expected pipeline run */
  nextScheduledRun: {
    expectedAt: string;
    hoursUntil: number;
  };
  /** Self-healing status */
  selfHealing: {
    active: boolean;
    attemptCount: number;
    lastAttemptAt: string | null;
  };
  /** Missed-run checker status */
  missedRunChecker: {
    active: boolean;
    lastNotificationAt: string | null;
  };
  /** Server uptime in seconds */
  serverUptimeSeconds: number;
}

/**
 * Get comprehensive operator status for the admin dashboard.
 */
export async function getOperatorStatus(): Promise<OperatorStatus> {
  const freshness = await checkPipelineFreshness(FRESHNESS_WINDOW_HOURS);

  // Get last attempt details
  let lastAttempt: { startedAt: string | null; status: string | null; triggeredBy: string | null } = {
    startedAt: null,
    status: null,
    triggeredBy: null,
  };
  try {
    const db = await getDb();
    if (db) {
      const [latest] = await db
        .select({
          startedAt: pipelineRuns.startedAt,
          status: pipelineRuns.status,
          triggeredBy: pipelineRuns.triggeredBy,
        })
        .from(pipelineRuns)
        .orderBy(desc(pipelineRuns.startedAt))
        .limit(1);
      if (latest) {
        lastAttempt = {
          startedAt: latest.startedAt ? new Date(latest.startedAt).toISOString() : null,
          status: latest.status,
          triggeredBy: latest.triggeredBy ?? null,
        };
      }
    }
  } catch {
    // Non-fatal
  }

  // Calculate next scheduled run
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setUTCHours(EXPECTED_RUN_HOUR_UTC, 0, 0, 0);
  if (nextRun <= now) {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  }
  const hoursUntil = Math.round((nextRun.getTime() - now.getTime()) / 3600000 * 10) / 10;

  // Determine if this is a missed run
  const isMissedRun = freshness.status === "stale" || freshness.status === "failed" || freshness.status === "never_run";

  return {
    pipelineStatus: freshness.status as OperatorStatus["pipelineStatus"],
    isFresh: freshness.status === "fresh",
    isRunning: freshness.status === "running",
    isMissedRun,
    lastSuccessfulRun: {
      completedAt: freshness.lastCompletedAt ? freshness.lastCompletedAt.toISOString() : null,
      ageHours: freshness.ageHours,
    },
    lastAttempt,
    nextScheduledRun: {
      expectedAt: nextRun.toISOString(),
      hoursUntil,
    },
    selfHealing: {
      active: selfHealingTimerActive,
      attemptCount: selfHealingAttemptCount,
      lastAttemptAt: lastSelfHealingAttemptAt?.toISOString() ?? null,
    },
    missedRunChecker: {
      active: missedRunCheckerActive,
      lastNotificationAt: _cachedLastNotificationAt?.toISOString() ?? null,
    },
    serverUptimeSeconds: Math.round(process.uptime()),
  };
}

// ── Initialization ─────────────────────────────────────────────────────────────

/**
 * Start all operations reliability systems.
 * Call this after the server starts listening.
 */
export function startOperationsReliability(): void {
  console.log(`${LOG_PREFIX} Initializing operations reliability systems...`);
  startSelfHealingTimer();
  startMissedRunChecker();
  console.log(`${LOG_PREFIX} ✓ Operations reliability initialized`);
}
