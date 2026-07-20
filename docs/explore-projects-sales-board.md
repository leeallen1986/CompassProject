# Explore Projects — focused sales board

## Purpose

This release makes `/dashboard` the rep-facing project activation board rather than the broad market-intelligence feed.

The operating sequence is:

```text
server-side lane and territory gate
→ actionable project
→ confirmed / likely contractor or buying account
→ canonical Full Potential account
→ accountable owner and route to market
→ next evidence-generating action
```

The broad research dashboard remains available at:

```text
/dashboard/intelligence
```

It is deliberately secondary because it contains monitoring and research intelligence that may not require immediate sales action.

## Shared ranking truth

The **For You** view consumes `thisWeek.summary.topProjects`. Those projects have already passed the shared server-side logic in `laneScoring.ts`, including:

- primary selling-lane score;
- territory scope;
- project action tier;
- opportunity gates that suppress generic noise;
- route-to-buy clarity;
- contact readiness;
- selling-motion classification;
- feedback as a small tie-breaker only.

The new page does not call the legacy client-side personalisation function to reorder the action list.

## Views

### For You

The current top lane-ranked projects for the signed-in rep.

### Confirmed Contractors

Projects whose primary Full Potential account context is `confirmed`.

### Likely Contractors

Projects whose primary account context is `likely_high` or `likely_medium`. These are hypotheses, not facts, and must be validated by the rep.

### Awarded & Mobilising

Awarded-project records in the rep's territory, joined to Full Potential through the winning contractor.

### Live Tenders

Tenders closing within 14 days that pass the existing server-side lane and territory gate.

### All Intelligence

A handoff to the existing broad dashboard for contacts, drilling, sources, contractor research and the complete market feed.

Legacy links are preserved:

- `?tab=awarded` opens Awarded & Mobilising;
- `?tab=live-tenders` opens Live Tenders;
- `?tab=projects&filter=action_ready` opens For You;
- contact, drilling, AI-search, source, collateral and project-deep-link parameters redirect to `/dashboard/intelligence` with the query string preserved.

## Account context

Each actionable project can show:

- canonical Full Potential account;
- confirmed or likely certainty;
- contractor / EPC / project-owner role;
- internal or channel owner;
- route to market;
- priority tier;
- approved model, open action or active pursuit state;
- next missing account evidence or activation step.

The account link opens the existing commercial-model workspace. No account data is written from Explore Projects.

## Metrics

The rep-facing strip now measures:

- actionable projects that passed the shared gates;
- unique matched buying accounts;
- confirmed account routes;
- likely routes requiring validation;
- unresolved buying routes.

These are decision metrics, not broad activity counts.

## CRM boundary

Compass owns:

- project and market intelligence;
- account matching;
- why-now explanation;
- route-to-buy hypothesis;
- evidence gaps;
- the next evidence-generating action.

C4C remains authoritative for:

- the qualified opportunity;
- forecast and probability;
- quote and proposal administration;
- formal customer activity;
- win/loss and order records.

## Release boundary

This release does not:

- change `laneScoring.ts` or This Week ranking;
- create a second project-scoring algorithm;
- persist project-to-account links;
- create or edit Full Potential accounts;
- create actions, evidence, models or pursuits;
- advance pipeline stages;
- add contact management, forecasting or quoting;
- write financial values;
- add a schema or migration;
- write to C4C.

## Validation

```bash
pnpm tsc --noEmit
pnpm build
pnpm exec vitest run \
  client/src/lib/exploreProjects.test.ts \
  client/src/lib/fullPotentialProjectContext.test.ts \
  client/src/lib/platformNavigation.test.ts
```

Production smoke testing must remain read-only. Do not invoke project claim, outreach, contact discovery, Full Potential action, evidence, model or pursuit mutations.
