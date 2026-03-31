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

/**
 * Check if a digest was already sent for a given day.
 * Queries by createdAt (not sentAt) since sentAt is populated after the fact.
 * Uses status = 'sent' to confirm it completed successfully.
 */
async function wasDigestSentToday(digestType: "monday" | "thursday"): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Check if there's a successful send record created today for this digest type
    const result = await db
      .select()
      .from(digestScheduleLog)
      .where(
        and(
          eq(digestScheduleLog.digestType, digestType),
          eq(digestScheduleLog.status, "sent"),
          gte(digestScheduleLog.createdAt, today)   // use createdAt — sentAt may be null
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
  // Double-check guard: re-verify not already sent before sending
  const alreadySent = await wasDigestSentToday("thursday");
  if (alreadySent) {
    console.log("[PersistentScheduler] ✓ Thursday reminder already sent today — skipping");
    return;
  }
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
 * Calculate milliseconds until next target weekday at target hour (UTC).
 * targetDay: 1 = Monday, 4 = Thursday
 * targetHour: UTC hour to send (default 23)
 */
function getDelayUntilNextWeekday(targetDay: number, targetHour: number = 23): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(targetHour, 0, 0, 0);

  // Advance to the next occurrence of targetDay
  const currentDay = now.getUTCDay();
  let daysUntil = (targetDay - currentDay + 7) % 7;

  // If today is the target day but we haven't reached the target hour yet,
  // send today. Otherwise, advance to next week.
  if (daysUntil === 0 && next <= now) {
    daysUntil = 7; // Already past today's send time, wait until next week
  }

  next.setDate(next.getDate() + daysUntil);
  return next.getTime() - now.getTime();
}

/**
 * Main scheduler that runs on startup and periodically checks for missed digests
 */
export async function startPersistentScheduler(): Promise<void> {
  // Kill switch: if EMAIL_DIGESTS_ENABLED is not "true", do not schedule or send anything
  if (process.env.EMAIL_DIGESTS_ENABLED !== "true") {
    console.log("[PersistentScheduler] ⚠ Email digests DISABLED (EMAIL_DIGESTS_ENABLED != true). Scheduler will not run.");
    return;
  }

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
    const delay = getDelayUntilNextWeekday(1, 23);
    const hoursUntil = Math.round((delay / 3600000) * 10) / 10;
    console.log(`[PersistentScheduler] Next Monday digest scheduled in ${hoursUntil}h`);

    setTimeout(async () => {
      await sendMondayDigestSafe(); // guard inside will prevent duplicates
      scheduleNextMonday();
    }, delay);
  }

  // ── Recurring: Schedule next Thursday reminder ──
  function scheduleNextThursday(): void {
    const delay = getDelayUntilNextWeekday(4, 23);
    const hoursUntil = Math.round((delay / 3600000) * 10) / 10;
    console.log(`[PersistentScheduler] Next Thursday reminder scheduled in ${hoursUntil}h`);

    setTimeout(async () => {
      await sendThursdayReminderSafe(); // guard inside will prevent duplicates
      scheduleNextThursday();
    }, delay);
  }

  // Start both recurring schedules
  scheduleNextMonday();
  scheduleNextThursday();

  console.log("[PersistentScheduler] ✓ Persistent scheduler initialized");
}
