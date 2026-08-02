# PR #79 retained-child batch 2 V3 — retired

## Status

```text
RETIRED = true
GENERATION_ALLOWED = false
SEAL_ALLOWED = false
APPLY_ALLOWED = false
```

PR #79 proposed three parent links:

```text
278 → 269
332 → 272
352 → 275
```

The production read-only draft proved that account `272` is **United Rentals**
while account `332` is **Kennards Hire**. The proposed `332 → 272` relationship
is therefore commercially false.

The `parent_identity_mismatch` safety flag was correct and must not be
overridden.

## Permanent controls

The V3 CLI:

```text
server/scripts/rentalRetainedChildBatch2Reconcile.ts
```

is hard-retired and exits non-zero.

The V3 module-level generator, seal verifier and apply functions are also
retired. Direct import cannot generate, seal or apply the rejected contract.
Historic V3 artifacts are evidence only and must never be used as write input.

## Supported replacement

Use the controller-reviewed corrected V4 release:

```text
docs/rental-retained-child-batch2-correction.md
server/scripts/rentalRetainedChildBatch2CorrectionReconcile.ts
```

The corrected batch contains only:

```text
278 Coates Industrial Solutions → 269 Coates Hire
352 Tutt Bryant Equipment       → 275 Tutt Bryant Hire
```

Account `332` remains a standalone, active, counting Kennards Hire commercial
record. Account `272` remains United Rentals. Neither is written by the
corrected batch.
