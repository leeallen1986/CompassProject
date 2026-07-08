/**
 * Tests for fullPotential.list signal metadata (PR #42)
 *
 * Verifies that the account list endpoint returns correct direct-linked signal
 * metadata (signalCount, latestSignalTitle, latestSignalDate, latestSignalUrgency,
 * latestSignalStatus) using a single bulk query per page.
 *
 * Definition of "direct linked": fullPotentialSignals.accountId = fullPotentialAccounts.id
 * Unlinked/name-matched signals are intentionally excluded from the list view
 * and remain visible only via matchedSignalsForAccount (drawer-level).
 *
 * Test groups:
 *  1.  Account with no direct signals → signalCount=0, latestSignalTitle=null
 *  2.  Account with one direct signal → signalCount=1, title/urgency/status populated
 *  3.  Account with multiple direct signals → signalCount correct, latestSignalTitle is newest
 *  4.  Signals linked to another account are not counted
 *  5.  Unlinked signal with matching account name is NOT counted in list
 *  6a. Pagination: signal metadata correct for returned page accounts
 *  6b. Pagination: no crash when page has zero accounts
 *  7.  Filter (routeToMarket) still returns matching account with signal metadata
 *  8.  Import integration smoke: importSignals → list shows incremented signalCount
 *  9.  No action side effects: fullPotentialActions count unchanged after list
 *
 * Test hygiene:
 * - Prefix: PR42SIGNAL (no underscores — avoids normalizeToken() stripping)
 * - Stale fixtures deleted before insert in beforeAll
 * - Cleaned up in afterAll
 * - Delete actions/signals/aliases before accounts
 * - No reliance on real customer/workbook data
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as XLSX from "xlsx";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import {
  fullPotentialAccounts,
  fullPotentialSignals,
  fullPotentialActions,
  fullPotentialAccountAliases,
} from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import type { User } from "../drizzle/schema";

// ── Caller context ────────────────────────────────────────────────────────────

const TEST_USER_ID = 999942;

function createContext(role: "user" | "admin" = "admin"): TrpcContext {
  const user: User = {
    id: TEST_USER_ID,
    openId: "pr42-test-user",
    name: "PR42 Test User",
    email: "pr42@example.com",
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

// ── Test prefix / stable keys ─────────────────────────────────────────────────

const PR42 = "PR42SIGNAL";
const SK_NO_SIGNALS   = `${PR42}nosig|account|AU|WA|direct_ape`;
const SK_ONE_SIGNAL   = `${PR42}onesig|account|AU|WA|direct_ape`;
const SK_MULTI_SIGNAL = `${PR42}multisig|account|AU|QLD|direct_ape`;
const SK_OTHER        = `${PR42}other|account|AU|NSW|direct_ape`;
const SK_UNLINKED     = `${PR42}unlinked|account|AU|VIC|direct_ape`;

let idNoSignals: number;
let idOneSignal: number;
let idMultiSignal: number;
let idOther: number;
let idUnlinked: number;

// ── XLSX helper for importSignals smoke test ──────────────────────────────────

const IMPORT_HEADERS = [
  "signalTitle", "signalSummary", "signalType", "sourceName", "sourceUrl",
  "state", "signalDate", "confidenceLevel", "urgency", "suggestedAction",
  "status", "accountId", "stableKey", "accountName",
];

function buildXlsx(rows: (string | number | null)[][]): string {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Signals");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buf).toString("base64");
}

// ── Fixture setup ─────────────────────────────────────────────────────────────

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Delete stale fixtures in FK-safe order: actions → signals → aliases → accounts
  const staleKeys = [SK_NO_SIGNALS, SK_ONE_SIGNAL, SK_MULTI_SIGNAL, SK_OTHER, SK_UNLINKED];
  const staleAccounts = await db
    .select({ id: fullPotentialAccounts.id })
    .from(fullPotentialAccounts)
    .where(sql`${fullPotentialAccounts.stableKey} IN (${staleKeys.join(", ")})`);

  for (const acct of staleAccounts) {
    await db.delete(fullPotentialActions).where(eq(fullPotentialActions.accountId, acct.id));
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.accountId, acct.id));
    await db.delete(fullPotentialAccountAliases).where(eq(fullPotentialAccountAliases.accountId, acct.id));
    await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, acct.id));
  }

  // Also clean up any stale unlinked signals from this prefix
  await db.delete(fullPotentialSignals).where(
    sql`${fullPotentialSignals.signalTitle} LIKE ${PR42 + "%"}`
  );

  // Helper to insert an account and return its id
  async function insertAccount(stableKey: string, canonicalName: string, routeToMarket = "direct_ape"): Promise<number> {
    await db!.insert(fullPotentialAccounts).values({
      stableKey,
      canonicalName,
      displayName: canonicalName,
      state: "WA",
      rowClass: "account",
      routeToMarket,
      fpStatus: "active_target",
      priorityTier: "tier_a",
      platformPushDecision: "push_now",
      installedBaseStatus: "unknown",
      c4cStatus: "unknown",
      confidenceLevel: "unknown",
    } as any);
    const [row] = await db!
      .select({ id: fullPotentialAccounts.id })
      .from(fullPotentialAccounts)
      .where(eq(fullPotentialAccounts.stableKey, stableKey))
      .limit(1);
    return row.id;
  }

  idNoSignals   = await insertAccount(SK_NO_SIGNALS,   `${PR42}NoSig Corp`);
  idOneSignal   = await insertAccount(SK_ONE_SIGNAL,   `${PR42}OneSig Corp`);
  idMultiSignal = await insertAccount(SK_MULTI_SIGNAL, `${PR42}MultiSig Corp`, "cea");
  idOther       = await insertAccount(SK_OTHER,        `${PR42}Other Corp`);
  idUnlinked    = await insertAccount(SK_UNLINKED,     `${PR42}Unlinked Corp`);

  // Insert signals for idOneSignal: one direct linked signal
  await db.insert(fullPotentialSignals).values({
    accountId: idOneSignal,
    signalTitle: `${PR42} OneSig Hot Signal`,
    signalType: "mine_site_activity",
    urgency: "hot",
    status: "new",
    confidenceLevel: "high",
    signalDate: new Date("2025-06-01"),
  } as any);

  // Insert signals for idMultiSignal: three direct linked signals with different dates
  await db.insert(fullPotentialSignals).values({
    accountId: idMultiSignal,
    signalTitle: `${PR42} MultiSig Older Signal`,
    signalType: "mine_site_activity",
    urgency: "cold",
    status: "reviewed",
    confidenceLevel: "low",
    signalDate: new Date("2025-04-01"),
  } as any);
  await db.insert(fullPotentialSignals).values({
    accountId: idMultiSignal,
    signalTitle: `${PR42} MultiSig Newest Signal`,
    signalType: "awarded_project",
    urgency: "hot",
    status: "new",
    confidenceLevel: "high",
    signalDate: new Date("2025-07-01"),
  } as any);
  await db.insert(fullPotentialSignals).values({
    accountId: idMultiSignal,
    signalTitle: `${PR42} MultiSig Middle Signal`,
    signalType: "live_tender",
    urgency: "warm",
    status: "new",
    confidenceLevel: "medium",
    signalDate: new Date("2025-05-15"),
  } as any);

  // Insert a signal for idOther (should NOT appear on idNoSignals / idOneSignal)
  await db.insert(fullPotentialSignals).values({
    accountId: idOther,
    signalTitle: `${PR42} Other Account Signal`,
    signalType: "manual",
    urgency: "warm",
    status: "new",
    confidenceLevel: "medium",
    signalDate: new Date("2025-06-10"),
  } as any);

  // Insert an UNLINKED signal whose title contains the name of idUnlinked's account.
  // This should NOT be counted in the list endpoint (name-matched signals are drawer-level only).
  await db.insert(fullPotentialSignals).values({
    accountId: null,
    signalTitle: `${PR42}Unlinked Corp expansion project`,
    signalType: "manual",
    urgency: "warm",
    status: "new",
    confidenceLevel: "medium",
    signalDate: new Date("2025-06-15"),
  } as any);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;

  for (const id of [idNoSignals, idOneSignal, idMultiSignal, idOther, idUnlinked].filter(Boolean)) {
    await db.delete(fullPotentialActions).where(eq(fullPotentialActions.accountId, id));
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.accountId, id));
    await db.delete(fullPotentialAccountAliases).where(eq(fullPotentialAccountAliases.accountId, id));
  }
  // Clean up unlinked signals from this prefix
  await db.delete(fullPotentialSignals).where(
    sql`${fullPotentialSignals.signalTitle} LIKE ${PR42 + "%"}`
  );
  for (const id of [idNoSignals, idOneSignal, idMultiSignal, idOther, idUnlinked].filter(Boolean)) {
    await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, id));
  }
});

// ── Helper: find a specific account in list results ───────────────────────────

async function getAccountFromList(accountId: number, overrides: Record<string, unknown> = {}) {
  const caller = appRouter.createCaller(createContext("admin"));
  const result = await caller.fullPotential.list({
    limit: 500,
    offset: 0,
    ...overrides,
  });
  return result.accounts.find((a: any) => a.id === accountId) ?? null;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("fullPotential.list — signal metadata (PR #42)", () => {

  // ── Test 1: Account with no direct signals ──────────────────────────────────
  it("1. account with no direct signals has signalCount=0 and null latest fields", async () => {
    const account = await getAccountFromList(idNoSignals);
    expect(account).not.toBeNull();
    expect(account.signalCount).toBe(0);
    expect(account.latestSignalTitle).toBeNull();
    expect(account.latestSignalDate).toBeNull();
    expect(account.latestSignalUrgency).toBeNull();
    expect(account.latestSignalStatus).toBeNull();
  });

  // ── Test 2: Account with one direct signal ──────────────────────────────────
  it("2. account with one direct signal has signalCount=1 and populated latest fields", async () => {
    const account = await getAccountFromList(idOneSignal);
    expect(account).not.toBeNull();
    expect(account.signalCount).toBe(1);
    expect(account.latestSignalTitle).toBe(`${PR42} OneSig Hot Signal`);
    expect(account.latestSignalUrgency).toBe("hot");
    expect(account.latestSignalStatus).toBe("new");
    expect(account.latestSignalDate).toBe("2025-06-01");
  });

  // ── Test 3: Account with multiple direct signals ────────────────────────────
  it("3. account with multiple direct signals has correct count and latest is newest by signalDate", async () => {
    const account = await getAccountFromList(idMultiSignal);
    expect(account).not.toBeNull();
    expect(account.signalCount).toBe(3);
    // Latest should be the 2025-07-01 signal
    expect(account.latestSignalTitle).toBe(`${PR42} MultiSig Newest Signal`);
    expect(account.latestSignalDate).toBe("2025-07-01");
    expect(account.latestSignalUrgency).toBe("hot");
    expect(account.latestSignalStatus).toBe("new");
  });

  // ── Test 4: Signals linked to another account are not counted ───────────────
  it("4. signals linked to another account are not counted on unrelated accounts", async () => {
    const noSigAccount = await getAccountFromList(idNoSignals);
    expect(noSigAccount).not.toBeNull();
    // idOther has a signal, but idNoSignals should still be 0
    expect(noSigAccount.signalCount).toBe(0);
    expect(noSigAccount.latestSignalTitle).toBeNull();
  });

  // ── Test 5: Unlinked/name-matched signal not counted in list ────────────────
  it("5. unlinked signal with matching account name is NOT counted in list (name-match is drawer-level only)", async () => {
    // idUnlinked account has a signal whose title contains its name, but accountId is null.
    // The list endpoint must NOT count it — only direct accountId-linked signals are counted here.
    const account = await getAccountFromList(idUnlinked);
    expect(account).not.toBeNull();
    expect(account.signalCount).toBe(0);
    expect(account.latestSignalTitle).toBeNull();
    // Note: this unlinked signal IS visible via matchedSignalsForAccount (drawer-level),
    // but intentionally excluded from the list view to avoid expensive fuzzy matching.
  });

  // ── Test 6a: Pagination — signal metadata correct for page accounts ──────────
  it("6a. pagination: signal metadata is correct for returned page accounts", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    // Request a page of 1 starting at offset 0 — we just need the bulk query to work
    // for a subset of accounts without crashing or mixing up metadata.
    const result = await caller.fullPotential.list({ limit: 2, offset: 0 });
    expect(result.accounts).toBeDefined();
    expect(Array.isArray(result.accounts)).toBe(true);
    // Each account must have the signal metadata fields present
    for (const a of result.accounts) {
      expect(typeof a.signalCount).toBe("number");
      expect(a.signalCount).toBeGreaterThanOrEqual(0);
      // If signalCount > 0, latestSignalTitle must be a non-empty string
      if (a.signalCount > 0) {
        expect(typeof a.latestSignalTitle).toBe("string");
        expect((a.latestSignalTitle as string).length).toBeGreaterThan(0);
      } else {
        expect(a.latestSignalTitle === null || a.latestSignalTitle === undefined || a.latestSignalTitle === "").toBe(true);
      }
    }
  });

  // ── Test 6b: Pagination — no crash when page has zero accounts ──────────────
  it("6b. pagination: no crash when page offset exceeds total accounts", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.fullPotential.list({ limit: 100, offset: 999999 });
    expect(result.accounts).toBeDefined();
    expect(result.accounts).toHaveLength(0);
    expect(typeof result.total).toBe("number");
  });

  // ── Test 7: Existing filter still works with signal metadata attached ────────
  it("7. routeToMarket filter returns matching account with signal metadata attached", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    // idMultiSignal was inserted with routeToMarket = "cea"
    const result = await caller.fullPotential.list({
      routeToMarket: "cea",
      limit: 100,
      offset: 0,
    });
    const account = result.accounts.find((a: any) => a.id === idMultiSignal);
    expect(account).toBeDefined();
    expect(account!.signalCount).toBe(3);
    expect(account!.latestSignalTitle).toBe(`${PR42} MultiSig Newest Signal`);
  });

  // ── Test 8: Import integration smoke ────────────────────────────────────────
  it("8. importSignals (commit) then list shows incremented signalCount for that account", async () => {
    const caller = appRouter.createCaller(createContext("admin"));

    // Baseline: idNoSignals currently has 0 signals
    const before = await getAccountFromList(idNoSignals);
    expect(before!.signalCount).toBe(0);

    // Import one signal linked directly to idNoSignals via accountId column
    const fileBase64 = buildXlsx([
      IMPORT_HEADERS,
      [
        `${PR42} Smoke Test Signal`, // signalTitle
        "Smoke test summary",        // signalSummary
        "manual",                    // signalType
        "Test Source",               // sourceName
        null,                        // sourceUrl
        "WA",                        // state
        "2025-07-01",                // signalDate
        "high",                      // confidenceLevel
        "warm",                      // urgency
        null,                        // suggestedAction
        "new",                       // status
        idNoSignals,                 // accountId — direct link
        null,                        // stableKey
        null,                        // accountName
      ],
    ]);

    const importResult = await caller.fullPotential.importSignals({
      fileName: "smoke.xlsx",
      fileBase64,
      dryRun: false,
    });
    expect(importResult.createdSignals).toBeGreaterThanOrEqual(1);

    // After import: signalCount should be 1
    const after = await getAccountFromList(idNoSignals);
    expect(after!.signalCount).toBe(1);
    expect(after!.latestSignalTitle).toBe(`${PR42} Smoke Test Signal`);
    expect(after!.latestSignalUrgency).toBe("warm");
    expect(after!.latestSignalStatus).toBe("new");
  });

  // ── Test 9: No action side effects ──────────────────────────────────────────
  it("9. fullPotential.list does not create any fullPotentialActions", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    const countBefore = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(fullPotentialActions)
      .then(r => Number(r[0]?.count ?? 0));

    // Call list multiple times
    const caller = appRouter.createCaller(createContext("admin"));
    await caller.fullPotential.list({ limit: 50, offset: 0 });
    await caller.fullPotential.list({ limit: 50, offset: 0 });

    const countAfter = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(fullPotentialActions)
      .then(r => Number(r[0]?.count ?? 0));

    expect(countAfter).toBe(countBefore);
  });
});
