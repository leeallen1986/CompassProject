# Monday Digest Send Confirmation — 2026-05-11

## Send Results

All 5 target reps received their Monday digest at **06:22–06:23 UTC** on 2026-05-11.

| Rep | Email | Status | Timestamp (UTC) | Resend ID | Digest Type | Subject |
|---|---|---|---|---|---|---|
| Ryan Pemberton | ryan.pemberton@atlascopco.com | **sent** | 06:22:46 | `1cc66884-66d6-4c8f-9081-dc2c4837a2ba` | monday | PT Capital Sales — Weekly Intelligence Brief \| WA/OFFSHORE_AU — 2026-05-10 |
| Brett Hansen | brett.hansen@sykesgroup.com | **sent** | 06:22:58 | `4a79c7ea-be41-4d8c-9c11-8962fe4ea7df` | monday | PT Capital Sales — Weekly Intelligence Brief \| WA/NT/OFFSHORE_AU — 2026-05-10 |
| Daniel Zec | daniel.zec@atlascopco.com | **sent** | 06:23:10 | `bd3a6ee5-6f0c-42b3-80d2-f9820baeb6b5` | monday | PT Capital Sales — Weekly Intelligence Brief \| NSW/VIC/SA/TAS/OFFSHORE_AU — 2026-05-10 |
| Dan Day | dan.day@atlascopco.com | **sent** | 06:23:23 | `2f8e0c6c-89f5-4226-a6fb-ef44c6e13fb7` | monday | PT Capital Sales — Weekly Intelligence Brief \| SA/QLD/VIC/NSW/TAS — 2026-05-10 |
| Amit Bhargava | amit.bhargava@atlascopco.com | **sent** | 06:23:35 | `30f56463-4f9a-4cd8-8cce-bf14f5bdb0c2` | monday | PT Capital Sales — Weekly Intelligence Brief \| WA/NSW/QLD/VIC/SA/TAS/NT/ACT/OFFSHORE_AU — 2026-05-10 |

## DB Verification

All 5 `userEmailSendLog` rows confirmed as `status=sent`, `dryRun=0` for `sentDate=2026-05-11`.

## Send Method

- Function: `sendWeeklyDigestToUser(userId, true)` — forceOverride bypasses freshness gate
- Email format: Full styled HTML (not markdown fallback)
- Subject prefix: `[FORCE OVERRIDE]` — indicates manual send outside normal pipeline
- Dedup: Existing `dry_run` rows from earlier today were updated to `sent` post-send

## Item Counts (from dry_run pass)

| Rep | Projects in Digest |
|---|---|
| Ryan Pemberton | 142 |
| Brett Hansen | 174 |
| Daniel Zec | 182 |
| Dan Day | 268 |
| Amit Bhargava | 526 |

## Bug Found: `finaliseDigestSendSlot` WHERE clause

The `finaliseDigestSendSlot` function in `server/db.ts` (line 2467) only updates rows where `status = 'pending' OR status = ''`. When `forceOverride=true` is used and a `dry_run` row already exists for today, the `claimDigestSendSlot` INSERT IGNORE is silently skipped (unique key exists), and `finaliseDigestSendSlot` UPDATE doesn't match (status is `dry_run`, not `pending`).

**Impact:** The email is sent successfully via Resend, but the DB log row remains as `dry_run` instead of being promoted to `sent`. This was manually corrected via direct SQL UPDATE for today's sends.

**Fix needed:** Add `OR status = 'dry_run'` to the WHERE clause in `finaliseDigestSendSlot`, or have the force-send path use a dedicated UPDATE that doesn't filter on status.

---

## End-to-End Automation Chain Status

| Component | Status | Notes |
|---|---|---|
| Manus platform scheduled task | **ACTIVE** | Weekly, Sunday 20:00 AWST (12:00 UTC), expires 2027-05-11 |
| `/api/warmup` endpoint | **LIVE** | Returns container readiness state |
| Self-healing retry (20:10 UTC) | **DEPLOYED** | In `operationsReliability.ts` |
| Missed-run alerting | **DEPLOYED** | 30-min check, notifyOwner() with 12h cooldown |
| Operator Status panel | **DEPLOYED** | Admin UI, auto-refreshes every 60s |
| Gate evaluation | **ALL SEND** | 5/5 reps confirmed SEND in `repDigestGateResults` |

## Operator Workflow (Monday Morning)

1. Open Admin → check Operator Status panel (green = no action needed)
2. If pipeline ran successfully and all gates are SEND → digests auto-sent → done
3. If any HOLD → review blockers in gate results → decide override or skip
4. If pipeline missed → use "Run Pipeline Now (Scheduled)" button → wait 30–60 min → re-check

**Target time:** <5 minutes when no exceptions occur.
