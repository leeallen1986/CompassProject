import { describe, expect, it } from "vitest";
import {
  getExactHomeOutreachProjects,
  getExactLinkedProjects,
  hasActionableHomeOutreachTrust,
  isPositivePersistedId,
  resolveExactHomeOutreachSelection,
} from "./homeOutreachIdentity";

const projects = [
  { id: 10, name: "Alpha" },
  { id: 20, name: "Beta" },
  { id: 30, name: "Gamma" },
];

const sendReadyContact = {
  id: 7,
  email: "buyer@example.test",
  emailVerified: true,
  verificationStatus: "verified",
  contactTrustTier: "send_ready",
  rejectionReason: null,
  crmOrphan: false,
  linkedProjectIds: [10, 20],
  outreachEligibleProjectIds: [10, 20],
};

describe("Home outreach identity boundary", () => {
  it("resolves only exact returned project IDs", () => {
    expect(getExactHomeOutreachProjects(sendReadyContact, projects)).toEqual([
      projects[0],
      projects[1],
    ]);
  });

  it("requires an ID to appear in both the link and eligibility arrays", () => {
    const contact = {
      ...sendReadyContact,
      linkedProjectIds: [10, 20],
      outreachEligibleProjectIds: [20, 30],
    };

    expect(getExactHomeOutreachProjects(contact, projects)).toEqual([projects[1]]);
  });

  it("fails closed when exact link or eligibility fields are absent", () => {
    const { linkedProjectIds: _links, ...withoutLinks } = sendReadyContact;
    const { outreachEligibleProjectIds: _eligible, ...withoutEligibility } = sendReadyContact;

    expect(getExactHomeOutreachProjects(withoutLinks, projects)).toEqual([]);
    expect(getExactHomeOutreachProjects(withoutEligibility, projects)).toEqual([]);
  });

  it("fails closed for non-persisted IDs and incomplete trust data", () => {
    expect(getExactHomeOutreachProjects({ ...sendReadyContact, id: 0 }, projects)).toEqual([]);
    expect(getExactHomeOutreachProjects({ ...sendReadyContact, contactTrustTier: undefined }, projects)).toEqual([]);
    expect(getExactHomeOutreachProjects({ ...sendReadyContact, emailVerified: false }, projects)).toEqual([]);
    expect(getExactHomeOutreachProjects({ ...sendReadyContact, verificationStatus: "unverified" }, projects)).toEqual([]);
    expect(getExactHomeOutreachProjects({ ...sendReadyContact, rejectionReason: "rejected" }, projects)).toEqual([]);
    expect(getExactHomeOutreachProjects({ ...sendReadyContact, crmOrphan: true }, projects)).toEqual([]);
    expect(hasActionableHomeOutreachTrust({ ...sendReadyContact, crmOrphan: undefined })).toBe(false);
    expect(isPositivePersistedId(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });

  it("never turns unlinked legacy project text into an exact project", () => {
    const legacyOnly = {
      ...sendReadyContact,
      linkedProjectIds: undefined,
      outreachEligibleProjectIds: undefined,
      project: "Alpha",
      company: "Alpha owner",
    };

    expect(getExactHomeOutreachProjects(legacyOnly, projects)).toEqual([]);
    expect(getExactLinkedProjects(legacyOnly, projects)).toEqual([]);
  });

  it("re-resolves stored IDs and closes a selection when current trust is revoked", () => {
    const selection = { contactId: 7, projectId: 10 };
    expect(resolveExactHomeOutreachSelection(
      selection,
      [sendReadyContact],
      projects,
    )).toEqual({ contact: sendReadyContact, project: projects[0] });

    const revokedContact = {
      ...sendReadyContact,
      outreachEligibleProjectIds: [],
    };
    expect(resolveExactHomeOutreachSelection(
      selection,
      [revokedContact],
      projects,
    )).toBeNull();
  });
});
