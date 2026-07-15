import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  fullPotentialAccounts,
  fullPotentialEvidence,
  fullPotentialModelEvidenceLinks,
  fullPotentialModelLines,
  fullPotentialModelReviews,
  fullPotentialModels,
} from "../drizzle/schema";
import type {
  FullPotentialEvidence,
  FullPotentialModelLine,
} from "../drizzle/schema";
import {
  audMoney,
  deriveModelConfidence,
  fullPotentialActorName,
  numberValue,
  requiredText,
} from "./fullPotentialCommercialModel.shared";
import type { FullPotentialActor } from "./fullPotentialCommercialModel.shared";
import {
  assertAccountEligibleForModel,
  assertModelEditor,
  loadFullPotentialModel,
} from "./fullPotentialCommercialModel.model";

export async function submitFullPotentialModel(
  modelId: number,
  assumptionsSummary: string,
  actor: FullPotentialActor,
) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }

  return db.transaction(async tx => {
    const model = await loadFullPotentialModel(tx, modelId);
    assertModelEditor(model, actor);

    const lines = await tx
      .select()
      .from(fullPotentialModelLines)
      .where(eq(fullPotentialModelLines.modelId, modelId));
    if (lines.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Add at least one product-family model line before submission",
      });
    }
    if (lines.some((line: FullPotentialModelLine) => numberValue(line.linePotentialAud) <= 0)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Every submitted model line must have a positive calculated potential",
      });
    }
    if (lines.some((line: FullPotentialModelLine) => line.confidenceLevel === "unknown")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Every submitted model line must have a confidence rating",
      });
    }

    const lineIds = lines.map((line: FullPotentialModelLine) => line.id);
    const links = await tx
      .select()
      .from(fullPotentialModelEvidenceLinks)
      .where(inArray(fullPotentialModelEvidenceLinks.modelLineId, lineIds));
    const linkedLineIds = new Set(links.map((link: any) => link.modelLineId));
    if (lineIds.some((lineId: number) => !linkedLineIds.has(lineId))) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Every submitted model line must be linked to at least one evidence record",
      });
    }

    const totalPotential = lines.reduce(
      (sum: number, line: FullPotentialModelLine) => sum + numberValue(line.linePotentialAud),
      0,
    );
    const currentRevenue = numberValue(model.currentRevenueAud);
    const remainingPotential = Math.max(totalPotential - currentRevenue, 0);
    const confidenceLevel = deriveModelConfidence(lines);
    const summary = requiredText(assumptionsSummary, "assumptions summary", 10000);
    const submittedAt = new Date();

    await tx
      .update(fullPotentialModels)
      .set({
        status: "submitted",
        assumptionsSummary: summary,
        totalPotentialAud: audMoney(totalPotential),
        remainingPotentialAud: audMoney(remainingPotential),
        confidenceLevel,
        submittedBy: actor.id,
        submittedByName: fullPotentialActorName(actor),
        submittedAt,
        reviewNotes: null,
      })
      .where(eq(fullPotentialModels.id, modelId));

    await tx.insert(fullPotentialModelReviews).values({
      modelId,
      accountId: model.accountId,
      action: "submitted",
      fromStatus: model.status,
      toStatus: "submitted",
      userId: actor.id,
      userName: fullPotentialActorName(actor),
      note: summary,
    });

    return {
      status: "submitted" as const,
      totalPotentialAud: audMoney(totalPotential),
      remainingPotentialAud: audMoney(remainingPotential),
      confidenceLevel,
      submittedAt,
    };
  });
}

export async function reviewFullPotentialModel(
  modelId: number,
  decision: "approve" | "return",
  note: string,
  actor: FullPotentialActor,
) {
  if (actor.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only an admin can approve or return a Full Potential model",
    });
  }

  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }

  return db.transaction(async tx => {
    const model = await loadFullPotentialModel(tx, modelId);
    if (model.status !== "submitted") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only a submitted model can be reviewed" });
    }

    const reviewNote = requiredText(note, "review note", 10000);
    const reviewedAt = new Date();

    if (decision === "return") {
      await tx
        .update(fullPotentialModels)
        .set({
          status: "returned",
          reviewedBy: actor.id,
          reviewedByName: fullPotentialActorName(actor),
          reviewedAt,
          reviewNotes: reviewNote,
        })
        .where(eq(fullPotentialModels.id, modelId));

      await tx.insert(fullPotentialModelReviews).values({
        modelId,
        accountId: model.accountId,
        action: "returned",
        fromStatus: "submitted",
        toStatus: "returned",
        userId: actor.id,
        userName: fullPotentialActorName(actor),
        note: reviewNote,
      });
      return { status: "returned" as const };
    }

    const [account] = await tx
      .select()
      .from(fullPotentialAccounts)
      .where(eq(fullPotentialAccounts.id, model.accountId))
      .limit(1);
    if (!account) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Full Potential account not found" });
    }
    assertAccountEligibleForModel(account);

    const lines = await tx
      .select()
      .from(fullPotentialModelLines)
      .where(eq(fullPotentialModelLines.modelId, modelId));
    if (
      lines.length === 0 ||
      lines.some((line: FullPotentialModelLine) => numberValue(line.linePotentialAud) <= 0)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Approved models require positive calculated product-family lines",
      });
    }
    if (lines.some((line: FullPotentialModelLine) => line.confidenceLevel === "unknown")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Approved models cannot contain unknown-confidence lines",
      });
    }

    const lineIds = lines.map((line: FullPotentialModelLine) => line.id);
    const links = await tx
      .select()
      .from(fullPotentialModelEvidenceLinks)
      .where(inArray(fullPotentialModelEvidenceLinks.modelLineId, lineIds));
    const evidenceIds = [...new Set(links.map((link: any) => link.evidenceId))];
    const evidenceRows = evidenceIds.length > 0
      ? await tx
          .select()
          .from(fullPotentialEvidence)
          .where(inArray(fullPotentialEvidence.id, evidenceIds))
      : [];

    const verifiedEvidenceIds = new Set(
      evidenceRows
        .filter((evidence: FullPotentialEvidence) => evidence.status === "verified")
        .map((evidence: FullPotentialEvidence) => evidence.id),
    );
    const verifiedLineIds = new Set(
      links
        .filter((link: any) => verifiedEvidenceIds.has(link.evidenceId))
        .map((link: any) => link.modelLineId),
    );
    if (lineIds.some((lineId: number) => !verifiedLineIds.has(lineId))) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Every approved model line must have at least one verified evidence record",
      });
    }

    const totalPotential = lines.reduce(
      (sum: number, line: FullPotentialModelLine) => sum + numberValue(line.linePotentialAud),
      0,
    );
    const currentRevenue = numberValue(model.currentRevenueAud ?? account.currentRevenueAud);
    const remainingPotential = Math.max(totalPotential - currentRevenue, 0);
    const confidenceLevel = deriveModelConfidence(lines);
    const sourceLabels = [...new Set(
      evidenceRows
        .filter((evidence: FullPotentialEvidence) => evidence.status === "verified")
        .map((evidence: FullPotentialEvidence) => evidence.sourceName || evidence.evidenceType),
    )];

    const previousApproved = await tx
      .select()
      .from(fullPotentialModels)
      .where(
        and(
          eq(fullPotentialModels.accountId, model.accountId),
          eq(fullPotentialModels.status, "approved"),
        ),
      );

    for (const previous of previousApproved) {
      await tx
        .update(fullPotentialModels)
        .set({ status: "superseded" })
        .where(eq(fullPotentialModels.id, previous.id));
      await tx.insert(fullPotentialModelReviews).values({
        modelId: previous.id,
        accountId: model.accountId,
        action: "superseded",
        fromStatus: "approved",
        toStatus: "superseded",
        userId: actor.id,
        userName: fullPotentialActorName(actor),
        note: `Superseded by model ${model.modelKey}`,
      });
    }

    await tx
      .update(fullPotentialModels)
      .set({
        status: "approved",
        totalPotentialAud: audMoney(totalPotential),
        remainingPotentialAud: audMoney(remainingPotential),
        confidenceLevel,
        reviewedBy: actor.id,
        reviewedByName: fullPotentialActorName(actor),
        reviewedAt,
        reviewNotes: reviewNote,
        approvedAt: reviewedAt,
      })
      .where(eq(fullPotentialModels.id, modelId));

    await tx
      .update(fullPotentialAccounts)
      .set({
        fullPotentialAud: audMoney(totalPotential),
        remainingPotentialAud: audMoney(remainingPotential),
        confidenceLevel,
        evidenceSources: sourceLabels,
      })
      .where(eq(fullPotentialAccounts.id, model.accountId));

    await tx.insert(fullPotentialModelReviews).values({
      modelId,
      accountId: model.accountId,
      action: "approved",
      fromStatus: "submitted",
      toStatus: "approved",
      userId: actor.id,
      userName: fullPotentialActorName(actor),
      note: reviewNote,
    });

    return {
      status: "approved" as const,
      totalPotentialAud: audMoney(totalPotential),
      remainingPotentialAud: audMoney(remainingPotential),
      confidenceLevel,
    };
  });
}
