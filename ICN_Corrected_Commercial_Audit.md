# ICN Corrected Commercial Audit — 28 April 2026

**Scope:** 23 ICN-sourced projects with `lastIcnSeenAt IS NOT NULL`, validated against actual rep territory and business-line assignments.

---

## Executive Summary

The repaired ICN source is technically operational — all 23 projects are active, BL-tagged, and digest-eligible. However, **ICN's commercial usefulness is severely limited by contact poverty.** Only 9 of 23 projects have any contacts at all, and of those, only 1 project (ASC Submarine) has more than 4 contacts — and that project's 883-contact count is almost entirely CRM invoice-line junk, not decision-makers.

**The honest assessment:** ICN projects are high-quality strategic signals (correct sector, correct geography, correct work-package detail), but they are not yet action-ready for most reps. The platform currently treats them as if they are enriched opportunities, when in reality 14 of 23 are discovery-needed shells with zero contacts.

**Contact count inflation in the previous audit was caused by:**
1. Counting all contacts linked to a project, including CRM invoice records (email addresses like `portal.invoices@atlascopco.com`) that are Atlas Copco's own internal billing contacts — not external decision-makers
2. Counting contacts with phone numbers stored in the `roleBucket` field (data quality issue from CRM import)
3. Not distinguishing between scraper-sourced contacts (2–4 per project, usually relevant) and CRM-imported contacts (hundreds per project, mostly irrelevant)

---

## Section 1: ICN Project State

| Bucket | Count | Definition |
|---|---|---|
| **Action-Ready** | 9 | BL match + high-relevance contacts + send-ready email + hot/warm priority |
| **Discovery-Needed** | 14 | BL match but zero contacts or no relevant decision-makers |
| **Monitor-Only** | 0 | No BL match or >60 days stale |
| **Digest-Eligible** | 23 | BL match + active within 30 days |
| **This Week** | 9 | Action-ready + hot/warm |
| **Account Attack** | 5 | Action-ready + hot + 2+ send-ready contacts + contractor detail |

**Challenge to "all 23 digest-eligible":** Technically correct — all 23 have BL matches and are within the 30-day activity window. But **digest-eligible does not mean digest-worthy.** A project with zero contacts and no contractor detail is a headline, not an actionable item. Recommended digest treatment:

| Bucket | Digest Treatment | Count |
|---|---|---|
| Weekly Digest (full card) | Action-ready projects with contacts | 9 |
| This Week (highlight) | Hot action-ready with 2+ send-ready contacts | 5 |
| Account Attack (top priority) | Hot + contractor detail + multiple contacts | 5 |
| Monitor-only (footnote mention) | Discovery-needed projects listed as "emerging" | 14 |

---

## Section 2: Per-Rep ICN Scope (Corrected)

### Leo Williams — NATIONAL — Portable Air

Leo sees all 23 ICN projects because he is national + Portable Air (BL ID 1), which every ICN project carries.

| Status | Count |
|---|---|
| Action-Ready | 9 |
| Discovery-Needed | 14 |

**Top 3 action-ready projects for Leo:**

| Project | Location | Contacts | High-Relevance | Send-Ready | Why |
|---|---|---|---|---|---|
| ASC Submarine Maintenance | SA | 883 (see inflation note) | 10 | 30 | Largest contact pool, but 881/883 are CRM junk |
| Carmichael Mine — Bravus | QLD | 4 | 4 | 4 | All 4 contacts are relevant (PM, ops, engineering) |
| Fortescue Iron Bridge | WA | 2 | 2 | 2 | Both contacts are operations-level at FMG |

**Best real contacts:** Anita Maria Karba-Staggl (PM, Woodside Energy), Shelley Morgan (PM, ASC Pty Ltd), Vaibhav Agrawal (Sr Engineering Manager, BAE Systems)

**Honest assessment:** Leo has 9 "action-ready" projects but only ~15 genuinely usable contacts across all of them. The 883-contact ASC project is a mirage — strip the CRM junk and it has 2 scraper-sourced contacts.

---

### Ryan Pemberton — WA — Portable Air

| Project | Priority | Contacts | High-Relevance | Send-Ready | Status |
|---|---|---|---|---|---|
| Fortescue Iron Bridge | hot | 2 | 2 | 2 | **ACTION-READY** |
| Pilbara Iron Ore — Rio Tinto | hot | 2 | 2 | 2 | **ACTION-READY** |
| Woodside NWS Subsea Tieback | warm | 2 | 1 | 2 | **ACTION-READY** |
| Chevron NWS & Gorgon | warm | 16 | 0 | 2 | DISCOVERY-NEEDED (no decision-makers) |
| VicGrid REZ | hot | 0 | 0 | 0 | **FALSE MATCH** — VIC project, not WA |

**Issue:** VicGrid matched Ryan because the territory matching found "WA" in the project text somewhere (likely a false positive from substring matching). This is a data quality issue in the audit script, not in the platform itself.

**Best real contacts:** Syed Mushahid Shah (PM, Rio Tinto), Korff Hendrik (PM, Rio Tinto), Robyn Morris (Ops Manager, FMG), Ben Snell (Warehouse Logistics, FMG)

**Honest assessment:** Ryan has 3 genuinely action-ready WA projects with 6 real contacts. That is enough for one week of outreach, not a pipeline.

---

### Daniel Zec — NSW, VIC, SA, TAS, ACT — Portable Air

| Project | Location | Territory | Contacts | High-Relevance | Send-Ready | Status |
|---|---|---|---|---|---|---|
| ASC Submarine Maintenance | SA | SA | 883 (junk) | 10 | 30 | ACTION-READY (inflated) |
| BAE Hunter Frigate | SA | SA | 1 | 1 | 1 | ACTION-READY |
| Gippsland Opportunities | VIC | VIC | 1 | 1 | 1 | ACTION-READY |
| Snowy Mountains Precinct | NSW | NSW | 2 | 1 | 2 | ACTION-READY |
| Transmission — Hunter Valley | NSW | NSW | 1 | 1 | 1 | ACTION-READY |
| AUKUS Pillar 1 | SA | SA | 0 | 0 | 0 | DISCOVERY-NEEDED |
| Level Crossing Removal | VIC | VIC | 0 | 0 | 0 | DISCOVERY-NEEDED |
| North East Link | VIC | VIC | 0 | 0 | 0 | DISCOVERY-NEEDED |
| Olympic Dam — BHP | SA | SA | 0 | 0 | 0 | DISCOVERY-NEEDED |
| Suburban Rail Loop | VIC | VIC | 0 | 0 | 0 | DISCOVERY-NEEDED |
| Sydney Metro | NSW | NSW | 0 | 0 | 0 | DISCOVERY-NEEDED |
| VicGrid REZ | VIC | VIC | 0 | 0 | 0 | DISCOVERY-NEEDED |
| Western Sydney Airport | NSW | NSW | 0 | 0 | 0 | DISCOVERY-NEEDED |

**Honest assessment:** Daniel has the widest territory and sees 13 ICN projects. But only 5 are action-ready, and the real contact count across those 5 is approximately 7 usable contacts (excluding ASC CRM junk). The 8 discovery-needed projects are all high-value (Sydney Metro, North East Link, Western Sydney Airport, Olympic Dam) but have zero contacts — they need enrichment before Daniel can act.

---

### Dan Day — NSW, VIC, SA, TAS, ACT — Pump (Flow)

| Project | Location | Territory | Contacts | High-Relevance | Send-Ready | Status |
|---|---|---|---|---|---|---|
| ASC Submarine Maintenance | SA | SA | 883 (junk) | 10 | 30 | ACTION-READY (inflated) |
| BAE Hunter Frigate | SA | SA | 1 | 1 | 1 | ACTION-READY |
| Snowy Mountains Precinct | NSW | NSW | 2 | 1 | 2 | ACTION-READY |
| AUKUS Pillar 1 | SA | SA | 0 | 0 | 0 | DISCOVERY-NEEDED |
| Level Crossing Removal | VIC | VIC | 0 | 0 | 0 | DISCOVERY-NEEDED |
| North East Link | VIC | VIC | 0 | 0 | 0 | DISCOVERY-NEEDED |
| Olympic Dam — BHP | SA | SA | 0 | 0 | 0 | DISCOVERY-NEEDED |
| Suburban Rail Loop | VIC | VIC | 0 | 0 | 0 | DISCOVERY-NEEDED |
| Sydney Metro | NSW | NSW | 0 | 0 | 0 | DISCOVERY-NEEDED |
| Western Sydney Airport | NSW | NSW | 0 | 0 | 0 | DISCOVERY-NEEDED |

**Honest assessment:** Dan sees 10 projects via Pump (Flow) match. Only 3 are action-ready, and the real usable contacts are ~5. The pump-specific relevance of these contacts is unclear — they were sourced for the project generally, not for dewatering/pump opportunities specifically.

---

### Amit Bhargava — NATIONAL — PAL, BESS

Amit sees all 23 projects via PAL (BL ID 3), which every ICN project carries. However, **none of the 23 ICN projects have BESS (BL ID 30002) in their matchedBusinessLines.** This means Amit's BESS scope gets zero ICN coverage.

| Status | Count |
|---|---|
| Action-Ready (via PAL) | 9 |
| Discovery-Needed | 14 |

**Honest assessment:** Same contact reality as Leo — 9 "action-ready" projects but only ~15 genuinely usable contacts. Amit's BESS lane is completely unserved by ICN.

---

### Egor Ivanov — NATIONAL — BESS, Portable Air, PAL, Pump (Flow)

Egor sees all 23 projects (he matches every BL that ICN projects carry). His view is identical to Leo's except he also matches Pump (Flow) projects.

**Notable:** VicGrid REZ matched Egor via BESS — this is the only ICN project where BESS relevance exists, but it has zero contacts.

**Honest assessment:** Egor's breadth means he sees everything, but the contact poverty is the same. His best action would be to prioritize the 5 Account Attack projects and request enrichment for the rest.

---

### Brett Hansen — WA, NT — Pump (Flow)

| Project | Location | Territory | Contacts | High-Relevance | Send-Ready | Status |
|---|---|---|---|---|---|---|
| Fortescue Iron Bridge | WA | WA | 2 | 2 | 2 | ACTION-READY |
| Pilbara Iron Ore — Rio Tinto | WA | WA | 2 | 2 | 2 | ACTION-READY |
| Nolans Rare Earths | NT | NT | 0 | 0 | 0 | DISCOVERY-NEEDED |
| Port of Darwin | NT | NT | 0 | 0 | 0 | DISCOVERY-NEEDED |
| Chevron NWS & Gorgon | WA | WA | 16 | 0 | 2 | DISCOVERY-NEEDED (no decision-makers) |

**Issue:** The audit also matched ASC Submarine (SA), BAE Hunter (SA), and Snowy Mountains (NSW) to Brett via "NT" territory match — these are false positives from the audit script's substring matching (e.g., "NT" appearing in text). Brett's real WA/NT scope gives him 5 legitimate projects.

**Honest assessment:** Brett has 2 genuinely action-ready WA pump projects with 4 real contacts. Nolans Rare Earths and Port of Darwin are strong NT prospects but need enrichment.

---

## Section 3: Contact Count Inflation Explained

The previous audit reported "904 contacts across 7 projects" and "940+ contacts across 22 projects." Here is why those numbers are misleading:

**ASC Submarine Maintenance (883 contacts):**

| Source | Count | Quality |
|---|---|---|
| CRM import | 881 | Almost entirely Atlas Copco internal billing contacts. Top "companies" are `portal.invoices@atlascopco.com` (115), `peter.hancock@atlascopco.com` (32), `gaya.nada@atlascopco.com` (13). These are AC's own invoice processing addresses, not external decision-makers. |
| Scraper | 2 | Shelley Morgan (PM, ASC) and one other. These are the only real contacts. |

**Role bucket data quality issue:** The `roleBucket` field for CRM-imported contacts contains phone numbers instead of role classifications (e.g., `+61 419 606 176`, `+32 34019279`). This means the CRM import stored phone numbers in the wrong column, making role-based filtering unreliable for CRM contacts.

**Chevron NWS & Gorgon (16 contacts):**

| Source | Count | Quality |
|---|---|---|
| CRM import | 14 | Mixed — some are Chevron operations staff, but role classifications include "Unknown" (5), "Finance" (4), "Operations" (3). Zero have titles matching decision-maker patterns. |
| Scraper | 2 | Two Chevron contacts, but neither has a decision-maker title. |

**Bottom line:** Strip the CRM junk and the real contact count across all 23 ICN projects is approximately **25 usable contacts**, not 940+. Of those 25, approximately 15 have email addresses and relevant titles.

---

## Section 4: High-Value Project Deep Dive

| Project | Location | Priority | BL | Contacts (real) | Contractors | Digest | This Week | Account Attack | Reps In Scope |
|---|---|---|---|---|---|---|---|---|---|
| AUKUS Pillar 1 | SA | hot | Air, PAL, Pump | 0 | 1 | YES (headline only) | NO | NO | Leo, Daniel, Dan, Amit, Egor |
| BAE Hunter Frigate | SA | hot | Air, PAL, Pump | 1 | 1 | YES | YES | NO (only 1 contact) | Leo, Daniel, Dan, Amit, Egor |
| Sydney Metro | NSW | hot | Air, PAL, Pump | 0 | 1 | YES (headline only) | NO | NO | Leo, Daniel, Dan, Amit, Egor |
| North East Link | VIC | hot | Air, PAL, Pump | 0 | 1 | YES (headline only) | NO | NO | Leo, Daniel, Dan, Amit, Egor |
| Snowy Mountains | NSW | hot | Air, PAL, Pump | 2 (1 PM) | 1 | YES | YES | YES | Leo, Daniel, Dan, Amit, Egor |
| Western Sydney Airport | NSW | hot | Air, PAL, Pump | 0 | 1 | YES (headline only) | NO | NO | Leo, Daniel, Dan, Amit, Egor |
| Cross River Rail | QLD | hot | Air, PAL, Pump | 0 | 1 | YES (headline only) | NO | NO | Leo, Amit, Egor |
| Olympic Dam — BHP | SA | hot | Air, PAL, Pump | 0 | 1 | YES (headline only) | NO | NO | Leo, Daniel, Dan, Amit, Egor |

**Route-to-buy usefulness:** Only Snowy Mountains and BAE Hunter Frigate have any contact coverage. The other 6 high-value projects are strategic signals only — a rep cannot act on them without first running an enrichment pass to find procurement/engineering contacts at the owner or principal contractor.

---

## Section 5: Quality Check — Can Reps Act on ICN Data?

| Question | Answer |
|---|---|
| Do ICN projects have enough substance to help a rep act? | **Partially.** The work-package counts, contractor names, and opportunity notes are commercially useful context. But without contacts, a rep has to do their own prospecting. |
| Are they mostly strategic monitor signals? | **Yes, for 14 of 23.** The 9 action-ready projects have some contacts, but even those are thin (2–4 contacts per project). |
| What would make ICN commercially useful? | An Apollo/Hunter enrichment pass targeting the owner and principal contractor for each of the 14 discovery-needed projects. This would add 5–15 contacts per project and convert them from headlines to actionable opportunities. |

---

## Section 6: Gaps Still Remaining

1. **Contact poverty:** 14/23 ICN projects have zero contacts. The 6 newly added projects (Sydney Metro, North East Link, Western Sydney Airport, Cross River Rail, Suburban Rail Loop, Olympic Dam) were inserted without any enrichment pass.

2. **CRM data quality:** The CRM import created 881 junk contacts on ASC Submarine alone. The `roleBucket` field contains phone numbers instead of roles for CRM contacts. This inflates every metric that touches CRM-sourced contacts.

3. **BESS coverage gap:** Zero ICN projects carry BESS (BL ID 30002) in their matchedBusinessLines, despite VicGrid REZ being a renewable energy project. The BL scoring for ICN projects needs review.

4. **QLD coverage gap:** Only 3 ICN projects are in QLD (Arrow Energy, Carmichael, Cross River Rail). No QLD-specific rep exists in the current team, so these are only visible to national reps.

5. **Work-package data is curated, not live:** The open/awarded/closed counts come from the ICN scraper's hardcoded metadata, not from live ICN Gateway scraping. They may be stale.

---

## Section 7: ICN Priority Relative to Other Sources

| Source | Project Count | Contact Density | Action-Readiness | Strategic Value | Recommended Priority |
|---|---|---|---|---|---|
| Projectory + tenders.gov.au | 1,200+ | Medium (scraper-enriched) | High | Medium (volume) | **Primary** |
| ICN Gateway | 23 | Very Low (0–4 per project) | Low (14/23 discovery-needed) | **High** (work-package detail, defence/infra) | **Tier 2 — strategic enrichment target** |
| CRM import | Varies | High volume, low quality | Low (junk contacts) | Low | Tier 3 — needs cleanup |

**Recommendation:** ICN should be treated as a **strategic enrichment target**, not a standalone source. The correct workflow is: ICN provides the project intelligence (work packages, contractors, opportunity notes) → Apollo/Hunter provides the contacts → the combination becomes action-ready. Running ICN without enrichment produces headlines, not leads.
