import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTACT_TRUST_MANIFEST_VERSION,
  classifyContactTrustDisposition,
  deriveContactTrustEvidence,
  type ContactTrustContactSnapshot,
  type ContactTrustContext,
} from "./contactTrustReconciliation.shared";

function contact(overrides: Partial<ContactTrustContactSnapshot> = {}): ContactTrustContactSnapshot {
  return {
    id: 9001,
    name: "Jane Smith",
    title: "Procurement Manager",
    company: "Example Mining Group",
    legacyProjectText: "Example Mine",
    email: "jane.smith@examplemining.com.au",
    emailVerified: false,
    contactTrustTier: "send_ready",
    enrichmentSource: "web_search",
    verificationStatus: "unverified",
    verifiedByUserId: null,
    verifiedAt: null,
    rejectionReason: null,
    linkedin: null,
    linkedinProfileUrl: null,
    verifiedLinkedinUrl: null,
    source: "scraper",
    crmOrphan: false,
    createdAt: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

function classify(row: ContactTrustContactSnapshot) {
  const context: ContactTrustContext = {
    contact: row,
    linkedProjectIds: [101],
    exactProjectMatches: [],
    evidence: deriveContactTrustEvidence({ contact: row, hunterLogs: [], apolloLogs: [], validationActions: [] }),
    duplicates: {
      strongDuplicateGroupId: null,
      strongDuplicateContactIds: [],
      strongDuplicateKeys: [],
      recommendedSurvivorContactId: null,
      nameEmployerCandidateContactIds: [],
    },
  };
  return classifyContactTrustDisposition(context);
}

describe("PR69 contact reconciliation consistency", () => {
  it("invalidates every pre-PR69 manifest by bumping the schema version", () => {
    expect(CONTACT_TRUST_MANIFEST_VERSION).toBe(2);
  });

  it("preserves a suspected historic mailbox while reversibly demoting trust", () => {
    const row = contact();
    const result = classify(row);
    expect(result.disposition).toBe("safe_demote");
    expect(result.expectedAfter.email).toBe(row.email);
    expect(result.reviewFlags).toContain("historic_generated_email_fingerprint");
  });

  it("does not auto-clear a mailbox with conflicting persisted verification flags", () => {
    const result = classify(contact({ emailVerified: true, verificationStatus: "verified" }));
    expect(result.disposition).toBe("manual_review");
    expect(result.reviewFlags).toContain("historic_generated_email_verified_state_conflict");
  });

  it("atomically marks candidate slates stale when contact trust changes", () => {
    const source = readFileSync("server/contactTrustReconciliation.ts", "utf8");
    expect(source).toContain("contactCandidateSlates");
    expect(source).toContain("isStale: true");
    expect(source).toContain("staleSince: new Date()");
    expect(source).toContain("Affected contact candidate slates were not marked stale");
  });

  it("reports slate invalidation in apply output", () => {
    const cli = readFileSync("server/scripts/contactTrustReconcile.ts", "utf8");
    expect(cli).toContain("staleSlateCount: result.staleSlateCount");
    expect(cli).toContain("staleSlateIds: result.staleSlateIds");
  });
});
