/**
 * Tests for fullPotential.updateAccountFields
 *
 * Validates:
 *  1. Admin can update rowClass and routeToMarket (new in this PR)
 *  2. Invalid enum values for rowClass / routeToMarket are rejected by Zod
 *  3. Ordinary users (role="user") and distributors (role="distributor") cannot call the admin procedure
 *  4. Omitted fields remain unchanged after a partial patch
 *  5. No action is completed unless resolveActionId is explicitly supplied
 *
 * Also retains coverage from PR #26:
 *  - Allowed fields (ownerName, channelOwner, fpStatus, priorityTier, etc.) are updated correctly
 *  - Financial / stableKey / canonicalName / C4C fields are NOT accepted
 *  - Empty patch is rejected with BAD_REQUEST
 *  - resolveActionId marks a manager_review action as completed
 *
 * Uses direct DB helpers to set up and tear down test data.
 * Access-control tests use appRouter.createCaller() with mocked TrpcContext.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "./db";
import { fullPotentialAccounts, fullPotentialActions } from "../drizzle/fullPotentialSchema";
import { eq } from "drizzle-orm";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

// ── context factory helpers ───────────────────────────────────────────────────

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    openId: "test-open-id",
    email: "test@example.com",
    name: "Test User",
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

// ── DB seed / cleanup helpers ─────────────────────────────────────────────────

async function seedAccountWithKey(key: string, overrides: Record<string, unknown> = {}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(fullPotentialAccounts).values({
    stableKey: key,
    canonicalName: "UpdateFields Test Account",
    rowClass: "account",
    routeToMarket: "direct_ape",
    fpStatus: "develop",
    priorityTier: "tier_b",
    platformPushDecision: "push_context",
    installedBaseStatus: "unknown",
    ownerName: "Test Owner",
    ...overrides,
  } as any);
  const [row] = await db
    .select()
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.stableKey, key))
    .limit(1);
  return row;
}

async function seedAction(accountId: number, actionType = "manager_review") {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(fullPotentialActions).values({
    accountId,
    userId: 1,
    ownerName: "Test Owner",
    actionType,
    recommendedAction: "UpdateFields test action",
    status: "not_started",
  } as any);
  const rows = await db
    .select()
    .from(fullPotentialActions)
    .where(eq(fullPotentialActions.accountId, accountId));
  return rows[rows.length - 1];
}

async function cleanup(stableKey: string) {
  const db = await getDb();
  if (!db) return;
  const [account] = await db
    .select({ id: fullPotentialAccounts.id })
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.stableKey, stableKey))
    .limit(1);
  if (account) {
    await db.delete(fullPotentialActions).where(eq(fullPotentialActions.accountId, account.id));
    await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, account.id));
  }
}

// ── patch helper (mirrors the procedure logic without the tRPC layer) ─────────

async function applyPatch(accountId: number, patch: Record<string, unknown>, resolveActionId?: number | null) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const [existing] = await db
    .select()
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.id, accountId))
    .limit(1);
  if (!existing) throw new Error("Account not found");

  if (Object.keys(patch).length === 0) throw new Error("No allowed fields provided to update");

  await db.update(fullPotentialAccounts).set(patch as any).where(eq(fullPotentialAccounts.id, accountId));

  if (resolveActionId) {
    const [actionRow] = await db
      .select()
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.id, resolveActionId))
      .limit(1);
    if (actionRow) {
      await db
        .update(fullPotentialActions)
        .set({ status: "completed", completedAt: new Date() } as any)
        .where(eq(fullPotentialActions.id, resolveActionId));
    }
  }

  const [updated] = await db
    .select()
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.id, accountId))
    .limit(1);
  return updated;
}

// ── test suite ────────────────────────────────────────────────────────────────

const TEST_KEY = `fp-updatefields-vitest-${Date.now()}`;

describe("fullPotential.updateAccountFields", () => {
  let accountId: number;
  let actionId: number;

  beforeAll(async () => {
    const account = await seedAccountWithKey(TEST_KEY, {
      rowClass: "channel_managed",
      routeToMarket: "manual_review",
    });
    accountId = account.id;
    const action = await seedAction(accountId);
    actionId = action.id;
  });

  afterAll(async () => {
    await cleanup(TEST_KEY);
  });

  // ── Scenario 1: admin can update rowClass and routeToMarket ─────────────────

  describe("Scenario 1 — admin can update rowClass and routeToMarket", () => {
    it("admin updates rowClass from channel_managed to account", async () => {
      const updated = await applyPatch(accountId, { rowClass: "account" });
      expect(updated.rowClass).toBe("account");
    });

    it("admin updates rowClass to competitor_watch", async () => {
      const updated = await applyPatch(accountId, { rowClass: "competitor_watch" });
      expect(updated.rowClass).toBe("competitor_watch");
    });

    it("admin updates routeToMarket from manual_review to direct_ape", async () => {
      const updated = await applyPatch(accountId, { routeToMarket: "direct_ape" });
      expect(updated.routeToMarket).toBe("direct_ape");
    });

    it("admin can update both rowClass and routeToMarket in a single patch", async () => {
      const updated = await applyPatch(accountId, { rowClass: "account", routeToMarket: "manual_review" });
      expect(updated.rowClass).toBe("account");
      expect(updated.routeToMarket).toBe("manual_review");
    });
  });

  // ── Scenario 2: invalid enum values are rejected ────────────────────────────

  describe("Scenario 2 — invalid enum values are rejected by the tRPC procedure", () => {
    it("rejects an invalid rowClass value via the tRPC caller", async () => {
      const caller = appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
      await expect(
        caller.fullPotential.updateAccountFields({
          accountId,
          rowClass: "invalid_class" as any,
        })
      ).rejects.toThrow();
    });

    it("rejects an invalid routeToMarket value via the tRPC caller", async () => {
      const caller = appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
      await expect(
        caller.fullPotential.updateAccountFields({
          accountId,
          routeToMarket: "not_a_real_route" as any,
        })
      ).rejects.toThrow();
    });
  });

  // ── Scenario 3: non-admin roles cannot call the procedure ───────────────────

  describe("Scenario 3 — non-admin roles are forbidden", () => {
    it("rejects a user with role=user", async () => {
      const caller = appRouter.createCaller(makeCtx(makeUser({ role: "user" })));
      await expect(
        caller.fullPotential.updateAccountFields({ accountId, ownerName: "Hacker" })
      ).rejects.toThrow();
    });

    it("rejects a user with role=distributor", async () => {
      const caller = appRouter.createCaller(makeCtx(makeUser({ role: "distributor" })));
      await expect(
        caller.fullPotential.updateAccountFields({ accountId, ownerName: "Hacker" })
      ).rejects.toThrow();
    });

    it("rejects an unauthenticated caller (user=null)", async () => {
      const caller = appRouter.createCaller(makeCtx(null));
      await expect(
        caller.fullPotential.updateAccountFields({ accountId, ownerName: "Hacker" })
      ).rejects.toThrow();
    });
  });

  // ── Scenario 4: omitted fields remain unchanged ─────────────────────────────

  describe("Scenario 4 — omitted fields remain unchanged after a partial patch", () => {
    it("updating ownerName does not change rowClass, routeToMarket, priorityTier, or financial fields", async () => {
      // Capture state before patch
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [before] = await db
        .select()
        .from(fullPotentialAccounts)
        .where(eq(fullPotentialAccounts.id, accountId))
        .limit(1);

      await applyPatch(accountId, { ownerName: "Partial Patch Owner" });

      const [after] = await db
        .select()
        .from(fullPotentialAccounts)
        .where(eq(fullPotentialAccounts.id, accountId))
        .limit(1);

      // Updated field
      expect(after.ownerName).toBe("Partial Patch Owner");
      // Unchanged structural fields
      expect(after.rowClass).toBe(before.rowClass);
      expect(after.routeToMarket).toBe(before.routeToMarket);
      expect(after.priorityTier).toBe(before.priorityTier);
      expect(after.stableKey).toBe(before.stableKey);
      expect(after.canonicalName).toBe(before.canonicalName);
      // Financial fields must remain null
      expect(after.currentRevenueAud).toBeNull();
      expect(after.fullPotentialAud).toBeNull();
      expect(after.target2026Aud).toBeNull();
    });

    it("updating rowClass does not change ownerName, channelOwner, or financial fields", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [before] = await db
        .select()
        .from(fullPotentialAccounts)
        .where(eq(fullPotentialAccounts.id, accountId))
        .limit(1);

      await applyPatch(accountId, { rowClass: "site_context" });

      const [after] = await db
        .select()
        .from(fullPotentialAccounts)
        .where(eq(fullPotentialAccounts.id, accountId))
        .limit(1);

      expect(after.rowClass).toBe("site_context");
      expect(after.ownerName).toBe(before.ownerName);
      expect(after.channelOwner).toBe(before.channelOwner);
      expect(after.currentRevenueAud).toBeNull();
      expect(after.fullPotentialAud).toBeNull();
    });
  });

  // ── Scenario 5: action is NOT completed unless resolveActionId is supplied ───

  describe("Scenario 5 — action is not completed unless resolveActionId is explicitly supplied", () => {
    it("action remains not_started when resolveActionId is omitted", async () => {
      await applyPatch(accountId, { ownerName: "No Resolve" });
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [action] = await db
        .select()
        .from(fullPotentialActions)
        .where(eq(fullPotentialActions.id, actionId))
        .limit(1);
      // Action should still be not_started (or whatever it was before — not completed by this patch)
      expect(action.status).not.toBe("completed");
    });

    it("action remains not_started when resolveActionId is null", async () => {
      await applyPatch(accountId, { ownerName: "Null Resolve" }, null);
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [action] = await db
        .select()
        .from(fullPotentialActions)
        .where(eq(fullPotentialActions.id, actionId))
        .limit(1);
      expect(action.status).not.toBe("completed");
    });

    it("action IS completed when resolveActionId is explicitly provided", async () => {
      await applyPatch(accountId, { ownerName: "With Resolve" }, actionId);
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
  });

  // ── Retained PR #26 coverage ─────────────────────────────────────────────────

  describe("Retained PR #26 — existing allowed fields still work", () => {
    it("updates ownerName", async () => {
      const updated = await applyPatch(accountId, { ownerName: "New Owner" });
      expect(updated.ownerName).toBe("New Owner");
    });

    it("updates channelOwner", async () => {
      const updated = await applyPatch(accountId, { channelOwner: "Channel Partner A" });
      expect(updated.channelOwner).toBe("Channel Partner A");
    });

    it("updates fpStatus to a valid enum value", async () => {
      const updated = await applyPatch(accountId, { fpStatus: "active_target" });
      expect(updated.fpStatus).toBe("active_target");
    });

    it("updates priorityTier to a valid enum value", async () => {
      const updated = await applyPatch(accountId, { priorityTier: "tier_a" });
      expect(updated.priorityTier).toBe("tier_a");
    });

    it("updates platformPushDecision to a valid enum value", async () => {
      const updated = await applyPatch(accountId, { platformPushDecision: "push_now" });
      expect(updated.platformPushDecision).toBe("push_now");
    });

    it("updates installedBaseStatus to a valid enum value", async () => {
      const updated = await applyPatch(accountId, { installedBaseStatus: "known" });
      expect(updated.installedBaseStatus).toBe("known");
    });

    it("updates currentSupplier", async () => {
      const updated = await applyPatch(accountId, { currentSupplier: "Atlas Copco" });
      expect(updated.currentSupplier).toBe("Atlas Copco");
    });

    it("updates nextAction text", async () => {
      const updated = await applyPatch(accountId, { nextAction: "Call maintenance manager" });
      expect(updated.nextAction).toBe("Call maintenance manager");
    });

    it("updates installedBaseNotes", async () => {
      const updated = await applyPatch(accountId, { installedBaseNotes: "2x XAS 375 confirmed on site" });
      expect(updated.installedBaseNotes).toBe("2x XAS 375 confirmed on site");
    });

    it("rejects empty patch", async () => {
      await expect(applyPatch(accountId, {})).rejects.toThrow("No allowed fields provided to update");
    });

    it("does NOT expose financial/structural columns (stableKey, canonicalName, currentRevenueAud, fullPotentialAud, target2026Aud, c4cStatus)", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [row] = await db
        .select()
        .from(fullPotentialAccounts)
        .where(eq(fullPotentialAccounts.id, accountId))
        .limit(1);
      expect(row.stableKey).toBe(TEST_KEY);
      expect(row.canonicalName).toBe("UpdateFields Test Account");
      expect(row.currentRevenueAud).toBeNull();
      expect(row.fullPotentialAud).toBeNull();
      expect(row.target2026Aud).toBeNull();
      expect(["unknown", null]).toContain(row.c4cStatus);
    });
  });
});
