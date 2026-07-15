import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  fullPotentialAccounts,
  fullPotentialEvidence,
  fullPotentialModelReviews,
  fullPotentialModels,
} from "../drizzle/schema";
import type {
  FullPotentialAccount,
  FullPotentialEvidence,
  FullPotentialModel,
} from "../drizzle/schema";
import type { FpProductFamily } from "@shared/const";
import {
  FP_MODEL_ACTIVE_STATUSES,
  FP_MODEL_METHOD_VERSION,
  fullPotentialActorName,
  optionalText,
  requiredText,
} from "./fullPotentialCommercialModel.shared";
import type {
  ConfidenceLevel,
  EvidenceType,
  FullPotentialActor,
} from "./fullPotentialCommercialModel.shared";

export interface AddFullPotentialEvidenceInput {
  accountId: number;
  productFamily?: FpProductFamily | null;
  evidenceType: EvidenceType;
  title: string;
  summary: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceReference?: string | null;
  observedAt?: Date | null;
  confidenceLevel: ConfidenceLevel;
}

export function assertAccountEligibleForModel(account: FullPotentialAccount): void {
  if (
    account.rowClass !== "account" ||
    !account.countsTowardPotential ||
    account.recordStatus === "merged" ||
    account.recordStatus === "parked" ||
    account.recordStatus === "excluded" ||
    account.fpStatus === "park" ||
    account.fpStatus === "exclude" ||
    account.routeToMarket === "exclude"
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This record is not eligible for an account-level Full Potential model",
    });
  }
}

export function assertModelEditor(model: FullPotentialModel, actor: FullPotentialActor): void {
  if (model.status !== "draft" && model.status !== "returned") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Model ${model.id} is ${model.status} and cannot be edited`,
    });
  }
  if (actor.role !== "admin" && model.createdBy !== actor.id) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the model owner or an admin can edit this draft",
    });
  }
}

export async function loadFullPotentialModel(tx: any, modelId: number): Promise<FullPotentialModel> {
  const [model] = await tx
    .select()
    .from(fullPotentialModels)
    .where(eq(fullPotentialModels.id, modelId))
    .limit(1);
  if (!model) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Full Potential model not found" });
  }
  return model;
}

export async function createFullPotentialModelDraft(
  accountId: number,
  actor: FullPotentialActor,
) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }

  return db.transaction(async tx => {
    const [account] = await tx
      .select()
      .from(fullPotentialAccounts)
      .where(eq(fullPotentialAccounts.id, accountId))
      .limit(1);
    if (!account) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Full Potential account not found" });
    }
    assertAccountEligibleForModel(account);

    const [activeModel] = await tx
      .select()
      .from(fullPotentialModels)
      .where(
        and(
          eq(fullPotentialModels.accountId, accountId),
          inArray(fullPotentialModels.status, [...FP_MODEL_ACTIVE_STATUSES]),
        ),
      )
      .orderBy(desc(fullPotentialModels.versionNumber))
      .limit(1);

    if (activeModel) {
      if (actor.role !== "admin" && activeModel.createdBy !== actor.id) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This account already has an active model owned by another user",
        });
      }
      return { model: activeModel, alreadyExists: true };
    }

    const [versionRow] = await tx
      .select({
        maxVersion: sql<number>`COALESCE(MAX(${fullPotentialModels.versionNumber}), 0)`,
      })
      .from(fullPotentialModels)
      .where(eq(fullPotentialModels.accountId, accountId));

    const versionNumber = Number(versionRow?.maxVersion ?? 0) + 1;
    const modelKey = `fp-model:${accountId}:v${versionNumber}`;
    const result = await tx.insert(fullPotentialModels).values({
      modelKey,
      accountId,
      versionNumber,
      status: "draft",
      methodologyVersion: FP_MODEL_METHOD_VERSION,
      currentRevenueAud: account.currentRevenueAud,
      totalPotentialAud: "0.00",
      remainingPotentialAud: "0.00",
      confidenceLevel: "unknown",
      createdBy: actor.id,
      createdByName: fullPotentialActorName(actor),
    });

    const modelId = Number(result[0].insertId);
    const model = await loadFullPotentialModel(tx, modelId);
    await tx.insert(fullPotentialModelReviews).values({
      modelId,
      accountId,
      action: "created",
      fromStatus: null,
      toStatus: "draft",
      userId: actor.id,
      userName: fullPotentialActorName(actor),
      note: `Created Full Potential model version ${versionNumber}`,
    });

    return { model, alreadyExists: false };
  });
}

export async function addFullPotentialEvidence(
  input: AddFullPotentialEvidenceInput,
  actor: FullPotentialActor,
) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }

  const [account] = await db
    .select({ id: fullPotentialAccounts.id })
    .from(fullPotentialAccounts)
    .where(eq(fullPotentialAccounts.id, input.accountId))
    .limit(1);
  if (!account) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Full Potential account not found" });
  }

  const result = await db.insert(fullPotentialEvidence).values({
    accountId: input.accountId,
    productFamily: input.productFamily ?? null,
    evidenceType: input.evidenceType,
    title: requiredText(input.title, "title", 512),
    summary: requiredText(input.summary, "summary", 10000),
    sourceName: optionalText(input.sourceName, 256),
    sourceUrl: optionalText(input.sourceUrl, 1024),
    sourceReference: optionalText(input.sourceReference, 512),
    observedAt: input.observedAt ?? null,
    capturedBy: actor.id,
    capturedByName: fullPotentialActorName(actor),
    confidenceLevel: input.confidenceLevel,
    status: "draft",
  });

  const evidenceId = Number(result[0].insertId);
  const [evidence] = await db
    .select()
    .from(fullPotentialEvidence)
    .where(eq(fullPotentialEvidence.id, evidenceId))
    .limit(1);
  return evidence;
}

export async function reviewFullPotentialEvidence(
  evidenceId: number,
  decision: "verified" | "rejected" | "superseded",
  note: string,
  actor: FullPotentialActor,
) {
  if (actor.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only an admin can review Full Potential evidence",
    });
  }

  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }

  const [evidence] = await db
    .select()
    .from(fullPotentialEvidence)
    .where(eq(fullPotentialEvidence.id, evidenceId))
    .limit(1);
  if (!evidence) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Evidence record not found" });
  }

  await db
    .update(fullPotentialEvidence)
    .set({
      status: decision,
      reviewNote: requiredText(note, "review note", 10000),
      reviewedBy: actor.id,
      reviewedByName: fullPotentialActorName(actor),
      reviewedAt: new Date(),
    })
    .where(eq(fullPotentialEvidence.id, evidenceId));

  const [updated] = await db
    .select()
    .from(fullPotentialEvidence)
    .where(eq(fullPotentialEvidence.id, evidenceId))
    .limit(1);
  return updated as FullPotentialEvidence;
}
