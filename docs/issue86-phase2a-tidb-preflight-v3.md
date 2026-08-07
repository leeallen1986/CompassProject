# Issue #86 Phase 2A — TiDB production preflight v3

This controller-owned tool replaces the brittle account-definition gate in the v2 TiDB preflight and adds a read-only census of existing CHECK constraints before any platform-level CHECK enablement decision.

## What changed

- Authentication strings and account identifiers from `SHOW CREATE USER` are excluded from the policy hash.
- Account safety still requires the exact pinned account identity, role, grants, grant-row count, absence of write/admin privileges, and effective encrypted-transport enforcement.
- Effective transport is accepted only when the account requires SSL/X509 or TiDB has `require_secure_transport=ON`.
- A complete `information_schema.TIDB_CHECK_CONSTRAINTS` census is captured twice and must remain stable.
- A later READY run requires the census count and SHA-256 to be controller-pinned.
- The runner, support module and complete imported policy/core chain are independently SHA-256 pinned before any production connection.
- Zero preflight writes can be certified even when a separate capability blocker, such as disabled CHECK enforcement, remains.
- The CLI writes JSON synchronously and exits `2` for every blocked readiness state.
- Disposable TiDB tests measure the behavior of constraints created before and after changes to `tidb_enable_check_constraint`.

## Safety boundary

The production preflight performs one TLS-authenticated connection and a fixed SELECT/SHOW-only transcript. It cannot execute migration `0091` or any DDL/DML statement. A READY result still does not authorise migration apply.

## Two-stage production use

1. Run without census pins while CHECK enforcement is disabled. This returns the stable census and remains blocked.
2. Review the census. If the platform administrator separately enables CHECK enforcement, rerun with the reviewed census count and SHA-256 pins.

Only the second run can return:

`READY_FOR_SEPARATE_TIDB_APPLY_AUTHORIZATION`

## Exit contract

- `0`: READY for a separate apply-authorization decision.
- `2`: completed but blocked.
- `1`: incomplete or execution failure.
