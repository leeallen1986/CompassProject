import { describe, expect, it } from "vitest";
import {
  contactsExactlyLinkedToProject,
  isContactOutreachEligibleForProject,
  isThisWeekActionReady,
} from "./thisWeekContactSelection";

describe("Issue #86 This Week exact contact selection", () => {
  it("includes only contacts with an exact persisted project link", () => {
    const contacts = [
      { id: 1, company: "Water Corporation", linkedProjectIds: [3780038] },
      { id: 2, company: "Water Corporation", linkedProjectIds: [999] },
      { id: 3, company: "Water Corporation", linkedProjectIds: [] },
      { id: 4, company: "Water Corporation" },
    ];

    expect(contactsExactlyLinkedToProject(contacts, 3780038)).toEqual([
      contacts[0],
    ]);
  });

  it("requires both an exact link and the authoritative outreach projection", () => {
    const contact = {
      linkedProjectIds: [42],
      outreachEligibleProjectIds: [42],
    };
    expect(isContactOutreachEligibleForProject(contact, 42)).toBe(true);
    expect(isContactOutreachEligibleForProject({ ...contact, linkedProjectIds: [] }, 42)).toBe(false);
    expect(isContactOutreachEligibleForProject({ ...contact, outreachEligibleProjectIds: [] }, 42)).toBe(false);
    expect(isContactOutreachEligibleForProject(contact, Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });

  it("does not infer a link from a matching company or project name", () => {
    const contacts = [{
      id: 7,
      company: "Georgiou Group",
      project: "Goldfields and Agricultural Water Supply Scheme Upgrade",
      linkedProjectIds: [123],
    }];

    expect(contactsExactlyLinkedToProject(contacts, 3780038)).toEqual([]);
  });

  it("fails closed for invalid project IDs and malformed link IDs", () => {
    const contacts = [{ id: 1, linkedProjectIds: [0, -1, Number.NaN] }];
    expect(contactsExactlyLinkedToProject(contacts, 0)).toEqual([]);
    expect(contactsExactlyLinkedToProject(contacts, 3780038)).toEqual([]);
  });

  it("counts action-ready only from the authoritative contact CTA", () => {
    expect(isThisWeekActionReady({
      priority: "hot",
      contactCTA: { action: "view_best" },
    })).toBe(true);
    expect(isThisWeekActionReady({
      priority: "hot",
      contactCTA: { action: "find_contacts" },
    })).toBe(false);
    expect(isThisWeekActionReady({
      priority: "hot",
      contactCTA: { action: "validate_contacts" },
    })).toBe(false);
    expect(isThisWeekActionReady({
      priority: "cold",
      contactCTA: { action: "view_best" },
    })).toBe(false);
  });
});
