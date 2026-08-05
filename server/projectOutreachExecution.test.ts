import { beforeEach, describe, expect, it, vi } from "vitest";
const { resolveOutreachContext } = vi.hoisted(() => ({
  resolveOutreachContext: vi.fn(),
}));
vi.mock("./projectOutreachGuard", () => ({ resolveOutreachContext }));

import { executeGuardedProjectOutreach } from "./projectOutreachExecution";
import type { OutreachContext } from "./projectOutreachGuard";

const CONTEXT: OutreachContext = {
  contactId: 7,
  contactName: "Canonical Contact",
  contactTitle: "Manager",
  contactCompany: "Canonical Co",
  contactEmail: "canonical@example.com",
  contactRoleBucket: "manager",
  projectId: 70,
  projectName: "Canonical Project",
  projectLocation: "WA",
  projectValue: "Unknown",
  projectSector: "infrastructure",
  projectStage: null,
  projectOverview: null,
  equipmentSignals: null,
  opportunityRoute: "Direct CAPEX",
  matchedBusinessLines: [],
};

describe("executeGuardedProjectOutreach", () => {
  beforeEach(() => {
    resolveOutreachContext.mockReset();
  });

  it("does not invoke any downstream operation when the guard rejects", async () => {
    const failure = { code: "FORBIDDEN", message: "Validate first" };
    resolveOutreachContext.mockImplementation(() => {
      throw failure;
    });
    const operation = vi.fn();

    let caught: unknown;
    try {
      await executeGuardedProjectOutreach(
        { contactId: 7, projectId: 70 },
        operation,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(failure);

    expect(operation).not.toHaveBeenCalled();
  });

  it("passes only canonical resolved context to the operation", async () => {
    resolveOutreachContext.mockResolvedValue(CONTEXT);
    const operation = vi.fn().mockResolvedValue("done");

    await expect(executeGuardedProjectOutreach(
      {
        contactId: 7,
        projectId: 70,
        businessLineNames: { 1: "Portable Air" },
      },
      operation,
    )).resolves.toBe("done");

    expect(resolveOutreachContext).toHaveBeenCalledWith(7, 70, { 1: "Portable Air" });
    expect(operation).toHaveBeenCalledWith(CONTEXT);
  });
});
