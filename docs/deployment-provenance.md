# Deployment provenance and health

PR #45 introduced deployment diagnostics. PR #47 corrects the provenance model so Manus internal repository revisions cannot be mistaken for GitHub commit SHAs.

## Why the distinction matters

Manus injects a platform-controlled revision into common variables such as `DEPLOYED_GIT_SHA`. That value belongs to the Manus S3-backed project repository. It is useful runtime provenance, but it is not the GitHub commit that was reviewed and squash-merged in `leeallen1986/CompassProject`.

GitHub provenance therefore uses Compass-specific, non-reserved variables that the platform does not replace:

- `COMPASS_GITHUB_SOURCE_SHA`
- `COMPASS_EXPECTED_GITHUB_MAIN_SHA`

The application only reports GitHub alignment when both explicit Compass variables are present and match.

## Endpoints

### Public runtime health

`system.deploymentHealth`

Returns a read-only, secret-free payload containing:

- application name and version
- deployment environment
- Manus internal runtime revision
- recorded GitHub source revision
- expected GitHub main revision
- GitHub alignment state
- Manus checkpoint identifier
- build timestamp
- database schema version label
- runtime check timestamp

The legacy `deployedRevision` field remains for compatibility, but is explicitly labelled by `deployedRevisionSource: "manus_internal"`. New consumers should use `manusInternalRevision` and `githubSourceRevision`.

It does not test database connectivity and does not expose URLs, credentials, connection strings or secret values.

### Admin diagnostics

`system.deploymentDiagnostics`

Admin-only. Returns two separate provenance tracks:

**GitHub source record**

- source repository and branch
- recorded GitHub source SHA
- expected GitHub main SHA at deployment approval
- GitHub alignment state

**Manus runtime provenance**

- Manus internal revision
- Manus checkpoint
- build timestamp
- application and schema versions

It also returns boolean checks for database, authentication, published-site and provenance configuration, plus the names of missing non-secret metadata variables.

## GitHub alignment states

The GitHub alignment state is deliberately limited to:

- `aligned` — the two explicit Compass GitHub revision values match, including a valid 7+ character SHA prefix
- `out_of_sync` — both explicit GitHub values exist and differ
- `unknown` — either explicit GitHub value is missing

Matching Manus platform variables never produce GitHub alignment.

`aligned` is a deployment-record check, not a live GitHub query. The application does not inspect commit ancestry or prove that GitHub `main` has not advanced since release.

## Admin page

Open:

`/admin/deployment`

The page is protected in both places:

- the UI only runs the query for users with `role=admin`
- the tRPC diagnostics procedure uses `adminProcedure`

The global admin badge displays the recorded GitHub source SHA, not the Manus internal revision. The badge tooltip includes both values and the Manus checkpoint.

## Required deployment variables

Set these non-secret values when creating the Manus deployment checkpoint:

| Variable | Example | Purpose |
|---|---|---|
| `COMPASS_GITHUB_SOURCE_SHA` | full GitHub merge SHA | Exact reviewed GitHub source forward-ported into Manus |
| `COMPASS_EXPECTED_GITHUB_MAIN_SHA` | same approved GitHub merge SHA | Comparison target recorded at deployment approval |
| `MANUS_CHECKPOINT_ID` | `26d5e2dc` | Manus rollback/deployment identifier |
| `BUILD_TIMESTAMP` | ISO-8601 timestamp | When the build was produced |
| `APP_VERSION` | `1.0.0` | Application release version |
| `DATABASE_SCHEMA_VERSION` | `0088_daffy_thunderball` | Applied schema/migration label |

Recommended optional values:

| Variable | Default |
|---|---|
| `SOURCE_REPOSITORY` | `leeallen1986/CompassProject` |
| `SOURCE_BRANCH` | `main` |
| `DEPLOYMENT_ENVIRONMENT` | falls back to `NODE_ENV` |

Common provider variables such as `DEPLOYED_GIT_SHA`, `GITHUB_SHA`, `GIT_COMMIT_SHA` and `COMMIT_SHA` are read only as Manus internal runtime provenance. They are never accepted as GitHub source proof.

## Deployment rule

GitHub `main` remains the source of truth. Manus is the deployment target. Every production checkpoint should record the reviewed GitHub merge SHA in both Compass-specific GitHub variables.

Do not edit production-only application code without returning the change to GitHub through a reviewed PR.

No runtime GitHub token is required or supported by this feature.

## Validation

Run before merge and again in the Manus deployment project:

```bash
pnpm tsc --noEmit
pnpm build
pnpm exec vitest run server/deploymentMetadata.test.ts
```

Required smoke checks:

1. With only Manus provider variables present, GitHub state is `unknown`.
2. With matching Compass GitHub variables, GitHub state is `aligned`.
3. With different Compass GitHub variables, GitHub state is `out_of_sync`.
4. The admin page labels the Manus internal revision separately.
5. The badge shows the recorded GitHub source SHA.
6. Neither endpoint exposes secrets or connection strings.
