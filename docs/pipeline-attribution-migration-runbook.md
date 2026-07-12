# Sprint 2A pipeline-attribution migration runbook

This migration changes the opportunity spine. It must be generated and reviewed
from the branch schema, applied first to a non-production database, and deployed
behind a safety checkpoint.

## Generate the committed migration

From the repository root after running `pr51_hardening.py`:

```bash
pnpm exec drizzle-kit generate --name sprint2a_pipeline_attribution
```

The command must create:

- `drizzle/0089_sprint2a_pipeline_attribution.sql`
- `drizzle/meta/0089_snapshot.json`
- the matching journal entry

Do not hand-create the journal or omit the snapshot.

## Production preflight

Run read-only checks and save the results:

```sql
SELECT COUNT(*) AS claim_count FROM pipelineClaims;
SELECT COUNT(*) AS activity_count FROM pipelineActivity;

SELECT
  COUNT(*) AS project_claims_missing_origin
FROM pipelineClaims
WHERE projectId IS NULL OR reportId IS NULL;

SELECT status, COUNT(*)
FROM pipelineClaims
GROUP BY status
ORDER BY status;

SELECT COUNT(*) AS outreach_count
FROM outreachEmails;
```

Expected before Sprint 2A is applied:

- all historic claims have non-null `projectId` and `reportId`;
- statuses are from the legacy six-value set;
- IDs, statuses, and activity rows are exported for reconciliation.

## Apply

Use the committed migration only:

```bash
pnpm exec drizzle-kit migrate
```

Do not run an unreviewed `drizzle-kit generate` against production.

## Postflight

```sql
SELECT COUNT(*) AS claim_count FROM pipelineClaims;
SELECT COUNT(*) AS activity_count FROM pipelineActivity;

SELECT sourceType, COUNT(*)
FROM pipelineClaims
GROUP BY sourceType;

SELECT COUNT(*) AS bad_legacy_origin
FROM pipelineClaims
WHERE sourceType = 'project'
  AND (projectId IS NULL OR reportId IS NULL);

SELECT COUNT(*) AS unexpected_fp_rows
FROM pipelineClaims
WHERE sourceType = 'full_potential';

SHOW INDEX FROM pipelineClaims
WHERE Key_name = 'pipelineClaims_openDedupeKey_unique';
```

Required immediately after migration and before any pilot write:

- claim and activity counts equal the preflight counts;
- every historic claim has `sourceType = 'project'`;
- no historic project/report linkage changed;
- no Full Potential claim exists yet;
- the unique open-dedupe index exists.

## Recovery and rollback

A structural rollback is safe only before source-neutral claims or new statuses
are used. Once Full Potential claims exist, first export them and their activity
and outreach records. Do not make `projectId`/`reportId` non-null while any claim
has a null value.

Before narrowing the status enum, map or remove rows using
`qualified`, `deferred`, or `not_relevant`. Never drop attribution columns before
exporting their data.

Prefer forward recovery from the pre-deployment checkpoint over destructive
rollback after commercial records have been created.
