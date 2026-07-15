# Full Potential V1 commercial-model UI

## Purpose

This release exposes the evidence-backed commercial-model backend through an internal-sales workspace. It is intentionally UI-only: no schema, migration, seed data, production account values or pipeline claims are introduced.

## Route and access

```text
/full-potential/commercial-model
```

The workspace is available to authenticated internal users and admins. Distributor users receive an explicit access-denied screen and the backend independently returns HTTP 403.

A floating **Commercial Model** link appears on `/full-potential` alongside the existing Data Quality and Rental Hire links. The workspace supports deep links with:

```text
/full-potential/commercial-model?accountId=<fullPotentialAccountId>
```

## Workflow

The interface follows the V1 operating sequence:

1. Select a Full Potential account.
2. Capture evidence with source, date, product family and confidence.
3. Admin verifies or rejects evidence.
4. Create or resume the active model draft.
5. Add product-family/application lines and link supporting evidence.
6. Review the client-side calculation preview, which mirrors the server formula.
7. Submit the model with a written assumptions summary.
8. Admin returns or approves the submitted model.
9. Review model versions and the immutable review trail.

Approved account values continue to be written only by the backend approval transaction.

## Model-line editor

The UI exposes:

- product family and application;
- route to market;
- current supplier and current revenue;
- known Atlas fleet and estimated total fleet;
- replacement cycle or explicit annual replacements;
- average selling price;
- addressable share;
- separately supported specialty potential;
- assumption note;
- confidence;
- evidence links.

The preview calculation is:

```text
annual replacement units
  = explicit annual replacement units
  OR estimated fleet units / replacement cycle years

equipment potential AUD
  = annual replacement units
  × average selling price AUD
  × addressable share percentage

line potential AUD
  = equipment potential AUD
  + supported specialty potential AUD
```

Blank or incomplete assumptions calculate to zero. The client never inserts substitute values.

## Readiness gates

The interface displays the same submission and approval requirements enforced by the server.

### Submission

- at least one line;
- positive calculated potential on every line;
- non-unknown confidence on every line;
- at least one linked evidence record on every line;
- written assumptions summary.

### Approval

All submission requirements plus at least one verified linked evidence record on every line.

The UI guidance is advisory; the backend remains authoritative.

## Account structure

The Structure tab supports retained canonical relationships without deleting records:

- parent account;
- merge target;
- relationship type;
- active / review / merged / parked / excluded status;
- whether the record counts toward Full Potential.

Only admins can save structure changes. The server forces merged, duplicate and excluded records to non-counting.

## Release boundary

This PR does not:

- change the database schema;
- generate or apply a migration;
- create evidence or models for real accounts;
- populate the five pilot accounts;
- create pipeline claims;
- alter account ownership, routes or financial values;
- change the Full Potential importer;
- expose commercial models to distributors.

## Validation

Run:

```bash
pnpm tsc --noEmit
pnpm build
pnpm exec vitest run client/src/lib/fullPotentialCommercialModel.test.ts
```

Authenticated browser smoke checks:

1. Internal user opens `/full-potential/commercial-model` and selects an account.
2. Deep link with `accountId` opens the selected account.
3. Distributor sees the access-denied screen.
4. Empty backend tables render an empty, non-error workspace.
5. Draft/evidence/line actions are exercised only against an isolated test database during validation.
6. Production validation is read-only; no POST, PUT or DELETE request is sent.
