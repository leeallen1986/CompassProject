/**
 * Access and audit safeguards for the pipeline procedures.
 *
 * Covers three controls added in the Sprint 2A hardening pass:
 *
 * 1. pipeline.team — distributor callers receive only project/legacy claims;
 *    attributed claims (full_potential, signal, ai_recommendation, manual) are
 *    silently filtered out.
 *
 * 2. pipeline.activity — distributor callers are rejected with FORBIDDEN when
 *    they request activity for an attributed claim.
 *
 * 3. pipeline.release — any caller is rejected when they attempt to delete an
 *    attributed claim; the claim must be closed through an audited outcome
 *    (won / lost / not_relevant) instead.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./routers";
import { getDb } from "./db";
import {
  pipelineActivity,
  pipelineClaims,
  userActivity,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

// ── Test identity constants ──────────────────────────────────────────────────
// IDs chosen to avoid collision with attribution (9901, 9903) and legacy (9911) tests.
const INTERNAL_USER_ID = 9921;
const DISTRIBUTOR_USER_ID = 9922;

// Stable key prefix for any FP accounts created in this suite.
const AC_STABLEKEY_PREFIX = "test-access-control-v1";

// Track created claim IDs for teardown.
const createdClaimIds: number[] = [];

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: INTERNAL_USER_ID,
    openId: "access-control-test-user",
    email: "access-control@example.com",
    name: "Access Control Test User",
    loginMethod: "manus",
    role: "user",
    campaignAccess: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  } as User;
}

function makeCtx(user: User): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

function internalCaller() {
  return appRouter.createCaller(makeCtx(makeUser({ id: INTERNAL_USER_ID })));
}

function distributorCaller() {
  return appRouter.createCaller(
    makeCtx(
      makeUser({
        id: DISTRIBUTOR_USER_ID,
        role: "distributor",
      }),
    ),
  );
}

// ── Seed helpers ─────────────────────────────────────────────────────────────
async function seedClaim(
  sourceType: "full_potential" | "signal" | "ai_recommendation" | "manual" | "project" | "legacy",
  userId = INTERNAL_USER_ID,
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const inserted = await db.insert(pipelineClaims).values({
    userId,
    sourceType,
    status: "identified",
    // project/legacy claims need a projectId; attributed claims do not.
    projectId: sourceType === "project" || sourceType === "legacy" ? 1 : null,
  } as any);
  const claimId = Number(inserted[0].insertId);
  createdClaimIds.push(claimId);
  return claimId;
}

// ── Teardown ─────────────────────────────────────────────────────────────────
afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  for (const claimId of createdClaimIds) {
    await db
      .delete(pipelineActivity)
      .where(eq(pipelineActivity.claimId, claimId));
    await db
      .delete(userActivity)
      .where(eq(userActivity.claimId, claimId));
    await db
      .delete(pipelineClaims)
      .where(eq(pipelineClaims.id, claimId));
  }
});

// ── Test suite ───────────────────────────────────────────────────────────────
describe("pipeline access controls", () => {
  // ── 1. pipeline.team distributor filter ────────────────────────────────────
  describe("pipeline.team — distributor filter", () => {
    it(
      "returns attributed claims to internal users",
      async () => {
        const fpClaimId = await seedClaim("full_potential");
        const signalClaimId = await seedClaim("signal");
        const result = await internalCaller().pipeline.team();
        const ids = result.map((r) => r.claim.id);
        expect(ids).toContain(fpClaimId);
        expect(ids).toContain(signalClaimId);
      },
      30_000,
    );

    it(
      "filters out attributed claims for distributor callers",
      async () => {
        const fpClaimId = await seedClaim("full_potential");
        const aiClaimId = await seedClaim("ai_recommendation");
        const manualClaimId = await seedClaim("manual");
        const projectClaimId = await seedClaim("project");
        const legacyClaimId = await seedClaim("legacy");

        const result = await distributorCaller().pipeline.team();
        const ids = result.map((r) => r.claim.id);

        // Attributed claims must not appear.
        expect(ids).not.toContain(fpClaimId);
        expect(ids).not.toContain(aiClaimId);
        expect(ids).not.toContain(manualClaimId);

        // Project and legacy claims must still appear.
        expect(ids).toContain(projectClaimId);
        expect(ids).toContain(legacyClaimId);
      },
      30_000,
    );
  });

  // ── 2. pipeline.activity distributor guard ─────────────────────────────────
  describe("pipeline.activity — distributor guard", () => {
    it(
      "allows internal users to read activity for attributed claims",
      async () => {
        const fpClaimId = await seedClaim("full_potential");
        await expect(
          internalCaller().pipeline.activity({ claimId: fpClaimId }),
        ).resolves.toBeDefined();
      },
      30_000,
    );

    it(
      "rejects distributor access to full_potential claim activity",
      async () => {
        const fpClaimId = await seedClaim("full_potential");
        await expect(
          distributorCaller().pipeline.activity({ claimId: fpClaimId }),
        ).rejects.toThrow(/10004/);
      },
      30_000,
    );

    it(
      "rejects distributor access to signal claim activity",
      async () => {
        const signalClaimId = await seedClaim("signal");
        await expect(
          distributorCaller().pipeline.activity({ claimId: signalClaimId }),
        ).rejects.toThrow(/10004/);
      },
      30_000,
    );

    it(
      "allows distributor access to project claim activity",
      async () => {
        const projectClaimId = await seedClaim("project");
        await expect(
          distributorCaller().pipeline.activity({ claimId: projectClaimId }),
        ).resolves.toBeDefined();
      },
      30_000,
    );
  });

  // ── 3. pipeline.release attributed deletion guard ──────────────────────────
  describe("pipeline.release — attributed deletion guard", () => {
    it(
      "allows deletion of a project claim",
      async () => {
        const projectClaimId = await seedClaim("project", INTERNAL_USER_ID);
        // Remove from teardown list since release will delete it.
        const idx = createdClaimIds.indexOf(projectClaimId);
        if (idx !== -1) createdClaimIds.splice(idx, 1);

        await expect(
          internalCaller().pipeline.release({ claimId: projectClaimId }),
        ).resolves.toEqual({ success: true });
      },
      30_000,
    );

    it(
      "rejects deletion of a full_potential claim",
      async () => {
        const fpClaimId = await seedClaim("full_potential", INTERNAL_USER_ID);
        await expect(
          internalCaller().pipeline.release({ claimId: fpClaimId }),
        ).rejects.toThrow(/10005/);
      },
      30_000,
    );

    it(
      "rejects deletion of a signal claim",
      async () => {
        const signalClaimId = await seedClaim("signal", INTERNAL_USER_ID);
        await expect(
          internalCaller().pipeline.release({ claimId: signalClaimId }),
        ).rejects.toThrow(/10005/);
      },
      30_000,
    );

    it(
      "rejects deletion of an ai_recommendation claim",
      async () => {
        const aiClaimId = await seedClaim("ai_recommendation", INTERNAL_USER_ID);
        await expect(
          internalCaller().pipeline.release({ claimId: aiClaimId }),
        ).rejects.toThrow(/10005/);
      },
      30_000,
    );

    it(
      "rejects deletion of a manual claim",
      async () => {
        const manualClaimId = await seedClaim("manual", INTERNAL_USER_ID);
        await expect(
          internalCaller().pipeline.release({ claimId: manualClaimId }),
        ).rejects.toThrow(/10005/);
      },
      30_000,
    );
  });
});
