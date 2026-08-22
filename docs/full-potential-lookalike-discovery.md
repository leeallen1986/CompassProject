# Governed Full Potential lookalike discovery

## Purpose

Issue #133 extends the Full Potential account universe with explainable,
public-evidence lookalikes without turning Compass into CRM, inflating monetary
potential or creating noisy salesperson actions.

A lookalike is a **candidate for human qualification**, not an approved buyer.
The first release is deterministic and offline. It creates no database row,
financial value, CRM/C4C account, contact or sales action.

## Core distinction

The model separates three questions that must not be collapsed:

1. **Similarity** — does the public business profile resemble a proven seed or
   seed cluster across commercially relevant dimensions?
2. **Identity** — is the company genuinely new, already present under another
   name, or ambiguous against existing accounts and aliases?
3. **Why now** — is there a reviewed current market signal or recurring-project
   window that justifies surfacing a recommendation to a salesperson?

A candidate may score highly on similarity while remaining blocked at identity
review. A validated account may exist without a current reason to act. Neither
condition creates a durable sales action automatically.

## Public-evidence features

The deterministic score uses:

- buyer segment;
- subsegment;
- public applications;
- product/application cells;
- visible CFM bands;
- visible pressure bands;
- geographic footprint;
- public OEM exposure;
- branch-footprint class;
- public-source strength and freshness;
- reviewed recurring-programme participation, when available.

Generic industry similarity alone is insufficient.

The weights total 100 points:

| Component | Weight |
|---|---:|
| Buyer segment | 20 |
| Applications | 16 |
| Product cells | 14 |
| CFM bands | 12 |
| Subsegments | 10 |
| Pressure bands | 8 |
| Geographies | 6 |
| OEM exposure | 5 |
| Public-source strength/freshness | 4 |
| Branch footprint | 3 |
| Reviewed recurring-programme evidence | 2 |

Priority bands are:

- `high_priority_review`: 70 or more;
- `review`: 55–69.9;
- `watchlist`: 40–54.9;
- `below_threshold`: below 40;
- `not_scored`: filtered or insufficient evidence.

These thresholds prioritise review. They do not represent probability of sale.

## Evidence boundary

Every public candidate requires:

- at least one first-party company source;
- evidence across at least four non-generic commercial dimensions;
- a public observation and separate similarity rationale;
- an observed date;
- no contacts, phone numbers, emails, CRM notes, quotations, discounts, private
  fleet registers, purchasing intent or customer conversations.

The public source pack may include dealer, competitor, reseller or context
entities only to prove they are filtered before buyer-candidate promotion.

## Identity gate

The scorer supports four identity states:

- `not_checked` — score may be shown, but canonical account/alias
  reconciliation is still required;
- `new_identity` — candidate may enter human review;
- `existing_account` — do not create another account; attach later public
  evidence only through a separately approved workflow;
- `ambiguous_identity` — manual resolution required.

A public candidate pack therefore remains `completeForCandidateCreation=false`
until identity reconciliation has been reviewed.

## Market-participant filtering

These roles are filtered before promotion:

- dealer;
- competitor;
- reseller;
- contextual/non-buying entity.

They may remain useful market evidence but have:

- `countsTowardPotential=false`;
- `monetaryImpactAud=0`;
- no CRM/C4C mutation;
- no contact enrichment;
- no durable sales action.

The first public tranche intentionally includes:

- Gaamben as a dealer/channel example; and
- Lifting Gear Hire & Sales as a reseller/context example because its compressor
  offer is publicly delivered through a compressor-hire partner.

## Initial public candidate tranche

The first bounded buyer candidates are:

- Avenida Australia;
- Aztech Group;
- Rawson Hire;
- JC Hire;
- Winch Hire Australia;
- Feniks Plant & Equipment.

They are public-evidence research candidates only. All initially have:

```text
identityStatus = not_checked
reviewState = pending_review
proposedRouteToMarket = manual_review
proposedOwner = null
countsTowardPotential = false
monetaryImpactAud = 0
```

## Segment cap

The default ranked-review cap is 20 candidates per buyer segment. Additional
scoreable companies remain in the package as `segment_cap_exceeded` rather than
being silently discarded. This prevents account-base expansion from flooding
sales review.

## Weekly-sales rule

A lookalike candidate alone never appears as a salesperson action.

A weekly recommendation becomes eligible only when all are true:

1. human review state is `approved_for_qualification`;
2. identity has been resolved to a new governed candidate or existing account;
3. route to market is governed and is not `manual_review` or `exclude`;
4. a sales owner is assigned;
5. at least one current market signal has been reviewed.

Even then:

```text
weeklyRecommendationEligible = true
durableActionCreated = false
```

The salesperson must accept the recommendation before a durable action is
created under a later approved runtime contract.

## Recurring-project input

Reviewed recurring-programme participation may contribute a small similarity
weight. Unreviewed recurrence cannot be counted, and the input contract requires
its count to remain zero until review.

Issue #139 currently blocks the production recurring-project snapshot because a
dedicated SELECT-only account is not yet provisioned. That does not block this
lookalike release: recurring evidence is optional and remains zero until the
separate review package exists.

## Offline preview command

Run from exact reviewed source. The output directory must be new, private and
outside the repository. The exact 40-character source SHA is mandatory and is
included in the deterministic input fingerprint and review summary.

```bash
umask 077
mkdir -m 700 /secure/operator-owned/lookalike-parent
SOURCE_SHA="$(git rev-parse HEAD)"

test "$SOURCE_SHA" = "$(git rev-parse HEAD)"
test -z "$(git status --porcelain)"

pnpm exec tsx scripts/full-potential-lookalike-preview.ts \
  --output-dir /secure/operator-owned/lookalike-parent/review \
  --source-sha "$SOURCE_SHA" \
  --as-of-date 2026-08-22 \
  --segment-cap 20
```

Optional private review overrides may be supplied:

```bash
pnpm exec tsx scripts/full-potential-lookalike-preview.ts \
  --output-dir /secure/operator-owned/lookalike-parent/review \
  --source-sha "$SOURCE_SHA" \
  --as-of-date 2026-08-22 \
  --segment-cap 20 \
  --review-input /secure/operator-owned/lookalike-review-input.json
```

The review input can update only:

- identity status;
- review state;
- route to market;
- owner;
- reviewed recurring-programme count;
- reviewed current-signal count.

It does not accept financial values, contacts, CRM payloads or account mutations.

## Review package

The offline command writes:

- `lookalike-candidate-results.json`;
- `lookalike-candidates.csv`;
- `lookalike-review-summary.json`;
- `checksums.sha256`.

For the same source SHA, public pack, review input, as-of date and segment cap,
scoring and review outputs are deterministic.

The summary always declares:

```text
mode = review_only_no_writes
sourceSha = exact reviewed source
completeForCandidateCreation = false
manualReviewRequired = true
databaseConnections = 0
databaseWrites = 0
fullPotentialAccountMutations = 0
fullPotentialMonetaryMutations = 0
crmC4cMutations = 0
contactEnrichmentMutations = 0
providerCalls = 0
pipelineInvocations = 0
durableActionsCreated = 0
deployments = 0
```

## Deliberate exclusions

This release does not:

- change `drizzle/**` or register a schema;
- read or write the production database;
- create or modify Full Potential accounts;
- assign monetary potential;
- create CRM/C4C accounts, contacts or opportunities;
- call Lusha, Apollo, an LLM or another provider;
- create weekly recommendations or durable actions;
- modify the current `This Week` page;
- deploy web or worker source.

## Follow-on gate

After merge:

1. reconcile the bounded public candidate pack against active Australian Full
   Potential accounts and aliases using a read-only identity snapshot;
2. classify each candidate as existing, new, ambiguous or excluded;
3. human approve, defer or reject the surviving candidates;
4. create non-counting `under_review` candidate accounts only through a separate
   hashed mutation manifest;
5. add reviewed market-signal and recurring-programme activation only after the
   account identity, route and owner are governed.
