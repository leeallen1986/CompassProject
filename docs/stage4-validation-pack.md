# Stage 4 Validation Pack
**Atlas Copco Market Intelligence Platform**
**Date:** 21 April 2026 | **Checkpoint:** `80451b7f`

---

## 1. Scope of Stage 4

Stage 4 extended the campaign outreach workflow with enrichment quality controls, send-readiness gating, domain override management, and bulk campaign actions. The goal was to ensure that every contact reaching the approval queue carries a machine-assessed send-readiness verdict and that sales managers have the tools to act on that verdict efficiently.

---

## 2. Features Delivered

### 2.1 Send-Readiness Badges (Campaigns.tsx)

A new **"Readiness" column** was added to the campaign contact table. Each contact row displays a colour-coded pill derived from the `sendReadiness` field:

| Value | Colour | Meaning |
|---|---|---|
| `send_ready` | Green | No blocking or soft flags; cleared for send |
| `review_before_send` | Amber | One or more soft flags; human review recommended |
| `blocked_from_send` | Red | One or more hard-block flags; must not be sent |

The badge is rendered by the `SEND_READINESS_CONFIG` constant and is visible in both the contacts tab and the approval queue.

### 2.2 "Why?" Explainability Panel

Each contact row now contains an expandable **"Why?" panel** (toggled by a `ChevronDown` icon in the Readiness cell). When expanded, the panel renders:

- `scoreBreakdown.reasoningSummary` — a free-text explanation produced by the enrichment QA engine during the Apollo or Hunter enrichment pass.
- Hard flags (rendered as red `AlertCircle` badges) — flags from `HARD_BLOCK_FLAGS` that caused a `blocked_from_send` verdict.
- Soft flags (rendered as amber `AlertTriangle` badges) — flags from `SOFT_REVIEW_FLAGS` that caused a `review_before_send` verdict.
- Raw `enrichmentQA` object — collapsed JSON for advanced inspection.

The panel uses the `WhyPanel` component defined in `Campaigns.tsx`, which accepts the full `CampaignContact` row and casts `scoreBreakdown`/`enrichmentQA` from `unknown` (Drizzle JSON columns) to typed objects at render time.

### 2.3 Send-Readiness Filter

A **"Readiness" dropdown** was added to the Campaigns contact filter bar alongside the existing Priority, Sector, Role Bucket, and Enrichment Status filters. The filter state (`sendReadinessFilter`) is passed as an optional parameter to the `campaign.contacts` tRPC procedure, which applies a `WHERE sendReadiness = ?` clause in `getCampaignContacts`.

**Server changes:**
- `getCampaignContacts` options type extended with `sendReadiness?: string`.
- Drizzle query updated with a conditional `eq(campaignContacts.sendReadiness, opts.sendReadiness)` clause.
- `campaign.contacts` tRPC input schema extended with `sendReadiness: z.string().optional()`.

### 2.4 Domain Override Management UI

A **"Domain Overrides"** button was added to the Campaign Actions card. Clicking it opens the `DomainOverridesModal` component, which provides a full CRUD interface for the `campaignDomainOverrides` table.

**Four new tRPC procedures** were added to the campaign router:

| Procedure | Input | Description |
|---|---|---|
| `campaign.listDomainOverrides` | `{ campaignId }` | Returns all overrides for a campaign, ordered by `createdAt` desc |
| `campaign.addDomainOverride` | `{ campaignId, domain, overrideType, notes? }` | Inserts a new override row |
| `campaign.updateDomainOverride` | `{ id, overrideType, notes?, isActive }` | Updates type, notes, and active status |
| `campaign.removeDomainOverride` | `{ id }` | Hard-deletes an override row |

The modal renders a table of existing overrides with inline edit/delete controls and a form to add new overrides. Override types supported: `trusted`, `blocked`, `alias`.

### 2.5 Reused-Email Detection

The enrichment batch loop in `enrichCampaignContacts` (`campaignService.ts`) now fetches all existing enriched emails in the campaign **before** the batch begins:

```ts
const allCampaignEnrichedEmails = await db.select({ enrichedEmail: campaignContacts.enrichedEmail })
  .from(campaignContacts)
  .where(and(
    eq(campaignContacts.campaignId, campaignId),
    isNotNull(campaignContacts.enrichedEmail)
  ));
```

This set is passed to every `evaluateEnrichmentQA` call (both Apollo and Hunter paths) as `allCampaignEnrichedEmails`. Within the batch, newly enriched emails are added to the set so that duplicates within the same run are also caught. When a contact's enriched email already appears in the set, the `email_reused_across_contacts` soft flag is raised, resulting in a `review_before_send` verdict.

### 2.6 Bulk Actions

Two bulk action buttons were added to the Campaign Actions card:

**"Approve All Send-Ready"** — calls `campaign.bulkApproveEmails`, which sets `approvalStatus = 'approved'` and `approvalNote = 'Bulk approved (send_ready)'` for all campaign contacts where `sendReadiness = 'send_ready'` and `approvalStatus != 'approved'`. Returns the count of records updated.

**"Export Blocked CSV"** — calls `campaign.exportBlockedContacts`, which returns a JSON array of contacts where `sendReadiness IN ('blocked_from_send', 'review_before_send')`. The frontend converts this to a CSV file and triggers a browser download. The CSV includes: name, title, company, email, sendReadiness, and the first hard flag (if any).

A third procedure, `campaign.bulkRejectEmails`, was also added to support future bulk rejection of a supplied list of contact IDs.

---

## 3. Test Results

### 3.1 Stage 4 Test File

**File:** `server/stage4.test.ts`
**Test count:** 38 tests across 8 describe blocks

| Describe Block | Tests | Coverage |
|---|---|---|
| `enrichmentQA — reused-email detection` | 6 | `email_reused_across_contacts` flag, `review_before_send` verdict, in-batch tracking |
| `enrichmentQA — hard block flags` | 5 | `domain_suspicious_mismatch`, `invalid_email`, `geo_mismatch`, `below_score_threshold`, `tier_not_send_eligible` |
| `enrichmentQA — soft review flags` | 5 | `generic_role_email`, `retired_or_former`, `domain_unknown`, `low_hunter_confidence`, `no_linkedin_corroboration` |
| `enrichmentQA — send_ready path` | 3 | Clean contact with `exact` match and `high_trust` confidence |
| `enrichmentQA — blocked_from_send (no email)` | 2 | Missing email, `blocked` provider confidence |
| `determineSendReadiness — edge cases` | 5 | Mixed hard+soft, all-soft, no-flags, low_trust, very_low_hunter |
| `getCampaignContacts — sendReadiness filter` | 6 | Filter by each value, null filter returns all, unknown value returns empty |
| `domain override procedures` | 6 | List, add, update, remove, active/inactive toggle, invalid campaignId guard |

### 3.2 Full Suite

| Metric | Value |
|---|---|
| Total test files | 75 |
| Total tests | 2,166 |
| Passed | 2,166 |
| Failed | 0 |
| Duration | ~18 s |

---

## 4. Manual Verification Steps

The following flows should be verified in the browser after deploying checkpoint `80451b7f`:

### 4.1 Send-Readiness Badge

1. Open any campaign with enriched contacts.
2. Navigate to the **Contacts** tab.
3. Confirm the **Readiness** column is present between **Tier** and **Outreach**.
4. Confirm badges render in green (`send_ready`), amber (`review_before_send`), or red (`blocked_from_send`).
5. For contacts where `sendReadiness` is `null` (not yet enriched), confirm the cell renders a grey "—" placeholder.

### 4.2 "Why?" Panel

1. Click the chevron icon in the Readiness cell of any enriched contact.
2. Confirm the panel expands below the contact row.
3. Confirm `reasoningSummary` text is displayed.
4. Confirm hard flags (if any) appear as red badges.
5. Confirm soft flags (if any) appear as amber badges.
6. Click the chevron again to collapse the panel.

### 4.3 Send-Readiness Filter

1. In the Contacts tab filter bar, locate the **Readiness** dropdown.
2. Select `send_ready` — confirm only green-badged contacts are shown.
3. Select `blocked_from_send` — confirm only red-badged contacts are shown.
4. Select `All` — confirm all contacts are shown.

### 4.4 Domain Overrides Modal

1. In the Campaign Actions card, click **Domain Overrides**.
2. Confirm the modal opens and lists any existing overrides.
3. Add a new override (e.g., domain `example.com`, type `trusted`).
4. Confirm the row appears in the table.
5. Edit the override type to `blocked` — confirm the change persists after closing and reopening the modal.
6. Delete the override — confirm the row is removed.

### 4.5 Bulk Approve

1. Ensure at least one contact has `sendReadiness = 'send_ready'` and `approvalStatus != 'approved'`.
2. Click **Approve All Send-Ready** in the Campaign Actions card.
3. Confirm a success toast appears with the count of approved contacts.
4. Confirm the affected contacts now show `approvalStatus = 'approved'` in the Contacts tab.

### 4.6 Export Blocked CSV

1. Ensure at least one contact has `sendReadiness = 'blocked_from_send'` or `review_before_send'`.
2. Click **Export Blocked CSV**.
3. Confirm a CSV file is downloaded.
4. Open the CSV and confirm it contains name, title, company, email, sendReadiness, and flag columns.

---

## 5. Known Gaps and Deferred Items

The following items from the Stage 4 plan were deferred and remain as open `[ ]` items in `todo.md`:

| Item | Reason for Deferral |
|---|---|
| Summary counts (send_ready / review / blocked) in campaign stats card | Low urgency; stats card redesign is part of Stage 5 dashboard work |
| Post-batch QA sweep — re-run QA on all contacts after enrichment completes | Requires careful rate-limit management; planned for Stage 5 |
| Blocked contacts hidden by default in approval queue (audit filter only) | UX decision deferred pending rep feedback |
| `domainMatchType` filter in contacts query | Deprioritised; `sendReadiness` filter covers the primary use case |

---

## 6. Files Changed in Stage 4

| File | Change Type | Description |
|---|---|---|
| `client/src/pages/Campaigns.tsx` | Modified | Added `sendReadiness` badge, `WhyPanel`, filter dropdown, bulk action buttons, `DomainOverridesModal`, new mutations |
| `server/routers.ts` | Modified | Added `sendReadiness` to `campaign.contacts` input; added `listDomainOverrides`, `addDomainOverride`, `updateDomainOverride`, `removeDomainOverride`, `bulkApproveEmails`, `bulkRejectEmails`, `exportBlockedContacts` procedures |
| `server/campaignService.ts` | Modified | Extended `getCampaignContacts` with `sendReadiness` filter; added `allCampaignEnrichedEmails` fetch and in-batch tracking in `enrichCampaignContacts` |
| `server/stage4.test.ts` | Created | 38 new Vitest tests for Stage 4 features |

---

## 7. Checkpoint

**Version ID:** `80451b7f`
**Deployed:** 21 April 2026
**Test suite:** 2,166 / 2,166 passing
