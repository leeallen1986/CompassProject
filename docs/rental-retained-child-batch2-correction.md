# Australian Rental Hire retained-child batch 2 correction

## Purpose

This release supersedes the rejected PR #79 three-row batch. The PR #79 safety
checks correctly proved that account `272` is **United Rentals**, while account
`332` is **Kennards Hire**. The proposed `332 → 272` relationship is therefore
commercially false and must never be approved, sealed or applied.

The corrected batch contains only the two legitimate retained-child links that
remain supported by the identity evidence:

| Child account | Reviewed parent | Treatment |
|---|---|---|
| `278` — Coates Industrial Solutions | `269` — Coates Hire | Retain as an independently counting Tier A, `direct_ape`, `push_now` buying authority |
| `352` — Tutt Bryant Equipment | `275` — Tutt Bryant Hire | Retain as an independently counting Tier C, `manual_review`, `channel_view` buying authority |

For each child, the only authorised future business-field changes are:

```text
parentAccountId: null → reviewed parent ID
relationshipType: standalone → strategic_context
```

`countsTowardPotential` remains `true`. Database-managed `updatedAt` may change.
No identity, route, owner, tier, push decision, financial value, lifecycle,
merge, alias, action, signal or evidence state may change.

## Rejected Kennards relationship

Production identity is authoritative:

```text
272 = United Rentals / United Rentals Australia
332 = Kennards Hire
```

Account `332` remains a standalone, active, counting Australian Kennards Hire
commercial record. It is not part of this write batch and no alternative parent
is approved.

The correction utility requires before generation, sealing and apply:

```text
272 canonical/display identity contains "United Rentals"
332 canonicalName = "Kennards Hire"
332 parentAccountId = null
332 relationshipType = standalone
332 countsTowardPotential = true
332 recordStatus = active
332 mergedIntoAccountId = null
```

The transaction locks both records as protected rows even though neither is
written. A failed separation check blocks or rolls back the corrected batch.

## PR #78 continuity

The already certified PR #78 relationships remain mandatory:

```text
328 → 269, strategic_context, countsTowardPotential=true
334 → 415, strategic_context, countsTowardPotential=true
```

Parents `269` and `415` must remain active, counting and unmerged.

## Fixed source-state gates

| ID | rowClass | route | priority | push decision |
|---:|---|---|---|---|
| 278 | `account` | `direct_ape` | `tier_a` | `push_now` |
| 352 | `account` | `manual_review` | `tier_c` | `channel_view` |

Tutt Bryant Equipment remains `manual_review`. The parent link records group
structure only and does not approve direct outreach or change route-to-market.

## Operating sequence

```text
read-only generate
→ review exactly two rows
→ change only approved=false to approved=true
→ seal against an unchanged fingerprint
→ record exact manifest hash
→ controlled transactional apply
→ certify both links and unchanged workspace totals
```

Generation is read-only and the default mode. Sealing is a local artifact
operation. Apply requires the exact sealed v4 file and its exact confirmation
hash.

Partial approval is prohibited. The approved ID set must be exactly:

```text
[278,352]
```

## Workspace invariants

Both children remain counting accounts, so the Australian Rental workspace must
remain unchanged before and after linking:

```text
totalRentalRows               76
totalRentalAccounts           76
tierA                         17
pushNow                       12
directAccounts                66
channelAccounts                2
nonCountingContextRecords      0
attachedContextRecords         0
unattachedContextRecords       0
```

Route distribution remains:

```text
direct_ape                    66
manual_review                  8
cea                            2
```

Accounts `269`, `272`, `275`, `278`, `332` and `352` all remain top-level sales
workspace records.

## Transactional apply

Apply verifies:

- schema version `4` and batch ID `retained-child-batch-2-corrected`;
- sealed-manifest hash and explicit `--confirm-hash`;
- database identity and complete account/action/signal fingerprint;
- exact two-account approval set `[278,352]`;
- per-row record hashes and immutable child/parent state;
- PR #78 continuity;
- Kennards/United Rentals separation;
- unchanged 76-account Australian Rental workspace;
- no active pipeline.

The transaction locks child IDs `278`,`352`, parent IDs `269`,`275`, and
protected identity IDs `272`,`332`. It rechecks all gates, applies only the two
reviewed links, rebuilds the live workspace and rolls back on any mismatch.

## Retirement of PR #79 V3

`server/scripts/rentalRetainedChildBatch2Reconcile.ts` is permanently retired
and exits non-zero. The rejected V3 draft cannot be generated, sealed or applied
through the supported CLI after this release.

Use only:

```text
server/scripts/rentalRetainedChildBatch2CorrectionReconcile.ts
```

## Safety boundary

This release contains no schema, migration, provider, LLM, email, C4C or
pipeline operation. It does not merge, suppress, rename or reclassify an
account. Wider duplicate cleanup and external discovery remain separate
controller-owned operations.
