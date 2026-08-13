# Issue #104 — Pipeline Reliability Correction Design

## Incident

Natural cloud-worker run `3840001` was source-attested and executed the current trust writers successfully, but the overall process later exceeded the fixed 90-minute global timeout while Contractor Engine was active. The same failed row then prevented the web self-healing path from launching a retry because `wasRunStartedToday()` checks only whether a row started in the window, not whether it completed successfully.

## Required behaviour

### Global runtime budget

- Keep the existing 90-minute safety limit for ordinary web/admin/debug execution.
- Give the dedicated `cron` worker and `self-healing-retry` executions an explicit longer global budget (target: 3 hours) so weekly Wed/Sat work does not inherit a web-oriented ceiling.
- Continue to retain bounded step-level timeouts for network/enrichment steps.
- Do not describe Contractor Engine itself as proven slow solely because it was the current step when the global deadline expired; the full run had already consumed most of the budget.

### Self-healing eligibility

The retry check must distinguish the latest post-window run state:

- `running` → retry blocked;
- `completed` → retry not required;
- `failed` → retry eligible;
- no row → retry eligible.

A failed row must never satisfy the duplicate-protection condition.

### Notification semantics

The missed-run email must not promise that a retry "will" run before retry eligibility has been evaluated. Prefer wording that reports the current pipeline state and says the self-healing controller will evaluate whether a retry is required; the retry path should separately log/send actual outcome if desired.

## Tests required

1. Completed run in the current window blocks a retry.
2. Running run in the current window blocks a retry.
3. Failed run in the current window allows a retry.
4. No run allows a retry.
5. `cron` and `self-healing-retry` use the extended global timeout.
6. manual/admin/default execution retains the standard timeout.
7. Notification text does not state that a retry will definitely execute.

## Safety

Code/test change only until separately approved for worker/web release. No production pipeline replay is required to validate the PR.
