# Leo Williams — Next-Cycle Candidate Pool & Ranking Analysis

**Date:** 2026-05-11  
**Status:** HOLD (excluded from current send cycle)  
**Gate result:** 9 blockers — `not_commercially_sensible` on all top 3, `insufficient_defensible_contacts` (0/3)

---

## Problem Statement

Leo Williams is a **national account manager** covering all 8 Australian territories with `salesMotion: direct_only` and `assignedBusinessLines: ["Portable Air"]`. His profile matches 536 of 655 active projects. The current ranking algorithm surfaces the **largest national projects by relevance score** (Arrow Energy Surat Gas, Bass Strait Decommissioning, Bruce Highway), but these are mega-projects where:

1. **Portable Air demand is weak or unclear** — the gate correctly flags them as `not_commercially_sensible`
2. **No contacts have been enriched** — 0/3 top projects have `send_ready` contacts
3. **The route-to-buy is indirect** — Leo would be approaching Tier 1 contractors on projects where compressor demand is a small line item

The root cause is that the scoring algorithm treats "high relevance score" as the primary sort key, but relevance score measures territory + sector + deal size fit — it does **not** measure Portable Air commercial demand strength.

---

## Ranking Adjustment Required

The digest scoring for national Portable Air reps needs a **PA demand multiplier** that boosts projects with explicit compressor/air signals and penalises projects where PA fit is only inferred from sector. Specifically:

| Current Behaviour | Required Behaviour |
|---|---|
| Sort by `relevanceScore` descending | Sort by `relevanceScore × paFitMultiplier` descending |
| PA fit is binary (in BL or not) | PA fit is graded: strong (direct compressor demand) > medium (sector implies) > weak (generic mega-project) |
| National rep sees same top 3 as territory reps | National rep sees PA-concentrated projects, not just biggest projects |

**Proposed `paFitMultiplier` logic:**

```
Strong PA signals (compressor, blast, tunnel, TBM, drill rig, nitrogen, pigging):
  multiplier = 1.5

Medium PA signals (mining sector, drilling, underground, quarry):
  multiplier = 1.2

No PA signals (generic infrastructure, highway, rail without tunnel):
  multiplier = 0.6
```

This would push projects like "BAE Systems Hunter Class Frigate" (blasting), "Snowy 2.0" (tunnel/TBM), and "Port of Bunbury Blast & Paint" above generic highway projects in Leo's ranking.

---

## Revised Top 10 Candidate Pool (PA-Fit Ranked)

| # | Project | PA Fit | Priority | Sector | Contacts | Enrichment |
|---|---|---|---|---|---|---|
| 1 | Retroclay Solution & Associated Works | 15 (compressor, blast, sandblast, portable air) | warm | infrastructure | 0 | **Need new contacts** |
| 2 | Beckenham Depot Workshop Storage Extension | 15 (compressor, blast, sandblast, portable air) | warm | infrastructure | 0 | **Need new contacts** |
| 3 | PoE Tug Pen Jetty Replacement — Supply Pilings | 12 (compressor, compressed air, pneumatic, portable air) | warm | infrastructure | 5 (all unknown) | **Enrich Isabelle Penrose, Sanjay Jettywala** |
| 4 | Port of Bunbury Berth 8 Blast & Paint | 12 (compressed air, blast, abrasive blast) | warm | infrastructure | 1 (unknown) | **Enrich Jarrah Williams** |
| 5 | Darwin Bayview LV Cable Replacements | 10 (compressor, portable air, trenching) | **hot** | energy | 3 (all unknown) | **Enrich Marcus Papas, Anya Singh** |
| 6 | BAE Systems Hunter Class Frigate | 9 (compressed air, blast, blasting) | **hot** | defence | 1 (unknown) | **Enrich Vaibhav Agrawal** |
| 7 | Snowy 2.0 Pumped Hydro | 9 (blast, tunnel, TBM) | **hot** | energy | 1 (unknown) | **Enrich Kaelan O'Shaughnessy** |
| 8 | Suburban Rail Loop (SRL) East | 9 (tunnel, TBM, boring machine) | warm | infrastructure | 2 (all unknown) | **Enrich Tim Nguyen** |
| 9 | Rottnest Island Water Distribution Network | 9 (compressed air, pneumatic, trenching) | warm | infrastructure | 0 | **Need new contacts** |
| 10 | New Rail Loop Tunnelling Project | 9 (compressed air, tunnel, boring machine) | warm | infrastructure | 2 (all unknown) | **Enrich Kylie Nyoongar** |

---

## Contact Enrichment Priority (Next Cycle)

The following contacts should be enriched via Apollo/Hunter in priority order. Only 2 of the top 3 need to reach `send_ready` for the gate to pass.

| Priority | Contact | Company | Domain | Project |
|---|---|---|---|---|
| 1 | Vaibhav Agrawal | BAE Systems Australia | baesystems.com.au | Hunter Class Frigate (hot) |
| 2 | Kaelan O'Shaughnessy | Snowy Hydro Limited | snowyhydro.com.au | Snowy 2.0 (hot) |
| 3 | Marcus Papas | Power and Water Corporation | powerwater.com.au | Darwin Bayview (hot) |
| 4 | Anya Singh | Power and Water Corporation | powerwater.com.au | Darwin Bayview (hot) |
| 5 | Tim Nguyen | Suburban Rail Loop Authority | srla.vic.gov.au | SRL East (warm) |
| 6 | Isabelle Penrose | Southern Ports Authority | southernports.com.au | Tug Pen Jetty (warm) |
| 7 | Jarrah Williams | Southern Ports Authority | southernports.com.au | Bunbury Blast & Paint (warm) |

**Minimum viable path to SEND:** Enrich contacts #1 and #2 (BAE Systems + Snowy Hydro). Both are large organisations with public-facing procurement teams — high probability of successful email verification.

---

## What Commercially Sensible Means for Portable Air

The `not_commercially_sensible` gate fires when a project's `laneFitLabel` is "Portable Air" but the project description doesn't contain evidence of compressor demand. For Leo's next cycle, the top 3 projects should all pass this check because they contain explicit PA demand signals:

- **BAE Systems Hunter Class Frigate** — compressed air for blasting/surface prep in shipyard (confirmed PA demand)
- **Snowy 2.0** — TBM operations require massive compressed air supply for tunnel boring and shotcrete (confirmed PA demand)
- **Darwin Bayview Cable Replacements** — trenching + compressor for pneumatic tools (confirmed PA demand)

---

## Implementation Notes

To implement the PA demand multiplier in the scoring algorithm:

1. Add a `computePaFitMultiplier(project)` function in `emailDigest.ts`
2. Apply it as a post-score modifier: `finalScore = relevanceScore * paFitMultiplier`
3. Only apply for reps with `assignedBusinessLines` containing "Portable Air"
4. The keyword lists should be configurable (stored in DB or constants file)
5. This does NOT affect other reps (Brett, Ryan, etc.) who have territory-scoped profiles — their top 3 are already PA-relevant because territory filtering narrows the pool

---

## Summary

| Item | Status |
|---|---|
| Leo excluded from current send | ✅ |
| Next-cycle top 10 identified | ✅ (PA-fit ranked) |
| Commercially sensible projects identified | ✅ (6/10 have explicit compressor demand) |
| Contacts needing enrichment | 7 contacts across 5 projects |
| Ranking adjustment documented | ✅ (paFitMultiplier proposal) |
| Minimum viable path to SEND | Enrich BAE Systems + Snowy Hydro contacts |
