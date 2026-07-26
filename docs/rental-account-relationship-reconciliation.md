# Rental Hire account relationship reconciliation

## Purpose

This utility controls the first production relationship write in the Australian
Rental Hire Full Potential universe. It converts two already reviewed
standalone rows into non-counting strategic context beneath their canonical
commercial parents.

The utility is intentionally narrow. It is not a general account merge tool and
it does not authorise the wider 76-row identity review.

## Fixed canary

| Context account | Canonical parent | Approved field changes |
|---|---|---|
| `328` — Coates Hire National Fleet | `269` — Coates Hire | `parentAccountId: null → 269`; `relationshipType: standalone → strategic_context`; `countsTowardPotential: true → false` |
| `334` — Onsite Rental Strategic Channel | `415` — Onsite Rental | `parentAccountId: null → 415`; `relationshipType: standalone → strategic_context`; `countsTowardPotential: true → false` |

The following must remain unchanged:

- account identity, stable key and display name;
- row class and active record status;
- `mergedIntoAccountId`;
- route to market, owner, priority and platform-push decision;
- financial values;
- aliases, actions, signals and evidence.

## Operating sequence

```text
generate read-only draft
→ human review
→ change only approved=false to approved=true on both safe rows
→ seal
→ record manifest hash
→ exact-hash apply
→ transactional workspace assertion
```

Generation is the default and performs no database write. Sealing is a local
artifact operation. Apply requires the sealed manifest and its exact
`manifestHash`.

Partial approval is prohibited. Either both account IDs `328,334` are approved
or neither is applied.

## Pre-apply gates

The generated draft must show the exact current Australian workspace state:

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

Both context accounts and both parents must be top-level accounts. Each target
must also be in the exact reviewed source state:

```text
country                       AU
recordStatus                  active
parentAccountId               null
mergedIntoAccountId           null
relationshipType              standalone
countsTowardPotential         true
```

Any identity, lifecycle, relationship or workspace discrepancy produces
`manual_review` or blocks apply.

## Transactional post-apply gates

The two account updates occur in one transaction. Before commit, the utility
rebuilds the Rental Hire workspace and requires:

```text
totalRentalRows               76
totalRentalAccounts           74
tierA                         15
pushNow                       12
directAccounts                65
channelAccounts                1
nonCountingContextRecords      2
attachedContextRecords         2
unattachedContextRecords       0
```

Required route distribution:

```text
direct_ape                    65
manual_review                  8
cea                            1
```

Account `328` must appear as context beneath parent `269`, account `334` beneath
parent `415`, and neither target may remain top-level. A failed assertion throws
inside the transaction and rolls back both updates.

## Concurrency and identity gates

Apply refuses to run when a pipeline run is active. It verifies:

- sealed-manifest hash;
- explicit `--confirm-hash`;
- database identity;
- complete account-universe fingerprint;
- per-row record hash;
- immutable account-state hash;
- exact two-account approval set.

An already-applied state is handled idempotently only when both relationships and
the complete post-apply workspace agree with the specification.

## Safety boundary

The release contains no schema or migration and does not call a provider, an
LLM, email, C4C or a pipeline. It does not merge or delete an account. Wider
identity cleanup, reclassification, suppression and discovery remain separate
reviewed operations.
