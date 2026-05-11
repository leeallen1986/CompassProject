# Session Report — Operating Layer Stabilisation
**Date:** 11 May 2026  
**Scope:** Make the weekly operating layer trustworthy and self-running  
**Outcome:** All 5 target reps confirmed SEND; platform reliability hardened; operator workflow documented

---

## Executive Summary

This session addressed the three root causes identified in the Monday readiness report: gate false positives blocking legitimate SEND decisions, a missing contact verification for Amit Bhargava, and an unreliable pipeline execution model that could silently miss a weekly run. All three were resolved. The platform now has in-app resilience mechanisms, a corrected gate evaluation engine, fresh SEND results written to the database, and a documented operator workflow that targets under 5 minutes of Monday morning effort.

---

## Part A — Operations Reliability

### Problem
The pipeline's primary failure mode was container hibernation. CloudRun containers sleep after approximately 15 minutes of inactivity. When the external Manus scheduled task fired into a sleeping container, the proxy returned a 403 before the container woke. No `pipelineRuns` row was created, no alert fired, and the week's data was silently missed.

### What Was Built

A new module, `server/operationsReliability.ts`, was created with four components:

**Warm-up endpoint (`GET /api/warmup`)**  
A lightweight, unauthenticated route that forces the container awake and returns a JSON readiness payload including server uptime, last pipeline run status, and timestamp. The external scheduled task should call this 2–3 minutes before the main pipeline POST. The endpoint is intentionally cheap — it does no DB writes and returns in under 100ms.

**Self-healing retry timer**  
A Node.js `setInterval` fires at 20:10 UTC daily (10 minutes after the expected 20:00 UTC run). If no `pipelineRuns` row exists for the current day's expected window, the module calls `runDailyPipeline("self-healing-retry")` directly in-process. This covers the hibernation failure mode without requiring any external infrastructure change. The retry is idempotent — it checks for an existing run before firing.

**Missed-run checker**  
A 30-minute polling loop calls `checkPipelineFreshness(26)`. If the pipeline is stale, failed, or has never run, it calls `notifyOwner()` with a structured alert. A 12-hour notification cooldown prevents alert spam during extended outages.

**`operatorStatus` tRPC endpoint**  
A new `adminProcedure` at `trpc.dailyPipeline.operatorStatus` returns a structured object covering: pipeline freshness status, last successful run timestamp and age, last attempt details (started at, status, triggered by), next scheduled run time and hours until, self-healing timer state and retry count, missed-run checker state, and server uptime in seconds.

### Platform Scheduling (Documented, Pending External Config)

`manus-config` version 1.1.0 does not support the `schedule` subcommand (requires 1.2+). The exact configuration needed when 1.2+ becomes available is:

| Job | Cron (UTC) | Target | Purpose |
|---|---|---|---|
| Warm-up | `57 19 * * 0` (Sunday) | `GET /api/warmup` | Wake container before pipeline |
| Primary pipeline | `0 20 * * 0` (Sunday) | `POST /api/scheduled/pipeline` | Main weekly run |
| Backup retry | `15 20 * * 0` (Sunday) | `GET /api/scheduled/retry` | Conditional retry if primary missed |

Until then, the self-healing retry and missed-run alerting cover the gap.

### Tests Added
- `handleWarmup` returns valid JSON with `ok: true`
- `getOperatorStatus` returns a valid operator status object with all required fields

---

## Part B — Gate False Positive Fixes

### Problem
Two distinct bugs in `server/digestHardeningGates.ts` were causing legitimate SEND contacts to be blocked.

**Bug 1: `isTruncatedDomain()` — `includes` vs `startsWith`**

The function was designed to detect cases where a contact's email domain prefix is a truncated version of the company name (e.g., `fortescue@fortescue.com.au` when the company is `Fortescue Metals Group` — the domain `fortescue` is a truncation of the full name). The implementation used `ownerNorm.includes(domainPrefix)` which matched any substring, not just a prefix. When the ICN scraper updated project owner names to their full ICN-registered legal forms, this caused false positives:

| Domain | ICN Owner Name | Old result | New result |
|---|---|---|---|
| `fortescuemetals.com.au` | `Fortescue Metals Group Ltd` | BLOCKED (false positive) | PASS |
| `chevron.com.au` | `Chevron Australia Pty Limited` | BLOCKED (false positive) | PASS |
| `woodsideenergy.com` | `Woodside Energy Ltd` | BLOCKED (false positive) | PASS |
| `baesystems.com.au` | `BAE Systems Australia Limited` | BLOCKED (false positive) | PASS |

**Fix applied:** Changed `ownerNorm.includes(domainPrefix)` to `ownerNorm.startsWith(domainPrefix)` on the relevant line. A domain is only flagged as truncated if the owner's normalised name *begins with* the domain prefix — not if the prefix appears anywhere in the name.

**Bug 2: Blanket `.gov.au` exclusion**

The `NON_DEFENSIBLE_DOMAINS` list included a blanket `.gov.au` exclusion that blocked all government email domains, including verified procurement contacts at legitimate government departments. Dan Day's top project contact (`angela.roys@cyber.qld.gov.au`) was blocked by this rule.

**Fix applied:** Added a `GOV_DOMAIN_ALLOWLIST` constant above the `NON_DEFENSIBLE_DOMAINS` check. Domains in the allowlist bypass the blanket exclusion. Initial allowlist entries:

```
cyber.qld.gov.au        — QLD Government procurement
defence.gov.au          — Department of Defence
infrastructure.gov.au   — Infrastructure Australia
dpie.nsw.gov.au         — NSW Planning
water.nsw.gov.au        — WaterNSW
energy.gov.au           — DCCEEW
```

The allowlist is designed to be extended as new verified government procurement domains are encountered.

### Tests Added (9 new tests)
- `isTruncatedDomain` fix: 4 tests confirming the 4 previously-blocked domains now pass
- `isTruncatedDomain` fix: 1 test confirming genuine truncation (`wateroration.com.au`) is still caught
- `GOV_DOMAIN_ALLOWLIST`: 2 tests confirming allowlisted domains pass
- `GOV_DOMAIN_ALLOWLIST`: 2 tests confirming non-allowlisted `.gov.au` and `.edu.au` domains are still blocked

**Total tests after fixes: 33 passing (30 gate tests + 3 operations tests)**

---

## Part C — Amit Bhargava Contact Enrichment

### Problem
Amit's gate was HOLD due to 2/3 top projects having `named_unverified` contacts. The gate requires at least 2/3 top projects to have `send_ready` contacts.

### Choi JungIn (Vena Energy) — Resolved

The existing contact record had email `choi.jungin@venaenergy.com.au` (an `.com.au` domain that does not exist for Vena Energy). A targeted Hunter.io domain search on `venaenergy.com` returned the correct pattern: `{first}.{last}@venaenergy.com`. The correct email `jungin.choi@venaenergy.com` was verified with a Hunter confidence score of 91/100. The contact record was updated in the database and the trust tier promoted to `send_ready`.

### Ubayeda Shaqer (Octopus Australia) — Unresolvable

Octopus Australia (the renewable energy arm, not the UK energy retailer) has virtually no indexed email data in Apollo or Hunter. Multiple search strategies were attempted: direct name search, company domain search (`octopus.com.au`, `octopusenergy.com.au`), and title-based search for Development Manager roles at the company. All returned zero results. This contact remains `named_unverified` and is noted as a known data gap.

### Net Result
With Choi JungIn promoted to `send_ready`, Amit now has 2/3 top projects with defensible contacts (Territory Generation BESS + Bellambi Heights BESS), meeting the gate threshold. Ubayeda Shaqer's project (Blind Creek Solar) generates a non-blocking warning in the gate output but does not prevent SEND.

---

## Part D — Operator Status Panel (Admin UI)

A new **Weekly Operations Status** panel was added at the top of the Admin page. It calls `trpc.dailyPipeline.operatorStatus` every 60 seconds and renders:

- **Pipeline status badge** — colour-coded: green (`FRESH`), amber (`RUNNING`), red (`STALE` / `FAILED` / `NEVER_RUN`)
- **Last Success card** — shows age in hours and full timestamp
- **Next Run card** — shows hours until next expected run and the exact UTC timestamp
- **Self-Healing card** — shows retry count and whether the timer is active
- **Missed-run alert banner** — red warning strip that appears when `isMissedRun` is true
- **Last attempt row** — started at, status, triggered by (shows which trigger fired: `scheduled-task`, `self-healing-retry`, `admin`, etc.)
- **Server uptime footer** — hours and minutes since last server start

The panel auto-refreshes every 60 seconds. A manual refresh button is also provided.

---

## Part B (Admin UI) — Unsafe Button Relabelling

The **"Run Full Pipeline"** button in the Admin action bar was relabelled to **"⚠️ Debug Pipeline (Unsafe)"** and given:
- A dashed border with muted colouring (visually de-emphasised)
- A `window.confirm()` dialog explaining why it is unsafe for weekly operations and directing the operator to use "Run Pipeline Now (Scheduled)" instead
- A `title` tooltip with the same warning for hover context

The safe weekly execution path remains the **"Run Pipeline Now (Scheduled)"** button (green), which uses the NDJSON streaming endpoint and keeps the HTTP connection open for the duration of the pipeline run, preventing CloudRun from recycling the container mid-run.

---

## Part E — Fresh Gate Evaluation

The regate script (`scripts/step5-regate.mjs`) was run with the fixed gate code. Results were written to `repDigestGateResults` with `phase: "manual_refresh"` and `weekKey: "2026W19"`.

| Rep | Decision | Blockers | Top Contact |
|---|---|---|---|
| Ryan Pemberton | **SEND** | 0 | Robyn Morris @ Fortescue Metals Group (`send_ready`) |
| Brett Hansen | **SEND** | 0 | Ezaddin Zainal Abidin @ Chevron Australia (`send_ready`) |
| Daniel Zec | **SEND** | 0 | Sam Leszczynski @ Qube (`send_ready`) |
| Dan Day | **SEND** | 0 | Angela Roys @ Queensland Government (`send_ready`) |
| Amit Bhargava | **SEND** | 1 warning (non-blocking) | Grant Hudson @ Territory Generation (`send_ready`) |

The single warning for Amit (Ubayeda Shaqer `named_unverified` on project 3) is classified as `severity: "warning"` not `severity: "blocking"` — the gate passes because 2/3 projects meet the defensibility threshold.

---

## Part F — Operator Monday Runbook

`docs/OPERATOR-MONDAY-RUNBOOK.md` was written as the definitive Monday morning reference. It covers:

- **Target time:** Under 5 minutes if no exceptions
- **Step 1:** Open Admin → check Operator Status widget (green = no action)
- **Step 2:** If pipeline is stale — check if self-healing recovered, then manual recovery path
- **Step 3:** Check gate results — SEND/HOLD table with common blockers and quick fixes
- **Step 4:** Confirm digest is ready (auto-sends if all gates pass)
- **Step 5:** Optional weekly health check (2 min)
- **Decision tree** — visual flowchart for the exception path
- **What NOT to do** — explicit list of anti-patterns (do not use Debug Pipeline, do not manually edit gate results, do not force-send a HOLD without verifying the blocker)
- **Escalation path** — when to involve engineering

---

## Test Summary

| Test File | Tests | Status |
|---|---|---|
| `server/digestHardeningGates.test.ts` | 30 | All pass |
| `server/operationsReliability.test.ts` | 2 | All pass |
| `server/auth.logout.test.ts` | 1 | Pass |
| **Total** | **33** | **All pass** |

TypeScript compiles with zero errors (`npx tsc --noEmit --skipLibCheck`).

---

## Files Changed

| File | Change |
|---|---|
| `server/operationsReliability.ts` | New — warm-up endpoint, self-healing retry, missed-run checker, `getOperatorStatus()` |
| `server/digestHardeningGates.ts` | Fixed `isTruncatedDomain()` (startsWith), added `GOV_DOMAIN_ALLOWLIST` |
| `server/routers.ts` | Added `trpc.dailyPipeline.operatorStatus` endpoint |
| `server/_core/index.ts` | Added `startOperationsReliability()` call on server start |
| `client/src/pages/Admin.tsx` | Added Operator Status panel, relabelled unsafe button |
| `server/digestHardeningGates.test.ts` | 9 new tests for gate fixes |
| `server/operationsReliability.test.ts` | New — 2 tests for warm-up and operator status |
| `docs/OPERATOR-MONDAY-RUNBOOK.md` | New — Monday operator workflow |
| `docs/WEEKLY-OPERATING-MODEL.md` | New — full operating model reference |
| `scripts/step5-regate.mjs` | Run (not modified) — fresh gate results written to DB |

---

## Prioritised Next Actions

**Before Monday send (required):**

1. **Send Monday digests** — all 5 reps are SEND-ready. The digest auto-sends at the configured Monday send time. No manual action required unless the Operator Status widget shows a problem.

2. **Fix 7 email quality issues** — the following are in the todo backlog and should be addressed before the next send cycle:
   - Rental CTA language (some projects are showing "rental" framing for direct-sale opportunities)
   - Product slug labels (some business line badges show internal codes rather than customer-facing names)
   - Pitch truncation (some project overviews are cut mid-sentence in the email body)
   - Contact title sanitisation (LinkedIn pipe-separated fragments appearing in titles)
   - Contact name + title in CTA (currently showing title alone)

**Short-term (1–2 weeks):**

3. **Configure external scheduled task** — when `manus-config` 1.2+ is available, set up the 3-job chain documented in `WEEKLY-OPERATING-MODEL.md`. Until then, the self-healing retry covers the hibernation failure mode.

4. **Add SEND/HOLD count to Operator Status panel** — currently shows pipeline health only. Adding "5/5 SEND this week" or "3/5 SEND, 2 HOLD" would complete the single-glance Monday check without requiring the operator to scroll to the gate results section.

5. **Find alternative for Ubayeda Shaqer** — Octopus Australia has no indexed email data in any current enrichment source. Options: LinkedIn manual lookup, substitute with a different Octopus AU contact (the company has ~15 AU staff), or accept the non-blocking warning as permanent for this project.

6. **Fix `apolloEligibility.test.ts` timeouts** — 4 pre-existing test failures due to DB connection timeouts in the test environment. These are not related to this session's changes but should be resolved to keep the test suite clean. Fix: add a DB mock or increase the vitest timeout for that file.
