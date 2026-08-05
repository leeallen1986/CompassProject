# Full Potential Rental Hire relationship reconciliation

## Purpose

This utility performs the first bounded account-relationship canary after the
Australian Rental Hire census and workspace controls were verified.

It preserves two strategic planning records while removing their duplicate
contribution to the commercial universe:

- account `328`, **Coates Hire National Fleet**, becomes non-counting context
  beneath account `269`, **Coates Hire**;
- account `334`, **Onsite Rental Strategic Channel**, becomes non-counting
  context beneath account `415`, **Onsite Rental Group**.

No account is renamed, deleted or merged. The business meaning is
`strategic_context`. The existing schema-safe relationship value persisted by
the utility is `service_unit`; the semantic purpose remains explicit in every
manifest and audit artifact.

## Safety sequence

```text
read-only generation
→ operator review of exactly two rows
→ change only approved=false to approved=true
→ read-only seal against unchanged database fingerprint
→ record exact manifest hash
→ transactional apply with exact confirmation hash
→ immutable-row and workspace assertions
```

The command does not accept arbitrary account IDs or relationship proposals.
The first canary is permanently restricted to `328` and `334`.

## Generate

```bash
pnpm exec tsx \
  server/scripts/fullPotentialRentalRelationshipReconcile.ts \
  --output-dir artifacts/rental-relationship/<utc-run>
```

Generation performs database reads only and creates:

- `rental-relationship-manifest.draft.json`;
- `rental-relationship-manifest.csv`;
- `rental-relationship-summary.json`.

The draft contains:

```text
mode = draft
rowCount = 2
approvedRows = 0
automaticWriteAllowed = false
manifestHash = null
```

## Review and seal

The operator may change only the two row-level values:

```text
approved = false → true
```

Then run:

```bash
pnpm exec tsx \
  server/scripts/fullPotentialRentalRelationshipReconcile.ts \
  --seal \
  --manifest <reviewed-draft.json> \
  --output-dir <sealed-output-dir>
```

Sealing performs no production write. It fails if the database identity or
fingerprint changed after generation. The sealed output contains an exact
SHA-256 `manifestHash`.

## Apply

```bash
pnpm exec tsx \
  server/scripts/fullPotentialRentalRelationshipReconcile.ts \
  --apply \
  --manifest <sealed-manifest.json> \
  --confirm-hash <manifestHash> \
  --output-dir <apply-output-dir>
```

Apply may update only these fields on accounts `328` and `334`:

```text
parentAccountId
relationshipType
countsTowardPotential
updatedAt
```

The transaction requires:

- no active pipeline run;
- the exact sealed manifest and confirmation hash;
- unchanged database identity and fingerprint;
- exact source identities and before states;
- active Australian counting parents;
- no existing parent or merge relationship on either child;
- unchanged immutable fields after update;
- the exact projected Australian Rental workspace result.

Any failed assertion rolls back both account updates.

## Expected first-canary workspace delta

```text
Australian Rental rows                  76 → 76
Top-level counting accounts             76 → 74
Non-counting context records             0 → 2
Attached context records                 0 → 2
Unattached context records               0 → 0
Tier A                                   17 → 15
Push Now                                 12 → 12
direct_ape                               66 → 65
manual_review                             8 → 8
cea                                       2 → 1
```

## Prohibited effects

The utility does not change:

- canonical or display names;
- stable keys or row classes;
- record status or merge targets;
- route, owner, priority or push decision;
- current revenue, Full Potential, target or remaining potential;
- aliases, actions, signals or evidence;
- contacts, contact-project links or candidate slates;
- pipelines, provider logs, email or outreach;
- schema or migrations.
