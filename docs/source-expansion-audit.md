# Source Expansion Audit — WA + NT Sprint

## Audit Date: 2026-04-22

---

## Existing Sources (Confirmed Working)

| Source | File | Coverage | Method | Status |
|--------|------|----------|--------|--------|
| RSS Harvest | `rssHarvest.ts` | AU-wide | RSS feeds (ENR, Mining News, etc.) | ✓ Working |
| AusTender | `austenderScraper.ts` | AU Federal | HTML scrape (Thursdays) | ✓ Working |
| DMIRS MINEDEX | `dmirsScraper.ts` | WA Mining | HTML scrape | ✓ Working (0 new this run) |
| ICN Gateway | `icnScraper.ts` | WA + NT curated | HTML scrape of curated list | ✓ Working |
| Gov Major Projects | `govMajorProjects.ts` | AU-wide | HTML scrape (Tuesdays) | ✓ Working |
| AEMO | `aemoScraper.ts` | Energy sector | HTML scrape (Fridays) | ✓ Working |
| ASX Monitor | `asxMonitor.ts` | ASX-listed companies | REST API | ✗ Broken (404 - degraded mode) |
| Projectory | `projectoryEnrichment.ts` | WA/NT enrichment | Session auth scrape | ✗ Broken (415 - degraded mode) |

---

## New Sources — Access Method Research

### 1. Tenders WA (`live_tender`)
- **URL:** https://www.tenders.wa.gov.au/watenders/
- **Access Method:** Session cookie + CSRF nonce POST flow
  - GET `/watenders/tender/search/tender-search.action` → get JSESSIONID cookie + CSRFNONCE
  - POST `/watenders/tender/search/tender-search.action?action=search-from-main-page&CSRFNONCE={nonce}` with `keywords=` param
  - Returns HTML with `<tr class="odd">` / `<tr class="even">` rows
  - Each row: agency (td.firstTableColumn), category (td.nowrap), title (td.left.top with link)
- **Relevance Filter:** Keywords: `mining`, `oil gas`, `compressor`, `drilling`, `infrastructure`, `construction`
- **Frequency:** Daily (open tenders change daily)
- **sourcePurpose:** `live_tender`
- **Notes:** CSRF nonce rotates per session. No public API. Scraper must maintain session.

### 2. WA Pipeline of Works (`forward_plan`)
- **URL:** https://www.wa.gov.au/service/government-financial-management/procurement/pipeline-of-works
- **Access Method:** Power BI embedded dashboard (no direct download link found)
  - Data updated twice yearly (last: Dec 2024)
  - Contains: project name, agency, estimated cost, procurement start quarter, phase
  - Transport projects excluded
- **Relevance Filter:** Construction, Mining, Energy, Oil & Gas sectors
- **Frequency:** Semi-annual (not suitable for daily pipeline run)
- **sourcePurpose:** `forward_plan`
- **Implementation:** Scrape the Power BI embed or parse the PDF when published
- **Notes:** Last PDF was Nov 2020. Current data is in Power BI only. Consider manual import + scheduled check.

### 3. WA Strategic Forward Procurement Plan (`forward_plan`)
- **URL:** https://app.powerbi.com/view?r=eyJrIjoiY2Y5ZTI1NzktNjlmMy00MTY3LTk5OGEtZjk1ZDJkMGQ5NWM5IiwidCI6ImI3MzRiMTAyLWEyNjctNDI5YS1iNDVlLTQ2MGM4YWQ2M2FlMiJ9
- **Access Method:** Public Power BI dashboard (no auth required)
  - Contains: agency, procurement description, estimated value, planned start date
  - Covers goods, services, community services, and works ≥ $250K
  - Two financial years forward
- **Relevance Filter:** Works category, value ≥ $250K, WA agencies
- **Frequency:** Updated periodically by agencies
- **sourcePurpose:** `forward_plan`
- **Implementation:** Power BI REST API or browser automation to extract data
- **Notes:** This is the most actionable forward-plan source for non-infrastructure works.

### 4. QTOL NT (`live_tender`)
- **URL:** https://tendersonline.nt.gov.au/
- **Access Method:** Public HTML API (no auth required)
  - GET `/Tender/SearchResults/{status}?page=1&size=50&category=1&category=2&category=4&category=5`
  - Returns HTML partial with `<div class="tender-card">` elements
  - Each card: tender number, agency, title, description, category, closing date
  - Status options: `Current`, `Closed`, `Awarded`, `Future`
  - Category IDs: 1=Building, 2=Civil, 4=Electrical/Mechanical, 5=Hydraulic
  - Agency IDs: 74=Dept of Logistics and Infrastructure, 32=Dept of Mining and Energy
- **Relevance Filter:** Categories 1,2,4,5 + Power & Water Corporation issuer tracking
- **Frequency:** Daily (current tenders)
- **sourcePurpose:** `live_tender`
- **Notes:** Clean, no auth, Alpine.js frontend with HTML partial API. Easiest to implement.

### 5. ICN Gateway Reinforcement (`contractor_path`)
- **URL:** https://www.icn.org.au/
- **Access Method:** Already scraped in `icnScraper.ts`
- **Enhancement:** Add NT-specific project tracking (Power & Water, DLI projects)
- **sourcePurpose:** `contractor_path`
- **Notes:** Already working. Just needs NT filter added.

---

## Implementation Priority

| Priority | Source | Effort | Signal Quality |
|----------|--------|--------|----------------|
| 1 | QTOL NT | Low (clean API) | High (live tenders) |
| 2 | Tenders WA | Medium (session+CSRF) | High (live tenders) |
| 3 | WA SFPP Power BI | High (Power BI scrape) | Medium (forward plan) |
| 4 | WA Pipeline of Works | High (semi-annual PDF) | Low (stale data) |

---

## sourcePurpose Tag System

| Tag | Meaning | Use in Weekly Brief |
|-----|---------|---------------------|
| `live_tender` | Active tender on a government portal | "Tender open now" — highest urgency |
| `forward_plan` | Planned procurement in next 2 years | "Coming to market" — plan ahead |
| `project_signal` | Project announced but not yet tendered | "Watch this" — monitor for tender |
| `contractor_path` | ICN/subcontract opportunity | "Subcontract path" — approach contractor |
| `awarded` | Contract awarded — contractor confirmed | "Approach winner" — direct outreach |

---

## Dedup / Precedence Rules

When the same project appears in multiple sources:
1. `live_tender` > `forward_plan` > `project_signal` (higher purpose wins)
2. Tenders WA / QTOL NT tender number is the canonical dedup key
3. If no tender number: match on project name + agency (fuzzy, 85% threshold)
4. Existing projects in DB: add new source to `sources` array, update `sourcePurpose` if higher priority
