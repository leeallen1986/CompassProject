# Full Potential project-to-account matching

## Purpose

This release creates the read-only bridge between project, awarded-work and contractor intelligence and the canonical Portable Air Full Potential account universe.

It does not redesign Explore Projects. It establishes a single matching contract that later screens, weekly recommendations and AI briefs can consume.

## Commercial sequence

```text
project / tender / award
→ candidate owner, contractor, EPC, supplier or contact company
→ canonical Full Potential account
→ accountable internal owner and route to market
→ evidence-generating action
→ attributed pursuit
→ C4C when qualified
```

## Source precedence

Candidates are evaluated in this order:

1. winning contractor from an awarded-project record;
2. confirmed contractor or EPC from the contractor registry and project links;
3. confirmed contractor embedded in the project record;
4. predicted or tendering contractor;
5. project owner;
6. project-linked contact company;
7. consultant, supplier or other lower-confidence participants.

A project may resolve to several Full Potential accounts. The primary match is the highest-priority credible buying route; other matches are retained as context.

## Canonical account rules

The matcher uses:

- canonical account names;
- display names;
- Full Potential aliases;
- parent-group names;
- retained duplicate names;
- branch, division and site relationships.

A merged record resolves to `mergedIntoAccountId`. A non-counting branch or site resolves to its counting parent. Standalone parked, excluded or non-counting records are not presented as commercial matches.

The output account is always an eligible counting account:

- `rowClass = account`;
- `countsTowardPotential = true`;
- not merged, parked or excluded;
- Full Potential status is not park or exclude;
- route to market is not exclude.

## Match confidence

The API uses four explicit states:

- `confirmed` — exact account identity and confirmed commercial relationship;
- `likely_high` — strong identity and relationship evidence, but not confirmed;
- `likely_medium` — useful hypothesis that requires rep validation;
- `unresolved` — no safe match, ambiguous match or weak/generic company phrase.

The system never silently selects between equally plausible canonical accounts. Ambiguous candidates include the possible account IDs for review.

Generic phrases such as “National Equipment Hire” are not fuzzy-matched to longer operational descriptions. Legal-suffix and trailing-geography variants can still resolve as an exact identity when they represent the same recorded company name. Fuzzy matching otherwise requires distinctive company identity tokens and a clear score margin.

## Account context returned

Each match contains:

- canonical account ID and name;
- matched source account and match method;
- candidate role and source;
- relationship and name confidence;
- internal owner and channel owner;
- route to market;
- Full Potential status, tier and push decision;
- approved potential and confidence;
- installed-base, supplier and C4C status;
- next account action;
- latest approved model state;
- open Full Potential action count;
- active attributed-pursuit count and statuses.

## Read-only API

Internal sales users can access:

```text
GET /api/full-potential/project-match/:projectId
GET /api/full-potential/project-matches?projectIds=1,2,3
GET /api/full-potential/awarded-project-matches?limit=250
GET /api/full-potential/account-match?name=Coates%20Hire&state=National
```

All responses use `Cache-Control: private, no-store`.

- unauthenticated requests return HTTP 401;
- distributor requests return HTTP 403;
- project batches are limited to 250 IDs;
- awarded-project requests are limited to 500 rows;
- the endpoints perform no inserts, updates or deletes.

## Release boundary

This release does not:

- change project ranking;
- write project-to-account relationships to the database;
- alter Full Potential accounts, aliases or relationships;
- create actions, evidence, models or pursuits;
- infer or write financial values;
- change C4C data;
- redesign the Explore Projects interface.

The next release will consume this API in Explore Projects and This Week so every actionable card can display the confirmed or likely buying account, accountable owner, route to market and remaining evidence gap.
