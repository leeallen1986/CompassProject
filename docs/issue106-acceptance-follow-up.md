# Issue #106 acceptance follow-up

The live Ryan acceptance archive exposed one remaining fail-closed defect: a project supplier/source-only confirmed organisation could satisfy the package-holder gate and make an unrelated safe contact action-ready. The Scarborough Energy sample demonstrated this with Boral/Arrow Energy. The fix requires buying-package role/scope evidence before an organisation is eligible for package-buyer matching.

This follow-up also restores the source tree to the approved PR #107 tree before applying the guard, removing deployment/audit artifacts accidentally added by the Manus sync commit from repository HEAD. Historical Git objects are not rewritten by this PR.
