# Full Potential Rental Hire coverage census

## Purpose

The Rental Hire workspace currently manages the accounts already present in the
Full Potential universe. This census adds the read-only bridge required to answer
a different question:

> Does the current universe represent the addressable Australian Rental Hire
> market, and which identity, branch, ownership, route, product, evidence and
> execution gaps prevent it from being commercially complete?

The census does not add accounts. It produces an auditable review pack before
any account, alias or parent/branch proposal is allowed near production.

## Operating sequence

```text
current Full Potential universe
+ aliases and parent/merge controls
+ actions, signals and evidence
+ optional externally researched candidates
→ canonical Rental Hire groups
→ coverage and quality gaps
→ candidate reconciliation
→ human review
→ separately guarded account/alias manifest
```

## Read-only command

```bash
pnpm exec tsx \
  server/scripts/fullPotentialRentalCoverageCensus.ts \
  --output-dir \
  artifacts/rental-coverage/<utc-run>
```

Optional external research file:

```bash
pnpm exec tsx \
  server/scripts/fullPotentialRentalCoverageCensus.ts \
  --output-dir \
  artifacts/rental-coverage/<utc-run> \
  --candidate-file \
  research/rental-hire-candidates.csv
```

The candidate file may be CSV, XLS or XLSX. Its required identity column is
`candidateName`. The generated template contains the complete supported header
set.

## Artifacts

Every run produces:

- `rental-coverage-census.csv` — current Rental Hire rows with canonical-root,
  relationship, owner, route, evidence, activity and gap fields;
- `rental-coverage-summary.json` — universe, ownership, route, geography,
  readiness and gap totals;
- `rental-coverage-canonical-groups.json` — parent/branch/site/duplicate groups
  without double-counting context rows;
- `rental-coverage-gap-queue.csv` — accounts requiring identity, ownership,
  route, product, installed-base, supplier, financial, evidence or action work;
- `rental-coverage-candidate-template.csv` — external-research staging template.

When `--candidate-file` is supplied, the run additionally produces:

- `rental-coverage-candidate-reconciliation.csv`;
- `rental-coverage-candidate-reconciliation.json`.

## Canonical relationship policy

Root resolution follows, in order:

1. `mergedIntoAccountId`;
2. `parentAccountId`;
3. the current row when neither relationship exists.

Cycles and missing targets are explicit critical gaps. Branch, site, division
and service-unit rows require a parent. Merged or duplicate rows must not count
toward potential.

A national group with many branches remains one commercial parent with branch
context unless evidence proves separate buying authority. The census does not
make that decision automatically.

## Coverage dimensions

Each Rental Hire row is checked for:

- canonical relationship integrity;
- counting versus context status;
- state and branch geography;
- territory ownership alignment;
- route-to-market and channel ownership;
- product/application fit;
- installed-base coverage;
- incumbent supplier coverage;
- financial-potential coverage;
- evidence and verified-evidence coverage;
- Tier A/B open-action coverage;
- alias coverage.

The `coverageScore` is a prioritisation aid, not a financial estimate or
commercial truth. The row-level gap codes remain authoritative.

## Candidate reconciliation

External candidates are classified as:

- `existing_account` — exact normalized canonical/display/parent/alias match;
- `possible_existing_account` — unique legal-suffix-normalized match requiring
  operator confirmation;
- `branch_or_site_candidate` — no direct match, but the stated parent exists;
- `new_account_candidate` — no current identity match;
- `ambiguous_manual_review` — more than one plausible current identity;
- `excluded_by_source` — the research file explicitly records an exclusion
  reason.

No candidate classification writes an account, alias or relationship. A later
account-import manifest must be separately reviewed, hashed, bounded and
approved.

## Commercial and enrichment boundary

The census:

- performs database SELECTs only;
- does not call Apollo, Hunter, Lusha, LinkedIn/Data API, Projectory or an LLM;
- does not trigger a pipeline or contact discovery;
- does not create contacts, candidate slates, actions, signals or pursuits;
- does not change C4C;
- does not infer a mailbox;
- does not merge, exclude or import an account;
- does not calculate invented market potential.

Paid contact enrichment belongs after the canonical account universe and Tier
A/B buying-committee gaps are approved. It must be targeted to a named missing
stakeholder lane, not used as a bulk universe-filling step.

## Acceptance gates before account expansion

A proposed Rental Hire expansion should not move to a write manifest until:

1. every candidate has a public or internal evidence source;
2. duplicate, alias and parent/branch decisions are explicit;
3. the internal owner and route are resolved or deliberately marked for review;
4. the account has a credible Portable Air or Specialty Air fit;
5. micro-hire, party/event hire and tool-only businesses without relevant air
   demand are excluded rather than counted;
6. the change is reviewed at canonical-parent level, not raw branch-row count;
7. no contact or mailbox is created as part of the account-universe import.
