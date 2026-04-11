# Pipeline Audit — Why "This Week" is Stuck at 2026-03-29

## Root Cause Analysis

### Issue 1: weekLabel depends on latest report
- `thisWeekService.ts` line 148-149 used `getLatestReport()?.weekEnding` for the week label
- Latest report in DB: weekEnding = "2026-03-29", generated 2026-03-30
- **FIX APPLIED**: Changed to always compute current week's Monday date

### Issue 2: Pipeline runs are hanging (8 of last 10 stuck in "running")
- Last successful run: 2026-03-26 (ID 240001) — completed in ~29 minutes
- Since then, 4 runs started but never completed:
  - ID 270001: started 2026-03-26T10:00 — STUCK
  - ID 300001: started 2026-03-27T13:50 — STUCK
  - ID 330001: started 2026-03-29T03:31 — STUCK
  - ID 360001: started 2026-03-30T04:56 — STUCK (latest)
- All stuck runs show: articlesExtracted=0, projectsCreated=0, completedAt=null

### Why the pipeline hangs
The pipeline is a sequential chain of 22 steps. Each step has try/catch, so individual step failures
should be caught. However, the pipeline has NO overall timeout. If any step hangs indefinitely
(e.g., an HTTP request that never resolves, a database query that locks), the entire pipeline
hangs forever and the status stays "running".

The scheduler uses setTimeout to schedule the next run AFTER the current one completes.
If the current run hangs, the next run is never scheduled. This is why no new runs happen.

### Most likely hanging steps
Given that stuck runs show 0 articles extracted, the hang likely occurs in:
1. **Step 1: RSS Harvest** — `harvestAllFeeds()` fetches multiple RSS feeds via HTTP
2. **Step 2: AI Extraction** — `runExtractionPipeline()` calls the LLM API

If Step 1 hangs on a feed that never responds, the pipeline never reaches Step 2.

### Fix needed
1. Add per-step timeouts (e.g., 5 minutes per step, 30 minutes total pipeline)
2. Add a global pipeline timeout wrapper
3. Clean up stale "running" pipeline runs on startup
4. Ensure scheduler reschedules even if current run fails/hangs
