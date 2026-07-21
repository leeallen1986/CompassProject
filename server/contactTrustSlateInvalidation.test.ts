import { describe, expect, it } from "vitest";
import {
  buildContactTrustSlateInvalidationPlan,
  type ContactTrustSlateRecord,
} from "./contactTrustSlateInvalidation";
import type { ContactTrustManifestRow } from "./contactTrustReconciliation.shared";

function manifestRow(contactId: number, linkProjectId: number | null = null): ContactTrustManifestRow {
  const before = {
    id: contactId,
    name: `Contact ${contactId}`,
    title: "Manager",
    company: "Example",
    legacyProjectText: "",
    email: "contact@example.com",
    emailVerified: true,
    contactTrustTier: "send_ready" as const,
    enrichmentSource: "apollo",
    verificationStatus: "verified",
    verifiedByUserId: null,
    verifiedAt: null,
    rejectionReason: null,
    linkedin: null,
    linkedinProfileUrl: null,
    verifiedLinkedinUrl: null,
    source: "scraper",
    crmOrphan: false,
    createdAt: "2026-07-21T00:00:00.000Z",
  };
  return {
    contactId,
    approved: true,
    disposition: linkProjectId ? "safe_link_to_project" : "safe_demote",
    reason: "test",
    reviewFlags: [],
    before,
    expectedAfter: {
      email: before.email,
      emailVerified: linkProjectId ? true : false,
      contactTrustTier: linkProjectId ? "send_ready" : "named_unverified",
      verificationStatus: linkProjectId ? "verified" : "unverified",
      linkProjectId,
      linkProjectName: linkProjectId ? `Project ${linkProjectId}` : null,
    },
    linkedProjectIds: [],
    exactProjectMatchIds: [],
    evidence: {
      exactHistoricGeneratedEmail: null,
      generatedEmailMatches: false,
      humanEmailVerified: false,
      humanContactAccepted: false,
      hunterValidForCurrentEmail: false,
      hunterAcceptAllPromotion: false,
      hunterAcceptAllOnly: false,
      laterHunterValidAfterAcceptAll: false,
      apolloVerifiedState: false,
      apolloPersonIds: [],
      strongEmailEvidence: false,
      rejectionEvidence: false,
      latestHunterStatus: null,
      latestHunterConfidence: null,
      evidenceReasons: [],
    },
    duplicates: {
      strongDuplicateGroupId: null,
      strongDuplicateContactIds: [],
      strongDuplicateKeys: [],
      recommendedSurvivorContactId: null,
      nameEmployerCandidateContactIds: [],
    },
    recordHash: "test",
  };
}

function slate(overrides: Partial<ContactTrustSlateRecord> = {}): ContactTrustSlateRecord {
  return {
    id: 1,
    projectId: 100,
    primaryContactId: null,
    backup1ContactId: null,
    backup2ContactId: null,
    commercialContactId: null,
    technicalContactId: null,
    primarySnapshot: null,
    backup1Snapshot: null,
    backup2Snapshot: null,
    commercialSnapshot: null,
    technicalSnapshot: null,
    isStale: false,
    ...overrides,
  };
}

describe("buildContactTrustSlateInvalidationPlan", () => {
  it("invalidates a fresh slate that directly references a selected contact", () => {
    const plan = buildContactTrustSlateInvalidationPlan(
      [slate({ id: 9, primaryContactId: 42 })],
      [manifestRow(42)],
    );
    expect(plan.matchedSlateIds).toEqual([9]);
    expect(plan.freshSlateIds).toEqual([9]);
    expect(plan.alreadyStaleSlateIds).toEqual([]);
  });

  it("checks every direct slot", () => {
    const rows = [
      slate({ id: 1, primaryContactId: 42 }),
      slate({ id: 2, backup1ContactId: 42 }),
      slate({ id: 3, backup2ContactId: 42 }),
      slate({ id: 4, commercialContactId: 42 }),
      slate({ id: 5, technicalContactId: 42 }),
    ];
    expect(buildContactTrustSlateInvalidationPlan(rows, [manifestRow(42)]).matchedSlateIds)
      .toEqual([1, 2, 3, 4, 5]);
  });

  it("also detects a contact stored in a slot snapshot", () => {
    const plan = buildContactTrustSlateInvalidationPlan(
      [slate({ id: 7, primarySnapshot: { contactId: 42 } })],
      [manifestRow(42)],
    );
    expect(plan.matchedSlateIds).toEqual([7]);
  });

  it("invalidates a project slate for a deterministic new project link", () => {
    const plan = buildContactTrustSlateInvalidationPlan(
      [slate({ id: 3, projectId: 555 })],
      [manifestRow(77, 555)],
    );
    expect(plan.linkProjectIds).toEqual([555]);
    expect(plan.matchedSlateIds).toEqual([3]);
  });

  it("does not invalidate unrelated slates", () => {
    const plan = buildContactTrustSlateInvalidationPlan(
      [slate({ id: 4, projectId: 100, primaryContactId: 8 })],
      [manifestRow(42)],
    );
    expect(plan.matchedSlateIds).toEqual([]);
  });

  it("separates fresh and already-stale slate IDs", () => {
    const plan = buildContactTrustSlateInvalidationPlan(
      [
        slate({ id: 8, primaryContactId: 42, isStale: false }),
        slate({ id: 9, backup1ContactId: 42, isStale: true }),
      ],
      [manifestRow(42)],
    );
    expect(plan.freshSlateIds).toEqual([8]);
    expect(plan.alreadyStaleSlateIds).toEqual([9]);
  });

  it("deduplicates and sorts selected contacts, projects, slates and matched projects", () => {
    const plan = buildContactTrustSlateInvalidationPlan(
      [
        slate({ id: 10, projectId: 300, primaryContactId: 42 }),
        slate({ id: 2, projectId: 100, backup1ContactId: 99 }),
      ],
      [manifestRow(99, 100), manifestRow(42), manifestRow(99, 100)],
    );
    expect(plan.selectedContactIds).toEqual([42, 99]);
    expect(plan.linkProjectIds).toEqual([100]);
    expect(plan.matchedSlateIds).toEqual([2, 10]);
    expect(plan.matchedProjectIds).toEqual([100, 300]);
  });

  it("returns an empty plan for no selected rows", () => {
    const plan = buildContactTrustSlateInvalidationPlan([slate({ primaryContactId: 42 })], []);
    expect(plan).toEqual({
      selectedContactIds: [],
      linkProjectIds: [],
      matchedSlateIds: [],
      freshSlateIds: [],
      alreadyStaleSlateIds: [],
      matchedProjectIds: [],
    });
  });
});
