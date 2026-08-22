# Full Potential lookalike identity reconciliation

## Purpose

The public lookalike scorer identifies companies that resemble governed Full
Potential seed accounts. Similarity is not proof that a company is new, nor is
it permission to create a Full Potential account.

This offline gate reconciles the first bounded lookalike tranche against:

1. the previously captured private Australian Full Potential account/alias
   snapshot; and
2. the separately approved account-governance delta applied after that snapshot.

It performs no production database connection and does not depend on the
separate Issue #139 SELECT-only account.

## Private inputs

### Base account snapshot

The base snapshot may contain only:

```text
snapshotRef
capturedAt
accounts[]
  id
  stableKey
  canonicalName
  displayName
  parentGroup
  rowClass
  relationshipType
  recordStatus
  countsTowardPotential
  mergedIntoAccountId
  country
  routeToMarket
aliases[]
  accountId
  aliasName
  aliasType
  confidenceLevel
```

It must not contain contacts, email addresses, phone numbers, CRM/C4C payloads,
financial values, current suppliers, installed-base notes, quotations, actions,
signals, evidence or models.

### Governance delta

The governance delta uses the same bounded account and alias fields:

```json
{
  "version": 1,
  "deltaRef": "opaque-governance-reference",
  "appliedAt": "2026-08-22T00:00:00.000Z",
  "baseSnapshotSha256": "64-hex-sha256",
  "accounts": [],
  "aliases": []
}
```

`accounts` contains complete replacement rows for changed existing account IDs
and complete rows for approved new IDs. `aliases` contains approved alias
additions or replacements.

The tool fails closed when:

- the delta does not reference the exact base snapshot SHA-256;
- the delta is empty;
- an account ID or stable key collides;
- an alias points to a missing governed account;
- any row contains a field outside the bounded identity contract.

The private snapshot and delta must not be committed or uploaded to the public
repository.

## Identity dispositions

Each lookalike receives exactly one disposition:

### `existing_account`

One exact canonical, display-name or governed alias identity resolves to a
normal account row. The generated review input sets:

```text
identityStatus = existing_account
reviewState = pending_review
owner = null
currentSignalEvidence = unreviewed / zero
```

The governed route may be carried forward, but this does not approve the
candidate or create a weekly action.

### `existing_market_context`

The exact identity already exists as dealer, competitor, reseller, site context,
strategic context, excluded route or another non-promotable row. The generated
review input rejects promotion and uses route `exclude`.

### `new_identity`

No governed canonical, display-name or alias identity matches. The result remains:

```text
identityStatus = new_identity
reviewState = pending_review
route = manual_review
owner = null
countsTowardPotential = false
monetaryImpactAud = 0
```

A new-identity result is a candidate for human review, not an account-creation
authorisation.

### `ambiguous_identity`

Weak containment, multiple equal top matches or another non-exact result remains
manual review. The tool never promotes weak name similarity into an account
match.

### `excluded_market_participant`

Source-controlled dealer, competitor, reseller and context controls remain
excluded and require no candidate account.

## Weekly-sales boundary

The generated `lookalike-review-input.json` may change identity status and carry
a governed route only. It cannot:

- set `approved_for_qualification`;
- assign an owner;
- add reviewed market signals;
- add reviewed recurring-programme evidence;
- create a durable action.

Therefore every output remains:

```text
weeklyRecommendationEligible = false
durableActionCreated = false
countsTowardPotential = false
monetaryImpactAud = 0
```

## Command

Run from an exact reviewed source checkout. The output directory must be new,
private and outside the repository.

```bash
umask 077
mkdir -m 700 /secure/operator-owned/lookalike-identity-parent

pnpm exec tsx scripts/full-potential-lookalike-identity-reconciliation.ts \
  --snapshot /secure/operator-owned/full-potential-account-snapshot.json \
  --governance-delta /secure/operator-owned/full-potential-governance-delta.json \
  --output-dir /secure/operator-owned/lookalike-identity-parent/review \
  --source-sha <exact-reviewed-40-hex-sha>
```

## Outputs

- `lookalike-identity-resolution.json`
- `lookalike-identity-resolution.csv`
- `lookalike-review-input.json`
- `governed-snapshot-summary.json`
- `checksums.sha256`

The report and governed-snapshot summary retain:

- exact source SHA;
- base snapshot SHA-256;
- governance-delta SHA-256;
- governed identity-snapshot SHA-256;
- before/after account and alias counts;
- created and replaced account counts;
- identity-disposition counts;
- zero-side-effect counters.

## Next review step

After human identity review, the generated review input may be passed into the
existing lookalike preview command to produce a ranked review package. The
identity tool itself never sets qualification approval or weekly eligibility.

Candidate-account creation, route/owner approval, market-signal activation and
weekly-page integration remain separate approval gates.
