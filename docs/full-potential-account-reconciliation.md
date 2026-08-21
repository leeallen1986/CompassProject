# Full Potential read-only account reconciliation

## Purpose

Before a public-evidence Full Potential pack can propose draft model rows against
production accounts, every monetary buyer identity must resolve to the correct
active Australian counting account.

This gate is read-only. It does not update account names, relationships, routes,
financial values, CRM, pipeline or evidence tables.

The offline reconciliation tool accepts a bounded account/alias snapshot and
matches it to the source-controlled Rental buyer core. The distinct named Tough
Stationary specialist-rental pools can be included using a command-line flag.

## Production snapshot boundary

The snapshot may contain only these Full Potential account fields:

```text
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
```

Alias rows may contain only:

```text
accountId
aliasName
aliasType
confidenceLevel
```

Do not include:

- contacts, email addresses or phone numbers;
- CRM/C4C notes or opportunity history;
- current or historic quotations;
- customer conversations or purchasing intent;
- installed-base notes;
- current supplier notes;
- account financial values;
- actions or signals;
- raw workbook JSON;
- credentials, environment values or database connection details.

The snapshot is an identity-and-relationship export only.

## Input JSON

```json
{
  "snapshotRef": "fp-prod-account-snapshot-opaque-ref",
  "capturedAt": "2026-08-21T00:00:00.000Z",
  "accounts": [
    {
      "id": 101,
      "stableKey": "example|account|au|wa|direct_ape",
      "canonicalName": "Example Rental Pty Ltd",
      "displayName": "Example Rental",
      "parentGroup": null,
      "rowClass": "account",
      "relationshipType": "standalone",
      "recordStatus": "active",
      "countsTowardPotential": true,
      "mergedIntoAccountId": null,
      "country": "AU",
      "routeToMarket": "direct_ape"
    }
  ],
  "aliases": [
    {
      "accountId": 101,
      "aliasName": "Example Rental",
      "aliasType": "trading_name",
      "confidenceLevel": "high"
    }
  ]
}
```

The example values are synthetic.

## Matching rules

The resolver considers only:

- `rowClass=account`;
- records that count toward Full Potential;
- active or under-review records that are not merged/parked/excluded;
- records with no `mergedIntoAccountId`;
- `country=AU`;
- route not equal to `exclude`.

Identity evidence can come from:

- canonical name;
- display name;
- parent-group name;
- retained aliases.

Exact canonical/display-name matches score highest. Exact aliases are accepted
with slightly lower confidence. Weak name containment is never auto-promoted to
a production target; it remains ambiguous for review.

Several distinct commercial pools may correctly share one canonical buyer
account, for example conventional Rental replacement plus an incremental TS2 or
TS4 electric-adoption pool. The gate therefore reconciles **unique buyer
identity**, not one commercial pool per account.

Two distinct buyer identities must not silently collapse onto one canonical
account.

## Check-only mode

```bash
pnpm exec tsx scripts/full-potential-account-reconciliation.ts \
  --input /secure/path/full-potential-account-snapshot.json \
  --check-only
```

Include the distinct named Tough Stationary specialist-rental pools:

```bash
pnpm exec tsx scripts/full-potential-account-reconciliation.ts \
  --input /secure/path/full-potential-account-snapshot.json \
  --include-tough-stationary \
  --check-only
```

The bounded stdout summary reports counts only. It does not print the full
production account snapshot.

Use `--require-complete` when the result must fail closed for a later draft
import gate:

```bash
pnpm exec tsx scripts/full-potential-account-reconciliation.ts \
  --input /secure/path/full-potential-account-snapshot.json \
  --include-tough-stationary \
  --check-only \
  --require-complete
```

An incomplete reconciliation exits non-zero in this mode.

## Review outputs

To write local review files:

```bash
pnpm exec tsx scripts/full-potential-account-reconciliation.ts \
  --input /secure/path/full-potential-account-snapshot.json \
  --include-tough-stationary \
  --output-dir /secure/path/full-potential-reconciliation
```

Outputs:

- `reconciliation-report.json` — hashed full result and safety invariants;
- `account-targets.json` — canonical account targets suitable for a later draft
  import manifest;
- `reconciliation.csv` — review ledger of matched, unmatched and ambiguous rows.

The report records zero database connections, database writes, account
mutations, CRM writes, provider calls and pipeline invocations by the offline
tool itself.

## Acceptance

Production draft import remains blocked until:

- every unique monetary buyer identity is matched;
- no buyer identity is ambiguous;
- no distinct buyer identities collapse onto one account;
- the reconciliation report SHA-256 verifies;
- the snapshot remains a read-only identity/relationship snapshot;
- a separately reviewed restricted planning pack exists.

Reconciliation completion does not approve any Full Potential financial value.
