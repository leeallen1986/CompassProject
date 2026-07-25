# Full Potential Rental Hire coverage census

## Purpose

The Rental Hire workspace manages accounts already present in the Full Potential
universe. The census answers a different question:

> Does the current universe represent the addressable Australian Rental Hire
> market, and which identity, branch, ownership, route, product, evidence and
> execution gaps prevent it from being commercially complete?

The command is read-only. It does not add accounts or aliases. It produces an
auditable review pack before any proposed account, alias or parent/branch change
is allowed near production.

## Commercial unit of analysis

The authoritative commercial unit is the **canonical parent group**, not the raw
database row.

A national or regional group may contain:

- one active record that counts toward Full Potential;
- branches, sites, divisions and service units used as context;
- aliases attached to any member row;
- merged or duplicate rows retained for traceability.

The group is counted once in universe, owner, route, state, priority, push and
coverage summaries. Raw rows remain in `rental-coverage-census.csv` for audit,
but they do not independently inflate the market universe.

The census explicitly reports:

- groups with no active counting record;
- groups with more than one active counting record;
- inactive, merged, duplicate or excluded rows still flagged as counting;
- parent/branch relationship cycles and missing targets.

## Geographic scope

The current command is fixed to:

```text
country = AU
```

Rental rows outside Australia are reported as `nonScopeRentalRowsExcluded` and
are not included in Australian group, state, owner, route or gap totals. A future
New Zealand or broader Oceania census must be a separately reviewed scope.

## Operating sequence

```text
current Full Potential universe
+ aliases and parent/merge controls
+ actions, stored next actions, My Week state, signals and evidence
+ optional externally researched candidates
→ canonical Australian Rental Hire groups
→ group-level coverage and quality gaps
→ candidate-to-canonical-root reconciliation
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

The command rejects write-style flags, unknown arguments and attempts to widen
the fixed Australian scope.

## Artifacts

Every run produces:

- `rental-coverage-census.csv` — current Australian Rental Hire rows with root,
  relationship, row-level activity and row/group gap fields;
- `rental-coverage-summary.json` — canonical universe, ownership, route,
  geography, counting integrity, readiness and group-gap totals;
- `rental-coverage-canonical-groups.json` — one record per canonical parent with
  all member, counting, branch, duplicate, owner, route, action and evidence
  rollups;
- `rental-coverage-gap-queue.csv` — one row per canonical group requiring
  identity, ownership, route, product, installed-base, supplier, financial,
  evidence or execution work;
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
and service-unit rows require a parent. Merged, parked, excluded and duplicate
rows must not count toward potential.

A national group with many branches remains one commercial parent with branch
context unless evidence proves separate buying authority. The census does not
make that decision automatically.

## Group-level coverage policy

Aliases, actions, signals and evidence are rolled up across every member of the
canonical group. A branch-held record can therefore support the parent without
creating a false parent gap.

Tier A/B execution coverage is present when at least one group member has any of:

- an open `fullPotentialActions` record;
- a non-empty stored `nextAction`;
- `activeInMyWeek=true`.

A group is checked for:

- canonical relationship and counting integrity;
- state and branch geography;
- territory ownership alignment and owner conflicts;
- route-to-market, route conflicts and channel ownership;
- product/application fit;
- installed-base coverage;
- incumbent supplier coverage;
- financial-potential coverage;
- evidence-source and verified-evidence coverage;
- Tier A/B execution coverage;
- alias coverage.

`coverageScore` is a prioritisation aid, not a financial estimate or commercial
truth. Group gap codes are authoritative for the gap queue. Row gap codes remain
available for audit and remediation of individual records.

## Candidate reconciliation

Candidate identities are matched against every current Full Potential account
and alias, then collapsed to the canonical root before disposition. A parent,
branch and branch alias that all lead to the same root are one existing account,
not a false ambiguity.

External candidates are classified as:

- `existing_account` — exact normalized identity resolves to one canonical root;
- `possible_existing_account` — unique legal-suffix-normalized root match
  requiring operator confirmation;
- `branch_or_site_candidate` — no direct identity match, but the stated parent
  resolves to one current root;
- `new_account_candidate` — no current canonical, display, parent or alias match;
- `ambiguous_manual_review` — more than one plausible canonical root;
- `excluded_by_source` — the research file explicitly records an exclusion.

The reconciliation output also returns:

- every matched canonical root;
- all matched member row IDs;
- the current segments represented by those rows;
- match basis;
- research-completeness flags.

Required research fields are:

- source name;
- source URL;
- evidence summary;
- product fit;
- state.

Every candidate is returned with:

```text
recommendedForImport = false
```

Candidate classification is never import approval. Website/domain evidence is
retained for human review; it is not used as an automatic identity key because
the current Full Potential account schema does not hold a normalized website
field.

## Commercial and enrichment boundary

The census:

- performs database SELECTs only;
- writes only local audit artifacts;
- does not call Apollo, Hunter, Lusha, LinkedIn/Data API, Projectory or an LLM;
- does not trigger a pipeline or contact discovery;
- does not create accounts, aliases, actions, signals, contacts or slates;
- does not change C4C;
- does not infer a mailbox;
- does not merge, exclude or import an account;
- does not calculate invented market potential.

Paid contact enrichment belongs after the canonical account universe and Tier
A/B buying-committee gaps are approved. It must be targeted to a named missing
stakeholder lane, not used as a bulk universe-filling step.

## Acceptance gates before account expansion

A proposed Rental Hire expansion must not move to a write manifest until:

1. every candidate has a public or internal evidence source and URL;
2. duplicate, alias and parent/branch decisions are explicit;
3. the internal owner and route are resolved or deliberately marked for review;
4. the account has a credible Portable Air or Specialty Air fit;
5. micro-hire, party/event hire and tool-only businesses without relevant air
   demand are excluded rather than counted;
6. the change is reviewed at canonical-parent level, not raw branch-row count;
7. no group has an unresolved missing or multiple counting-record defect;
8. no candidate is imported solely because the census classifies it as new;
9. no contact or mailbox is created as part of the account-universe import;
10. a later account/alias manifest is independently reviewed, hashed, bounded
    and explicitly approved.
