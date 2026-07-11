# Full Potential Rental Hire workspace

PR #48 introduced the first segment-specific Full Potential workspace at:

`/full-potential/rental-hire`

PR #49 extends it with ownership-exception handling and an explicit, deduplicated remediation-action workflow.

## Access and data flow

- UI: `/full-potential/rental-hire`
- Read API: `GET /api/full-potential/rental-hire`
- Remediation API: `POST /api/full-potential/rental-hire/remediation`
- Access: any authenticated Compass user, matching the existing Full Potential read/action policy
- Read path: accounts, actions and signals in three bulk queries
- Write path: explicit Full Potential action creation only after preview and confirmation
- Cache: `private, no-store`

Unauthenticated API requests return `401` and no account data.

## Rental account selection

A Full Potential record is included when any of the following is true:

- segment contains the word `rental`, `rentals` or `hire`
- subsegment contains one of those words
- canonical name, display name or parent group contains one of those words
- the identity contains `Coates`, through the explicit national strategic-account rule

Matching is case-insensitive and punctuation-insensitive. The response includes the selection-rule description for auditability.

## Territory ownership rules

Base ownership rules remain:

| Rule | Expected internal owner |
|---|---|
| Coates, regardless of state | Ryan Pemberton |
| WA | Ryan Pemberton |
| QLD and NSW | Paul Lueth |
| VIC, SA, TAS, NT, ACT and other identified markets | Dan Day |
| Missing state, unless Coates | Manual review |

The expected internal owner is compared only with `ownerName`. A distributor or dealer recorded in `channelOwner` never substitutes for the internal owner.

Channel ownership is checked separately. A channel-managed or channel-routed account without `channelOwner` enters the ownership-review and channel-owner-gap queues.

## National and multi-state ownership exceptions

PR #49 stops treating every national or multi-state ownership string as a single-owner mismatch.

The state parser recognises:

- AU state and territory abbreviations
- full state and territory names
- `National`
- `Australia wide`
- `All states`
- `Multi-state` / `Multistate`
- `NZ` / `New Zealand`

Expected owners are derived from the represented territories and deduplicated:

- `QLD / NSW` resolves to Paul Lueth only
- `WA / QLD / NSW` resolves to Ryan Pemberton and Paul Lueth
- `National` resolves to Ryan Pemberton, Paul Lueth and Dan Day
- Coates always resolves to Ryan Pemberton, even when state is National

The owner parser recognises Ryan, Paul Lueth and Dan from compound strings such as:

`Ryan / Paul / Dan by site; BLM oversight`

It deliberately does not treat `Paul Edmonds` as Paul Lueth.

Ownership states are:

- `aligned` — one expected owner and the owner field resolves only to that owner
- `shared_aligned` — all expected shared-territory owners are represented
- `mismatch` — the recorded owner set does not cover the expected owner set
- `unassigned` — no internal owner is recorded
- `manual_review` — the state cannot be resolved into a territory rule

Valid shared ownership is shown separately and does not enter the ownership-remediation queue.

## Route classification

Direct routes:

- `direct_ape`
- `hybrid_strategic`

Channel routes:

- `cea`
- `cp_aps`
- `cp_blastone`
- `cp_pneumatic_engineering`
- `cp_more_air`
- `nz_distributor`
- `png_oceania`

All other routes remain visible as `other`.

## Current activity

An action counts as open activity when its status is:

- `not_started`
- `in_progress`
- `contacted`
- `meeting_booked`
- `quoted`

Closed, completed, won, lost, deferred and not-relevant actions do not satisfy current activity.

An account-level `nextAction` also satisfies current activity.

## Live signals

Signal statuses counted as live:

- `new`
- `reviewed`
- `promoted`

Dismissed and archived signals remain in signal history but do not activate the live-signal queue or urgency flag.

## Focus queues

The workspace provides fourteen deterministic quick views:

1. All Rental
2. Tier A
3. Push Now
4. Shared Ownership
5. Ownership Review
6. No Owner
7. True Mismatch
8. No Channel Owner
9. Unknown Installed Base
10. No Supplier
11. No Financial Potential
12. Unmanaged Remediation
13. No Open Activity
14. Live Signal

Financial potential is present when any of `fullPotentialAud`, `target2026Aud` or `remainingPotentialAud` is positive.

`Unmanaged Remediation` means at least one eligible ownership, financial, installed-base or supplier gap lacks a matching open remediation action.

## Remediation action types

The workflow supports four action templates:

| Remediation | Full Potential action type | Eligibility |
|---|---|---|
| Ownership review | `manager_review` | true mismatch, unassigned owner, manual-review state or missing channel owner |
| Financial potential | `account_review` | no positive Full Potential, 2026 target or remaining potential |
| Installed-base validation | `installed_base_validation` | installed-base status is blank or unknown |
| Supplier validation | `account_review` | current supplier is blank |

Each template uses a stable recommended-action string and a marker in `notes`:

`[rental_remediation:<type>]`

An existing open action with the same action type and template/marker is treated as already managed and is not duplicated.

## Remediation workflow

The UI requires a deliberate two-step process:

1. Select one or more visible accounts.
2. Choose a remediation type and due date.
3. Optionally add a note.
4. Run a dry-run preview.
5. Review eligible, already-managed, no-longer-eligible and invalid selections.
6. Confirm creation of eligible actions only.

Limits and safeguards:

- maximum 100 account IDs per request
- due date is required and cannot be in the past
- accounts must still exist
- accounts must still match the Rental Hire selection rule
- the selected gap must still be present
- matching open remediation actions are deduplicated
- eligibility is rechecked during the write request, not trusted from the browser preview
- no account fields are updated automatically

## Focus ordering

Within a selected view, accounts are ordered by:

1. Coates national strategic-account rule
2. priority tier
3. Push Now decision
4. highest live-signal urgency
5. true ownership review state
6. unmanaged remediation
7. absence of open activity
8. remaining potential descending
9. canonical account name

This is deterministic operating logic, not a machine-learning score.

## Filters and outputs

Filters can be combined:

- free-text search
- state
- route to market
- actual internal owner
- subsegment
- priority tier
- row class
- focus view

The page includes:

- account, tier, route and financial summaries
- single-owner and shared-owner alignment
- true ownership-review counts
- remediation coverage for ownership, financial, installed base and supplier gaps
- territory table with aligned, shared, review and unmanaged counts
- account-level action and signal context
- managed-remediation badges and due dates
- owner, route and subsegment distributions
- current-page CSV export including ownership model, review reason and managed-remediation status
- handoff to the existing Full Potential account search

## Known scope boundary

The current Full Potential schema has no dedicated Full Potential contact table. The workspace does not infer contact coverage from unrelated project contacts.

## Guardrails

- no schema or migration changes
- no automatic ownership reassignment
- no automatic financial, installed-base, supplier or C4C updates
- no signal creation
- no enrichment calls
- no runtime external API requirement
- no per-account database query loop
- actions are created only after explicit user preview and confirmation
- existing Full Potential account drawer remains the record-review workflow

## Validation

Run:

```bash
pnpm tsc --noEmit
pnpm build
pnpm exec vitest run \
  server/fullPotentialRentalHire.test.ts \
  server/fullPotentialRentalRemediation.test.ts \
  server/fullPotentialRentalRemediation.handler.test.ts
```

The three suites cover:

- 13 existing Rental Hire workspace tests
- 14 ownership-exception and remediation-planning tests
- 9 HTTP-handler tests using mocked authentication and database dependencies

The handler suite must prove:

1. unauthenticated requests return `401` before database access
2. invalid payloads return `400`
3. past dates return `400`
4. more than 100 account IDs are rejected
5. authenticated distributor dry-run returns a preview with zero inserts
6. duplicate account IDs are deduplicated
7. an existing open matching action is reported as already managed
8. confirmed writes insert eligible actions only, with the authenticated creator and stable remediation marker
9. insert failures return `500`

Validate with an authenticated production-scale preview:

1. National and multi-state ownership strings move from false mismatch into `shared_aligned` when all expected owners are represented.
2. Coates remains Ryan-owned nationally.
3. QLD/NSW deduplicates to Paul Lueth.
4. WA/QLD/NSW expects Ryan and Paul.
5. Paul Edmonds is never interpreted as Paul Lueth.
6. True mismatches, unassigned owners, manual-review states and missing channel owners remain in Ownership Review.
7. All fourteen focus views return correct counts.
8. Remediation coverage counts match open generated actions.
9. Preview returns eligible, already-managed, not-eligible, not-rental and not-found results accurately.
10. Confirmation creates only eligible actions in mocked handler validation; live validation remains dry-run only.
11. A second identical request creates no duplicates.
12. Closed matching actions do not block a new remediation action.
13. Past due dates are rejected.
14. Standard user, admin and distributor access matches the existing Full Potential action policy.
15. Account, alias, signal and import counts remain unchanged; live action count changes only after an explicitly approved production confirmation.
