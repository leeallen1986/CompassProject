# Weekly Operating Model — Atlas Copco Market Intelligence

**Version:** 1.0  
**Last Updated:** 2026-05-11  
**Status:** Active — Exception-Review-Only Mode

---

## Design Philosophy

The system is designed to run **autonomously every week** with operator intervention required only for **exceptions**. The operator's Monday morning workflow should take less than 5 minutes if no exceptions are flagged.

---

## Weekly Timeline (All times AEST / UTC+10)

| Day | Time (AEST) | Time (UTC) | Event | Automated? |
|-----|-------------|------------|-------|------------|
| **Sunday** | 06:00 | 20:00 (Sat) | Pipeline trigger fires | ✅ External scheduled task |
| Sunday | 06:02 | 20:02 | Warm-up endpoint hit → container wakes | ✅ Self-healing module |
| Sunday | 06:05–07:30 | 20:05–21:30 | Full pipeline runs (Steps 1–4, A–F) | ✅ |
| Sunday | ~07:30 | ~21:30 | Gate evaluation runs for all reps | ✅ |
| Sunday | ~07:35 | ~21:35 | Digest previews generated (review-first mode) | ✅ |
| **Monday** | 06:00 | 20:00 (Sun) | Monday digest send window opens | ✅ |
| Monday | 06:05 | 20:05 | Digests auto-sent for SEND-gated reps | ✅ |
| Monday | AM | — | Operator reviews HOLD exceptions (if any) | 🔶 Manual |
| **Thursday** | 06:00 | 20:00 (Wed) | Thursday reminder emails sent | ✅ |

---

## Automated Systems

### 1. Pipeline Trigger (External Scheduled Task)

The production pipeline is triggered by a **Manus external scheduled task** that POSTs to:

```
POST /api/scheduled/pipeline
Header: X-Pipeline-Secret: <PIPELINE_SECRET env var value>
```

This fires every Sunday at 20:00 UTC (06:00 AEST Monday). The in-process scheduler is disabled in production.

**Auth note:** The endpoint uses `X-Pipeline-Secret` header authentication (no OAuth session cookie required). The secret value is stored in the `PIPELINE_SECRET` environment variable. The Manus scheduled task must pass this header — do NOT use `X-Scheduled-Task: true` as that path requires an OAuth session cookie which the scheduled task cannot obtain.

### 2. Anti-Hibernation (Warm-up Endpoint)

**Problem solved:** CloudRun containers hibernate after ~15 min of inactivity. If the scheduled task fires into a hibernated container, the proxy may return 403 before the container wakes.

**Solution:** The `operationsReliability` module provides:

- `GET /api/warmup` — lightweight endpoint that returns container readiness state
- **Self-healing retry** — if no pipeline run is detected within 10 minutes of the expected trigger time (20:00 UTC), the module automatically triggers a retry
- **Missed-run checker** — every 30 minutes, checks if a run was expected but never started; fires `notifyOwner()` alert if missed

### 3. Digest Hardening Gates

Before any email is sent to a sales rep, the system evaluates **5 criteria**:

| Criterion | What it checks |
|-----------|---------------|
| `contact_not_defensible` | Contact's trust tier is not `send_ready` |
| `wrong_contact_pattern` | Domain/title mismatch suggests wrong person |
| `domain_not_defensible` | Email domain fails defensibility check |
| `insufficient_defensible_contacts` | Fewer than 2/3 top projects have verified contacts |
| `territory_contamination` | Projects outside rep's assigned territory |

**Gate result:** SEND (all clear) or HOLD (with specific blockers listed).

### 4. Email Digest System

- **Monday digest:** Personalised weekly brief with top 3 "Must Act" projects + supporting intelligence
- **Thursday reminder:** Follow-up nudge with any new developments since Monday
- **Mode:** Review-first (admin must approve before first live send per rep)

---

## Operator Monday Workflow (Exception-Only)

### Step 1: Check Operator Status (30 seconds)

Navigate to **Admin → Pipeline Status** or call:

```
GET /api/trpc/admin.scheduleStatus.operatorStatus
```

This returns:
- `pipelineStatus`: fresh / stale / failed / running
- `isMissedRun`: whether the expected run was missed
- `lastSuccessfulRun`: timestamp and stats
- `selfHealing.attemptCount`: how many retries were needed

**If `pipelineStatus = "fresh"` and `isMissedRun = false`** → pipeline ran successfully, proceed to Step 2.

**If `pipelineStatus = "stale"` or `isMissedRun = true`** → investigate. Check the pipeline run history for errors.

### Step 2: Review Gate Exceptions (2–3 minutes)

Navigate to **Admin → Digest Management** or check the gate results in the pipeline run summary.

- **All reps SEND** → no action needed. Digests will auto-send.
- **Some reps HOLD** → review the specific blockers:
  - `contact_not_defensible` → run targeted enrichment for the flagged contacts
  - `domain_not_defensible` → check if the domain should be added to the gov allowlist
  - `wrong_contact_pattern` → manually verify the contact or suppress the project
  - `insufficient_defensible_contacts` → accept the gap or run enrichment
  - `territory_contamination` → check project state/location assignment

### Step 3: Override or Accept (30 seconds)

For HOLD reps:
- **Override:** Manually approve the digest send (admin action in the UI)
- **Accept:** Leave on HOLD — rep will not receive a digest this week
- **Fix:** Run targeted enrichment to resolve the blocker (may take 1–5 minutes)

---

## Failure Modes and Recovery

| Failure | Detection | Auto-Recovery | Manual Recovery |
|---------|-----------|---------------|-----------------|
| Container hibernated at trigger time | Self-healing retry at T+10min | ✅ Automatic retry | Check /api/warmup manually |
| Pipeline timeout (>90 min) | Stall detection in freshness check | ✅ Marks run as failed | Re-trigger via admin panel |
| Apollo API rate limit | Error logged in pipeline run | ❌ | Wait 1h, re-run enrichment step |
| Database connection failure | Pipeline fails at Step 1 | ❌ | Check DB status in dashboard |
| All reps HOLD | Gate evaluation summary | ❌ | Review blockers, fix or override |
| Missed run (no run in 26h window) | Missed-run checker + owner notification | ✅ Alert sent | Manually trigger pipeline |

---

## Key Configuration

| Setting | Value | Location |
|---------|-------|----------|
| Pipeline trigger time | 20:00 UTC (06:00 AEST) | External scheduled task |
| Self-healing retry window | 10 minutes after expected trigger | `operationsReliability.ts` |
| Missed-run check interval | Every 30 minutes | `operationsReliability.ts` |
| Pipeline freshness window | 26 hours | `checkPipelineFreshness()` |
| Gate minimum defensible contacts | 2/3 top projects | `digestHardeningGates.ts` |
| Digest mode | Review-first (admin approval required) | `persistentScheduler.ts` |
| DISABLE_DEV_SCHEDULER | true (production) | Environment variable |

---

## Scaling Notes

- **Adding new reps:** Add user profile with territory + business line assignments. Gate evaluation is automatic.
- **Adding new sources:** Add RSS feed URL to the sources table. Pipeline Step 1 will pick it up automatically.
- **Changing trigger time:** Update the external Manus scheduled task (requires `manus-config` 1.2+)
- **Promoting to auto-send:** Once a rep has been in review-first mode for 2+ successful weeks with no issues, promote to auto-send in the digest management panel.

---

## Monitoring Endpoints

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `GET /api/warmup` | Container health + self-healing status | Public |
| `GET /api/ping` | Basic liveness | Public |
| `trpc.admin.scheduleStatus.operatorStatus` | Full operator status view | Admin |
| `trpc.admin.scheduleStatus.history` | Pipeline run history | Admin |
| `trpc.admin.digestManagement.gateResults` | Per-rep gate evaluation | Admin |
