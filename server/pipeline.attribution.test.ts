/**
 * pipeline.attribution.test.ts — Sprint 2A: Pipeline Attribution Spine
 *
 * Validates:
 *  1. FP claim creation via pipeline.claimFromFP (happy path)
 *  2. Idempotency: second call with same (userId, sourceAccountId, productFamily) returns existing claimId
 *  3. Stage gate — contacted: requires contactName
 *  4. Stage gate — qualified: requires estimatedValueAud AND nextAction
 *  5. Stage gate — quoted: requires closeDate
 *  6. Non-owner rejection: advanceStage on another user's claim throws "Not your claim"
 *  7. byAccount query: returns all claims for a given sourceAccountId
 *  8. Unauthenticated access is rejected (null user → UNAUTHORIZED)
 *
 * Uses direct DB helpers for seed/teardown.
 * Access-control tests use appRouter.createCaller() with mocked TrpcContext.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "./db";
import { pipelineClaims, pipelineActivity, outreachEmails } from "../drizzle/schema";
import { fullPotentialAccounts } from "../drizzle/fullPotentialSchema";
import { eq, and } from "drizzle-orm";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

// ── Context factory ───────────────────────────────────────────────────────────

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 9901,
    openId: "test-pipeline-user",
    email: "pipeline-test@example.com",
    name: "Pipeline Test User",
    loginMethod: "manus",
    role: "user",
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

// ── Seed / teardown helpers ───────────────────────────────────────────────────

const TEST_ACCOUNT_KEY = "test-pipeline-attribution-account-2a";
const TEST_USER_ID_A = 9901;
const TEST_USER_ID_B = 9902;
let testAccountId: number;

async function seedFpAccount() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Clean up any pre-existing test account
  await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.stableKey, TEST_ACCOUNT_KEY));
  await db.insert(fullPotentialAccounts).values({
    stableKey: TEST_ACCOUNT_KEY,
    canonicalName: "Pipeline Attribution Test Co",
    rowClass: "account",
    routeToMarket: "direct_ape",
    fpStatus: "develop",
    priorityTier: "tier_b",
    platformPushDecision: "push_context",
    installedBaseStatus: "unknown",
  } as any);
  const [row] = await db
    .select({ id: fullPotentialAccounts.id })
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.stableKey, TEST_ACCOUNT_KEY))
    .limit(1);
  if (!row) throw new Error("Failed to seed FP account");
  testAccountId = row.id;
}

async function cleanupTestClaims() {
  const db = await getDb();
  if (!db) return;
  // Delete claims linked to the test account
  const claims = await db
    .select({ id: pipelineClaims.id })
    .from(pipelineClaims)
    .where(eq(pipelineClaims.sourceAccountId, testAccountId));
  for (const c of claims) {
    await db.delete(pipelineActivity).where(eq(pipelineActivity.claimId, c.id));
    await db.delete(outreachEmails).where(eq(outreachEmails.claimId, c.id));
  }
  await db.delete(pipelineClaims).where(eq(pipelineClaims.sourceAccountId, testAccountId));
  await db.delete(fullPotentialAccounts).where(eq(fullPotentialAccounts.stableKey, TEST_ACCOUNT_KEY));
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("pipeline.attribution (Sprint 2A)", () => {
  beforeAll(async () => {
    await seedFpAccount();
  });

  afterAll(async () => {
    await cleanupTestClaims();
  });

  // ── 1. FP claim creation (happy path) ──────────────────────────────────────

  it("creates a new FP-sourced claim and returns claimId + alreadyExists=false", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ id: TEST_USER_ID_A })));
    const result = await caller.pipeline.claimFromFP({
      sourceAccountId: testAccountId,
      productFamily: "portable_air_<600cfm",
      notes: "Initial FP handoff from test",
    });

    expect(result.claimId).toBeGreaterThan(0);
    expect(result.alreadyExists).toBe(false);

    // Verify the claim exists in DB with correct sourceType
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [claim] = await db
      .select()
      .from(pipelineClaims)
      .where(eq(pipelineClaims.id, result.claimId))
      .limit(1);

    expect(claim).toBeDefined();
    expect(claim.sourceType).toBe("full_potential");
    expect(claim.sourceAccountId).toBe(testAccountId);
    expect(claim.productFamily).toBe("portable_air_<600cfm");
    expect(claim.status).toBe("identified");
    expect(claim.userId).toBe(TEST_USER_ID_A);
  });

  // ── 2. Idempotency ─────────────────────────────────────────────────────────

  it("returns the same claimId and alreadyExists=true on duplicate (userId, sourceAccountId, productFamily)", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ id: TEST_USER_ID_A })));

    // First call
    const first = await caller.pipeline.claimFromFP({
      sourceAccountId: testAccountId,
      productFamily: "portable_air_>600cfm",
    });
    expect(first.alreadyExists).toBe(false);

    // Second call — identical key
    const second = await caller.pipeline.claimFromFP({
      sourceAccountId: testAccountId,
      productFamily: "portable_air_>600cfm",
    });
    expect(second.alreadyExists).toBe(true);
    expect(second.claimId).toBe(first.claimId);
  });

  // ── 3. Stage gate: contacted requires contactName ──────────────────────────

  it("rejects advance to contacted when contactName is missing", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ id: TEST_USER_ID_A })));

    // Create a fresh claim
    const { claimId } = await caller.pipeline.claimFromFP({
      sourceAccountId: testAccountId,
      productFamily: "nitrogen_specialty",
    });

    // Attempt to advance without contactName
    await expect(
      caller.pipeline.advanceStage({
        claimId,
        toStatus: "contacted",
        note: "Missing contact name",
      })
    ).rejects.toThrow(/contactName required/i);
  });

  it("allows advance to contacted when contactName is provided", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ id: TEST_USER_ID_A })));

    const { claimId } = await caller.pipeline.claimFromFP({
      sourceAccountId: testAccountId,
      productFamily: "booster_nitrogen_specialty",
    });

    await expect(
      caller.pipeline.advanceStage({
        claimId,
        toStatus: "contacted",
        contactName: "Jane Smith",
        contactRole: "Fleet Manager",
        note: "Initial contact made",
      })
    ).resolves.toEqual({ success: true });

    // Verify status updated
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [claim] = await db
      .select({ status: pipelineClaims.status, contactName: pipelineClaims.contactName })
      .from(pipelineClaims)
      .where(eq(pipelineClaims.id, claimId))
      .limit(1);
    expect(claim.status).toBe("contacted");
    expect(claim.contactName).toBe("Jane Smith");
  });

  // ── 4. Stage gate: qualified requires estimatedValueAud + nextAction ────────

  it("rejects advance to qualified when estimatedValueAud is missing", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ id: TEST_USER_ID_A })));

    const { claimId } = await caller.pipeline.claimFromFP({
      sourceAccountId: testAccountId,
      productFamily: "e_air_direct",
    });

    // Advance to contacted first
    await caller.pipeline.advanceStage({
      claimId,
      toStatus: "contacted",
      contactName: "Bob Jones",
    });

    // Attempt to advance to qualified without estimatedValueAud
    await expect(
      caller.pipeline.advanceStage({
        claimId,
        toStatus: "qualified",
        nextAction: "Send proposal",
      })
    ).rejects.toThrow(/estimatedValueAud required/i);
  });

  it("rejects advance to qualified when nextAction is missing", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ id: TEST_USER_ID_A })));

    const { claimId } = await caller.pipeline.claimFromFP({
      sourceAccountId: testAccountId,
      productFamily: "portable_air_coates_strategic",
    });

    await caller.pipeline.advanceStage({
      claimId,
      toStatus: "contacted",
      contactName: "Alice Brown",
    });

    await expect(
      caller.pipeline.advanceStage({
        claimId,
        toStatus: "qualified",
        estimatedValueAud: "125000",
      })
    ).rejects.toThrow(/nextAction required/i);
  });

  it("allows advance to qualified when both estimatedValueAud and nextAction are provided", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ id: TEST_USER_ID_A })));

    const { claimId } = await caller.pipeline.claimFromFP({
      sourceAccountId: testAccountId,
      productFamily: "hybrid_strategic_test",
    });

    await caller.pipeline.advanceStage({
      claimId,
      toStatus: "contacted",
      contactName: "Carol White",
    });

    await expect(
      caller.pipeline.advanceStage({
        claimId,
        toStatus: "qualified",
        estimatedValueAud: "250000",
        nextAction: "Arrange site visit",
      })
    ).resolves.toEqual({ success: true });

    // Verify qualifiedAt was set
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [claim] = await db
      .select({ status: pipelineClaims.status, qualifiedAt: pipelineClaims.qualifiedAt })
      .from(pipelineClaims)
      .where(eq(pipelineClaims.id, claimId))
      .limit(1);
    expect(claim.status).toBe("qualified");
    expect(claim.qualifiedAt).toBeInstanceOf(Date);
  });

  // ── 5. Stage gate: quoted requires closeDate ───────────────────────────────

  it("rejects advance to quoted when closeDate is missing", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ id: TEST_USER_ID_A })));

    const { claimId } = await caller.pipeline.claimFromFP({
      sourceAccountId: testAccountId,
      productFamily: "quoted_gate_test",
    });

    await caller.pipeline.advanceStage({ claimId, toStatus: "contacted", contactName: "Dave Green" });
    await caller.pipeline.advanceStage({
      claimId,
      toStatus: "qualified",
      estimatedValueAud: "80000",
      nextAction: "Prepare quote",
    });

    await expect(
      caller.pipeline.advanceStage({
        claimId,
        toStatus: "quoted",
      })
    ).rejects.toThrow(/closeDate required/i);
  });

  it("allows advance to quoted when closeDate is provided", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ id: TEST_USER_ID_A })));

    const { claimId } = await caller.pipeline.claimFromFP({
      sourceAccountId: testAccountId,
      productFamily: "quoted_gate_pass_test",
    });

    await caller.pipeline.advanceStage({ claimId, toStatus: "contacted", contactName: "Eve Black" });
    await caller.pipeline.advanceStage({
      claimId,
      toStatus: "qualified",
      estimatedValueAud: "300000",
      nextAction: "Submit formal quote",
    });

    const closeDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
    await expect(
      caller.pipeline.advanceStage({
        claimId,
        toStatus: "quoted",
        closeDate,
      })
    ).resolves.toEqual({ success: true });
  });

  // ── 6. Non-owner rejection ─────────────────────────────────────────────────

  it("rejects advanceStage when the caller is not the claim owner", async () => {
    const callerA = appRouter.createCaller(makeCtx(makeUser({ id: TEST_USER_ID_A })));
    const callerB = appRouter.createCaller(makeCtx(makeUser({ id: TEST_USER_ID_B })));

    // User A creates a claim
    const { claimId } = await callerA.pipeline.claimFromFP({
      sourceAccountId: testAccountId,
      productFamily: "non_owner_rejection_test",
    });

    // User B attempts to advance it
    await expect(
      callerB.pipeline.advanceStage({
        claimId,
        toStatus: "contacted",
        contactName: "Intruder",
      })
    ).rejects.toThrow(/not your claim/i);
  });

  // ── 7. byAccount query ─────────────────────────────────────────────────────

  it("byAccount returns all claims for a given sourceAccountId across users", async () => {
    const callerA = appRouter.createCaller(makeCtx(makeUser({ id: TEST_USER_ID_A })));
    const callerB = appRouter.createCaller(makeCtx(makeUser({ id: TEST_USER_ID_B })));

    // Both users create a claim for the same FP account
    await callerA.pipeline.claimFromFP({
      sourceAccountId: testAccountId,
      productFamily: "by_account_query_test_a",
    });
    await callerB.pipeline.claimFromFP({
      sourceAccountId: testAccountId,
      productFamily: "by_account_query_test_b",
    });

    // Either user can query byAccount
    const claims = await callerA.pipeline.byAccount({ sourceAccountId: testAccountId });
    const productFamilies = claims.map((c) => c.productFamily);
    expect(productFamilies).toContain("by_account_query_test_a");
    expect(productFamilies).toContain("by_account_query_test_b");
  });

  // ── 8. Unauthenticated access rejected ────────────────────────────────────

  it("rejects claimFromFP when user is not authenticated", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(
      caller.pipeline.claimFromFP({
        sourceAccountId: testAccountId,
        productFamily: "unauth_test",
      })
    ).rejects.toThrow();
  });

  it("rejects advanceStage when user is not authenticated", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(
      caller.pipeline.advanceStage({
        claimId: 999999,
        toStatus: "contacted",
        contactName: "Ghost",
      })
    ).rejects.toThrow();
  });

  it("rejects byAccount when user is not authenticated", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(
      caller.pipeline.byAccount({ sourceAccountId: testAccountId })
    ).rejects.toThrow();
  });
});
