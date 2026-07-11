import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import {
  fullPotentialAccounts,
  fullPotentialAccountAliases,
  fullPotentialActions,
  fullPotentialSignals,
} from "../drizzle/schema";
import type { User } from "../drizzle/schema";

const TEST_USER_ID = 999944;
const PREFIX = "PR44QUEUE";
const ACCOUNT_A_KEY = `${PREFIX}alpha|account|AU|WA|direct_ape`;
const ACCOUNT_B_KEY = `${PREFIX}beta|account|AU|QLD|cea`;

let accountAId: number;
let accountBId: number;
let hotSignalId: number;
let reviewedSignalId: number;
let closedSignalId: number;

function createContext(role: "user" | "admin" = "user"): TrpcContext {
  const user: User = {
    id: TEST_USER_ID,
    openId: "pr44-signal-queue-user",
    name: "PR44 Queue User",
    email: "pr44-queue@example.com",
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

async function insertAccount(stableKey: string, canonicalName: string, routeToMarket: "direct_ape" | "cea") {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  await db.insert(fullPotentialAccounts).values({
    stableKey,
    canonicalName,
    displayName: canonicalName.replace(" Pty Ltd", ""),
    state: routeToMarket === "cea" ? "QLD" : "WA",
    segment: "Mining services",
    rowClass: "account",
    routeToMarket,
    ownerName: routeToMarket === "cea" ? "CEA" : "Ryan Pemberton",
    fpStatus: "active_target",
    priorityTier: "tier_a",
    platformPushDecision: "push_now",
    installedBaseStatus: "unknown",
    c4cStatus: "unknown",
    confidenceLevel: "unknown",
  } as any);

  const [row] = await db
    .select({ id: fullPotentialAccounts.id })
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.stableKey, stableKey))
    .limit(1);

  return row.id;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const staleAccounts = await db
    .select({ id: fullPotentialAccounts.id })
    .from(fullPotentialAccounts)
    .where(inArray(fullPotentialAccounts.stableKey, [ACCOUNT_A_KEY, ACCOUNT_B_KEY]));

  for (const account of staleAccounts) {
    await db.delete(fullPotentialActions).where(eq(fullPotentialActions.accountId, account.id));
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.accountId, account.id));
    await db.delete(fullPotentialAccountAliases).where(eq(fullPotentialAccountAliases.accountId, account.id));
    await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, account.id));
  }
  await db.delete(fullPotentialSignals).where(sql`${fullPotentialSignals.signalTitle} LIKE ${PREFIX + "%"}`);

  accountAId = await insertAccount(ACCOUNT_A_KEY, `${PREFIX} Alpha Mining Pty Ltd`, "direct_ape");
  accountBId = await insertAccount(ACCOUNT_B_KEY, `${PREFIX} Beta Rentals Pty Ltd`, "cea");

  await db.insert(fullPotentialSignals).values({
    accountId: accountAId,
    signalTitle: `${PREFIX} Hot drilling campaign`,
    signalSummary: "New drilling mobilisation creates large-air demand.",
    signalType: "drilling_campaign",
    sourceName: "PR44 Mining News",
    sourceUrl: "https://example.com/pr44-hot",
    signalDate: new Date("2026-07-01T00:00:00Z"),
    state: "WA",
    urgency: "hot",
    confidenceLevel: "high",
    suggestedAction: "Confirm mobilisation date.",
    status: "new",
  } as any);

  await db.insert(fullPotentialSignals).values({
    accountId: accountBId,
    signalTitle: `${PREFIX} Reviewed fleet refresh`,
    signalSummary: "Rental fleet replacement evidence.",
    signalType: "rental_fleet_signal",
    sourceName: "PR44 Rental Bulletin",
    signalDate: new Date("2026-06-15T00:00:00Z"),
    state: "QLD",
    urgency: "warm",
    confidenceLevel: "medium",
    suggestedAction: "Validate fleet age.",
    status: "reviewed",
  } as any);

  await db.insert(fullPotentialSignals).values({
    accountId: accountAId,
    signalTitle: `${PREFIX} Closed tender evidence`,
    signalType: "live_tender",
    sourceName: "PR44 Tender Portal",
    signalDate: new Date("2026-05-01T00:00:00Z"),
    state: "WA",
    urgency: "cold",
    confidenceLevel: "low",
    status: "promoted",
  } as any);

  await db.insert(fullPotentialSignals).values({
    accountId: null,
    signalTitle: `${PREFIX} Unlinked shutdown programme`,
    signalSummary: "The operating account has not yet been identified.",
    signalType: "shutdown_turnaround",
    sourceName: "PR44 Operations Bulletin",
    signalDate: new Date("2026-07-02T00:00:00Z"),
    state: "NSW",
    urgency: "warm",
    confidenceLevel: "medium",
    status: "new",
  } as any);

  const signalRows = await db
    .select({ id: fullPotentialSignals.id, title: fullPotentialSignals.signalTitle })
    .from(fullPotentialSignals)
    .where(sql`${fullPotentialSignals.signalTitle} LIKE ${PREFIX + "%"}`);

  hotSignalId = signalRows.find(row => row.title.includes("Hot drilling"))!.id;
  reviewedSignalId = signalRows.find(row => row.title.includes("Reviewed fleet"))!.id;
  closedSignalId = signalRows.find(row => row.title.includes("Closed tender"))!.id;

  await db.insert(fullPotentialActions).values({
    accountId: accountAId,
    signalId: hotSignalId,
    userId: TEST_USER_ID,
    ownerName: "Ryan Pemberton",
    actionType: "customer_call",
    recommendedAction: "Call the drilling contractor.",
    dueDate: new Date("2026-07-15T00:00:00Z"),
    status: "in_progress",
  } as any);

  await db.insert(fullPotentialActions).values({
    accountId: accountAId,
    signalId: closedSignalId,
    userId: TEST_USER_ID,
    ownerName: "Ryan Pemberton",
    actionType: "proposal_followup",
    recommendedAction: "Tender follow-up completed.",
    status: "completed",
    completedAt: new Date("2026-06-01T00:00:00Z"),
  } as any);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;

  for (const accountId of [accountAId, accountBId].filter(Boolean)) {
    await db.delete(fullPotentialActions).where(eq(fullPotentialActions.accountId, accountId));
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.accountId, accountId));
    await db.delete(fullPotentialAccountAliases).where(eq(fullPotentialAccountAliases.accountId, accountId));
  }
  await db.delete(fullPotentialSignals).where(sql`${fullPotentialSignals.signalTitle} LIKE ${PREFIX + "%"}`);
  for (const accountId of [accountAId, accountBId].filter(Boolean)) {
    await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, accountId));
  }
});

describe("fullPotential.listSignals — Signal Review Queue", () => {
  it("1. is available to a normal authenticated user and returns account context", async () => {
    const caller = appRouter.createCaller(createContext("user"));
    const result = await caller.fullPotential.listSignals({ search: PREFIX, limit: 50, offset: 0 });

    expect(result.total).toBe(4);
    const hot = result.signals.find((signal: any) => signal.id === hotSignalId);
    expect(hot).toBeDefined();
    expect(hot?.account?.id).toBe(accountAId);
    expect(hot?.account?.ownerName).toBe("Ryan Pemberton");
    expect(hot?.account?.routeToMarket).toBe("direct_ape");
    expect(hot?.account?.priorityTier).toBe("tier_a");
  });

  it("2. filters by status and urgency", async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.fullPotential.listSignals({
      search: PREFIX,
      status: "new",
      urgency: "hot",
      limit: 50,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.signals[0].id).toBe(hotSignalId);
  });

  it("3. filters linked and unlinked signals", async () => {
    const caller = appRouter.createCaller(createContext());
    const linked = await caller.fullPotential.listSignals({ search: PREFIX, linked: "linked", limit: 50, offset: 0 });
    const unlinked = await caller.fullPotential.listSignals({ search: PREFIX, linked: "unlinked", limit: 50, offset: 0 });

    expect(linked.total).toBe(3);
    expect(linked.signals.every((signal: any) => signal.accountId !== null)).toBe(true);
    expect(unlinked.total).toBe(1);
    expect(unlinked.signals[0].account).toBeNull();
  });

  it("4. returns open action state without N+1 action lookups", async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.fullPotential.listSignals({ search: PREFIX, actionState: "open", limit: 50, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.signals[0].id).toBe(hotSignalId);
    expect(result.signals[0].actionState.hasOpenAction).toBe(true);
    expect(result.signals[0].actionState.openActionStatus).toBe("in_progress");
  });

  it("5. returns closed action state", async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.fullPotential.listSignals({ search: PREFIX, actionState: "closed", limit: 50, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.signals[0].id).toBe(closedSignalId);
    expect(result.signals[0].actionState.hasClosedAction).toBe(true);
    expect(result.signals[0].actionState.closedActionStatus).toBe("completed");
  });

  it("6. filters signals with no action", async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.fullPotential.listSignals({ search: PREFIX, actionState: "none", limit: 50, offset: 0 });

    expect(result.total).toBe(2);
    expect(result.signals.some((signal: any) => signal.id === reviewedSignalId)).toBe(true);
    expect(result.signals.some((signal: any) => signal.accountId === null)).toBe(true);
  });

  it("7. searches account, source and signal content", async () => {
    const caller = appRouter.createCaller(createContext());
    const byAccount = await caller.fullPotential.listSignals({ search: "Beta Rentals", limit: 50, offset: 0 });
    const bySource = await caller.fullPotential.listSignals({ search: "Operations Bulletin", limit: 50, offset: 0 });

    expect(byAccount.total).toBe(1);
    expect(byAccount.signals[0].id).toBe(reviewedSignalId);
    expect(bySource.total).toBe(1);
    expect(bySource.signals[0].accountId).toBeNull();
  });

  it("8. paginates after filtering", async () => {
    const caller = appRouter.createCaller(createContext());
    const first = await caller.fullPotential.listSignals({ search: PREFIX, limit: 2, offset: 0 });
    const second = await caller.fullPotential.listSignals({ search: PREFIX, limit: 2, offset: 2 });

    expect(first.total).toBe(4);
    expect(first.signals).toHaveLength(2);
    expect(second.signals).toHaveLength(2);
    expect(new Set([...first.signals, ...second.signals].map((signal: any) => signal.id)).size).toBe(4);
  });

  it("9. supplies review summary and filter options", async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.fullPotential.listSignals({ search: PREFIX, limit: 50, offset: 0 });

    expect(result.summary.total).toBeGreaterThanOrEqual(4);
    expect(result.summary.hot).toBeGreaterThanOrEqual(1);
    expect(result.summary.unlinked).toBeGreaterThanOrEqual(1);
    expect(result.filterOptions.signalTypes).toContain("drilling_campaign");
    expect(result.filterOptions.states).toContain("WA");
  });

  it("10. remains read-only and creates no actions", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    const [{ before }] = await db
      .select({ before: sql<number>`COUNT(*)` })
      .from(fullPotentialActions)
      .where(and(inArray(fullPotentialActions.accountId, [accountAId, accountBId])));

    const caller = appRouter.createCaller(createContext());
    await caller.fullPotential.listSignals({ search: PREFIX, limit: 50, offset: 0 });

    const [{ after }] = await db
      .select({ after: sql<number>`COUNT(*)` })
      .from(fullPotentialActions)
      .where(and(inArray(fullPotentialActions.accountId, [accountAId, accountBId])));

    expect(Number(after)).toBe(Number(before));
  });
});
