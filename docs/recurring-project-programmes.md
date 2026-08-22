# Recurring project programmes and occurrences

## Purpose

Recurring shutdowns, tenders, drilling campaigns, maintenance programmes and
rolling work packages must not be represented by repeatedly changing the dates
on one project or by creating disconnected duplicate projects.

The governed model separates:

- **Programme** — the durable recurring commercial activity; and
- **Occurrence** — one year, cycle, phase, tender or work package.

The source release is additive and preserves the existing weekly sales
experience. It does not run a migration, backfill production projects, create a
sales action, call a provider or alter Full Potential monetary values.

## Core invariants

1. A prior occurrence is never date-rolled to represent the next cycle.
2. Same programme + same cycle + same package updates the existing occurrence.
3. Same programme + a new cycle creates a new occurrence.
4. A materially different package in the same cycle requires review and may
   become a separate occurrence.
5. A source repeat with no material change creates no occurrence update and no
   new weekly recommendation.
6. One project can link to only one recurring occurrence.
7. Several preserved project rows may support one occurrence, but only one may
   be marked canonical.
8. Recurring participation is a non-counting application overlay and does not
   create separate Full Potential revenue.
9. A weekly recommendation is not a durable sales action. The user must accept
   it before any action can be created.
10. Existing weekly-page content remains usable when no recurrence data exists.

## Programme

A recurring programme stores the durable commercial identity:

- stable programme key and name;
- annual, quarterly, monthly, rolling or irregular recurrence;
- buyer, site, state and region;
- optional canonical Full Potential account;
- route to market and sales owner;
- product-family and application tags;
- normal planning lead time;
- next expected commercial window;
- source, confidence and review status.

A programme is not a project and does not carry its own Full Potential monetary
pool.

## Occurrence

Each occurrence stores one specific cycle:

- stable occurrence key;
- cycle and package labels;
- anticipated and confirmed dates;
- status;
- prior occurrence link;
- canonical project reference;
- scope and source fingerprints;
- source evidence and changes from the prior cycle.

Historic project records are linked rather than deleted. The project-link table
supports canonical, supporting-source, historic-duplicate and related-package
relationships while enforcing one recurring occurrence per project.

## Cycle identity

Deterministic cycles use:

- annual: `YYYY`;
- quarterly: `YYYY-Qn`;
- monthly: `YYYY-MM`.

Rolling and irregular programmes require an explicit cycle label and explicit
next window. The system must not invent a cadence from insufficient evidence.

An occurrence key combines:

```text
programmeKey : cycleLabel : packageKey
```

This distinguishes a new cycle from a changed source and prevents a materially
different package from overwriting the primary occurrence.

## Weekly sales integration

When an occurrence enters the programme's planning lead-time window, the system
may project a compact recommendation containing:

- account/project;
- recurring programme;
- current cycle;
- why now;
- expected commercial window;
- linked market signal;
- Full Potential product/application context;
- recommended action;
- Accept / Defer / Not relevant.

The recommendation contract always returns:

```text
requiresUserAcceptance = true
durableActionCreated = false
countingTreatment = application_overlay_non_counting
fullPotentialMonetaryImpactAud = 0
```

No broad weekly-page redesign is included in the first source release. The
existing project cards may later display recurrence context only when the
programme/occurrence data and read path are deployed.

## Schema

The source defines:

- `recurringProjectProgrammes`;
- `recurringProjectOccurrences`;
- `recurringProjectOccurrenceProjects`;
- `recurringProjectRecommendationDecisions`;
- `recurringProjectAuditEvents`.

`RECURRING_PROJECT_RUNTIME_WRITES_ENABLED` remains `false` in the first source
release. Registering the schema with Drizzle does not apply a database migration.

## Preview-only planner

The planning manifest provides a deterministic SHA-256 review package for:

- programme creation/reference;
- occurrence create/update/no-change/manual-review classification;
- proposed historical project links;
- optional weekly recommendation projection;
- explicit zero-side-effect invariants.

It records zero:

- database connections and writes;
- project date mutations, deletions or merges;
- Full Potential financial mutations;
- durable actions;
- CRM/C4C writes;
- provider calls;
- pipeline invocations.

A later migration/backfill task must use a bounded production snapshot, produce
its own before/after manifest and obtain approval before any write.

## Manual first release

After the schema migration is separately approved, the first operational release
should permit authorised users to:

1. mark a project as recurring;
2. create or select the programme;
3. create or select the occurrence;
4. link preserved historical duplicate/source projects;
5. set recurrence type, lead time and next expected window;
6. reject an incorrect programme/occurrence link;
7. review a weekly recommendation;
8. accept, defer or mark it not relevant.

Automatic recurrence detection follows only after the manual model and audit
trail are proven.

## Deployment gates

Before runtime writes can be enabled:

1. exact source release and tests pass;
2. migration SQL is generated and reviewed;
3. a production read-only project snapshot is taken;
4. candidate programme/occurrence backfill is previewed and hashed;
5. duplicate and package-boundary exceptions are reviewed;
6. database backup/rollback path is confirmed;
7. migration is applied in a quiet window;
8. post-migration schema and row counts are attested;
9. runtime writes are enabled in a separate reviewed release;
10. the weekly page is verified to remain unchanged when no recurrence context
    exists.
