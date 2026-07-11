type EnvLike = Record<string, string | undefined>;

export type DeploymentSyncState = "aligned" | "out_of_sync" | "unknown";

const UNKNOWN = "unknown";
const DEFAULT_APP_NAME = "atlas-copco-intelligence";
const DEFAULT_SOURCE_REPOSITORY = "leeallen1986/CompassProject";
const DEFAULT_SOURCE_BRANCH = "main";

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function firstValue(env: EnvLike, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = clean(env[key]);
    if (value) return value;
  }
  return undefined;
}

export function shortRevision(value: string): string {
  return value === UNKNOWN ? UNKNOWN : value.slice(0, 8);
}

export function revisionsMatch(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b || a === UNKNOWN || b === UNKNOWN) return false;
  if (a === b) return true;

  // Git tooling commonly supplies either a full 40-character SHA or a short SHA.
  // Treat a 7+ character prefix as the same revision without pretending to infer ancestry.
  return (a.length >= 7 && b.startsWith(a)) || (b.length >= 7 && a.startsWith(b));
}

export function buildDeploymentProvenance(
  env: EnvLike = process.env,
  checkedAt: Date = new Date(),
) {
  const deployedGitSha = firstValue(env, [
    "DEPLOYED_GIT_SHA",
    "GIT_COMMIT_SHA",
    "GITHUB_SHA",
    "COMMIT_SHA",
    "VERCEL_GIT_COMMIT_SHA",
  ]) ?? UNKNOWN;
  const expectedMainSha = firstValue(env, [
    "EXPECTED_GITHUB_MAIN_SHA",
    "GITHUB_MAIN_SHA",
    "SOURCE_MAIN_SHA",
  ]) ?? UNKNOWN;

  let syncState: DeploymentSyncState = "unknown";
  if (deployedGitSha !== UNKNOWN && expectedMainSha !== UNKNOWN) {
    syncState = revisionsMatch(deployedGitSha, expectedMainSha) ? "aligned" : "out_of_sync";
  }

  return {
    appName: firstValue(env, ["APP_NAME"]) ?? DEFAULT_APP_NAME,
    appVersion: firstValue(env, ["APP_VERSION", "npm_package_version"]) ?? UNKNOWN,
    deploymentEnvironment: firstValue(env, ["DEPLOYMENT_ENVIRONMENT", "DEPLOYMENT_ENV", "NODE_ENV"]) ?? UNKNOWN,
    sourceRepository: firstValue(env, ["SOURCE_REPOSITORY", "GITHUB_REPOSITORY"]) ?? DEFAULT_SOURCE_REPOSITORY,
    sourceBranch: firstValue(env, ["SOURCE_BRANCH", "GITHUB_REF_NAME"]) ?? DEFAULT_SOURCE_BRANCH,
    deployedGitSha,
    deployedGitShaShort: shortRevision(deployedGitSha),
    expectedMainSha,
    expectedMainShaShort: shortRevision(expectedMainSha),
    syncState,
    manusCheckpointId: firstValue(env, ["MANUS_CHECKPOINT_ID", "MANUS_CHECKPOINT", "DEPLOYMENT_CHECKPOINT_ID"]) ?? UNKNOWN,
    buildTimestamp: firstValue(env, ["BUILD_TIMESTAMP", "DEPLOYED_AT", "MANUS_BUILD_TIMESTAMP"]) ?? UNKNOWN,
    schemaVersion: firstValue(env, ["DATABASE_SCHEMA_VERSION", "DB_SCHEMA_VERSION", "SCHEMA_VERSION"]) ?? UNKNOWN,
    checkedAt: checkedAt.toISOString(),
  } as const;
}

export function buildPublicDeploymentHealth(
  env: EnvLike = process.env,
  checkedAt: Date = new Date(),
) {
  const provenance = buildDeploymentProvenance(env, checkedAt);
  return {
    ok: true,
    service: provenance.appName,
    version: provenance.appVersion,
    environment: provenance.deploymentEnvironment,
    deployedRevision: provenance.deployedGitShaShort,
    checkpoint: provenance.manusCheckpointId,
    buildTimestamp: provenance.buildTimestamp,
    schemaVersion: provenance.schemaVersion,
    checkedAt: provenance.checkedAt,
  } as const;
}

export function buildDeploymentDiagnostics(
  env: EnvLike = process.env,
  checkedAt: Date = new Date(),
) {
  const provenance = buildDeploymentProvenance(env, checkedAt);
  const missingMetadata: string[] = [];

  if (provenance.deployedGitSha === UNKNOWN) missingMetadata.push("DEPLOYED_GIT_SHA");
  if (provenance.expectedMainSha === UNKNOWN) missingMetadata.push("EXPECTED_GITHUB_MAIN_SHA");
  if (provenance.manusCheckpointId === UNKNOWN) missingMetadata.push("MANUS_CHECKPOINT_ID");
  if (provenance.buildTimestamp === UNKNOWN) missingMetadata.push("BUILD_TIMESTAMP");
  if (provenance.appVersion === UNKNOWN) missingMetadata.push("APP_VERSION");
  if (provenance.schemaVersion === UNKNOWN) missingMetadata.push("DATABASE_SCHEMA_VERSION");

  return {
    ok: true,
    provenance,
    configuration: {
      databaseConfigured: Boolean(clean(env.DATABASE_URL)),
      authenticationConfigured: Boolean(
        clean(env.OAUTH_SERVER_URL) && clean(env.VITE_APP_ID) && clean(env.JWT_SECRET),
      ),
      appSiteUrlConfigured: Boolean(clean(env.APP_SITE_URL)),
      requiredMetadataConfigured: missingMetadata.length === 0,
    },
    missingMetadata,
  } as const;
}
