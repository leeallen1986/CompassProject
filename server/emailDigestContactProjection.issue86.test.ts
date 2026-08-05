import { describe, expect, it } from "vitest";
import { exactDigestContactsForProject } from "./emailDigest";

function sourceContact(overrides: Record<string, unknown>) {
  return {
    id: 1,
    name: "Recorded Contact",
    title: "Project Manager",
    company: "Recorded Employer",
    project: "A similarly named legacy project",
    priority: "hot",
    roleBucket: "project",
    email: "verified@example.test",
    roleRelevance: "high",
    linkedin: null,
    linkedinProfileUrl: "https://www.linkedin.com/in/recorded",
    enrichmentSource: "linkedin",
    verificationScore: 90,
    verificationStatus: "verified",
    emailVerified: true,
    contactTrustTier: "send_ready",
    rejectionReason: null,
    crmOrphan: false,
    linkedProjectIds: [42],
    outreachEligibleProjectIds: [42],
    ...overrides,
  };
}

describe("Issue #86 exact digest contact projection", () => {
  it("binds by exact project ID and ignores matching legacy project text", () => {
    const exact = sourceContact({ id: 1 });
    const fuzzyOnly = sourceContact({
      id: 2,
      project: "Target project",
      linkedProjectIds: [7],
      outreachEligibleProjectIds: [7],
    });

    const result = exactDigestContactsForProject(
      [exact, fuzzyOnly] as any,
      { id: 42, name: "Target project" },
    );

    expect(result.map(contact => contact.id)).toEqual([1]);
    expect(result[0].project).toBe("Target project");
  });

  it("withholds mailbox values unless the server projection authorises this link", () => {
    const staleReadyLabel = sourceContact({
      id: 3,
      outreachEligibleProjectIds: [],
    });
    const llm = sourceContact({
      id: 4,
      contactTrustTier: "llm_inferred",
      outreachEligibleProjectIds: [],
    });

    const result = exactDigestContactsForProject(
      [staleReadyLabel, llm] as any,
      { id: 42, name: "Target project" },
    );

    expect(result[0]).toMatchObject({
      email: null,
      contactTrustTier: "named_unverified",
    });
    expect(result[1]).toMatchObject({
      email: null,
      contactTrustTier: "llm_inferred",
    });
  });

  it("omits quarantined and CRM-orphan contacts even when an exact link exists", () => {
    const rejected = sourceContact({ id: 5, rejectionReason: "wrong_person" });
    const orphan = sourceContact({ id: 6, crmOrphan: true });
    const unknownOrphanState = sourceContact({ id: 7, crmOrphan: null });

    const result = exactDigestContactsForProject(
      [rejected, orphan, unknownOrphanState] as any,
      { id: 42, name: "Target project" },
    );

    expect(result).toEqual([]);
  });

  it("sanitises stored LinkedIn URLs before digest formatting", () => {
    const unsafe = sourceContact({
      linkedinProfileUrl: "javascript:alert(1)",
    });
    const credentialed = sourceContact({
      id: 2,
      linkedinProfileUrl: "https://user:secret@linkedin.com/in/example",
    });

    const result = exactDigestContactsForProject(
      [unsafe, credentialed] as any,
      { id: 42, name: "Target project" },
    );

    expect(result.map(contact => contact.linkedin)).toEqual([null, null]);
  });
});
