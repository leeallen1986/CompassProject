# Commercial truth guardrails

## Purpose

This release hardens the project intelligence that feeds **This Week** and **Explore Projects** before AI recommendations are allowed to direct rep activity.

The operating sequence remains:

```text
project evidence
→ lane and territory gate
→ contractor / buying-entity identity
→ canonical Full Potential account
→ evidence-generating next action
```

Compass must fail closed when territory or buying-entity evidence is unresolved. It must not improve apparent coverage by presenting a broad project list or a weak company-name overlap as commercial fact.

## Territory scope

Personalised project lists now apply territory scope before scoring and ranking.

Rules:

1. `projectState` is authoritative when it contains a recognised state or territory.
2. Free-text `location` is used only when `projectState` is missing or unparseable.
3. A missing profile, failed profile lookup or unconfigured territory returns no personalised recommendations.
4. `OFFSHORE_AU` is separate from the onshore states and is included only by the existing profile-resolution rules.
5. Closing Soon tenders use the same fail-closed scope.

The response exposes `userContext.scopeResolved` and `userContext.scopeIssue` so the UI and operators can distinguish an empty commercial list from a profile/configuration failure.

## Portable Air opportunity gate

Generic accommodation is suppressed unless the project text—not AI-inferred equipment tags—contains a distinct compressed-air package.

Suppressed examples include:

- student accommodation;
- student or university housing;
- dormitories;
- apartment and residential developments;
- retirement, social and affordable housing.

A separately specified compressor package, CFM/PSI requirement, pneumatic work package or abrasive-blasting package may pass the gate.

## Contractor identity

Multi-party contractor labels are parsed before account resolution.

Examples:

```text
CPB Contractors and NACAP joint venture
→ CPB Contractors
→ NACAP

Decmil (Macmahon)
→ Decmil — operating entity
→ Macmahon — parent/group context requiring validation

Action Drill & Blast (NRW)
→ Action Drill & Blast — operating entity
→ NRW — parent/group context requiring validation
```

Whole joint-venture, alliance and composite strings are never fuzzy-matched directly. Parent/group context is lower confidence and cannot displace the operating entity.

Generic identity tokens such as `joint`, `venture`, `alliance`, `consortium`, `package` and `partners` are excluded from token-overlap matching. This prevents matches such as:

```text
CPB Contractors and NACAP joint venture
≠ Abergeldie Joint Venture Packages
```

## Data boundary

This release does not:

- insert contractor aliases;
- merge or reclassify accounts;
- persist project-to-account links;
- create actions, evidence, models or pursuits;
- advance pipeline stages;
- write financial values;
- write to C4C;
- add a schema or migration.

After deployment and a successful route-quality re-audit, only the two separately approved aliases may be considered for controlled insertion:

- `DT Infrastructure (DTI)` → `Dt Infrastructure` (account 30175);
- `Monadelphous Group` → `Monadelphous` (account 238).

## Validation

```bash
pnpm tsc --noEmit
pnpm build
pnpm exec vitest run \
  server/commercialTruthGuardrails.test.ts \
  server/fullPotentialAccountMatching.composites.test.ts \
  server/fullPotentialAccountMatching.shared.test.ts \
  server/laneScoring.test.ts
```

Production verification must remain read-only until the code guardrails are proven against the live WA Portable Air user context.
