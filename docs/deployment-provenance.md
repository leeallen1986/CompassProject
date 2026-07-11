# Deployment provenance and health

PR #45 adds explicit deployment metadata so the running Compass application can be compared with the reviewed GitHub source without inspecting secrets or relying on deployment history.

## Endpoints

### Public runtime health

`system.deploymentHealth`

Returns a read-only, secret-free payload containing:

- application name and version
- deployment environment
- short deployed Git revision
- Manus checkpoint identifier
- build timestamp
- database schema version label
- runtime check timestamp

It does not test database connectivity and does not expose URLs, credentials, connection strings or secret values.

### Admin diagnostics

`system.deploymentDiagnostics`

Admin-only. Returns:

- full deployed and expected Git revisions
- source repository and branch
- alignment state
- Manus checkpoint
- build timestamp
- application and schema versions
- boolean checks for database, authentication and published-site configuration
- names of missing non-secret provenance variables

The alignment state is deliberately limited to:

- `aligned` — the supplied revisions match, including a valid 7+ character SHA prefix
- `out_of_sync` — both revisions exist and differ
- `unknown` — either revision is missing

`out_of_sync` does not claim which revision is newer because the production runtime does not query GitHub or inspect commit ancestry.

## Admin page

Open:

`/admin/deployment`

The page is protected in both places:

- the UI only runs the query for users with `role=admin`
- the tRPC diagnostics procedure uses `adminProcedure`

## Required deployment variables

Set these non-secret values when creating the Manus deployment checkpoint:

| Variable | Example | Purpose |
|---|---|---|
| `DEPLOYED_GIT_SHA` | full GitHub merge SHA | Exact source revision deployed |
| `EXPECTED_GITHUB_MAIN_SHA` | full GitHub main SHA at deployment approval | Comparison target |
| `MANUS_CHECKPOINT_ID` | `cea238f9` | Manus rollback/deployment identifier |
| `BUILD_TIMESTAMP` | ISO-8601 timestamp | When the build was produced |
| `APP_VERSION` | `1.0.0` | Application release version |
| `DATABASE_SCHEMA_VERSION` | `0088_daffy_thunderball` | Applied schema/migration label |

Recommended optional values:

| Variable | Default |
|---|---|
| `SOURCE_REPOSITORY` | `leeallen1986/CompassProject` |
| `SOURCE_BRANCH` | `main` |
| `DEPLOYMENT_ENVIRONMENT` | falls back to `NODE_ENV` |

Common provider aliases such as `GITHUB_SHA`, `GIT_COMMIT_SHA`, `GITHUB_MAIN_SHA`, `DEPLOYED_AT`, `DB_SCHEMA_VERSION` and `npm_package_version` are accepted as fallbacks.

## Deployment rule

GitHub `main` remains the source of truth. Manus is the deployment target. Every production checkpoint should record the reviewed GitHub merge SHA in `DEPLOYED_GIT_SHA`; do not edit production-only application code without returning the change to GitHub through a reviewed PR.

No runtime GitHub token is required or supported by this feature.

## Validation

Run before merge and again in the Manus deployment project:

```bash
pnpm tsc --noEmit
pnpm build
pnpm exec vitest run server/deploymentMetadata.test.ts
```

After publication, sign in as an administrator and verify `/admin/deployment` reports the expected checkpoint, schema version and aligned revisions.
