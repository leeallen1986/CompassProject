# Full Potential Rental core governance correction

## Purpose

The source-controlled Rental evidence model must reflect the governed account
classification applied during the Issue #130 identity review.

Mobile Compressed Air is retained as public market evidence because its visible
portable-compressor range is useful for understanding competitor and channel
coverage. It is not treated as an addressable Atlas Copco Rental buyer in the
current model.

## Corrected structure

The Rental model now contains:

- **24 addressable named Rental buyers** in the buyer-counting core;
- one separate non-counting Mobile Compressed Air market-context record;
- no monetary scenario on the context record;
- no commercial-pool key on the context record;
- `addressabilityStatus=excluded` for the current buyer model;
- no CRM, contact, quotation or private customer intelligence.

The context record remains visible in management product/application cuts but
cannot contribute to the headline Full Potential total.

## Corrected public-evidence universe

Removing the former P3 buyer band changes the inferred named-buyer unit universe
to:

```text
Low / Base / High = 476 / 724 / 1,015
```

These are transparent model bands, not asserted customer fleet quantities.

The monetary management result is recalculated only when the restricted private
planning pack is applied. The public source does not disclose the current price
ladder or local commercial assumptions.

## Reconciliation impact

The default Rental account-reconciliation input now contains 24 required buyer
identities. Mobile Compressed Air does not require a monetary account target and
must not be reintroduced through an alias or duplicate-account workaround.

## Safety boundary

This correction is source-only. It performs no:

- production database mutation;
- Full Potential account or financial change;
- evidence, model, signal or action creation;
- CRM/C4C mutation;
- provider or pipeline call;
- deployment.
