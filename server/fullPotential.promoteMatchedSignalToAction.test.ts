/**
 * Tests for fullPotential.promoteMatchedSignalToAction (PR #28)
 *
 * Uses the same appRouter.createCaller pattern as auth.logout.test.ts.
 *
 * Validates:
 * 1. Throws NOT_FOUND for unknown accountId
 * 2. Throws NOT_FOUND for unknown fp_signal sourceId
 * 3. Throws NOT_FOUND for unknown project sourceId
 * 4. Creates an action from a valid fp_signal source
 * 5. Created action has signalId set and projectId null
 * 6. Created action has correct accountId and userId
 * 7. Creates an action from a valid project source
 * 8. Created action has projectId set and signalId null
 * 9. Duplicate guard — throws BAD_REQUEST for same account+signal with open action
 * 10. Duplicate guard — throws BAD_REQUEST for same account+project with open action
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
import { eq, like } from "drizzle-orm";
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

let testAccountId: number;
let testSignalId: number;
let testProjectId: number;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Insert test account
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
  const [acct] = await db
    .select()
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.stableKey, TEST_STABLEKEY))
    .limit(1);
  testAccountId = acct.id;

  // Insert test signal
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

  // Insert test project (use a unique reportId to avoid conflicts)
  const uniqueReportId = 999900 + Math.floor(Math.random() * 100);
  await db.insert(projects).values({
    reportId: uniqueReportId,
    projectKey: `${TEST_PREFIX}acme-mining-expansion-${uniqueReportId}`,
    name: `${TEST_PREFIX}Acme Mining Expansion`,
    location: "WA",
    value: "$10M",
    owner: `${TEST_PREFIX}Acme Mining`,
    priority: "hot",
    opportunityRoute: "Direct CAPEX",
    sector: "mining",
    isNew: false,
    stage: "Pre-FEED",
    overview: "Test project overview",
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
  // Clean up actions created during tests
  await db.delete(fullPotentialActions).where(eq(fullPotentialActions.accountId, testAccountId));
  // Clean up signal
  if (testSignalId) await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.id, testSignalId));
  // Clean up project
  if (testProjectId) await db.delete(projects).where(eq(projects.id, testProjectId));
  // Clean up account
  if (testAccountId) await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, testAccountId));
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

  it("4. creates an action from a valid fp_signal source", async () => {
    const result = await caller.fullPotential.promoteMatchedSignalToAction({
      accountId: testAccountId,
      sourceType: "fp_signal",
      sourceId: testSignalId,
      actionType: "account_review",
    });
    expect(result).toBeDefined();
  });

  it("5. created action has signalId set and projectId null", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [action] = await db
      .select()
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.accountId, testAccountId))
      .limit(1);
    expect(action.signalId).toBe(testSignalId);
    expect(action.projectId).toBeNull();
  });

  it("6. created action has correct accountId and userId", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [action] = await db
      .select()
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.accountId, testAccountId))
      .limit(1);
    expect(action.accountId).toBe(testAccountId);
    expect(action.userId).toBe(TEST_USER_ID);
  });

  it("7. creates an action from a valid project source", async () => {
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

  it("9. duplicate guard — throws BAD_REQUEST for same account+signal with open action", async () => {
    // The signal action was already created in test 4 and is still open
    await expect(
      caller.fullPotential.promoteMatchedSignalToAction({
        accountId: testAccountId,
        sourceType: "fp_signal",
        sourceId: testSignalId,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("10. duplicate guard — throws BAD_REQUEST for same account+project with open action", async () => {
    // The project action was already created in test 7 and is still open
    await expect(
      caller.fullPotential.promoteMatchedSignalToAction({
        accountId: testAccountId,
        sourceType: "project",
        sourceId: testProjectId,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
