# BLOCKER B Analysis: Empty Status in userEmailSendLog

## Findings

The schema uses `digestType` (not `emailType`) as the column name. The column is correctly defined as:
```
digestType: mysqlEnum("digestType", ["monday", "thursday", "manager_rollup"]).notNull()
```

The actual bug is NOT about `emailType` being undefined — it's about **status being empty string** (`''`).

### Root Cause

The flow is:
1. `claimDigestSendSlot()` inserts a row with `status = 'pending'`
2. After the email is sent (or fails), `finaliseDigestSendSlot()` updates `status` to 'sent' or 'failed'

The rows with `status = ''` are from **before the claim/finalise pattern was introduced**. They were inserted by the old `logUserEmailSend()` function in `emailDigest.ts` (line 278) which doesn't set `weekKey` or `itemCount`.

Looking at the data:
- All `status = ''` rows are from 2026-04-30 and 2026-05-04 (W18)
- All `status = 'pending'` rows are from 2026-05-08 (W19) — these are the NEW pattern

### The 5 Pending Sends (2026-05-08)

These 5 reps claimed their slot but never got finalised:
- Daniel Zec (NSW) — failed because PA gate blocked all his projects (now fixed)
- Dan Day (SA/QLD) — likely failed due to territory threshold or pump scoring
- Egor Ivanov (NATIONAL) — likely failed due to territory threshold
- Kevin Arnandes (NATIONAL) — likely failed due to territory threshold
- Alexandre Leite (NATIONAL) — likely failed due to territory threshold

The issue: when the digest code hits a `continue` after the claim (e.g., territory threshold failure, manual preview gate), it logs via `logEmailSendExtended` with status='failed' — BUT only for the territory threshold and preview gate paths. If the code fails BEFORE those checks (e.g., during `getThisWeekForEmail` or project matching), the slot stays 'pending' forever.

### Fix Required

1. The old empty-status rows should be cleaned up (set to 'failed' since they're stale)
2. Add a catch-all finalise in the Monday/Thursday digest loops so that any unhandled exit path marks the slot as 'failed'
3. The 5 pending W19 rows need to be finalised (either mark as failed, or allow re-send on next cycle)
