# Full Potential — Read-only Next Best 5

## Purpose

The first Next Best 5 release is a **read-only intelligence layer** embedded in This Week. It is deliberately not a task manager, opportunity board or CRM workflow.

It answers five practical questions for an internal sales rep:

1. Which evidence-backed projects deserve attention first?
2. Which canonical Full Potential account and buying route are involved?
3. Why does the signal matter now?
4. What remains uncertain?
5. What evidence-generating action should the rep take next?

## Source of truth

The candidate pool is the untouched `thisWeek.summary.topProjects` array. The service preserves that exact server order and never creates a second ranking model.

A project is eligible only when all of the following are true:

- `visibilityTier = must_act_candidate`
- `actionTier = tier1_actionable`
- `priority = hot`
- lifecycle is active
- the record is not suppressed or merged
- at least one persisted source URL is present
- the persisted project text contains explicit compressed-air evidence
- the canonical buying route is confirmed or likely-high
- linked to a contractor, EPC, subcontractor, rental, supplier or awarded-contractor buying role; project-owner fallback is allowed only for explicit Direct CAPEX
- the matched account has no open Full Potential action
- the matched account has no active attributed pursuit
- the account is owned by the authenticated rep, unless the caller is an admin

The service returns fewer than five recommendations when fewer than five projects clear the full bar. It does not fill the list with lower-quality records. Only the first eligible project for each canonical account is retained, preserving the server order while avoiding five recommendations for one account.

## Evidence policy

AI-inferred `equipmentSignals` are not sufficient evidence. Eligibility uses persisted project text such as the project overview, opportunity note and opportunity route.

Supported evidence includes explicit references to:

- portable or compressed-air equipment
- compressor packages, CFM or pressure requirements
- exploration or production drilling, blast-hole, aircore, RC or DTH work
- piling tied to compressed air, or explicit pneumatic-tool packages
- abrasive blasting
- temporary plant air or commissioning air
- pneumatic or compressed-air pressure testing
- purging, inerting, nitrogen or dry-out work
- booster duty
- dryers or instrument-quality air

Generic references to shutdowns, hydrotests, piling or surface preparation do not qualify without a separate air-use statement.

## Recommendation card

Each card displays:

- server rank and project relevance
- project and canonical account links
- confirmed or likely buying route
- accountable internal owner
- why-now explanation
- stored evidence and source links
- unresolved commercial questions
- evidence-backed product-family hypothesis
- a recommended evidence-generating action
- expected commercial outcome

Likely account routes are presented as validation work, not confirmed facts. Product-family guidance is derived from the same persisted text that passed the evidence gate; inferred equipment tags cannot select the product hypothesis.

## CRM boundary

Compass owns intelligence, prioritisation, evidence gaps, canonical account context and source attribution.

C4C remains authoritative for:

- formal contacts
- qualified opportunities
- forecast
- quotes and proposals
- formal customer activity
- win/loss and order records

The read-only release creates no action, pursuit, pipeline claim, email, evidence record, model or C4C record.

## Endpoint

```text
GET /api/full-potential/next-best-5
```

Controls:

- authentication before service access
- distributor access denied
- `Cache-Control: private, no-store`
- GET only
- no mutation handler in this release

## Deliberate exclusions

This release does not include:

- accept, edit, defer or reject controls
- action creation
- manager roll-up
- autonomous AI calls
- financial-value generation
- opportunity-stage management
- forecasting
- contact management
- C4C writes

Rep-response and manager-exception workflows may be considered only after the team has reviewed and trusted the read-only recommendations in normal weekly use.
