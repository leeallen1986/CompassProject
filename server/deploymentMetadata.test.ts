import { describe, expect, it } from "vitest";
import {
  buildDeploymentDiagnostics,
  buildDeploymentProvenance,
  buildPublicDeploymentHealth,
  revisionsMatch,
  shortRevision,
} from "./deploymentMetadata";

const NOW = new Date("2026-07-11T02:00:00.000Z");

const COMPLETE_ENV = {
  APP_NAME: "atlas-copco-intelligence",
  APP_VERSION: "1.0.0",
  DEPLOYMENT_ENVIRONMENT: "production",
  SOURCE_REPOSITORY: "leeallen1986/CompassProject",
  SOURCE_BRANCH: "main",
  DEPLOYED_GIT_SHA: "2351aa8228a9150b994043ec0bd782e799d9183a",
  EXPECTED_GITHUB_MAIN_SHA: "2351aa8228a9150b994043ec0bd782e799d9183a",
  MANUS_CHECKPOINT_ID: "cea238f9",
  BUILD_TIMESTAMP: "2026-07-11T01:45:00.000Z",
  DATABASE_SCHEMA_VERSION: "0088_daffy_thunderball",
  DATABASE_URL: "mysql://user:super-secret@gateway.example/db",
  OAUTH_SERVER_URL: "https://auth.example",
  VITE_APP_ID: "app-secret-id",
  JWT_SECRET: "jwt-super-secret",
  APP_SITE_URL: "https://compasspt.manus.space",
};

describe("deployment provenance", () => {
  it("reports aligned when deployed and expected revisions match", () => {
    const result = buildDeploymentProvenance(COMPLETE_ENV, NOW);

    expect(result.syncState).toBe("aligned");
    expect(result.deployedGitShaShort).toBe("2351aa82");
    expect(result.expectedMainShaShort).toBe("2351aa82");
    expect(result.manusCheckpointId).toBe("cea238f9");
    expect(result.checkedAt).toBe(NOW.toISOString());
  });

  it("accepts a 7+ character revision prefix as the same revision", () => {
    expect(revisionsMatch("2351aa8", COMPLETE_ENV.DEPLOYED_GIT_SHA)).toBe(true);
    expect(revisionsMatch("abcdef0", COMPLETE_ENV.DEPLOYED_GIT_SHA)).toBe(false);
  });

  it("reports out_of_sync when both revisions exist but differ", () => {
    const result = buildDeploymentProvenance({
      ...COMPLETE_ENV,
      EXPECTED_GITHUB_MAIN_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }, NOW);

    expect(result.syncState).toBe("out_of_sync");
  });

  it("reports unknown rather than guessing when revision metadata is incomplete", () => {
    const result = buildDeploymentProvenance({ APP_VERSION: "1.0.0" }, NOW);

    expect(result.syncState).toBe("unknown");
    expect(result.deployedGitSha).toBe("unknown");
    expect(result.expectedMainSha).toBe("unknown");
    expect(shortRevision("unknown")).toBe("unknown");
  });

  it("supports common deployment-provider revision aliases", () => {
    const result = buildDeploymentProvenance({
      GITHUB_SHA: COMPLETE_ENV.DEPLOYED_GIT_SHA,
      GITHUB_MAIN_SHA: COMPLETE_ENV.EXPECTED_GITHUB_MAIN_SHA,
      MANUS_CHECKPOINT: "checkpoint-1",
      DEPLOYED_AT: COMPLETE_ENV.BUILD_TIMESTAMP,
      DB_SCHEMA_VERSION: COMPLETE_ENV.DATABASE_SCHEMA_VERSION,
      npm_package_version: "1.0.0",
    }, NOW);

    expect(result.syncState).toBe("aligned");
    expect(result.manusCheckpointId).toBe("checkpoint-1");
    expect(result.appVersion).toBe("1.0.0");
  });
});

describe("deployment health and diagnostics", () => {
  it("returns a safe public health payload", () => {
    const result = buildPublicDeploymentHealth(COMPLETE_ENV, NOW);
    const serialized = JSON.stringify(result);

    expect(result.ok).toBe(true);
    expect(result.deployedRevision).toBe("2351aa82");
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
      requiredMetadataConfigured: true,
    });
    expect(result.missingMetadata).toEqual([]);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("app-secret-id");
  });

  it("lists missing provenance fields and never treats absent configuration as healthy", () => {
    const result = buildDeploymentDiagnostics({}, NOW);

    expect(result.configuration).toEqual({
      databaseConfigured: false,
      authenticationConfigured: false,
      appSiteUrlConfigured: false,
      requiredMetadataConfigured: false,
    });
    expect(result.missingMetadata).toEqual([
      "DEPLOYED_GIT_SHA",
      "EXPECTED_GITHUB_MAIN_SHA",
      "MANUS_CHECKPOINT_ID",
      "BUILD_TIMESTAMP",
      "APP_VERSION",
      "DATABASE_SCHEMA_VERSION",
    ]);
  });
});
