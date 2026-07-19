# Full Potential AI daily activation

## Purpose

This release embeds a grounded **AI Next Best 5** into the existing This Week workflow so Full Potential intelligence becomes part of normal sales activity rather than a separate dashboard that reps must remember to visit.

It is the final Full Potential V1 feature release before the controlled operating pilot.

## Commercial sequence

```text
account and market evidence
→ grounded recommendation
→ rep accepts, edits, defers or rejects
→ evidence-generating Full Potential action
→ verified evidence and approved model
→ genuine attributed pursuit
→ formal C4C handoff when qualified
```

Compass remains the intelligence, prioritisation and source-attribution layer. It is not a second CRM.

## Data reused

The recommendation service uses existing records only:

- Full Potential account ownership, tier, status and push decision;
- Full Potential actions and due dates;
- directly linked Full Potential signals;
- recent project intelligence matched to account names and aliases;
- evidence and evidence verification status;
- model versions, review state and positive product-family lines;
- attributed Full Potential pursuits;
- account next-action, installed-base and supplier gaps.

No new database table or migration is introduced.

## Recommendation ranking

Each eligible owned account produces at most one current recommendation. The ranking prioritises:

1. returned models needing correction;
2. submitted models awaiting manager review;
3. overdue Full Potential commitments;
4. hot or warm grounded signals without an open signal action;
5. approved models without an attributed pursuit;
6. active pursuits needing the next customer-validation step;
7. verified evidence awaiting a model;
8. draft evidence awaiting verification;
9. accounts with no commercial evidence;
10. missing or stale next actions;
11. installed-base and supplier validation gaps.

Tier, platform push decision and Full Potential status adjust the score, but do not override evidence or workflow gates.

## Ownership

Normal users receive recommendations only for accounts whose internal or channel owner string matches their name or email. Admin users receive the full eligible account universe and can view the manager roll-up.

Distributor users are blocked by both UI and server access controls.

## Grounding and AI safety

Every recommendation includes:

- why the account matters now;
- uncertainties and missing evidence;
- recommended evidence-generating action;
- expected commercial outcome;
- product-family hypothesis and confidence;
- source references.

Product-family hypotheses are selected in this order:

1. highest positive line in an approved model;
2. verified product-family evidence;
3. signal or project keywords;
4. account application context;
5. unknown.

The on-demand AI brief receives only the structured recommendation and its displayed sources. The prompt explicitly forbids invention of fleet size, supplier, contact, timing, customer intent or commercial value. If the AI service fails or returns invalid output, the server returns a deterministic grounded fallback.

The AI never:

- creates or approves a model;
- writes account financial values;
- starts a pipeline pursuit;
- updates C4C;
- invents contacts or fleet data;
- closes an action without a human response.

## Rep feedback

A rep may:

- accept the action as recommended;
- edit and accept it;
- defer it to a future date;
- reject it with a reason;
- mark it not relevant with a reason.

Responses reuse `fullPotentialActions` and contain an auditable marker:

```text
[fp_daily:<recommendationKey>]
FP daily decision: <decision>
```

Accepted, edited and deferred recommendations create an open Full Potential action. Rejected or not-relevant recommendations create a closed `not_relevant` record so the reason remains reportable and the same recommendation does not reappear as pending.

The service revalidates the current recommendation against the signed-in user before writing. Stale or no-longer-owned recommendations are rejected.

## Manager roll-up

Admins see an exception and conversion summary:

- recommendations issued and pending;
- accepted, edited, deferred, rejected and not-relevant responses;
- evidence added this week;
- models submitted and approved this week;
- attributed pursuits started this week;
- accounts with no account next action, open FP action or active attributed pursuit;
- pending, responded and stalled counts by owner.

This is not a forecast review. It does not show forecast probability, quote administration or a parallel opportunity board.

## API

```text
GET  /api/full-potential/daily-activation
POST /api/full-potential/daily-activation/respond
POST /api/full-potential/daily-activation/brief
```

All responses use `Cache-Control: private, no-store`.

## UI

`FullPotentialNextBest5` is mounted alongside the existing Full Potential action dock on This Week:

- Next Best 5 appears bottom-left;
- existing due/overdue FP actions remain bottom-right;
- desktop opens the recommendation dock by default;
- mobile keeps it collapsed until selected;
- manager roll-up is admin only.

## Release boundary

This release contains:

- no database migration;
- no new general-purpose task or feedback table;
- no contact master;
- no pipeline stage editor;
- no forecast or quote workflow;
- no email sequence;
- no automatic pursuit creation;
- no autonomous account, model or financial write;
- no C4C write.

## Validation

Run:

```bash
pnpm install --frozen-lockfile
pnpm tsc --noEmit
pnpm build
pnpm exec vitest run \
  server/fullPotentialDailyActivation.shared.test.ts
```

Production deployment smoke validation must be read-only:

1. internal user can load the Next Best 5 dock;
2. recommendations contain source references and uncertainty text;
3. admin can open the manager view;
4. distributor access returns HTTP 403 and the UI does not render the dock;
5. on-demand brief may be generated only after preflight counts are captured;
6. no recommendation response is submitted during deployment validation;
7. `fullPotentialActions`, commercial-model tables and `pipelineClaims` remain unchanged.

The first live recommendation response belongs to the operating pilot and requires an explicit dry-run review of the recommendation and intended action before submission.
