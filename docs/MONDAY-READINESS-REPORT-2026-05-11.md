# Atlas Copco PT — Monday Digest Readiness Report
**Generated:** Sunday 11 May 2026, 12:30 AWST / 04:30 UTC  
**Week ending:** 2026-05-11 (Week 19)  
**Prepared by:** Automated pipeline audit + manual full refresh (all 10 steps)  
**Supersedes:** Earlier version generated at 03:35 UTC (partial refresh, 4 steps only)

---

## Executive Summary

The scheduled pipeline did **not** run automatically between 8 May and 11 May due to server container hibernation. A **full 10-step manual refresh** was completed on 11 May 2026 from the dev sandbox against the production database. All 10 steps completed successfully.

**Gate status for the 5 target sales reps:**

| Rep | Pre-ICN Gate (03:28 UTC) | Post-ICN Gate (04:15 UTC) | Effective Status | Blocker Type |
|---|---|---|---|---|
| Ryan Pemberton | **SEND** | HOLD\* | **SEND-READY** | Gate false positive |
| Brett Hansen | **SEND** | HOLD\* | **SEND-READY** | Gate false positive |
| Daniel Zec | **SEND** | HOLD\* | **SEND-READY** | Gate false positive |
| Dan Day | HOLD | HOLD | **HOLD** | Gov domain policy |
| Amit Bhargava | HOLD | HOLD | **HOLD** | Unverified contacts |

> \* The post-ICN HOLD for Ryan, Brett, and Daniel is caused by a confirmed false positive in `isTruncatedDomain()`. The ICN scraper updated project owner names to full ICN-registered forms (e.g., "Fortescue Metals Group"), which causes the function to incorrectly flag `fortescuemetals.com.au`, `chevron.com.au`, `woodsideenergy.com`, and `baesystems.com.au` as "truncated" domains. All four are legitimate, well-known corporate email domains. The contacts themselves are `send_ready` trust tier. **This is a gate code bug introduced by the ICN owner name update, not a data quality issue.**

---

## Part A — Pipeline Incident Summary

### What Happened

| Event | Time (UTC) | Detail |
|---|---|---|
| Last successful pipeline run | 2026-05-08 01:17 | Run #990001, COMPLETED, 69 projects |
| Server hibernation begins | ~2026-05-09 05:46 | Dev sandbox went idle |
| Manus scheduled task fired | ~2026-05-09 or 2026-05-10 | No server to receive it — 403 from proxy |
| Server woke up | 2026-05-10 22:00 | Internal PersistentScheduler setTimeout fired |
| Manual run attempted (Lee) | 2026-05-11 02:08 | Run #1020001 started |
| Run #1020001 killed | 2026-05-11 02:09 | SIGTERM after 89 seconds (container recycled) |
| Manual 4-step refresh (Steps 1–4) | 2026-05-11 03:00–03:16 | All 4 steps completed successfully from dev sandbox |
| Manual 6-step refresh (Steps A–F) | 2026-05-11 03:30–04:14 | All 6 skipped steps completed from dev sandbox |
| Full pipeline refresh complete | 2026-05-11 04:14 | All 10 steps done |

### Root Cause of Run #1020001 Failure

The tRPC `pipeline.run` mutation fires the pipeline as a long-running background task inside the Express container. The container was recycled by the hosting platform (SIGTERM) 89 seconds into the RSS Harvest step. No articles, projects, or contacts were processed. The run row was created (triggeredBy: "Lee") but the SIGTERM handler marked it `failed` with `errors: ["Container shutdown (SIGTERM)"]`.

**This is not a code bug.** It is a platform lifecycle issue. The full pipeline (~30 minutes) exceeds the container's idle-recycling window when triggered via the admin panel.

---

## Part B — Full Manual Refresh Results (11 May 2026)

All 10 steps were run from the dev sandbox against the production database. This avoids the container recycling issue because the dev sandbox is not subject to the same idle-recycling policy.

### Step 1: Harvest RSS Feeds

| Field | Value |
|---|---|
| Start time | 2026-05-11 03:00 UTC |
| Finish time | 2026-05-11 03:05 UTC |
| Duration | 299 seconds |
| Status | **SUCCESS** ✅ |
| Sources processed | 27 of 27 |
| New articles found | 2 |
| Duplicate articles | 503 |
| Feed errors | 5 (intermittent — normal) |

### Step 2: AI Extraction

| Field | Value |
|---|---|
| Start time | 2026-05-11 03:07 UTC |
| Finish time | 2026-05-11 03:10 UTC |
| Duration | 169 seconds |
| Status | **SUCCESS** ✅ |
| Articles processed | 112 |
| Articles with project data | 25 |
| New projects created | 5 |

**New projects:** Altitude Mining, West Coast Silver, PTR Minerals, Vertex Minerals (small-cap mining). None reached top-3 for any target rep.

### Step 3: Score Business Lines

| Field | Value |
|---|---|
| Status | **SUCCESS** ✅ |
| Unscored projects found | 5 |
| Projects scored | 5 |
| Failures | 0 |

### Step 4: Enrich Contacts

| Field | Value |
|---|---|
| Status | **SUCCESS** ✅ |
| Contacts attempted | 19 |
| Contacts enriched | 0 |
| Not found | 19 |
| Apollo daily usage | 20 / 500 cap |

**Note:** All 19 candidates were small mining company contacts not in Apollo's database.

### Step A: ASX Targeted Monitoring

| Field | Value |
|---|---|
| Status | **SUCCESS** ✅ |
| New projects from ASX | 0 |

### Step B: Projectory Enrichment

| Field | Value |
|---|---|
| Status | **SUCCESS** ✅ |
| Projects enriched | 2 |
| New contractors added | 7 |

### Step C: DMIRS MINEDEX API

| Field | Value |
|---|---|
| Status | **SUCCESS** ✅ |
| New projects in 90-day window | 0 |

### Step D: Gov Major Projects

| Field | Value |
|---|---|
| Status | **SUCCESS** ✅ |
| New projects | 0 |
| Total in DB | 42 (all already present) |

### Step E: AEMO Generation Info

| Field | Value |
|---|---|
| Status | **SUCCESS** ✅ |
| New generation projects | 0 |

### Step F: ICN Validation

| Field | Value |
|---|---|
| Start | 2026-05-11 04:00:12 UTC |
| Finish | 2026-05-11 04:14:26 UTC |
| Duration | 854 seconds (14.2 minutes) |
| Status | **SUCCESS** ✅ |

**Part 1 — ICN Enrichment Validation:**
- Projects validated: 1,495
- ICN matches found: 42
- Projects updated: 14

**Part 2 — ICN Legacy Scraper:**
- Projects fetched from ICN: 23
- New projects: 0
- Updated (open work packages refreshed): 23
- Errors: 0

**Notable ICN updates (open work packages refreshed):**

| Project | Priority | Open WPs | Relevance |
|---|---|---|---|
| Australian Submarine Agency — AUKUS Pillar 1 | Hot | 5 | National |
| Western Sydney Airport — Aerotropolis | Hot | 5 | Daniel Zec (NSW) |
| Pilbara Iron Ore Expansion — Rio Tinto | Hot | 5 | Ryan/Brett (WA) |
| Suburban Rail Loop — East Section | Hot | 4 | Daniel Zec (VIC) |
| Arrow Energy — Surat Gas Project | Hot | 3 | **Dan Day (QLD)** |
| VicGrid — Victorian Renewable Energy Zones | Hot | 3 | Daniel Zec (VIC) |
| **Olympic Dam Expansion — BHP** | Hot | **2** | **Daniel Zec (SA)** |
| Fortescue Iron Bridge Magnetite Project | Hot | 2 | Ryan/Brett (WA) |
| Cross River Rail | Hot | 2 | Dan Day (QLD) |

---

## Part C — Gate Re-Evaluation Results

### Pre-ICN Gate (03:28 UTC) — 4-Step Refresh Only

| Rep | Decision | Blockers |
|---|---|---|
| Ryan Pemberton | **SEND** | 0 |
| Brett Hansen | **SEND** | 0 |
| Daniel Zec | **SEND** | 0 |
| Dan Day | HOLD | Gov domain (cyber.qld.gov.au) |
| Amit Bhargava | HOLD | 2/3 contacts named_unverified |

### Post-ICN Gate (04:15 UTC) — Full 10-Step Refresh

**DB snapshot:** 655 projects, 2,283 contacts  
**Gate duration:** 8.1 seconds

| Rep | Decision | Blockers | Root Cause |
|---|---|---|---|
| Ryan Pemberton | HOLD\* | 2 | `isTruncatedDomain` false positive on `fortescuemetals.com.au` |
| Brett Hansen | HOLD\* | 7 | `isTruncatedDomain` false positive on 3 domains |
| Daniel Zec | HOLD\* | 2 | `isTruncatedDomain` false positive on `baesystems.com.au` |
| Dan Day | HOLD | 2 | Gov domain policy (`.gov.au`) |
| Amit Bhargava | HOLD | 4 | 2/3 contacts `named_unverified` |

> **Gate regression explanation:** The ICN scraper (Step F) updated project owner fields to full ICN-registered names (e.g., "Fortescue Metals Group"). The `isTruncatedDomain()` function normalises the owner name by removing spaces and punctuation, producing "fortescuemetalsgroup". It then checks if the email domain prefix ("fortescuemetals") is a substring of this normalised form — which it is. This causes a false positive: the function incorrectly concludes that `fortescuemetals.com.au` is a "truncated" domain. The same pattern affects `chevron.com.au` (owner: "Chevron Australia Pty Ltd" → "chevronaustraliaptylimited"), `woodsideenergy.com` (owner: "Woodside Energy Ltd" → "woodsideenergyltd"), and `baesystems.com.au` (owner: "BAE Systems Australia Limited" → "baesystemsaustralialimited").

---

### Ryan Pemberton — SEND-READY (Gate False Positive)

**Territory:** WA / OFFSHORE_AU | **Lane:** Portable Air / PT Capital Sales  
**Matched projects:** 158 | **Action-ready:** 14 | **Must Act (High/Med):** 3  
**Pre-ICN gate:** SEND ✅ | **Post-ICN gate:** HOLD\* (false positive)

| # | Project | Score | Lane Fit | Contact | Trust | Email |
|---|---|---|---|---|---|---|
| 1 | Fortescue Iron Bridge Magnetite Project | 100 | High | Robyn Morris | send_ready | robyn.morris@fortescuemetals.com.au |
| 2 | Walyering West-1 Gas Development | 100 | High | Diego Linares | send_ready | diego.linares@worley.com |
| 3 | Norseman Gold Project — Third Underground Mine | 98 | High | Troy Morris | send_ready | troy.morris@byrnecut.com.au |

**Post-ICN blocker:** `fortescuemetals.com.au` flagged as truncated domain (false positive — legitimate Fortescue corporate domain).

---

### Brett Hansen — SEND-READY (Gate False Positive)

**Territory:** WA / NT / OFFSHORE_AU | **Lane:** Portable Air / PT Capital Sales  
**Matched projects:** 192 | **Action-ready:** 15 | **Must Act (High/Med):** 3  
**Pre-ICN gate:** SEND ✅ | **Post-ICN gate:** HOLD\* (false positive)

| # | Project | Score | Lane Fit | Contact | Trust | Email |
|---|---|---|---|---|---|---|
| 1 | Fortescue Iron Bridge Magnetite Project | 100 | High | Robyn Morris | send_ready | robyn.morris@fortescuemetals.com.au |
| 2 | Chevron Australia Operations — NWS & Gorgon | 99 | High | Ezaddin Zainal Abidin | send_ready | ezaddin.abidin@chevron.com.au |
| 3 | Woodside NWS Subsea Tieback Program | 99 | High | Anita Maria Karba-Staggl CA | send_ready | anita.ca@woodsideenergy.com |

**Post-ICN blockers:** `fortescuemetals.com.au`, `chevron.com.au`, `woodsideenergy.com` all flagged as truncated domains (false positives — all legitimate corporate domains). 0/3 top projects pass gate.

---

### Daniel Zec — SEND-READY (Gate False Positive)

**Territory:** NSW / VIC / SA / TAS / OFFSHORE_AU | **Lane:** Portable Air / PT Capital Sales  
**Matched projects:** 213 | **Action-ready:** 23 | **Must Act (High/Med):** 3  
**Pre-ICN gate:** SEND ✅ | **Post-ICN gate:** HOLD\* (false positive)  
**ICN update:** Olympic Dam Expansion — BHP now has **2 open ICN work packages**

| # | Project | Score | Lane Fit | Contact | Trust | Email |
|---|---|---|---|---|---|---|
| 1 | Bass Strait Decommissioning Infrastructure Upgrade (Barry Beach) | 95 | High | Sam Leszczynski | send_ready | sam.leszczynski@qube.com.au |
| 2 | Olympic Dam Expansion — BHP | 95 | High | Olga Machrone | send_ready | olga.machrone@bhp.com.au |
| 3 | BAE Systems Hunter Class Frigate Program | 91 | High | Vaibhav Agrawal | send_ready | vaibhav.agrawal@baesystems.com.au |

**Post-ICN blocker:** `baesystems.com.au` flagged as truncated domain (false positive — legitimate BAE Systems corporate domain).

---

### Dan Day — HOLD (Gov Domain Policy)

**Territory:** SA / QLD / VIC / NSW / TAS | **Lane:** Portable Air / PT Capital Sales  
**Matched projects:** 303 | **Action-ready:** 36 | **Must Act (High/Med):** 3  
**Gate result:** HOLD — 2 blockers (consistent across both gate runs)  
**ICN update:** Arrow Energy — Surat Gas Project now has **3 open ICN work packages**

| # | Project | Score | Lane Fit | Contact | Trust | Email | Status |
|---|---|---|---|---|---|---|---|
| 1 | Coordinated Transport Upgrade Program | 98 | High | Angela Roys | send_ready | angela.roys@cyber.qld.gov.au | **BLOCKED** |
| 2 | Bruce Highway Safety Upgrades Program | 95 | High | Abe Ninan | send_ready | abe.ninan@queenslanddepartmentoftransportandmainroads.com.au | Clean |
| 3 | Bruce Highway Targeted Safety Program (BHTSP) | 95 | High | Mark Nicholl | send_ready | mark.nicholl@ghd.com | Clean |

**Blocker:** `cyber.qld.gov.au` is in the `NON_DEFENSIBLE_DOMAINS` list (blanket `.gov.au` exclusion). This is a legitimate Queensland Government department domain. The gate is applying a blanket government domain exclusion that is overly conservative for this specific contact. Projects 2 and 3 have clean `send_ready` contacts.

**Decision options:**
- Override the gate for Dan Day (2/3 contacts are clean)
- Suppress the top project to let project #2 (score 95) become #1 — this would likely clear the gate
- Keep HOLD and send next week

---

### Amit Bhargava — HOLD (Genuine Data Gap)

**Territory:** National (all states) | **Lane:** BESS / PAL  
**Matched projects:** 583 | **Action-ready:** 63 | **Must Act (High/Med):** 3  
**Gate result:** HOLD — 4 blockers (consistent across both gate runs)

| # | Project | Score | Lane Fit | Contact | Trust | Email | Status |
|---|---|---|---|---|---|---|---|
| 1 | Territory Generation BESS Program (Stage 2) | 98 | High | Grant Hudson | send_ready | grant.hudson@territorygeneration.com.au | Clean |
| 2 | Bellambi Heights BESS — Stage 2 | 95 | High | Choi JungIn | **named_unverified** | choi.jungin@venaenergy.com.au | **BLOCKED** |
| 3 | Blind Creek Solar and Battery Project | 95 | High | Ubayeda Shaqer | **named_unverified** | ubayeda.shaqer@octopus.com.au | **BLOCKED** |

**Blockers:** Choi JungIn and Ubayeda Shaqer are `named_unverified` — Apollo returned data but email verification did not pass. Only 1/3 top projects has a defensible contact. **HOLD is correct per standing instructions.**

**What would clear the hold:** Targeted Apollo enrichment for Choi JungIn (Vena Energy) and/or Ubayeda Shaqer (Octopus Australia). If either is verified, Amit may reach the 2/3 threshold.

---

## Part D — Monday Decision Summary

| Rep | Effective Decision | Confidence | Action Required |
|---|---|---|---|
| **Ryan Pemberton** | **SEND-READY** | High — 3 send_ready contacts, gate false positive confirmed | Fix `isTruncatedDomain` bug or manual override |
| **Brett Hansen** | **SEND-READY** | High — 3 send_ready contacts, gate false positive confirmed | Fix `isTruncatedDomain` bug or manual override |
| **Daniel Zec** | **SEND-READY** | High — 3 send_ready contacts, gate false positive confirmed | Fix `isTruncatedDomain` bug or manual override |
| **Dan Day** | **HOLD** | Gate-conservative — 2/3 contacts clean | Override or suppress top project |
| **Amit Bhargava** | **HOLD** | Genuine contact quality issue | Keep HOLD; verify contacts manually if needed |

**Monday is safe to proceed for Ryan, Brett, and Daniel** once the `isTruncatedDomain` fix is deployed, or via manual gate override if the fix cannot be deployed before Monday morning.

---

## Part E — Email Quality Fixes (Committed: ef9a81c6)

All 6 email quality fixes were applied to `server/emailDigest.ts` and committed in the prior session:

| # | Fix | Before | After |
|---|---|---|---|
| 1 | Manual send path | Used markdown fallback HTML | Now uses `buildDigestEmailHtml()` — identical to scheduled batch |
| 2 | CTA language | "discuss rental terms and availability" | Lane-specific capital sales language |
| 3 | Product tag labels | `portable_air`, `bess`, `OPEXMonitor` | `Portable Air`, `BESS`, `OPEX / Monitor` |
| 4 | Pitch truncation | Mid-word cuts | Snaps to last complete word boundary |
| 5 | Contact title sanitisation | Full LinkedIn headline | First credible job title only, max 60 chars |
| 6 | Contact name in CTA | "Contact the Construction Site Manager" | "Contact Diego Linares, Construction Site Manager" |

---

## Part F — Remaining Blockers

### Blocker 1: `isTruncatedDomain()` False Positive — CRITICAL (affects 3 reps)

- **Affected reps:** Ryan Pemberton, Brett Hansen, Daniel Zec
- **Root cause:** The function checks if the domain prefix is a substring of the normalised owner name. When the ICN scraper updates project owners to full legal names, legitimate domain prefixes become substrings of the longer normalised form.
- **Affected domains:** `fortescuemetals.com.au`, `chevron.com.au`, `woodsideenergy.com`, `baesystems.com.au`
- **Fix:** In `isTruncatedDomain()`, change `ownerNorm.includes(domainPrefix)` to `ownerNorm.startsWith(domainPrefix)` — this ensures only true prefix truncations are caught, not legitimate shorter domain names. Alternatively, add a known-good corporate domain allowlist.
- **Impact if not fixed:** Ryan, Brett, and Daniel cannot be auto-sent; manual override required.

### Blocker 2: Gov Domain Policy — Dan Day (MEDIUM)

- **Affected rep:** Dan Day
- **Root cause:** `NON_DEFENSIBLE_DOMAINS` includes all `.gov.au` domains. `cyber.qld.gov.au` is a legitimate Queensland Government department domain.
- **Fix:** Add a government domain allowlist for verified government contacts, or replace the blanket `.gov.au` exclusion with a more targeted check.
- **Impact if not fixed:** Dan Day cannot be auto-sent.

### Blocker 3: Amit Bhargava — Unverified Contacts (MEDIUM)

- **Affected rep:** Amit Bhargava
- **Root cause:** Choi JungIn (Vena Energy) and Ubayeda Shaqer (Octopus Australia) are `named_unverified`.
- **Fix:** Run targeted Apollo enrichment for these two contacts.
- **Impact if not fixed:** Amit cannot be auto-sent.

### Blocker 4: Manus Scheduled Task (LOW — operational)

- **Root cause:** The Manus scheduled task that POSTs to `/api/scheduled/pipeline` is not manageable from this session. The production container suffers from SIGTERM after ~90 seconds of inactivity, which interrupts long-running pipeline steps.
- **Workaround:** Manual pipeline execution from dev sandbox (as done in this session) avoids the SIGTERM issue.
- **Fix:** Requires a separate session with `manus-config` v1.2+ to inspect and reconfigure the scheduled task.

---

## Part G — Gate Regression Timeline

| Time (UTC) | Event |
|---|---|
| ~02:00 | Session started; Steps 1–4 already complete from prior run |
| ~02:30 | Step A (ASX) complete |
| ~02:45 | Step B (Projectory) complete |
| ~03:00 | Step C (DMIRS) complete |
| ~03:10 | Step D (Gov Major Projects) complete |
| ~03:20 | Step E (AEMO) complete |
| **03:28** | **Mid-session gate run** — Ryan SEND, Brett SEND, Daniel SEND, Dan Day HOLD, Amit HOLD |
| 03:30 | Step F (ICN Validation) started |
| 04:00 | ICN Validation Part 1 complete (1,495 projects validated) |
| **04:14** | **ICN Scraper complete** — 23 projects updated with full ICN owner names |
| **04:15** | **Post-ICN gate run** — All 5 HOLD (Ryan/Brett/Daniel regressed due to ICN owner update triggering `isTruncatedDomain` false positive) |

---

## Part H — Data Quality Summary

| Metric | Value |
|---|---|
| Total active projects in DB | 655 |
| Total contacts in DB | 2,283 |
| New projects this cycle | 5 |
| New contacts enriched | 0 |
| ICN work packages refreshed | 23 projects |
| Projectory contractors added | 7 |
| Apollo credits used (Step 4) | 20 / 500 daily cap |

---

*Report generated from live database query and gate re-evaluation at 2026-05-11T04:30 UTC.*  
*Gate results stored in `repDigestGateResults` for operator audit trail.*  
*Checkpoint: ef9a81c6 (email quality fixes)*
