# Portable Air Full Potential — Signal Import Guide

This guide supports the admin signal import workflow in the Portable Air Full Potential module.

## Template

Use the CSV template at:

`/templates/portable-air-signals-template.csv`

The template contains fictional examples only. Replace the sample rows before importing.

## Required field

Only `signalTitle` is strictly required by the importer.

The UI template includes the wider recommended field set so signals arrive with enough context to be useful.

## Recommended columns

| Column | Purpose |
|---|---|
| `signalTitle` | Concise description of the market, project, fleet or customer signal. |
| `signalSummary` | Supporting detail explaining why the signal matters. |
| `signalType` | Portable Air signal category. |
| `sourceName` | Publication, customer source, tender portal or internal source name. |
| `sourceUrl` | Supporting public URL when available. |
| `state` | Australian state or relevant territory. |
| `signalDate` | Date of the signal. ISO format `YYYY-MM-DD` is preferred. |
| `confidenceLevel` | Confidence in the signal quality. |
| `urgency` | Commercial urgency. |
| `suggestedAction` | Recommended next step for the account owner. |
| `status` | Initial review state. Usually `new`. |

## Account-linking columns

The importer resolves the signal to an existing Full Potential account in this order:

1. `accountId`
2. `stableKey`
3. `canonicalName`
4. `accountName`
5. `displayName`
6. `aliasName`
7. Leave the signal unlinked

A signal does not fail merely because no account match is found. Unlinked signals are allowed and can still surface through the existing matched-signal workflow where the title contains an account name.

Avoid filling multiple account-linking columns with conflicting values. Use the strongest identifier available.

## Accepted values

### `signalType`

- `drilling_campaign`
- `awarded_project`
- `live_tender`
- `shutdown_turnaround`
- `pipeline_commissioning`
- `mine_site_activity`
- `civil_application`
- `rental_fleet_signal`
- `competitor_channel_signal`
- `installed_base_signal`
- `contact_discovery_signal`
- `manual`
- `other`

The importer also recognises common natural-language variants and maps them to these values.

### `confidenceLevel`

- `high`
- `medium`
- `low`
- `unknown`

Blank or unsupported values default to `unknown`.

### `urgency`

- `hot`
- `warm`
- `cold`
- `unknown`

Blank or unsupported values default to `unknown`.

### `status`

- `new`
- `reviewed`
- `promoted`
- `dismissed`
- `archived`

Blank or unsupported values default to `new`.

## Dates

Preferred format:

`YYYY-MM-DD`

The importer also accepts normal date strings and Excel serial dates. Invalid dates are returned as row errors during dry-run.

## Duplicate rule

The importer builds a deterministic duplicate key using:

- resolved `accountId`, or `unlinked`
- normalised `signalTitle`
- `sourceUrl`, otherwise `sourceName`, otherwise no source
- `signalDate`, otherwise no date

Within one upload, the first valid duplicate wins. Later duplicates are skipped. Signals already present in the database are also skipped rather than updated.

## Import workflow

1. Download and complete the template.
2. Open Portable Air Full Potential.
3. Select **Import Signals**.
4. Upload the CSV/XLSX file.
5. Run **dry-run**.
6. Review linked accounts, unlinked signals, duplicates and row errors.
7. Correct the source file if errors are present.
8. Commit only after a clean dry-run.

The import does not create Full Potential actions automatically. Signals remain evidence until a user deliberately promotes one to an action.

## Scope guardrails

- No C4C write-back.
- No automatic enrichment.
- No automatic action creation.
- No customer workbook or production data should be committed to the repository.
