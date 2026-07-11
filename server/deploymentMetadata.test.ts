import { describe, expect, it } from "vitest";
import {
  buildDeploymentDiagnostics,
  buildDeploymentProvenance,
  buildPublicDeploymentHealth,
  revisionsMatch,
  shortRevision,
} from "./deploymentMetadata";

const NOW = new Date("2026-07-11T04:30:00.000Z");
const GITHUB_SHA = "6744311ea81b31c772103bf6bf4f1505d9321693";
const MANUS_SHA = "8749b37836cafc75e15fc4dbd6a1bdcced4f5aa4";

const COMPLETE_ENV = {
  APP_NAME: "atlas-copco-intelligence",
  APP_VERSION: "1.0.0",
  DEPLOYMENT_ENVIRONMENT: "production",
  SOURCE_REPOSITORY: "leeallen1986/CompassProject",
  SOURCE_BRANCH: "main",
  // Platform-controlled internal repository metadata.
  DEPLOYED_GIT_SHA: MANUS_SHA,
  EXPECTED_GITHUB_MAIN_SHA: MANUS_SHA,
  // Compass-controlled GitHub provenance metadata.
  COMPASS_GITHUB_SOURCE_SHA: GITHUB_SHA,
  COMPASS_EXPECTED_GITHUB_MAIN_SHA: GITHUB_SHA,
  MANUS_CHECKPOINT_ID: "26d5e2dc",
  BUILD_TIMESTAMP: "2026-07-11T04:15:00.000Z",
  DATABASE_SCHEMA_VERSION: "0088_daffy_thunderball",
  DATABASE_URL: "mysql://user:super-secret@gateway.example/db",
  OAUTH_SERVER_URL: "https://auth.example",
  VITE_APP_ID: "app-secret-id",
  JWT_SECRET: "jwt-super-secret",
  APP_SITE_URL: "https://compasspt.manus.space",
};

describe("deployment provenance", () => {
  it("reports GitHub aligned only from explicit Compass GitHub variables", () => {
    const result = buildDeploymentProvenance(COMPLETE_ENV, NOW);

    expect(result.githubSyncState).toBe("aligned");
    expect(result.githubSourceRevisionShort).toBe("6744311e");
    expect(result.githubExpectedRevisionShort).toBe("6744311e");
    expect(result.manusInternalRevisionShort).toBe("8749b378");
    expect(result.manusCheckpointId).toBe("26d5e2dc");
    expect(result.checkedAt).toBe(NOW.toISOString());
  });

  it("does not mistake matching platform-internal values for GitHub alignment", () => {
    const result = buildDeploymentProvenance({
      DEPLOYED_GIT_SHA: MANUS_SHA,
      EXPECTED_GITHUB_MAIN_SHA: MANUS_SHA,
    }, NOW);

    expect(result.manusInternalRevision).toBe(MANUS_SHA);
    expect(result.githubSourceRevision).toBe("unknown");
    expect(result.githubExpectedRevision).toBe("unknown");
    expect(result.githubSyncState).toBe("unknown");
  });

  it("accepts a 7+ character GitHub revision prefix as the same revision", () => {
    expect(revisionsMatch("6744311", GITHUB_SHA)).toBe(true);
    expect(revisionsMatch("abcdef0", GITHUB_SHA)).toBe(false);
  });

  it("reports out_of_sync when explicit GitHub revisions differ", () => {
    const result = buildDeploymentProvenance({
      ...COMPLETE_ENV,
      COMPASS_EXPECTED_GITHUB_MAIN_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }, NOW);

    expect(result.githubSyncState).toBe("out_of_sync");
  });

  it("reports unknown rather than guessing when GitHub metadata is incomplete", () => {
    const result = buildDeploymentProvenance({
      APP_VERSION: "1.0.0",
      COMPASS_GITHUB_SOURCE_SHA: GITHUB_SHA,
    }, NOW);

    expect(result.githubSyncState).toBe("unknown");
    expect(result.githubSourceRevision).toBe(GITHUB_SHA);
    expect(result.githubExpectedRevision).toBe("unknown");
    expect(shortRevision("unknown")).toBe("unknown");
  });

  it("supports provider aliases only for Manus runtime provenance", () => {
    const result = buildDeploymentProvenance({
      GITHUB_SHA: MANUS_SHA,
      MANUS_CHECKPOINT: "checkpoint-1",
      DEPLOYED_AT: COMPLETE_ENV.BUILD_TIMESTAMP,
      DB_SCHEMA_VERSION: COMPLETE_ENV.DATABASE_SCHEMA_VERSION,
      npm_package_version: "1.0.0",
    }, NOW);

    expect(result.manusInternalRevision).toBe(MANUS_SHA);
    expect(result.githubSyncState).toBe("unknown");
    expect(result.manusCheckpointId).toBe("checkpoint-1");
    expect(result.appVersion).toBe("1.0.0");
  });
});

describe("deployment health and diagnostics", () => {
  it("returns a safe public payload with unambiguous revision labels", () => {
    const result = buildPublicDeploymentHealth(COMPLETE_ENV, NOW);
    const serialized = JSON.stringify(result);

    expect(result.ok).toBe(true);
    expect(result.deployedRevision).toBe("8749b378");
    expect(result.deployedRevisionSource).toBe("manus_internal");
    expect(result.manusInternalRevision).toBe("8749b378");
    expect(result.githubSourceRevision).toBe("6744311e");
    expect(result.githubExpectedRevision).toBe("6744311e");
    expect(result.githubSyncState).toBe("aligned");
    expect(result.schemaVersion).toBe("0088_daffy_thunderball");
    expect(serialized).not.toContain(COMPLETE_ENV.DATABASE_URL);
    expect(serialized).not.toContain(COMPLETE_ENV.JWT_SECRET);
  });

  it("returns configuration booleans without exposing secret values", () => {
    const result = buildDeploymentDiagnostics(COMPLETE_ENV, NOW);
    const serialized = JSON.stringify(result);

    expect(result.configuration).toEqual({
      databaseConfigured: true,
      authenticationConfigured: true,
      appSiteUrlConfigured: true,
      manusRuntimeRevisionAvailable: true,
      githubProvenanceConfigured: true,
      requiredMetadataConfigured: true,
    });
    expect(result.missingMetadata).toEqual([]);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("app-secret-id");
  });

  it("lists the Compass-specific GitHub variables when provenance is missing", () => {
    const result = buildDeploymentDiagnostics({}, NOW);

    expect(result.configuration).toEqual({
      databaseConfigured: false,
      authenticationConfigured: false,
      appSiteUrlConfigured: false,
      manusRuntimeRevisionAvailable: false,
      githubProvenanceConfigured: false,
      requiredMetadataConfigured: false,
    });
    expect(result.missingMetadata).toEqual([
      "COMPASS_GITHUB_SOURCE_SHA",
      "COMPASS_EXPECTED_GITHUB_MAIN_SHA",
      "MANUS_CHECKPOINT_ID",
      "BUILD_TIMESTAMP",
      "APP_VERSION",
      "DATABASE_SCHEMA_VERSION",
    ]);
  });
});
