# Full Potential V1 — Top-five Account Activation Pilot

## Purpose

This release activates the five approved Rental Hire pilot accounts without turning Compass into a second CRM.

The cockpit proves one commercial sequence:

```text
verified evidence
→ approved product-family model
→ attributed pursuit
→ genuine customer validation
→ formal C4C handoff when qualified
```

## Pilot cohort

| Rank | Account | Full Potential account ID |
|---|---|---:|
| 1 | United Rentals | 272 |
| 2 | Onsite Rental Group | 415 |
| 3 | Coates Hire | 269 |
| 4 | Flexihire | 270 |
| 5 | Tutt Bryant Hire | 275 |

The cohort is deliberately fixed for V1. This release does not activate the remaining 73 Rental Hire accounts.

## Product boundary

### Compass owns

- evidence readiness;
- approved Full Potential model and product-family line;
- the reason a pursuit started;
- source attribution;
- the next evidence-generating commercial action;
- a working pursuit estimate confirmed by the rep;
- read-only visibility of the attributed pursuit.

### C4C owns

- the formal opportunity record;
- customer and contact master data;
- forecast category and probability;
- quote and proposal administration;
- formal sales activity history;
- qualified-stage opportunity value;
- win/loss and order records.

The cockpit contains no pipeline stage editor, forecast board, quote workflow, contact database, meeting log or email sequence.

## Activation gate

A rep can start a pursuit only when the account has:

1. a manager-approved Full Potential model;
2. at least one positive product-family/application line in that approved model;
3. the product family and application selected from that line;
4. an evidence-backed commercial hypothesis;
5. a named customer person or target customer role;
6. a specific next action and date;
7. a positive working pursuit estimate confirmed by the rep;
8. explicit acknowledgement that Compass is not creating the formal C4C opportunity.

The backend remains authoritative for account eligibility and duplicate protection. The UI also blocks a second active pursuit for the same account, product family and application when an existing team claim is visible.

## Workspace

The page is available to authenticated internal sales users at:

```text
/full-potential/pilot
```

Each account card shows:

- evidence and verification counts;
- model approval and positive-line readiness;
- the next required commercial step;
- approved product-family plays;
- existing attributed pursuits;
- working attributed value;
- direct navigation to the evidence/model workspace;
- the C4C handoff boundary.

The cohort summary reports:

- accounts loaded;
- evidence-ready accounts;
- approved models;
- attributed pursuits;
- pursuits beyond `identified`;
- working attributable value excluding `lost` and `not_relevant` claims.

## AI boundary

This release does not claim to provide an AI-generated account brief. It consumes only human-reviewed evidence and manager-approved models.

The next focused intelligence release will add:

- source-cited signal-to-account matching;
- “why now” briefs;
- missing-evidence recommendations;
- Next Best 5 delivery in This Week;
- rep accept/edit/reject feedback;
- manager conversion roll-up.

AI will not approve potential, invent fleet values, create pursuits autonomously or update C4C without human confirmation.

## Release exclusions

This PR contains:

- no schema changes;
- no migration;
- no backend changes;
- no automatic account, evidence or model population;
- no automatic pursuit creation;
- no pipeline-stage management;
- no C4C write integration;
- no production writes during deployment validation.

## Pilot success criteria

Over the controlled 60-day operating period:

- all five accounts receive an explicit pursue, defer or reject decision;
- at least three evidence-backed pursuits are started;
- at least two substantive customer conversations occur;
- at least one pursuit becomes a qualified C4C opportunity or quote;
- every pursuit remains traceable to the Full Potential account and approved model line;
- no unsupported claim is created merely to satisfy a platform KPI.
