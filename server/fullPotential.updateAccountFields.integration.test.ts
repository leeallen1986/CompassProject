import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { fullPotentialAccounts, fullPotentialActions } from "../drizzle/fullPotentialSchema";
import type { User } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { appRouter } from "./routers";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    openId: "fp-structural-edit-test",
    email: "admin@example.com",
    name: "Admin Test User",
    loginMethod: "manus",
    role: "admin",
    campaignAccess: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  } as User;
}

function makeCtx(user: User | null): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const TEST_KEY = `fp-structural-edit-${Date.now()}`;

describe("fullPotential.updateAccountFields structural edits through tRPC", () => {
  let accountId: number;
  let actionId: number;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    await db.insert(fullPotentialAccounts).values({
      stableKey: TEST_KEY,
      canonicalName: "Structural Edit Integration Test",
      rowClass: "channel_managed",
      routeToMarket: "direct_ape",
      ownerName: "Test Owner",
      channelOwner: null,
      fpStatus: "develop",
      priorityTier: "tier_b",
      platformPushDecision: "push_context",
      installedBaseStatus: "unknown",
      currentRevenueAud: "100.00",
      fullPotentialAud: "200.00",
      target2026Aud: "150.00",
      remainingPotentialAud: "100.00",
      c4cStatus: "prospect",
    } as any);

    const [account] = await db
      .select()
      .from(fullPotentialAccounts)
      .where(eq(fullPotentialAccounts.stableKey, TEST_KEY))
      .limit(1);
    accountId = account.id;

    await db.insert(fullPotentialActions).values({
      accountId,
      userId: 1,
      ownerName: "Admin Test User",
      actionType: "manager_review",
      recommendedAction: "Validate structural account classification",
      status: "not_started",
    } as any);

    const [action] = await db
      .select()
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.accountId, accountId))
      .limit(1);
    actionId = action.id;
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    await db.delete(fullPotentialActions).where(eq(fullPotentialActions.accountId, accountId));
    await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, accountId));
  });

  it("allows an admin to update rowClass and routeToMarket through the procedure", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser()));

    const updated = await caller.fullPotential.updateAccountFields({
      accountId,
      rowClass: "competitor_watch",
      routeToMarket: "manual_review",
    });

    expect(updated).toMatchObject({
      id: accountId,
      rowClass: "competitor_watch",
      routeToMarket: "manual_review",
    });
  });

  it("leaves omitted ownership, commercial, financial and C4C fields unchanged", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [before] = await db
      .select()
      .from(fullPotentialAccounts)
      .where(eq(fullPotentialAccounts.id, accountId))
      .limit(1);

    const caller = appRouter.createCaller(makeCtx(makeUser()));
    await caller.fullPotential.updateAccountFields({
      accountId,
      rowClass: "account",
    });

    const [after] = await db
      .select()
      .from(fullPotentialAccounts)
      .where(eq(fullPotentialAccounts.id, accountId))
      .limit(1);

    expect(after.rowClass).toBe("account");
    expect(after.routeToMarket).toBe(before.routeToMarket);
    expect(after.ownerName).toBe(before.ownerName);
    expect(after.channelOwner).toBe(before.channelOwner);
    expect(after.priorityTier).toBe(before.priorityTier);
    expect(after.currentRevenueAud).toBe(before.currentRevenueAud);
    expect(after.fullPotentialAud).toBe(before.fullPotentialAud);
    expect(after.target2026Aud).toBe(before.target2026Aud);
    expect(after.remainingPotentialAud).toBe(before.remainingPotentialAud);
    expect(after.c4cStatus).toBe(before.c4cStatus);
  });

  it("does not complete the linked action when resolveActionId is omitted", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser()));
    await caller.fullPotential.updateAccountFields({
      accountId,
      routeToMarket: "direct_ape",
    });

    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [action] = await db
      .select()
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.id, actionId))
      .limit(1);

    expect(action.status).toBe("not_started");
    expect(action.completedAt).toBeNull();
  });

  it("completes the linked action only when resolveActionId is explicitly supplied", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser()));
    await caller.fullPotential.updateAccountFields({
      accountId,
      rowClass: "competitor_watch",
      resolveActionId: actionId,
    });

    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [action] = await db
      .select()
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.id, actionId))
      .limit(1);

    expect(action.status).toBe("completed");
    expect(action.completedAt).not.toBeNull();
  });

  it("rejects structural edits from a non-admin caller", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "user" })));

    await expect(caller.fullPotential.updateAccountFields({
      accountId,
      rowClass: "account",
      routeToMarket: "direct_ape",
    })).rejects.toThrow();
  });
});
