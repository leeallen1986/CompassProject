# Issue #82 — Production Baseline Census Summary

## Status

BASELINE_COMPLETE_WAITING_FOR_NATURAL_PIPELINE

## Serving Release

| Field | Value |
|-------|-------|
| Gateway checkpoint | 415a2aef |
| Gateway timestamp | 2026-08-11T09:06:19.506832679Z |
| deploymentHealth checkpoint | 415a2aef |
| sourceAttestationStatus | checkpoint_confirmed_source_unattested |
| Gateway/health equality | true |

## Database Context

| Field | Value |
|-------|-------|
| SELECT 1 | 1 |
| VERSION() | 8.0.11-TiDB-v8.5.3-serverless |
| DATABASE() | 3SMu786VMCWdCnmNSx6pxw |
| CURRENT_USER() | HWM***@% |

## Global Contact-Trust Baseline

| Metric | Value |
|--------|-------|
| Total contacts (reconciliation) | 6252 |
| Raw send-ready | 4439 |
| Effective send-ready | 2273 |
| Fully project-eligible send-ready | 2273 |
| Invalid raw send-ready | 2166 |
| Exact regression-shape count | 2158 |

## Dispositions

| Disposition | Count |
|-------------|-------|
| safe_keep | 1180 |
| safe_demote | 1048 |
| safe_promote | 0 |
| safe_clear_generated_email | 0 |
| safe_link_to_project | 0 |
| manual_review | 2301 |
| no_change | 1723 |

## Canary-3

| Contact | Tier | Raw | Effective | Failed Conditions | Timing |
|---------|------|-----|-----------|-------------------|--------|
| 3180002 | send_ready | true | false | emailVerified_not_true, verificationStatus_not_verified | timing_not_provable |
| 5700008 | send_ready | true | false | emailVerified_not_true, verificationStatus_not_verified | timing_not_provable |
| 750056 | named_unverified | false | false | emailVerified_not_true, verificationStatus_not_verified | consistent_with_certified_demotion |

## Slate Audit

| Metric | Value |
|--------|-------|
| Total slates | 13 |
| Current | 4 |
| Stale | 0 |
| Invalid | 9 |
| Requires action | 9 |
| Leading issues | llm_inferred (9), trust_tier_mismatch (9), role_relevance_mismatch (9) |

## Zero-Change Proof

| Field | Value |
|-------|-------|
| Fingerprint A databaseFingerprint | fdab3eb313b77a4f007ff493b3cce38ef0f52a08458e24544a5e296dbc4ee9e8 |
| Fingerprint B databaseFingerprint | fdab3eb313b77a4f007ff493b3cce38ef0f52a08458e24544a5e296dbc4ee9e8 |
| Data equality | true |
| Database writes | 0 |
| Provider calls | 0 |
| Pipeline executions | 0 |
| Email activity | 0 |

## Next Required Event

Wait for the next naturally scheduled production pipeline run, then perform the separately authorised read-only comparison census.
