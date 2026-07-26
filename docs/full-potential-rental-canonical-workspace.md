# Full Potential Rental Hire canonical workspace

## Purpose

The Rental Hire operating page must use the same commercial unit as the PR #73
coverage census: an active record that counts toward Full Potential. Branch,
fleet, strategic-channel, duplicate, merged, parked and excluded rows may remain
in the database for traceability, but they must not inflate the focus queue,
territory counts, priority counts or financial totals.

## Top-level inclusion rule

A row appears as a standalone Rental Hire workspace account only when all of the
following are true:

- it satisfies the existing Rental Hire identity/segment selection;
- `countsTowardPotential` is not false;
- `recordStatus` is not `merged`, `parked` or `excluded`;
- `relationshipType` is not `duplicate`;
- `mergedIntoAccountId` is null.

A separately counting division or buying authority remains a top-level record
even when it has a parent. The workspace does not collapse a counting child
merely because a corporate relationship exists.

## Context preservation

A non-counting row is attached to the nearest active counting ancestor through:

1. `mergedIntoAccountId`; then
2. `parentAccountId`.

Attached context remains visible in the API as:

- `contextRecordCount`;
- `contextRecords`;
- `canonicalGroupMemberIds`.

Open actions and live signals recorded on attached context rows roll up to the
counting parent. Their financial values do not roll up, preventing duplicate
potential.

Cycles, missing targets and free-floating context records are not attached to an
arbitrary parent. They are reported in `unattachedContextRecords` so the data
issue remains visible.

## Remediation boundary

Standalone remediation actions may be created only for active counting Rental
Hire records. A non-counting context row cannot receive a separate ownership,
financial, installed-base or supplier-remediation action; that work belongs to
the counting parent.

## Safety boundary

This release changes read semantics only. It contains:

- no schema or migration;
- no account, alias, relationship, action, signal, evidence, contact or slate
  mutation;
- no provider or LLM call;
- no pipeline trigger;
- no C4C write.

Database relationship changes remain a later, separately reviewed, hashed and
bounded manifest operation.
