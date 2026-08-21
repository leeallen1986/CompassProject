# Full Potential offline management pack

## Purpose

The 3 September management pack must be generated from a governed evidence and
planning snapshot without depending on a live production deployment.

The offline pack combines:

- the source-controlled 25-account Rental public observation core;
- the source-controlled TS1–TS4 non-counting public application evidence;
- a local, restricted planning JSON file containing current Low/Base/High values;
- optional aggregate current-revenue references;
- explicit readiness and declared-gap settings.

The command performs no database, CRM, provider, pipeline or deployment action.

## Restricted input file

The input file is operationally sensitive because it may contain current
planning values. Keep it outside the public repository and outside any customer
or CRM export.

Required shape:

```json
{
  "rentalPlanning": {
    "planningValueSetRef": "opaque-internal-reference",
    "averageSellingPriceAud": {
      "low": 1000,
      "base": 1000,
      "high": 1000
    },
    "addressableSharePct": {
      "low": 100,
      "base": 100,
      "high": 100
    },
    "planningValueBasis": "blended_portfolio",
    "localisationUpliftStatus": "not_applicable",
    "overrides": []
  },
  "currentRevenueInputs": [],
  "readiness": {
    "expectedCurrentRevenueSegments": ["rental_hire"],
    "planningStatus": "provisional",
    "localisationCostStatus": "tbc",
    "accountReconciliationStatus": "partial",
    "liveDeploymentRequired": false
  },
  "exportOptions": {
    "title": "Oceania Portable Air Full Potential",
    "asOfLabel": "Evidence snapshot date",
    "meetingDateLabel": "3 September 2026"
  },
  "generatedAt": "2026-08-21T00:00:00.000Z",
  "sourcePackRef": "fp-september-review-v1"
}
```

The numeric values shown above are synthetic schema examples, not current
planning values.

### Planning basis

Allowed values:

- `machine_only`
- `locally_deployable_package`
- `blended_portfolio`

### Localisation uplift status

Allowed values:

- `not_applicable`
- `included`
- `excluded_tbc`

A machine-only value cannot claim localisation is included. A locally deployable
package cannot claim that localisation remains excluded/TBC.

### Current revenue

Aggregate current revenue is optional. A row requires:

```json
{
  "buyerSegment": "rental_hire",
  "currentRevenueAud": 0,
  "periodLabel": "rolling 12 months",
  "sourceReference": "opaque-ledger-reference"
}
```

Do not include customer, branch, contract, contact, quotation or daily-rate
detail. When aggregate revenue is unavailable, omit the row. The management pack
shows `Pending`; it does not substitute zero.

## Check-only mode

Validate the restricted input and build all hashes without writing output files:

```bash
pnpm exec tsx scripts/full-potential-meeting-pack.ts \
  --input /secure/path/full-potential-private.json \
  --check-only
```

A successful command returns a bounded JSON summary containing:

- meeting readiness;
- public and restricted record counts;
- counting and non-counting record counts;
- missing current-revenue segments;
- meeting-pack manifest SHA-256.

## Write meeting outputs

```bash
pnpm exec tsx scripts/full-potential-meeting-pack.ts \
  --input /secure/path/full-potential-private.json \
  --output-dir /secure/path/full-potential-meeting-pack
```

Outputs:

- `management-brief.md`
- `management-view.json`
- `management-readiness.json`
- `meeting-pack-manifest.json`
- `headline.csv`
- `buyer-segments.csv`
- `product-cells.csv`
- `confidence.csv`
- `qualification-gaps.csv`
- `data-gaps.csv`

The manifest hashes every output and records zero database connections, database
writes, CRM writes, pipeline invocations, provider calls and live-deployment
dependency.

## Meeting use

Until aggregate Rental economics are supplied, the expected readiness is:

```text
READY_WITH_DECLARED_GAPS
```

The headline Low/Base/High remains available. Current revenue and remaining
potential remain pending for the affected segment. Canonical account
reconciliation controls production import only; it does not block the offline
meeting pack.

## Safety boundary

Do not commit the restricted input or generated management pack to the public
repository. Do not use this command to create production Full Potential models.
Production draft loading remains a separate hashed manifest and approval gate.
