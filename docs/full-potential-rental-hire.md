# Full Potential Rental Hire workspace

PR #48 introduces the first segment-specific Full Potential workspace at:

`/full-potential/rental-hire`

It is a read-only operating view for the Portable Air Rental Hire account universe. It combines the existing Full Potential account, action and signal records without changing any of them.

## Access and data flow

- UI: `/full-potential/rental-hire`
- API: `GET /api/full-potential/rental-hire`
- Access: any authenticated Compass user, matching the existing Full Potential read policy
- Writes: none
- Database reads: accounts, actions and signals in three bulk queries
- Cache: `private, no-store`

Unauthenticated API requests return `401` and no account data.

## Rental account selection

A Full Potential record is included when any of the following is true:

- segment contains the word `rental`, `rentals` or `hire`
- subsegment contains the word `rental`, `rentals` or `hire`
- canonical name, display name or parent group contains one of those words
- the identity contains `Coates`, which is included through the explicit national strategic-account rule

The matching is case-insensitive and punctuation-insensitive. The response includes the selection-rule description for auditability.

This rule uses existing Full Potential classification data. It does not create a new segment field or silently rewrite source records.

## Territory ownership rules

The workspace applies the current Portable Air commercial ownership rules:

| Rule | Expected internal owner |
|---|---|
| Coates, regardless of state | Ryan Pemberton |
| WA | Ryan Pemberton |
| QLD and NSW | Paul Lueth |
| All other markets | Dan Day |
| Missing state, unless Coates | Manual review |

The expected internal owner is compared only with `ownerName`. A distributor or dealer recorded in `channelOwner` does not satisfy the internal territory-owner rule.

Channel ownership is checked separately. A channel-managed row or channel-routed account with no `channelOwner` is placed in the channel-owner-gap queue.

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

All other routes remain visible as `other` and are not silently reclassified.

## Current activity

An action counts as open activity when its status is:

- `not_started`
- `in_progress`
- `contacted`
- `meeting_booked`
- `quoted`

A closed, completed, won, lost, deferred or not-relevant action does not satisfy current activity.

An account also has current activity when `nextAction` is recorded directly on the Full Potential account.

## Live signals

Signal statuses counted as live:

- `new`
- `reviewed`
- `promoted`

Dismissed and archived signals remain included in total signal history but do not activate the live-signal queue or urgency flag.

## Focus queues

The workspace provides eleven deterministic quick views:

1. All Rental
2. Tier A
3. Push Now
4. No Owner
5. Owner Mismatch
6. No Channel Owner
7. Unknown Installed Base
8. No Supplier
9. No Financial Potential
10. No Open Activity
11. Live Signal

Financial potential is considered present when any of `fullPotentialAud`, `target2026Aud` or `remainingPotentialAud` is positive.

## Focus ordering

Within a selected view, accounts are ordered by:

1. Coates national strategic-account rule
2. priority tier
3. Push Now decision
4. highest live signal urgency
5. ownership gap or mismatch
6. absence of open activity
7. remaining potential descending
8. canonical account name

This is a deterministic operating order, not a machine-learning score and not a replacement for manager judgement.

## Filters

Filters can be combined:

- free-text search
- state
- route to market
- actual internal owner
- subsegment
- priority tier
- row class
- focus view

Summary, territory coverage and distributions recalculate for the current base filters. The selected focus view then determines the account queue and pagination.

## Workspace outputs

The page includes:

- rental account count
- Tier A and Push Now counts
- direct and channel split
- owner alignment, mismatch and unassigned counts
- open-activity and live-signal coverage
- revenue, Full Potential and remaining potential totals
- territory table with expected owner and route mix
- owner, route and subsegment distributions
- account-level actions, signals, commercial gaps and financial values
- CSV export of the current page
- handoff to the existing Full Potential account search

## Known scope boundary

The current Full Potential schema has no dedicated Full Potential contact table. PR #48 therefore does not invent contact coverage from unrelated project contacts. Contact coverage will be added after the dedicated contact foundation is approved.

## Guardrails

- no schema or migration changes
- no account creation or reassignment
- no C4C writes
- no action or signal creation
- no enrichment calls
- no customer data embedded in tests
- no N+1 database queries
- existing Full Potential account drawer remains the review/edit workflow

## Validation

Run:

```bash
pnpm tsc --noEmit
pnpm build
pnpm exec vitest run server/fullPotentialRentalHire.test.ts
```

Then verify with an authenticated production-scale preview:

1. Workspace total and included account names match the Rental Hire selection rule.
2. Coates is included and assigned to Ryan Pemberton regardless of state.
3. WA, QLD/NSW and all-other-market ownership rules calculate correctly.
4. Channel owner is assessed separately from internal owner.
5. Each of the eleven quick views returns the expected count.
6. All seven filters work independently and together.
7. Territory coverage and three distributions recalculate.
8. Open actions count; completed actions do not.
9. New/reviewed/promoted signals count as live; dismissed/archived signals do not.
10. Account links return to the existing Full Potential search.
11. CSV export contains only the current page and no hidden secrets.
12. Unauthenticated API access returns `401`.
13. Account, alias, action, signal and import row counts remain unchanged.
