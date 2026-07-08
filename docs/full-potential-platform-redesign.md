# Full Potential Platform Redesign Spec

## 1. Purpose

Compass should move from a project-intelligence-first tool to a Full Potential operating platform for Atlas Copco APE Oceania.

The platform’s job is not to show every project, tender, article, contact or signal. Its job is to help the sales team and channel partners answer three questions every week:

1. Which accounts should I focus on?
2. Why now?
3. What action should I take next?

Full Potential becomes the account strategy layer. Project intelligence becomes the signal layer. C4C remains the official CRM once an opportunity is qualified.

## 2. Current-state assessment

The current platform already has strong foundations:

- React / TypeScript / Express / tRPC / Drizzle / MySQL stack.
- Existing routes for This Week, Pipeline, Account Attack, Account Priors, Collateral, Campaigns, Contact Validation and Admin.
- Rich project-intelligence model with lifecycle status, product lane, sector, source purpose, tender close date, geography guard and contact discovery state.
- Account Attack already works as an internal-data-first account-planning cockpit.
- Lane scoring already recognises several portable-air applications: drilling, blasting, piling, shutdown, commissioning, abrasive blasting, temporary plant air, air treatment, pipeline testing, purging, inerting, high-pressure boosters and specialty air packages.

The main gap is not technical capability. The main gap is the operating model.

Current platform logic is mostly:

```text
Project intelligence -> rep action -> contact enrichment -> pipeline claim
```

Target logic should be:

```text
Full Potential account universe -> priority account status -> project/signal activation -> rep/channel action -> qualified opportunity -> C4C
```

## 3. Design principle

Project urgency must not outrank strategic fit.

A tender closing tomorrow is not useful if it does not match a Full Potential account, application, route-to-market rule or product play. Fit comes first; urgency comes second.

## 4. Full Potential operating hierarchy

The platform should recognise four layers:

1. **Full Potential Universe** — all mapped accounts, sites, channel records, competitor-watch rows, service contractors, lookalikes and signal clusters.
2. **Prioritised Full Potential** — account records classified by status and route-to-market.
3. **2026 Target Slice** — the validated execution subset linked to the 34.5M target.
4. **Weekly Sales Rhythm** — the immediate actions shown to reps, channel partners and managers.

The workbook remains the governance/build model. Compass becomes the operating interface.

## 5. Full Potential account statuses

Every Full Potential record should have one primary status:

| Status | Meaning | Usage |
|---|---|---|
| Active Target | Included in the 2026 execution plan | Must appear in rep/channel rhythm |
| Develop | Real account/opportunity, not yet in 2026 target | Monthly/90-day development actions |
| Watch | Strategic account or site waiting for trigger | Activated by project/AI/sales signal |
| Qualify | Suspect, lookalike or incomplete record | Validate before C4C or rep workload |
| Channel Managed | CEA / CP / NZ / distributor-led | Channel view, not direct-rep default |
| Park | Known but low priority or poor fit now | Do not push to reps |
| Exclude | Not relevant to APE Full Potential | Suppressed from operating views |

## 6. Row classes

The quality-gated Full Potential database currently separates records by row class. The platform should preserve this distinction.

| Row class | Meaning |
|---|---|
| Account | A sales/account entity that can be assigned to an owner |
| Site Context | Mine site, LNG site, refinery, shipyard, infrastructure precinct or similar context record |
| Channel Managed | CEA / CP / NZ / distributor-led customer or channel record |
| Competitor Watch | Account/source mainly useful for blind-spot or competitor monitoring |
| Cluster / Signal Source | Not a single account; used to trigger discovery or signal matching |

This matters because not every row should become a rep action.

## 7. Route-to-market rules

The platform must enforce route-to-market logic before recommending action.

### Australia — Atlas Copco

| Scope | Default route |
|---|---|
| WA >600 cfm / specialty / electric | Ryan Pemberton |
| QLD + NSW >600 cfm / specialty / electric | Paul Lueth |
| VIC / SA / TAS / NT / other AU >600 cfm / specialty / electric | Dan Day |
| AC <600 cfm Australia | CEA |
| Coates all portable air | Direct key account; Ryan / APE managed |
| EPSA all portable air | Direct key account; Dan / APE managed |
| Onsite Rental | CEA-owned strategic account |

### CP / channel

| Scope | Route |
|---|---|
| CP main states | APS |
| Blasting-type CP customers | BlastOne |
| Regional WA future CP route | Pneumatic Engineering |
| FNQ future CP route | More Air |

### NZ / Oceania

| Scope | Route |
|---|---|
| NZ AC + CP | Distributor-led, included in 34.5M target |
| PNG / smaller Oceania | Track separately as upside; not core near-term plan |

## 8. User journeys

### Ryan Pemberton

Primary view:

- WA Active Targets.
- Coates key account.
- WA Develop / Watch accounts.
- Mine-site and contractor signals attached to WA accounts.
- Rental/hire strategic adjacency where >600 cfm, electric, dryers, boosters or specialty are plausible.

### Paul Lueth

Primary view:

- QLD / NSW Active Targets.
- Drilling, well services, LNG/CSG, mining, civil and industrial services.
- Direct >600 cfm, specialty, electric and dryer/booster/N2 opportunities.

### Dan Day

Primary view:

- VIC / SA / TAS / NT / other AU markets.
- EPSA key account.
- Civil, industrial, quarry, marine/fabrication and specialty opportunities.

### CEA / channel users

Primary view:

- AC under-600 customer base.
- Onsite Rental strategic account.
- Channel-managed Full Potential accounts.
- Handover items where direct APE needs to support >600 cfm, electric, dryers or specialty adjacency.

### CP distributors

Primary view:

- CP-specific channel accounts.
- Blasting / rental / service / regional coverage opportunities.
- Distributor status and next actions.

### Manager / BLM

Primary view:

- Full Potential universe value and coverage.
- Active Target progress against 34.5M.
- Route/owner gaps.
- Rep/channel engagement.
- Overdue next actions.
- AI/project signal conversion.
- Installed-base validation progress.

## 9. Proposed navigation

Recommended top-level navigation:

```text
My Week | Full Potential | Account Attack | Signals | Pipeline | Campaigns | Admin
```

### My Week

Purpose: What must I do this week?

Sections:

- Top 3 account actions.
- Active Target actions due.
- New signal against a Full Potential account.
- Lookalikes to qualify.
- Contact discovery needed.
- Channel support / handover item.
- Overdue next actions.

### Full Potential

Purpose: What is my account universe and where do I focus?

Views:

- Active Target.
- Develop.
- Watch.
- Qualify.
- Channel Managed.
- Park.

Filters:

- Owner.
- Route.
- State.
- Segment.
- Application play.
- Row class.
- Confidence.
- 2026 target flag.
- Platform push decision.

### Account Attack

Purpose: What do we know about this account and what do I do next?

Add a Full Potential header above the current Account Attack content:

- FP status.
- Owner.
- Route to market.
- Segment.
- Application play.
- Full Potential value.
- 2026 target value.
- Remaining potential.
- Installed-base known / unknown.
- Current supplier.
- Next action.
- Next action date.
- C4C status.

Existing linked projects, contacts, contractors, pairings and collateral should sit below this header.

### Signals

Purpose: Which market movements activate accounts?

Signals should be grouped by:

- Drilling campaign.
- Awarded project.
- Live tender.
- Shutdown / turnaround.
- Pipeline / commissioning.
- Mine-site activity.
- Civil application.
- Rental fleet signal.
- Competitor/channel signal.
- Contact discovery signal.

Every signal should answer:

```text
Does this activate an Active Target, Develop account, Watch account, Qualify account or no account?
```

## 10. Data model proposal

Do not force Full Potential into the current Account Priors table. Account Priors can be migrated or mapped later, but Full Potential needs its own first-class data model.

### Table: fullPotentialAccounts

Suggested fields:

- id
- canonicalName
- displayName
- parentGroup
- rowClass: account | site_context | channel_managed | competitor_watch | cluster_signal
- country
- state
- region
- segment
- subsegment
- applicationPlays: json array
- routeToMarket
- ownerName
- channelOwner
- fpStatus
- priorityTier
- platformPushDecision
- currentRevenueAud
- fullPotentialAud
- target2026Aud
- remainingPotentialAud
- evidenceSources: json array
- confidenceLevel
- currentSupplier
- installedBaseStatus
- installedBaseNotes
- c4cStatus
- nextAction
- nextActionDate
- sourceWorkbookVersion
- createdAt
- updatedAt

### Table: fullPotentialAccountAliases

Suggested fields:

- id
- accountId
- aliasName
- aliasType: legal_name | trading_name | abbreviation | misspelling | site_name | crm_name
- source
- confidence

### Table: fullPotentialSignals

Suggested fields:

- id
- accountId nullable
- projectId nullable
- signalType
- signalTitle
- signalSummary
- sourceUrl
- sourceName
- signalDate
- state
- applicationPlay
- routeToMarket
- urgency
- confidence
- suggestedAction
- status: new | reviewed | promoted | dismissed | archived

### Table: fullPotentialActions

Suggested fields:

- id
- accountId
- projectId nullable
- userId
- ownerName
- actionType
- recommendedAction
- dueDate
- status: not_started | in_progress | contacted | meeting_booked | quoted | won | lost | deferred | not_relevant
- notes
- createdAt
- updatedAt
- completedAt

### Table: fullPotentialImports

Suggested fields:

- id
- workbookVersion
- sourceFileName
- importedBy
- rowCount
- createdCount
- updatedCount
- skippedCount
- errorCount
- importedAt

## 11. Rental / Hire rule change

Current platform logic appears to suppress rental/hire too strongly. This conflicts with APE Full Potential.

New rule:

```text
Suppress generic rental noise, but surface rental/hire where it matches Full Potential, key-account exceptions, >600 cfm, electric, dryers, boosters, N2, fleet renewal, specialty air or channel adjacency.
```

Examples:

- Coates: direct key account, show to Ryan / APE.
- Onsite Rental: CEA-owned strategic, show in channel/manager view.
- Kennards / Flexihire / Brooks / Joy / Airpac / regional hire: show when application/size/evidence indicates >600 cfm, electric, dryer, specialty or fleet renewal adjacency.

## 12. Application play taxonomy

Main segments should stay narrow:

- Rental / Hire.
- Drilling / Well Services.
- Mining / Resources.
- Oil, Gas & Energy.
- Construction / Infrastructure.
- Industrial Services / Shutdown.
- Channel / Distributor.
- Other / Qualify.

Application plays provide the detail:

- RC / exploration drilling.
- DTH / blasthole drilling.
- Quarry drilling / blasting.
- Abrasive blasting / coatings.
- Plant air / temporary process air.
- Emergency backup air.
- Shutdown / turnaround air.
- Pipeline drying / pre-commissioning.
- Nitrogen purging / inerting.
- High-pressure booster / pressure testing.
- Dryers / air treatment.
- Portable electric / tough-stationary conversion.
- Shipyard / fabrication air.
- Civil tunnelling / piling / HDD.
- Contractor fleet renewal.
- CEA retail adjacency.
- CP channel opportunity.

## 13. Import strategy

Do not import everything into rep views immediately.

Use the quality-gated workbook output:

- Push Now -> visible in Full Potential and eligible for My Week.
- Push Context -> visible as context/signal matching, not rep action by default.
- Channel View -> visible to channel/manager users.
- Qualify First -> visible in Full Potential Qualify tab, not My Week unless activated.
- Park / Do Not Push -> admin only.

## 14. C4C relationship

C4C remains the official CRM after qualification.

Compass should not bulk-create C4C leads. The sequence should be:

```text
Full Potential account -> validate route and application -> add/trigger action -> qualify account/opportunity -> create/update C4C only when real action exists
```

## 15. Adoption principle

The platform will be adopted only if it reduces mental load.

Each rep should see a short operating list, not a giant database:

- 5 accounts to focus on.
- 3 signals that matter.
- 3 overdue actions.
- 1 channel handover/support item.
- clear next action.

## 16. First implementation sprint plan

### Sprint A — Spec

Add this document to the repo and agree the architecture.

### Sprint B — Data model

Add Full Potential tables and migration.

### Sprint C — Full Potential UI shell

Add `/full-potential` route with filters, status tabs and account table.

### Sprint D — Account Attack integration

Add Full Potential account header to Account Attack.

### Sprint E — This Week integration

Refactor My Week to prioritise account actions and Full Potential signals.

### Sprint F — Rental suppression correction

Replace global rental suppression with Full-Potential-aware visibility.

### Sprint G — Importer

Import workbook output into Full Potential tables.

## 17. Definition of done for first release

A first useful release is complete when:

- Full Potential accounts can be imported.
- Users can filter accounts by status, owner, segment and route.
- Active Target and Develop accounts can appear in My Week.
- Account Attack shows Full Potential context.
- Generic project noise is suppressed behind account/application fit.
- Channel-managed accounts are visible without polluting direct-rep workload.
- Manager can see coverage, ownership and overdue action gaps.
