/**
 * Tests for fullPotential.importSignals (PR #39)
 *
 * Uses the appRouter.createCaller pattern.
 *
 * Test groups:
 *  1.  Admin-only: admin can call importSignals
 *  2.  Admin-only: non-admin gets FORBIDDEN
 *  3.  Dry-run: valid file dry-run returns parsed/valid counts
 *  4.  Dry-run: dry-run writes zero fullPotentialSignals
 *  5.  Commit linked by accountId: inserts row with accountId populated
 *  6.  Commit linked by stableKey: resolves accountId from stableKey
 *  7.  Unlinked signal: inserts with accountId null
 *  8.  matchedSignalsForAccount direct visibility: imported accountId-linked signal appears
 *  9.  matchedSignalsForAccount name-match visibility: unlinked signal with matching account name appears
 * 10.  Required field validation: missing/blank signalTitle creates row error
 * 11.  Duplicate handling: within-upload duplicates are skipped
 * 12.  Duplicate handling: second commit of same file skips DB duplicates
 * 13.  Duplicate handling: dry-run reports duplicates without writing
 * 14.  Date parsing: ISO/string date parses correctly
 * 15.  Date parsing: Excel serial date parses correctly
 * 16.  No action side effects: fullPotentialActions count unchanged after import
 *
 * Test hygiene:
 * - Prefix: PR39SIGNAL (no underscores — avoids normalizeToken() stripping)
 * - Stale fixtures deleted before insert in beforeAll
 * - Cleaned up in afterAll
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as XLSX from "xlsx";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import {
  fullPotentialAccounts,
  fullPotentialAccountAliases,
  fullPotentialSignals,
  fullPotentialActions,
} from "../drizzle/schema";
import { eq, sql, and } from "drizzle-orm";
import type { User } from "../drizzle/schema";

// ── Caller context ────────────────────────────────────────────────────────────

const TEST_USER_ID = 999939;

function createContext(role: "user" | "admin" = "admin"): TrpcContext {
  const user: User = {
    id: TEST_USER_ID,
    openId: "pr39-test-user",
    name: "PR39 Test User",
    email: "pr39@example.com",
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

// Alphanumeric prefix — no underscores so normalizeToken() does not break LIKE matching
const PR39 = "PR39SIGNAL";
const ACCOUNT_STABLE_KEY = `${PR39}acme|account|AU|WA|direct_ape`;
const ALIAS_ACCOUNT_STABLE_KEY = `${PR39}alias|account|AU|WA|direct_ape`;

let testAccountId: number;
let testAliasAccountId: number;

// ── XLSX helpers ──────────────────────────────────────────────────────────────

/**
 * Build a minimal base64-encoded XLSX workbook from a 2D array.
 * Row 0 is the header row.
 */
function buildXlsx(rows: (string | number | null)[][]): string {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Signals");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buf).toString("base64");
}

const HEADERS = ["signalTitle", "signalSummary", "signalType", "sourceName", "sourceUrl", "state", "signalDate", "confidenceLevel", "urgency", "suggestedAction", "status", "accountId", "stableKey", "accountName"];

function buildRow(overrides: Partial<Record<typeof HEADERS[number], string | number | null>> = {}): (string | number | null)[] {
  const defaults: Record<string, string | number | null> = {
    signalTitle: `${PR39} Acme Mining Expansion`,
    signalSummary: "Test signal summary",
    signalType: "mine_site_activity",
    sourceName: "Mining Weekly",
    sourceUrl: null,
    state: "WA",
    signalDate: "2025-06-01",
    confidenceLevel: "high",
    urgency: "hot",
    suggestedAction: "Call account manager",
    status: "new",
    accountId: null,
    stableKey: null,
    accountName: null,
  };
  const merged = { ...defaults, ...overrides };
  return HEADERS.map(h => merged[h] ?? null);
}

// ── Fixture setup ─────────────────────────────────────────────────────────────

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Delete stale fixtures from previous runs (FK order: actions → signals → aliases → accounts)
  const staleAccounts = await db.select({ id: fullPotentialAccounts.id })
    .from(fullPotentialAccounts)
    .where(sql`${fullPotentialAccounts.stableKey} IN (${ACCOUNT_STABLE_KEY}, ${ALIAS_ACCOUNT_STABLE_KEY})`);
  for (const acct of staleAccounts) {
    await db.delete(fullPotentialActions).where(eq(fullPotentialActions.accountId, acct.id));
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.accountId, acct.id));
    await db.delete(fullPotentialAccountAliases).where(eq(fullPotentialAccountAliases.accountId, acct.id));
    await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, acct.id));
  }
  // Also delete any stale unlinked signals from this prefix
  await db.delete(fullPotentialSignals).where(
    sql`${fullPotentialSignals.signalTitle} LIKE ${PR39 + "%"}`
  );

  // Insert test account (linked by accountId / stableKey)
  await db.insert(fullPotentialAccounts).values({
    stableKey: ACCOUNT_STABLE_KEY,
    canonicalName: `${PR39}Acme Mining Pty Ltd`,
    displayName: `${PR39}Acme Mining`,
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
  const [acct] = await db.select().from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.stableKey, ACCOUNT_STABLE_KEY)).limit(1);
  testAccountId = acct.id;

  // Insert alias account (linked by aliasName)
  await db.insert(fullPotentialAccounts).values({
    stableKey: ALIAS_ACCOUNT_STABLE_KEY,
    canonicalName: `${PR39}Alias Corp Pty Ltd`,
    displayName: `${PR39}Alias Corp`,
    state: "QLD",
    rowClass: "account",
    routeToMarket: "direct_ape",
    fpStatus: "qualify",
    priorityTier: "unassigned",
    platformPushDecision: "qualify_first",
    installedBaseStatus: "unknown",
    c4cStatus: "unknown",
    confidenceLevel: "unknown",
  } as any);
  const [aliasAcct] = await db.select().from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.stableKey, ALIAS_ACCOUNT_STABLE_KEY)).limit(1);
  testAliasAccountId = aliasAcct.id;

  // Insert alias for the alias account
  await db.insert(fullPotentialAccountAliases).values({
    accountId: testAliasAccountId,
    aliasName: `${PR39} Alias Corp Trading Name`,
    aliasType: "trading_name",
    confidenceLevel: "high",
  } as any);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  if (testAccountId) {
    await db.delete(fullPotentialActions).where(eq(fullPotentialActions.accountId, testAccountId));
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.accountId, testAccountId));
  }
  if (testAliasAccountId) {
    await db.delete(fullPotentialActions).where(eq(fullPotentialActions.accountId, testAliasAccountId));
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.accountId, testAliasAccountId));
    await db.delete(fullPotentialAccountAliases).where(eq(fullPotentialAccountAliases.accountId, testAliasAccountId));
  }
  // Clean up unlinked signals from this prefix
  await db.delete(fullPotentialSignals).where(
    sql`${fullPotentialSignals.signalTitle} LIKE ${PR39 + "%"}`
  );
  if (testAccountId) await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, testAccountId));
  if (testAliasAccountId) await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, testAliasAccountId));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("fullPotential.importSignals", () => {

  // ── Group 1 & 2: Admin-only ─────────────────────────────────────────────────

  it("1. admin can call importSignals", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const fileBase64 = buildXlsx([HEADERS, buildRow()]);
    const result = await caller.fullPotential.importSignals({
      fileName: "test.xlsx",
      fileBase64,
      dryRun: true,
    });
    expect(result).toBeDefined();
    expect(result.dryRun).toBe(true);
  });

  it("2. non-admin gets FORBIDDEN", async () => {
    const caller = appRouter.createCaller(createContext("user"));
    const fileBase64 = buildXlsx([HEADERS, buildRow()]);
    await expect(
      caller.fullPotential.importSignals({
        fileName: "test.xlsx",
        fileBase64,
        dryRun: true,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── Group 3 & 4: Dry-run ────────────────────────────────────────────────────

  it("3. dry-run returns parsed/valid counts", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const fileBase64 = buildXlsx([HEADERS, buildRow({ signalTitle: `${PR39} Dry Run Signal A` }), buildRow({ signalTitle: `${PR39} Dry Run Signal B` })]);
    const result = await caller.fullPotential.importSignals({
      fileName: "test.xlsx",
      fileBase64,
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.rowsParsed).toBe(2);
    expect(result.rowsValid).toBe(2);
    expect(result.createdSignals).toBe(0);
  });

  it("4. dry-run writes zero fullPotentialSignals", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const caller = appRouter.createCaller(createContext("admin"));
    const title = `${PR39} Dry Run No Write Signal`;
    const fileBase64 = buildXlsx([HEADERS, buildRow({ signalTitle: title })]);
    await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: true });
    const rows = await db.select().from(fullPotentialSignals)
      .where(eq(fullPotentialSignals.signalTitle, title));
    expect(rows).toHaveLength(0);
  });

  // ── Group 5: Commit linked by accountId ─────────────────────────────────────

  it("5. commit linked by accountId inserts row with accountId populated", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const caller = appRouter.createCaller(createContext("admin"));
    const title = `${PR39} Linked By AccountId Signal`;
    const fileBase64 = buildXlsx([HEADERS, buildRow({ signalTitle: title, accountId: testAccountId, signalDate: "2025-07-01" })]);
    const result = await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: false });
    expect(result.createdSignals).toBe(1);
    expect(result.linkedAccounts).toBe(1);
    const [row] = await db.select().from(fullPotentialSignals)
      .where(eq(fullPotentialSignals.signalTitle, title)).limit(1);
    expect(row).toBeDefined();
    expect(row.accountId).toBe(testAccountId);
    // cleanup
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.signalTitle, title));
  });

  // ── Group 6: Commit linked by stableKey ─────────────────────────────────────

  it("6. commit linked by stableKey resolves accountId", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const caller = appRouter.createCaller(createContext("admin"));
    const title = `${PR39} Linked By StableKey Signal`;
    const fileBase64 = buildXlsx([HEADERS, buildRow({ signalTitle: title, stableKey: ACCOUNT_STABLE_KEY, signalDate: "2025-07-02" })]);
    const result = await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: false });
    expect(result.createdSignals).toBe(1);
    const [row] = await db.select().from(fullPotentialSignals)
      .where(eq(fullPotentialSignals.signalTitle, title)).limit(1);
    expect(row).toBeDefined();
    expect(row.accountId).toBe(testAccountId);
    const preview = result.preview.find(p => p.signalTitle === title);
    expect(preview?.accountMatchReason).toBe("stable_key");
    // cleanup
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.signalTitle, title));
  });

  // ── Group 7: Unlinked signal ─────────────────────────────────────────────────

  it("7. unlinked signal inserts with accountId null", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const caller = appRouter.createCaller(createContext("admin"));
    const title = `${PR39} Unlinked Signal No Account`;
    const fileBase64 = buildXlsx([HEADERS, buildRow({ signalTitle: title, accountId: null, stableKey: null, accountName: null, signalDate: "2025-07-03" })]);
    const result = await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: false });
    expect(result.createdSignals).toBe(1);
    expect(result.unlinkedSignals).toBe(1);
    const [row] = await db.select().from(fullPotentialSignals)
      .where(eq(fullPotentialSignals.signalTitle, title)).limit(1);
    expect(row).toBeDefined();
    expect(row.accountId).toBeNull();
    // cleanup
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.signalTitle, title));
  });

  // ── Group 8: matchedSignalsForAccount direct visibility ─────────────────────

  it("8. imported accountId-linked signal appears as direct match for that account", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const caller = appRouter.createCaller(createContext("admin"));
    const title = `${PR39} Direct Visibility Signal`;
    const fileBase64 = buildXlsx([HEADERS, buildRow({ signalTitle: title, accountId: testAccountId, signalDate: "2025-07-04" })]);
    await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: false });
    const result = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    const found = result.matches.find(m => m.title === title);
    expect(found).toBeDefined();
    expect(found?.sourceType).toBe("fp_signal");
    // cleanup
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.signalTitle, title));
  });

  // ── Group 9: matchedSignalsForAccount name-match visibility ─────────────────

  it("9. accountName column resolves to accountId at import time (canonical_name match)", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const caller = appRouter.createCaller(createContext("admin"));
    // Use the account's canonicalName as the accountName in the signal row.
    // importSignals resolves accountName → accountId via exact canonical_name / display_name match,
    // so the inserted signal is directly linked (not unlinked).
    const title = `${PR39} AccountName Resolve Signal`;
    const accountName = `${PR39}Acme Mining Pty Ltd`; // exact canonicalName of testAccount
    const fileBase64 = buildXlsx([HEADERS, buildRow({ signalTitle: title, accountId: null, stableKey: null, accountName, signalDate: "2025-07-05" })]);
    const result = await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: false });
    // The signal should be linked to testAccountId via canonical_name match
    expect(result.createdSignals).toBe(1);
    expect(result.linkedAccounts).toBe(1);
    const preview = result.preview.find(p => p.signalTitle === title);
    expect(preview?.accountMatchReason).toBe("canonical_name");
    expect(preview?.accountId).toBe(testAccountId);
    const [row] = await db.select().from(fullPotentialSignals)
      .where(eq(fullPotentialSignals.signalTitle, title)).limit(1);
    expect(row).toBeDefined();
    expect(row.accountId).toBe(testAccountId);
    // Verify it appears in matchedSignalsForAccount as a direct-link signal
    const matchResult = await caller.fullPotential.matchedSignalsForAccount({ accountId: testAccountId });
    const found = matchResult.matches.find(m => m.title === title);
    expect(found).toBeDefined();
    expect(found?.sourceType).toBe("fp_signal");
    // cleanup
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.signalTitle, title));
  });

  // ── Group 10: Required field validation ─────────────────────────────────────

  it("10a. missing signalTitle creates row error and row is not inserted", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const caller = appRouter.createCaller(createContext("admin"));
    // Row with blank signalTitle
    const fileBase64 = buildXlsx([HEADERS, buildRow({ signalTitle: "" })]);
    const result = await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: false });
    expect(result.errors.length).toBeGreaterThan(0);
    const err = result.errors.find(e => e.field === "signalTitle");
    expect(err).toBeDefined();
    expect(result.createdSignals).toBe(0);
  });

  it("10b. blank-only signalTitle (spaces) creates row error", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const fileBase64 = buildXlsx([HEADERS, buildRow({ signalTitle: "   " })]);
    const result = await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: false });
    const err = result.errors.find(e => e.field === "signalTitle");
    expect(err).toBeDefined();
  });

  // ── Group 11: Duplicate within upload ───────────────────────────────────────

  it("11. duplicate rows in same upload are skipped (first wins)", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const caller = appRouter.createCaller(createContext("admin"));
    const title = `${PR39} Within Upload Dup Signal`;
    const row = buildRow({ signalTitle: title, accountId: testAccountId, signalDate: "2025-07-06" });
    const fileBase64 = buildXlsx([HEADERS, row, row]); // identical rows
    const result = await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: false });
    expect(result.createdSignals).toBe(1);
    expect(result.skippedDuplicates).toBe(1);
    const rows = await db.select().from(fullPotentialSignals)
      .where(eq(fullPotentialSignals.signalTitle, title));
    expect(rows).toHaveLength(1);
    // cleanup
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.signalTitle, title));
  });

  // ── Group 12: Duplicate already in DB ───────────────────────────────────────

  it("12. second commit of same file skips existing DB duplicates", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const caller = appRouter.createCaller(createContext("admin"));
    const title = `${PR39} DB Dup Signal`;
    const row = buildRow({ signalTitle: title, accountId: testAccountId, signalDate: "2025-07-07" });
    const fileBase64 = buildXlsx([HEADERS, row]);
    // First commit
    const first = await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: false });
    expect(first.createdSignals).toBe(1);
    // Second commit — should skip
    const second = await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: false });
    expect(second.createdSignals).toBe(0);
    expect(second.skippedDuplicates).toBe(1);
    // cleanup
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.signalTitle, title));
  });

  // ── Group 13: Dry-run reports duplicates without writing ────────────────────

  it("13. dry-run reports within-upload duplicates without writing", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const caller = appRouter.createCaller(createContext("admin"));
    const title = `${PR39} Dry Run Dup Signal`;
    const row = buildRow({ signalTitle: title, accountId: testAccountId, signalDate: "2025-07-08" });
    const fileBase64 = buildXlsx([HEADERS, row, row]);
    const result = await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.createdSignals).toBe(0);
    const rows = await db.select().from(fullPotentialSignals)
      .where(eq(fullPotentialSignals.signalTitle, title));
    expect(rows).toHaveLength(0);
  });

  // ── Group 14: Date parsing ───────────────────────────────────────────────────

  it("14a. ISO date string parses correctly", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const fileBase64 = buildXlsx([HEADERS, buildRow({ signalTitle: `${PR39} ISO Date Signal`, signalDate: "2025-06-15" })]);
    const result = await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: true });
    expect(result.rowsValid).toBe(1);
    const preview = result.preview[0];
    expect(preview.signalDate).not.toBeNull();
    expect(new Date(preview.signalDate!).getFullYear()).toBe(2025);
  });

  it("14b. Excel serial date parses correctly", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    // Excel serial 45000 = 2023-03-15 approx
    const fileBase64 = buildXlsx([HEADERS, buildRow({ signalTitle: `${PR39} Excel Date Signal`, signalDate: 45000 })]);
    const result = await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: true });
    expect(result.rowsValid).toBe(1);
    const preview = result.preview[0];
    expect(preview.signalDate).not.toBeNull();
  });

  it("14c. invalid date string creates row error", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const fileBase64 = buildXlsx([HEADERS, buildRow({ signalTitle: `${PR39} Bad Date Signal`, signalDate: "not-a-date" })]);
    const result = await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: true });
    const err = result.errors.find(e => e.field === "signalDate");
    expect(err).toBeDefined();
    expect(result.rowsValid).toBe(0);
  });

  // ── Group 15: No action side effects ────────────────────────────────────────

  it("15. fullPotentialActions count unchanged after import", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const caller = appRouter.createCaller(createContext("admin"));
    // Scope the count to testAccountId to avoid interference from other test files
    const [{ before }] = await db
      .select({ before: sql<number>`COUNT(*)` })
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.accountId, testAccountId));
    const title = `${PR39} No Action Side Effect Signal`;
    const fileBase64 = buildXlsx([HEADERS, buildRow({ signalTitle: title, accountId: testAccountId, signalDate: "2025-07-09" })]);
    await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: false });
    const [{ after }] = await db
      .select({ after: sql<number>`COUNT(*)` })
      .from(fullPotentialActions)
      .where(eq(fullPotentialActions.accountId, testAccountId));
    expect(Number(after)).toBe(Number(before));
    // cleanup
    await db.delete(fullPotentialSignals).where(eq(fullPotentialSignals.signalTitle, title));
  });

  // ── Group 16: Preview cap ────────────────────────────────────────────────────

  it("16. preview is capped at 20 rows", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const rows = Array.from({ length: 25 }, (_, i) =>
      buildRow({ signalTitle: `${PR39} Preview Cap Signal ${i}`, signalDate: `2025-07-${String(i + 1).padStart(2, "0")}` })
    );
    const fileBase64 = buildXlsx([HEADERS, ...rows]);
    const result = await caller.fullPotential.importSignals({ fileName: "test.xlsx", fileBase64, dryRun: true });
    expect(result.rowsValid).toBe(25);
    expect(result.preview.length).toBeLessThanOrEqual(20);
  });

});
