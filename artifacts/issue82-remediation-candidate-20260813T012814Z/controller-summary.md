# Issue #82 — Historical Persisted-State Remediation Candidate

**Status:** REMEDIATION_CANDIDATE_READY_FOR_CONTROLLER

## Immutable Snapshot

| Field | Value |
|-------|-------|
| databaseIdentity | `81fd261da8f815aad36cc8a5ce7e8577e3e6c412b5e322a853f784d321e5ab4f` |
| databaseFingerprint A | `11a40c511dd355be0639721069bc413e39867cc798d22bd7bc75abf59a5d2220` |
| databaseFingerprint B | `11a40c511dd355be0639721069bc413e39867cc798d22bd7bc75abf59a5d2220` |
| A == B | true |
| Generated A | 2026-08-13T01:28:24.380Z |
| Generated B | 2026-08-13T01:29:01.510Z |
| Total contacts | 6259 |
| Raw send-ready | 4445 |
| Effective send-ready | 2284 |
| Invalid raw send-ready | 2161 |

## Cohort Classification

| Cohort | Count | Description |
|--------|-------|-------------|
| A — Safe demote (current policy) | 1043 | Reconciliation already fail-closes to named_unverified |
| B — Generated email conflict | 592 | Generated/inferred email without strong current evidence |
| C — Duplicate no strong evidence | 73 | Strong duplicate identity without current mailbox proof |
| D — Duplicate with strong evidence | 72 | Requires identity resolution before decision |
| E — Strong exact-email normalisation | 39 | All conditions provable; normalize to verified |
| F — Manual review other | 342 | Not safely covered by automated cohorts |
| **TOTAL** | **2161** | |

## Proposed Apply Set

| Set | Count |
|-----|-------|
| Safe apply (A+B+C+E) | 1747 |
| Manual review (D+F) | 414 |

## Safety Invariants

All 7 invariants pass:
- No effective send-ready demoted without evidence ✓
- No normalization without exact evidence ✓
- No rejected contact remains send_ready ✓
- No crmOrphan remains send_ready ✓
- Every retained send_ready has project link ✓
- No duplicate merge ✓
- No plaintext emails in artifacts ✓

## Canary-3

| Contact | Current | Cohort | Expected Action |
|---------|---------|--------|-----------------|
| 3180002 | send_ready / unverified | A | → named_unverified |
| 5700008 | send_ready / unverified | A | → named_unverified |
| 750056 | named_unverified | — | remain unchanged |

## Projected State (if A+B+C+E applied)

| Metric | Current | Projected | Delta |
|--------|---------|-----------|-------|
| Raw send-ready | 4445 | 2737 | -1708 |
| Effective send-ready | 2284 | 2323 | +39 |
| Invalid raw send-ready | 2161 | 414 | -1747 |
| Named unverified | 572 | 2280 | +1708 |
| Manual review remaining | — | 414 | — |

## Canary-First Apply Plan

- **Stage 1:** 14 contacts (canary 3180002 + 5700008 + 3 from each of A/B/C/E)
- **Stage 2:** 1733 contacts (remaining safe set, only after controller validates Stage 1)

## Mutation Confirmation

| Category | Count |
|----------|-------|
| Production DB writes | 0 |
| Provider calls | 0 |
| Pipeline executions | 0 |
| Emails | 0 |
| Code changes | 0 |
| GitHub changes | 0 |
| Worker changes | 0 |
| Deployments | 0 |
