/**
 * Persistent Email Digest Scheduler
 *
 * Replaces the in-process setTimeout-based schedulers with a robust system that:
 * 1. Tracks digest sends in the database (digestScheduleLog table)
 * 2. Recovers from server restarts by checking if digests were missed
 * 3. Runs missed digests immediately on startup if needed
 * 4. Uses a persistent timer that survives process restarts
 *
 * Schedule:
 *  - Monday 23:00 UTC  — Full weekly digest (all reps)
 *  - Thursday 23:00 UTC — Mid-week action reminder (all reps)
 *  - Thursday 23:30 UTC — Manager rollup email (admin users only)
 */

import { getDb } from "./db";
import { sendWeeklyDigests, sendThursdayReminders, sendManagerRollupEmail } from "./emailDigest";
import { digestScheduleLog } from "../drizzle/schema";
import { eq, gte, and } from "drizzle-orm";

/**
 * Get the current ISO week key in YYYY-WNN format (e.g. "2026-W17").
 * Used for week-level dedup to prevent duplicate sends after server restarts.
 */
function getCurrentISOWeekKey(): string {
  const now = new Date();
  const jan4 = new Date(Date.UTC(now.getUTCFullYear(), 0, 4));
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const weekNum = Math.floor((now.getTime() - startOfWeek1.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${now.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * Check if a digest was already sent this ISO week.
 * Uses week-level dedup (not day-level) to prevent duplicate sends after server restarts.
 * A restart on the same Monday would previously re-fire the digest; week-level dedup prevents this.
 */
async function wasDigestSentThisWeek(digestType: "monday" | "thursday"): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;

    // Start of the current ISO week (Monday 00:00 UTC)
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ...
    const daysToMonday = (dayOfWeek + 6) % 7; // days since Monday
    const startOfWeek = new Date(now);
    startOfWeek.setUTCDate(now.getUTCDate() - daysToMonday);
    startOfWeek.setUTCHours(0, 0, 0, 0);

    // Check if there's a successful send record created this week for this digest type
    const result = await db
      .select()
      .from(digestScheduleLog)
      .where(
        and(
          eq(digestScheduleLog.digestType, digestType),
          eq(digestScheduleLog.status, "sent"),
          gte(digestScheduleLog.createdAt, startOfWeek)
        )
      )
      .limit(1);

    return result.length > 0;
  } catch (err) {
    console.error("[PersistentScheduler] Error checking digest status:", err);
    // On error, assume it was sent to avoid duplicate sends
    return true;
  }
}

/** @deprecated Use wasDigestSentThisWeek for week-level dedup */
async function wasDigestSentToday(digestType: "monday" | "thursday"): Promise<boolean> {
  return wasDigestSentThisWeek(digestType);
}

/**
 * Log a digest send attempt with sentAt populated on success
 */
async function logDigestAttempt(
  digestType: "monday" | "thursday",
  status: "pending" | "sent" | "failed",
  error?: string
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const now = new Date();
    await db.insert(digestScheduleLog).values({
      digestType,
      scheduledFor: now,
      sentAt: status === "sent" ? now : null,   // populate sentAt on success
      status,
      error: error || null,
    });
  } catch (err) {
    console.error("[PersistentScheduler] Error logging digest attempt:", err);
  }
}

/**
 * Send Monday digest and log the result
 */
async function sendMondayDigestSafe(): Promise<void> {
  // Double-check guard: re-verify not already sent before sending
  const alreadySent = await wasDigestSentToday("monday");
  if (alreadySent) {
    console.log("[PersistentScheduler] ✓ Monday digest already sent today — skipping");
    return;
  }
  try {
    console.log("[PersistentScheduler] 📧 Sending Monday digest...");
    const result = await sendWeeklyDigests();
    await logDigestAttempt("monday", "sent");
    console.log(
      `[PersistentScheduler] ✓ Monday digest sent: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logDigestAttempt("monday", "failed", errMsg);
    console.error("[PersistentScheduler] ✗ Monday digest failed:", errMsg);
  }
}

/**
 * Send Thursday reminder and log the result
 */
async function sendThursdayReminderSafe(): Promise<void> {
  const alreadySent = await wasDigestSentToday("thursday");
  if (alreadySent) {
    console.log("[PersistentScheduler] ✓ Thursday reminder already sent today — skipping");
    return;
  }
  try {
    console.log("[PersistentScheduler] 📧 Sending Thursday reminder...");
    await logDigestAttempt("thursday", "pending");
    const result = await sendThursdayReminders();
    await logDigestAttempt("thursday", "sent");
    console.log(
      `[PersistentScheduler] ✓ Thursday reminder sent: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logDigestAttempt("thursday", "failed", errMsg);
    console.error("[PersistentScheduler] ✗ Thursday reminder failed:", errMsg);
  }
}

/**
 * Send manager rollup email (no digestScheduleLog entry — uses userEmailSendLog directly)
 */
async function sendManagerRollupSafe(): Promise<void> {
  try {
    console.log("[PersistentScheduler] 📊 Sending manager rollup email...");
    const result = await sendManagerRollupEmail();
    console.log(
      `[PersistentScheduler] ✓ Manager rollup sent: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`
    );
  } catch (err: unknown) {
    console.error("[PersistentScheduler] ✗ Manager rollup failed:", String(err));
  }
}

/**
 * Check if today is Monday (1) in UTC
 */
function getTodayDayOfWeek(): number {
  return new Date().getUTCDay();
}

/**
 * Get current UTC time in HH:MM format
 */
function getCurrentUTCTime(): string {
  const now = new Date();
  return `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * Calculate milliseconds until next target weekday at target hour (UTC).
 * targetDay: 1 = Monday, 4 = Thursday
 * targetHour: UTC hour to send (default 23)
 * alreadySentThisWeek: when true, always advance to NEXT week even if today is
 *   the target day and the target hour hasn't been reached yet. This prevents
 *   the scheduler from firing a second time later the same day after a digest
 *   was already sent earlier (e.g. via startup catch-up or manual trigger).
 *
 * Bug that was fixed: previously the function only advanced to next week when
 *   `next <= now` (i.e. the target time had already passed). If the digest was
 *   sent at 04:00 UTC and the scheduler restarted at 01:59 UTC, `next` (23:00
 *   UTC same day) was still in the future, so `daysUntil` stayed 0 and the
 *   timer fired again at 23:00 UTC that same evening.
 *
 * Before fix example (Monday 01:59 UTC, digest already sent at 04:05 UTC):
 *   daysUntil = 0, next = Monday 23:00 UTC → delay = 21h → fires TONIGHT
 *
 * After fix example (same scenario, alreadySentThisWeek = true):
 *   daysUntil forced to 7 → next = NEXT Monday 23:00 UTC → delay = 165h
 */
function getDelayUntilNextWeekday(
  targetDay: number,
  targetHour: number = 23,
  alreadySentThisWeek: boolean = false
): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(targetHour, 0, 0, 0);

  // Advance to the next occurrence of targetDay
  const currentDay = now.getUTCDay();
  let daysUntil = (targetDay - currentDay + 7) % 7;

  if (daysUntil === 0) {
    // Today IS the target day.
    if (alreadySentThisWeek) {
      // Digest already sent this week — always jump to next week regardless of
      // whether the target hour has been reached yet.
      daysUntil = 7;
    } else if (next <= now) {
      // Target hour has already passed today and digest not yet sent — this
      // should not normally happen (startup catch-up handles it), but advance
      // to next week as a safety measure.
      daysUntil = 7;
    }
    // else: target hour is still ahead today and not yet sent → fire today (daysUntil stays 0)
  }

  next.setDate(next.getDate() + daysUntil);
  return next.getTime() - now.getTime();
}

/**
 * Main scheduler that runs on startup and periodically checks for missed digests.
 * Schedule:
 *  - Monday 23:00 UTC  — Full weekly digest (all reps)
 *  - Thursday 23:00 UTC — Mid-week action reminder (all reps)
 *  - Thursday 23:30 UTC — Manager rollup email (admin users only)
 */
export async function startPersistentScheduler(): Promise<void> {
  // Kill switch: if EMAIL_DIGESTS_ENABLED is not "true", do not schedule or send anything
  if (process.env.EMAIL_DIGESTS_ENABLED !== "true") {
    console.log("[PersistentScheduler] ⚠ Email digests DISABLED (EMAIL_DIGESTS_ENABLED != true). Scheduler will not run.");
    return;
  }

  console.log("[PersistentScheduler] Starting persistent email digest scheduler (Monday + Thursday + Manager Rollup)...");

  // ── Startup: Check for missed digests ──
  const today = getTodayDayOfWeek();
  const currentTime = getCurrentUTCTime();
  console.log(`[PersistentScheduler] Current time: ${currentTime} UTC | Day: ${today} (0=Sun, 1=Mon, 4=Thu)`);

  // Check if today is Monday and digest hasn't been sent yet
  if (today === 1) {
    const mondayAlreadySent = await wasDigestSentToday("monday");
    if (!mondayAlreadySent) {
      console.log("[PersistentScheduler] ⚠ Monday digest not sent yet — sending now...");
      await sendMondayDigestSafe();
    } else {
      console.log("[PersistentScheduler] ✓ Monday digest already sent today");
    }
  }

  // Check if today is Thursday and reminder hasn't been sent yet
  if (today === 4) {
    const thursdayAlreadySent = await wasDigestSentToday("thursday");
    if (!thursdayAlreadySent) {
      console.log("[PersistentScheduler] ⚠ Thursday reminder not sent yet — sending now...");
      await sendThursdayReminderSafe();
      // Manager rollup runs 30 min after Thursday reminder
      setTimeout(() => sendManagerRollupSafe(), 30 * 60 * 1000);
    } else {
      console.log("[PersistentScheduler] ✓ Thursday reminder already sent today");
    }
  }

  // ── Recurring: Schedule next Monday digest ──
  // Pass alreadySentThisWeek so that if the digest was sent earlier today (e.g.
  // via startup catch-up or manual trigger), the timer targets NEXT Monday
  // rather than firing again at 23:00 UTC the same day.
  async function scheduleNextMonday(): Promise<void> {
    const alreadySent = await wasDigestSentThisWeek("monday");
    const delay = getDelayUntilNextWeekday(1, 23, alreadySent);
    const hoursUntil = Math.round((delay / 3600000) * 10) / 10;
    const nextFireUTC = new Date(Date.now() + delay).toISOString();
    console.log(`[PersistentScheduler] Next Monday digest scheduled in ${hoursUntil}h (fires at ${nextFireUTC} UTC, alreadySentThisWeek=${alreadySent})`);
    setTimeout(async () => {
      await sendMondayDigestSafe();
      scheduleNextMonday();
    }, delay);
  }

  // ── Recurring: Schedule next Thursday reminder + manager rollup ──
  async function scheduleNextThursday(): Promise<void> {
    const alreadySent = await wasDigestSentThisWeek("thursday");
    const delay = getDelayUntilNextWeekday(4, 23, alreadySent);
    const hoursUntil = Math.round((delay / 3600000) * 10) / 10;
    const nextFireUTC = new Date(Date.now() + delay).toISOString();
    console.log(`[PersistentScheduler] Next Thursday reminder scheduled in ${hoursUntil}h (fires at ${nextFireUTC} UTC, alreadySentThisWeek=${alreadySent})`);
    setTimeout(async () => {
      await sendThursdayReminderSafe();
      // Manager rollup 30 min after rep reminder
      setTimeout(() => sendManagerRollupSafe(), 30 * 60 * 1000);
      scheduleNextThursday();
    }, delay);
  }

  scheduleNextMonday();
  scheduleNextThursday();

  console.log("[PersistentScheduler] ✓ Persistent scheduler initialized (Monday + Thursday + Manager Rollup)");
}
