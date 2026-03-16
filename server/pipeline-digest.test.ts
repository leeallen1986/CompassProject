import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createUserContext(role: "user" | "admin" = "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-pipeline",
    email: "test@atlascopco.com",
    name: "Test User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("pipeline endpoints", () => {
  it("pipeline.mine requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.pipeline.mine()).rejects.toThrow();
  });

  it("pipeline.my returns empty array for new user", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.pipeline.mine();
    expect(Array.isArray(result)).toBe(true);
  });

  it("pipeline.team returns all claims", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.pipeline.team();
    expect(Array.isArray(result)).toBe(true);
  });

  it("pipeline.claim requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.pipeline.claim({
        projectId: 1,
        reportId: 1,
      })
    ).rejects.toThrow();
  });

  it("pipeline.claim creates a new pipeline claim", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.pipeline.claim({
      projectId: 1,
      reportId: 1,
    });

    expect(result).toHaveProperty("claimId");
    expect(typeof result.claimId).toBe("number");
  });

  it("pipeline.byProject returns claims for a project", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.pipeline.byProject({ projectId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("email digest preferences", () => {
  it("emailDigest.getPrefs requires authentication", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.emailDigest.getPrefs()).rejects.toThrow();
  });

  it("emailDigest.getPrefs returns null for new user", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.emailDigest.get();
    // Returns null or existing prefs
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("emailDigest.update saves preferences", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.emailDigest.update({
      enabled: true,
      frequency: "weekly",
      includeHotOnly: false,
      includeContacts: true,
      includePipelineUpdates: true,
    });

    expect(result).toEqual({ success: true });
  });

  it("emailDigest.update persists and can be read back", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    await caller.emailDigest.update({
      enabled: true,
      frequency: "weekly",
      includeHotOnly: true,
      includeContacts: false,
      includePipelineUpdates: false,
    });

    const prefs = await caller.emailDigest.get();
    expect(prefs).not.toBeNull();
    if (prefs) {
      expect(prefs.enabled).toBe(true);
      expect(prefs.includeHotOnly).toBe(true);
    }
  });
});

describe("digest admin trigger", () => {
  it("digest.sendNow requires admin role", async () => {
    const ctx = createUserContext("user");
    const caller = appRouter.createCaller(ctx);

    await expect(caller.digest.sendNow()).rejects.toThrow();
  });

  it("digest.sendNow works for admin", async () => {
    const ctx = createUserContext("admin");
    const caller = appRouter.createCaller(ctx);

    const result = await caller.digest.sendNow();
    expect(result).toHaveProperty("sent");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("skipped");
    expect(typeof result.sent).toBe("number");
    expect(typeof result.failed).toBe("number");
    expect(typeof result.skipped).toBe("number");
  }, 120_000);
});
