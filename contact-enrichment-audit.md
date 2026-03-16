# Contact Enrichment System — Developer Audit Report

**Project:** Atlas Copco Portable Air — Weekly Market Intelligence Platform
**Date:** 15 March 2026
**Author:** Manus AI

---

## 1. Executive Summary

The contact enrichment system is a sophisticated, multi-layered pipeline that discovers, enriches, verifies, and scores stakeholder contacts for 700+ infrastructure and mining projects across Australia. It draws from five distinct data sources (LinkedIn People Search, Apollo.io, open-web discovery, LLM inference, and Projectory), orchestrated through a 22-step daily pipeline. The system currently manages 1,500+ contacts with role relevance classification, verification scoring, and budget-controlled Apollo credit spending.

This audit examines every layer — schema, services, API integrations, deduplication, pipeline orchestration, frontend triggers, and tRPC endpoints — and identifies **12 findings** with **8 actionable recommendations** to improve data quality, reduce cost, and increase sales team confidence in the contact data.

---

## 2. Architecture Overview

The enrichment system operates as a tiered waterfall. Each tier is progressively more expensive and more accurate, with the pipeline preferring cheaper sources first and reserving paid APIs for gap-filling.

| Tier | Source | Cost | Trigger | Data Quality |
|------|--------|------|---------|--------------|
| 1 | **Projectory Scraping** | Free | Daily pipeline (Step 8) | Medium — structured project pages, but contacts are project-level roles |
| 2 | **LinkedIn People Search** (Data API) | Included in platform | Daily pipeline (Step 10) + manual | Medium-High — real profiles, but limited to search results |
| 3 | **Open-Web Discovery** (LLM + web search) | LLM token cost only | Daily pipeline (Step 11) + manual | Medium — web sources with LLM extraction, verification scored |
| 4 | **LLM Contact Inference** | LLM token cost only | Fallback when LinkedIn quota exhausted | Low — AI-generated, clearly labelled, requires verification |
| 5 | **Apollo.io Reveal** | 1 credit per contact | Budget-gated (Step 12) + manual | High — verified emails, real LinkedIn profiles |

### Pipeline Execution Order (Contact-Relevant Steps)

The daily pipeline runs 22 steps. The contact-relevant steps execute in this order:

| Step | Name | Schedule | Purpose |
|------|------|----------|---------|
| 10 | Contact Enrichment | Daily | LinkedIn People Search for new/pending contacts |
| 11 | Web Stakeholder Discovery | Daily | Open-web search + LLM extraction for projects with few contacts |
| 12 | Apollo Selective Gap-Fill | Daily (budget-gated) | Apollo credit spend on hot/pipeline projects with contact gaps |
| 20 | Role Relevance Classification | Daily | Classify all contacts as high/medium/low relevance |
| 21 | Second-Pass Contact Search | Wed + Sat | Targeted role-specific searches for projects with < 2 relevant contacts |

---

## 3. Schema Analysis

### 3.1 Contacts Table

The `contacts` table is well-structured with 30+ columns covering identity, enrichment metadata, verification status, and role classification.

**Strengths:**
- Clear separation of enrichment status (`pending`, `enriched`, `not_found`, `failed`) and enrichment source (`linkedin`, `llm`, `manual`, `apollo`, `web_search`).
- Verification scoring system (0–100) with breakdown by source quality, name quality, email quality, title specificity, LinkedIn presence, and company match.
- Role relevance classification (`high`, `medium`, `low`) aligned to Atlas Copco equipment procurement decision-makers.
- Crowd verification support via `verifiedByUserId` field.

**Finding 1 — No contact staleness tracking.** The schema has `enrichedAt` (when the contact was first enriched) but no `lastVerifiedAt` or `lastCheckedAt` field. There is no mechanism to detect when a contact's role, company, or email has gone stale. A procurement manager from 2024 may have moved to a different company, but the system has no way to flag this.

**Finding 2 — No enrichment source history.** The `enrichmentSource` field stores only the latest source. If a contact was first discovered via web search, then enriched via Apollo, the original discovery source is lost. This matters for understanding which discovery channels produce the best contacts.

### 3.2 Supporting Tables

| Table | Purpose | Status |
|-------|---------|--------|
| `enrichmentCache` | Caches LinkedIn search results to avoid duplicate API calls | Working — 7-day TTL |
| `apolloCreditLog` | Tracks Apollo credit spend per action, per project, per user | Working — daily/monthly caps |
| `projectoryEnrichmentLog` | Tracks Projectory enrichment runs per project | Working |

---

## 4. Enrichment Services — Detailed Analysis

### 4.1 LinkedIn People Search (contactEnrichment.ts)

This is the primary discovery channel. It searches LinkedIn via the platform's Data API using project name + company name + target role combinations.

**Strengths:**
- Configurable target roles list (10 high-value roles: Construction Manager, Procurement Manager, etc.).
- Daily enrichment cap (100/day) prevents runaway API usage.
- Results cached in `enrichmentCache` table with 7-day TTL.
- Email inference from name + company domain pattern (`first.last@company.com.au`).

**Finding 3 — Email inference is naive and Australia-specific.** The `inferEmail` function always generates `.com.au` domains by stripping common suffixes (Pty, Ltd, Group, Australia, Holdings) and appending `.com.au`. This fails for:
- International companies (e.g., Bechtel → `bechtel.com`, not `bechtel.com.au`)
- Companies with non-standard domains (e.g., BHP → `bhp.com`, Thiess → `thiess.com`)
- Companies with hyphenated or multi-word domains (e.g., "John Holland" → `johnholland.com.au` works, but "Clough Group" → `clough.com.au` should be `clough.com`)

The same naive `inferEmail` function is duplicated in `contactEnrichment.ts`, `llmContactFallback.ts`, and `secondPassContactSearch.ts` — three separate copies with identical logic.

### 4.2 Open-Web Stakeholder Discovery (webStakeholderDiscovery.ts)

This service searches the open web for stakeholder mentions using targeted queries, then uses the LLM to extract structured contact data from search results.

**Strengths:**
- Multi-query strategy: searches for project name + role combinations across web results.
- LLM extraction with structured JSON schema output.
- Verification scoring gate: contacts below score 55 are rejected.
- Source URL tracking for audit trail.

**Finding 4 — Web discovery has no rate limiting between projects.** The service processes projects sequentially with a delay between searches, but there is no global rate limit across the daily pipeline run. If 50 projects need web discovery, all 50 run in a single pipeline execution, which could trigger rate limiting from the search API.

### 4.3 Apollo.io Integration (apolloEnrichment.ts + apolloEligibility.ts)

Apollo is the premium enrichment channel, gated by a sophisticated eligibility rule engine.

**Strengths:**
- Three-tier eligibility: hot priority, pipeline-claimed, or explicit user request.
- Budget controls: 50 credits/day auto, 10 credits/project, 500/month.
- Gap-fill strategy: only spends credits on projects that genuinely need more contacts or email verification.
- Gap analysis per project: counts contacts with/without email, by source, by verification status.

**Finding 5 — Apollo gap-fill plan doesn't prioritise by business line relevance.** The eligibility engine checks project priority (hot/warm) and pipeline claims, but doesn't consider which business lines are relevant to the project. A hot mining project with strong Portable Air relevance should get Apollo credits before a hot infrastructure project with weak BL relevance.

### 4.4 LLM Contact Inference (llmContactFallback.ts)

This is the fallback when LinkedIn quota is exhausted. The LLM generates plausible contacts based on project context.

**Strengths:**
- Clear labelling: all contacts marked with `enrichmentSource: "llm"` and UI shows "AI-Generated" badge.
- Confidence filtering: rejects "low" confidence contacts.
- Verification score gate: minimum score 60.

**Finding 6 — LLM-generated contacts should not have inferred emails.** The LLM fallback generates contacts and then runs the same naive `inferEmail` function to guess email addresses. These emails are almost certainly wrong (the LLM doesn't know the actual person, so the name is fictional). Showing a guessed email for a fictional person creates a false sense of actionability. LLM contacts should have `email: null` and be flagged as "needs Apollo verification" or "needs manual lookup."

### 4.5 Second-Pass Contact Search (secondPassContactSearch.ts)

Runs on Wednesdays and Saturdays for projects with fewer than 2 high/medium-relevance contacts.

**Strengths:**
- Targeted role-specific searches (10 priority roles).
- Only saves high/medium relevance contacts.
- Verification score gate: minimum 55.

### 4.6 Role Relevance Classification (roleRelevance.ts)

Classifies contacts into high/medium/low relevance for Atlas Copco equipment procurement.

**Strengths:**
- Comprehensive keyword lists for high, medium, and low relevance roles.
- Uses both `roleBucket` and raw title for classification.
- Runs daily on all unclassified contacts.

---

## 5. Deduplication Analysis

**Finding 7 — Inconsistent deduplication logic across services.** Each enrichment service implements its own deduplication check, with different matching criteria:

| Service | Dedup Logic | Scope |
|---------|-------------|-------|
| Web Discovery | `LOWER(name) = LOWER(input)` | Global (all projects) |
| Apollo | `LOWER(name) = LOWER(input) AND LOWER(company) = LOWER(input)` | Global |
| Second-Pass | `LOWER(name) = LOWER(input)` | Global |
| Contact Enrichment | Cache-based (enrichmentCache table) | Per-search-query |

Web Discovery and Second-Pass use name-only matching, which means "John Smith" at BHP would block "John Smith" at Thiess. Apollo uses name + company, which is more accurate. There is no fuzzy matching — "J. Smith" and "John Smith" are treated as different people. There is no email-based deduplication — two records with the same email but different name spellings would both be saved.

### 5.1 Cross-Source Merge Gap

When the same person is discovered by multiple sources (e.g., web search finds "Jane Doe, Procurement Manager at Thiess" and later Apollo reveals the same person with a verified email), the system creates two separate contact records rather than merging the Apollo data into the existing web-discovered record. The Apollo dedup check would catch this only if the name and company match exactly (case-insensitive).

---

## 6. Verification Scoring System

The verification scoring system (0–100) is well-designed with six weighted dimensions:

| Dimension | Max Score | What It Measures |
|-----------|-----------|------------------|
| Source Quality | 30 | How the contact was discovered (verified > LinkedIn > manual > web > LLM) |
| Name Quality | 15 | Full name with 2+ parts, each 2+ characters |
| Email Quality | 15 | Verified email > pattern-guessed > none |
| Title Specificity | 15 | Seniority keywords + multi-word title |
| LinkedIn Presence | 15 | Direct profile URL > search URL > none |
| Company Match | 10 | Known major company > unknown |

**Finding 8 — Verification score is static.** The score is computed once when the contact is created and never updated. If a user later verifies the contact via crowd verification, the `verifiedByUserId` field is set but the verification score is not recomputed. This means a web-discovered contact that a sales rep has personally verified still shows a "Moderate Confidence" score.

---

## 7. Missing Integration: Coresignal

**Finding 9 — Coresignal API is not integrated despite being a stated requirement.** The project requirements specify that Coresignal should be used for mandatory contact verification and enrichment. The current system uses LinkedIn People Search (via Data API), Apollo, and web discovery, but Coresignal is absent from the codebase. Coresignal provides real-time LinkedIn profile data including current job title, company, and employment dates — which would directly address the contact staleness problem (Finding 1).

---

## 8. Frontend Enrichment Workflows

The frontend provides three enrichment triggers:

1. **Automatic (pipeline):** The daily pipeline enriches contacts for all projects automatically. Users see the results on the This Week page and Full Dashboard.
2. **Manual enrichment button:** The "Enrich Contacts" button on project cards triggers web discovery + LinkedIn search for that specific project.
3. **Apollo manual search:** The Apollo search modal allows users to search for specific people by name, company, or title, and reveal their email (1 credit per reveal).

**Finding 10 — No enrichment progress indicator.** When a user clicks "Enrich Contacts," the system runs web discovery and LinkedIn search in the background, but the UI shows only a loading spinner. There is no progress bar, no "searching LinkedIn..." → "found 3 results" → "scoring contacts..." feedback. For a process that can take 10–30 seconds, this creates uncertainty.

---

## 9. Recommendations

### Recommendation 1: Add Contact Staleness Detection and Re-Verification (High Priority)

Add a `lastVerifiedAt` timestamp to the contacts schema and implement a periodic re-verification cycle. Contacts older than 90 days should be flagged as "needs re-verification." The re-verification should check whether the person still holds the same title at the same company, using either Coresignal (preferred) or a lightweight LinkedIn search.

**Implementation:** Add `lastVerifiedAt` column to contacts table. Add a new pipeline step (e.g., Step 23) that runs weekly, selecting contacts where `lastVerifiedAt` is null or older than 90 days, and re-verifying them via LinkedIn search. Update the verification score when re-verification succeeds or fails.

### Recommendation 2: Integrate Coresignal for Contact Verification (High Priority)

Coresignal provides real-time LinkedIn profile data including current employment, job title, and company. Integrating it would:
- Validate that contacts still hold their stated role (addressing staleness).
- Provide direct LinkedIn profile URLs (not search URLs), improving the LinkedIn Presence score dimension.
- Cross-reference employment dates to detect job changes.

**Implementation:** Add a `coresignalEnrichment.ts` service that accepts a contact name + company and returns current employment data. Wire it into the daily pipeline as a verification step after initial discovery. Use it as the primary source for the `lastVerifiedAt` timestamp.

### Recommendation 3: Centralise and Improve Email Inference (Medium Priority)

Extract the `inferEmail` function into a shared module (`server/emailInference.ts`) and improve it with:
- A known-domains lookup table mapping company names to actual email domains (e.g., "BHP" → `bhp.com`, "Thiess" → `thiess.com`, "John Holland" → `johnholland.com.au`).
- Multiple pattern generation: `first.last@domain`, `flast@domain`, `first@domain` — store all as candidates rather than picking one.
- Remove email inference from LLM-generated contacts entirely (they should have `email: null`).

**Implementation:** Create `server/emailInference.ts` with a `inferEmailCandidates(name, company): string[]` function. Populate the known-domains table from the existing `KNOWN_MAJOR_COMPANIES` set in `verificationScoring.ts`. Replace all three copies of `inferEmail` with imports from the shared module.

### Recommendation 4: Unify Deduplication Logic (Medium Priority)

Create a centralised `server/contactDedup.ts` module that all enrichment services use. The dedup check should:
- Match on normalised name + company (current Apollo approach).
- Add fuzzy matching for name variants (e.g., "J. Smith" ≈ "John Smith").
- Add email-based dedup: if two records share the same email, merge them.
- When a duplicate is found from a higher-quality source, merge the new data into the existing record rather than skipping it.

**Implementation:** Create `contactDedup.ts` with `findExistingContact(name, company, email?)` that returns the existing contact ID if found, and `mergeContactData(existingId, newData, newSource)` that upgrades fields (e.g., replaces a guessed email with an Apollo-verified email).

### Recommendation 5: Add Business Line Relevance to Apollo Eligibility (Medium Priority)

The Apollo eligibility engine should factor in business line relevance when deciding which projects get credits. A hot mining project with 90% Portable Air relevance should be prioritised over a hot infrastructure project with 20% relevance.

**Implementation:** In `apolloEligibility.ts`, load the project's business line scores and multiply the eligibility priority by the max BL score. This ensures Apollo credits flow to the projects most likely to generate revenue for the user's assigned business lines.

### Recommendation 6: Recompute Verification Score on Status Changes (Low Priority)

The verification score should be recomputed whenever a contact's data changes — crowd verification, Apollo email reveal, manual edit, or re-verification. This ensures the score accurately reflects the current state of the contact.

**Implementation:** Add a `recomputeVerificationScore(contactId)` function that loads the contact, runs `computeVerificationScore`, and updates the `verificationScore` field. Call it from the crowd verification endpoint, Apollo reveal endpoint, and manual edit endpoint.

### Recommendation 7: Add Enrichment Progress Feedback (Low Priority)

When a user triggers manual enrichment, show a step-by-step progress indicator: "Searching LinkedIn..." → "Found 4 results" → "Scoring contacts..." → "Saved 3 new contacts." This can be implemented with server-sent events or polling.

**Implementation:** Add a `enrichmentProgress` tRPC subscription or polling endpoint that returns the current step and counts. Update the frontend enrichment button to show a multi-step progress indicator.

### Recommendation 8: Add Enrichment Source History (Low Priority)

Track the full history of enrichment actions per contact in a `contactEnrichmentHistory` table. Each row records: contactId, source, action (discovered/verified/email_revealed/merged), timestamp, and metadata. This provides an audit trail and enables analysis of which discovery channels produce the best contacts.

**Implementation:** Create `contactEnrichmentHistory` table with columns: `id`, `contactId`, `source`, `action`, `metadata` (JSON), `createdAt`. Insert a row whenever a contact is created, enriched, verified, or merged.

---

## 10. Priority Matrix

| # | Recommendation | Impact | Effort | Priority |
|---|---------------|--------|--------|----------|
| 1 | Contact staleness detection | High — prevents outreach to wrong people | Medium | **High** |
| 2 | Coresignal integration | High — real-time verification, direct LinkedIn URLs | Medium-High | **High** |
| 3 | Centralise email inference | Medium — reduces false emails, DRY code | Low | **Medium** |
| 4 | Unify deduplication | Medium — prevents duplicate contacts, enables merge | Medium | **Medium** |
| 5 | BL relevance in Apollo eligibility | Medium — better credit allocation | Low | **Medium** |
| 6 | Recompute verification scores | Low — cosmetic accuracy | Low | **Low** |
| 7 | Enrichment progress feedback | Low — UX improvement | Low | **Low** |
| 8 | Enrichment source history | Low — audit trail | Low | **Low** |

---

## 11. Current Metrics Summary

| Metric | Value |
|--------|-------|
| Total contacts in database | ~1,500+ |
| Enrichment sources active | 5 (LinkedIn, Apollo, Web, LLM, Projectory) |
| Daily enrichment cap (LinkedIn) | 100 contacts/day |
| Daily Apollo credit cap (auto) | 50 credits/day |
| Monthly Apollo budget cap | 500 credits/month |
| Per-project Apollo cap | 10 credits/project |
| Enrichment cache TTL | 7 days |
| Verification score threshold (web) | 55 minimum |
| Verification score threshold (LLM) | 60 minimum |
| Second-pass trigger | < 2 high/medium contacts per project |
| Target roles searched | 10 high-value procurement-adjacent roles |
| Role relevance tiers | 3 (high, medium, low) |
| Deduplication method | Name-based (inconsistent across services) |
| Email verification | Apollo-only (no independent verification service) |
| Contact staleness detection | **Not implemented** |
| Coresignal integration | **Not implemented** |

---

*End of audit report.*
