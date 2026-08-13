# Issue #106 — Ryan This Week Commercial Truth Corrections

## Problem

The August 2026 read-only audit of Ryan Pemberton's 15 current `This Week` projects found correct WA territory ownership, but the live projection is still too permissive in four commercial areas: application precedence, direct-vs-channel routing, timing, and package-holder/contact alignment.

## Evidence from the live 15-project audit

- GAWSS / Goldfields Pipeline are currently labelled as drilling opportunities even though persisted evidence is primarily pipeline construction, excavation, blasting and drilling.
- Scarborough Gas / Scarborough Energy are labelled drilling even though their strongest scored families are Booster and Nitrogen with gas-processing / pipeline evidence.
- Kwinana Freeway and Yindjibarndi Solar have only medium air fit and generic portable-compressor construction signals; the dashboard must not assume a >600 cfm direct lane.
- Barrow Island Decommissioning has dewatering/decommissioning evidence but no sufficiently specific direct Portable Air package in the current card.
- British Hill says exploration drilling is completed / MRE upgrade pending, yet is still treated as an immediate action.
- Hard Rock Lithium remains product-fit unproven.
- Yindjibarndi Solar carries an Arrow Energy contractor entry that should not be treated as buying-route proof without project-bound evidence.
- Scarborough Energy contains malformed/contaminated contractor text that must be suppressed from commercial-route logic.

## Required product behaviour

1. **Application precedence**
   - specialty pipeline / gas-processing / commissioning signals outrank generic drilling when those stronger signals are present;
   - pipeline projects should resolve to pipeline testing/drying/commissioning or construction-air as supported;
   - do not map every project containing a drilling token to RC/Aircore/DTH.

2. **Direct-vs-channel fail closed**
   - WA ownership alone is not enough to assert direct Portable Air;
   - generic portable-compressor construction demand with unknown capacity/family should be `confirm_product_scope` rather than `DIRECT_LARGE_AIR`;
   - direct may be asserted for proven >600 cfm, booster/high-pressure, dryers/air-treatment, nitrogen or electric/E-Air families, plus explicit key-account exceptions.

3. **Timing**
   - completed exploration/drilling with no next package evidenced should move to monitor/next-program trigger rather than stay action-ready.

4. **Contractor evidence hygiene**
   - malformed URL/article strings cannot count as contractor/package holders;
   - inferred/predicted contractors remain hypotheses;
   - action-ready requires a non-inferred recorded package holder and a matching exact-linked safe buyer contact.

5. **Contact-team action**
   - if the project is commercially valid but the matched package buyer is unverified, CTA = validate contacts;
   - if the package holder is missing/unproven, CTA = map contractor/package;
   - if direct product scope is unknown, CTA = confirm product scope;
   - only then expose outreach/view-best.

## Acceptance test on Ryan

Re-run the exact same 15-project audit after the change and return, project by project:

- corrected application;
- direct/channel/scope status;
- timing status;
- recorded package holder;
- package-matched safe buyer count;
- CTA;
- final disposition.

The goal is not to maximize `action_ready`; the goal is that every action-ready card is defensible to a sales rep.
