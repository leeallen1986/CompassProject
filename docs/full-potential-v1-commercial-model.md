# Portable Air Full Potential V1 commercial model

## Purpose

This release changes Full Potential from a ranked account list into an evidence-backed, versioned commercial model.

It does not populate financial values automatically. Account potential is written only when an admin approves a submitted model whose product-family lines have positive calculated potential and verified evidence.

## Account structure

`fullPotentialAccounts` now supports:

- `parentAccountId` for parent/division/branch/site relationships;
- `mergedIntoAccountId` for retained duplicate records;
- `relationshipType` for standalone, parent, division, branch, site, service unit, strategic context or duplicate;
- `recordStatus` for active, under review, merged, parked or excluded;
- `countsTowardPotential` to prevent double counting without deleting records.

Merged, excluded and duplicate records do not count toward account potential.

## Evidence register

Evidence is stored independently from model versions and can be reused. Supported evidence includes:

- internal order history;
- CRM history;
- service and warranty history;
- Fleetlink;
- distributor and channel evidence;
- customer discovery;
- public sources;
- tender or project evidence;
- explicit financial assumptions.

Evidence moves through `draft`, `verified`, `rejected` or `superseded`. Only verified evidence supports model approval.

## Product-family model

Each account model is versioned. Product-family/application lines contain the commercial assumptions and route-to-market split.

The server calculates:

```text
annual replacement units
  = explicit annual replacement estimate
  OR estimated fleet units / replacement cycle years

equipment potential AUD
  = annual replacement units
  × average selling price AUD
  × addressable share percentage

line potential AUD
  = equipment potential AUD
  + supported specialty potential AUD

remaining potential AUD
  = max(total approved line potential - current revenue, 0)
```

Missing inputs produce zero calculated equipment potential. The system does not invent fleet size, replacement cycles, price, share or specialty value.

Portable Air is split into route-relevant product families, including small/medium portable air, large portable air, specialty air/boosters, E-Air, dryers and nitrogen.

## Workflow

1. Internal sales creates or resumes one active draft for an account.
2. Evidence is captured.
3. Product-family lines are entered and linked to evidence.
4. Submission requires:
   - at least one line;
   - positive calculated potential on every line;
   - a confidence rating on every line;
   - at least one linked evidence record on every line;
   - a written assumptions summary.
5. An admin returns or approves the model.
6. Approval additionally requires at least one verified evidence record per line.
7. Approval writes the calculated total, remaining potential, confidence and evidence source summary to the account.
8. A later approved version supersedes the previous approved model without deleting its history.

## API

Authenticated internal-sales endpoints are exposed under:

```text
GET    /api/full-potential/commercial-model/:accountId
POST   /api/full-potential/commercial-model/:accountId/draft
POST   /api/full-potential/commercial-model/evidence
POST   /api/full-potential/commercial-model/evidence/:evidenceId/review
PUT    /api/full-potential/commercial-model/line
DELETE /api/full-potential/commercial-model/line/:lineId
POST   /api/full-potential/commercial-model/:modelId/submit
POST   /api/full-potential/commercial-model/:modelId/review
PUT    /api/full-potential/commercial-model/account/:accountId/relationship
```

Distributor users are blocked. Evidence review, model approval/return and relationship changes require admin access.

## Release boundary

This PR provides the schema, calculation engine, evidence workflow, approval workflow, account relationship controls and API. It does not:

- write model data for the 78 Rental Hire accounts;
- set potential values for the five pilot accounts;
- expose the user interface;
- create pipeline claims;
- change ownership or channel routing;
- merge or delete account records.

The next UI release will expose the evidence/model workspace and connect an approved account hypothesis to the attributed opportunity flow built in Sprint 2A.
