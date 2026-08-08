import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isEffectivelySendReady } from "./contactSlateTrustPolicy";

function contactEnrichmentSource(): string {
  return readFileSync(
    fileURLToPath(new URL("./contactEnrichment.ts", import.meta.url)),
    "utf8",
  );
}

describe("Issue #82 contact trust promotion regression", () => {
  it("keeps the Canary-3 evidence shape non-send-ready", () => {
    const canary = {
      contactTrustTier: "send_ready" as const,
      enrichmentSource: "linkedin",
      email: "person@example.com",
      emailVerified: false,
      verificationStatus: "unverified",
      rejectionReason: null,
    };

    expect(isEffectivelySendReady(canary)).toBe(false);
  });

  it("requires the complete verified evidence contract for effective send-ready", () => {
    const verified = {
      contactTrustTier: "send_ready" as const,
      enrichmentSource: "apollo",
      email: "person@example.com",
      emailVerified: true,
      verificationStatus: "verified",
      rejectionReason: null,
    };

    expect(isEffectivelySendReady(verified)).toBe(true);
    expect(isEffectivelySendReady({ ...verified, emailVerified: false })).toBe(false);
    expect(isEffectivelySendReady({ ...verified, verificationStatus: "unverified" })).toBe(false);
    expect(isEffectivelySendReady({ ...verified, rejectionReason: "rejected_by_rep" })).toBe(false);
    expect(isEffectivelySendReady({ ...verified, email: "  " })).toBe(false);
  });

  it("prevents stale-tier backfill from inferring verification from LinkedIn or email presence", () => {
    const source = contactEnrichmentSource();
    const functionStart = source.indexOf("export async function runStaleTierBackfill");
    expect(functionStart).toBeGreaterThan(-1);
    const implementation = source.slice(functionStart);

    expect(implementation).toContain("c.emailVerified = 1");
    expect(implementation).toContain("c.verificationStatus = 'verified'");
    expect(implementation).toContain("c.rejectionReason IS NULL");
    expect(implementation).toContain("c.crmOrphan = 0");
    expect(implementation).toContain("TRIM(c.email) <> ''");
    expect(implementation).toContain("FROM contactProjects cp");
    expect(implementation).toContain("cp.contactId = c.id");

    expect(implementation).not.toContain("linkedin_email_and_url");
    expect(implementation).not.toMatch(/enrichmentSource = 'linkedin'[\s\S]*linkedin IS NOT NULL/);
  });
});
