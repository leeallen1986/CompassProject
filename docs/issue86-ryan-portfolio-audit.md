# Issue #86 — Ryan-mode portfolio audit

This audit is the read-only portfolio test required after the evidence-safe Route to buyer Phase 1 release.

It evaluates every project returned in a rep's current `This Week` project set and separates commercial readiness from data/UI defects. It does not create a second ranking model and does not alter the project order used by the product.

## Classifications

Each project receives one primary classification and may carry additional flags:

- `action_ready`
- `right_project_wrong_contact`
- `principal_only`
- `contractor_unmapped`
- `buyer_lane_unmapped`
- `contact_evidence_hidden`
- `unsafe_outreach_exposed`
- `product_fit_unproven`

The primary classification is the highest-severity applicable condition. The report retains every flag, the evidence behind it and exact corrective actions.

## Evidence boundary

The audit uses only existing read paths:

- `getThisWeekSummary(userId)` for the rep-facing project/card state;
- `getProjectBuyerRouteInputs(projectId)` for exact persisted project links;
- `buildProjectBuyerRoute(...)` for the existing evidence-safe dossier.

It does not use free-text contact/project matching, provider discovery or the unapplied Issue #86 evidence tables.

A project is `action_ready` only when it has:

1. credible lane and compressed-air product fit;
2. at least one **non-inferred recorded** contractor/JV/package-holder route;
3. at least one exact-linked contractor, commercial or technical contact whose recorded organisation matches that package holder;
4. that package-matched buyer is effectively send-ready under the canonical contact policy;
5. the This Week card resolves the same safe package-matched buyer when it exposes `view_best` / an email;
6. no card-level unsafe outreach or hidden-evidence conflict.

Predicted/inferred contractor entries remain useful hypotheses but cannot by themselves make a project action-ready.

## Output privacy

The JSON, CSV and Markdown outputs intentionally exclude plaintext email addresses. They record only whether the current card exposed an email, whether the contact satisfies the effective-send-ready policy, and whether the contact is aligned to the recorded package-holder route.

## Run

From an authorised runtime with read access to the production database:

```bash
pnpm exec tsx server/scripts/ryanPortfolioAudit.ts \
  --user-id <RYAN_USER_ID> \
  --output-dir ./artifacts/issue86-ryan-portfolio-audit \
  --worst-limit 15
```

Outputs:

- `ryan-portfolio-audit.json` — complete machine-readable portfolio and worst-15 set;
- `ryan-portfolio-audit.csv` — all projects with classifications, package-route metrics and corrections;
- `ryan-portfolio-audit.md` — management-readable summary and worst 15.

## Safety boundary

The audit performs no:

- database insert, update or delete;
- project or contact mutation;
- candidate-slate regeneration;
- provider, LLM or enrichment call;
- pipeline run or replay;
- outreach or email send;
- GitHub or deployment mutation during production execution.

Production execution should be wrapped with the same before/after database fingerprint discipline used by the contact-trust audits.

The broader live This Week application/routing/timing corrections found by the August Ryan audit are tracked separately in Issue #106.
