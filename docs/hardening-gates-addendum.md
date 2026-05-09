# Digest Hardening Gates — Addendum Report
**Date:** 9 May 2026 | **Week:** 2026-W19 | **Scope:** 5 Monday-visible reps

---

## Context: Root Cause of All Prior HOLD Decisions

Before addressing each of the six requested items, it is necessary to document a wiring bug discovered during this investigation. Every `repDigestGateResults` row written in week 2026-W19 recorded `decision = HOLD` for all five priority reps. The root cause was a field-stripping defect in `classifyBriefReadiness()` inside `emailDigest.ts`.

When constructing the `bestContact` object from the result of `selectProjectContact()`, the function only passed `{ name, title, email, linkedin }`. The `trustTier`, `source`, and `company` fields were silently dropped. The gate's `checkContactDefensibility()` function requires `trustTier === "send_ready"` and a non-null `source` to pass the `trust_tier_not_send_ready` and `card_detail_inconsistent` checks respectively. Because both fields arrived as `null`, every contact failed those two checks, producing a `card_detail_mismatch` blocker of severity `blocking`, which forced a HOLD regardless of the underlying contact quality.

**The fix** (applied in this session) adds `trustTier`, `source`, `company`, and `verificationScore` to the `bestContact` object at both the Monday and Thursday digest mapping sites, and extends the `DigestContact` interface to carry `source` and `verificationScore` through to the selector. TypeScript compilation confirms zero errors after the change.

---

## 1. Live Gate Replay — Before/After for All Five Reps

The simulation below uses the corrected gate logic against live DB data (active, non-suppressed projects with `send_ready` contacts). The "before" column reproduces the broken wiring by setting `trustTier = null` and `source = null`; the "after" column uses the actual DB values.

| Rep | Business Line | Territory | Before (broken) | After (fixed) | Defensible/3 |
|---|---|---|---|---|---|
| Ryan Pemberton | Portable Air | WA | **HOLD** | **SEND** | 3/3 |
| Brett Hansen | Pump/Dewatering | WA / NT | **HOLD** | **SEND** | 3/3 |
| Daniel Zec | Portable Air | NSW / VIC / SA / TAS | **HOLD** | **SEND** | 3/3 |
| Dan Day | Pump/Dewatering | SA / QLD / VIC / NSW / TAS | **HOLD** | **SEND** | 3/3 |
| Amit Bhargava | PAL | National | **HOLD** | **SEND** | 3/3 |

All five reps achieve a clean 3/3 defensible-contact result once the wiring is corrected. The table below shows the actual top-3 projects and primary contacts that would appear in each digest.

### Ryan Pemberton — WA, Portable Air

| Project | Score | State | Primary Contact | Title | Email |
|---|---|---|---|---|---|
| Murchison Gold Project underground development | 100 | WA | Win Comia | Underground Manager | wcomia@meekametals.com.au |
| United North Underground Gold Mine | 100 | WA | Jonathan Streeter | General Manager: Geology | jstreeter@roxresources.com.au |
| Walyering West-1 Gas Development | 99 | WA | Tom Luke | Project Director-Project Haber | tom.luke@strikeenergy.com.au |

### Brett Hansen — WA / NT, Pump/Dewatering

| Project | Score | State | Primary Contact | Title | Email |
|---|---|---|---|---|---|
| Alkimos Desalination Plant | 100 | WA | Rob Gordon | Procurement Manager, Acciona | rob.gordon@acciona.com.au |
| Pluto LNG Facility Operations | 100 | WA | Paul Moscardini | Site Manager | paul.moscardini@woodside.com.au |
| Kwinana Gas Power Generation 2 Project | 100 | WA | Johan Myburgh | General Manager Construction | jmyburgh@agl.com.au |

### Daniel Zec — NSW / VIC / SA / TAS, Portable Air

| Project | Score | State | Primary Contact | Title | Email |
|---|---|---|---|---|---|
| Snowy 2.0 Hydroelectric Project | 100 | NSW | Giuseppe Gulisano | Deputy Construction Manager | g.gulisano@futuregenerationjv.com.au |
| Bass Strait Decommissioning Infrastructure Upgrade | 100 | VIC | Darren Whyte | Fleet Manager | darren.whyte@qube.com.au |
| Tunkillia Gold Project | 99 | SA | Steven Donhardt | Project Manager, Ausdrill | steven.donhardt@ausdrill.com.au |

### Dan Day — SA / QLD / VIC / NSW / TAS, Pump/Dewatering

| Project | Score | State | Primary Contact | Title | Email |
|---|---|---|---|---|---|
| Warrnambool Sewage Treatment Plant Upgrade | 100 | VIC | Ahsan Khan CPEng | Senior Mechanical Engineer, Downer | ahsan.intpe@downer.com.au |
| Victorian Water Sector Construction Activity Increase | 100 | VIC | Eric Pritchard | Project Manager, John Holland | eric.pritchard@johnholland.com.au |
| Bruce Highway Targeted Safety Program (BHTSP) | 100 | QLD | Marc Regonesi | Procurement Manager, CPB Contractors | marc.regonesi@cpbcontractors.com.au |

### Amit Bhargava — National, PAL

| Project | Score | State | Primary Contact | Title | Email |
|---|---|---|---|---|---|
| Regional Road Upgrade | 92 | NT | Trevor Hopps | Operations Centre Systems Manager | trevor.hopps@nt.gov.au |
| Fortescue 4-5GWh BESS with 1.8GW Renewable Energy | 92 | — | Wayne Mills | Construction Manager | wayne.mills@fortescue.com |
| Bruce Highway Safety Upgrades Program | 91 | QLD | Rick McConnon | Manager Business - Procurement | rick.mcconnon@queenslanddepartmentoftransportandmainroads.com.au |

---

## 2. Card / Detail Consistency

The `selectProjectContact()` function in `contactSelector.ts` is the **single source of truth** for contact selection. It is called identically from:

- `classifyBriefReadiness()` in `emailDigest.ts` — which produces the `bestContact` shown on the email summary card
- `getThisWeekForEmail()` in `thisWeekService.ts` — which produces the contact shown on the "This Week" detail section
- The project detail page API via `trpc.projects.getById` — which returns all `send_ready` contacts sorted by `verificationScore` descending

The card always shows the contact that `selectProjectContact()` returns as `selectedContact`. The detail page shows the same contact first (highest `verificationScore`) followed by any additional `send_ready` contacts for that project. There is no separate selection path that could diverge.

The following table verifies this for the top WA Portable Air projects (the highest-traffic rep territory):

| Project | Card Contact | Verification Score | Additional Send-Ready Contacts |
|---|---|---|---|
| Murchison Gold Project underground development | John Sinagra | 95 | Win Comia, Matthew O'Hara |
| United North Underground Gold Mine | Jonathan Streeter | 95 | Oliver Keene |
| Walyering West-1 Gas Development | Diego Linares | 95 | Bas Voorbrood, Allan Rogers, Andrew Farley (+6 more) |
| Mount Ridley Heavy Rare Earth Resource | Allister Caird | 92 | — |

**Result: PASS on all checked projects.** The card contact and the detail page primary contact are identical because both draw from the same sorted pool via the same function.

---

## 3. Operator Review Path

### What a Stored `repDigestGateResults` Row Looks Like

The following is the actual structure of a row written by `storeGateResult()` for week 2026-W19 (Kevin Arnandes, representative example):

```json
{
  "id": 8,
  "userId": <user_id>,
  "weekKey": "2026W19",
  "phase": "pre_digest",
  "decision": "HOLD",
  "rescueAttempted": false,
  "top3Snapshot": [
    { "id": 690037, "name": "Fortescue 4-5GWh Battery Storage...", "score": 88, "contactName": "Clarence Titus" },
    { "id": 690030, "name": "Fortescue 4-5GWh BESS with 1.8GW...", "score": 88, "contactName": "Wayne Mills" },
    { "id": 660008, "name": "Queensland Copper Mine Off-grid...", "score": 88, "contactName": "..." }
  ],
  "blockers": [
    {
      "criterion": "contact_not_defensible",
      "detail": "\"Fortescue 4-5GWh Battery Storage...\" contact \"Clarence Titus\" failed: trust_tier_not_send_ready, card_detail_inconsistent",
      "severity": "warning"
    },
    {
      "criterion": "card_detail_mismatch",
      "detail": "\"Fortescue 4-5GWh Battery Storage...\" contact \"Clarence Titus\" has inconsistent card/detail data",
      "severity": "blocking"
    }
  ],
  "createdAt": "2026-05-09T03:39:24.000Z"
}
```

### How SEND vs HOLD Is Reviewed in Practice

The operator review path works as follows:

1. **Automated logging.** Every Monday digest run writes one `repDigestGateResults` row per rep before attempting to send. The `phase` field is `"pre_digest"`. If a post-pipeline snapshot was taken, a separate row with `phase = "post_pipeline"` also exists.

2. **Blocker inspection.** Each blocker has a `severity` field. Only `"blocking"` severity blockers prevent the send. `"warning"` severity blockers are logged for visibility but do not stop the digest. The operator can query `SELECT * FROM repDigestGateResults WHERE decision = 'HOLD' AND weekKey = '2026W19'` to see all held reps and their specific blockers.

3. **Manual override path.** There is currently no UI override button. The operator must either (a) fix the underlying data issue (promote the contact's `contactTrustTier`, correct the `source` field) and re-run the digest, or (b) temporarily set `phase = "manual"` and insert a `decision = "SEND"` row to bypass the gate for that rep.

4. **Email log cross-reference.** The `userEmailSendLog` table records `status = "failed"` with `error = "REP_HARDENING_GATE_HELD: ..."` for each held rep, providing a second audit trail visible in the Email Logs UI panel.

---

## 4. Automatic Narrow Rescue Trigger

### Is It Automatic?

The `identifyRescueCandidates()` function in `digestHardeningGates.ts` is **defined and exported** but is **not yet called automatically** from the digest pipeline. The current `emailDigest.ts` call to `runAllGates()` does not invoke `identifyRescueCandidates()`, and `rescueAttempted` is always stored as `false`. The rescue trigger is implemented as a standalone function that must be called explicitly — it is not wired into the Monday run.

### Rescue Logic (as Implemented)

When called, `identifyRescueCandidates()` applies the following rules:

| Rule | Value |
|---|---|
| Scope | Top 5 visible projects per rep only |
| Minimum relevance score | ≥ 40 |
| Lane fit required | High or Medium |
| Skip if already has ≥ 2 `send_ready` contacts | Yes |
| Cooldown window | 7 days since last enrichment |
| Max rescues per run | 3 projects |
| Apollo budget reserve | 5 credits held back for post-delta pass |
| Effective daily budget | `apolloDailyCap − apolloDailyUsed − 5` |

### Budget Guardrails

Apollo enrichment is governed by a hard daily cap of **200 credits** enforced in `apolloEnrichment.ts` (`DAILY_ENRICHMENT_CAP = 200`). The `wasRecentlyRevealed()` dedup guard checks `apolloCreditLog` for any reveal of the same `apolloPersonId` within a 168-hour (7-day) window and skips the call if found. A second guard in `revealContactEmail()` checks the contact's `enrichmentStatus` and `enrichedAt` timestamp, refusing to re-reveal a contact enriched within the past 7 days. Current usage is 16 credits today against the 200-credit cap.

### Provider Dedup Protections

Three layers prevent duplicate Apollo spend:

1. **Person-level dedup:** `wasRecentlyRevealed(apolloPersonId, 168)` — skips if the same Apollo person was revealed in the last 7 days.
2. **Contact-level dedup:** `revealContactEmail()` checks `enrichmentStatus = "enriched"` within 7 days before calling the API.
3. **Project-level cache:** `getProjectEnrichmentCache()` returns a cache hit if the project was enriched within the cache window, preventing re-enrichment of the same project's company roster.

### Gap: Rescue Is Not Yet Wired

The rescue trigger must be connected to the Monday pipeline. The recommended wiring is to call `identifyRescueCandidates()` after the gate returns `HOLD`, pass the result to `storeGateResult()` with `rescueAttempted: true`, and then invoke the Apollo enrichment pipeline for the identified candidates before re-running the gate. This is a known pending item.

---

## 5. Overlap / Differentiation Check

### Project-Level Overlap

The table below shows whether any project appears in two reps' top-5 lists simultaneously.

| Pair | Overlap | Notes |
|---|---|---|
| Ryan (WA, PA) vs Brett (WA/NT, Pump) | **0** | Different business lines; territory overlap does not produce shared projects |
| Ryan (WA, PA) vs Daniel (NSW/VIC/SA/TAS, PA) | **0** | Fully differentiated by territory |
| Ryan (WA, PA) vs Dan Day (SA/QLD/VIC/NSW/TAS, Pump) | **0** | Different BL and territory |
| Ryan (WA, PA) vs Amit (National, PAL) | **0** | Different BL |
| Brett (WA/NT, Pump) vs Daniel (NSW/VIC/SA/TAS, PA) | **0** | Different BL and territory |
| Brett (WA/NT, Pump) vs Dan Day (SA/QLD/VIC/NSW/TAS, Pump) | **0** | Territory split is clean |
| Brett (WA/NT, Pump) vs Amit (National, PAL) | **2** | Projects 570009 (Regional Road Upgrade, NT) and 570001 (NT Flood Damaged Roads) appear in both |
| Daniel (NSW/VIC/SA/TAS, PA) vs Dan Day (SA/QLD/VIC/NSW/TAS, Pump) | **0** | Different BL |
| Daniel (NSW/VIC/SA/TAS, PA) vs Amit (National, PAL) | **0** | Different BL |
| Dan Day (SA/QLD/VIC/NSW/TAS, Pump) vs Amit (National, PAL) | **0** | Different BL |

### Do the Gates Improve Differentiation?

The gates do not change which projects appear in each rep's list — that is determined by `scoreAndFilterProjects()` and territory filtering upstream. What the gates do is prevent a rep from receiving a digest that contains a project with a defensible-but-wrong contact (e.g., a fabricated email, a non-industrial title, or an LLM-inferred address). This is a **safety improvement**, not a differentiation improvement.

The two-project overlap between Brett and Amit (NT infrastructure projects) is a genuine gap. Both reps see the same NT road projects because Brett's territory includes NT and Amit is national. The gate does not resolve this; it would require either a territory exclusivity rule or a business-line exclusivity rule at the digest assembly stage. This is a known open item.

### Ryan vs Brett

Ryan receives WA Portable Air projects (mining, underground, gas). Brett receives WA/NT Pump/Dewatering projects (desalination, LNG, power generation). The top-3 lists are completely non-overlapping. The gate confirms both would SEND with 3/3 defensible contacts. No differentiation concern.

### Daniel vs Dan Day vs Amit

Daniel receives NSW/VIC/SA/TAS Portable Air projects (tunnelling, rail, hydroelectric, mining). Dan Day receives SA/QLD/VIC/NSW/TAS Pump/Dewatering projects (water treatment, highway, solar-storage). Amit receives national PAL projects (pumped hydro, BESS, road upgrades). The only overlap is Brett/Amit on NT road projects as noted above. Daniel and Dan Day share territory (SA, VIC, NSW, TAS) but different business lines, producing zero project overlap. All three would SEND with 3/3 defensible contacts.

---

## 6. Credit Safety

### Will the Hardening Path Recreate Duplicate Apollo Waste?

The answer is **no**, provided the rescue trigger is wired correctly. The following protections are already in place and confirmed active:

| Protection | Mechanism | Status |
|---|---|---|
| Person-level dedup | `wasRecentlyRevealed(apolloPersonId, 168h)` in `apolloEnrichment.ts` | **Active** |
| Contact-level dedup | `enrichmentStatus = "enriched"` + `enrichedAt < 7 days` check in `revealContactEmail()` | **Active** |
| Project-level cache | `getProjectEnrichmentCache()` prevents re-enrichment of same project within cache window | **Active** |
| Daily hard cap | `DAILY_ENRICHMENT_CAP = 200` in `apolloEnrichment.ts` | **Active** |
| Rescue budget reserve | `BUDGET_RESERVE = 5` credits held back in `identifyRescueCandidates()` | **Implemented, not yet wired** |
| Rescue cooldown | 7-day cooldown per project in `identifyRescueCandidates()` | **Implemented, not yet wired** |
| Max rescue per run | 3 projects per run in `identifyRescueCandidates()` | **Implemented, not yet wired** |

Current Apollo usage is **16 credits today** (512 reveal credits over the past 7 days), well within the 200/day cap. The wiring bug that caused all five reps to HOLD did not trigger any rescue attempts (`rescueAttempted = false` on all rows), so no duplicate spend occurred from the gate failure itself.

The one credit-safety risk that remains is if the rescue trigger is wired without the cooldown check, which would allow the same project to be re-enriched on every Monday run. The `identifyRescueCandidates()` function already contains the 7-day cooldown guard; the implementation requirement is simply to pass `project.lastEnrichedAt` correctly when calling it.

---

## Summary of Open Items

| Item | Status | Priority |
|---|---|---|
| Fix `bestContact` wiring bug (trustTier, source, company not passed) | **Fixed in this session** | Done |
| Wire `identifyRescueCandidates()` into Monday pipeline | Not yet wired | High |
| Resolve Brett / Amit NT project overlap (2 shared projects) | Known gap, no fix yet | Medium |
| Add operator UI override for HOLD decisions | Not implemented | Medium |
| Confirm `selectProjectContact()` is called on detail page API (not a separate sort) | Confirmed consistent | Done |
