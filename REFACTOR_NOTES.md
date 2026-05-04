# Weekly Dashboard Refactor Notes

## Current Architecture
- **ThisWeek.tsx** (925 lines) is the main landing page at `/` and `/this-week`
- **Home.tsx** (1957 lines) is the full dashboard at `/dashboard` with tabs (overview, projects, contacts, etc.)
- **thisWeekService.ts** (797 lines) provides `getThisWeekSummary(userId)` returning topProjects, newStakeholders, stageChanges, suggestedActions, stats
- **emailDigest.ts** (1946 lines) handles Monday digest + Thursday reminder

## What ThisWeek.tsx Currently Shows
1. **Header** — 64px navy bar with nav links, week label, territory
2. **ScopeBar** — territory/lane filter with Strict/Balanced/Open modes
3. **Micro-summary strip** — HOT count, WARM count, need discovery count
4. **Top Actions** (max 3) — TopActionCard components with priority badge, title, why-now, contact state, "Open" link
5. **Closing Soon** — collapsible, shows hot/warm tenders closing within 14d
6. **Waiting on Contact Discovery** — collapsible, projects without contacts
7. **Already Active / Claimed** — collapsible
8. **Warm Monitor** — collapsible
9. **New Stakeholders for My Scope** — collapsible, shows contacts
10. **Other Notable Stakeholders** — collapsible
11. **Stage Changes** — collapsible
12. **Weekly Coaching** — demoted toggle
13. **Manager Rollup** — admin only
14. **Pipeline Overview** — compact stats

## What Needs to Change (from spec)

### Part A: Quality-Gate Promotion Rules
- Only promote intel if: in-scope, hot/warm, active, named contact (not role-only), linked to project, confidence threshold, source known, no duplicates
- Below threshold → "waiting on contact discovery" or hidden admin-review
- Workflow: pipeline → sweep → dashboard refresh → admin preview → admin review → digest send

### Part B: UX Redesign
The current page is CLOSE to the reference but needs:
1. **Header strip** — show only: Hot, Warm, Action-ready, Need contact discovery, Closing soon (5 KPI pills)
2. **Top 3 Actions** — card-based, each shows: project/account, short why-now, contact name OR role gap, single next action, priority/status badge, "Detail" entry
3. **Collapsible sections**: Action-ready, Closing soon, Waiting on discovery
4. **Detail view** — clicking opens richer panel with: project summary, account/contractor, stakeholders, route-to-buy, suggested next step, collateral/angle, save/working/dismiss
5. Suppress "Unknown" clutter, no giant tables, no raw system detail

### Part C: Digest Alignment
- Top 3 actions, small closing soon list, small waiting list
- Only qualified new intel
- Digest send must remain review-first

## Key Components to Reuse
- ScopeBar, LaneBadge, NBACard, DismissButton already exist
- CollapsibleSection already exists
- CompactProjectRow already exists
- TopActionCard already exists

## Files to Modify
1. **client/src/pages/ThisWeek.tsx** — main rewrite
2. **server/thisWeekService.ts** — add quality-gate promotion logic, add "action-ready" count
3. **server/emailDigest.ts** — align digest sections with new dashboard structure
4. **server/routers.ts** — possibly add admin review/send gate endpoints

## Approach
The current ThisWeek.tsx is ~80% of the way there. Main changes:
- Replace micro-summary strip with 5-pill KPI header
- Tighten TopActionCard to match reference (project name as title, short pitch, contact/gap, next action)
- Remove: New Stakeholders section, Other Notable Stakeholders, Stage Changes, Already Active, Warm Monitor, Pipeline Overview, Coaching
- Add: "Action-ready" collapsible section (projects with contacts)
- Add: Detail view panel/page
- Add quality gate in thisWeekService to classify projects
