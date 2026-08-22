# Full Potential offline management pack

## Purpose

The 3 September management pack must be generated from a governed evidence and
planning snapshot without depending on a live production deployment.

The offline pack combines:

- the source-controlled 24-account addressable Rental public observation core;
- one source-controlled non-counting Rental competitor/channel market-context
  record;
- the source-controlled TS1–TS4 non-counting public application evidence;
- named TS2 surface-mining and TS3 underground-mining qualification universes
  that remain non-counting until a distinct rugged/relocatable Portable Air
  requirement is proven;
- optional specialist-rental TS2/TS4 buyer pools when a restricted adoption plan
  is supplied;
- a local restricted planning JSON file containing current Low/Base/High values;
- optional aggregate current-revenue references;
- explicit readiness and declared-gap settings.

The non-counting Rental context remains visible for market understanding but has
no commercial pool and cannot contribute to the headline potential.

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

## Rental named-buyer universe

The addressable buyer core contains 24 public-evidence records. Its current P-band
mix produces a **476 / 724 / 1,015 Low / Base / High inferred relevant-unit
universe**.

These bands are modelling inputs, not customer-provided fleet counts. Current
monetary values are calculated only from the restricted private planning input.
The separate competitor/channel context record carries no scenario and no
monetary potential.

## Named qualification universes

The meeting pack always includes the public named-buyer qualification contexts
as non-counting evidence. These records answer **where should we qualify the
Tough Stationary application next?** rather than asserting a current fleet,
pipeline or purchase intention.

### TS2 surface-mining classes

- `S1` — early qualification: 0 / 1 / 1 possible three-year adoption positions;
- `S2` — material qualification: 1 / 1 / 2 possible positions;
- `S3` — priority qualification: 1 / 2 / 3 possible positions.

The first named TS2 surface universe contains nine public buyer contexts. Its
current class mix produces a **9 / 13 / 22 Low / Base / High non-monetary
position sensitivity**.

### TS3 underground classes

- `U1` — smaller underground context: 1 / 1 / 2 possible positions;
- `U2` — significant underground mine: 1 / 2 / 3 possible positions;
- `U3` — deep, multi-front or multi-mine priority context: 2 / 3 / 4 possible
  positions.

The first named TS3 underground qualification core contains ten public
buyer/site contexts. Its current class mix produces a **16 / 26 / 36 Low / Base
/ High non-monetary position sensitivity**.

These position sensitivities are not installed-base claims and are not monetised
merely because a buyer has an S- or U-class. A buyer-counting pool can be created
only after public evidence supports a distinct rugged, exposed or relocatable
compressed-air application and the stationary-compressor-room / central
reticulation exclusion has been applied.

For TS3, qualification must also distinguish a new machine from an existing
package overhaul or life-extension path.

The management brief and `qualification-universe.csv` show named contexts,
product cell, class, qualification status and public source without adding value
to the headline.

## Optional specialist-rental Tough Stationary planning

When `toughStationaryPlanning` is absent, the TS1–TS4 public application evidence,
TS2 surface qualification universe and TS3 underground qualification universe
still appear in the pack but remain wholly non-counting.

Supplying a restricted adoption plan adds only the named specialist-rental
electric buyer pools and the separately labelled direct-project allowance:

```json
{
  "toughStationaryPlanning": {
    "planningValueSetRef": "opaque-electric-reference",
    "adoptionPositions": {
      "low": 1,
      "base": 2,
      "high": 3
    },
    "averageSellingPriceAud": {
      "low": 1800,
      "base": 2000,
      "high": 2200
    },
    "addressableSharePct": {
      "low": 50,
      "base": 60,
      "high": 70
    },
    "planningValueBasis": "machine_only",
    "localisationUpliftStatus": "excluded_tbc",
    "overrides": [
      {
        "recordKey": "allowance:ts4:direct-powered-projects",
        "adoptionPositions": {
          "low": 1,
          "base": 4,
          "high": 8
        }
      }
    ]
  }
}
```

These numbers are synthetic schema examples. The real restricted file may use
different assumptions by record through `overrides`.

The named TS2 and TS4 specialist-rental pools are distinct from the conventional
Rental replacement pool. The direct-project allowance is displayed separately
under Unobserved Allowance and is not eligible for production account import
until replaced by named, reconciled buyers.

The TS2 surface and TS3 underground qualification universes are deliberately not
part of this restricted monetary plan until a distinct buyer application has
passed the qualification gate. There is no generic `directMiningPlanning`
shortcut that monetises mine operating context alone.

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
- whether specialist-rental Tough Stationary planning was included;
- public and restricted record counts;
- counting and non-counting record counts;
- named qualification-context count;
- TS2 and TS3 non-monetary position universes;
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
- `qualification-universe.csv`
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
