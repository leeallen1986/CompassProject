import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createUserContext(role: "user" | "admin" = "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-digest",
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

describe("compulsory email digest system", () => {
  // These tests hit real DB + notification API, need longer timeout
  const DIGEST_TIMEOUT = 30_000;
  describe("Monday weekly digest", () => {
    it("digest.sendNow requires admin role", async () => {
      const ctx = createUserContext("user");
      const caller = appRouter.createCaller(ctx);
      await expect(caller.digest.sendNow()).rejects.toThrow();
    });

    it("digest.sendNow works for admin and returns correct shape", async () => {
      const ctx = createUserContext("admin");
      const caller = appRouter.createCaller(ctx);
      const result = await caller.digest.sendNow();
      expect(result).toHaveProperty("sent");
      expect(result).toHaveProperty("failed");
      expect(result).toHaveProperty("skipped");
      expect(result).toHaveProperty("alreadySent");
      expect(typeof result.sent).toBe("number");
      expect(typeof result.failed).toBe("number");
      expect(typeof result.skipped).toBe("number");
      expect(typeof result.alreadySent).toBe("number");
      expect(result.sent).toBeGreaterThanOrEqual(0);
      expect(result.failed).toBeGreaterThanOrEqual(0);
      expect(result.skipped).toBeGreaterThanOrEqual(0);
    }, DIGEST_TIMEOUT);
  });

  describe("Thursday mid-week reminder", () => {
    it("digest.sendThursdayReminder requires admin role", async () => {
      const ctx = createUserContext("user");
      const caller = appRouter.createCaller(ctx);
      await expect(caller.digest.sendThursdayReminder()).rejects.toThrow();
    });

    it("digest.sendThursdayReminder works for admin and returns correct shape", async () => {
      const ctx = createUserContext("admin");
      const caller = appRouter.createCaller(ctx);
      const result = await caller.digest.sendThursdayReminder();
      expect(result).toHaveProperty("sent");
      expect(result).toHaveProperty("failed");
      expect(result).toHaveProperty("skipped");
      expect(typeof result.sent).toBe("number");
      expect(typeof result.failed).toBe("number");
      expect(typeof result.skipped).toBe("number");
      expect(result.sent).toBeGreaterThanOrEqual(0);
      expect(result.failed).toBeGreaterThanOrEqual(0);
      expect(result.skipped).toBeGreaterThanOrEqual(0);
    }, DIGEST_TIMEOUT);
  });

  describe("unauthenticated access", () => {
    it("digest.sendNow rejects unauthenticated users", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);
      await expect(caller.digest.sendNow()).rejects.toThrow();
    });

    it("digest.sendThursdayReminder rejects unauthenticated users", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);
      await expect(caller.digest.sendThursdayReminder()).rejects.toThrow();
    });
  });
});
