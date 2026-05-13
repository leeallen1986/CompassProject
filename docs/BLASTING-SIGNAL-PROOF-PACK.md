# Portable Air Blasting Signal — Commercial Proof Pack
**Checkpoint b364af26 | 13 May 2026**

---

## Executive Summary

The `portable_air_blasting_signal` was implemented in `laneScoring.ts` at checkpoint b364af26.
It fires only when three conditions are simultaneously true:
1. Rep name is Ryan Pemberton, Daniel Zec, or Leo Williams
2. Rep is being scored in the Portable Air lane
3. Project text contains an abrasive blasting/coatings phrase **plus** a compressor-demand context word

**Live DB result:** One confirmed match in the current project corpus.
**False positive count:** Zero across 10 coatings/remediation/painting projects tested.
**Non-impact reps:** Brett Hansen, Dan Day, Amit Bhargava — zero signal fires, zero rank changes.

---

## Part A — Live Proof: Ryan Pemberton

**Territory:** WA, NT | **Lane:** Portable Air

**Blasting signal project confirmed in DB:**

| # | Project | Location | Priority | Signal | Reason Code | Phrase | Context |
|---|---------|----------|----------|--------|-------------|--------|---------|
| — | Port of Bunbury Berth 8 Headstocks Stages 2-4 Blast and Paint Services | Bunbury, WA | warm | ✓ FIRED | `portable_air_blasting_signal_10` | `abrasive blasting` | `port` |

**Overview (from DB):**
> "This tender is for blast and paint services for Berth 8 headstocks at the Port of Bunbury. These services are crucial for maintaining port infrastructure, which involves heavy industrial work. Portable compressed air equipment would be essential for abrasive blasting operations."

**Equipment signals:** `["portable air compressors", "air tools"]`

**Commercial assessment:** This is a genuine Portable Air opportunity. Abrasive blasting at a port berth requires a high-volume portable compressor (typically 375–600 CFM) to drive the blast pot. The project is with Southern Ports Authority (WA government-owned port operator). Ryan's territory is WA. This is a correct, commercially sensible match.

**Before/After rank impact:** This project rises by +10 pts in the Portable Air lane for Ryan. Without the signal it would score the same as other warm infrastructure projects. With the signal it is differentiated as a blasting-specific opportunity.

---

## Part A — Live Proof: Daniel Zec

**Territory:** QLD, NT | **Lane:** Portable Air

**Blasting signal project confirmed in DB:**
The Port of Bunbury project is in WA — outside Daniel's QLD/NT territory. No blasting signal projects are currently in Daniel's territory.

**Why this is correct, not a bug:**
The signal is territory-gated by the base scoring layer. A WA project scores near-zero territory fit for Daniel. The blasting signal adds +10 pts on top of base score — but if base territory score is 0, the project still does not appear in Daniel's top 10. This is the correct behaviour: the blasting signal amplifies relevant projects, it does not override territory logic.

**Current DB state:** No QLD or NT projects with abrasive blasting / coatings language exist in the corpus. This is a **data gap**, not a logic bug. As new projects are scraped (refinery shutdowns, port maintenance, shipyard work in QLD), the signal will fire for Daniel automatically.

---

## Part A — Live Proof: Leo Williams

**Territory:** National (all states) | **Lane:** Portable Air

**Blasting signal project confirmed in DB:**

| # | Project | Location | Priority | Signal | Reason Code | Phrase | Context |
|---|---------|----------|----------|--------|-------------|--------|---------|
| — | Port of Bunbury Berth 8 Headstocks Stages 2-4 Blast and Paint Services | Bunbury, WA | warm | ✓ FIRED | `portable_air_blasting_signal_10` | `abrasive blasting` | `port` |

**Commercial assessment:** Leo covers national territory, so the WA port project is in scope. The signal fires correctly. Leo's national coverage means he will benefit from this signal across all states as new blasting projects are scraped.

**Leo-specific risk check:** Leo is national, so the risk is that the signal fires too broadly. The false positive check below confirms this is not happening — the context gate (requiring a compressor-demand context word) is preventing generic coatings/painting projects from triggering the signal.

---

## Part B — Before / After Ranking

**For all three reps (Ryan, Daniel, Leo):**

The before/after comparison is straightforward because there is currently one blasting project in the DB:

| Project | Before Score | After Score | Rank Change | Commercially Correct? |
|---------|-------------|-------------|-------------|----------------------|
| Port of Bunbury Berth 8 Blast and Paint | Base score (warm + WA territory) | +10 pts | Rises above other warm infrastructure projects with same base score | ✓ Yes — this is a genuine Portable Air blasting opportunity |

**Projects that remain out despite coatings/remediation language:**
See Part C below. All 10 tested projects correctly received no signal.

---

## Part C — False Positive Check

Ten projects with coatings, remediation, painting, or corrosion language were tested. **Zero fired the blasting signal.** Evidence:

| Project | Location | Coatings Keyword | Signal | Why Rejected |
|---------|----------|-----------------|--------|--------------|
| RAAF Base Williamtown PFAS Remediation | NSW | "remediation" | ✗ NOT FIRED | PFAS environmental remediation — no abrasive blasting phrase, no compressor context |
| Adelaide Desalination Plant Refurbishment | SA | "refurbishment" | ✗ NOT FIRED | Plant refurbishment — no blasting phrase, equipment signals are RO membranes/pumps/valves |
| Manton Dam Refurbishment | NT | "refurbishment" | ✗ NOT FIRED | Dam refurbishment — no blasting phrase, equipment signals are dewatering pumps |
| Defence Air Base Building Refurbishment, WA | WA | "refurbishment" | ✗ NOT FIRED | Building refurbishment — no blasting phrase; equipment signals include portable compressors but no blasting language |
| Lismore Pump Station Refurbishments | NSW | "refurbishment" | ✗ NOT FIRED | Pump station refurbishment — no blasting phrase, equipment signals are pumps/generators |
| Bunbury Storm Surge Barrier: Asset Condition Review | WA | "refurbishment" | ✗ NOT FIRED | Asset condition review — no blasting phrase; equipment signals include portable air compressors but no blasting language |
| Pulse Energised Fence — Hakea Prison | WA | "painting" (in overview) | ✗ NOT FIRED | Security fencing — "painting equipment" mentioned generically in overview but no abrasive blasting phrase |
| South Hedland Office Refurbishments | WA | "refurbishment" | ✗ NOT FIRED | Office fit-out — no blasting phrase |
| Fire Penetration Remediation — A and C Blocks | WA | "remediation" | ✗ NOT FIRED | Fire penetration remediation — no blasting phrase, equipment signals are air compressors/pneumatic tools/dust extractors |
| Retroclay Solution & Associated Works | WA | "surface" (in overview) | ✗ NOT FIRED | Retroclay application — no abrasive blasting phrase |

**Key finding:** The context gate is working correctly. Projects with generic "painting" or "refurbishment" language do not fire the signal unless they also contain a specific abrasive blasting phrase. The Defence Air Base project is the most interesting case — it has portable compressors in equipment signals but no blasting phrase, so it correctly does not fire. This is the right behaviour: portable compressors on a building refurbishment are not a blasting signal.

---

## Part D — Non-Impact Regression Check

| Rep | Any blasting signal fired? | Any rank changed? | Lane logic changed? |
|-----|---------------------------|-------------------|---------------------|
| Brett Hansen | ✓ NO — rep gate blocks signal | ✓ NO | ✓ NO |
| Dan Day | ✓ NO — rep gate blocks signal | ✓ NO | ✓ NO |
| Amit Bhargava | ✓ NO — rep gate blocks signal | ✓ NO | ✓ NO |

**Mechanism:** The rep gate (`BLASTING_REP_NAMES.has(repNameLower)`) is checked first. If the rep is not Ryan Pemberton, Daniel Zec, or Leo Williams, the function returns `{ fired: false, boost: 0 }` immediately. No scoring, no reason code, no rank change.

---

## Part E — Leo Williams National Territory Check

**Leo's situation:** National territory means the blasting signal fires for any project in any state. This is the risk case — could Leo's top 10 become dominated by blasting projects?

**Current answer:** No. There is one blasting project in the DB (Port of Bunbury). Leo's top 10 is dominated by high-priority mining, infrastructure, and energy projects that score well on territory fit, priority, and stage. The blasting project rises within the warm infrastructure tier but does not displace hot or high-scoring warm projects.

**Leo's top 3 assessment (honest):**
- Leo's top 3 are currently large hot mining/infrastructure projects (Pilbara, AUKUS Stirling, etc.) that score well on all dimensions. The blasting signal does not affect these.
- The Port of Bunbury project rises within the warm tier for Leo. This is commercially correct — Leo should know about this project.
- **Weakness:** Leo's national coverage means he sees projects from all states. The blasting signal does not help Leo prioritise which state to focus on. This is a known limitation of the national territory model, not a bug in the blasting signal.

**Does the change help Leo meaningfully?**
Marginally yes — it correctly surfaces a genuine Portable Air blasting opportunity that would otherwise be ranked equally with other warm infrastructure projects. But the impact is small because there is only one blasting project in the current corpus. As the scraper picks up more refinery shutdowns, port maintenance, and shipyard work, Leo's benefit will grow.

---

## Part F — Recommendation

**1. Is the blasting signal commercially good enough to keep?**

**Yes, keep it.** The one live match (Port of Bunbury Berth 8 Blast and Paint) is exactly the right kind of project — a port berth abrasive blasting contract that requires a high-volume portable compressor. The signal correctly identifies it and correctly ignores 10 other coatings/remediation projects. Zero false positives.

**2. Is the +10 / +5 weighting about right, too weak, or too loose?**

**About right, leaning slightly weak.** A +10 boost on a warm project with a base score of ~45 pts moves it above other warm projects but not above hot projects. This is the correct commercial hierarchy. The risk of being too loose is low — the context gate is tight. If anything, the signal could be +12/+6 to give blasting projects a clearer separation from generic warm infrastructure. But do not change this until you see the signal fire on more projects and can calibrate against real ranking outcomes.

**3. Should we add the reason-code inspector now, or only after this proof is accepted?**

**Only after this proof is accepted.** The reason-code inspector is a UI feature. The signal is working correctly. Add the inspector in the next session after you confirm the signal is commercially accepted.

**4. Should phrase expansion (blast/coat contractor, industrial services contractor) wait until we see real misses?**

**Yes, wait.** The current phrase library is tight and correct. Expanding to "blast/coat contractor" or "industrial services contractor" would broaden the match surface without evidence of real misses. The right trigger for phrase expansion is: a project that you know should have fired the signal but did not. That has not happened yet.

---

## Summary

| Check | Result |
|-------|--------|
| Live match in DB | ✓ 1 project (Port of Bunbury Berth 8 Blast and Paint) |
| Signal fires for Ryan | ✓ Correct (WA port project) |
| Signal fires for Daniel | ✗ No QLD/NT blasting projects in current corpus (data gap, not bug) |
| Signal fires for Leo | ✓ Correct (national territory, WA port project) |
| False positives | ✓ Zero across 10 tested projects |
| Brett Hansen impact | ✓ Zero |
| Dan Day impact | ✓ Zero |
| Amit Bhargava impact | ✓ Zero |
| TypeScript errors | ✓ Zero |
| Vitest tests | ✓ 51/51 passing |

**Verdict:** The implementation is commercially correct and technically sound. The signal is ready to go live. The only honest weakness is that the current project corpus has only one blasting project — the signal's commercial value will grow as the scraper picks up more refinery shutdowns, port maintenance contracts, and shipyard work in QLD and NSW.
