/**
 * Persistent Email Digest Scheduler
 *
 * Replaces the in-process setTimeout-based schedulers with a robust system that:
 * 1. Tracks digest sends in the database (digestScheduleLog table)
 * 2. Recovers from server restarts by checking if digests were missed
 * 3. Runs missed digests immediately on startup if needed
 * 4. Uses a persistent timer that survives process restarts
 *
 * Sends Monday digest at 23:00 UTC and Thursday reminder at 23:00 UTC.
 */

import { getDb } from "./db";
import { sendWeeklyDigests, sendThursdayReminders } from "./emailDigest";
import { digestScheduleLog } from "../drizzle/schema";
import { eq, gte, and } from "drizzle-orm";

interface ScheduleLog {
  id?: number;
  digestType: "monday" | "thursday";
  scheduledFor: Date;
  sentAt?: Date | null;
  status: "pending" | "sent" | "failed";
  error?: string | null;
  createdAt?: Date;
}

/**
 * Check if a digest was already sent for a given day
 */
async function wasDigestSentToday(digestType: "monday" | "thursday"): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Check if there's a successful send for this digest type today
    const result = await db
      .select()
      .from(digestScheduleLog)
      .where(
        and(
          eq(digestScheduleLog.digestType, digestType),
          eq(digestScheduleLog.status, "sent"),
          gte(digestScheduleLog.sentAt, today)
        )
      )
      .limit(1);

    return result.length > 0;
  } catch (err) {
    console.error("[PersistentScheduler] Error checking digest status:", err);
    return false;
  }
}

/**
 * Log a digest send attempt
 */
async function logDigestAttempt(
  digestType: "monday" | "thursday",
  status: "pending" | "sent" | "failed",
  error?: string
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    await db.insert(digestScheduleLog).values({
      digestType,
      scheduledFor: new Date(),
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
  try {
    console.log("[PersistentScheduler] 📧 Sending Thursday reminder...");
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
 * Check if today is Monday (1) or Thursday (4) in UTC
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
 * Calculate milliseconds until next target time (23:00 UTC)
 */
function getDelayUntilNextRun(targetHour: number = 23): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(targetHour, 0, 0, 0);

  if (next <= now) {
    // Already past target time today, schedule for tomorrow
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

/**
 * Main scheduler that runs on startup and periodically checks for missed digests
 */
export async function startPersistentScheduler(): Promise<void> {
  console.log("[PersistentScheduler] Starting persistent email digest scheduler...");

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
    } else {
      console.log("[PersistentScheduler] ✓ Thursday reminder already sent today");
    }
  }

  // ── Recurring: Schedule next Monday digest ──
  function scheduleNextMonday(): void {
    const delay = getDelayUntilNextRun(23);
    const hoursUntil = Math.round((delay / 3600000) * 10) / 10;
    console.log(`[PersistentScheduler] Next Monday digest scheduled in ${hoursUntil}h`);

    setTimeout(async () => {
      const nextDay = getTodayDayOfWeek();
      if (nextDay === 1) {
        // Only send if we're actually on Monday
        await sendMondayDigestSafe();
      }
      scheduleNextMonday();
    }, delay);
  }

  // ── Recurring: Schedule next Thursday reminder ──
  function scheduleNextThursday(): void {
    const delay = getDelayUntilNextRun(23);
    const hoursUntil = Math.round((delay / 3600000) * 10) / 10;
    console.log(`[PersistentScheduler] Next Thursday reminder scheduled in ${hoursUntil}h`);

    setTimeout(async () => {
      const nextDay = getTodayDayOfWeek();
      if (nextDay === 4) {
        // Only send if we're actually on Thursday
        await sendThursdayReminderSafe();
      }
      scheduleNextThursday();
    }, delay);
  }

  // Start both recurring schedules
  scheduleNextMonday();
  scheduleNextThursday();

  console.log("[PersistentScheduler] ✓ Persistent scheduler initialized");
}
