# Australian Rental Hire retained-child batch 2

## Purpose

This release controls the second retained-child relationship batch in the
Australian Rental Hire Full Potential universe. It covers the three legitimate
children that remained after PR #78 linked Coates National Fleet and Onsite
Strategic Channel.

The operation adds reviewed parent links while preserving every child as an
independently counting commercial engagement account.

## Fixed batch

| Child account | Reviewed parent | Identity-review basis |
|---|---|---|
| `278` — Coates Industrial Solutions | `269` — Coates Hire | Industrial/specialist division in the same group, with a separate compressed-air buying authority |
| `332` — Kennards Hire channel track | `272` — Kennards Hire | Separate channel-management engagement track for the national Kennards account |
| `352` — Tutt Bryant Equipment | `275` — Tutt Bryant Hire | Separate legal entity and buying authority in the Tutt Bryant group; route remains manual review |

For each child, the only authorised business-field changes are:

```text
parentAccountId: null → reviewed parent ID
relationshipType: standalone → strategic_context
```

`countsTowardPotential` remains `true` and is included in the immutable-state
hash. Database-managed `updatedAt` may change.

No route, owner, priority, push decision, financial value, record status,
identity field, alias, action, signal or evidence state may change.

## Why account 352 is included

Tutt Bryant Equipment is not merged into Tutt Bryant Hire. The identity review
records it as a high-confidence legitimate child and separate buying authority.
The parent link captures group structure only. Its existing `manual_review`
route, Tier C priority and `channel_view` decision are explicit source-state
gates and remain unchanged.

## Operating sequence

```text
read-only generate
→ review all three rows
→ change only approved=false to approved=true
→ seal against an unchanged fingerprint
→ record the exact manifest hash
→ controlled transactional apply
→ certify all three links and unchanged workspace totals
```

Generation is the default and performs no database write. Sealing is a local
artifact operation. Apply requires both the sealed file and its exact
`manifestHash`.

Partial approval is prohibited: the approved ID set must be exactly
`[278,332,352]`.

## PR #78 continuity gate

Before generation, sealing and apply, the utility proves the earlier retained
children remain intact:

```text
328 → 269, strategic_context, countsTowardPotential=true
334 → 415, strategic_context, countsTowardPotential=true
```

Parents `269` and `415` must remain active, counting and unmerged. A continuity
failure blocks the second batch.

## Exact source-state gates

All children and parents must be Australian, active, counting and unmerged.
The children must be either in the exact reviewed standalone pre-state or the
exact linked post-state.

Additional source-lock gates are:

| ID | rowClass | route | priority | push decision |
|---:|---|---|---|---|
| 278 | `account` | `direct_ape` | `tier_a` | `push_now` |
| 332 | `channel_managed` | `direct_ape` | `tier_a` | `channel_view` |
| 352 | `account` | `manual_review` | `tier_c` | `channel_view` |

Any drift produces `manual_review`; the utility does not silently normalise it.

## Workspace invariants

Because all three children remain counting accounts, the Australian Rental
workspace must remain unchanged before and after linking:

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

All three children and all three parents remain top-level sales-workspace
accounts.

## Transactional apply

Apply refuses to run while a pipeline is active and verifies:

- schema version and batch ID;
- sealed-manifest hash;
- explicit `--confirm-hash`;
- database identity;
- complete account/action/signal fingerprint;
- exact three-account approval set;
- per-row record hashes;
- immutable child and parent state;
- PR #78 continuity;
- the unchanged 76-account workspace.

The transaction locks child IDs `278`, `332`, `352` and parent IDs `269`, `272`,
`275`, rechecks the fingerprint, applies all three links, and rebuilds the live
Rental workspace before commit. Any failed assertion rolls back the complete
batch.

## Safety boundary

This release includes no schema, migration, provider, LLM, email, C4C or
pipeline operation. It does not merge, suppress, rename or reclassify an
account. Wider duplicate cleanup and external discovery remain separate
controller-owned operations.
