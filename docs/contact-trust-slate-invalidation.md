# Contact-trust candidate-slate invalidation

## Purpose

Contact trust reconciliation changes the authoritative contact record. Candidate slates cache contact IDs and contact snapshots for fast sales-facing rendering. A trust-tier, verification, email or deterministic project-link correction must therefore invalidate every affected slate in the same transaction.

## Behaviour

When an approved reconciliation manifest is applied:

- `safe_demote`, `safe_promote` and `safe_clear_generated_email` invalidate every slate that references the contact in a direct slot or stored slot snapshot;
- `safe_link_to_project` invalidates the linked project's slate even when the contact is not yet assigned to a slot;
- already-stale slates retain their existing `staleSince` value;
- fresh matched slates are updated to `isStale=true` with one shared `staleSince` timestamp;
- contact/project-link changes and slate invalidation occur inside one database transaction;
- post-apply verification fails when any matched slate remains non-stale;
- idempotent re-application is a no-op only when both the contact state and every affected slate are already reconciled.

The apply summary records matched slate IDs, project IDs, the number newly marked stale and the number already stale.

## Boundary

This release does not regenerate candidate slates, select a new primary contact, send email, call any provider, or alter projects, accounts, Full Potential records, pursuits, pipeline stages or C4C data.

## Canary correction

A reconciliation canary may include only approved applyable dispositions:

- `safe_demote`
- `safe_promote`
- `safe_clear_generated_email`
- `safe_link_to_project`

`safe_keep`, `manual_review` and `no_change` are review outcomes and cannot be applied. Any shortlist containing only `safe_keep` rows is not an executable canary.
