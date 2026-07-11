# Full Potential data-quality and coverage dashboard

PR #46 adds a read-only dashboard for identifying gaps in the Portable Air Full Potential account universe before the team relies on it for targeting, contact enrichment or manager execution reporting.

## Route and access

- UI: `/full-potential/data-quality`
- API: `GET /api/full-potential/data-quality`
- Access: any authenticated Compass user, matching the existing Full Potential read procedures
- Writes: none

The API authenticates the existing session cookie and returns `401` when no valid session is present. It does not expose account data publicly.

## Core completeness fields

Each record receives a completeness score across the fields applicable to its row class:

1. Route resolved (`manual_review` is incomplete)
2. Segment
3. Subsegment
4. State or territory
5. Responsible owner (`ownerName` or `channelOwner`)
6. Channel owner, only when the account is channel-managed
7. Assigned priority tier
8. Application plays
9. Current supplier
10. Installed-base status
11. Current revenue value recorded
12. Positive Full Potential, 2026 target or remaining potential
13. C4C status
14. Next activity
15. Next activity date
16. Evidence sources
17. Evidence confidence

Applicability is row-class aware:

- `account` and `channel_managed` rows are execution records and are assessed for owner, priority, revenue, financial potential, C4C and next activity.
- `channel_managed` rows and channel-routed accounts are additionally assessed for channel owner.
- `competitor_watch` rows are assessed for supplier and installed-base evidence, but not for sales execution fields.
- `site_context` and `cluster_signal` rows are assessed for classification, application and evidence fields, but are not penalised for missing owner, financial, C4C or action data.

This prevents context and intelligence rows from creating false sales-execution gaps.

## Action-aware activity coverage

An open Full Potential workflow action counts as current activity when its status is one of:

- `not_started`
- `in_progress`
- `contacted`
- `meeting_booked`
- `quoted`

An open action with a due date also satisfies next-activity-date coverage. Closed, completed, deferred, won, lost and not-relevant actions do not satisfy the current-activity checks.

## Priority gap queues

The dashboard provides the following review queues:

- No responsible owner
- Channel account without channel owner
- Tier A without next action
- Push Now without activity
- Installed base unknown
- Current supplier missing
- Financial potential missing
- Evidence missing
- Confidence unknown
- C4C status unknown
- Priority unassigned
- Segment missing
- State missing

Critical queues are ownership and execution gaps. Warning queues are data gaps that materially reduce targeting confidence. Informational queues are classification gaps.

## Coverage dimensions

The same filtered account set can be grouped by:

- Segment
- Subsegment
- State or territory
- Route to market
- Responsible owner
- Priority tier

For each group, the dashboard reports account count, average completeness, critical-gap accounts, missing owners, missing activity, unknown installed base and missing suppliers.

## Filters and pagination

Filters are exact-match and can be combined:

- Segment
- State
- Route to market
- Responsible owner
- Priority tier
- Row class

The selected issue queue is paginated at 50 accounts per page. Account links return the user to the existing Full Potential page with the account name preloaded into search.

## Guardrails

- No schema or migration changes
- No C4C writes
- No automatic account updates
- No action creation
- No enrichment calls
- No customer data embedded in source code or tests
- Two database reads per request: accounts and actions; no per-account query loop

## Validation

Run:

```bash
pnpm tsc --noEmit
pnpm build
pnpm exec vitest run server/fullPotentialDataQuality.test.ts server/fullPotentialDataQuality.rowClass.test.ts
```

Then smoke-test with an authenticated user:

1. Open `/full-potential/data-quality`.
2. Confirm summary totals match the selected filter scope.
3. Select each priority gap queue and paginate.
4. Change segment, state, route, owner, tier and row-class filters.
5. Change the coverage dimension.
6. Open an account and confirm the existing Full Potential page is searched correctly.
7. Confirm an unauthenticated API request returns `401`.
8. Confirm no account, action, signal or C4C record changes after use.
