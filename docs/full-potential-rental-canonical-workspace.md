# Full Potential Rental Hire canonical workspace

## Purpose

The Rental Hire operating page must use the same commercial unit and Australian
scope as the PR #73 coverage census: an active Australian record that counts
toward Full Potential. Branch, fleet, strategic-channel, duplicate, merged,
parked and excluded rows may remain in the database for traceability, but they
must not inflate the focus queue, territory counts, priority counts or financial
totals.

## Australian market boundary

The operating workspace is fixed to:

```text
country = AU
```

Rental rows from New Zealand or another country remain in the shared Full
Potential database but are excluded from the Australian queue, filters,
territory summary, route and owner distributions, financial totals and
remediation eligibility.

The canonical selection policy retains three audit populations:

- `allRentalRows` — every row matching Rental/Hire identity rules;
- `rentalRows` — the Australian in-scope rows;
- `nonScopeRentalRows` — Rental/Hire rows retained in the database but excluded
  from this workspace.

New Zealand requires its own distributor-led operating view rather than being
silently mixed into the Australian sales workspace.

## Top-level inclusion rule

A row appears as a standalone Australian Rental Hire workspace account only when
all of the following are true:

- it satisfies the existing Rental Hire identity/segment selection;
- `country=AU` for schema-backed production rows;
- `countsTowardPotential` is not false;
- `recordStatus` is not `merged`, `parked` or `excluded`;
- `relationshipType` is not `duplicate`;
- `mergedIntoAccountId` is null.

A separately counting division or buying authority remains a top-level record
even when it has a parent. The workspace does not collapse a counting child
merely because a corporate relationship exists.

## Context preservation

A non-counting Australian row is attached to the nearest active counting
ancestor through:

1. `mergedIntoAccountId`; then
2. `parentAccountId`.

Attached context remains visible in the API as:

- `contextRecordCount`;
- `contextRecords`;
- `canonicalGroupMemberIds`.

Open actions and live signals recorded on attached context rows roll up to the
counting parent. Their financial values do not roll up, preventing duplicate
potential.

Cycles, missing targets, cross-country targets and free-floating context records
are not attached to an arbitrary parent. They are reported in
`unattachedContextRecords` so the data issue remains visible.

## Distribution contract

The endpoint returns route and owner distributions as arrays of real values:

```json
[
  { "value": "direct_ape", "count": 66 },
  { "value": "manual_review", "count": 8 },
  { "value": "cea", "count": 2 }
]
```

Verification tools must preserve this `{ value, count }` structure. They must
not interpret an array as a plain object and replace real values with
`unknown`.

## Remediation boundary

Standalone remediation actions may be created only for active counting
Australian Rental Hire records. A non-counting context row or non-Australian row
cannot receive a separate ownership, financial, installed-base or
supplier-remediation action through this workspace.

## Safety boundary

This release changes read and eligibility semantics only. It contains:

- no schema or migration;
- no account, alias, relationship, action, signal, evidence, contact or slate
  mutation;
- no provider or LLM call;
- no pipeline trigger;
- no C4C write.

Database relationship changes remain a later, separately reviewed, hashed and
bounded manifest operation.
