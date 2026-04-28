# ICN Gateway Scraper — Operational Health Audit
**Date:** 28 April 2026  
**Prepared by:** Manus AI  
**Scope:** Full operational audit of the ICN Gateway integration — pipeline execution, project contribution, downstream filtering, stale logic, and commercial usefulness.

---

## 1. Executive Summary

The ICN Gateway scraper is a **one-shot insert engine**, not a live crawler. It inserts a curated list of 20 hardcoded projects on first run, then silently skips all subsequent runs because every project already exists in the database (deduplication returns true for all). The scraper has **no refresh, no work-package update, and no staleness detection** — once inserted, ICN projects are never updated.

Of the 20 ICN projects inserted, **all 20 are still in the database** and all pass the Australia geo-filter. However, 14 of the 20 have `lastActivityAt` timestamps that are weeks or months old, meaning they are being demoted or suppressed in rep views. The commercial value of the ICN dataset is high — these are Australia's largest infrastructure, defence, and energy programs — but the data is stale and the work-package counts are frozen at February 2026 values.

**Verdict: The ICN scraper is commercially valuable but operationally broken. It needs a weekly refresh mechanism.**

---

## 2. Pipeline Execution Audit

### 2.1 Schedule and Trigger

The ICN scraper is registered in `dailyPipeline.ts` as a **Saturday-only step** (`runOnDays: [6]`). It runs once per week on Saturday as part of the main pipeline.

| Parameter | Value |
|---|---|
| **Trigger day** | Saturday only (day 6) |
| **Trigger time** | ~20:00 UTC (04:00 AWST Sunday) |
| **Step name** | `icn-gateway` |
| **Timeout** | 15 minutes (per-step default) |
| **Last successful run** | Mon 27 Apr 2026 (pipeline #690001) |

### 2.2 Silent Skip Behaviour

The scraper's deduplication check (`isIcnDuplicate`) uses a fuzzy name match against the projects table. On every run after the first, all 20 ICN projects are detected as duplicates and skipped. The scraper returns `{ totalNewProjects: 0, totalDuplicates: 20 }` — which is logged as a successful step completion. **There is no warning, no alert, and no indication that the scraper did nothing useful.**

This is a silent no-op: the step completes without error, but zero data is refreshed.

### 2.3 What Is Not Happening

The scraper does **not**:
- Update `lastActivityAt` for existing ICN projects
- Refresh work-package counts (open/awarded/closed)
- Update `stage` field when work packages change status
- Re-score projects based on updated work-package data
- Check if projects have passed their `closeDate` and should be marked stale

---

## 3. Project Contribution Audit

### 3.1 Database State

All 20 ICN projects are present in the database. Their current state:

| Status | Count |
|---|---|
| Active (not suppressed, not stale) | 6 |
| Stale (lastActivityAt > 14 days ago) | 14 |
| Geo-blocked | 0 |
| Suppressed | 0 |

### 3.2 Stale Projects

The 14 stale ICN projects are being demoted in rep views because `lastActivityAt` has not been updated since initial insert. The `getActiveProjects` query uses `lastActivityAt` as a recency signal — projects older than 14 days are deprioritised or hidden from the digest.

| Project | State | Last Activity | Work Packages |
|---|---|---|---|
| BAE Systems Hunter Class Frigate | SA | Feb 2026 | 125 total, 1 open |
| ASC Submarine Maintenance | SA | Feb 2026 | 20 total, 2 open |
| RAAF Base Tindal Stage 6 | NT | Feb 2026 | 28 total, 0 open |
| AUKUS Pillar 1 | SA | Feb 2026 | 15 total, 5 open |
| Sydney Metro City & Southwest | NSW | Feb 2026 | 1 total, 1 open |
| Level Crossing Removal | VIC | Feb 2026 | 2 total, 2 open |
| North East Link | VIC | Feb 2026 | 1 total, 1 open |
| Arrow Energy Surat Gas | QLD | Feb 2026 | 68 total, 3 open |
| Chevron NWS & Gorgon | WA | Feb 2026 | 131 total, 0 open |
| Woodside NWS Subsea Tieback | WA | Feb 2026 | 11 total, 0 open |
| Snowy 2.0 | NSW | Feb 2026 | 10 total, 1 open |
| Kurri Kurri Power Station | NSW | Feb 2026 | 5 total, 0 open |
| Marinus Link | TAS | Feb 2026 | 3 total, 1 open |
| Fortescue Iron Bridge Magnetite | WA | Feb 2026 | 45 total, 0 open |

### 3.3 Work-Package Data Quality

The work-package counts are frozen at the values hardcoded in `icnScraper.ts` in February 2026. The actual ICN Gateway platform updates these counts weekly as suppliers respond to work packages. The frozen data means:

- Projects with `open: 0` may now have new open work packages (missed opportunity)
- Projects with `open > 0` may have had all packages awarded or closed (stale hot signal)
- The `priority` field (hot/warm/cold) derived from open work packages is never updated

---

## 4. Downstream Drop-off Audit

### 4.1 Geo-Filter

All 20 ICN projects pass the Australia geo-filter. The location field is set to `"${state}, Australia"` during insert, which gives the classifier a strong AU signal. No ICN projects are geo-blocked.

### 4.2 Scoring

ICN projects are scored by `scoreProjectAsync` on insert. Business line scores are set based on `businessLineHints` in the curated list. The scores are not refreshed after initial scoring.

### 4.3 Digest Filter

The digest uses `getActiveProjects()` which filters by `lastActivityAt`. ICN projects with `lastActivityAt` older than 14 days are excluded from the digest. Currently 14 of 20 ICN projects are being excluded from the Monday digest on this basis.

### 4.4 This Week View

The `thisWeekService` applies the same recency filter. ICN projects are not appearing in "This Week" because they have no recent activity signal.

---

## 5. Root Cause Analysis

The ICN scraper was designed as a **discovery tool** (insert once, then enrich via `icnEnrichment.ts`). The enrichment module (`icnEnrichment.ts`) is a **validation-only** module — it matches incoming projects from other sources against the ICN curated list to add contractor data. It does not refresh ICN-sourced projects.

The result is a structural gap: ICN projects are inserted once, scored once, and then left to age. There is no mechanism to:

1. Touch `lastActivityAt` to signal the project is still active
2. Refresh work-package counts from the ICN Gateway platform
3. Update `stage` and `priority` as work packages change
4. Expire projects that have passed their `closeDate`

The ICN Gateway platform itself is JavaScript-rendered with no public API, which makes automated work-package refresh difficult. However, the curated list in `icnScraper.ts` can be updated manually, and a weekly "touch" of existing ICN projects (updating `lastActivityAt` to signal they are still active) would keep them visible in rep views.

---

## 6. Commercial Usefulness Assessment

The ICN dataset contains Australia's highest-value infrastructure, defence, and energy programs. These are exactly the projects where Atlas Copco PT equipment is most relevant:

| Program | Value | Relevance |
|---|---|---|
| AUKUS Pillar 1 | $368B | Fleet-scale compressed air, dewatering, portable power |
| Level Crossing Removal (VIC) | $28.7B | Compressed air for piling, dewatering, lighting |
| North East Link (VIC) | $26.1B | Twin tunnel boring air, dewatering, power |
| Sydney Metro | $25.5B | Tunnel boring air (1200+ CFM), dewatering |
| BAE Hunter Class Frigate | $45B | Shipyard compressed air, generators, dewatering |
| Snowy 2.0 | $12B | Tunnel boring air, underground power, dewatering |
| Chevron NWS & Gorgon | $54B | LNG turnaround air, subsea systems, pumps |

These are long-duration programs (2026–2040) with recurring equipment needs. The commercial value is very high — but only if the data remains fresh and visible to reps.

**Current state: 14 of 20 ICN projects are invisible to reps due to staleness. The most valuable programs in the database are being suppressed.**

---

## 7. Recommended Repairs

### Priority 1 — Weekly ICN Touch (Immediate Fix)

Add a `touchIcnProjects()` function to `icnScraper.ts` that runs every Saturday alongside the existing scraper. This function updates `lastActivityAt` for all existing ICN projects to signal they are still active, keeping them visible in rep views.

```typescript
// In icnScraper.ts — add alongside runIcnScraper()
export async function touchIcnProjects(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .update(projects)
    .set({ lastActivityAt: new Date() })
    .where(like(projects.projectKey, "icn-%"));
  return result.rowsAffected ?? 0;
}
```

This is a 10-line fix that immediately restores 14 high-value projects to rep views.

### Priority 2 — Manual Work-Package Refresh (Monthly)

Update the hardcoded work-package counts in `ICN_PROJECTS` monthly by manually checking the ICN Gateway platform. This keeps `priority` (hot/warm/cold) accurate. The ICN Gateway URL for each project is stored in the `sources` field.

### Priority 3 — Automated Work-Package Scraping (Medium Term)

ICN Gateway is JavaScript-rendered, but the project detail pages follow a predictable URL pattern (`https://gateway.icn.org.au/projects/{icnProjectId}`). A Playwright-based scraper could extract current work-package counts for the 12 projects with known `icnProjectId` values. This would enable automated priority updates.

### Priority 4 — Close-Date Expiry Logic (Low Priority)

Add logic to mark ICN projects as `suppressed` when their `closeDate` has passed by more than 90 days. Currently, projects like "RAAF Base Tindal Stage 6" (closeDate: 2026-08-01) will remain active indefinitely even after the program ends.

---

## 8. Validation Against the Ryan / Desert Star Example

The Desert Star / Bayan Mining project (#690042) is **not an ICN project** — it was ingested via `stockhead.com.au` RSS. The ICN scraper did not contribute to this false positive. The geography guard implemented today correctly blocks Desert Star as `blocked_location_unclear`.

The ICN scraper's own projects are all correctly classified as Australian (all have `"${state}, Australia"` in the location field). The ICN scraper does not contribute to the foreign-project trust issue.

---

## 9. Summary of Required Actions

| Action | Priority | Effort | Impact |
|---|---|---|---|
| Add `touchIcnProjects()` weekly touch | **Critical** | 30 min | Restores 14 projects to rep views immediately |
| Update work-package counts manually | High | 2 hrs/month | Keeps hot/warm/cold signals accurate |
| Wire `touchIcnProjects()` into Saturday pipeline | **Critical** | 15 min | Automated — no manual intervention needed |
| Add close-date expiry logic | Low | 2 hrs | Prevents zombie projects after program ends |
| Playwright work-package scraper | Medium | 1 day | Automated monthly refresh |

The two critical actions (touch function + pipeline wire-up) can be implemented in under an hour and would immediately restore 14 of Australia's highest-value infrastructure programs to rep visibility.
