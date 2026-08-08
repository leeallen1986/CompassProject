import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canPersistSendReady,
  resolvePersistedContactTrustTier,
  type PersistedSendReadyCandidate,
} from "./contactTrustPromotionBoundary";

const completeEvidence: PersistedSendReadyCandidate = {
  enrichmentSource: "apollo",
  email: "verified@example.com",
  emailVerified: true,
  verificationStatus: "verified",
  rejectionReason: null,
  crmOrphan: false,
  hasProjectLink: true,
};

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("persisted send-ready promotion boundary", () => {
  it("accepts only the complete canonical evidence shape", () => {
    expect(canPersistSendReady(completeEvidence)).toBe(true);
  });

  it("accepts database-style numeric booleans", () => {
    expect(canPersistSendReady({
      ...completeEvidence,
      emailVerified: 1,
      crmOrphan: 0,
    })).toBe(true);
  });

  it.each<[string, Partial<PersistedSendReadyCandidate>]>([
    ["unsupported provenance", { enrichmentSource: "crm" }],
    ["missing provenance", { enrichmentSource: null }],
    ["blank mailbox", { email: "   " }],
    ["unverified mailbox flag", { emailVerified: false }],
    ["unknown mailbox flag", { emailVerified: null }],
    ["contradictory verification status", { verificationStatus: "unverified" }],
    ["rejected identity", { rejectionReason: "wrong_company" }],
    ["CRM orphan", { crmOrphan: true }],
    ["unknown orphan state", { crmOrphan: null }],
    ["missing project link", { hasProjectLink: false }],
  ])("fails closed for %s", (_label, override) => {
    expect(canPersistSendReady({ ...completeEvidence, ...override })).toBe(false);
  });

  it("demotes unsupported normal writers but preserves the LLM quarantine", () => {
    const blocked = { ...completeEvidence, hasProjectLink: false };
    expect(resolvePersistedContactTrustTier(blocked, "send_ready")).toBe("named_unverified");
    expect(resolvePersistedContactTrustTier(blocked, "named_unverified")).toBe("named_unverified");
    expect(resolvePersistedContactTrustTier(blocked, "llm_inferred")).toBe("llm_inferred");
  });
});

describe("Issue #82 normal-writer inventory", () => {
  it("gates both Apollo persistence paths and links before promotion", () => {
    const apollo = source("server/apolloEnrichment.ts");

    expect(apollo.match(/resolvePersistedContactTrustTier\(/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
    expect(apollo).toContain('contactTrustTier: "named_unverified"');
    expect(apollo).toContain("await tx.insert(contactProjects).values");
    expect(apollo).toContain("await db.transaction(async tx =>");
    expect(apollo).toContain("isExplicitlyNotCrmOrphan(contact.crmOrphan)");
    expect(apollo).toContain("AND c.crmOrphan = 0");
    expect(apollo).not.toContain(
      'contactTrustTier: enrichedPerson.emailStatus === "verified" ? "send_ready" : "named_unverified"',
    );
    expect(apollo).not.toContain(
      'contactTrustTier: isVerified ? "send_ready" : contact.contactTrustTier',
    );
    expect(apollo).not.toContain("AND (c.crmOrphan IS NULL OR c.crmOrphan = 0)");
  });

  it("gates Hunter persistence on rejection, orphan and exact-link evidence", () => {
    const hunter = source("server/hunterVerification.ts");

    expect(hunter).toContain('from "./contactTrustPromotionBoundary"');
    expect(hunter).toContain(".from(contactProjects)");
    expect(hunter).toContain('reason: "rejected_contact_not_eligible"');
    expect(hunter).toContain('reason: "crm_orphan_not_eligible"');
    expect(hunter).toMatch(
      /reason:\s*projectId\s*\?\s*"contact_not_linked_to_project"\s*:\s*"contact_has_no_project_link"/s,
    );
    expect(hunter).toContain("resolvePersistedContactTrustTier({");
    expect(hunter).toContain("await db.transaction(async tx =>");
  });

  it("requires complete Lusha evidence instead of promoting on email presence", () => {
    const lusha = source("server/lushaEnrichment.ts");

    expect(lusha).toContain('from "./contactTrustPromotionBoundary"');
    expect(lusha).toContain("AND c.rejectionReason IS NULL");
    expect(lusha).toContain("AND c.crmOrphan = 0");
    expect(lusha).toContain("emailVerified: true");
    expect(lusha).toContain('verificationStatus: "verified"');
    expect(lusha).toContain("resolvePersistedContactTrustTier({");
    expect(lusha).toContain("await db.transaction(async tx =>");
    expect(lusha).not.toContain(
      'contactTrustTier: lushaResult.email ? "send_ready" : contact.contactTrustTier',
    );
  });

  it("blocks manual send-ready transitions unless the canonical boundary passes", () => {
    const router = source("server/routers/contactValidation.ts");

    expect(router).toContain('import { canPersistSendReady } from "../contactTrustPromotionBoundary"');
    expect(router).toContain("crmOrphan: contacts.crmOrphan");
    expect(router).toContain(".from(contactProjects)");
    expect(router).toContain("if (transition.newTier === \"send_ready\")");
    expect(router).toContain("send_ready requires an allowed source");
  });

  it("retains every fail-closed gate in the stale-tier pipeline backfill", () => {
    const backfill = source("server/contactEnrichment.ts");

    for (const gate of [
      "c.contactTrustTier = 'named_unverified'",
      "c.email IS NOT NULL",
      "TRIM(c.email) <> ''",
      "c.emailVerified = 1",
      "c.verificationStatus = 'verified'",
      "c.rejectionReason IS NULL",
      "c.crmOrphan = 0",
    ]) {
      expect(backfill).toContain(gate);
    }

    expect(backfill).toMatch(
      /AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+contactProjects\s+cp\s+WHERE\s+cp\.contactId\s*=\s*c\.id\s*\)/s,
    );
  });
});
