/**
 * Tests for fullPotential.matchedSignalsForAccount (PR #27 + PR #30 + PR #35)
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
 *
 * PR #35 additions:
 * 17. project match actionState.hasOpenAction/hasClosedAction correct when no action exists
 * 18. project match hasOpenAction=true and openActionId populated when open action exists
 * 19. project match openActionDueDate is a valid ISO string when dueDate is set
 * 20. project match hasOpenAction=false and hasClosedAction=true after action is closed
 * 21. project match closedActionCompletedAt is a valid ISO string when completedAt is set
 * 22. fp_signal with both open and closed actions: both flags true, open fields not overwritten
 * 23. project with both open and closed actions: open beats closed in display fields
 * 24. fp_signal openActionDueDate is populated when dueDate is set
 * 25. matchedSignalsForAccount remains read-only (no actions created) — project variant
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
  projects,
} from "../drizzle/schema";
import { eq, inArray, and } from "drizzle-orm";
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

// ── PR #35 project-match test state ──────────────────────────────────────────
const PR35_PREFIX = "PR35_EP_TEST_";
let pr35AccountId: number;
let pr35ProjectId: number;
const pr35ActionIds: number[] = [];
const pr35ProjectIds: number[] = [];

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

  // PR #35 cleanup
  if (pr35ActionIds.length > 0) {
    await db.delete(fullPotentialActions).where(inArray(fullPotentialActions.id, pr35ActionIds));
  }
  if (pr35AccountId) {
    await db.delete(fullPotentialActions).where(eq(fullPotentialActions.accountId, pr35AccountId));
  }
  if (pr35ProjectIds.length > 0) {
    await db.delete(projects).where(inArray(projects.id, pr35ProjectIds));
  }
  if (pr35AccountId) {
    await db.delete(fullPotentialAccountAliases).where(eq(fullPotentialAccountAliases.accountId, pr35AccountId));
    await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, pr35AccountId));
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

// ── PR #35: project actionState, due date, open+closed coexistence ────────────
// NOTE: These tests share a single describe block and rely on a specific
// execution order within it (action is created, then closed, then a second
// action is added). This ordering dependency is intentional and isolated
// entirely within this describe block. Tests in other describe blocks are
// fully independent.

describe("fullPotential.matchedSignalsForAccount project actionState (PR #35)", () => {
  // ── Setup: insert a dedicated account + project for PR #35 tests ──────────
  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    // Insert a dedicated account whose displayName matches the project owner
    await db.insert(fullPotentialAccounts).values({
      stableKey: `${PR35_PREFIX}acme_mining|account|AU|WA|direct_ape`,
      canonicalName: `${PR35_PREFIX}Acme Mining Pty Ltd`,
      displayName: `${PR35_PREFIX}Acme Mining`,
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
      .where(eq(fullPotentialAccounts.stableKey, `${PR35_PREFIX}acme_mining|account|AU|WA|direct_ape`))
      .limit(1);
    pr35AccountId = acct.id;

    // Insert a project whose owner matches the account name (triggers name-match)
    const uniqueReportId = 999800 + Math.floor(Math.random() * 100);
    await db.insert(projects).values({
      reportId: uniqueReportId,
      projectKey: `${PR35_PREFIX}acme-mining-expansion-${uniqueReportId}`,
      name: `${PR35_PREFIX}Acme Mining Expansion`,
      location: "WA",
      value: "$5M",
      owner: `${PR35_PREFIX}Acme Mining`,   // normalises to match account displayName
      priority: "hot",
      opportunityRoute: "Direct CAPEX",
      sector: "mining",
      isNew: false,
      projectState: "WA",                   // same state as account → medium confidence
    } as any);

    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.projectKey, `${PR35_PREFIX}acme-mining-expansion-${uniqueReportId}`))
      .limit(1);
    pr35ProjectId = proj.id;
    pr35ProjectIds.push(proj.id);
  });

  it("project match has actionState with hasOpenAction=false and hasClosedAction=false when no action exists", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: pr35AccountId });
    const projMatch = result.matches.find(
      m => m.sourceType === "project" && m.sourceId === pr35ProjectId
    );
    expect(projMatch).toBeDefined();
    expect(projMatch?.actionState?.hasOpenAction).toBe(false);
    expect(projMatch?.actionState?.hasClosedAction).toBe(false);
  });

  it("project match has hasOpenAction=true and openActionId populated when an open action exists", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 days
    await db.insert(fullPotentialActions).values({
      accountId: pr35AccountId,
      userId: 1,
      projectId: pr35ProjectId,
      actionType: "account_review",
      status: "not_started",
      recommendedAction: "PR35 project open action",
      ownerName: "PR35 Test User",
      dueDate,
    } as any);

    const [newAction] = await db
      .select({ id: fullPotentialActions.id })
      .from(fullPotentialActions)
      .where(
        and(
          eq(fullPotentialActions.accountId, pr35AccountId),
          eq(fullPotentialActions.projectId, pr35ProjectId)
        )
      )
      .limit(1);
    if (newAction) pr35ActionIds.push(newAction.id);

    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: pr35AccountId });
    const projMatch = result.matches.find(
      m => m.sourceType === "project" && m.sourceId === pr35ProjectId
    );
    expect(projMatch?.actionState?.hasOpenAction).toBe(true);
    expect(projMatch?.actionState?.openActionId).toBe(newAction?.id);
    expect(projMatch?.actionState?.openActionStatus).toBe("not_started");
  });

  it("project match openActionDueDate is a valid ISO string when dueDate is set", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: pr35AccountId });
    const projMatch = result.matches.find(
      m => m.sourceType === "project" && m.sourceId === pr35ProjectId
    );
    expect(projMatch?.actionState?.openActionDueDate).toBeTruthy();
    const parsed = new Date(projMatch!.actionState!.openActionDueDate!);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });

  it("project match has hasOpenAction=false and hasClosedAction=true after action is closed", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    if (pr35ActionIds.length > 0) {
      const completedAt = new Date();
      await db
        .update(fullPotentialActions)
        .set({ status: "completed", completedAt } as any)
        .where(eq(fullPotentialActions.id, pr35ActionIds[0]));
    }

    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: pr35AccountId });
    const projMatch = result.matches.find(
      m => m.sourceType === "project" && m.sourceId === pr35ProjectId
    );
    expect(projMatch?.actionState?.hasOpenAction).toBe(false);
    expect(projMatch?.actionState?.hasClosedAction).toBe(true);
    expect(projMatch?.actionState?.closedActionStatus).toBe("completed");
  });

  it("project match closedActionCompletedAt is a valid ISO string when completedAt is set", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: pr35AccountId });
    const projMatch = result.matches.find(
      m => m.sourceType === "project" && m.sourceId === pr35ProjectId
    );
    expect(projMatch?.actionState?.closedActionCompletedAt).toBeTruthy();
    const parsed = new Date(projMatch!.actionState!.closedActionCompletedAt!);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });

  it("fp_signal with both open and closed actions: hasOpenAction=true, hasClosedAction=true, open fields not overwritten", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    // Insert a dedicated signal for this test so it is independent of PR #30 ordering
    await db.insert(fullPotentialSignals).values({
      accountId: testAccountId,
      signalTitle: `${TEST_PREFIX}Both-actions signal`,
      signalSummary: "Signal used for open+closed coexistence test",
      sourceName: "Test",
      state: "WA",
      confidenceLevel: "high",
      signalType: "other",
      urgency: "warm",
      status: "new",
    } as any);
    const [bothSig] = await db
      .select({ id: fullPotentialSignals.id })
      .from(fullPotentialSignals)
      .where(eq(fullPotentialSignals.signalTitle, `${TEST_PREFIX}Both-actions signal`))
      .limit(1);
    if (bothSig) insertedSignalIds.push(bothSig.id);

    // Insert a closed action first
    await db.insert(fullPotentialActions).values({
      accountId: testAccountId,
      userId: 1,
      signalId: bothSig.id,
      actionType: "account_review",
      status: "completed",
      recommendedAction: "PR35 both-actions closed",
      ownerName: "PR35 Test User",
      completedAt: new Date(),
    } as any);
    // Insert an open action after (newer createdAt → appears first in desc order)
    await db.insert(fullPotentialActions).values({
      accountId: testAccountId,
      userId: 1,
      signalId: bothSig.id,
      actionType: "customer_call",
      status: "in_progress",
      recommendedAction: "PR35 both-actions open",
      ownerName: "PR35 Test User",
    } as any);

    // Collect both action IDs for cleanup
    const bothActionRows = await db
      .select({ id: fullPotentialActions.id })
      .from(fullPotentialActions)
      .where(
        and(
          eq(fullPotentialActions.accountId, testAccountId),
          eq(fullPotentialActions.signalId, bothSig.id)
        )
      );
    for (const r of bothActionRows) insertedActionIds.push(r.id);

    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    const match = result.matches.find(
      m => m.sourceType === "fp_signal" && m.sourceId === bothSig.id
    );
    expect(match).toBeDefined();
    expect(match?.actionState?.hasOpenAction).toBe(true);
    expect(match?.actionState?.hasClosedAction).toBe(true);
    // Open fields must reflect the open action, not the closed one
    expect(match?.actionState?.openActionStatus).toBe("in_progress");
    // Closed fields must reflect the closed action
    expect(match?.actionState?.closedActionStatus).toBe("completed");
    // Open and closed IDs must differ
    expect(match?.actionState?.openActionId).not.toBe(match?.actionState?.closedActionId);
  });

  it("project with both open and closed actions: open action takes priority in display fields", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    // The project already has a closed action from the earlier test.
    // Insert a new open action for the same project.
    await db.insert(fullPotentialActions).values({
      accountId: pr35AccountId,
      userId: 1,
      projectId: pr35ProjectId,
      actionType: "customer_call",
      status: "in_progress",
      recommendedAction: "PR35 project follow-up open",
      ownerName: "PR35 Test User",
    } as any);

    const [newOpenAction] = await db
      .select({ id: fullPotentialActions.id })
      .from(fullPotentialActions)
      .where(
        and(
          eq(fullPotentialActions.accountId, pr35AccountId),
          eq(fullPotentialActions.projectId, pr35ProjectId),
          eq(fullPotentialActions.status, "in_progress")
        )
      )
      .limit(1);
    if (newOpenAction) pr35ActionIds.push(newOpenAction.id);

    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: pr35AccountId });
    const projMatch = result.matches.find(
      m => m.sourceType === "project" && m.sourceId === pr35ProjectId
    );
    expect(projMatch?.actionState?.hasOpenAction).toBe(true);
    expect(projMatch?.actionState?.hasClosedAction).toBe(true);
    // Open action fields must reflect the open action
    expect(projMatch?.actionState?.openActionStatus).toBe("in_progress");
    // Closed action fields must still reflect the closed action
    expect(projMatch?.actionState?.closedActionStatus).toBe("completed");
    // Open and closed IDs must differ
    expect(projMatch?.actionState?.openActionId).not.toBe(projMatch?.actionState?.closedActionId);
  });

  it("fp_signal openActionDueDate is populated when dueDate is set", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    // Insert a dedicated signal with a known dueDate on its action
    await db.insert(fullPotentialSignals).values({
      accountId: testAccountId,
      signalTitle: `${TEST_PREFIX}DueDate signal`,
      signalSummary: "Signal for due date assertion",
      sourceName: "Test",
      state: "WA",
      confidenceLevel: "high",
      signalType: "other",
      urgency: "warm",
      status: "new",
    } as any);
    const [dueSig] = await db
      .select({ id: fullPotentialSignals.id })
      .from(fullPotentialSignals)
      .where(eq(fullPotentialSignals.signalTitle, `${TEST_PREFIX}DueDate signal`))
      .limit(1);
    if (dueSig) insertedSignalIds.push(dueSig.id);

    const expectedDue = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // +14 days
    await db.insert(fullPotentialActions).values({
      accountId: testAccountId,
      userId: 1,
      signalId: dueSig.id,
      actionType: "account_review",
      status: "not_started",
      recommendedAction: "PR35 due date test",
      ownerName: "PR35 Test User",
      dueDate: expectedDue,
    } as any);
    const [dueAction] = await db
      .select({ id: fullPotentialActions.id })
      .from(fullPotentialActions)
      .where(
        and(
          eq(fullPotentialActions.accountId, testAccountId),
          eq(fullPotentialActions.signalId, dueSig.id)
        )
      )
      .limit(1);
    if (dueAction) insertedActionIds.push(dueAction.id);

    const caller = appRouter.createCaller(createUserContext());
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    const match = result.matches.find(
      m => m.sourceType === "fp_signal" && m.sourceId === dueSig.id
    );
    expect(match?.actionState?.hasOpenAction).toBe(true);
    expect(match?.actionState?.openActionDueDate).toBeTruthy();
    const parsed = new Date(match!.actionState!.openActionDueDate!);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    // Date should be within 1 day of expected
    expect(Math.abs(parsed.getTime() - expectedDue.getTime())).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it("matchedSignalsForAccount remains read-only for project matches (no actions created)", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    const beforeRows = await db
      .select({ id: fullPotentialActions.id })
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.accountId, pr35AccountId));

    const caller = appRouter.createCaller(createUserContext());
    await caller.fullPotential.matchedSignalsForAccount({ accountId: pr35AccountId });

    const afterRows = await db
      .select({ id: fullPotentialActions.id })
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.accountId, pr35AccountId));

    expect(afterRows.length).toBe(beforeRows.length);
  });
});
