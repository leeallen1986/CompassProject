/**
 * Regression coverage for the existing project pipeline after Sprint 2A.
 *
 * The project UI predates the new `qualified` stage and qualification-specific
 * fields. This suite proves that its established payload can still progress
 * identified -> contacted -> meeting_booked -> quoted -> won.
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

const TEST_USER_ID = 9911;
const createdClaimIds: number[] = [];

function makeUser(): User {
  return {
    id: TEST_USER_ID,
    openId: "pipeline-legacy-compat-user",
    email: "pipeline-legacy@example.com",
    name: "Pipeline Legacy Compatibility User",
    loginMethod: "manus",
    role: "user",
    campaignAccess: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } as User;
}

function makeCtx(): TrpcContext {
  return {
    user: makeUser(),
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

function futureDate(days: number): Date {
  return new Date(
    Date.now() + days * 24 * 60 * 60 * 1000,
  );
}

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

describe("legacy project pipeline compatibility", () => {
  it(
    "preserves the complete existing project status flow",
    async () => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const inserted = await db
        .insert(pipelineClaims)
        .values({
          userId: TEST_USER_ID,
          projectId: 1,
          reportId: 1,
          sourceType: "project",
          status: "identified",
        } as any);

      const claimId = Number(inserted[0].insertId);
      createdClaimIds.push(claimId);

      const caller = appRouter.createCaller(makeCtx());

      await expect(
        caller.pipeline.updateStatus({
          claimId,
          status: "contacted",
          contactName: "Jordan Project",
          notes:
            "Spoke with the project stakeholder and confirmed interest.",
        }),
      ).resolves.toEqual({ success: true });

      await expect(
        caller.pipeline.updateStatus({
          claimId,
          status: "meeting_booked",
          notes:
            "Meeting booked to review the project requirement.",
          nextActionDate: futureDate(5),
        }),
      ).resolves.toEqual({ success: true });

      await expect(
        caller.pipeline.updateStatus({
          claimId,
          status: "quoted",
          estimatedValue: "$150,000",
          nextAction:
            "Follow up the commercial proposal with procurement.",
          nextActionDate: futureDate(12),
        }),
      ).resolves.toEqual({ success: true });

      await expect(
        caller.pipeline.updateStatus({
          claimId,
          status: "won",
          notes:
            "Customer awarded the project package to Atlas Copco.",
        }),
      ).resolves.toEqual({ success: true });

      const [claim] = await db
        .select({
          status: pipelineClaims.status,
          estimatedValue: pipelineClaims.estimatedValue,
        })
        .from(pipelineClaims)
        .where(eq(pipelineClaims.id, claimId))
        .limit(1);

      expect(claim.status).toBe("won");
      expect(claim.estimatedValue).toBe("$150,000");
    },
  );

  it(
    "still rejects an illegal direct project jump",
    async () => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const inserted = await db
        .insert(pipelineClaims)
        .values({
          userId: TEST_USER_ID,
          projectId: 2,
          reportId: 1,
          sourceType: "project",
          status: "identified",
        } as any);

      const claimId = Number(inserted[0].insertId);
      createdClaimIds.push(claimId);

      const caller = appRouter.createCaller(makeCtx());

      await expect(
        caller.pipeline.updateStatus({
          claimId,
          status: "won",
          notes: "Attempted to skip the project stages.",
        }),
      ).rejects.toThrow(/not allowed/i);
    },
  );
});
