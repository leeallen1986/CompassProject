# Operator Monday Runbook

> **Target time:** <5 minutes if no exceptions.
> **When:** Every Monday 06:00–07:00 AEST (after Sunday 20:00 UTC pipeline run).

---

## 1. Open Admin Panel → Check Operator Status Widget

The **Weekly Operations Status** panel at the top of the Admin page shows:

| Field | Green (no action) | Red (action needed) |
|---|---|---|
| Pipeline | `FRESH` | `STALE` / `FAILED` / `NEVER_RUN` |
| Last Success | <26h ago | >26h ago |
| Self-Healing | 0 retries | 1+ retries (means primary failed) |
| Missed Run Alert | — | ⚠️ banner visible |

**If all green → skip to Step 3.**

---

## 2. If Pipeline is STALE or FAILED

### 2a. Self-healing already retried?
Check the "Self-Healing" card. If `retries > 0`, the system already attempted a fix.

- If last attempt status = `completed` → pipeline recovered, proceed to Step 3
- If last attempt status = `failed` → manual intervention needed:

### 2b. Manual recovery
1. Click **"Run Pipeline Now (Scheduled)"** (the green button, NOT the grey "Debug Pipeline" button)
2. Wait 30–60 minutes for completion
3. Refresh the Operator Status widget to confirm `FRESH`

### 2c. If manual run also fails
- Check server logs for the error
- Common causes: DB connection timeout, Apollo rate limit, RSS feed down
- Notify engineering if the issue is infrastructure-level

---

## 3. Check Gate Results

Navigate to the **Digest Gate Results** section in Admin. For each of the 5 target reps:

| Decision | Action |
|---|---|
| `SEND` | No action needed |
| `SEND` with warnings | Review warnings — non-blocking, but note for next week |
| `HOLD` | Read blockers, decide if override is appropriate |

### Common HOLD reasons and fixes:

| Blocker | Quick fix |
|---|---|
| `trust_tier_not_send_ready` | Run targeted enrichment for that contact |
| `domain_not_defensible` | Check if it's a false positive (new company name variant) |
| `junk_pattern_detected` | Suppress the project |
| `insufficient_defensible_contacts` | Check if 2/3 threshold is met (1 warning is OK) |
| `llm_inferred_primary` | Verify the contact manually or find alternative |

---

## 4. Confirm Monday Digest is Ready

If all gates show SEND:
- The digest will auto-send at the configured Monday send time
- No manual action required

If any rep is on HOLD:
- The system will skip that rep's digest
- You can override by running a manual send with `force: true` (use sparingly)

---

## 5. Weekly Health Check (Optional, 2 min)

Once per week, review:
- **Server uptime** in the Operator Status widget (should be >24h if no deploys)
- **Pipeline history** tab — look for patterns (always failing on same step?)
- **Self-healing attempt count** — if consistently >0, the primary trigger has a reliability issue

---

## Decision Tree (Quick Reference)

```
Open Admin
  └─ Operator Status = GREEN?
       ├─ YES → Check Gate Results → All SEND? → Done ✓
       └─ NO → Self-healing recovered?
              ├─ YES → Check Gate Results → Done ✓
              └─ NO → Run Pipeline Now (Scheduled)
                       └─ Wait 30-60 min → Refresh → Check Gates → Done ✓
```

---

## What NOT to Do

1. **Do NOT click "Debug Pipeline (Unsafe)"** — this is fire-and-forget and the container can recycle mid-run
2. **Do NOT manually edit gate results in the DB** — always re-run the gate evaluation
3. **Do NOT force-send a digest for a HOLD rep** unless you've verified the blocker is a false positive
4. **Do NOT restart the server** unless the Operator Status widget shows the server is unresponsive

---

## Escalation Path

If the Monday digest cannot be sent after following this runbook:
1. Document which reps are blocked and why
2. Note the pipeline status and any error messages
3. Escalate to engineering with the above context

The system is designed to be self-healing. If you're spending more than 15 minutes on Monday operations, something is structurally wrong and needs engineering attention.
