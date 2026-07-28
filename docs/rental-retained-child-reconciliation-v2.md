# Australian Rental Hire retained-child reconciliation v2

## Controller correction

PR #76 safely generated a read-only draft, but the proposed business outcome was
not consistent with the authoritative identity and relationship review.

The source review classifies both target records as `retain_child`:

| Retained child | Parent | Source rationale |
|---|---|---|
| `328` — Coates Hire National Fleet | `269` — Coates Hire | Separate national fleet-management engagement track; ready to engage |
| `334` — Onsite Rental Strategic Channel | `415` — Onsite Rental Group | Separate CEA account-plan engagement track; ready to engage |

The clean commercial model contains 53 canonical parents plus five legitimate
children. These two records are part of those five legitimate children. They
must therefore remain counting, top-level engagement accounts.

The PR #76 v1 draft proposed `countsTowardPotential: true → false`, which would
remove both Tier A records from the top-level Rental sales queue and reduce the
counting universe from 76 to 74. That draft is retired and must never be sealed
or applied.

## V2 authorised relationship changes

V2 records the reviewed parent relationships without suppressing either child:

| Account | parentAccountId | relationshipType | countsTowardPotential |
|---|---:|---|---|
| `328` | `null → 269` | `standalone → strategic_context` | remains `true` |
| `334` | `null → 415` | `standalone → strategic_context` | remains `true` |

No other persisted account field is authorised to change. In particular:

- `countsTowardPotential` is immutable;
- both children remain Tier A;
- both children remain independently visible in the sales queue;
- route, owner, platform-push decision and financial fields remain unchanged;
- no alias, action, signal, evidence, contact or slate is changed.

## Expected workspace before and after

The relationship links do not change the Australian Rental workspace totals:

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

Required route distribution remains:

```text
direct_ape                    66
manual_review                  8
cea                            2
```

Both children and both parents remain top-level counting accounts. The direct
row-level postcondition proves the two parent links were written.

## Operating sequence

```text
generate v2 draft read-only
→ human review
→ change only approved=false to approved=true on both rows
→ seal v2 manifest
→ record exact manifestHash
→ exact-hash transactional apply
→ verify relationships and unchanged workspace
```

The V2 CLI rejects schema-version 1 artifacts. Partial approval is prohibited.
Apply locks both children and both parents, rechecks the database fingerprint,
and rolls back both links if any row or workspace assertion fails.

## Retired operation

The following PR #76 artifact is not an authorised input:

```text
rental-relationship-manifest.draft.json
schemaVersion = 1
countsTowardPotentialAfter = false
```

Do not run the retired CLI with `--seal` or `--apply`. The superseding command is:

```text
pnpm exec tsx server/scripts/rentalRetainedChildReconcile.ts
```

## Boundary

This release contains no schema or migration. Deployment does not approve, seal
or apply any relationship. The first production operation remains read-only V2
draft generation.
