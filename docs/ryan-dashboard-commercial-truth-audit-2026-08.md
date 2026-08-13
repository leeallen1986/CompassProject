# Ryan This Week — Commercial Truth Audit (August 2026)

## Purpose

The live Ryan dashboard audit showed the correct WA territory ownership, but it also exposed several commercial-truth gaps that the current audit classifier is too permissive to catch. This document records the controller interpretation of the audit before PR #102 is merged.

## Controller conclusion

The dashboard should not use `action_ready` as a synonym for:

- WA project;
- medium/high air fit;
- any verified contact;
- any recorded contractor entry.

A project is action-ready only when the **direct product lane, current buying trigger, relevant package holder, and exact-linked buyer contact all line up**.

## Findings from the 15-project Ryan audit

### Territory / rep ownership

All 15 projects are in Ryan's WA scope. No Paul/Dan territory conflict was found in this sample.

That does **not** prove all 15 are direct Portable Air opportunities. A WA project still requires a product/route test because generic small/medium air can be CEA-controlled.

### Application mapping defects

The audit over-generalised several applications:

- GAWSS and Goldfields Pipeline were labelled `RC, Aircore and DTH drilling` even though the richer persisted evidence is pipeline construction / excavation / drilling / blasting.
- Scarborough Gas and Scarborough Energy were labelled drilling opportunities even though their strongest product signals are Booster, Nitrogen, gas processing, pipeline construction and commissioning.
- Kwinana Freeway and Yindjibarndi Solar were treated as direct large-air opportunities despite only medium air fit and generic portable-compressor construction signals; compressor size/direct route is not proven.
- Barrow Island Decommissioning is primarily decommissioning/dewatering in the current evidence; the Portable Air package and buyer route need to be proved rather than inferred from a generic compressor signal.
- Hard Rock Lithium remains product-fit unproven.

### Timing defect

British Hill Gold Project is currently shown as action-ready even though the persisted stage says exploration drilling is complete and the Mineral Resource Estimate upgrade is pending. That is a monitor / next-program trigger unless a new drilling package is evidenced.

### Package-holder / contact alignment defect

The current PR #102 classifier can call a project `action_ready` when:

- at least one package holder exists; and
- some buyer-lane contact is effectively send-ready;

without requiring the contact's organisation to be the relevant package holder.

This can create false readiness where a verified contact belongs to a predicted or unrelated contractor.

The Ryan sample contains concrete reasons to fail closed:

- Youanmi has verified contacts across Macmahon, Worley and Primero while the headline contractor entries include Monadelphous and NRW, with several contractor claims still unbound to external evidence.
- Scarborough projects contain principal/contractor complexity and need the actual package buyer matched to the contact, not merely a verified project-linked contact.
- Yindjibarndi Solar carries a recorded Arrow Energy contractor entry that should be treated as a mapping anomaly until independently bound to the project.
- Scarborough Energy contains malformed/contaminated contractor text and should not derive readiness from that entry.

## Minimum action-ready contract

A Ryan project may be `action_ready` only when all are true:

1. WA ownership or approved national-account exception is correct.
2. A **direct** Portable Air family is proven, or the project is explicitly marked `confirm_product_scope` rather than assuming >600 cfm.
3. The timing signal is current and commercially actionable.
4. A non-inferred contractor/JV/package holder is recorded for the relevant equipment scope.
5. At least one exact-linked effectively send-ready buyer-lane contact belongs to that same relevant buying/package-holder organisation.
6. The displayed best stakeholder is that same safe matched contact (or the card shows the correct validation/map CTA).
7. No malformed contractor evidence, channel conflict or unresolved buyer-route contradiction remains.

## Required PR #102 changes before merge

- Add package-holder organisation matching to the action-ready classifier.
- Expose metrics for package-matched buyer contacts and card/package alignment.
- Add a regression test where a verified contact at an unrelated contractor must **not** classify as `action_ready`.
- Add a regression test where only an inferred/predicted package holder exists; result must fail closed.
- Add a regression test where the card shows a verified contact at the principal while the recorded package buyer is a contractor.
- Keep audit outputs email-redacted.

## Required This Week follow-up

Separately from PR #102, the live dashboard needs commercial-truth corrections for:

- application precedence (specialty pipeline/gas/commissioning should outrank generic drilling labels where supported);
- direct-vs-CEA fail-closed routing when compressor size/family is unknown;
- stale/monitor timing for completed exploration campaigns;
- malformed contractor suppression and contractor-evidence provenance.

These changes should be driven by the actual 15-project audit and then re-run on Ryan before copying the same logic to Paul and Dan.
