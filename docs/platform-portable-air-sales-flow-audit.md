# Compass platform audit — Portable Air sales flow

**Audit baseline:** GitHub main `478a41ef8722c61d06aa780591aa6796684b4b95`  
**Production baseline:** PR #57 Top-five Full Potential Pilot  
**Audit objective:** reduce noise, make the weekly page the daily operating surface, connect market/project intelligence to the Full Potential account universe, and increase attributable commercial opportunities without turning Compass into a second CRM.

---

## 1. Executive finding

The platform contains the right building blocks, but they are still arranged as separate products:

- **This Week** is the clean, personalised weekly action board.
- **Market Intelligence Dashboard** is the broad exploration layer.
- **Account Attack** is an owner/contractor research cockpit.
- **Full Potential** is the canonical account universe and commercial model.
- **Pipeline** is the attribution anchor.

The commercial break is between project intelligence and the account/buying entity that can purchase Portable Air. The dashboard still presents a project-first browsing experience, while the sales motion should be:

```text
Project / award / tender / drilling signal
→ confirmed or likely contractor / buying entity
→ canonical Full Potential account
→ accountable rep and route to market
→ evidence-generating action
→ attributed pursuit
→ formal C4C opportunity when qualified
```

The next platform work should not add more independent screens. It should connect the existing project, contractor and Full Potential layers and make the result visible in **This Week**.

---

## 2. Product boundary

### Compass owns

- identifying a relevant market or project signal;
- explaining why it matters now;
- resolving the likely buying route;
- matching the signal to a canonical Full Potential account;
- showing evidence, uncertainty and product-family relevance;
- recommending the next evidence-generating action;
- capturing rep accept/edit/reject feedback;
- preserving source attribution when a pursuit begins.

### C4C owns

- formal account and contact master;
- qualified opportunity record;
- forecast category, probability and official value;
- quote and proposal administration;
- formal sales activity history;
- win/loss and order record.

The platform should not add a second contact database, opportunity board, forecast, quote workflow, meeting log or sales activity ledger.

---

## 3. Screenshot and navigation audit

### 3.1 This Week

The weekly page is currently the strongest screen:

- low-noise KPI strip;
- Top 3 Actions;
- action-ready, closing-soon and contact sections;
- lane and territory context;
- Full Potential action dock.

It should remain the primary post-login view.

#### Navigation defects

1. The active **Dashboard** item links to `/`, which is actually **This Week**.
2. The real Market Intelligence Dashboard is `/dashboard`, but it is not in the weekly navigation.
3. The **WA Targets** item links to `/account-priors`, a pump/flow account-prior page, and is visible to Portable Air users.
4. Navigation is duplicated across pages rather than supplied by one shared application shell.

#### Required correction

For the weekly page:

```text
This Week          → /
Explore Projects   → /dashboard
Full Potential     → /full-potential
Account Intelligence → /account-attack
Pipeline           → /pipeline
My Style           → /my-profile
Admin              → /admin (admin only)
```

`WA Targets` should not appear for Portable Air users. The route and underlying `accountPriors` data should not be deleted because pump/dewatering ranking still uses them. It should be shown only to pump/dewatering users or admins, and labelled **Pump Targets**, not as a generic platform tab.

### 3.2 WA Targets page

The page is a purpose-built WA pump/flow target list. It is not the Portable Air Full Potential universe and should not be presented as a general sales-navigation destination.

Recommended state:

- retain the route and data for pump/dewatering users;
- remove it from the Portable Air navigation;
- stop using it as a strategic-account source for Portable Air ranking;
- migrate any genuinely shared accounts into Full Potential rather than exposing the pump list to everyone.

### 3.3 Market Intelligence Dashboard

The dashboard is powerful but overloaded:

- broad project list;
- overview and action summaries;
- awarded projects;
- drilling campaigns;
- live tenders;
- AI search;
- contacts;
- contractors;
- sources and methodology;
- multiple global and advanced filters;
- large card stack.

The screenshot shows the result: many projects, many tabs and a large scroll surface, but insufficient emphasis on the actual Portable Air buying entity.

The screen should remain an **exploration layer**, one click from This Week, but its default Portable Air view must be commercially narrower.

---

## 4. Code-grounded findings

### Finding A — route naming is inconsistent

`client/src/App.tsx` maps:

```text
/ and /this-week → ThisWeek
/dashboard       → Home (Market Intelligence Dashboard)
```

`ThisWeek.tsx` labels `/` as **Dashboard**, leaving `/dashboard` undiscoverable. This directly explains the navigation problem.

### Finding B — Portable Air sees pump-specific account navigation

`ThisWeek.tsx` renders `WA Targets` for all desktop and mobile users. It does not check the assigned business line before showing `/account-priors`.

### Finding C — the two primary screens use different ranking architectures

**This Week** uses server-side `laneScoring.ts`, including:

- lane opportunity scores;
- route-to-buy clarity;
- hard opportunity gates;
- visibility suppression;
- contractor and contact context;
- reason codes and next action.

**Home / dashboard** uses client-side `personalization.ts`, which starts at a generic base score and adds territory, industry, matched business line, offer category, customer type, key account and feedback points.

Therefore the screens can disagree. A project suppressed or demoted by the weekly lane gate can still appear prominently in the broader dashboard. This is a major source of perceived noise.

**Decision:** server-side lane scoring must become the shared ranking/output source for both This Week and the project exploration dashboard.

### Finding D — the dashboard defaults to broad exploration

`Home.tsx` currently defaults to:

```text
activeTab          = overview
productLaneFilter  = all
priorityFilter     = all
actionTierFilter   = all
projectTypeFilter  = opportunity
lifecycleFilter    = active
```

Although territory and assigned business-line hard filters exist, the lane default and overview design still produce a large generic project set. For a Portable Air user, the default should be the user's primary lane and the most commercially useful buying-route view.

### Finding E — Portable Air account matching still uses the old pump account-prior table

`thisWeekService.ts` loads `accountPriors` and passes `matchAccountPrior()` into lane scoring. `laneScoring.ts` describes the boost as pump-specific, but the current service invokes the account-prior matcher while scoring every actionable project.

Portable Air now has a superior source of truth:

```text
fullPotentialAccounts
fullPotentialAccountAliases
relationshipType
recordStatus
countsTowardPotential
routeToMarket
ownerName
priorityTier
platformPushDecision
approved commercial model
```

The old pump prior list must not be the Portable Air strategic-account context.

### Finding F — Full Potential already has the canonical matching primitives

The signal importer already resolves Full Potential accounts by:

1. explicit account ID;
2. stable key;
3. normalised canonical/display name;
4. normalised alias.

This matching logic should be extracted into a reusable account-resolution service rather than reimplemented in dashboard components.

### Finding G — project intelligence is still owner-centred

The commercial buyer is often not the project owner. Account Attack already understands both:

- project-owner accounts;
- contractor accounts from `contractorRegistry` and `contractorProjectLinks`.

The dashboard should resolve every project entity in this order:

1. awarded / winning contractor;
2. confirmed contractor or EPC;
3. likely/provisional contractor, clearly labelled with confidence;
4. relevant supplier/channel partner;
5. project owner/end user as context, not automatically the target;
6. consultant or delivery-chain participant where commercially relevant.

### Finding H — Awarded and Contractors are isolated tabs, not account-linked sales views

The existing Awarded table contains the winning contractor, but does not show:

- whether that contractor is in Full Potential;
- canonical account name;
- internal owner;
- route to market;
- account tier or push decision;
- approved model / potential;
- existing Full Potential action or pursuit;
- recommended next move.

The Contractors tab and Account Attack contain useful contractor intelligence, but the user must manually search and connect it to Full Potential.

### Finding I — Full Potential is still a silo from market intelligence

Full Potential now has the account universe, evidence, models and pilot activation, but project cards do not surface account matches. Conversely, Full Potential accounts do not automatically show relevant project, award, tender or contractor signals.

This is the primary integration gap.

### Finding J — AI Search is useful but not embedded in the operating sequence

AI Search should remain a secondary hunting tool. It should follow the same commercial truth chain as the dashboard:

```text
project match
→ contractor / buying entity
→ Full Potential account
→ stakeholder discovery
→ evidence-generating action
```

It should not produce an isolated project result without account and route-to-buy context.

---

## 5. Recommended information architecture

### 5.1 Primary navigation

```text
This Week
Explore Projects
Full Potential
Account Intelligence
Pipeline
My Style
Admin
```

Conditional navigation:

```text
Pump Targets — pump/dewatering users and admins only
Campaigns — campaign-enabled users/admins only
```

### 5.2 This Week

This Week remains the operating page and should contain:

- Top 3 / Next Best 5 actions;
- project/award/tender signals matched to Full Potential accounts;
- account name and accountable owner;
- why now;
- confirmed/likely buying route;
- missing evidence;
- next action;
- direct links to the project and account workspace;
- accept/edit/reject/defer feedback.

### 5.3 Explore Projects dashboard

For Portable Air users, use these primary views:

1. **For You** — lane-gated and account-linked opportunities.
2. **Confirmed Contractors** — projects with a confirmed contractor/buying entity.
3. **Likely Contractors** — provisional contractor route with visible evidence and confidence.
4. **Awarded & Mobilising** — funded work with named contractor and timing.
5. **Live Tenders** — early action before award.
6. **All Intelligence** — broad exploration, not the default.

Secondary tools:

- AI Search;
- Contacts;
- Sources & Methodology.

`Drilling & Exploration` should become a segment/application filter or saved view rather than a separate isolated data product. It is important for Portable Air, but the selling route still needs to resolve to the contractor/account.

### 5.4 Project card

Each Portable Air project card should answer:

```text
What changed?
Why now?
What Portable Air application/product family fits?
Who buys?
Is the buying entity confirmed or likely?
Is it a Full Potential account?
Who owns the account internally?
What route to market applies?
What evidence is missing?
What should the rep do next?
```

Required account match panel:

- canonical Full Potential account;
- relationship role: awarded contractor / confirmed contractor / likely contractor / owner / channel;
- match confidence and source;
- account priority tier and push decision;
- internal owner and channel owner;
- route to market;
- approved potential/model state;
- open action or attributed pursuit;
- open Full Potential/account intelligence link.

---

## 6. Matching and data design

### 6.1 Reusable entity matcher

Extract a shared service from Full Potential signal matching:

```text
resolveFullPotentialAccount(candidateName)
resolveFullPotentialAccountsForProject(project)
```

Candidate sources:

- winning contractor;
- project `contractors[]`;
- contractor registry canonical name;
- project owner;
- contact company;
- aliases and known divisions.

Return:

```text
accountId
canonicalName
candidateName
relationshipRole
confidence
matchReason
isCountingRecord
recordStatus
routeToMarket
ownerName
priorityTier
platformPushDecision
```

### 6.2 Do not hard-link weak guesses

A `likely` contractor must not be silently treated as a confirmed account match.

Use distinct states:

```text
confirmed
likely_high
likely_medium
unresolved
```

Every likely match must show the supporting project source or contractor inference.

### 6.3 Avoid duplicate counting

Only active Full Potential records with `countsTowardPotential = true` should contribute to account metrics. Divisions and sites may still be displayed as context.

### 6.4 Initial implementation can be read-time matching

The first release can calculate matches at read time using the existing tables and aliases. A persisted project-account junction should be considered only if performance, review status or manual override requirements justify it. Do not add a table merely to duplicate searchable relationships.

---

## 7. Dashboard noise reduction rules

Portable Air default views should suppress or demote:

- projects outside the user's territory;
- non-Australian projects;
- stale/near-complete projects without a new buying event;
- generic schools, hospitals, prisons and unrelated buildings;
- small contractors/workshops/builders/tyre shops/general trade;
- compressor requirements below the strategic large/specialty-air threshold unless a specific product strategy says otherwise;
- projects with no credible contractor/buying route;
- owner-only records where the actionable route is a contractor and no contractor has been resolved;
- repeated programme wrappers and macro/background items;
- weak generic contacts.

Portable Air default views should promote:

- confirmed contractor wins and mobilisation;
- likely contractors with strong evidence;
- awarded projects;
- live tenders where contractor influence can begin early;
- drilling, blasting, pipeline testing, shutdown, commissioning and large/specialty-air triggers;
- Full Potential target-account matches;
- new evidence or changed timing;
- accounts without a current next action;
- signals tied to an accountable rep and route to market.

---

## 8. Immediate changes versus deeper work

### Immediate, low-risk navigation change

1. Rename `/` navigation from **Dashboard** to **This Week**.
2. Add **Explore Projects** linking to `/dashboard`.
3. Remove **WA Targets** from Portable Air desktop/mobile navigation.
4. Show **Pump Targets** only for pump/dewatering users or admins.
5. Add a clear `Explore all projects` link from the weekly action board.

### Deeper integration work

1. Extract Full Potential canonical account matching.
2. Match confirmed/likely project contractors to Full Potential.
3. Replace dashboard client-only ranking with shared server lane scoring.
4. Add Full Potential context to project and awarded/contractor views.
5. Restructure the dashboard around For You / Confirmed / Likely / Awarded / Tenders.
6. Feed the account-linked results into This Week and the AI daily-activation loop.

---

## 9. Clean implementation sequence

### PR A — navigation and platform shell

- correct This Week versus Dashboard naming;
- add one-click Explore Projects navigation;
- conditionally hide Pump Targets;
- introduce a shared top navigation component;
- no schema or business-logic changes.

### PR B — Full Potential project-account matching

- shared canonical/alias resolver;
- confirmed and likely contractor relationship output;
- Full Potential account context on project queries;
- unit/integration tests against isolated test DB;
- no dashboard redesign yet.

### PR C — Portable Air project dashboard

- default Portable Air lane from profile;
- common server lane-scoring output;
- For You / Confirmed / Likely / Awarded / Tenders views;
- account-match and route-to-buy context;
- broad intelligence preserved as secondary.

### PR D — This Week and AI daily activation

- Next Best 5 combines account readiness and current project/award/tender signals;
- sourced why-now brief;
- evidence gaps and next action;
- rep accept/edit/reject/defer feedback;
- manager conversion and exception roll-up;
- no autonomous claims, financial values or CRM writes.

After PR D, pause feature development and run the operating pilot.

---

## 10. Success measures

The redesign is successful only if it increases commercial movement, not merely engagement.

Track:

- recommendations shown to the accountable rep;
- recommendations accepted, edited, rejected or ignored;
- contractor/account matches reviewed;
- evidence added;
- Full Potential models approved;
- attributed pursuits started;
- qualified opportunities handed to C4C;
- time from signal to first customer action;
- rejection reasons and false-positive categories.

For the five-account pilot, the minimum proof remains:

- five explicit account decisions;
- at least three evidence-backed pursuits;
- at least two substantive customer conversations;
- at least one qualified C4C opportunity or quote;
- traceability from signal/project → account → model → pursuit → C4C.

---

## 11. Audit conclusion

Do not continue adding independent Full Potential or dashboard screens. The platform's next value comes from joining the systems already built.

The highest-priority correction is:

```text
Use project intelligence as a signal,
resolve the contractor/buying entity,
match it to Full Potential,
and put the resulting action in This Week.
```

The immediate navigation cleanup can proceed first. The main dashboard redesign should follow only after the shared Full Potential account-matching service is in place, otherwise the UI will be reorganised without fixing the underlying commercial relevance problem.
