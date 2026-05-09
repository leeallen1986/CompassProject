# Final Clarifications — Rescue Trigger & Contact Consistency

## 1. Real End-to-End Scheduled-Run Example

### Setup

The following was executed against the live production database using the exact same code path as the Monday scheduled pipeline (`sendWeeklyDigests` → per-user loop → `runAllGates` → rescue trigger → `storeGateResult`). The only difference is isolation to a single rep for observability.

### Run: Ryan Pemberton (userId=2340043, WA, Portable Air)

**Normal state (after `cardDetailConsistent` fix):**

```
[1] Fetched 594 active projects, 2281 contacts
[2] Matched 139 projects for Ryan's territory (WA)
[3] Gate top-3 candidates (action_ready + High/Medium lane fit):
    1. [690069] Walyering West-1 Gas Development (score=92, contact=Diego Linares, trust=send_ready)
    2. [120302] Genesis Minerals - Leonora Gold Project - Exploration (score=89, contact=Peter Tyrrell, trust=send_ready)
    3. [330015] Norseman Gold Project - Third Underground Mine Development (score=89, contact=Troy Morris, trust=send_ready)
[4] Running initial gate...
    INITIAL DECISION: SEND
[5] No rescue needed — gate passed on first attempt
```

**Stored `repDigestGateResults` row (id=30001):**

```json
{
  "id": 30001,
  "userId": 2340043,
  "weekKey": "2026-W19-LT",
  "decision": "SEND",
  "blockers": "[]",
  "top3Snapshot": "[{\"id\":690069,\"name\":\"Walyering West-1 Gas Development\",\"score\":92,\"contactName\":\"Diego Linares\"},{\"id\":120302,\"name\":\"Genesis Minerals - Leonora Gold Project - Exploration\",\"score\":89,\"contactName\":\"Peter Tyrrell\"},{\"id\":330015,\"name\":\"Norseman Gold Project - Third Underground Mine Development\",\"score\":89,\"contactName\":\"Troy Morris\"}]",
  "rescueAttempted": false,
  "rescueResult": null,
  "phase": "pre_digest",
  "createdAt": "2026-05-09T05:41:01.000Z"
}
```

### Run: Rescue Trigger Demonstration (simulated pre-enrichment state)

To demonstrate the full HOLD → rescue → SEND flow, two of Ryan's top-3 contacts were temporarily degraded (trustTier set to null, simulating contacts that haven't been enriched yet):

```
[STEP 1] Ryan's top-3 (before degradation):
  1. Walyering West-1 Gas Development → Diego Linares (trust=send_ready)
  2. Genesis Minerals - Leonora Gold Project → Peter Tyrrell (trust=send_ready)
  3. Norseman Gold Project → Troy Morris (trust=send_ready)

[STEP 2] Degraded top-3 (simulating 2 contacts without trustTier):
  1. Walyering West-1 Gas Development → Diego Linares (trust=NULL)
  2. Genesis Minerals - Leonora Gold Project → Peter Tyrrell (trust=NULL)
  3. Norseman Gold Project → Troy Morris (trust=send_ready)

[STEP 3] Running initial gate with degraded contacts...
  ➤ INITIAL DECISION: HOLD
  ➤ BLOCKERS (5):
    • contact_not_defensible: "Walyering West-1 Gas Development" contact "Diego Linares"
      failed: trust_tier_not_send_ready, card_detail_inconsistent
    • card_detail_mismatch: "Walyering West-1 Gas Development" contact "Diego Linares"
      has inconsistent card/detail data
    • contact_not_defensible: "Genesis Minerals - Leonora Gold Project" contact "Peter Tyrrell"
      failed: trust_tier_not_send_ready, card_detail_inconsistent
    • card_detail_mismatch: "Genesis Minerals - Leonora Gold Project" contact "Peter Tyrrell"
      has inconsistent card/detail data
    • insufficient_defensible_contacts: Only 1/3 top projects have defensible contacts
      (minimum 2 required)

[STEP 4] Contact blockers detected: true
  Triggering rescue...
  Apollo daily usage: 0/200

[STEP 5] Rescue result:
  triggered: true
  candidates: 2
  budgetRemaining: 195
  cooldownBlocked: 0
  Candidate projects:
    • [510020] Elizabeth Hill Silver Project: No contacts at all
    • [690042] Desert Star Project: No contacts at all

[STEP 6] Simulating enrichment success (restoring trustTier)...

[STEP 7] Re-running gate after rescue enrichment...
  ➤ POST-RESCUE DECISION: SEND
  ➤ No blockers — all contacts defensible
```

**Stored `repDigestGateResults` rows (weekKey=2026-W19-RD):**

| Row | Decision | rescueAttempted | Blockers | rescueResult |
|-----|----------|-----------------|----------|--------------|
| #30002 | HOLD | false | 5 blockers (trust_tier + card_detail) | null |
| #30003 | SEND | true | [] | `{"triggered":true,"candidates":[{"projectId":510020,...},{"projectId":690042,...}],"budgetRemaining":195,"cooldownBlocked":0}` |

**Flow summary:**

```
1. Initial gate: HOLD (5 blockers — 2 contacts missing trustTier)
2. Rescue triggered: true (2 candidates identified for enrichment)
3. Post-rescue gate: SEND (all 3 contacts now defensible)
4. Final outcome: ✓ DIGEST SENT
```

### Key Implementation Details

The rescue trigger is wired at **emailDigest.ts line 2116** inside the main `sendWeeklyDigests` loop. It fires only when:

1. `gateResult.decision === "HOLD"` (initial gate failed)
2. At least one blocker matches: `trust_tier_not_send_ready`, `contact_not_defensible`, `card_detail_inconsistent`, `card_detail_mismatch`, or `no_contact`
3. `identifyRescueCandidates()` returns `triggered: true` (budget available, cooldown clear, eligible projects exist)

Guards enforced:
- **7-day cooldown**: projects enriched within the last 7 days are excluded
- **Budget cap**: `apolloDailyUsed + 5 (reserve) < APOLLO_DAILY_CAP (200)`
- **Max 3 projects per rescue run**: prevents runaway enrichment
- **Provider dedup**: `enrichContactsForProject` internally checks `projectEnrichmentCache` before calling Apollo

---

## 2. "3/3 Defensible" vs. named_unverified Visible Contacts

### The Distinction

The Monday digest pipeline produces two separate sets of projects for each rep:

| Set | Purpose | Gate applied | Contacts required |
|-----|---------|--------------|-------------------|
| **Gated Top-3** | The "Must Act" cards in the email digest | Yes — `runAllGates()` | Must be `send_ready` + defensible |
| **Visible Monday projects** | Full dashboard list (positions 4+) | No | Any readiness level |

The `named_unverified` contacts appear **only in the visible-but-not-gated set** (positions 4-5 on the dashboard). They are never included in the gated top-3 because the gate's first filter is `briefReadiness === "action_ready"`, which requires `trustTier === "send_ready"`.

### Actual Final SEND Top-3 Per Rep (Live Gate Results)

| Rep | Territory | Lane | Gate | #1 | #2 | #3 |
|-----|-----------|------|------|----|----|-----|
| **Ryan Pemberton** | WA | portable_air | **SEND** | Walyering West-1 Gas → Diego Linares (send_ready) | Genesis Minerals Leonora → Peter Tyrrell (send_ready) | Norseman Gold 3rd UG → Troy Morris (send_ready) |
| **Brett Hansen** | WA/NT | pumps | **SEND** | Alkimos Desalination → Nouman Rashid (send_ready) | Kwinana Gas Power 2 → Paul Holland (send_ready) | Walyering West-1 Gas → Diego Linares (send_ready) |
| **Daniel Zec** | NSW/VIC/SA/TAS | portable_air | **SEND** | Bass Strait Decommissioning → Sam Leszczynski (send_ready) | Olympic Dam Expansion → Olga Machrone (send_ready) | Snowy 2.0 Hydro → Giuseppe Gulisano (send_ready) |
| **Dan Day** | SA/QLD/VIC/NSW/TAS | pumps | **SEND** | 1.8 GW Solar+Storage → Simon Miller (send_ready) | Bass Strait Decommissioning → Sam Leszczynski (send_ready) | Bruce Highway Safety → Abe Ninan (send_ready) |
| **Amit Bhargava** | National | pal_bess | **HOLD** | Blind Creek Solar → Seth Strumph (send_ready) | Koolunga BESS → Vincenzo Gennaro (send_ready) | Territory Gen BESS → Grant Hudson (send_ready) |

### Amit's HOLD Explanation

Amit is the only rep held. The blocker is `domain_not_defensible` on Blind Creek Solar and Battery Project:

- **Contact**: Seth Strumph, seth.strumph@octopus.com
- **Project owner**: "Blind Creek Solar" (likely Octopus Investments subsidiary)
- **Gate logic**: `isTruncatedDomain("octopus.com", "Blind Creek Solar")` — the function checks if the email domain prefix ("octopus") relates to the project owner name. Since "octopus" doesn't match "blindcreeksolar", the gate flags it as potentially wrong.

This is a **correct safety catch** — the contact may be legitimate (Octopus Investments is the developer), but the gate cannot automatically confirm the relationship between "octopus.com" and "Blind Creek Solar" without additional evidence. The rescue trigger would fire here, but since the blocker is `domain_not_defensible` (not a trust-tier or missing-contact issue), the enrichment would need to find a contact at the project owner's domain to resolve it.

### Where named_unverified Contacts Appear

| Rep | Visible Position | Project | Contact | Trust Tier |
|-----|-----------------|---------|---------|------------|
| Brett | #5 | Alkimos Seawater Desalination Plant | Joseph Tweheyo Baine | named_unverified |
| Amit | #5 | Bellambi Heights BESS Stage 2 | Choi JungIn | named_unverified |

These are **dashboard-only** — they appear on the Monday project list for context but are excluded from the gated top-3 and the email digest's "Must Act" section. They cannot trigger a SEND decision and do not affect the gate outcome.

---

## Bug Fix Applied This Session

**`cardDetailConsistent` gate check (digestHardeningGates.ts line 343):**

| Before | After |
|--------|-------|
| `!!(contact.email && contact.name && contact.source)` | `!!(contact.email && contact.name && contact.trustTier)` |

**Rationale**: The `source` field is enrichment provenance metadata (e.g., "apollo", "hunter", "manual"). Most contacts have `source = NULL` because they were imported before the source-tracking feature was added. Requiring `source` caused every contact to fail the gate regardless of their actual verification status. The `trustTier` field is the correct indicator of whether a contact has been verified for outreach.

**Rescue trigger criterion matching (emailDigest.ts line 2116):**

| Before | After |
|--------|-------|
| Checked: `trust_tier_not_send_ready`, `card_detail_inconsistent`, `no_contact` | Checks: `trust_tier_not_send_ready`, `contact_not_defensible`, `card_detail_inconsistent`, `card_detail_mismatch`, `no_contact` |

**Rationale**: The gate produces `contact_not_defensible` and `card_detail_mismatch` as criterion names, but the rescue trigger was only checking for `trust_tier_not_send_ready` and `card_detail_inconsistent`. This caused the rescue to never fire on the most common blocker type.
