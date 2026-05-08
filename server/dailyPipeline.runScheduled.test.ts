import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "admin@example.com",
    name: "Admin User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return ctx;
}

function createUserContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: "regular-user",
    email: "user@example.com",
    name: "Regular User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return ctx;
}

describe("dailyPipeline.runScheduled", () => {
  it("should launch the pipeline with triggeredBy='scheduled-task' for admin users", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.dailyPipeline.runScheduled();

    expect(result).toBeDefined();
    expect(result.launched).toBe(true);
    expect(result.triggeredBy).toBe("scheduled-task");
    expect(result.launchedAt).toBeDefined();
    expect(new Date(result.launchedAt).getTime()).toBeGreaterThan(0);
  });

  it("should have the same response structure as the regular run mutation", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const regularResult = await caller.dailyPipeline.run();
    const scheduledResult = await caller.dailyPipeline.runScheduled();

    // Both should have the same response structure
    expect(regularResult).toHaveProperty("launched");
    expect(regularResult).toHaveProperty("triggeredBy");
    expect(regularResult).toHaveProperty("launchedAt");

    expect(scheduledResult).toHaveProperty("launched");
    expect(scheduledResult).toHaveProperty("triggeredBy");
    expect(scheduledResult).toHaveProperty("launchedAt");

    // But triggeredBy should differ
    expect(regularResult.triggeredBy).not.toBe("scheduled-task");
    expect(scheduledResult.triggeredBy).toBe("scheduled-task");
  });

  it("should only be callable by admin users", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    // Should throw an error for non-admin users
    await expect(caller.dailyPipeline.runScheduled()).rejects.toThrow();
  });
});
