# Full Potential governance-delta recovery

## Purpose

The original private Issue #130 governance-delta JSON is no longer available.
The canonical account/alias snapshot and the complete, hash-locked changed-row
audit package remain available.

Issue #145 adds a deterministic offline recovery tool that derives a **new
recovered delta** from those retained audit artifacts. It never claims that the
missing original file was recovered.

The recovered delta exists only to let the merged Issue #143 identity tool
materialise the already-applied governed identity state without reconnecting to
production.

## Fixed private lineage

The source profile accepts only the retained package with these controls:

- base snapshot raw SHA-256:
  `34a3e1242542dcb9c9ced913638ea00b306a0f2534c85e8da2c31aa560c0dd24`;
- governance source SHA:
  `9ecc06561ad6d081ee2f6f721d4c74b6b8d2b98a`;
- approved package SHA-256:
  `125e010edb5b5237731369e7caae270f927fbfd5f5f1819386347fef7597efb8`;
- changed-row before-manifest SHA-256:
  `29150bb32a5a06ebaae5db6c7f21d14334a00afdb94e93f696a6a7e613f893c2`;
- changed-row after-manifest SHA-256:
  `d8e195adcd51e703ab8c15b2607a7b00ea707e52f13544fd4dc7d909b2e6a163`.

Every audit file is independently hash-locked in source. A single byte change
blocks recovery.

## Raw-file hash versus canonical-object hash

The base snapshot's raw file SHA-256 is not used as the Issue #143
`baseSnapshotSha256` value.

Issue #143 hashes the parsed JSON object using deterministic sorted-object
canonicalisation. The recovery report therefore records both:

- `baseSnapshotRawSha256` — exact private file bytes; and
- `baseSnapshotCanonicalSha256` — the parsed object under the Issue #143 hash
  contract.

The recovered delta carries the canonical-object hash.

## Audit transformation

The account audit CSV contains governance and audit columns beyond the bounded
Issue #143 identity contract. The recovery tool copies only:

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

`parentGroup` is derived from `parentAccountId` against the governed account set.
Missing or self-referencing parent targets fail closed.

The alias audit CSV is reduced to:

```text
accountId
aliasName
aliasType
confidenceLevel
```

The audit-only `source` field is not copied.

Owner, channel, CRM, priority, push-decision, workbook and financial-state fields
never enter the recovered delta.

## Required structural result

Recovery succeeds only when the retained audit proves:

- 16 account creations;
- one account replacement;
- zero account deletions;
- three alias additions;
- zero alias replacements;
- zero alias deletions;
- zero orphan alias targets after numeric ID normalisation;
- zero missing parent targets;
- zero financial, CRM/C4C or provider/pipeline side effects;
- null financial values on created account/context records.

The earlier metadata-only alias check reported `false`. Issue #145 does not waive
that result. It re-runs the check after parsing every ID as a positive integer and
blocks if even one alias target remains absent.

## Timestamp boundary

The retained package does not contain the exact transaction timestamp.

For this recovery only, the controller approves the retained `apply-summary.json`
file timestamp:

```text
2026-08-22T00:51:36.712Z
```

This is a post-apply evidence timestamp used to provide deterministic
`appliedAt` materialisation. It is not represented as the exact transaction
time, and the recovery report records `exactTransactionTimeClaimed=false`.

## Private check-only run

Use the exact merged Issue #145 source SHA after review and merge:

```bash
umask 077

pnpm exec tsx scripts/full-potential-governance-delta-recovery.ts \
  --snapshot /home/ubuntu/issue130-secure/full-potential-account-snapshot.json \
  --audit-dir /home/ubuntu/issue130-governance-audit \
  --source-sha <EXACT_MERGED_SHA> \
  --retained-post-apply-evidence-at 2026-08-22T00:51:36.712Z \
  --check-only
```

The bounded summary contains hashes, counts and safety state only. It does not
print account rows, aliases, names or IDs.

## Private output run

The output parent must already exist, be private and be outside the Git
repository. The output directory itself must not already exist.

```bash
umask 077
mkdir -p -m 700 /home/ubuntu/issue145-private

pnpm exec tsx scripts/full-potential-governance-delta-recovery.ts \
  --snapshot /home/ubuntu/issue130-secure/full-potential-account-snapshot.json \
  --audit-dir /home/ubuntu/issue130-governance-audit \
  --source-sha <EXACT_MERGED_SHA> \
  --retained-post-apply-evidence-at 2026-08-22T00:51:36.712Z \
  --output-dir /home/ubuntu/issue145-private/recovered-governance-delta
```

Outputs:

- `full-potential-governance-delta.recovered.json`;
- `governance-delta-recovery-report.json`;
- `checksums.sha256`.

Verify:

```bash
cd /home/ubuntu/issue145-private/recovered-governance-delta
sha256sum --check checksums.sha256
```

All output files are mode `0600`; the output directory is mode `0700`.

## Issue #143 follow-on

Only after recovery and checksum verification may the existing merged identity
command consume the recovered delta:

```bash
pnpm exec tsx scripts/full-potential-lookalike-identity-reconciliation.ts \
  --snapshot /home/ubuntu/issue130-secure/full-potential-account-snapshot.json \
  --governance-delta /home/ubuntu/issue145-private/recovered-governance-delta/full-potential-governance-delta.recovered.json \
  --output-dir /home/ubuntu/issue145-private/lookalike-identity-review \
  --source-sha <EXACT_MERGED_SHA>
```

The Issue #143 output must still show:

- `weeklyRecommendationEligibleCount=0`;
- `completeForCandidateCreation=false`;
- `manualReviewRequired=true`;
- zero durable actions;
- zero monetary impact;
- zero database, CRM, provider, pipeline or deployment effects.

The recovery tool creates no account, candidate, owner assignment, action,
signal, evidence, model or financial value.

## Stop conditions

Do not bypass or repair private inputs manually. Stop on any:

- raw SHA mismatch;
- checksum-manifest mismatch;
- row-count mismatch;
- account or alias deletion;
- stable-key collision;
- missing parent or merged target;
- orphan alias target;
- financial/CRM/provider side-effect invariant failure;
- Issue #143 materialisation or safety failure.

Private inputs and outputs must never be committed or uploaded as a public
GitHub artifact.
