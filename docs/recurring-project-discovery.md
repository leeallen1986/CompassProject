# Recurring project snapshot and discovery review

## Purpose

Issue #135 is the evidence-gathering phase after the migration-neutral recurring
programme and occurrence contract merged in PR #134.

The phase answers a question that must be resolved before a physical schema or
production backfill is authorised:

> Which existing projects show defensible evidence of repeated commercial
> cycles, same-cycle duplicate sources, materially different packages, or
> insufficient evidence?

The output is a **review package**, not an import package. It creates no
programme, occurrence, project link, sales action, Full Potential value or CRM
record.

## Why discovery precedes migration

The repository now has a versioned logical contract for recurring programmes and
occurrences, but the production project population has not yet been measured
against that contract. Generating and applying a migration first would create a
false impression that the existing project history is ready for backfill.

This phase therefore:

1. captures a bounded, non-contact snapshot from the current `projects` table;
2. derives deterministic candidate groups offline;
3. preserves every original project ID and evidence field;
4. forces manual review of programme, cycle, duplicate and package boundaries;
5. leaves the database, weekly sales page and Full Potential model unchanged.

## Production read-only boundary

### SELECT-only account is mandatory

The snapshot command accepts only a database account whose effective grants are
limited to:

- `USAGE` on `*.*`; and
- `SELECT` on the selected database or its `projects` table.

The command runs `SHOW GRANTS FOR CURRENT_USER()` before reading project rows and
fails closed if it detects write, DDL, administration, role or grant-option
privileges. Raw grant text is never written to the evidence package; only a
SHA-256 profile is retained.

### Do not rely on unqualified TiDB `START TRANSACTION READ ONLY`

TiDB documents the unqualified `START TRANSACTION READ ONLY` form as MySQL
compatibility syntax that can still permit writes. The snapshot tool therefore
does not treat a transaction keyword as its safety control. Safety comes from:

- a demonstrably SELECT-only account;
- five fixed `SELECT` / `SHOW` statements;
- bound parameters only;
- `multipleStatements: false` in the shared database URL parser;
- an explicit ID range and hard maximum-row ceiling;
- no import of the application database service;
- no mutation or apply command in this release.

Reference:
<https://docs.pingcap.com/tidb/stable/transaction-overview/#start-transaction-read-only>

## Snapshot scope

The snapshot includes only project-level fields needed to assess recurring
identity, cycle, package, duplicate and evidence boundaries:

- project and report IDs;
- project key, name, owner and location;
- sector, product lane, stage and lifecycle fields;
- tender number, closing date, timeline and completion text;
- bounded public source labels, public URLs and source dates;
- existing duplicate-cluster and merged-project references;
- geography and project activity timestamps.

It deliberately excludes:

- contacts and stakeholder records;
- email addresses and phone numbers;
- CRM identifiers and CRM payloads;
- outreach drafts or send logs;
- user authentication data;
- Full Potential financial values.

Public URLs are normalised to `http` / `https`, reject embedded credentials and
have query strings and fragments removed before export.

## Commands

Run from the exact reviewed source checkout. The output directory must not exist,
must be outside the repository and should be created beneath a private,
operator-owned parent directory.

### 1. Create the bounded snapshot

```bash
export DATABASE_URL='mysql://SELECT_ONLY_USER:REDACTED@HOST:3306/DATABASE'

pnpm exec tsx scripts/recurring-project-snapshot.mjs \
  --output-dir /secure/operator-owned/issue135-snapshot \
  --source-sha "$(git rev-parse HEAD)" \
  --from-id 1 \
  --to-id 50000 \
  --max-rows 20000
```

Required controls:

- exact 40-character source SHA;
- positive `from-id` and `to-id` with `to-id >= from-id`;
- explicit `max-rows` no greater than 20,000;
- TLS-verifying `mysql://` connection;
- SELECT-only grant profile.

The `RECURRING_SNAPSHOT_ALLOW_INSECURE_LOCALHOST=1` override exists only for the
synthetic CI database and rejects non-local hosts. It must not be used for a
production snapshot.

### 2. Generate the offline review package

```bash
pnpm exec tsx scripts/recurring-project-backfill-preview.ts \
  --snapshot /secure/operator-owned/issue135-snapshot/recurring-project-snapshot.json \
  --output-dir /secure/operator-owned/issue135-snapshot
```

Optional deterministic thresholds:

```text
--minimum-group-size 2
--minimum-distinct-cycles 2
--maximum-projects-per-group 25
```

The preview command opens no database connection.

### 3. Verify the review package

```bash
cd /secure/operator-owned/issue135-snapshot
sha256sum --check checksums.sha256
```

The snapshot manifest's `generatedAt` timestamp is run metadata. Candidate
classification and review outputs are deterministic for the same snapshot and
configuration.

## Output files

| File | Purpose |
|---|---|
| `recurring-project-snapshot.json` | Canonical bounded project projection |
| `recurring-project-snapshot-manifest.json` | Source, query, database identity, grant-profile and safety attestation |
| `recurring-project-candidate-groups.json` | Programme-level review candidates and reasons |
| `recurring-project-candidate-projects.csv` | Reviewable original project IDs, cycles, packages and fingerprints |
| `recurring-project-review-summary.json` | Reconciliation totals, classifications and zero-side-effect declaration |
| `checksums.sha256` | SHA-256 ledger for the five evidence files above |

## Candidate classifications

### `likely_recurring_programme`

The same owner, full site/location and programme core appear in at least two
distinct explicit cycles. This is a candidate for programme/occurrence review,
not an automatic backfill instruction.

### `same_cycle_duplicate_review`

Several records resolve to the same observed cycle or share a governed duplicate
cluster. They may be supporting sources or historic duplicate rows. They must not
create a second occurrence solely because the source repeated.

### `materially_different_package_review`

The same programme identity and cycle contain different package, phase, stage,
lot, train or area keys. They may require separate occurrences. The preview does
not decide that boundary automatically.

### `insufficient_evidence`

Records appear similar but do not expose a reliable distinct-cycle or same-cycle
boundary, or the owner/location identity is too generic. The system does not
invent cadence or recurrence from similarity alone.

## Review rules

For every candidate group, reviewers must confirm:

1. the durable buyer/site/programme identity;
2. whether each project represents a separate cycle or a repeated source;
3. whether package differences are commercially material;
4. which project should be canonical for a reviewed occurrence;
5. whether historic duplicate/source rows remain linked but preserved;
6. whether the account linkage is canonical or an approved candidate;
7. that recurrence remains a non-counting application overlay with zero separate
   Full Potential monetary value.

No candidate is complete for backfill apply. The summary always states:

```text
manualReviewRequired = true
completeForBackfillApply = false
```

## Explicit zero-side-effect contract

The snapshot and preview perform zero:

- database write statements;
- project date changes, merges or deletions;
- recurring programme, occurrence or link creation;
- project or Full Potential action creation;
- Full Potential monetary changes;
- CRM/C4C mutations;
- provider calls;
- pipeline invocations;
- deployments.

The current `This Week` page and sales workflow are unchanged.

## Follow-on gate

A separate physical-schema migration issue may be opened only after:

1. an exact-source production snapshot is completed using a SELECT-only account;
2. all review-package checksums verify;
3. candidate programme, cycle, package and duplicate boundaries are reviewed;
4. false-positive and insufficient-evidence groups are explicitly excluded;
5. the proposed backfill manifest is reconciled to the original project IDs;
6. rollback and quiet-window requirements are agreed.

That migration must be generated against the then-current migration baseline and
must not modify frozen historical migration artifacts.
