/**
 * Persistent Email Digest Scheduler
 *
 * Replaces the in-process setTimeout-based schedulers with a robust system that:
 * 1. Tracks digest sends in the database (digestScheduleLog table)
 * 2. Recovers from server restarts by checking if digests were missed
 * 3. Runs missed digests immediately on startup if needed
 * 4. Uses a persistent timer that survives process restarts
 *
 * Schedule (all times UTC):
 *  - Sunday  22:00 UTC  → Monday  06:00 AWST / 08:00 AEST — Full weekly digest (all reps)
 *  - Thursday 23:00 UTC → Friday  07:00 AWST / 09:00 AEST — Mid-week action reminder (all reps)
 *  - Thursday 23:30 UTC → Friday  07:30 AWST / 09:30 AEST — Manager rollup email (admin users only)
 *
 * Note on Thursday timing: Thursday 23:00 UTC resolves to Friday morning in Australia.
 * This is intentional — the "Thursday reminder" is a mid-week email that lands Friday
 * morning, giving reps the weekend to prepare. If a true Thursday morning AU send is
 * needed, change targetDay=3 (Wed) at 22:00 UTC → Thursday 06:00 AWST / 08:00 AEST.
 */

import { getDb } from "./db";
import { sendWeeklyDigests, sendThursdayReminders, sendManagerRollupEmail } from "./emailDigest";
import { runDigestSafePromotionSafe } from "./digestSafePromotion";
import { digestScheduleLog, userEmailSendLog } from "../drizzle/schema";
import { eq, gte, and, lt } from "drizzle-orm";

// ── Schedule constants ──────────────────────────────────────────────────────
/**
 * MONDAY_DIGEST_DAY / MONDAY_DIGEST_HOUR
 * The Monday weekly digest fires on Sunday at 22:00 UTC so it lands in
 * Australian inboxes at the start of the working week:
 *   22:00 UTC Sunday = 06:00 AWST Monday = 08:00 AEST Monday
 */
const MONDAY_DIGEST_DAY = 0;   // 0 = Sunday UTC (lands Monday morning AU)
const MONDAY_DIGEST_HOUR = 22; // 22:00 UTC = 06:00 AWST / 08:00 AEST

/**
 * THURSDAY_REMINDER_DAY / THURSDAY_REMINDER_HOUR
 * The Thursday reminder fires Thursday at 23:00 UTC, landing Friday morning AU:
 *   23:00 UTC Thursday = 07:00 AWST Friday = 09:00 AEST Friday
 * This is the current schedule. To move to true Thursday morning AU, change to
 * Wednesday 22:00 UTC (= Thursday 06:00 AWST / 08:00 AEST).
 */
const THURSDAY_REMINDER_DAY = 4;   // 4 = Thursday UTC
const THURSDAY_REMINDER_HOUR = 23; // 23:00 UTC = 07:00 AWST Fri / 09:00 AEST Fri

// ────────────────────────────────────────────────────────────────────────────

/**
 * Get the current ISO week key in YYYY-WNN format (e.g. "2026-W17").
 * Used for week-level dedup to prevent duplicate sends after server restarts.
 *
 * IMPORTANT: For the Monday digest, "this week" is defined as the ISO week that
 * the digest belongs to — i.e. the Monday that follows the Sunday fire time.
 * We use the ISO week of (now + 1 day) when checking from Sunday so that a
 * Sunday 22:00 UTC send is correctly associated with the coming Monday's week.
 */
function getCurrentISOWeekKey(forMondayDigest: boolean = false): string {
  // For Monday digest sent on Sunday, advance by 1 day so the week key
  // reflects the Monday the digest is for, not the Sunday it fires on.
  const ref = new Date();
  if (forMondayDigest && ref.getUTCDay() === 0) {
    ref.setUTCDate(ref.getUTCDate() + 1);
  }
  const jan4 = new Date(Date.UTC(ref.getUTCFullYear(), 0, 4));
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const weekNum = Math.floor((ref.getTime() - startOfWeek1.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${ref.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * Check if a digest was already sent this ISO week.
 * Uses week-level dedup (not day-level) to prevent duplicate sends after server restarts.
 *
 * For the Monday digest (which fires on Sunday UTC), "this week" is the ISO week
 * of the coming Monday, so we look back from Monday 00:00 UTC of that week.
 */
async function wasDigestSentThisWeek(digestType: "monday" | "thursday"): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;

    const now = new Date();

    let startOfWeek: Date;
    if (digestType === "monday") {
      // For Monday digest: "this week" starts on the Monday that this digest is for.
      // If today is Sunday (0), the relevant Monday is tomorrow.
      // If today is Mon–Sat, the relevant Monday is the most recent Monday.
      const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ...
      if (dayOfWeek === 0) {
        // Sunday — the digest is for NEXT Monday
        startOfWeek = new Date(now);
        startOfWeek.setUTCDate(now.getUTCDate() + 1); // tomorrow = Monday
        startOfWeek.setUTCHours(0, 0, 0, 0);
      } else {
        // Mon–Sat — use this week's Monday
        const daysToMonday = (dayOfWeek + 6) % 7;
        startOfWeek = new Date(now);
        startOfWeek.setUTCDate(now.getUTCDate() - daysToMonday);
        startOfWeek.setUTCHours(0, 0, 0, 0);
      }
    } else {
      // Thursday reminder: standard ISO week (Mon–Sun)
      const dayOfWeek = now.getUTCDay();
      const daysToMonday = (dayOfWeek + 6) % 7;
      startOfWeek = new Date(now);
      startOfWeek.setUTCDate(now.getUTCDate() - daysToMonday);
      startOfWeek.setUTCHours(0, 0, 0, 0);
    }

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
      sentAt: status === "sent" ? now : null,
      status,
      error: error || null,
    });
  } catch (err) {
    console.error("[PersistentScheduler] Error logging digest attempt:", err);
  }
}

/**
 * Monday Digest — Auto-Send
 *
 * Automatically sends the Monday digest to all eligible reps every week.
 * No admin approval required. The freshness gate still applies
 * (requires a successful pipeline run within the last 26h).
 *
 * On success: logs the send and notifies admin with a summary.
 * On failure: notifies admin so they can retry via the Admin panel.
 */
async function sendMondayDigestSafe(): Promise<void> {
  const alreadySent = await wasDigestSentThisWeek("monday");
  if (alreadySent) {
    console.log("[PersistentScheduler] ✓ Monday digest already sent this week — skipping");
    return;
  }
  try {
    console.log("[PersistentScheduler] 📧 Sending Monday digest...");
    await logDigestAttempt("monday", "pending");
    const result = await sendWeeklyDigests(false, false); // live send
    const sentCount = result.sent ?? 0;
    const skippedCount = result.skipped ?? 0;
    const failedCount = result.failed ?? 0;

    if ((result as any).skipped === -1) {
      // Freshness gate blocked the send — do NOT mark as sent
      console.warn("[PersistentScheduler] ✗ Monday digest blocked by freshness gate");
      await logDigestAttempt("monday", "failed", "FRESHNESS_GATE_HELD");
      try {
        const { notifyOwner } = await import("./_core/notification");
        await notifyOwner({
          title: "⚠️ Monday Digest Blocked — Freshness Gate",
          content: `The Monday digest was blocked because the pipeline hasn't run recently enough.\n\nPlease check the cloud computer pipeline and retry via Admin → Digest Control Panel.`,
        });
      } catch (_) { /* ignore */ }
      return;
    }

    await logDigestAttempt("monday", "sent");
    console.log(`[PersistentScheduler] ✓ Monday digest sent: ${sentCount} sent, ${skippedCount} skipped, ${failedCount} failed`);
    // Notify admin with send summary
    try {
      const { notifyOwner } = await import("./_core/notification");
      await notifyOwner({
        title: "✅ Monday Digest Sent",
        content: [
          `The Monday digest was sent automatically.`,
          ``,
          `**Sent:** ${sentCount} reps`,
          `**Skipped (gate/no projects):** ${skippedCount}`,
          `**Failed:** ${failedCount}`,
          ``,
          `To review: Open Admin → Digest Control Panel.`,
        ].join("\n"),
      });
    } catch (_) { /* ignore notification failure */ }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[PersistentScheduler] ✗ Monday digest send failed:", errMsg);
    await logDigestAttempt("monday", "failed", errMsg);
    try {
      const { notifyOwner } = await import("./_core/notification");
      await notifyOwner({
        title: "⚠️ Monday Digest Failed",
        content: `The Monday digest failed to send: ${errMsg}\n\nPlease check the Admin panel and retry manually.`,
      });
    } catch (_) { /* ignore notification failure */ }
  }
}

/**
 * Send Thursday reminder and log the result.
 * Same freshness-gate-aware logic as sendMondayDigestSafe.
 */
async function sendThursdayReminderSafe(): Promise<void> {
  const alreadySent = await wasDigestSentThisWeek("thursday");
  if (alreadySent) {
    console.log("[PersistentScheduler] ✓ Thursday reminder already sent this week — skipping");
    return;
  }
  try {
    console.log("[PersistentScheduler] 📧 Sending Thursday reminder...");
    await logDigestAttempt("thursday", "pending");
    const result = await sendThursdayReminders();

    if (result.sent > 0) {
      await logDigestAttempt("thursday", "sent");
      console.log(
        `[PersistentScheduler] ✓ Thursday reminder sent: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`
      );
    } else {
      console.warn(
        `[PersistentScheduler] ⚠ Thursday reminder returned 0 sent (${result.failed} failed, ${result.skipped} skipped) — not logging as sent`
      );
    }
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
 * Get current UTC day of week (0=Sun, 1=Mon, ..., 6=Sat)
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
 *
 * targetDay: 0=Sun, 1=Mon, 4=Thu
 * targetHour: UTC hour to send
 * alreadySentThisWeek: when true, always advance to NEXT occurrence (7 days)
 *   even if today is the target day and the target hour hasn't been reached yet.
 *   This prevents the scheduler from firing again the same day after a digest
 *   was already sent earlier (e.g. via startup catch-up or manual trigger).
 */
function getDelayUntilNextWeekday(
  targetDay: number,
  targetHour: number,
  alreadySentThisWeek: boolean = false
): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(targetHour, 0, 0, 0);

  const currentDay = now.getUTCDay();
  let daysUntil = (targetDay - currentDay + 7) % 7;

  if (daysUntil === 0) {
    // Today IS the target day.
    if (alreadySentThisWeek) {
      // Digest already sent this week — always jump to next occurrence.
      daysUntil = 7;
    } else if (next <= now) {
      // Target hour has already passed today and digest not yet sent —
      // advance to next week as a safety measure.
      daysUntil = 7;
    }
    // else: target hour is still ahead today and not yet sent → fire today
  }

  next.setUTCDate(next.getUTCDate() + daysUntil);
  return next.getTime() - now.getTime();
}

/**
 * Format a UTC timestamp as AU timezone strings for logging
 */
function formatAUTimes(utcDate: Date): string {
  const awst = new Date(utcDate.getTime() + 8 * 3600000);
  const aest = new Date(utcDate.getTime() + 10 * 3600000);
  const fmt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16);
  return `${fmt(awst)} AWST / ${fmt(aest)} AEST`;
}

/**
 * DigestSafe auto-promotion nightly job.
 * Runs at 02:00 UTC every night (after Sunday preview, before Monday send).
 * Also runs once on startup as a catch-up pass.
 */
async function scheduleNightlyDigestSafePromotion(): Promise<void> {
  // Run once immediately on startup as a catch-up pass
  console.log("[PersistentScheduler] Running startup digestSafe promotion catch-up pass...");
  await runDigestSafePromotionSafe();

  // Schedule recurring nightly at 02:00 UTC
  const NIGHTLY_HOUR = 2; // 02:00 UTC = 10:00 AWST / 12:00 AEST
  function scheduleNext(): void {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(NIGHTLY_HOUR, 0, 0, 0);
    if (next <= now) {
      // Already past 02:00 UTC today — schedule for tomorrow
      next.setUTCDate(next.getUTCDate() + 1);
    }
    const delay = next.getTime() - now.getTime();
    const hoursUntil = Math.round((delay / 3600000) * 10) / 10;
    console.log(`[PersistentScheduler] Next digestSafe promotion scheduled in ${hoursUntil}h (02:00 UTC)`);
    setTimeout(async () => {
      await runDigestSafePromotionSafe();
      scheduleNext();
    }, delay);
  }
  scheduleNext();
}

/**
 * Main scheduler that runs on startup and periodically checks for missed digests.
 *
 * Monday digest:   Sunday 22:00 UTC = Monday 06:00 AWST / 08:00 AEST
 * Thursday digest: Thursday 23:00 UTC = Friday 07:00 AWST / 09:00 AEST
 * DigestSafe promotion: nightly 02:00 UTC
 */
export async function startPersistentScheduler(): Promise<void> {
  if (process.env.EMAIL_DIGESTS_ENABLED !== "true") {
    console.log("[PersistentScheduler] ⚠ Email digests DISABLED (EMAIL_DIGESTS_ENABLED != true). Scheduler will not run.");
    return;
  }

  // ── Startup: clear stale pending slots (older than 10 min) ──
  // If the server was killed mid-send, pending rows are left behind.
  // These block the dedup guard (claimDigestSendSlot returns false) and
  // prevent the affected user from ever receiving a re-send.
  // We mark them as failed so the next send attempt can claim a fresh slot.
  try {
    const db = await getDb();
    if (db) {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const result = await db
        .update(userEmailSendLog)
        .set({ status: "failed", error: "STALE: pending slot never finalised (server restart cleanup)" })
        .where(
          and(
            eq(userEmailSendLog.status, "pending"),
            lt(userEmailSendLog.sentAt, tenMinutesAgo)
          )
        );
      const cleaned = (result[0] as any).affectedRows ?? 0;
      if (cleaned > 0) {
        console.log(`[PersistentScheduler] ⚠ Cleared ${cleaned} stale pending send slot(s) — these users will be retried on next scheduled send`);
      }
    }
  } catch (cleanupErr) {
    console.error("[PersistentScheduler] Failed to clean stale pending slots:", cleanupErr);
  }

  console.log("[PersistentScheduler] Starting persistent email digest scheduler...");
  console.log("[PersistentScheduler] Schedule: Monday digest = Sun 22:00 UTC (Mon 06:00 AWST / 08:00 AEST)");
  console.log("[PersistentScheduler] Schedule: Thursday reminder = Thu 23:00 UTC (Fri 07:00 AWST / 09:00 AEST)");

  const today = getTodayDayOfWeek();
  const currentTime = getCurrentUTCTime();
  console.log(`[PersistentScheduler] Current time: ${currentTime} UTC | Day: ${today} (0=Sun, 1=Mon, 4=Thu)`);

  // ── Startup catch-up: Monday digest ──
  // Fires on Sunday (0) at 22:00 UTC. Also catch up if server restarted on Monday
  // before the digest was sent (e.g. server was down Sunday night).
  if (today === MONDAY_DIGEST_DAY) {
    // It's Sunday — check if we're past 22:00 UTC and digest not yet sent
    const now = new Date();
    if (now.getUTCHours() >= MONDAY_DIGEST_HOUR) {
      const mondayAlreadySent = await wasDigestSentThisWeek("monday");
      if (!mondayAlreadySent) {
        console.log("[PersistentScheduler] ⚠ Sunday 22:00 UTC passed — sending Monday digest now...");
        await sendMondayDigestSafe();
      } else {
        console.log("[PersistentScheduler] ✓ Monday digest already sent this week");
      }
    }
  } else if (today === 1) {
    // It's Monday — catch up if digest was missed (server was down Sunday night)
    const mondayAlreadySent = await wasDigestSentThisWeek("monday");
    if (!mondayAlreadySent) {
      console.log("[PersistentScheduler] ⚠ Monday catch-up: digest not sent — sending now...");
      await sendMondayDigestSafe();
    } else {
      console.log("[PersistentScheduler] ✓ Monday digest already sent this week");
    }
  }

  // ── Startup catch-up: Thursday reminder ──
  if (today === THURSDAY_REMINDER_DAY) {
    const thursdayAlreadySent = await wasDigestSentThisWeek("thursday");
    if (!thursdayAlreadySent) {
      console.log("[PersistentScheduler] ⚠ Thursday reminder not sent yet — sending now...");
      await sendThursdayReminderSafe();
      setTimeout(() => sendManagerRollupSafe(), 30 * 60 * 1000);
    } else {
      console.log("[PersistentScheduler] ✓ Thursday reminder already sent this week");
    }
  }

  // ── Recurring: Schedule next Monday digest ──
  async function scheduleNextMonday(): Promise<void> {
    const alreadySent = await wasDigestSentThisWeek("monday");
    const delay = getDelayUntilNextWeekday(MONDAY_DIGEST_DAY, MONDAY_DIGEST_HOUR, alreadySent);
    const hoursUntil = Math.round((delay / 3600000) * 10) / 10;
    const nextFireUTC = new Date(Date.now() + delay);
    const auTimes = formatAUTimes(nextFireUTC);
    console.log(
      `[PersistentScheduler] Next Monday digest scheduled in ${hoursUntil}h` +
      ` | UTC: ${nextFireUTC.toISOString()} | AU: ${auTimes}` +
      ` | alreadySentThisWeek=${alreadySent}`
    );
    setTimeout(async () => {
      await sendMondayDigestSafe();
      scheduleNextMonday();
    }, delay);
  }

  // ── Recurring: Schedule next Thursday reminder + manager rollup ──
  async function scheduleNextThursday(): Promise<void> {
    const alreadySent = await wasDigestSentThisWeek("thursday");
    const delay = getDelayUntilNextWeekday(THURSDAY_REMINDER_DAY, THURSDAY_REMINDER_HOUR, alreadySent);
    const hoursUntil = Math.round((delay / 3600000) * 10) / 10;
    const nextFireUTC = new Date(Date.now() + delay);
    const auTimes = formatAUTimes(nextFireUTC);
    console.log(
      `[PersistentScheduler] Next Thursday reminder scheduled in ${hoursUntil}h` +
      ` | UTC: ${nextFireUTC.toISOString()} | AU: ${auTimes}` +
      ` | alreadySentThisWeek=${alreadySent}`
    );
    setTimeout(async () => {
      await sendThursdayReminderSafe();
      setTimeout(() => sendManagerRollupSafe(), 30 * 60 * 1000);
      scheduleNextThursday();
    }, delay);
  }

  scheduleNextMonday();
  scheduleNextThursday();
  scheduleNightlyDigestSafePromotion();

  console.log("[PersistentScheduler] ✓ Persistent scheduler initialized");
}
