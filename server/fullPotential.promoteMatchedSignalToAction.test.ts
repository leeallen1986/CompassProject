/**
 * Tests for fullPotential.promoteMatchedSignalToAction (PR #28 patch)
 *
 * Uses the same appRouter.createCaller pattern as auth.logout.test.ts.
 *
 * Validates:
 *  1. Throws NOT_FOUND for unknown accountId
 *  2. Throws NOT_FOUND for unknown fp_signal sourceId
 *  3. Throws NOT_FOUND for unknown project sourceId
 *  4. Creates an action from a valid fp_signal (directly linked)
 *  5. Created action has signalId set and projectId null
 *  6. Created action has correct accountId, userId, and recommendedAction
 *  7. Creates an action from a valid project source (name-matched)
 *  8. Created project action has projectId set and signalId null
 *  9. Duplicate guard — throws BAD_REQUEST for same account+signal with OPEN action
 * 10. Duplicate guard — throws BAD_REQUEST for same account+project with OPEN action
 * 11. Closed-duplicate does NOT block — allows re-create after action is closed
 * 12. Source-match guard — throws BAD_REQUEST for signal linked to a different account
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import {
  fullPotentialAccounts,
  fullPotentialSignals,
  fullPotentialActions,
  projects,
} from "../drizzle/schema";
import { eq } from "drizzle-orm";
import type { User } from "../drizzle/schema";

// ── tRPC caller context ───────────────────────────────────────────────────────

const TEST_USER_ID = 999901;

function createUserContext(role: "user" | "admin" = "user"): TrpcContext {
  const user: User = {
    id: TEST_USER_ID,
    openId: "pr28-test-user",
    name: "PR28 Test User",
    email: "pr28@example.com",
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

// ── Test data ─────────────────────────────────────────────────────────────────

const TEST_PREFIX = "PR28_EP_TEST_";
const TEST_STABLEKEY = `${TEST_PREFIX}acme_mining|account|AU|WA|direct_ape`;
// Second account for source-match guard test (signal linked to this account, not the first)
const TEST_STABLEKEY_B = `${TEST_PREFIX}other_company|account|AU|WA|direct_ape`;

let testAccountId: number;
let testAccountIdB: number;
let testSignalId: number;        // directly linked to testAccountId
let testSignalIdOther: number;   // linked to testAccountIdB — used for source-match guard test
let testProjectId: number;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Insert test account A
  await db.insert(fullPotentialAccounts).values({
    stableKey: TEST_STABLEKEY,
    canonicalName: `${TEST_PREFIX}Acme Mining Pty Ltd`,
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
  const [acctA] = await db
    .select()
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.stableKey, TEST_STABLEKEY))
    .limit(1);
  testAccountId = acctA.id;

  // Insert test account B (for source-match guard)
  await db.insert(fullPotentialAccounts).values({
    stableKey: TEST_STABLEKEY_B,
    canonicalName: `${TEST_PREFIX}Other Company Pty Ltd`,
    displayName: `${TEST_PREFIX}Other Company`,
    state: "NSW",
    rowClass: "account",
    routeToMarket: "direct_ape",
    fpStatus: "active_target",
    priorityTier: "tier_b",
    platformPushDecision: "qualify_first",
    installedBaseStatus: "unknown",
    c4cStatus: "unknown",
    confidenceLevel: "unknown",
  } as any);
  const [acctB] = await db
    .select()
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.stableKey, TEST_STABLEKEY_B))
    .limit(1);
  testAccountIdB = acctB.id;

  // Insert test signal directly linked to account A
  await db.insert(fullPotentialSignals).values({
    accountId: testAccountId,
    signalTitle: `${TEST_PREFIX}Signal for promote test`,
    signalSummary: "Acme is expanding in WA",
    sourceName: "Mining Weekly",
    state: "WA",
    confidenceLevel: "high",
    suggestedAction: "Call account manager",
    signalType: "mine_site_activity",
    urgency: "hot",
    status: "new",
  } as any);
  const [sig] = await db
    .select()
    .from(fullPotentialSignals)
    .where(eq(fullPotentialSignals.signalTitle, `${TEST_PREFIX}Signal for promote test`))
    .limit(1);
  testSignalId = sig.id;

  // Insert a signal linked to account B (for source-match guard test on account A)
  await db.insert(fullPotentialSignals).values({
    accountId: testAccountIdB,
    signalTitle: `${TEST_PREFIX}Signal for other company`,
    signalSummary: "Other company signal",
    sourceName: "Mining Weekly",
    state: "NSW",
    confidenceLevel: "high",
    suggestedAction: "Review",
    signalType: "mine_site_activity",
    urgency: "warm",
    status: "new",
  } as any);
  const [sigOther] = await db
    .select()
    .from(fullPotentialSignals)
    .where(eq(fullPotentialSignals.signalTitle, `${TEST_PREFIX}Signal for other company`))
    .limit(1);
  testSignalIdOther = sigOther.id;

  // Insert test project (name-matched to account A via owner field)
  const uniqueReportId = 999900 + Math.floor(Math.random() * 100);
  await db.insert(projects).values({
    reportId: uniqueReportId,
    projectKey: `${TEST_PREFIX}acme-mining-expansion-${uniqueReportId}`,
    name: `${TEST_PREFIX}Acme Mining Expansion`,
    location: "WA",
    value: "$10M",
    owner: `${TEST_PREFIX}Acme Mining`,   // matches account A's displayName after normalisation
    priority: "hot",
    opportunityRoute: "Direct CAPEX",
    sector: "mining",
    isNew: false,
    stage: "Pre-FEED",
    overview: "Test project overview",
    projectState: "WA",                   // same state as account A → medium confidence match
  } as any);
  const [proj] = await db
    .select()
    .from(projects)
    .where(eq(projects.projectKey, `${TEST_PREFIX}acme-mining-expansion-${uniqueReportId}`))
    .limit(1);
  testProjectId = proj.id;
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(fullPotentialActions).where(eq(fullPotentialActions.accountId, testAccountId));
  await db.delete(fullPotentialActions).where(eq(fullPotentialActions.accountId, testAccountIdB));
  if (testSignalId) await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.id, testSignalId));
  if (testSignalIdOther) await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.id, testSignalIdOther));
  if (testProjectId) await db.delete(projects).where(eq(projects.id, testProjectId));
  if (testAccountId) await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, testAccountId));
  if (testAccountIdB) await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, testAccountIdB));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("fullPotential.promoteMatchedSignalToAction", () => {
  const caller = appRouter.createCaller(createUserContext("user"));

  it("1. throws NOT_FOUND for unknown accountId", async () => {
    await expect(
      caller.fullPotential.promoteMatchedSignalToAction({
        accountId: 99999999,
        sourceType: "fp_signal",
        sourceId: 1,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("2. throws NOT_FOUND for unknown fp_signal sourceId", async () => {
    await expect(
      caller.fullPotential.promoteMatchedSignalToAction({
        accountId: testAccountId,
        sourceType: "fp_signal",
        sourceId: 99999999,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("3. throws NOT_FOUND for unknown project sourceId", async () => {
    await expect(
      caller.fullPotential.promoteMatchedSignalToAction({
        accountId: testAccountId,
        sourceType: "project",
        sourceId: 99999999,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("4. creates an action from a valid fp_signal source (directly linked)", async () => {
    const result = await caller.fullPotential.promoteMatchedSignalToAction({
      accountId: testAccountId,
      sourceType: "fp_signal",
      sourceId: testSignalId,
      actionType: "account_review",
      recommendedAction: "Call account manager about WA expansion",
    });
    expect(result).toBeDefined();
  });

  it("5. created action has signalId set and projectId null", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const actions = await db
      .select()
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.accountId, testAccountId));
    const sigAction = actions.find(a => a.signalId === testSignalId);
    expect(sigAction).toBeDefined();
    expect(sigAction!.projectId).toBeNull();
  });

  it("6. created action has correct accountId, userId, and recommendedAction", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const actions = await db
      .select()
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.accountId, testAccountId));
    const sigAction = actions.find(a => a.signalId === testSignalId);
    expect(sigAction!.accountId).toBe(testAccountId);
    expect(sigAction!.userId).toBe(TEST_USER_ID);
    expect(sigAction!.recommendedAction).toBe("Call account manager about WA expansion");
  });

  it("7. creates an action from a valid project source (name-matched)", async () => {
    const result = await caller.fullPotential.promoteMatchedSignalToAction({
      accountId: testAccountId,
      sourceType: "project",
      sourceId: testProjectId,
      actionType: "account_review",
    });
    expect(result).toBeDefined();
  });

  it("8. created project action has projectId set and signalId null", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const actions = await db
      .select()
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.accountId, testAccountId));
    const projAction = actions.find(a => a.projectId === testProjectId);
    expect(projAction).toBeDefined();
    expect(projAction!.signalId).toBeNull();
  });

  it("9. duplicate guard — throws BAD_REQUEST for same account+signal with OPEN action", async () => {
    await expect(
      caller.fullPotential.promoteMatchedSignalToAction({
        accountId: testAccountId,
        sourceType: "fp_signal",
        sourceId: testSignalId,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("10. duplicate guard — throws BAD_REQUEST for same account+project with OPEN action", async () => {
    await expect(
      caller.fullPotential.promoteMatchedSignalToAction({
        accountId: testAccountId,
        sourceType: "project",
        sourceId: testProjectId,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("11. closed-duplicate does NOT block — allows re-create after action is closed", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    // Close the existing signal action
    const actions = await db
      .select()
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.accountId, testAccountId));
    const sigAction = actions.find(a => a.signalId === testSignalId);
    expect(sigAction).toBeDefined();
    await db
      .update(fullPotentialActions)
      .set({ status: "completed" })
      .where(eq(fullPotentialActions.id, sigAction!.id));

    // Now re-create — should succeed because the existing action is closed
    const result = await caller.fullPotential.promoteMatchedSignalToAction({
      accountId: testAccountId,
      sourceType: "fp_signal",
      sourceId: testSignalId,
      actionType: "account_review",
    });
    expect(result).toBeDefined();
  });

  it("12. source-match guard — throws BAD_REQUEST for signal linked to a different account", async () => {
    // testSignalIdOther is linked to testAccountIdB, not testAccountId
    await expect(
      caller.fullPotential.promoteMatchedSignalToAction({
        accountId: testAccountId,
        sourceType: "fp_signal",
        sourceId: testSignalIdOther,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
