# Full Potential governance-delta recovery

## Purpose

Issue #145 provides a deterministic, fully offline bridge between the retained
Issue #130 governance audit package and the merged Issue #143 lookalike identity
reconciliation.

The original private `full-potential-governance-delta.json` was not recovered.
This tool therefore creates a **new recovered delta** from the exact hash-locked
changed-row audit artifacts. It always records:

```text
originalDeltaRecovered = false
recoveryBasis = hash_locked_changed_row_audit
```

It does not claim that the recovered file is byte-for-byte or timestamp-identical
to the missing original delta.

## Hash-locked evidence profile

The source profile fixes the exact private evidence lineage already reviewed:

- canonical raw account/alias snapshot: 1,146 accounts and 157 aliases;
- raw snapshot SHA-256: `34a3e1242542dcb9c9ced913638ea00b306a0f2534c85e8da2c31aa560c0dd24`;
- Issue #130 governance source SHA: `9ecc06561ad6d081ee2f6f721d4c74b6b8d2b98a`;
- approved buyer-resolution package SHA-256: `125e010edb5b5237731369e7caae270f927fbfd5f5f1819386347fef7597efb8`;
- changed-row before-manifest SHA-256: `29150bb32a5a06ebaae5db6c7f21d14334a00afdb94e93f696a6a7e613f893c2`;
- changed-row after-manifest SHA-256: `d8e195adcd51e703ab8c15b2607a7b00ea707e52f13544fd4dc7d909b2e6a163`;
- exact hashes for the four changed-row CSV files, audit manifest, apply
  summary, before/after summaries and checksum manifest.

Every raw file hash is verified before any JSON or CSV is parsed. The tool then
computes the separate canonical parsed-object snapshot SHA-256 using the same
sorted-key canonicalisation contract as Issue #143. The raw file hash and the
canonical object hash are deliberately reported as different concepts.

## Recovery rules

The tool requires exactly:

- one changed account before-row;
- 17 changed account after-rows;
- 16 account creations;
- one account replacement;
- zero account deletions;
- zero changed alias before-rows;
- three changed alias after-rows;
- three alias additions;
- zero alias replacements or deletions.

CSV IDs are parsed as positive safe integers before account, parent, merge and
alias-target checks. This removes string-versus-number comparison ambiguity but
does not weaken the identity gates.

Every alias target must exist in the base snapshot or the governed after-account
set. Every non-null parent and merge target must also exist. A missing target,
collision, deletion, malformed row or audit-invariant failure blocks recovery.

Only the bounded Issue #143 fields are copied into the recovered delta:

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

Alias rows contain only:

```text
accountId
aliasName
aliasType
confidenceLevel
```

Owner, channel, CRM, financial, priority, platform-push, workbook and source-row
columns are audit evidence only and are never copied into the recovered delta.
`parentGroup` is derived from `parentAccountId` by resolving the governed parent
account's canonical name.

## Timestamp rule

The retained package has no exact database transaction timestamp. The command
therefore requires a controller-approved **retained post-apply evidence
timestamp**. This value is used only to create a deterministic valid `appliedAt`
field and is explicitly reported with:

```text
exactTransactionTimeClaimed = false
```

For the retained package, the approved evidence timestamp is the millisecond
precision modification time of the retained `apply-summary.json`:

```text
2026-08-22T00:51:36.712Z
```

## Check-only execution

Run only from an exact reviewed source checkout. Private files remain outside the
repository.

```bash
umask 077
chmod 700 /home/ubuntu/issue130-secure /home/ubuntu/issue130-governance-audit
chmod 600 /home/ubuntu/issue130-secure/full-potential-account-snapshot.json
chmod 600 /home/ubuntu/issue130-governance-audit/*

pnpm exec tsx scripts/full-potential-governance-delta-recovery.ts \
  --snapshot /home/ubuntu/issue130-secure/full-potential-account-snapshot.json \
  --audit-dir /home/ubuntu/issue130-governance-audit \
  --source-sha <exact-reviewed-40-hex-sha> \
  --retained-post-apply-evidence-at 2026-08-22T00:51:36.712Z \
  --check-only
```

The bounded stdout contains hashes, counts and safety results only. It does not
print account rows, alias names, customer data or the recovered delta.

## Private output execution

Create a new private parent outside the repository:

```bash
umask 077
mkdir -m 700 /home/ubuntu/issue145-private

pnpm exec tsx scripts/full-potential-governance-delta-recovery.ts \
  --snapshot /home/ubuntu/issue130-secure/full-potential-account-snapshot.json \
  --audit-dir /home/ubuntu/issue130-governance-audit \
  --source-sha <exact-reviewed-40-hex-sha> \
  --retained-post-apply-evidence-at 2026-08-22T00:51:36.712Z \
  --output-dir /home/ubuntu/issue145-private/recovered-delta
```

Outputs are written with directory mode `0700` and file mode `0600`:

- `full-potential-governance-delta.recovered.json`;
- `governance-delta-recovery-report.json`;
- `checksums.sha256`.

Verify the package:

```bash
(
  cd /home/ubuntu/issue145-private/recovered-delta
  sha256sum --check checksums.sha256
)
```

## Issue #143 continuation

A successful recovered-delta package is still review-only. Pass it to the merged
identity reconciliation in a separate new output directory:

```bash
mkdir -m 700 /home/ubuntu/issue145-private/identity-parent

pnpm exec tsx scripts/full-potential-lookalike-identity-reconciliation.ts \
  --snapshot /home/ubuntu/issue130-secure/full-potential-account-snapshot.json \
  --governance-delta /home/ubuntu/issue145-private/recovered-delta/full-potential-governance-delta.recovered.json \
  --output-dir /home/ubuntu/issue145-private/identity-parent/review \
  --source-sha <exact-reviewed-40-hex-sha>
```

Recovery and identity reconciliation together still create no account, monetary
value, CRM record, contact, weekly recommendation or durable action.

## Safety boundary

The recovery command performs no:

- database connection, query or write;
- schema or migration action;
- Full Potential account or monetary mutation;
- CRM/C4C or contact mutation;
- provider or pipeline invocation;
- candidate approval, owner assignment or sales activation;
- weekly runtime change;
- deployment.

The private execution remains a separate post-merge controller gate.
