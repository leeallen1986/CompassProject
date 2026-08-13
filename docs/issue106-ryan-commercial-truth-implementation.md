# Issue #106 — Ryan This Week commercial-truth pilot

## Purpose

The first live Ryan audit proved that territory ownership was broadly correct, but `This Week` could still overstate commercial readiness when the application, direct-vs-channel route, timing, package holder and buyer contact did not all line up.

This change keeps the existing ranking/data-assembly service intact and adds a fail-closed commercial layer for **Ryan Pemberton only**. Paul, Dan and other users stay on the existing projection until Ryan's 15-project set is re-audited.

## Architecture

- `thisWeekServiceLegacy.ts` preserves the prior production assembly/ranking implementation unchanged.
- `thisWeekCommercialTruth.ts` is a provider/database-free deterministic resolver for application, route, timing and package-buyer readiness.
- `thisWeekCommercialService.ts` reads the existing exact-link buyer dossier for each of Ryan's top 15 projects and applies the resolver.
- `thisWeekService.ts` is the narrow pilot gate: Ryan receives the commercial projection; everyone else receives the unchanged legacy projection.

No second project-ranking model is introduced. Existing project order is preserved inside three commercial buckets: direct action, validate/map/confirm, then monitor/channel intelligence.

## Fail-closed rules

A project is action-ready only when all are true:

1. a direct Portable Air family is proven (>600 cfm, high-pressure/booster, pipeline testing/drying, nitrogen, electric/E-Air, or an explicit direct key-account exception);
2. the current timing signal is actionable;
3. a usable non-inferred recorded package holder exists;
4. an exact-linked buyer-lane contact belongs to that package holder;
5. that same buyer is effectively send-ready.

Generic construction/compressor demand with unknown capacity becomes `confirm_product_scope`. Explicit demand at or below 600 cfm becomes `route_via_cea`. Completed drilling/exploration with no next program trigger becomes `monitor_next_program`.

Malformed URL/article fragments cannot count as package holders. A safe contact at the wrong contractor cannot create action readiness.

## Application precedence

Specific specialty evidence outranks generic drilling tokens:

1. nitrogen purging/inerting/commissioning;
2. booster/high-pressure testing;
3. pipeline testing/drying/commissioning;
4. gas-processing commissioning;
5. pipeline construction/excavation air;
6. electric portable/fixed-speed;
7. RC/Aircore/DTH/blast-hole drilling;
8. abrasive blasting;
9. shutdown/temporary plant air;
10. generic compressor scope.

## Sales action mapping

- package-matched safe buyer -> `view_best` / outreach;
- package-matched named buyer unverified -> validate;
- recorded package holder but no buyer -> find buyer;
- package holder missing/unusable -> map package holder;
- direct-vs-CEA scope unknown -> confirm product scope;
- explicit <=600 cfm -> CEA, not Ryan direct action;
- completed program with no next trigger -> monitor.

The commercial layer also rebuilds Ryan's suggested actions so legacy high-relevance contacts cannot independently create an outreach recommendation when the package/product gate fails.

## Safety

Implementation and CI require no production database writes, provider calls, enrichment, pipeline replay, email sends, contact changes or deployment.

## Acceptance

After merge/deployment, rerun the same read-only 15-project Ryan audit and inspect for each project:

- corrected application;
- route/scope status;
- timing status;
- recorded package holder;
- package-matched safe buyer count;
- CTA / next action;
- final action-ready state.

Do not generalise the pilot to Paul or Dan until the Ryan result is commercially defensible project-by-project.
