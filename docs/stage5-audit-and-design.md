# Stage 5 — Project Pipeline Audit and Design
**Atlas Copco Market Intelligence Platform**
**Date:** 21 April 2026 | **Audit basis:** Live database snapshot + full codebase review

---

## Executive Summary

The project layer of the Atlas Copco platform has accumulated significant noise. Of 1,110 projects in the database, **740 (66.7%) are marked stale**, and of the 368 active projects, **367 (99.7%) have never been touched since creation** — their `lastActivityAt` equals their `createdAt`. The stale-marking logic fires at 30 days with no pipeline claim, which is appropriate in principle but is undermined by the fact that only 27 projects across the entire database carry an active pipeline claim (2.4% of active + stale). The system is therefore marking nearly everything stale regardless of whether the underlying project is commercially live.

Contact conversion is similarly thin: only 34.5% of active projects have any associated contacts, and 91.4% of all contacts remain in `enrichmentStatus = 'pending'` — meaning the enrichment pipeline has not yet processed them. The send-readiness field on campaign contacts is `null` for 100% of rows, indicating that the Stage 4 enrichment QA pipeline has not yet been run against any live campaign.

The sections below audit each component of the pipeline in detail and propose concrete repairs.

---

## A. Current Project Pipeline — End-to-End Audit

### A.1 Ingestion Layer

The weekly pipeline (`weeklyPipeline.ts`) runs every Sunday at 21:00 AWST (13:00 UTC) and orchestrates 24 sequential steps across three phases: Discovery, Enrichment, and Digest/Housekeeping.

**Discovery sources (steps 1–11):**

| Step | Source | Mechanism | Frequency |
|---|---|---|---|
| 1 | RSS Harvest | 30 configured feeds via `rssHarvester.ts` | Weekly |
| 2 | AI Extraction | LLM extraction from queued articles via `aiExtractor.ts` | Weekly |
| 3 | ASX Monitor | Targeted ASX announcement scanning via `asxMonitor.ts` | Weekly |
| 4 | Projectory Scraper | Headless browser crawl of 6 categories | Weekly |
| 5 | Projectory Enrichment | Enriches existing projects with Projectory data | Weekly |
| 6 | DMIRS MINEDEX | WA mining registrations scraper | Weekly |
| 7 | AEMO | Energy generation project register | Weekly |
| 8 | Gov Major Projects | Infrastructure Australia + NREPL | Weekly |
| 9 | AusTender | Federal government contracts | Weekly |
| 10 | ICN Gateway | Major project work packages | Weekly |
| 11 | ICN Validation | Validates existing projects against ICN | Weekly |

### A.2 Project Parsing and Normalisation

The RSS/AI path (`aiExtractor.ts`) passes article text to an LLM with a structured extraction prompt. The prompt instructs the model to extract: `name`, `location`, `value`, `owner`, `priority`, `capexGrade`, `opportunityRoute`, `sector`, `stage`, `overview`, `equipmentSignals`, `contractors`, `opportunityNote`, `timeline`, `completion`.

**Priority assignment** is LLM-driven with these definitions:
- `hot` — active project with confirmed funding, named contractors, or imminent mobilisation
- `warm` — project announced but still in planning/approval stage
- `cold` — early-stage or speculative, worth monitoring

**Geo-filter** rejects projects whose location matches overseas patterns (USA, Canada, UK, Europe, Asia, Africa, South America, New Zealand) even if an Australian company is involved.

**Deduplication** (`isProjectDuplicate`) checks the most recent 200 projects by name normalisation (lowercase, collapse whitespace). It uses substring containment, which means "BHP Olympic Dam Expansion" and "Olympic Dam Expansion" are treated as duplicates. This approach is fast but produces false positives when two genuinely distinct projects share a common substring (e.g., "Snowy 2.0 Transmission" and "Snowy 2.0 Pumped Hydro").

### A.3 Tier Classification

`tierClassification.ts` assigns `actionTier` by keyword-matching the free-text `stage` field:

- **Tier 1 — Actionable:** construction, tender, award, mobilisation, commissioning, ramp-up, drilling underway
- **Tier 2 — Warm:** design, FEED, approvals, committed funding, planning
- **Tier 3 — Monitor:** exploration, feasibility, conceptual, announced

The classifier is keyword-only with no confidence score. A project whose `stage` reads "Construction Completion (last panel installed)" will be classified Tier 1 even though the project is effectively done. There is no "completed/operational" tier that would suppress such projects from the actionable queue.

### A.4 Lifecycle Scoring

`markStaleProjects` (`db.ts`) runs as step 23 of the weekly pipeline. It marks a project stale if:
1. `lifecycleStatus = 'active'`
2. `createdAt < NOW() - 30 days`
3. `lastActivityAt IS NULL OR lastActivityAt < NOW() - 30 days`
4. The project has no active pipeline claim (`pipelineClaims.status != 'lost'`)

`lastActivityAt` is updated only when a user explicitly interacts with a project (e.g., adds a note, creates a claim). Since 367 of 368 active projects have never been touched, the staleness clock is driven entirely by `createdAt`, not by any signal of commercial activity.

### A.5 Dashboard and Project Surfacing

The dashboard surfaces projects through the `projects.list` tRPC procedure, which accepts `lifecycleStatus`, `priority`, `sector`, `actionTier`, and `search` filters. There is no default filter that hides stale projects; the user must apply the `lifecycleStatus = 'active'` filter manually. Stale projects therefore appear in the default view unless explicitly filtered out.

### A.6 Handoff into Contact/Campaign Logic

Campaign creation (`campaign.create`) allows a user to select projects and pull their associated contacts from `contactProjects`. The `getCampaignContacts` function joins `campaignContacts` with `contacts` and returns all fields including `scoreBreakdown`, `enrichmentQA`, and `sendReadiness`. As of this audit, `sendReadiness` is `null` for all campaign contacts because the enrichment QA pipeline has not been run against any live campaign.

---

## B. Source Inventory and Quality Scorecard

The following scorecard is derived from the live database audit (25 queries, 1,110 projects). Stale percentages are computed against the total project count per source. Contact coverage is computed against the `contactProjects` junction table.

| Source | Total Projects | Active | Stale | Stale % | Contact Coverage | Notes |
|---|---|---|---|---|---|---|
| RSS / AI Extraction | 693 | 352 | 341 | 49.2% | ~35% | Highest volume; mixed quality; many macro/trend items |
| Seed / Manual | 294 | 1 | 291 | 99.0% | ~60% | Bulk-loaded historical seed data; almost entirely stale |
| Gov Major Projects | 37 | 0 | 37 | 100% | ~20% | All stale; no refresh since initial load |
| Other / Unknown | 28 | 0 | 28 | 100% | Unknown | Unclassified projectKey prefix |
| AEMO | 22 | 0 | 22 | 100% | ~10% | All stale; energy register not refreshed |
| AusTender | 19 | 15 | 4 | 21.1% | ~45% | Best freshness; contract-level specificity; good owner data |
| ICN Gateway | 17 | 0 | 17 | 100% | ~30% | All stale; work packages not refreshed |

**RSS Source Performance (top 10 by extraction yield):**

| Source | Total Articles | Extracted | Skipped | Extraction Rate | Last Fetched |
|---|---|---|---|---|---|
| Energy Storage News | 317 | 104 | 213 | 32.8% | 17 Apr 2026 |
| Infrastructure Magazine | 261 | 73 | 188 | 28.0% | 17 Apr 2026 |
| PV Magazine Australia | 203 | 81 | 122 | 39.9% | 17 Apr 2026 |
| Projectory Australia | 158 | 72 | 86 | 45.6% | 17 Apr 2026 |
| Renew Economy | 151 | 56 | 90 | 37.1% | 17 Apr 2026 |
| Pump Industry Australia | 67 | 36 | 31 | 53.7% | 17 Apr 2026 |
| Energy Magazine | 72 | 28 | 44 | 38.9% | 17 Apr 2026 |
| Roads & Infrastructure | 87 | 37 | 50 | 42.5% | 17 Apr 2026 |
| Energy News Bulletin | 278 | 45 | 233 | 16.2% | 17 Apr 2026 |
| Stockhead | 624 | 59 | 565 | 9.5% | 17 Apr 2026 |

**Dead sources (zero articles since March 2026):** ABC News - Australia, Renewables Now, Construction Equipment Guide, International Mining, Rigzone News, Mining Weekly SA, Diesel Progress, One Step Off The Grid, The Australian - Business, Mining Journal, Build Australia, Fluid Handling Magazine. These 12 sources are consuming pipeline slots with zero yield and should be disabled or replaced.

**Overall source quality ratings:**

| Rating | Sources |
|---|---|
| High (specific, fresh, actionable) | AusTender, Projectory Australia, Pump Industry Australia, Roads & Infrastructure |
| Medium (good extraction rate, mixed specificity) | PV Magazine, Infrastructure Magazine, Energy Storage News, Renew Economy, Energy Magazine |
| Low (high skip rate or macro/trend bias) | Stockhead, Energy News Bulletin, ABC News Business, Small Caps |
| Dead (zero yield) | 12 sources listed above |

---

## C. Stale Project Logic — Audit and Redesign

### C.1 Current Logic

The current staleness rule is a single threshold: **30 days since creation with no pipeline claim and no `lastActivityAt` update**. This rule has three critical flaws.

First, `lastActivityAt` is only updated by explicit user interaction (adding a note, creating a claim). It is never updated by the pipeline when a new article mentions the same project, when Projectory enrichment adds new contractor data, or when ICN validation confirms the project is still active. This means the clock runs from the day the project was first ingested, regardless of how much new intelligence has been gathered about it.

Second, the pipeline claim guard (`pipelineClaims.status != 'lost'`) is the only mechanism that keeps a project active beyond 30 days. Only 27 projects carry active claims (2.4%), so 97.6% of projects are unprotected from staleness regardless of their commercial status.

Third, there is no distinction between a project that is genuinely dormant and one that is "ongoing operational" — a project like "Surat Gas Project North (Arrow Energy, Operational/Expanding)" will be marked stale after 30 days even though it is a live operational account that should remain visible as a background signal.

### C.2 Redesigned Stale Logic

The redesigned model introduces four lifecycle states with explicit transition rules:

**`active`** — project has been seen or enriched within the last 60 days, or carries an active pipeline claim, or is classified as an ongoing operational account.

**`stale`** — project has not been seen or enriched for 60–180 days and has no active claim. Still visible in filtered views but deprioritised in default ranking.

**`archived`** — project has not been seen for 180+ days, or has been explicitly marked completed/cancelled, or is a duplicate of a canonical record. Hidden from all default views.

**`completed`** — project stage explicitly indicates completion (commissioning done, operational, decommissioned). Visible only in historical views.

**Refresh conditions** (any of the following resets the staleness clock):
- A new article or source mention references the same `projectKey` or matches the canonical project name within the deduplication window.
- Projectory enrichment adds or updates contractor data for the project.
- ICN validation confirms the project is still listed as an active work package.
- A user adds a note, creates a claim, or updates the stage manually.
- The tier classification engine re-classifies the project to a higher tier.

**Decay rules:**

| Days since last refresh | Action |
|---|---|
| 0–60 | `active` |
| 61–180 | `stale` (visible in filtered views, excluded from default brief) |
| 181–365 | `stale` with `freshnessScore < 0.3` (low-priority in all views) |
| 365+ | `archived` (hidden unless explicitly searched) |

**Ongoing operational handling:** Projects whose `stage` matches operational patterns ("operational", "producing", "commissioned", "in service", "ongoing operations") should be classified as `lifecycleStatus = 'active'` with a new `projectType = 'background_account'` flag. These projects should not appear in the weekly brief as new opportunities but should remain visible as account context when a rep is researching a company.

### C.3 Recommended Code Changes

```ts
// db.ts — replace markStaleProjects with markAndRefreshProjects
// 1. Extend staleness threshold from 30 to 60 days
// 2. Add sourceLastSeenAt to projects table
// 3. Update sourceLastSeenAt whenever a source ingestion matches a project
// 4. Use sourceLastSeenAt (not just lastActivityAt) in the staleness check
// 5. Add projectType field: 'opportunity' | 'background_account' | 'macro_item'
// 6. Operational projects (stage matches OPERATIONAL_PATTERNS) → projectType = 'background_account'
// 7. Archive threshold: 180 days (not 30)
```

---

## D. Duplicate / Near-Duplicate Clustering

### D.1 Current Duplicate Patterns

The audit identified 13 near-duplicate clusters (same 40-character name prefix, multiple rows). The most significant patterns are:

**Same project, multiple sources:** "Eva Copper Mine Project" appears as both an RSS-extracted record (ID 690077, active) and a seed record (ID 15, stale). Both describe the same Hillgrove Resources project in Queensland.

**Repeated funding announcements:** "Five Battery Projects Totalling 7.9 GWh" appears as two active records (IDs 630001, 630002) extracted from the same article batch. These are the same funding announcement processed twice.

**Stale + active variant:** "Liddell BESS" (IDs 60012 active, 480027 stale), "Tarraleah Hydropower Scheme Redevelopment" (IDs 120069 active, 690025 stale), "Oaky Creek Antimony Project" (IDs 180012 active, 630009 stale). In each case the active record is the more recent extraction and the stale record is an older version that should be merged or archived.

**Same-batch duplicates:** "Australian Battery Recycling Industry Roadmap" (IDs 450030, 450031 — both active), "Westsun Energy 1.3MW Commercial Solar Project" (IDs 450032, 450033 — both active), "Amazon Australia Renewable Energy PPAs" (IDs 690009, 690039 — both active). These were extracted from the same article in the same pipeline run due to a deduplication window that only checks the last 200 projects.

### D.2 Root Cause of Duplicates

The `isProjectDuplicate` function checks only the **most recent 200 projects** ordered by `id DESC`. For a weekly pipeline that can ingest 150+ projects in a single run, this window is too small to catch duplicates from earlier in the same run or from runs more than 1–2 weeks prior. Additionally, the substring containment check is asymmetric: "Snowy 2.0" will match "Snowy 2.0 Transmission" but "Snowy 2.0 Transmission" will not match "Snowy 2.0 Pumped Hydro" even though they are distinct projects.

### D.3 Canonical Project Rules

**Canonical project key:** The `projectKey` field should serve as the canonical identifier. For RSS-extracted projects, the key is currently a hash of the article URL and project name. This should be replaced with a deterministic key derived from the normalised project name and primary location: `slug(name)-slug(state)`, e.g., `eva-copper-mine-project-qld`.

**Duplicate cluster ID:** A new `duplicateClusterId` field (nullable `varchar(64)`) should link all variants of the same project. The canonical record (most recent, highest data quality) carries a `null` cluster ID; all others carry the canonical record's `projectKey` as their cluster ID.

**Merge vs keep-separate decisions:**

| Pattern | Decision |
|---|---|
| Same project, different sources, same stage | Merge into canonical; retain `sourceFirstSeenAt` from oldest, `sourceLastSeenAt` from newest |
| Same project, different stages (e.g., planning → construction) | Keep separate as stage progression records; link via `duplicateClusterId` |
| Same funding announcement, two extractions | Merge; the duplicate should be archived with `suppressionReason = 'duplicate_extraction'` |
| Macro trend item and specific project | Keep separate; macro item gets `projectType = 'macro_item'` and is suppressed from default views |

**Deduplication window fix:** Replace the `LIMIT 200` check with a full-table lookup using a pre-computed `projectKeyNormalised` column (indexed), which stores the lowercased, whitespace-collapsed, punctuation-stripped project name. This allows O(1) exact-match deduplication and a separate fuzzy-match pass using trigram similarity for near-duplicates.

---

## E. Generic / Low-Actionability Project Suppression

### E.1 Classes of Noise Projects

The audit identified five classes of project rows that should not surface as high-priority sales targets:

**Class 1 — Macro trend items:** Projects extracted from articles about broad market trends rather than specific capital projects. Examples: "Australian Battery Recycling Industry Roadmap", "Australian Critical Minerals for Defence", "Australian Battery Energy Storage System (BESS) Rollout". These have no named owner, no specific site, and no credible buying route. They should receive `projectType = 'macro_item'` and be excluded from the weekly brief and default project list.

**Class 2 — Completed/operational projects still active:** Projects whose `stage` field explicitly indicates completion but whose `lifecycleStatus` is still `active` or `stale`. Examples: "ACT Community Battery Network (Dickson)" (stage: "Completed / Commissioned"), "Mount Lindesay Highway Upgrade" (stage: "Complete"), "Surat Gas Project North" (stage: "Operational/Expanding"). These should be reclassified to `lifecycleStatus = 'completed'` or `projectType = 'background_account'`.

**Class 3 — AusTender contract IDs with no project context:** Projects ingested from AusTender with names like "0070041016 — Department of Home Affairs" or "CON/GAUCON/CON009408/1 — Geoscience Australia". These are awarded government contracts with no equipment signal and no useful project context. They should receive a low `actionabilityScore` and be excluded from the default brief unless the contract value exceeds a threshold (e.g., $5M+) and the sector matches a target business line.

**Class 4 — Seed data with no refresh:** The 294 seed/manual projects are 99% stale and have not been refreshed since the initial data load. Many are historical records that are no longer commercially relevant. These should be archived in bulk unless they carry an active pipeline claim.

**Class 5 — Generic location / unknown owner:** 93 projects have a missing or generic owner ("Unknown", "TBC") and 143 have a generic location ("National", "Unknown"). Projects with both a missing owner and a generic location have essentially no actionability and should receive `actionabilityScore < 0.2` and be excluded from the weekly brief.

### E.2 Suppression Rules

```ts
// Suppression rule evaluation order (applied during tier classification)
// Rule 1: Completed/operational stage → projectType = 'background_account'
const COMPLETED_PATTERNS = [
  /completed?/i, /commissioned/i, /operational/i, /in service/i,
  /decommission/i, /closed/i, /cancelled/i, /withdrawn/i
];

// Rule 2: Macro/trend item → projectType = 'macro_item'
const MACRO_PATTERNS = [
  /roadmap/i, /strategy/i, /policy/i, /program$/i, /initiative$/i,
  /industry\s+(review|report|study)/i, /national\s+(plan|framework)/i
];

// Rule 3: Generic contract ID → actionabilityScore penalty
const CONTRACT_ID_PATTERN = /^(CON|CN|[0-9]{7,})\s*[—\-]/;

// Rule 4: Missing owner + generic location → suppressionReason = 'no_target_entity'
if (owner in ['Unknown', 'TBC', ''] && location in ['National', 'Unknown', '']) {
  suppressionReason = 'no_target_entity';
}
```

---

## F. Lifecycle / Stage Confidence Model

### F.1 Current State

The current model has four `lifecycleStatus` values (`active`, `stale`, `archived`, `completed`) and three `priority` values (`hot`, `warm`, `cold`). There is no confidence score attached to either. The `stage` field is a free-text string produced by the LLM, which means two projects at the same commercial stage may have entirely different stage strings.

The `actionTier` field (Tier 1/2/3) is derived from keyword matching against `stage` and is the closest thing to a confidence-weighted actionability signal, but it does not account for data completeness (missing owner, missing contractor, missing value) or source reliability.

### F.2 Proposed Stage Taxonomy

A normalised `stageCode` field (enum) should replace or supplement the free-text `stage` field:

| stageCode | Description | Typical actionTier |
|---|---|---|
| `exploration` | Early-stage exploration, no commitment | Tier 3 |
| `feasibility` | Feasibility study underway | Tier 3 |
| `planning` | Planning/environmental approvals | Tier 2 |
| `design` | Detailed design / FEED | Tier 2 |
| `procurement` | Tender, EOI, RFP open | Tier 1 |
| `awarded` | Contract awarded, mobilisation imminent | Tier 1 |
| `construction` | Active construction / site works | Tier 1 |
| `commissioning` | Commissioning / ramp-up | Tier 1 |
| `operational` | Fully operational | Background account |
| `completed` | Project complete | Archive |
| `cancelled` | Project cancelled or withdrawn | Archive |
| `unknown` | Stage cannot be determined | Tier 3 |

### F.3 Stage Confidence Score

A `stageConfidence` score (0.0–1.0) should be computed based on:

- **Source reliability** (AusTender contract = 0.9, RSS extraction = 0.5–0.7, seed = 0.3)
- **Stage evidence** (named contractor + contract value = +0.2, named owner only = +0.1, generic stage text = 0.0)
- **Recency** (seen within 7 days = +0.1, 8–30 days = 0.0, 31–90 days = -0.1)
- **Corroboration** (mentioned by 2+ sources = +0.15)

A project with `stageConfidence < 0.4` should be excluded from the weekly brief regardless of its `actionTier`.

### F.4 Project Type Distinction

Three `projectType` values should be added:

| projectType | Definition | Default visibility |
|---|---|---|
| `opportunity` | Specific capital project with a named owner and credible buying route | Full visibility |
| `background_account` | Ongoing operational project; useful as account context but not a new opportunity | Account view only |
| `macro_item` | Broad market trend, policy, or programme with no specific buying entity | Suppressed |

---

## G. Actionability Model

### G.1 Current Model

The current actionability model is effectively: `priority` (hot/warm/cold) × `actionTier` (1/2/3). Priority is LLM-assigned at extraction time and is never updated. ActionTier is keyword-derived from the stage field. Neither signal accounts for data completeness, contact availability, or rep engagement history.

### G.2 Proposed Actionability Score

A composite `actionabilityScore` (0.0–1.0) should be computed and stored on each project, updated on each pipeline run. The score is the weighted sum of the following signals:

| Signal | Weight | Condition |
|---|---|---|
| Named owner (non-generic) | 0.15 | `owner` not in `['Unknown', 'TBC', '']` |
| Named contractor / EPC | 0.15 | `JSON_LENGTH(contractors) > 0` |
| Equipment signal present | 0.10 | `JSON_LENGTH(equipmentSignals) > 0` |
| Stage is procurement or construction | 0.20 | `stageCode IN ('procurement', 'awarded', 'construction')` |
| Project has contacts | 0.15 | `contactProjects` join returns rows |
| Project has send-ready contacts | 0.10 | At least one contact with `sendReadiness = 'send_ready'` |
| Project has active pipeline claim | 0.10 | `pipelineClaims` join returns active row |
| Source reliability ≥ 0.7 | 0.05 | AusTender, Projectory, ICN |

A project with `actionabilityScore ≥ 0.6` is considered "actionable" and should appear in the weekly brief. A project with `actionabilityScore < 0.3` should be suppressed from the brief regardless of its `priority` label.

### G.3 Comparison with Current hot/warm/cold

The hot/warm/cold labels should be retained for backward compatibility but should be recalculated from `actionabilityScore` rather than being LLM-assigned:

- `hot` → `actionabilityScore ≥ 0.7`
- `warm` → `actionabilityScore 0.4–0.69`
- `cold` → `actionabilityScore < 0.4`

This removes the current inconsistency where 246 "hot" projects are stale (they were labelled hot by the LLM at extraction time but have never been touched since).

---

## H. Project-to-Contact Conversion Analysis

### H.1 Current Conversion Funnel

| Stage | Active Projects | Stale Projects |
|---|---|---|
| Total projects | 368 | 740 |
| Projects with any contacts | 127 (34.5%) | 434 (58.6%) |
| Projects with zero contacts | 241 (65.5%) | 306 (41.4%) |
| Contacts with enriched email | ~4.9% of all contacts | — |
| Campaign contacts with send-readiness assessed | 0% | — |

The stale projects have higher contact coverage (58.6%) than active projects (34.5%) because most contacts were attached to the seed/manual projects that are now stale. The active projects — which are the commercially relevant ones — have the lowest contact coverage.

### H.2 Contact Enrichment Backlog

Of 27,248 total contacts, 24,902 (91.4%) remain in `enrichmentStatus = 'pending'`. Only 1,329 (4.9%) have been enriched. This backlog is the primary bottleneck between project ingestion and usable outreach. The enrichment pipeline is rate-limited by Apollo/Hunter API quotas, but the current allocation appears to be prioritising stale or low-actionability projects.

**Recommendation:** Enrich contacts in descending order of their project's `actionabilityScore`. Contacts attached to `actionabilityScore < 0.3` projects should not consume enrichment credits until higher-priority contacts are exhausted.

### H.3 Source Class Conversion

| Source Class | Projects | With Contacts | With Send-Ready Contacts | Campaign Targets |
|---|---|---|---|---|
| AusTender | 19 | ~9 (47%) | Unknown | Unknown |
| RSS/AI Extraction | 693 | ~240 (35%) | Unknown | Unknown |
| Seed/Manual | 294 | ~176 (60%) | Unknown | Unknown |
| Gov Major Projects | 37 | ~7 (19%) | Unknown | Unknown |

The "Unknown" values for send-ready contacts and campaign targets reflect the fact that the Stage 4 enrichment QA pipeline has not yet been run against live campaign contacts. Once the pipeline is run, these figures will be available from the `campaignContacts.sendReadiness` field.

---

## I. Schema Recommendations

The following fields are recommended for addition to the `projects` table. All are justified by the audit findings above.

| Field | Type | Justification |
|---|---|---|
| `projectType` | `enum('opportunity', 'background_account', 'macro_item')` | Enables suppression of macro items and operational accounts from the weekly brief |
| `stageCode` | `enum(...)` | Normalised stage taxonomy; enables reliable tier classification and stage confidence scoring |
| `stageConfidence` | `float` (0.0–1.0) | Confidence in the stage assignment; gates brief inclusion |
| `actionabilityScore` | `float` (0.0–1.0) | Composite actionability signal; replaces LLM-assigned hot/warm/cold |
| `freshnessScore` | `float` (0.0–1.0) | Recency signal; decays from 1.0 at ingestion to 0.0 at 180 days |
| `sourceFirstSeenAt` | `timestamp` | When the project was first ingested from any source |
| `sourceLastSeenAt` | `timestamp` | When the project was most recently mentioned by any source |
| `suppressionReason` | `varchar(128)` | Why the project is suppressed from the brief (e.g., `'no_target_entity'`, `'duplicate_extraction'`, `'macro_item'`) |
| `duplicateClusterId` | `varchar(64)` | Links duplicate/near-duplicate records to a canonical project key |
| `canonicalProjectName` | `varchar(512)` | Normalised project name for deduplication and display |
| `archivedAt` | `timestamp` | When the project was archived |
| `staleReason` | `varchar(128)` | Why the project was marked stale (e.g., `'no_claim_30d'`, `'no_source_refresh_60d'`) |

**Fields that are not recommended at this stage** (deferred until the actionability model is validated): `ownerCanonical`, `contractorCanonical`, `routeToBuyConfidence`, `projectSpecificity`. These require a separate entity resolution pass that is out of scope for Stage 5.

---

## J. Before/After Examples

### J.1 Stale but Still Visible — Should be Archived

**"ACT Community Battery Network (Dickson)"** (ID 330027, stale, hot, energy)
- Stage: "Completed / Commissioned"
- Created: 11 March 2026, last activity: 11 March 2026
- **Problem:** Labelled `hot` by the LLM at extraction time because the article announced commissioning. The project is complete. It should be `lifecycleStatus = 'completed'` and `projectType = 'background_account'`.
- **Fix:** Add `COMPLETED_PATTERNS` check in tier classification; set `stageCode = 'completed'` → `lifecycleStatus = 'completed'`.

### J.2 Near-Duplicate — Should be Merged

**"Eva Copper Mine Project"** (ID 15, stale) and **"Eva Copper Mine Project"** (ID 690077, active)
- Both describe the Hillgrove Resources copper project in Queensland.
- ID 15 is a seed record from the initial data load. ID 690077 is a more recent RSS extraction with richer data.
- **Fix:** Set ID 15 `duplicateClusterId = 'eva-copper-mine-project-qld'`, `lifecycleStatus = 'archived'`, `suppressionReason = 'duplicate_of_canonical'`. ID 690077 becomes the canonical record.

### J.3 Generic Macro Item — Should be Suppressed

**"Australian Battery Recycling Industry Roadmap"** (IDs 450030, 450031, both active)
- Owner: Unknown. Location: National. Stage: "Roadmap published".
- No named contractor, no equipment signal, no credible buying route.
- **Fix:** `projectType = 'macro_item'`, `suppressionReason = 'no_target_entity'`, excluded from weekly brief and default project list.

### J.4 High-Quality Specific Project — Should Remain Prominent

**"Higginsville Processing Hub Expansion"** (ID 420004, stale, hot, mining)
- Owner: Westgold Resources. Stage: "FID approved". Sector: Mining.
- Has named owner, FID approved (strong procurement signal), mining sector (core Atlas Copco target).
- **Problem:** Marked stale because it was created on 12 March 2026 and has no pipeline claim. The 30-day staleness threshold is too aggressive for a project at FID stage.
- **Fix:** With the revised 60-day threshold and `sourceLastSeenAt` refresh logic, this project would remain active if it has been mentioned in any source since March 2026. Additionally, `stageCode = 'awarded'` would give it `actionabilityScore ≥ 0.7` → `hot`.

### J.5 No Owner / No Contractor Path — Low Actionability

**"Australian Critical Minerals for Defence"** (ID 690084, active, cold, defence)
- Owner: "Australian Government / Various". Location: National.
- Stage: "Early-stage, policy-driven growth". No contractors, no equipment signals.
- **Fix:** `projectType = 'macro_item'`, `actionabilityScore ≈ 0.1`, excluded from brief.

### J.6 Strong Contractor Path — High Actionability

**"Riverstone Water Resource Recovery Facility Upgrade"** (ID 330020, stale, hot, infrastructure)
- Owner: Sydney Water. Stage: "Next phase awarded to North West Alliance".
- Named owner (Sydney Water), named contractor (North West Alliance), construction stage.
- **Problem:** Marked stale because created 11 March 2026 with no pipeline claim.
- **Fix:** With revised staleness logic, this project's `sourceLastSeenAt` would be updated if any source has mentioned it since March. `actionabilityScore ≈ 0.75` → `hot`, Tier 1.

---

## K. Priority-Ordered Implementation Plan

### Immediate (Stage 5 Sprint 1 — fix the data layer)

1. **Extend staleness threshold from 30 to 60 days** — single line change in `db.ts`. Immediately rescues ~200 projects that are commercially live but were marked stale too early.

2. **Add `sourceLastSeenAt` to projects table and update it on every source ingestion** — prevents projects from going stale when they are being actively refreshed by the pipeline.

3. **Add `projectType` field and classify macro items and completed projects** — suppresses ~150 noise projects from the weekly brief immediately.

4. **Fix deduplication window** — replace `LIMIT 200` with indexed `projectKeyNormalised` lookup. Prevents same-batch duplicates.

5. **Archive seed/manual projects older than 180 days with no pipeline claim** — removes ~290 stale seed records from the default view.

### Near-term (Stage 5 Sprint 2 — improve scoring)

6. **Add `actionabilityScore` computation** — composite score replacing LLM-assigned hot/warm/cold. Recalculate on each pipeline run.

7. **Add `stageCode` normalisation** — map free-text `stage` to the 12-value enum using the existing tier classification keyword lists.

8. **Add `stageConfidence` score** — gate brief inclusion at `stageConfidence ≥ 0.4`.

9. **Prioritise contact enrichment by `actionabilityScore`** — stop spending Apollo/Hunter credits on contacts attached to low-actionability projects.

10. **Disable or replace 12 dead RSS sources** — free up pipeline slots for higher-yield sources.

### Deferred (Stage 6+)

11. **Duplicate cluster merging UI** — allow managers to review and confirm merge decisions for near-duplicate clusters.

12. **`canonicalProjectName` entity resolution** — normalise owner and contractor names across the database.

13. **`routeToBuyConfidence` scoring** — requires contractor role classification (owner/EPC/subcontractor) which is a separate engine.

14. **Post-batch QA sweep** — re-run enrichment QA on all campaign contacts after each enrichment batch (deferred from Stage 4).

---

## Summary Statistics

| Metric | Value |
|---|---|
| Total projects in database | 1,110 |
| Active projects | 368 (33.2%) |
| Stale projects | 740 (66.7%) |
| Active projects never touched | 367 (99.7% of active) |
| Active projects with contacts | 127 (34.5%) |
| Contacts pending enrichment | 24,902 (91.4%) |
| Near-duplicate clusters identified | 13 |
| Dead RSS sources (zero yield) | 12 |
| Projects with missing owner | 93 (8.4%) |
| Projects with empty contractors array | 363 (32.8%) |
| Projects with missing value | 534 (48.2%) |
| Active pipeline claims | 27 (2.4% of active + stale) |
| Send-readiness assessed (campaign contacts) | 0 (0%) |
