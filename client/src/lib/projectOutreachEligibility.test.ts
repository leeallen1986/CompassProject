import { describe, expect, it } from "vitest";
import {
  isPositivePersistedId,
  isProjectOutreachEligible,
} from "./projectOutreachEligibility";

describe("project outreach eligibility", () => {
  it("accepts a positive persisted contact with an exact eligible-project projection", () => {
    expect(isProjectOutreachEligible({ id: 17, outreachEligibleProjectIds: [42] }, 42)).toBe(true);
  });

  it("does not infer actionability from raw display fields or a link alone", () => {
    const displayRowWithoutServerApproval = {
      id: 17,
      contactTrustTier: "send_ready",
      email: "verified@example.com",
      emailVerified: true,
      verificationStatus: "verified",
      linkedProjectIds: [42],
    };

    expect(isProjectOutreachEligible(displayRowWithoutServerApproval, 42)).toBe(false);
  });

  it.each([
    [undefined, 42],
    [null, 42],
    [{ outreachEligibleProjectIds: [42] }, 42],
    [{ id: 17 }, 42],
    [{ id: 17, outreachEligibleProjectIds: null }, 42],
    [{ id: 17, outreachEligibleProjectIds: [] }, 42],
    [{ id: 17, outreachEligibleProjectIds: [41] }, 42],
  ])("fails closed without the exact server projection", (contact, projectId) => {
    expect(isProjectOutreachEligible(contact, projectId)).toBe(false);
  });

  it.each([
    [{ id: 0, outreachEligibleProjectIds: [42] }, 42],
    [{ id: -1, outreachEligibleProjectIds: [42] }, 42],
    [{ id: 1.5, outreachEligibleProjectIds: [42] }, 42],
    [{ id: 17, outreachEligibleProjectIds: [42] }, 0],
    [{ id: 17, outreachEligibleProjectIds: [42] }, -1],
    [{ id: 17, outreachEligibleProjectIds: [42] }, 1.5],
  ])("rejects non-persisted contact or project IDs", (contact, projectId) => {
    expect(isProjectOutreachEligible(contact, projectId)).toBe(false);
  });

  it.each([1, Number.MAX_SAFE_INTEGER])("recognises a positive persisted ID: %s", value => {
    expect(isPositivePersistedId(value)).toBe(true);
  });

  it.each([undefined, null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1"])(
    "rejects an invalid persisted ID: %s",
    value => {
      expect(isPositivePersistedId(value)).toBe(false);
    },
  );
});
