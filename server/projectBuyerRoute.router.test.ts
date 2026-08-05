import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { ProjectBuyerRouteInputs } from "./projectBuyerRoute";

vi.mock("./db", async importOriginal => {
  const original = await importOriginal<typeof import("./db")>();
  return {
    ...original,
    getProjectBuyerRouteInputs: vi.fn(),
  };
});

import { getProjectBuyerRouteInputs } from "./db";
import { appRouter } from "./routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

const inputs: ProjectBuyerRouteInputs = {
  project: {
    id: 3_780_038,
    owner: "Water Corporation",
    contractors: [{ name: "Georgiou Group", status: "confirmed" }],
    sources: [{ label: "Project page", url: "https://example.test/project" }],
  },
  contacts: [],
  contractorLinks: [],
};

function context(authenticated = true): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "issue-86-test-user",
    email: "test@example.test",
    name: "Issue 86 Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user: authenticated ? user : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("projectLifecycle.buyerRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the exact project and returns the fail-closed projection", async () => {
    vi.mocked(getProjectBuyerRouteInputs).mockResolvedValue(inputs);
    const caller = appRouter.createCaller(context());

    const result = await caller.projectLifecycle.buyerRoute({
      projectId: 3_780_038,
    });

    expect(getProjectBuyerRouteInputs).toHaveBeenCalledOnce();
    expect(getProjectBuyerRouteInputs).toHaveBeenCalledWith(3_780_038);
    expect(result).toMatchObject({
      projectId: 3_780_038,
      principal: {
        organisation: "Water Corporation",
        evidenceState: "recorded_unverified",
      },
      likelyEquipmentBuyer: {
        organisation: null,
        evidenceState: "inferred",
      },
    });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid project ID %s before the loader",
    async projectId => {
      const caller = appRouter.createCaller(context());

      await expect(
        caller.projectLifecycle.buyerRoute({ projectId })
      ).rejects.toThrow();
      expect(getProjectBuyerRouteInputs).not.toHaveBeenCalled();
    }
  );

  it("rejects unknown input keys before the loader", async () => {
    const caller = appRouter.createCaller(context());

    await expect(
      caller.projectLifecycle.buyerRoute({
        projectId: 3_780_038,
        displayName: "must not be trusted",
      } as never)
    ).rejects.toThrow();
    expect(getProjectBuyerRouteInputs).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when no exact project record exists", async () => {
    vi.mocked(getProjectBuyerRouteInputs).mockResolvedValue(null);
    const caller = appRouter.createCaller(context());

    await expect(
      caller.projectLifecycle.buyerRoute({ projectId: 999_999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires authentication before loading evidence", async () => {
    const caller = appRouter.createCaller(context(false));

    await expect(
      caller.projectLifecycle.buyerRoute({ projectId: 3_780_038 })
    ).rejects.toThrow();
    expect(getProjectBuyerRouteInputs).not.toHaveBeenCalled();
  });
});
