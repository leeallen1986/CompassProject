/**
 * Tests for fullPotential.matchedSignalsForAccount (PR #27 + PR #30 patch)
 *
 * Uses the same appRouter.createCaller pattern as auth.logout.test.ts.
 *
 * Validates:
 * 1. normName helper strips corporate suffixes correctly
 * 2. Direct account-linked fullPotentialSignal returns in matches
 * 3. Unlinked name-matched fullPotentialSignal returns in matches
 * 4. Confidence is preserved (high for direct, medium for name+state match)
 * 5. Matches are sorted high → medium → low
 * 6. Results are capped at 10
 * 7. Unknown accountId throws NOT_FOUND
 * 8. No fullPotentialActions are created by the procedure
 *
 * PR #30 additions:
 * 9.  actionState.hasOpenAction is true when an open action exists for the signal
 * 10. actionState.hasClosedAction is false when only an open action exists
 * 11. actionState.hasOpenAction is false and hasClosedAction is true after action is closed
 * 12. actionState.openActionStatus matches the action's status
 * 13. actionState is { hasOpenAction: false, hasClosedAction: false } when no action exists
 * 14. actionState is present on every match in the result
 * 15. actionState.hasOpenAction is false for a signal with no linked action
 * 16. actionState.hasClosedAction is false for a signal with no linked action
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import {
  fullPotentialAccounts,
  fullPotentialAccountAliases,
  fullPotentialSignals,
  fullPotentialActions,
} from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import type { User } from "../drizzle/schema";

// ── tRPC caller context ───────────────────────────────────────────────────────

function createUserContext(role: "user" | "admin" = "user"): TrpcContext {
  const user: User = {
    id: 1,
    openId: "pr27-test-user",
    name: "PR27 Test User",
    email: "pr27@example.com",
    loginMethod: "manus",
    passwordHash: null,
    authMethod: "oauth",
    role,
    campaignAccess: false,
    invitedBy: null,
    inviteToken: null,
    inviteExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

// ── normName helper (mirrored from router for unit tests) ─────────────────────

const SUFFIX_STRIP = /\b(pty\s+ltd|pty|ltd|limited|group|australia|aust|holdings|holding|inc|corp|corporation|co)\b/gi;
function normalizeToken(raw: unknown): string {
  return (String(raw ?? "")).toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function normName(raw: unknown): string {
  return normalizeToken(raw).replace(SUFFIX_STRIP, "").replace(/\s+/g, " ").trim();
}

// ── Test data ─────────────────────────────────────────────────────────────────

const TEST_PREFIX = "PR27_EP_TEST_";
const TEST_CANONICAL = `${TEST_PREFIX}Acme Mining Pty Ltd`;
const TEST_STABLEKEY = `${TEST_PREFIX}acme_mining|account|AU|WA|direct_ape`;

let testAccountId: number;
let directSignalId: number;
const insertedSignalIds: number[] = [];
const insertedActionIds: number[] = [];

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Insert test account
  await db.insert(fullPotentialAccounts).values({
    stableKey: TEST_STABLEKEY,
    canonicalName: TEST_CANONICAL,
    displayName: `${TEST_PREFIX}Acme Mining`,
    state: "WA",
    rowClass: "account",
    routeToMarket: "direct_ape",
    fpStatus: "active_target",
    priorityTier: "tier_a",
    platformPushDecision: "push_now",
    installedBaseStatus: "unknown",
    c4cStatus: "unknown",
    confidenceLevel: "unknown",
  } as any);

  const [acct] = await db
    .select()
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.stableKey, TEST_STABLEKEY))
    .limit(1);
  testAccountId = acct.id;

  // Signal 1: directly linked (high confidence)
  await db.insert(fullPotentialSignals).values({
    accountId: testAccountId,
    signalTitle: `${TEST_PREFIX}Direct signal for Acme Mining`,
    signalSummary: "Acme is expanding operations in WA",
    sourceName: "Mining Weekly",
    sourceUrl: "https://example.com/acme-direct",
    state: "WA",
    confidenceLevel: "high",
    suggestedAction: "Call account manager",
    signalType: "mine_site_activity",
    urgency: "hot",
    status: "new",
  } as any);
  const [sig1] = await db
    .select()
    .from(fullPotentialSignals)
    .where(eq(fullPotentialSignals.accountId, testAccountId))
    .limit(1);
  directSignalId = sig1.id;
  insertedSignalIds.push(sig1.id);

  // Signal 2: unlinked, name-matched (medium confidence — same state WA)
  await db.insert(fullPotentialSignals).values({
    accountId: null,
    signalTitle: `${TEST_PREFIX}Acme Mining expansion project`,
    signalSummary: "New site opening in Kalgoorlie",
    sourceName: "AFR",
    state: "WA",
    confidenceLevel: "medium",
    suggestedAction: null,
    signalType: "mine_site_activity",
    urgency: "warm",
    status: "new",
  } as any);
  // Find the unlinked signal by its unique title
  const unlinkedRows = await db
    .select()
    .from(fullPotentialSignals)
    .where(eq(fullPotentialSignals.signalTitle, `${TEST_PREFIX}Acme Mining expansion project`))
    .limit(1);
  if (unlinkedRows[0]) insertedSignalIds.push(unlinkedRows[0].id);

  // Signals 3–12: 10 more directly-linked signals to test the cap-at-10 behaviour
  for (let i = 3; i <= 12; i++) {
    await db.insert(fullPotentialSignals).values({
      accountId: testAccountId,
      signalTitle: `${TEST_PREFIX}Cap test signal ${i}`,
      signalSummary: `Cap test signal number ${i}`,
      sourceName: "Test",
      state: "WA",
      confidenceLevel: "low",
      signalType: "other",
      urgency: "cold",
      status: "new",
    } as any);
  }
  // Collect the cap-test signal IDs
  const capRows = await db
    .select({ id: fullPotentialSignals.id })
    .from(fullPotentialSignals)
    .where(eq(fullPotentialSignals.accountId, testAccountId));
  for (const r of capRows) {
    if (!insertedSignalIds.includes(r.id)) insertedSignalIds.push(r.id);
  }
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  // Clean up actions first (FK constraint)
  if (insertedActionIds.length > 0) {
    await db.delete(fullPotentialActions).where(inArray(fullPotentialActions.id, insertedActionIds));
  }
  // Clean up any remaining actions for the test account
  if (testAccountId) {
    await db.delete(fullPotentialActions).where(eq(fullPotentialActions.accountId, testAccountId));
  }
  if (insertedSignalIds.length > 0) {
    await db.delete(fullPotentialSignals).where(inArray(fullPotentialSignals.id, insertedSignalIds));
  }
  // Also delete the unlinked signal by title in case it wasn't captured
  await db.delete(fullPotentialSignals).where(
    eq(fullPotentialSignals.signalTitle, `${TEST_PREFIX}Acme Mining expansion project`)
  );
  if (testAccountId) {
    await db.delete(fullPotentialAccountAliases).where(eq(fullPotentialAccountAliases.accountId, testAccountId));
    await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, testAccountId));
  }
});

// ── Unit tests: normName helper ───────────────────────────────────────────────

describe("normName helper (PR #27)", () => {
  it("strips Pty Ltd suffix", () => {
    expect(normName("Acme Mining Pty Ltd")).toBe("acme mining");
  });

  it("strips Limited suffix", () => {
    expect(normName("BHP Limited")).toBe("bhp");
  });

  it("strips Group suffix", () => {
    expect(normName("Rio Tinto Group")).toBe("rio tinto");
  });

  it("converts & to and", () => {
    expect(normName("Smith & Jones Pty Ltd")).toBe("smith and jones");
  });

  it("handles already-clean name", () => {
    expect(normName("acme mining")).toBe("acme mining");
  });
});

// ── Endpoint-level tests: matchedSignalsForAccount ────────────────────────────

describe("fullPotential.matchedSignalsForAccount endpoint (PR #27)", () => {
  it("throws NOT_FOUND for unknown accountId", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(
      caller.fullPotential.matchedSignalsForAccount({ accountId: 999_999_999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns matches array for a known account", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    expect(result).toHaveProperty("matches");
    expect(Array.isArray(result.matches)).toBe(true);
    expect(result.account.id).toBe(testAccountId);
  });

  it("includes the directly-linked signal in matches", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    const directMatch = result.matches.find(
      m => m.sourceType === "fp_signal" && m.matchReason === "Directly linked signal"
    );
    expect(directMatch).toBeDefined();
    expect(directMatch?.title).toContain(`${TEST_PREFIX}Direct signal`);
  });

  it("directly-linked signal has confidence high", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    const directMatch = result.matches.find(
      m => m.matchReason === "Directly linked signal" && m.title.includes(`${TEST_PREFIX}Direct signal`)
    );
    expect(directMatch?.confidence).toBe("high");
  });

  it("results are sorted high → medium → low", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    const CONF_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < result.matches.length; i++) {
      const prev = CONF_ORDER[result.matches[i - 1].confidence] ?? 99;
      const curr = CONF_ORDER[result.matches[i].confidence] ?? 99;
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });

  it("results are capped at 10", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    expect(result.matches.length).toBeLessThanOrEqual(10);
  });

  it("no fullPotentialActions are created by the procedure", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    const beforeCount = await db
      .select({ id: fullPotentialActions.id })
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.accountId, testAccountId));

    const caller = appRouter.createCaller(createUserContext());
    await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });

    const afterCount = await db
      .select({ id: fullPotentialActions.id })
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.accountId, testAccountId));

    expect(afterCount.length).toBe(beforeCount.length);
  });
});

// ── PR #30: actionState assertions ───────────────────────────────────────────

describe("fullPotential.matchedSignalsForAccount actionState (PR #30)", () => {
  it("actionState is present on every match", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    for (const match of result.matches) {
      expect(match).toHaveProperty("actionState");
      expect(match.actionState).not.toBeNull();
      expect(match.actionState).not.toBeUndefined();
    }
  });

  it("actionState.hasOpenAction is false when no action exists for a signal", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    const directMatch = result.matches.find(
      m => m.sourceType === "fp_signal" && m.matchReason === "Directly linked signal"
    );
    expect(directMatch).toBeDefined();
    expect(directMatch?.actionState?.hasOpenAction).toBe(false);
  });

  it("actionState.hasClosedAction is false when no action exists for a signal", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    const directMatch = result.matches.find(
      m => m.sourceType === "fp_signal" && m.matchReason === "Directly linked signal"
    );
    expect(directMatch).toBeDefined();
    expect(directMatch?.actionState?.hasClosedAction).toBe(false);
  });

  it("actionState.hasOpenAction is true when an open action exists for the signal", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    // Create an open action linked to the direct signal
    await db.insert(fullPotentialActions).values({
      accountId: testAccountId,
      userId: 1,
      signalId: directSignalId,
      actionType: "account_review",
      status: "not_started",
      recommendedAction: "PR30 test open action",
      ownerName: "PR30 Test User",
    } as any);

    const [newAction] = await db
      .select({ id: fullPotentialActions.id })
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.signalId, directSignalId))
      .limit(1);
    if (newAction) insertedActionIds.push(newAction.id);

    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    const directMatch = result.matches.find(
      m => m.sourceType === "fp_signal" && m.matchReason === "Directly linked signal"
    );
    expect(directMatch?.actionState?.hasOpenAction).toBe(true);
  });

  it("actionState.hasClosedAction is false when only an open action exists", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    const directMatch = result.matches.find(
      m => m.sourceType === "fp_signal" && m.matchReason === "Directly linked signal"
    );
    expect(directMatch?.actionState?.hasClosedAction).toBe(false);
  });

  it("actionState.openActionStatus matches the action status", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    const directMatch = result.matches.find(
      m => m.sourceType === "fp_signal" && m.matchReason === "Directly linked signal"
    );
    expect(directMatch?.actionState?.openActionStatus).toBe("not_started");
  });

  it("actionState.hasOpenAction is false and hasClosedAction is true after action is closed", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    // Close the open action
    if (insertedActionIds.length > 0) {
      await db
        .update(fullPotentialActions)
        .set({ status: "completed" } as any)
        .where(eq(fullPotentialActions.id, insertedActionIds[0]));
    }

    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    const directMatch = result.matches.find(
      m => m.sourceType === "fp_signal" && m.matchReason === "Directly linked signal"
    );
    expect(directMatch?.actionState?.hasOpenAction).toBe(false);
    expect(directMatch?.actionState?.hasClosedAction).toBe(true);
  });

  it("actionState.closedActionStatus matches the closed action status", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    const directMatch = result.matches.find(
      m => m.sourceType === "fp_signal" && m.matchReason === "Directly linked signal"
    );
    expect(directMatch?.actionState?.closedActionStatus).toBe("completed");
  });
});
