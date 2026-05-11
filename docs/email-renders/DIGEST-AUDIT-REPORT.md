# Digest Email Audit Report
**Generated:** 2026-05-11 | **Week:** 2026-05-08 | **Reps audited:** Ryan Pemberton, Brett Hansen, Daniel Zec, Dan Day, Amit Bhargava

---

## Is the Admin Preview Trustworthy?

**No. The admin preview is not a true representation of the outgoing email.**

The admin preview panel renders the internal markdown `content` string inside a `<pre>` monospace block. The actual outgoing email is built by `buildDigestEmailHtml()` in `server/emailTemplate.ts` — a completely separate, purpose-built HTML template with styled cards, badge pills, CTA links, and a dark navy header. The two paths share the same underlying project data but produce visually and structurally different outputs.

| Dimension | Admin Preview | Real Outgoing Email |
|---|---|---|
| Format | Raw markdown in `<pre>` monospace | Styled HTML (inline CSS, card layout) |
| Header | None | Dark navy "ATLAS COPCO" header with territory + date |
| Greeting | Full name ("Hi Ryan Pemberton") | First name only ("Hi Ryan") |
| Pipeline stats | Shown ("39 hot \| 174 new \| 3 ready to act") | Not shown |
| Priority labels | Emoji + text ("🟥 Must Act This Week") | Styled badge pills ("ACTION READY" / "DISCOVERY NEEDED") |
| Contact details | Full name + email shown inline | Contact title only in CTA (name not shown) |
| Project metadata | Location, status, fit score, product type shown | Pitch text + product tag pill only |
| Closing Soon section | Shown if applicable | Not present |
| Dashboard link | Inline markdown link | Prominent CTA button |
| Plain-text version | Same as preview | Separate `buildDigestEmailText()` output |

**The admin preview is richer in metadata but is not what recipients receive.** It shows contact emails, location, status, fit scores, and pipeline counts that do not appear in the outgoing email. Conversely, the outgoing email has a structured card layout and styled hierarchy that the preview cannot convey.

There is also a **second divergence in the send path**: the "Send Now For User" button (`sendWeeklyDigestToUser`) passes only `markdownContent` to `sendEmail()` — it does not pass `htmlContent`. This means if a rep's email is sent via the manual catch-up button rather than the scheduled Monday batch, the recipient receives the markdown-converted fallback HTML (`markdownToHtml()`), not the `buildDigestEmailHtml()` template. The scheduled batch (`sendWeeklyDigests`) correctly passes both `htmlContent` and `textContent`.

---

## Is the Real Outgoing Email Messy?

**Partially.** The structural layout is clean and professional. There are three specific defects that affect readability and credibility.

### Defect 1 — Raw Product Slugs in Tag Pills (All Reps)

The product tag pill at the bottom of each card renders the raw internal slug directly. Recipients see:

- `portable_air for oil gas`
- `multi_lane_pt for mining`
- `bess for energy`
- `OPEXMonitor for infrastructure`

These are internal database identifiers, not product names. A recipient reading `multi_lane_pt` has no idea what that means. `bess` should be `BESS`. `OPEXMonitor` is a concatenated slug that lost its slash. This is a credibility issue — it makes the email look like a system dump rather than a curated brief.

**Root cause:** `buildEmailSignals()` in `emailDigest.ts` (lines 1233, 1282) passes `p.productLane` directly as the `productTag` string with only `replace(/_/g, " ")` applied to the sector name. There is no slug-to-label mapping for the product lane itself.

### Defect 2 — Mid-Word Pitch Truncation (Ryan, Dan Day, Amit)

The pitch for each project is hard-truncated at 200 characters (`substring(0, 197) + "..."`). When the 197th character falls inside a word, the result is visible to recipients:

- Ryan — Murchison Gold: `"...potential for new equipment for u..."`
- Amit — Alinta Energy: `"...This project will be a significan..."`
- Amit — Koolunga BESS: `"This project..."` (truncated at 12 chars into a sentence)
- Dan Day — Cairns: `"Contractors are all..."` (mid-sentence)

The truncation logic does not snap to the nearest word boundary. This is a minor but noticeable quality issue.

**Root cause:** `pitch.substring(0, 197) + "..."` in `buildEmailSignals()` — no word-boundary check.

### Defect 3 — LinkedIn Headline Used as Job Title in CTA (Amit Bhargava)

For Ubayeda Shaqer on the Blind Creek Solar project, the stored contact title is the full LinkedIn headline:

> `Senior Project Manager | Project Development | Engineering Management | Utilities | Renewable Energy | Infrastructure | Data Centers`

This is passed verbatim into the CTA: `"Contact the Senior Project Manager | Project Development | Engineering Management | Utilities | Renewable Energy | Infrastructure | Data Centers to discuss rental terms and availability."`

In the rendered email, this wraps across two lines inside the card and looks unprofessional. This is a data quality issue in the contacts table, not a template issue, but the template has no guard against it.

---

## Per-Rep Digest Outputs

### Ryan Pemberton

**Subject:** `PT Capital Sales — Weekly Intelligence Brief | WA/OFFSHORE_AU — 2026-05-08`

**Top 3 projects in email:**

| # | Project | Company | Product Tag | CTA |
|---|---|---|---|---|
| 1 | Walyering West-1 Gas Development | Strike Energy (operator) | portable_air for oil gas | Contact the Construction Site Manager |
| 2 | Norseman Gold Project - Third Underground Mine Development | Pantoro Gold | multi_lane_pt for mining | Contact the Maintenance Manager |
| 3 | Murchison Gold Project underground development | Meeka Metals | Direct CAPEX for mining | Contact the Procurement Superintendent |

**Discovery-needed (not actioned):** Desert Star Project (Bayan Mining), Scarborough Gas Project (Woodside/BHP)

**Note:** Admin preview shows the same top-3 projects but additionally shows contact names (Diego Linares, Troy Morris, John Sinagra) and their emails. The real email CTA omits names — it says "Contact the Construction Site Manager" not "Contact Diego Linares". The pitch for Murchison Gold truncates mid-word: `"...potential for new equipment for u..."`.

---

### Brett Hansen

**Subject:** `PT Capital Sales — Weekly Intelligence Brief | WA/NT/OFFSHORE_AU — 2026-05-08`

**Top 3 projects in email:**

| # | Project | Company | Product Tag | CTA |
|---|---|---|---|---|
| 1 | Kwinana Gas Power Generation 2 Project | AGL | pumps for energy | Contact the General Manager Procurement & Property |
| 2 | Walyering West-1 Gas Development | Strike Energy (operator) | portable_air for oil gas | Contact the Construction Site Manager |
| 3 | Norseman Gold Project - Third Underground Mine Development | Pantoro Gold | multi_lane_pt for mining | Contact the Maintenance Manager |

**Discovery-needed:** Desert Star Project (Bayan Mining), Scarborough Gas Project (Woodside/BHP)

**Note:** Brett's territory is WA/NT/OFFSHORE_AU — wider than Ryan's WA/OFFSHORE_AU — so Kwinana (Perth, WA) appears for Brett but not Ryan. No truncation issues. No contact name in CTA (admin preview shows Paul Holland, Diego Linares, Troy Morris with emails).

---

### Daniel Zec

**Subject:** `PT Capital Sales — Weekly Intelligence Brief | NSW/VIC/SA/TAS/OFFSHORE_AU — 2026-05-08`

**Top 3 projects in email:**

| # | Project | Company | Product Tag | CTA |
|---|---|---|---|---|
| 1 | Bass Strait Decommissioning Infrastructure Upgrade (Barry Beach) | Unknown (related to Bass Strait operators like ExxonMobil) | Fleet CAPEX for oil gas | Contact the General Manager - Mining Services |
| 2 | Olympic Dam Expansion — BHP | BHP Olympic Dam | Direct CAPEX for mining | Contact the Head of Projects Commercial, Major Projects and New Developments |
| 3 | Snowy 2.0 Hydroelectric Project | Snowy Hydro | multi_lane_pt for energy | Contact the Deputy Construction Manager |

**Discovery-needed:** North East Link Program (VIC), Suburban Rail Loop — East Section (VIC)

**Note:** "Fleet CAPEX" and "Direct CAPEX" are human-readable opportunity routes — they render acceptably. The Olympic Dam CTA is long but wraps cleanly. Admin preview shows the same 3 projects with contact names (Sam Leszczynski, Olga Machrone, Giuseppe Gulisano) and emails.

---

### Dan Day

**Subject:** `PT Capital Sales — Weekly Intelligence Brief | SA/QLD/VIC/NSW/TAS — 2026-05-08`

**Top 3 projects in email:**

| # | Project | Company | Product Tag | CTA |
|---|---|---|---|---|
| 1 | Bass Strait Decommissioning Infrastructure Upgrade (Barry Beach) | Unknown (related to Bass Strait operators like ExxonMobil) | Fleet CAPEX for oil gas | Contact the General Manager - Mining Services |
| 2 | Bruce Highway Safety Upgrades Program | Queensland Government (implied) | multi_lane_pt for infrastructure | Contact the Manager (Procurement Analysis) at QDTMR |
| 3 | Bruce Highway Targeted Safety Program (BHTSP) | Federal and Queensland governments | pumps for infrastructure | Contact the Construction Manager |

**Discovery-needed:** Cairns Drinking Water Supply Upgrades (OPEX/Monitor), Cross River Rail (Direct CAPEX)

**Note:** The Cairns project tag renders as `OPEXMonitor for infrastructure` — the slash in `OPEX/Monitor` is stripped. The Cairns pitch truncates mid-sentence: `"Contractors are all..."`. Admin preview shows the same 3 projects with contact names (Sam Leszczynski, Abe Ninan, Mark Nicholl) and emails.

---

### Amit Bhargava

**Subject:** `PT Capital Sales — Weekly Intelligence Brief | WA/NSW/QLD/VIC/SA/TAS/NT/ACT/OFFSHORE_AU — 2026-05-08`

**Top 3 projects in email:**

| # | Project | Company | Product Tag | CTA |
|---|---|---|---|---|
| 1 | Bellambi Heights Battery Energy Storage System - Stage 2 | Vena Energy | bess for energy | Contact the Engineering Manager, Offshore Wind |
| 2 | Blind Creek Solar and Battery Project | Octopus Australia | multi_lane_pt for energy | Contact the Senior Project Manager \| Project Development \| Engineering Management \| Utilities \| Renewable Energy \| Infrastructure \| Data Centers |
| 3 | Koolunga BESS (Battery Energy Storage System) | Equis | Direct CAPEX for energy | Contact the General Manager BESS & Solar Development |

**Discovery-needed:** Alinta Energy 500 MW / 2,000 MWh BESS (Stage 1), Koolunga Battery Energy Storage System (BESS)

**Note:** This rep's email has the most visible issues. `bess` is a raw lowercase slug. The Blind Creek CTA uses Ubayeda Shaqer's full LinkedIn headline as the job title — it wraps across two lines in the card. The Alinta pitch truncates mid-word: `"...This project will be a significan..."`. Admin preview shows the same 3 projects with contact names (Choi JungIn, Ubayeda Shaqer, Vincenzo Gennaro) and emails.

---

## Summary of Defects

| Defect | Severity | Reps Affected | Root Cause |
|---|---|---|---|
| Raw product slugs in tag pills (`portable_air`, `multi_lane_pt`, `bess`, `OPEXMonitor`) | Medium — looks like a system dump | All 5 | No slug-to-label map in `buildEmailSignals()` |
| Mid-word pitch truncation (`"for u..."`, `"significan..."`) | Low-Medium — unprofessional | Ryan, Dan Day, Amit | `substring(0, 197)` with no word-boundary snap |
| LinkedIn headline used as job title in CTA | Medium — wraps badly, reads oddly | Amit (Ubayeda Shaqer) | No title length guard in `buildEmailSignals()` |
| `sendWeeklyDigestToUser` (manual send) omits `htmlContent` | High — sends markdown fallback, not the styled template | Any rep sent manually | Missing `htmlContent` param at line 2853 in `emailDigest.ts` |
| Admin preview does not reflect real email | Informational — misleading for QA | Admin user | Different render path: `<pre>` markdown vs `buildDigestEmailHtml()` |

---

## Attached Files

All output files are in `docs/email-renders/`:

| File | Description |
|---|---|
| `Ryan_Pemberton-email.html` | Real outgoing HTML (what Resend sends) |
| `Ryan_Pemberton-email.txt` | Real plain-text version |
| `Ryan_Pemberton-preview.txt` | Admin preview markdown |
| `Ryan_Pemberton-fullpage.png` | Full-page screenshot of HTML email |
| *(same pattern for Brett_Hansen, Daniel_Zec, Dan_Day, Amit_Bhargava)* | |
| `summary.json` | Machine-readable top-3 per rep |
