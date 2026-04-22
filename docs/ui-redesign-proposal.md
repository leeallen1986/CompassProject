# Atlas PT Capital Sales — UI/UX Redesign Proposal

**Sprint scope:** This Week page · Project cards · Filter simplification · Light-touch project detail · PT lane visual language
**Constraint:** No backend changes. No data model changes. No Admin redesign. No enrichment/scheduler changes.
**Status:** Proposal for approval before building.

---

## 1. Design Principles

The product should feel like a **Monday worklist for reps** and a **clean operating view for managers** — not a backend status console or a dense intelligence report. Every design decision in this sprint is governed by five rules:

1. **Less by default.** Show only what is needed to make the next decision. Move everything else behind expand or "More".
2. **Stronger hierarchy.** One primary action per screen section. Supporting detail is visually subordinate.
3. **Fewer competing colors.** Reserve color for signal (priority, lane, action state). Neutral for everything else.
4. **Plain-English over raw metadata.** "Outreach ready — 2 contacts" beats "tier1_actionable / enrichmentSource: apollo / verificationScore: 72".
5. **Action-first, report-second.** The first thing a rep sees is what to do, not a summary of what the system knows.

---

## 2. PT Lane Color System (Part E — Applied Everywhere)

Before touching any page layout, establish one consistent lane badge system. This applies across This Week, project cards, project detail, and email preview references.

| Lane | Display Name | Color Token | Badge Style |
|---|---|---|---|
| `portable_air` | Portable Air | `#1E6FBF` (blue) | `bg-blue-600 text-white` |
| `pumps` | Pumps | `#0E8A6E` (teal-green) | `bg-emerald-700 text-white` |
| `pal` | PAL | `#7C3AED` (violet) | `bg-violet-600 text-white` |
| `bess` | BESS | `#D97706` (amber) | `bg-amber-600 text-white` |
| `multi_lane_pt` | Multi-Lane PT | `#475569` (slate) | `bg-slate-600 text-white` |
| `null` / unclassified | — | suppress | do not show a badge |

**Badge rules:**
- One lane badge per card, always in the header row.
- No secondary lane pills elsewhere on the same card.
- Lane badge is `text-[10px] font-bold uppercase px-2 py-0.5 rounded`.
- Do not repeat the lane label in the card body or footer.

**Where lane appears:**
- This Week action cards — header
- Project card (collapsed) — header row, next to priority badge
- Project card (expanded) — header only, not repeated in body sections
- Project detail page — page title row

**Where lane does NOT appear:**
- Filter chips (lane is a filter, not a repeated label)
- Contact rows
- Action buttons
- Email body (email uses plain text lane name in subject/header only)

---

## 3. Part A — This Week Page Redesign

### 3.1 Current State (Problems)

The current This Week page has these structural issues:

- **Hero header is ~180px tall** — uses a full-bleed background image with gradient overlay, large title, territory/sector pills, and a multi-item navigation row. This pushes all content below the fold.
- **Suggested Actions card** is a full-width card with a gold gradient background, rendered as a long list. It looks like a pasted email section rather than an action cockpit.
- **KPI strip** (4 cards: Your Projects / Action Now / Hot Priority / New This Week) appears before the suggested actions, adding more above-the-fold noise.
- **Data freshness warning** is a full-width amber banner that visually competes with the primary actions.
- **Weekly Coaching Panel** appears between the KPI strip and suggested actions, adding further visual weight.
- **Two-column layout** (Top Priority Projects 2/3 + New Stakeholders 1/3) comes after all of the above — by which point the user has already scrolled significantly.

### 3.2 Target Layout

```
┌─────────────────────────────────────────────────────────────┐
│ COMPACT HEADER (max 64px tall)                              │
│ "This Week — Week of Apr 21"  [territory pill]  [nav links] │
│ [freshness line — quiet, right-aligned]                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ TOP ACTIONS (3 cards, horizontal scroll on mobile)          │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│ │ HOT · PA     │ │ HOT · BESS   │ │ WARM · Pumps │         │
│ │ Project name │ │ Project name │ │ Project name │         │
│ │ Why now      │ │ Why now      │ │ Why now      │         │
│ │ [Contact]    │ │ [Disc. needed│ │ [Contact]    │         │
│ │ [Outreach ▶] │ │ [Enrich ▶]   │ │ [Outreach ▶] │         │
│ └──────────────┘ └──────────────┘ └──────────────┘         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ WAITING ON CONTACT DISCOVERY (collapsible, count badge)     │
│ 5 projects · [Enrich all ▶]                                 │
│ [project list — compact rows]                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ALREADY ACTIVE / CLAIMED (collapsible)                      │
│ [compact rows — projects the rep has already touched]       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ WARM MONITOR (collapsible)                                  │
│ [compact rows — warm/tier2 projects not yet actioned]       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ MANAGER ROLLUP (admin only — visually subordinate)          │
│ [existing ManagerRollup component, no redesign]             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Section Specifications

**Compact Header**
- Remove the background image and full-bleed gradient. Replace with a flat `bg-navy` bar, max height 64px.
- Keep: "This Week", week label, territory pill, user name, sign out link.
- Remove from header: KPI strip, sector pills, business line pills, coaching panel, the "ATLAS COPCO" wordmark (move to sidebar or remove from this page).
- Freshness line: `text-[11px] text-slate-400` right-aligned in the header bar. Format: `Data: Apr 22, 2026`. If stale (>7 days), change to `text-amber-400` — no banner, no icon.
- Navigation links (Full Dashboard, Pipeline, My Style, Collateral, Admin, Sign Out) move to a compact icon row in the header right side, or collapse into a `···` menu on mobile.

**Top Actions strip**
- Show the top 3 `suggestedActions` as horizontal cards (3-up grid on desktop, horizontal scroll on mobile).
- Each action card is `max-w-xs`, fixed height ~160px.
- Card structure (see Part B for full spec).
- If fewer than 3 actions exist, show what is available without empty placeholders.
- "View all actions →" link below the strip.

**Waiting on Contact Discovery**
- Collapsible section. Default: expanded if count > 0, collapsed if count = 0.
- Header: `[Search icon] Waiting on Contact Discovery · {count} projects · [Enrich all]`
- Body: compact project rows (project name, lane badge, location, [Enrich] button).
- Source: `topProjects` where `sendReadiness === "contact_discovery_needed"` or `contacts.length === 0`.

**Already Active / Claimed**
- Collapsible section. Default: collapsed.
- Source: `topProjects` where `lifecycleStatus === "contacted"` or action tracker shows a logged action this week.

**Warm Monitor**
- Collapsible section. Default: collapsed.
- Source: `topProjects` where `priority === "warm"` and `actionTier === "tier2_warm"` and not already in Top Actions.

**Manager Rollup**
- Visible only for `user.role === "admin"`.
- Visually subordinate: use a `border border-border rounded-lg` card with `bg-card` — no gold gradient, no prominent header.
- Keep the existing `ManagerRollup` component unchanged.

**Removed from This Week page:**
- `WeeklyCoachingPanel` — move to a dedicated `/coaching` page or collapse into a dismissible banner.
- `NBACard` — move into the Top Actions strip (it is already the right concept).
- `ActionTracker` — keep, but move below the four main sections.
- The 4-KPI strip — remove from This Week. KPIs belong on the full Dashboard (`/dashboard`).

### 3.4 Files to Change

| File | Change |
|---|---|
| `client/src/pages/ThisWeek.tsx` | Full layout restructure — header, sections, collapsible logic |
| `client/src/components/WeeklyCoachingPanel.tsx` | Wrap in collapsible or move to separate page |
| `client/src/components/NBACard.tsx` | Integrate into Top Actions strip |

---

## 4. Part B — Project Card Redesign

### 4.1 Current State (Problems)

The current `ProjectCard` collapsed header shows: priority badge · lane badge · tier badge · lifecycle badge · stage badge · sector icon · project name · location · value · owner · `isNew` badge · action tier label. That is 8–10 metadata items visible before expansion.

### 4.2 New Card Structure

**Collapsed (default view — everything a rep needs to scan in 3 seconds):**

```
┌─────────────────────────────────────────────────────────────┐
│ [HOT] [Portable Air]                          [New] [▼]     │
│ Project Name — truncated to 2 lines                         │
│ Owner · Location                                            │
│ Why now: one plain-English sentence                         │
│ [● John Smith — Procurement Manager]  or  [◎ Discovery needed] │
│ [Outreach ▶]  [Claim]  [View details →]                     │
└─────────────────────────────────────────────────────────────┘
```

**Expanded (on click — full detail):**

```
┌─────────────────────────────────────────────────────────────┐
│ [same header]                                               │
│ ─────────────────────────────────────────────────────────── │
│ Overview / project description                              │
│ Stage: [stage label]  Route to buy: [contractor or TBC]     │
│ ─────────────────────────────────────────────────────────── │
│ Contacts (7–10 shown, ranked by relevance)                  │
│ [Enrich button if no contacts]                              │
│ ─────────────────────────────────────────────────────────── │
│ Recommended Collateral                                      │
│ ─────────────────────────────────────────────────────────── │
│ [More detail: sector, lifecycle, action tier, scores ▼]     │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Visible vs Hidden Fields

| Field | Collapsed | Expanded | Hidden |
|---|---|---|---|
| Priority badge (HOT/WARM/COLD) | ✅ | ✅ | — |
| PT lane badge | ✅ | ✅ (header only) | — |
| Project name | ✅ | ✅ | — |
| Owner + location | ✅ | ✅ | — |
| Why-now summary (plain English) | ✅ | ✅ | — |
| Contact state (named / discovery needed) | ✅ | ✅ | — |
| Action buttons (Outreach / Claim / View) | ✅ | ✅ | — |
| isNew badge | ✅ (small dot) | — | — |
| Stage / lifecycle | — | ✅ | — |
| Route to buy / contractor | — | ✅ | — |
| Full contact list (7–10) | — | ✅ | — |
| Recommended collateral | — | ✅ | — |
| Sector | — | — | ✅ (in "More detail") |
| Action tier label | — | — | ✅ (in "More detail") |
| Verification scores | — | — | ✅ (in "More detail") |
| Enrichment source | — | — | ✅ (in "More detail") |
| Business line relevance scores | — | — | ✅ (in "More detail") |

### 4.4 "Why Now" Field

The current card shows `overview` (raw project description) in the collapsed view. Replace this with a `whyNow` field — a one-sentence plain-English summary of why this project is relevant this week. This field already exists in the `thisWeek.summary` response for `suggestedActions`. For the full project list, derive it from: `actionTier === "tier1_actionable"` → "Action required now", `stageCode` change → "Stage advanced this week", `isNew` → "New project this week", otherwise `overview` truncated to 120 chars.

### 4.5 Files to Change

| File | Change |
|---|---|
| `client/src/components/ProjectCard.tsx` | Restructure collapsed header, add "why now", contact state row, footer buttons |

---

## 5. Part C — Filter Simplification

### 5.1 Current State (Problems)

The `/dashboard` (Home.tsx) currently shows filters across multiple rows: priority buttons (All / Hot / Warm / Cold) + sector buttons (All Sectors / Mining / Oil & Gas / Infrastructure / Energy / Defence) + contacts sub-filters (Source / Role / Relevance). This creates a control panel feel.

### 5.2 New Filter Model

**Primary filters (always visible — one row):**

| Filter | Type | Options |
|---|---|---|
| PT Lane | Pill group | All · Portable Air · Pumps · PAL · BESS · Multi-Lane PT |
| Priority | Pill group | All · Hot · Warm · Cold |
| Territory | Pill group | All · WA · QLD · NSW · VIC · SA · NT (user's territories first) |

**Advanced filters (hidden behind "More filters ▼" toggle):**

| Filter | Options |
|---|---|
| Sector | All · Mining · Oil & Gas · Infrastructure · Energy · Defence |
| Lifecycle | All · Active · Stale · Archived · Awarded · Completed |
| Action tier | All · Action Now · Warm · Monitor |
| Contact state | All · Send ready · Discovery needed · No contacts |

**Rules:**
- When a lane filter is active, project counts update to reflect only that lane.
- Default state: All lanes · All priorities · user's own territory pre-selected.
- "More filters" badge shows count of active advanced filters (e.g., "More filters (2)").
- Advanced filters are cleared when "More filters" panel is closed if user clicks "Reset".
- Do not remove any existing filter capability — only reorganize visibility.

### 5.3 Files to Change

| File | Change |
|---|---|
| `client/src/pages/Home.tsx` | Replace current PriorityFilter + SectorFilter with new 3-primary + advanced model |

---

## 6. Part D — Project Detail (Light Touch)

### 6.1 Current State (Problems)

The expanded `ProjectCard` stacks sections in this order: overview → stage/lifecycle → business line scores → contacts → contractor/source → action tier. Contacts and actions are too far down.

### 6.2 New Section Order

```
1. Header (unchanged — priority, lane, name, location)
2. Why now (one sentence)
3. Contacts (7–10, ranked — moved to top of expanded area)
4. Action buttons (Outreach / Enrich / Claim)
5. Recommended Collateral
6. Overview / project description
7. Stage · Route to buy · Contractor (simplified, no raw URLs)
8. [More detail ▼] — sector, lifecycle, action tier, scores, enrichment source
```

### 6.3 Contractor Rendering (already patched for email — apply same rule to card)

The contractor sanitizer already exists in `emailDigest.ts`. Apply the same `sanitizeContractorName()` function to the `ProjectCard` expanded view. If contractor name contains `<`, `>`, `http`, `//`, or a hex color code, suppress the line rather than rendering broken content.

### 6.4 Files to Change

| File | Change |
|---|---|
| `client/src/components/ProjectCard.tsx` | Reorder expanded sections, apply contractor sanitizer |

---

## 7. What Stays the Same

The following are explicitly out of scope for this sprint and must not be changed:

- Stage 5 project logic and scoring
- Contact scoring and verification logic
- Enrichment provider logic (Apollo, Projectory)
- Send/scheduler logic
- Admin page
- Collateral Library (deep redesign)
- Onboarding flow
- Pipeline page
- Campaign Builder
- Database schema
- tRPC procedures (except minor additions for `whyNow` field if needed)

---

## 8. Rollout Order

| Phase | Scope | Files | Risk |
|---|---|---|---|
| **1** | PT lane color system | `ProjectCard.tsx`, `ThisWeek.tsx`, `index.css` (tokens) | Low |
| **2** | This Week page restructure | `ThisWeek.tsx`, `WeeklyCoachingPanel.tsx` | Medium |
| **3** | Project card redesign | `ProjectCard.tsx` | Medium |
| **4** | Filter simplification | `Home.tsx` | Low |
| **5** | Project detail light touch | `ProjectCard.tsx` (expanded section order) | Low |

Each phase is independently deployable. Phase 1 is a prerequisite for all others (establishes the lane token system). Phases 2–5 can proceed in order without blocking each other.

---

## 9. Logic Dependencies to Watch

| Dependency | Risk | Mitigation |
|---|---|---|
| `suggestedActions` array from `thisWeek.summary` — Top Actions strip depends on this | If array is empty, strip shows nothing | Show "No urgent actions this week" placeholder |
| `sendReadiness` field on projects — used to populate "Waiting on Contact Discovery" | Field must be present in `thisWeek.summary.topProjects` | Confirm field exists before building; add to query if missing |
| `lifecycleStatus === "contacted"` for "Already Active" section | Depends on action tracker writes | Fall back to action tracker `loggedActions` if `lifecycleStatus` is not set |
| Contractor sanitizer — currently only in `emailDigest.ts` | Need to extract to shared utility | Move `sanitizeContractorName()` to `shared/utils.ts` and import in both places |
| `whyNow` field — not currently in `thisWeek.summary.topProjects` | Needs minor server addition or client-side derivation | Derive client-side from `actionTier` + `isNew` + `stageCode` change; no backend change required |

---

## 10. Summary

This proposal covers five focused areas with no backend changes. The core redesign philosophy is: **show less, make the next action obvious, and move debug-level detail behind expand**. The PT lane color system is the foundation — once that is consistent, every other change builds on it cleanly.

**Ready to build on approval.**
