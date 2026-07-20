# Full Potential buying-account context in project intelligence

## Purpose

This release consumes the read-only project-to-account resolver delivered in PR #60 and places the resulting commercial context into the two surfaces the sales team uses most:

- **This Week** for daily and weekly action;
- **Explore Projects** for broader project, contractor, award and tender research.

The objective is to connect project intelligence to the actual company Atlas Copco can sell to.

```text
project / tender / award
→ contractor or buying entity
→ canonical Full Potential account
→ accountable owner and route to market
→ missing evidence or account action
```

## What the user sees

A resolved project displays:

- `Confirmed account`, `Likely account · high`, or `Likely account · validate`;
- canonical Full Potential account name;
- the relationship role, such as winning contractor, EPC, contractor or project owner;
- internal or channel owner;
- route to market;
- priority tier;
- the next account-level evidence or activation gap;
- a direct link to the existing commercial-model workspace.

An ambiguous or weak candidate is not silently assigned. It displays **Buying account unresolved** so the rep knows that the commercial route still requires validation.

## Explore Projects changes

Project cards now show account context in both collapsed and expanded states.

The overview KPI strip no longer repeats broad project-noise indicators such as `Hot Priority` and `New This Week`. It shows:

1. unique matched buying accounts;
2. confirmed account routes;
3. likely routes requiring validation;
4. candidate routes requiring account resolution.

The Awarded Projects table displays the canonical Full Potential account matched from the winning contractor.

## This Week changes

The same account contract appears on:

- Top 3 action cards;
- action-ready rows;
- closing-soon rows;
- other compact project rows that use the shared weekly component.

This preserves This Week as the action surface while adding the missing answer to: **who is the actual buying account and what should the rep validate next?**

## Loading and access

The client uses the read-only endpoints from PR #60 and:

- deduplicates project IDs;
- splits requests into batches below the 250-ID server limit;
- uses authenticated same-origin requests;
- aborts requests when the screen unmounts;
- suppresses account context safely when the current role cannot access internal Full Potential data.

No project-to-account link is persisted by this UI.

## Commercial boundary

Compass continues to own:

- project and contractor intelligence;
- canonical account resolution;
- route-to-buy confidence;
- Full Potential evidence gaps;
- the next evidence-generating action.

C4C continues to own:

- formal customer and contact records;
- qualified opportunities;
- forecast, quote and formal sales activity;
- win/loss and order outcomes.

This release does not create a second CRM.

## Data and release boundary

The release does not:

- change project ranking or lane scoring;
- write project-to-account relationships;
- change Full Potential accounts or aliases;
- create actions, evidence, models or pursuits;
- modify pipeline claims or stages;
- generate financial values;
- write to C4C;
- add a schema or migration.

## Validation

```bash
pnpm tsc --noEmit
pnpm build
pnpm exec vitest run \
  client/src/lib/fullPotentialProjectContext.test.ts \
  client/src/lib/platformNavigation.test.ts \
  client/src/lib/fullPotentialCommercialModel.test.ts \
  client/src/lib/fullPotentialPilot.test.ts
```

Production smoke testing is read-only. It must not invoke claim, action, evidence, model, relationship or pipeline mutations.
