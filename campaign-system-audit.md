# Atlas Copco Power Technique — Campaign System Audit

**Prepared for:** Lee Allen, National Business Development Manager  
**Date:** 12 April 2026  
**System:** Atlas Copco Market Intelligence Platform — Campaign Builder Module

---

## 1. Executive Summary

The Campaign Builder is a self-service outreach system that takes a user from a raw spreadsheet of company names or contacts through to personalised, AI-generated emails sent via Resend. The pipeline has six major stages: **File Upload & Detection**, **Company Search (with LLM Domain Inference)**, **Contact Import & Scoring**, **Waterfall Enrichment**, **AI Email Generation**, and **Approval & Sending**. This document traces every code path, database interaction, API call, and scoring decision so that you can examine the system's behaviour, identify bottlenecks, and make informed recommendations.

---

## 2. System Architecture Overview

The campaign system is built across the following server-side modules, each responsible for a distinct concern:

| Module | Responsibility | Key APIs Used |
|---|---|---|
| `campaignCsvImport.ts` | File parsing, column detection, company-vs-contact classification | XLSX library |
| `companySearchJob.ts` | Background job: LLM domain inference → Hunter search → Apollo fallback | LLM, Hunter.io, Apollo |
| `domainInference.ts` | LLM-powered company name → domain resolution | Built-in LLM (invokeLLM) |
| `hunterContactSearch.ts` | Hunter.io Domain Search with role-based filtering | Hunter.io Domain Search |
| `hunterService.ts` | Hunter.io API wrapper (Domain Search, Email Finder, Email Verifier) | Hunter.io v2 API |
| `apolloEnrichment.ts` | Apollo People Search (free) + People Enrichment (1 credit each) | Apollo.io v1 API |
| `campaignService.ts` | Campaign CRUD, contact import, scoring, enrichment orchestration, email generation, approval, sending | All of the above + Resend |
| `outreachEmail.ts` | AI-powered personalised email generation | Built-in LLM (invokeLLM) |
| `emailSender.ts` | Email delivery via Resend API | Resend API |

The frontend is a multi-step wizard in `CampaignBuilder.tsx` that guides the user through campaign creation, file upload, contact review, and launch.

---

## 3. Stage 1: File Upload & Detection

### 3.1 What Happens When You Upload a File

When a CSV or Excel file is uploaded, the system runs through three sequential steps:

1. **Preview Generation** (`previewImportFile`): The file is parsed using the XLSX library. The first row is treated as headers, and the next 5 rows are returned as a sample preview. Column mapping is auto-detected by matching header text against known patterns.

2. **File Analysis** (`analyseImportFile`): Each data row is classified as either "has individual names" (firstName, lastName, fullName, or email present) or "company-only" (has company/domain but no personal identifiers). If more than **60% of non-empty rows are company-only**, the file is classified as `type: "companies"`. Otherwise it is `type: "contacts"`.

3. **Frontend Routing**: Based on the analysis result, the CampaignBuilder UI shows either:
   - **Contact Import Flow** — direct mapping and import of individual contacts
   - **Company List Detected** banner — prompting the user to select target roles and click "Find Contacts at These Companies"

### 3.2 Column Detection Patterns

The system recognises the following header patterns for auto-mapping:

| Field | Recognised Headers |
|---|---|
| firstName | `first name`, `first`, `given name`, `fname`, `contact first` |
| lastName | `last name`, `last`, `surname`, `family name`, `lname`, `contact last` |
| fullName | `name`, `full name`, `contact name`, `person`, `contact` |
| title | `title`, `job title`, `position`, `role`, `designation` |
| company | `company`, `organization`, `organisation`, `employer`, `account name`, `company name` |
| email | `email`, `e-mail`, `email address`, `contact email` |
| phone | `phone`, `telephone`, `tel`, `phone number`, `work phone`, `office phone` |
| mobile | `mobile`, `cell`, `mobile phone`, `cell phone` |
| linkedin | `linkedin`, `linkedin url`, `linkedin profile`, `li url` |
| website | `website`, `web`, `url`, `company website`, `domain` |

For company-list files, additional patterns are recognised:

| Field | Recognised Headers |
|---|---|
| company | `company`, `organization`, `employer`, `account name`, `company name`, `business`, `name` |
| domain | `domain`, `website`, `web`, `url`, `company website`, `company domain`, `site` |
| location | `location`, `city`, `state`, `region`, `country`, `address`, `hq` |
| notes | `notes`, `comment`, `description`, `details`, `info` |

### 3.3 Your Specific File: What Happened

Your uploaded file (`Company_Names_Deduped.csv`) had a single column header `"Company Name"` with 378 rows of drilling company names and no other columns. The system correctly:
- Matched `"Company Name"` to the `company` field via the `name` pattern
- Classified 100% of rows as company-only → `type: "companies"`
- Showed the "Company List Detected" banner

**Key insight**: The `"name"` pattern in `COMPANY_LIST_PATTERNS` is what caught your single-column file. Without this pattern, the system would have tried to interpret "Company Name" as a `fullName` field (individual contact names), which would have produced garbage results.

---

## 4. Stage 2: Company Search (Background Job with LLM Domain Inference)

When the user clicks "Find Contacts at These Companies", the system starts a background job that runs a 3-phase pipeline. This was recently redesigned to handle large company lists (like your 378 companies) without HTTP timeouts.

### 4.1 Phase 0: LLM Domain Inference

**Purpose**: Most company lists (especially drilling companies) don't include website domains. Without a domain, Hunter.io Domain Search cannot be used. The LLM infers the most likely domain for each company.

**How it works**:
- Companies are batched in groups of **20** to minimise LLM calls
- Each batch is sent to the LLM with a system prompt specialised for Australian mining, drilling, construction, and energy companies
- The LLM returns structured JSON with `{ company, domain, confidence }` for each company
- Confidence levels: **high** (certain, e.g., "Boart Longyear" → `boartlongyear.com`), **medium** (likely but not certain), **low** (unknown or too generic)

**Routing decision after inference**:
- **High or medium confidence** → routed to Phase 1 (Hunter.io Domain Search)
- **Low confidence or null domain** → routed to Phase 2 (Apollo company name search)

**Rate limiting**: 500ms delay between batches to avoid LLM rate limits.

**Failure handling**: If a batch fails, all companies in that batch are assigned `confidence: "low"` and routed to Apollo fallback. If the entire inference step fails, all companies go to Apollo.

### 4.2 Phase 1: Hunter.io Domain Search

**Purpose**: For companies with known or inferred domains, Hunter.io returns all email addresses associated with that domain, along with names, titles, confidence scores, and LinkedIn URLs.

**How it works**:
- Each domain is searched via `domainSearch(domain, { type: "personal", limit: 100 })`
- Returns up to 100 personal email addresses per domain
- Each result includes: email, first_name, last_name, position, confidence (0-100), LinkedIn URL, phone number

**Role filtering** (applied to each returned contact):
1. **Exclusion filter**: Contacts with irrelevant titles are removed (HR, marketing, finance, legal, IT, reception, admin, sales reps)
2. **Role match filter**: If target roles were selected, only contacts matching those role patterns are kept
3. **Generic email filter**: Emails like `info@`, `sales@` are excluded
4. **Confidence filter**: Contacts with confidence below 30 are excluded

**Rate limiting**: 200ms between domain searches (5 req/s, well within Hunter's 15 req/s limit).

**Cost**: 1 Hunter.io API request per domain searched. No per-email cost.

### 4.3 Phase 2: Apollo Company Name Search (Fallback)

**Purpose**: For companies where the LLM couldn't determine a domain, Apollo's People Search API is used to find contacts by company name.

**How it works**:
- Searches `apolloPeopleSearch({ organizationName, personTitles, organizationLocations: ["Australia"], perPage: 50 })`
- Returns obfuscated results: first name, last name (obfuscated, e.g., "Co***s"), title, Apollo ID, `has_email` flag
- **No emails are returned** — Apollo Search is free but only returns metadata
- Contacts are imported with `enrichmentStatus: "pending"` so they can be enriched later

**Role filtering**: Same exclusion and role-match logic as Hunter, but applied to Apollo's title field.

**Rate limiting**: 300ms between company searches.

**Cost**: Free — Apollo People Search does not consume credits.

### 4.4 Predefined Target Roles

The system offers 10 predefined role categories that the user can select before searching:

| Role Key | Display Name | Example Titles Matched |
|---|---|---|
| `rc_driller` | RC Drillers | drill, RC, reverse circ, bore hole, rig manager |
| `water_well` | Water Well Drillers | water well, bore drill, hydro, ground water |
| `exploration` | Exploration | exploration, geologist, geotechnical, mineral |
| `blasting` | Blasting & Coating | blast, coat, paint, surface prep, corrosion, abrasive, NACE, UHP |
| `operations` | Operations & Management | operations, general manager, managing director, CEO, COO, director |
| `procurement` | Procurement & Purchasing | procurement, purchasing, supply chain, buyer, sourcing |
| `project_management` | Project Management | project manager, project director, project engineer |
| `fleet_equipment` | Fleet & Equipment | fleet, equipment, plant manager, maintenance, workshop, mechanic |
| `engineering` | Engineering | engineer, technical, design |
| `site_management` | Site Management | site manager, site supervisor, foreman, supervisor, area manager |

### 4.5 Caps and Limits

| Parameter | Default Value | Purpose |
|---|---|---|
| Max contacts per company | 25 (Apollo) / 50 (Hunter) | Prevents one large company from dominating results |
| Max total contacts | 2,000 | Prevents runaway searches |
| Job TTL | 30 minutes | Auto-cleanup of completed/stale jobs from memory |

---

## 5. Stage 3: Contact Import & Scoring

### 5.1 Import Process

After the company search completes (or after a direct contact CSV upload), the contacts are imported into the `campaignContacts` table via `importCampaignContacts()`. During import, each contact is:

1. **Filtered**: Contacts flagged as "non-company" or "do-not-use" are excluded. Contacts with no name are excluded. Contacts with personal email domains (Gmail, Hotmail, Yahoo, Outlook, Bigpond, Optusnet, etc.) are excluded.

2. **Scored**: A composite score (0-100) is computed based on four factors.

3. **Tiered**: Based on the score and data completeness, contacts are assigned to one of five tiers.

4. **Batch inserted**: Contacts are inserted in batches of 500 for performance.

### 5.2 Scoring Algorithm

The composite score is built from four additive components:

| Component | Points | Logic |
|---|---|---|
| **Title Relevance** | 0-40 | Blasting specialist: 40 pts. Decision maker: 35 pts. Operations: 20 pts. Other: 10 pts. Unknown/excluded: 0-5 pts. |
| **Data Completeness** | 0-20 | Has email: +15 pts. Has mobile: +5 pts. |
| **Blasting Company Bonus** | 0-20 | Company name matches blasting/coating/surface prep patterns: +20 pts. |
| **Project Match Bonus** | 0-30 | Each matched project: +5 pts (capped at 30 pts for 6+ matches). |
| **Combo Bonus** | 0-10 | Blasting specialist at a blasting company: +10 pts. |

**Maximum possible score**: 100 (capped).

### 5.3 Title Classification Hierarchy

Titles are classified in this priority order:

1. **Excluded** (score: 5): accounts, admin, store, reception, office manager, customer care, sales rep
2. **Blasting Specialist** (score: 40): blast, paint, coat, surface treat/protect/prep, corrosion, abrasive, sandblast, UHP, NACE
3. **Decision Maker** (score: 35): managing director, general manager, CEO, COO, director, owner, operations manager, project manager, procurement, fleet manager, equipment manager, maintenance manager
4. **Operations** (score: 20): supervisor, superintendent, coordinator, foreman, estimator, engineer, inspector, planner, site manager, area manager, branch manager
5. **Other** (score: 10): any title not matching the above

### 5.4 Tiering Rules

| Tier | Label | Criteria |
|---|---|---|
| `tier1_hot` | Hot | Score >= 55 AND has email |
| `tier2_warm` | Warm | Score >= 35 AND has email |
| `tier3_enrich` | Enrich | Score >= 15 (no email required) |
| `tier4_low` | Low | Score < 15 |
| `excluded` | Excluded | Filtered out during import |

**Key observation**: A contact **cannot** be Tier 1 (Hot) or Tier 2 (Warm) without an email address, regardless of their score. This means contacts imported from Apollo (which never returns emails) will always start as Tier 3 (Enrich) until they go through the waterfall enrichment.

### 5.5 Blasting Company Detection

The following company name patterns trigger the +20 point blasting company bonus:

> blast, abrasive, surface prep/treat/protect, corrosion, coating, painting service/contractor/solution, sandblast, UHP, hydro blast, grit blast, rope access, scaffold, insulation, fireproof, Kaefer, Altrad, Monadelphous, Linkforce, Master Flow, Rema Tip, Cleanco, WA Corrosion, Matrix Corrosion

---

## 6. Stage 4: Waterfall Enrichment

After contacts are imported and scored, the enrichment pipeline runs to find verified email addresses for contacts that don't have them. This is a two-step waterfall: **Apollo first, then Hunter.io for misses**.

### 6.1 Enrichment Selection

Contacts are selected for enrichment based on:
- `enrichmentStatus = "pending"` (contacts imported without an email)
- Ordered by **score descending** (highest-value contacts enriched first)
- Limited to a configurable batch size (default: 50 per run)

### 6.2 Step 1: Apollo Enrichment

Two paths depending on whether the contact has a stored Apollo Person ID:

**Path A — Direct Enrichment** (contact has `apolloPersonId` from the search phase):
- Calls Apollo People Enrichment API with the stored ID
- **Costs 1 Apollo credit per contact**
- Returns: full name, verified email, email status, LinkedIn URL, photo, city, state, country, seniority
- If email is found → contact is marked `enriched` with `enrichmentSource: "apollo"`
- If no email → contact is added to the Apollo-missed list for Hunter fallback

**Path B — Search-then-Enrich** (contact has no stored Apollo ID):
- First searches Apollo People Search using: company domain (if available), title, name keywords, location ("Australia")
- Matches the best result by name similarity
- If the best match has `has_email: true`, enriches that person (1 credit)
- If enrichment returns an email → marked `enriched`
- Otherwise → added to Apollo-missed list

**Rate limiting**: 300-500ms between Apollo API calls.

**Daily cap**: 200 Apollo credits per day (configurable via `DAILY_ENRICHMENT_CAP`).

### 6.3 Step 2: Hunter.io Enrichment (Fallback)

For contacts that Apollo couldn't enrich, Hunter.io is used as a fallback. This only runs if `HUNTER_API_KEY` is configured.

**Strategy**:
1. Group Apollo-missed contacts by company
2. For each company, extract the email domain (if any contact has an email)
3. Run Hunter Domain Search on each unique domain
4. Match returned emails to contacts by first/last name (exact match, partial match, or email pattern match)
5. For unmatched contacts with a known domain, use Hunter Email Finder as a last resort

**Matching logic** (in priority order):
1. Exact match: first name AND last name match
2. Partial match: first name matches AND last name starts with same letter
3. Email pattern match: email contains `firstname.lastname` or `firstinitiallastname`

**After enrichment**, each contact's score is recomputed (the +15 email bonus now applies) and their tier may upgrade from Tier 3 to Tier 1 or Tier 2.

### 6.4 Enrichment Status Values

| Status | Meaning |
|---|---|
| `not_needed` | Contact was imported with an email — no enrichment required |
| `pending` | Contact needs enrichment (no email yet) |
| `enriched` | Email found via Apollo or Hunter |
| `not_found` | Both Apollo and Hunter failed to find an email |
| `failed` | API error during enrichment |

---

## 7. Stage 5: AI Email Generation

Once contacts are enriched with email addresses, personalised outreach emails can be generated.

### 7.1 Email Generation Inputs

The AI email generator (`outreachEmail.ts`) receives:

- **Contact info**: name, title, company, email, role bucket (inferred from title)
- **Project context**: if the contact's company matches any projects linked to the campaign's collateral, the top project's name, location, sector, and equipment signals are included
- **Collateral context**: the campaign's linked product (e.g., "DrillAir X1350 — Short-Package 25 Bar Truck-Deck Compressor")
- **Sender info**: name, title, company ("Atlas Copco Australia - Power Technique")
- **Tone**: one of `professional`, `consultative`, `direct`, `contractor_focused`, `owner_epc_focused`, `procurement_led`, `engineering_led`, `first_touch`

### 7.2 Role Bucket Inference

The contact's title is mapped to a role bucket for email personalisation:

| Title Pattern | Role Bucket |
|---|---|
| blast, paint, coat, surface, corrosion, abrasive | `construction` |
| procurement, purchasing, supply | `procurement` |
| engineer | `engineering` |
| operations, ops | `operations` |
| project manager, project director | `project_management` |
| maintenance, workshop | `maintenance` |
| fleet, equipment | `fleet` |
| managing director, general manager, CEO, director, owner | `executive` |
| (everything else) | `other` |

### 7.3 Project Matching

Before email generation, the system cross-references campaign contacts against projects matched to the campaign's collateral:
- Gets all projects linked to the campaign's collateral via `collateralProjectMatches`
- For each contact, does a fuzzy company name match against project owners
- Matched contacts get `matchedProjectIds` and `matchedProjectCount` updated
- Their score is recomputed with the project match bonus (+5 per match, up to +30)

### 7.4 Email Output

Each generated email includes:
- **Subject line**: personalised with the contact's company and relevant project/product
- **Body**: markdown-formatted, personalised based on role bucket, project context, and collateral
- **Key points**: bullet points summarising the email's main value propositions
- **Tone used**: the actual tone applied (may differ from requested if the system adapts)

The draft is saved to the contact record with `outreachStatus: "pending_approval"`.

---

## 8. Stage 6: Approval & Sending

### 8.1 Approval Workflow

| Status | Meaning | Next Action |
|---|---|---|
| `not_started` | No email drafted yet | Generate email |
| `email_drafted` | Draft exists | Review draft |
| `pending_approval` | Draft generated, awaiting review | Approve or reject |
| `approved` | Approved for sending | Send email |
| `rejected` | Draft rejected — cleared for regeneration | Regenerate email |
| `sent` | Email sent via Resend | Done |
| `replied` | Recipient replied | Track engagement |
| `bounced` | Email bounced | Review contact data |
| `opted_out` | Recipient opted out | Do not contact |

### 8.2 Email Sending

Emails are sent via the **Resend API** using the configured `EMAIL_FROM_ADDRESS` (default: `Atlas Copco PT Intelligence <digest@ptatlascopcointel.com>`).

**Attachments**: If the campaign has a linked collateral item (e.g., the X1350 flyer PDF), it is automatically attached to every outgoing email. If no collateral is linked, the system falls back to attaching the XAVS1800 flyer if one exists in the collateral library.

**Mark as Sent**: For users who prefer to send via Outlook or another external client, there is a `markEmailAsSent` function that updates the status without actually sending through Resend.

---

## 9. Database Schema

### 9.1 Campaigns Table

| Column | Type | Purpose |
|---|---|---|
| `id` | int (PK) | Auto-incrementing campaign ID |
| `name` | varchar(256) | Campaign name (e.g., "X1350 Drill Campaign") |
| `description` | text | Campaign description |
| `collateralId` | int | Linked collateral item ID |
| `collateralName` | varchar(256) | Display name of linked collateral |
| `senderName` | varchar(128) | Sender's display name |
| `senderEmail` | varchar(320) | Sender's email address |
| `senderTitle` | varchar(256) | Sender's job title |
| `targetSegment` | varchar(128) | Target segment (e.g., "blasting", "drilling") |
| `status` | enum | `draft`, `active`, `paused`, `completed` |
| `totalContacts` | int | Denormalised count of contacts |
| `enrichedContacts` | int | Denormalised count of enriched contacts |
| `emailsDrafted` | int | Denormalised count of drafted emails |
| `emailsApproved` | int | Denormalised count of approved emails |
| `emailsSent` | int | Denormalised count of sent emails |
| `createdBy` | int | User ID of campaign creator |

### 9.2 Campaign Contacts Table

| Column | Type | Purpose |
|---|---|---|
| `id` | int (PK) | Auto-incrementing contact ID |
| `campaignId` | int | Foreign key to campaigns |
| `firstName`, `lastName` | varchar | Contact name |
| `title` | varchar(256) | Job title |
| `company` | varchar(256) | Company name (as imported) |
| `reviewedCompanyName` | varchar(256) | Cleaned/verified company name |
| `email` | varchar(320) | Original email (from import) |
| `phone`, `mobile` | varchar(64) | Phone numbers |
| `score` | int | Composite score (0-100) |
| `tier` | enum | `tier1_hot`, `tier2_warm`, `tier3_enrich`, `tier4_low`, `excluded` |
| `titleRelevance` | enum | `blasting_specialist`, `decision_maker`, `operations`, `other`, `unknown` |
| `enrichmentStatus` | enum | `not_needed`, `pending`, `enriched`, `not_found`, `failed` |
| `enrichmentSource_cc` | enum | `apollo`, `hunter`, `manual` |
| `apolloPersonId` | varchar(128) | Stored Apollo ID for direct enrichment |
| `enrichedEmail` | varchar(320) | Email found via enrichment |
| `enrichedTitle` | varchar(256) | Updated title from enrichment |
| `enrichedLinkedin` | varchar(512) | LinkedIn URL from enrichment |
| `hunterConfidence` | int | Hunter.io confidence score (0-100) |
| `hunterVerificationStatus` | varchar(32) | `valid`, `accept_all`, `unknown`, `invalid` |
| `matchedProjectIds` | json | Array of matched project IDs |
| `matchedProjectCount` | int | Number of matched projects |
| `outreachStatus` | enum | Full outreach lifecycle status |
| `draftSubject`, `draftBody` | text | Generated email draft |
| `draftKeyPoints` | json | Key points from the AI-generated email |
| `draftTone` | varchar(64) | Tone used for the draft |
| `sentEmailId` | varchar(128) | Resend email ID after sending |

---

## 10. API Credit Consumption

Understanding credit usage is critical for cost management:

| Action | API | Credit Cost | When Used |
|---|---|---|---|
| LLM Domain Inference | Built-in LLM | 1 LLM call per 20 companies | Phase 0 of company search |
| Hunter Domain Search | Hunter.io | 1 request per domain | Phase 1 of company search + enrichment fallback |
| Hunter Email Finder | Hunter.io | 1 request per person | Enrichment fallback (when domain search doesn't match) |
| Hunter Email Verifier | Hunter.io | 1 verification per email | Optional verification step |
| Apollo People Search | Apollo.io | **Free** (no credits) | Phase 2 of company search + enrichment search |
| Apollo People Enrichment | Apollo.io | **1 credit per person** | Enrichment step (to get verified emails) |
| AI Email Generation | Built-in LLM | 1 LLM call per email | Email drafting |
| Email Sending | Resend | Per Resend pricing | Final send step |

**For your 378-company search**: The LLM domain inference used approximately 19 LLM calls (378 / 20 = 19 batches). Companies with inferred domains used 1 Hunter request each. Companies without domains used 1 Apollo search each (free). Total Apollo credits consumed: 0 during search, then credits are consumed during enrichment.

---

## 11. End-to-End Flow Diagram

```
User uploads CSV/Excel
        │
        ▼
┌─────────────────────┐
│  File Detection      │
│  (analyseImportFile) │
│                      │
│  >60% company-only?  │
│  YES → "companies"   │
│  NO  → "contacts"    │
└─────────┬───────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
COMPANIES    CONTACTS
    │           │
    ▼           │
┌──────────┐   │
│ Phase 0: │   │
│ LLM      │   │
│ Domain   │   │
│ Inference│   │
└────┬─────┘   │
     │         │
  ┌──┴──┐     │
  │     │     │
  ▼     ▼     │
HIGH/  LOW    │
MED    CONF   │
  │     │     │
  ▼     ▼     │
┌────┐ ┌────┐ │
│Hunt│ │Apol│ │
│er  │ │lo  │ │
│Dom │ │Name│ │
│Srch│ │Srch│ │
└──┬─┘ └──┬─┘ │
   │      │   │
   └──┬───┘   │
      │       │
      ▼       ▼
┌─────────────────┐
│ Import & Score   │
│ (0-100 composite)│
│ Tier assignment  │
│ Personal email   │
│ filter           │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Waterfall        │
│ Enrichment       │
│                  │
│ Step 1: Apollo   │
│ (1 credit/person)│
│                  │
│ Step 2: Hunter   │
│ (fallback)       │
│                  │
│ Rescore after    │
│ email found      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Project Matching │
│ (fuzzy company   │
│  name match)     │
│ +5 pts per match │
│ Rescore          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ AI Email Gen     │
│ (per contact)    │
│ Role-aware       │
│ Project-aware    │
│ Collateral-aware │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Approval Queue   │
│ Review → Approve │
│ or Reject        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Send via Resend  │
│ + PDF attachment │
└─────────────────┘
```

---

## 12. Known Limitations & Recommendations

### 12.1 Current Limitations

| Area | Limitation | Impact |
|---|---|---|
| **Apollo Search** | Returns obfuscated last names (e.g., "Co***s") | Name matching during enrichment may miss some contacts |
| **Apollo Enrichment** | 200 credits/day cap | Large campaigns (500+ contacts) take multiple days to fully enrich |
| **Hunter Domain Search** | Max 100 emails per domain | Very large companies may have contacts beyond the 100-email window |
| **LLM Domain Inference** | Relies on LLM knowledge, not live DNS | Some inferred domains may be outdated or incorrect (mitigated by confidence scoring) |
| **Scoring** | Blasting-centric weighting | The +20 blasting company bonus and +40 blasting specialist title score are hardcoded for the current product focus; campaigns for different products (e.g., DrillAir X1350 for drilling companies) don't benefit from this bonus |
| **Project Matching** | Fuzzy string match on company name | May miss matches where the company name differs significantly from the project owner name |
| **Email Sending** | Single sender domain | All emails come from `ptatlascopcointel.com`; no per-user sender domain support |
| **Background Jobs** | In-memory only | If the server restarts during a company search, the job is lost (30-min TTL) |

### 12.2 Recommendations for Future Improvement

**Short-term (high impact, low effort):**

1. **Product-aware scoring**: Make the scoring weights configurable per campaign. A drilling campaign should give bonus points for drilling-related titles (drill manager, rig manager, drilling superintendent) instead of only blasting titles. This could be driven by the campaign's `targetSegment` field.

2. **Domain verification step**: After LLM domain inference, add a quick HTTP HEAD request to verify the domain actually resolves before sending it to Hunter. This would catch incorrect inferences early and save Hunter API credits.

3. **Deduplication on import**: Currently, if the same company appears in multiple searches or uploads, duplicate contacts can be imported. Add a dedup check on (firstName + lastName + company) before inserting.

**Medium-term (significant impact):**

4. **Persistent background jobs**: Move the company search job from in-memory to the database. This would survive server restarts and allow the user to close the browser and come back later.

5. **Auto-enrichment after search**: When the company search completes, automatically trigger waterfall enrichment on the found contacts instead of requiring a separate manual step.

6. **Enrichment progress UI**: Show a progress bar during waterfall enrichment (similar to the company search progress), so the user knows how many contacts have been enriched and how many are remaining.

**Long-term (strategic):**

7. **Multi-product campaign support**: Allow campaigns to target different Atlas Copco product lines with product-specific scoring, email templates, and collateral attachments.

8. **Engagement tracking**: Track email opens, clicks, and replies to build a feedback loop that improves contact scoring and email generation over time.

9. **CRM integration**: Export enriched contacts and campaign results to Salesforce or HubSpot for seamless handoff to the sales team.

---

## 13. Appendix: API Rate Limits

| API | Rate Limit | Current Implementation |
|---|---|---|
| Hunter.io | 15 req/s, 500 req/min | 200ms delay (5 req/s) |
| Apollo.io | Varies by plan | 300-500ms delay |
| Built-in LLM | Platform-managed | 500ms between batches |
| Resend | 100 emails/day (free), higher on paid plans | No explicit rate limiting |

---

*This document reflects the system state as of 12 April 2026. Code references are to the production codebase at `/home/ubuntu/atlas-copco-intelligence/server/`.*
