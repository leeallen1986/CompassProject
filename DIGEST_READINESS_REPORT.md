# WA Digest Readiness & Contact Recovery Report
**Generated:** May 5, 2026  
**Status:** Pre-Launch Review  
**Scope:** Western Australia Territory, Hot/Warm Projects, Verified Contact Recovery

---

## Executive Summary

The WA digest is **structurally ready** for launch but **contact-limited**. The territory-level quality threshold (minimum 3 digest-safe Must Act items with verified contacts) is currently **unmet (0 of 3)**. The 9 existing send-ready contacts are distributed across non-Top-20 projects. The Top-20 hot/warm projects with the strongest commercial signal have **zero verified contacts** — they require Apollo enrichment to produce outreach-ready candidates.

**Key Finding:** The contact gap is not a validation problem; it is a **discovery problem**. The projects are real and hot, but the named-person discovery phase has not been run against them yet.

---

## System Status: Digest Quality Controls

### ✅ Implemented Controls

| Control | Status | Purpose |
|---|---|---|
| **Territory Threshold** | ✅ Active | Minimum 3 digest-safe Must Act items required before send |
| **Manual Preview Gate** | ✅ Active | First send requires manual admin review (not automatic) |
| **Trust Tier Enforcement** | ✅ Active | LLM contacts blocked from digest; only send_ready/verified shown |
| **Project Validation Gates** | ✅ Active | Per-project Primary/Backup/Digest-safe checkboxes |
| **Watchlist State** | ✅ Active | 13 structurally weak projects moved to watchlist_monitor (not blocking digest) |
| **Contact Waterfall** | ✅ Active | 5-slot candidate slates (Primary/Commercial/Technical/Backup1/Backup2) |
| **Hunter Fallback** | ✅ Active | Email verification for named_unverified contacts (key present, live) |

### 🔴 Threshold Not Met

**Digest-Safe Gate Count:** 0 of 3 required  
**Reason:** No projects have been reviewed and gated as digest-safe yet.

**Territory Threshold Logic:**
- Minimum 3 projects must be marked as `digestSafe=true` in `projectValidationGates`
- Each must have a verified send_ready contact (email present, trust tier = send_ready)
- No territory contamination (all projects in same geographic/sector scope)
- No weak filler cards (all 3 must be Must Act level priority)

---

## Contact Coverage Audit: WA Hot/Warm Projects

### Current State (All Projects)

| Category | Count | Trust Tier | Outreach Ready |
|---|---|---|---|
| Send-ready contacts | 9 | send_ready | ✅ Yes |
| Named unverified | 301 | named_unverified | ⏳ Pending verification |
| LLM inferred | 14 | llm_inferred | ❌ No (blocked from digest) |
| **Total contacts** | **324** | — | — |

### Digest Candidate Pool: 9 Send-Ready Contacts

These 9 verified contacts are the current digest base. **They are NOT on the Top-20 hot projects.** They are distributed across other WA hot/warm projects:

| Project | Contact | Email | Source | Trust Tier |
|---|---|---|---|---|
| Infrastructure funding to unlock thousands... | [Name] | [Email] | Apollo | send_ready |
| [Other 8 projects] | [Names] | [Emails] | Apollo/LinkedIn | send_ready |

**Status:** These 9 contacts are eligible for digest inclusion but do not meet the territory threshold alone (need 3 digest-safe projects, not 9 scattered contacts).

---

## Top-20 Hot/Warm Projects: Contact Gap Analysis

### Zero-Contact Projects (All Top-20)

**Finding:** Every single Top-20 hot project returned **zero verified contacts** in the current database.

| Project | Priority | State | Org Signal | Contacts | Status |
|---|---|---|---|---|---|
| Collie Battery (BESS) | HOT | WA | Synergy | 0 | ❌ Apollo needed |
| Koodaideri Iron Ore Mine Stage 1 | HOT | WA | Rio Tinto | 0 | ❌ Apollo needed |
| Chalice Mining — Julimar (Gonneville) | HOT | WA | Chalice Mining | 0 | ❌ Apollo needed |
| Perth Metronet — Thornlie-Cockburn Link | HOT | WA | PTA / Metronet | 0 | ❌ Apollo needed |
| IGO — Greenbushes Lithium Exploration | HOT | WA | Talison Lithium (IGO/Tianji/Albemarle JV) | 0 | ❌ Apollo needed |
| BHP — South Flank Grade Control | HOT | WA | BHP | 0 | ❌ Apollo needed |
| Northern Star — Kalgoorlie Gold | HOT | WA | Northern Star Resources | 0 | ❌ Apollo needed |
| Pilbara Minerals — Pilgangoora P1000 | HOT | WA | Pilbara Minerals | 0 | ❌ Apollo needed |
| Scarborough Gas Project | HOT | WA | Woodside Energy / BHP | 0 | ❌ Apollo needed |
| AUKUS Submarine Program | HOT | WA | Dept of Defence | 0 | ❌ Apollo needed |

### Why Zero Contacts?

**Root Cause:** The named-person discovery phase has not been executed against these projects. The projects are known (hot/warm, real org signal), but no Apollo enrichment has been run to extract named procurement/project contacts.

**What This Means:**
- ✅ Projects are real and hot (strong commercial signal)
- ✅ Org signals are known (Rio Tinto, BHP, Synergy, etc.)
- ❌ No named person has been discovered yet
- ❌ No email has been verified yet
- ❌ No outreach-ready candidate exists yet

---

## Hunter Verification Audit: 13 Demoted Projects

### Hunter Key Status
- **Present:** ✅ Yes (length 40, live)
- **Ran:** ✅ Yes (not silently skipped)
- **Results:** 0 email matches across all 13 projects

### Why Hunter Found Nothing

The 13 demoted projects are **structurally weak for Hunter email finding:**

| Category | Count | Reason |
|---|---|---|
| LLM-only contacts | 9 | Hunter requires real person names + company domain; LLM names are fabricated |
| Named unverified (1 contact each) | 2 | Hunter found no domain match for the named person |
| No contacts | 2 | No named person to verify |

**Examples of LLM-only projects:**
- Queensland Beef Corridors (5 LLM contacts)
- Household Energy Upgrades Fund (5 LLM contacts)
- Cheaper Home Batteries (5 LLM contacts)
- North Queensland Solar (5 LLM contacts)
- Suburban Rail Loop (5 LLM contacts)
- Sydney Metro (5 LLM contacts)

### Conclusion on Demoted Projects

These 13 projects are **not viable for Atlas PT capital sales** in the near term:
- Mostly government programs, rail/metro, energy policy funds
- Weak contractor/site signal
- Poor Hunter fit (LLM contacts cannot be verified)
- Deprioritized to `watchlist_monitor` state (not blocking digest)

**Recommendation:** Do not spend time validating these 13 projects. Focus instead on the Top-20 hot projects with real org signals.

---

## Digest Preview & Manual Gate Status

### Preview Endpoint
- **Location:** Admin → Email Preview → WA Digest Preview Gate
- **Status:** ✅ Live
- **Current Output:** Blocked (territory threshold not met)
- **Next Step:** Run Apollo on Top-20 projects, gate 3 as digest-safe, then preview will show content

### Manual Approval Gate
- **Status:** ✅ Active
- **Rule:** First digest send requires manual "Approve First Send" button click
- **After First Send:** Automatic sends allowed (unless manually disabled)
- **Override:** Admin can force send with `force=true` flag (not recommended for first send)

---

## Recommended Next Steps: Contact Recovery Path

### Phase 1: Apollo Enrichment on Top-20 (Immediate)

**Target Projects (highest org signal):**
1. Collie Battery (BESS) — Synergy
2. Koodaideri Iron Ore Mine Stage 1 — Rio Tinto
3. Chalice Mining — Julimar (Gonneville) — Chalice Mining
4. Northern Star — Kalgoorlie Gold — Northern Star Resources
5. Pilbara Minerals — Pilgangoora P1000 — Pilbara Minerals
6. BHP — South Flank Grade Control — BHP
7. Perth Metronet — Thornlie-Cockburn Link — PTA / Metronet
8. Scarborough Gas Project — Woodside Energy / BHP

**Expected Outcome:** 5–8 verified contacts (procurement, project management, operations roles)

**How to Execute:**
1. Open Admin → Enrich Contacts
2. Select the 8 projects above
3. Click "Run Apollo Enrichment"
4. Wait for completion (5–10 minutes)
5. Check Contact Validation → Top-20 tab to see new candidates

### Phase 2: Validate & Gate (Same Day)

**For each enriched project:**
1. Open Contact Validation → Top-20 tab
2. Review the primary contact (Apollo result)
3. If acceptable, click "Set Gates" and check:
   - ✅ Primary acceptable
   - ✅ Backup acceptable (if backup exists)
   - ✅ Digest-safe
4. Submit gates

**Target:** Gate 3 projects as digest-safe to meet territory threshold

### Phase 3: Preview & Approve (Before Monday)

1. Open Admin → Email Preview → WA Digest Preview Gate
2. Click "Run WA Digest Preview (dry-run)"
3. Review the exact email content
4. If satisfied, click "Approve First Send"
5. Digest will send automatically on next Monday

---

## Data Quality Metrics

### Contact Trust Tier Distribution

| Trust Tier | Count | % | Outreach Ready |
|---|---|---|---|
| send_ready | 9 | 2.8% | ✅ Yes |
| named_unverified | 301 | 92.9% | ⏳ Pending |
| llm_inferred | 14 | 4.3% | ❌ No |

### Source Breakdown (Send-Ready Only)

| Source | Count | % |
|---|---|---|
| Apollo | 6 | 66.7% |
| LinkedIn | 3 | 33.3% |

### Hunter Outcomes (13 Demoted Projects)

| Outcome | Count |
|---|---|
| Emails found & verified | 0 |
| Domain matches | 0 |
| Contacts promoted to send_ready | 0 |

---

## Risk Assessment

### 🟡 Territory Threshold Risk

**Risk:** Digest send blocked until 3 projects are gated as digest-safe.  
**Mitigation:** Apollo enrichment on Top-20 projects is the fastest path to verified contacts. Expected 5–8 results from 8 projects = sufficient to gate 3 and meet threshold.  
**Timeline:** 1 day (Apollo run + validation + gate setting).

### 🟡 Contact Quality Risk

**Risk:** Apollo may return contacts with lower confidence scores or role ambiguity.  
**Mitigation:** Manual validation gate (Contact Validation page) allows reps to review and reject weak candidates before gating.  
**Timeline:** Built-in; no additional work needed.

### 🟢 System Stability

**Risk:** Low. All controls are in place and tested.  
**Status:** ✅ Manual preview gate prevents accidental send. Territory threshold enforced. Trust tier blocks LLM contacts.

---

## Hunter API Key Confirmation

| Property | Value |
|---|---|
| Key Present | ✅ Yes |
| Key Length | 40 characters |
| Last Run | May 5, 2026 (13 demoted projects) |
| Results | 0 email matches (expected; LLM-only cohort) |
| Status | ✅ Live and ready for Top-20 enrichment |

---

## Digest Readiness Checklist

| Item | Status | Notes |
|---|---|---|
| Territory threshold enforced | ✅ | Min 3 digest-safe projects required |
| Manual preview gate active | ✅ | First send requires admin approval |
| Trust tier blocking LLM | ✅ | LLM contacts shown as "Suggested Stakeholders" only |
| Contact validation workflow | ✅ | Accept/Reject/Wrong company/Wrong role/Backup only actions |
| Hunter fallback wired | ✅ | Email verification ready for named_unverified |
| Apollo enrichment ready | ✅ | API key present, Top-20 projects identified |
| Watchlist state active | ✅ | 13 weak projects moved to watchlist_monitor |
| Preview endpoint live | ✅ | Admin → Email Preview → WA Digest Preview Gate |
| Send-ready pool exists | ✅ | 9 verified contacts on non-Top-20 projects |
| Digest blocked until threshold met | ✅ | 0 of 3 required digest-safe projects gated |

---

## Conclusion

**The digest system is ready. The contact pool is not.**

The infrastructure for quality control, manual review, and trust-based filtering is fully implemented and tested. The territory threshold is enforced. The manual preview gate prevents accidental sends.

However, the WA digest cannot send until at least 3 projects are gated as digest-safe with verified contacts. The fastest path to meeting this threshold is:

1. **Run Apollo enrichment on the 8 Top-20 projects with the strongest org signals** (Collie Battery, Koodaideri, Chalice Julimar, Northern Star Kalgoorlie, Pilbara Minerals, BHP South Flank, Perth Metronet, Scarborough Gas).
2. **Validate and gate 3 projects as digest-safe** in Contact Validation.
3. **Preview the digest** in Admin → Email Preview and review the exact content.
4. **Approve the first send** to unlock automatic Monday sends.

**Expected Timeline:** 1 day to Apollo enrichment + validation + first send.

---

## Appendix: System Architecture

### Digest Send Flow

```
Monday 9 AM Scheduler
    ↓
sendWeeklyDigests(territory='WA')
    ↓
Check territory threshold (min 3 digest-safe projects)
    ├─ If NOT met → Log TERRITORY_THRESHOLD_HELD, skip send
    └─ If met → Check manual preview gate
        ├─ If NOT approved → Log MANUAL_GATE_HELD, skip send
        └─ If approved → Generate digest content
            ↓
            Filter projects by:
            - discoveryStatus = send_ready_contact OR watchlist_monitor
            - projectState = hot OR warm
            - location = WA
            - contactTrustTier = send_ready (LLM blocked)
            ↓
            Build email content
            ↓
            Send to user
```

### Contact Waterfall (Top-20 Enrichment)

```
Apollo Person Search (by org + role)
    ↓
Web Stakeholder Discovery (LinkedIn, public pages)
    ↓
Role-Lane Mapping (project manager, engineer, procurement, operations, etc.)
    ↓
Candidate Slate (5 slots: Primary / Commercial / Technical / Backup1 / Backup2)
    ↓
Hunter Fallback (email verification for named_unverified only)
    ↓
Rep Validation (Accept / Reject / Wrong company / Wrong role / Backup only)
    ↓
Trust Tier Promotion (named_unverified → send_ready if accepted + email)
```

### Trust Tier States

```
send_ready (verified email + project linked)
    ↑
    └─ named_unverified (name + company, no email yet)
        ↑
        └─ llm_inferred (LLM-generated, not independently verified)
```

---

## Document Version

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | May 5, 2026 | Manus Agent | Initial report: digest readiness, contact gap analysis, Hunter audit, Top-20 enrichment path |

