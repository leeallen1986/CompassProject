# Final Pump/Flow Quality Proof Pack
**Date:** 2026-05-12 | **Session:** Trust Gap Closure — Final Pass

---

## Part A — Quarantined Wrong Contacts

Both contacts are now quarantined and excluded from all three filter layers (`getContactsForProject`, `getAllContacts`, `selectProjectContact`).

| Contact | ID | Project | Why Quarantined | Was Appearing |
|---|---|---|---|---|
| Julie Chavez | 960067 | Bass Strait Decommissioning (690073) | Title: "General Manager @ Woodside Pizzeria" — restaurant, not Woodside Energy. Email domain woodside.com.au was incorrectly inferred. | Primary contact for Bass Strait in all rep-facing views |
| Dmitry Kharchenko | 960029 | Large-Scale Iron Ore Processing (690024) | Title: "Game Designer / games for sale" — LinkedIn contamination, wrong person entirely | Contact #2 on Pilbara project for Brett |

**After quarantine:**
- Bass Strait (690073): 0 active contacts (was 1 — Julie Chavez only)
- Pilbara Iron Ore (690024): 1 active contact — Lucas Chaffin (Mining Manager at UNKNOWN, named_unverified, no email). Dmitry removed.

---

## Part B — Dan Day Targeted Contact Rescue

### Cairns Water Infrastructure Upgrade (720008)
- **Before:** 0 contacts
- **After:** 0 contacts — no enrichment was run (no API credits consumed)
- **Status:** Still not commercially usable. Cairns Water needs a manual enrichment pass or Apollo search for Cairns Regional Council / John Holland water contacts.

### Bass Strait Decommissioning (690073)
- **Before:** 1 contact (Julie Chavez, quarantined)
- **After:** 0 active contacts
- **Status:** Not usable. However, there is a **separate project** — Bass Strait Decommissioning Infrastructure Upgrade (Barry Beach, ID 990050, Gippsland VIC) — which has 3 send_ready contacts at Qube (the awarded contractor): John Allen (Fleet Manager), Darren Whyte (Fleet Manager), Sam Leszczynski (General Manager Mining Services). This is a real, commercially usable card for Dan.

### Next Best East-Coast Projects (already strong — no rescue needed)

The data shows Dan has a materially better bench than the previous proof suggested. The issue was the proof_pack.mjs script was using a stale action mode heuristic. The real `laneScoring.ts` logic correctly evaluates these:

| Rank | Project | Location | Stage | Send_Ready | Action Mode | Primary Contact |
|---|---|---|---|---|---|---|
| 1 | Mt Crosby Eastbank Pumping Station Safeguarding | Mt Crosby, QLD | Ongoing maintenance/upgrade | 7 | direct_pursue | Graeme Mitchell (Maintenance Manager, Urban Utilities) |
| 2 | Glen Eira & Greater Dandenong Sewer Network Upgrade | VIC | Upgrade Program | 5 | direct_pursue | Navjot Randhawa (Project Manager, South East Water) |
| 3 | Burpengary East Wastewater Treatment Plant Upgrade | Moreton Bay, QLD | Major upgrade progressing | 5 | direct_pursue | Paull Disney-Smith (Project Manager, Unitywater) |
| 4 | Port of Newcastle MPT Berth Extension | Mayfield, NSW | Construction has begun | 3 | **direct_pursue** | Shane Ambrose (Project Manager, Port of Newcastle) |
| 5 | Barry Beach Bass Strait Decommissioning (990050) | Gippsland, VIC | Mobilisation/Execution | 3 | direct_pursue | John Allen (Fleet Manager, Qube) |

---

## Part C — Port of Newcastle Action Mode Decision

**Before (proof_pack.mjs):** `find_site_contact`
**After (real laneScoring.ts):** `direct_pursue`

**Why the discrepancy:** The `proof_pack.mjs` script used an older standalone heuristic that required a "site manager", "dewatering", "maintenance manager", or "maintenance superintendent" keyword in the contact title. The production `laneScoring.ts` uses `roleRelevance` from the database (`high` or `medium`) combined with `send_ready` trust tier. Port of Newcastle has 3 send_ready project managers with `roleRelevance: medium` — this correctly triggers `direct_pursue` in production.

**Rule change:** No code change was needed. The production logic was already correct. The proof_pack.mjs script was misleading.

**Verification:**
```
pumpBLScore: 100
hasPumpContact (send_ready + medium roleRelevance): true
isAwarded (stage contains "construction"): true
isEarlyStage: false
=> direct_pursue ✓
```

---

## Part D — Updated Brett Hansen Proof

**Territory:** WA + NT | **Lane:** Pump (Flow) + Dewatering Pumps

### Project 1 — Geraldton Port Berth 1 and Tugboat Harbour Jetty Construction
- **ID:** 810033 | **Location:** Geraldton Port, WA | **Stage:** null (active construction implied)
- **Pump Score:** 100 | **Action Mode:** direct_pursue
- **Contacts:** 5 send_ready
- **Primary:** Gabriel Rifici (Project Manager, gabriel.rifici@midwestports.com.au) — send_ready, medium relevance
- **Backup:** Peter Leonard (Maintenance Manager), Ian McLeod (Asset & Engineering Manager), Jeremy Henderson (Project Manager) — all send_ready
- **Why useful:** Port construction, dewatering confirmed, 4 named send_ready contacts with corporate emails. Strong card.

### Project 2 — Alkimos Desalination Plant
- **ID:** 480023 | **Location:** Alkimos, WA | **Stage:** Construction underway, jack-up barge arriving
- **Pump Score:** 100 | **Action Mode:** direct_pursue
- **Contacts:** 9 active, 4 send_ready
- **Primary:** Rob Gordon (Procurement Manager, Acciona, rob.gordon@acciona.com.au) — send_ready, high relevance
- **Backup:** Nouman Rashid (Procurement & Contract Manager, SUEZ), Maria Khajikian (Engineering Manager, SUEZ), Shelly Trew (Senior Project Manager, Water Corporation) — all send_ready
- **Why useful:** Active marine construction, dewatering confirmed, procurement-side and engineering-side contacts both present. Very strong card.

### Project 3 — Murchison Gold Project Underground Development
- **ID:** 1020027 | **Location:** Murchison, WA | **Stage:** Shift to higher-grade underground mining
- **Pump Score:** 100 | **Action Mode:** direct_pursue
- **Contacts:** 3 send_ready
- **Primary:** Matthew O'Hara (General Manager, mohara@meekametals.com.au) — send_ready, medium relevance
- **Backup:** John Sinagra (Procurement Superintendent), Win Comia (Underground Manager) — both send_ready
- **Why useful:** Underground gold mine, dewatering is essential. GM + Procurement Superintendent + Underground Manager all present and send_ready.

### What still looks weak for Brett
- **Pilbara Iron Ore (690024):** Lucas Chaffin (Mining Manager at UNKNOWN) — no email, company unknown. Dmitry Kharchenko now quarantined. This project has 1 named_unverified contact with no email. Not usable until enrichment.
- **Kwinana Gas (660052):** 2 send_ready contacts (Johan Myburgh, Construction GM; Paul Holland, Procurement GM). Procurement correctly ranks below construction now. Still usable but only 2 send_ready.

**Is Brett commercially strong enough?** Yes for 3 of his top 5 WA projects. Geraldton Port, Alkimos Desalination, and Murchison Gold are all `direct_pursue` with multiple send_ready contacts. The Pilbara project is the remaining gap.

---

## Part D — Updated Dan Day Proof

**Territory:** QLD + NSW + VIC + SA + TAS | **Lane:** Pump (Flow) + Dewatering Pumps

### Project 1 — Mt Crosby Eastbank Pumping Station Safeguarding
- **ID:** 630006 | **Location:** Mt Crosby, QLD | **Stage:** Ongoing maintenance/upgrade
- **Pump Score:** 100 | **Action Mode:** direct_pursue
- **Contacts:** 7 send_ready (all Urban Utilities)
- **Primary:** Graeme Mitchell (Manager Maintenance Management, graeme.mitchell@urbanutilities.com.au) — send_ready
- **Backup:** Waleed Abdelaal (Chief Engineering Officer), Peter Best (GM Infrastructure Maintenance), Scott Wheeler (Project Manager Capital Delivery), Paul Thorley (Operations & Maintenance Management) — all send_ready
- **Why useful:** Pumping station safeguarding = direct dewatering/pump need. 7 send_ready contacts at the owner organisation. Strongest card in Dan's deck.

### Project 2 — Port of Newcastle MPT Berth Extension
- **ID:** 690059 | **Location:** Mayfield, NSW | **Stage:** Construction has begun
- **Pump Score:** 100 | **Action Mode:** direct_pursue (confirmed in production)
- **Contacts:** 3 send_ready
- **Primary:** Shane Ambrose (Project Manager, shane.ambrose@portofnewcastle.com.au) — send_ready
- **Backup:** Nathan Cambourn, Parwinder Singh — both send_ready project managers
- **Why useful:** Marine construction, dewatering confirmed, 3 send_ready project managers. direct_pursue confirmed by real laneScoring logic.

### Project 3 — Burpengary East Wastewater Treatment Plant Upgrade
- **ID:** 1200018 | **Location:** Moreton Bay, QLD | **Stage:** Major upgrade progressing
- **Pump Score:** 100 | **Action Mode:** direct_pursue
- **Contacts:** 5 send_ready (all Unitywater)
- **Primary:** Paull Disney-Smith (Project Manager, paull.disney-smith@unitywater.com) — send_ready
- **Backup:** Callum Mason, Jon Bennison, Thompson Craig (all Project Managers, Unitywater) — all send_ready
- **Why useful:** Wastewater treatment = dewatering/submersible pump need. 5 send_ready contacts at the owner.

### What still looks weak for Dan
- **Cairns Water Infrastructure Upgrade (720008):** Still 0 contacts. Needs Apollo/Lusha enrichment for Cairns Regional Council or the appointed contractor.
- **Bass Strait Decommissioning (690073):** Now 0 contacts after Julie Chavez quarantine. However, the Barry Beach project (990050) is a better card — Qube awarded, 3 send_ready Fleet Manager + GM contacts.
- **Latrobe Valley Synchronous Condensers (450003):** 153 contacts but 0 send_ready. All named_unverified. Needs trust-tier promotion pass.
- **1.8 GW Solar-plus-Storage (450005):** 15 contacts, 0 send_ready. Same issue.

**Is Dan materially improved?** Yes. The real production logic shows Dan has 3 strong `direct_pursue` cards (Mt Crosby, Port of Newcastle, Burpengary) with multiple send_ready contacts each. The previous proof was misleading because the standalone proof script used a stale heuristic. The Cairns and original Bass Strait gaps remain, but they are no longer the top 3 — they fall outside the top 5 once the real scoring is applied.

---

## Summary: What Remains Before Pump Team Should Trust This Weekly

| Issue | Status | Action Required |
|---|---|---|
| Julie Chavez (Woodside Pizzeria) | ✅ Quarantined | Done |
| Dmitry Kharchenko (Game Designer) | ✅ Quarantined | Done |
| Port of Newcastle action mode | ✅ Already direct_pursue in production | proof_pack.mjs was wrong |
| Brett top 3 WA projects | ✅ All direct_pursue, send_ready contacts | Ready |
| Dan top 3 east-coast projects | ✅ All direct_pursue, send_ready contacts | Ready |
| Cairns Water (720008) | ❌ Zero contacts | Needs targeted Apollo enrichment |
| Pilbara Iron Ore (690024) | ⚠️ 1 contact, no email | Needs enrichment |
| Latrobe Valley (450003) | ⚠️ 153 named_unverified, 0 send_ready | Needs trust-tier promotion pass |
| proof_pack.mjs script | ⚠️ Stale heuristic, misleading output | Should be updated or retired |

**Blunt answer:** Brett is commercially strong now. Dan has 3 credible direct_pursue cards with send_ready contacts — materially better than the previous proof showed. The Cairns gap and the Latrobe Valley named_unverified backlog are the remaining items before the pump team should fully trust the weekly digest.
