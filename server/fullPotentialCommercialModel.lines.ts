import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  fullPotentialEvidence,
  fullPotentialModelEvidenceLinks,
  fullPotentialModelLines,
  fullPotentialModels,
} from "../drizzle/schema";
import type {
  FullPotentialEvidence,
  FullPotentialModel,
  FullPotentialModelLine,
} from "../drizzle/schema";
import {
  audMoney,
  calculateModelLine,
  deriveModelConfidence,
  evidenceLinkKey,
  modelLineKey,
  numberValue,
  optionalText,
  requiredText,
} from "./fullPotentialCommercialModel.shared";
import type {
  FullPotentialActor,
  FullPotentialModelLineInput,
} from "./fullPotentialCommercialModel.shared";
import {
  assertModelEditor,
  loadFullPotentialModel,
} from "./fullPotentialCommercialModel.model";

async function recomputeModelTotals(tx: any, model: FullPotentialModel): Promise<void> {
  const lines = await tx
    .select()
    .from(fullPotentialModelLines)
    .where(eq(fullPotentialModelLines.modelId, model.id));

  const totalPotential = lines.reduce(
    (sum: number, line: FullPotentialModelLine) => sum + numberValue(line.linePotentialAud),
    0,
  );
  const currentRevenue = numberValue(model.currentRevenueAud);

  await tx
    .update(fullPotentialModels)
    .set({
      totalPotentialAud: audMoney(totalPotential),
      remainingPotentialAud: audMoney(Math.max(totalPotential - currentRevenue, 0)),
      confidenceLevel: deriveModelConfidence(lines),
    })
    .where(eq(fullPotentialModels.id, model.id));
}

export async function upsertFullPotentialModelLine(
  input: FullPotentialModelLineInput,
  actor: FullPotentialActor,
) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }

  return db.transaction(async tx => {
    const model = await loadFullPotentialModel(tx, input.modelId);
    assertModelEditor(model, actor);

    const application = requiredText(input.application, "application", 256);
    const lineKey = modelLineKey(model.id, input.productFamily, application);
    const calculated = calculateModelLine(input);

    const [existingLine] = await tx
      .select()
      .from(fullPotentialModelLines)
      .where(eq(fullPotentialModelLines.lineKey, lineKey))
      .limit(1);

    const lineValues = {
      modelId: model.id,
      accountId: model.accountId,
      productFamily: input.productFamily,
      application,
      routeToMarket: input.routeToMarket,
      currentSupplier: optionalText(input.currentSupplier, 256),
      currentRevenueAud: calculated.currentRevenueAud,
      knownAtlasFleetUnits: input.knownAtlasFleetUnits ?? null,
      estimatedTotalFleetUnits: input.estimatedTotalFleetUnits ?? null,
      replacementCycleYears: calculated.replacementCycleYears,
      annualReplacementUnits: calculated.annualReplacementUnits,
      averageSellingPriceAud: calculated.averageSellingPriceAud,
      addressableSharePct: calculated.addressableSharePct,
      equipmentPotentialAud: calculated.equipmentPotentialAud,
      specialtyPotentialAud: calculated.specialtyPotentialAud,
      linePotentialAud: calculated.linePotentialAud,
      replacementCycleSource: optionalText(input.replacementCycleSource, 512),
      assumptions: input.assumptions ?? null,
      confidenceLevel: input.confidenceLevel,
      updatedBy: actor.id,
    };

    let lineId: number;
    if (existingLine) {
      await tx
        .update(fullPotentialModelLines)
        .set(lineValues)
        .where(eq(fullPotentialModelLines.id, existingLine.id));
      lineId = existingLine.id;
    } else {
      const result = await tx.insert(fullPotentialModelLines).values({
        lineKey,
        ...lineValues,
        createdBy: actor.id,
      });
      lineId = Number(result[0].insertId);
    }

    await tx
      .delete(fullPotentialModelEvidenceLinks)
      .where(eq(fullPotentialModelEvidenceLinks.modelLineId, lineId));

    const evidenceIds = [...new Set(input.evidenceIds)];
    if (evidenceIds.length > 0) {
      const evidenceRows = await tx
        .select()
        .from(fullPotentialEvidence)
        .where(inArray(fullPotentialEvidence.id, evidenceIds));

      const invalid =
        evidenceRows.length !== evidenceIds.length ||
        evidenceRows.some(
          (row: FullPotentialEvidence) => row.accountId !== model.accountId || row.status === "rejected",
        );
      if (invalid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Every linked evidence record must belong to the account and must not be rejected",
        });
      }

      await tx.insert(fullPotentialModelEvidenceLinks).values(
        evidenceIds.map(evidenceId => ({
          linkKey: evidenceLinkKey(model.id, lineId, evidenceId),
          modelId: model.id,
          modelLineId: lineId,
          evidenceId,
          createdBy: actor.id,
        })),
      );
    }

    await recomputeModelTotals(tx, model);

    const [line] = await tx
      .select()
      .from(fullPotentialModelLines)
      .where(eq(fullPotentialModelLines.id, lineId))
      .limit(1);
    const [updatedModel] = await tx
      .select()
      .from(fullPotentialModels)
      .where(eq(fullPotentialModels.id, model.id))
      .limit(1);

    return { line, model: updatedModel };
  });
}

export async function removeFullPotentialModelLine(
  lineId: number,
  actor: FullPotentialActor,
) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }

  return db.transaction(async tx => {
    const [line] = await tx
      .select()
      .from(fullPotentialModelLines)
      .where(eq(fullPotentialModelLines.id, lineId))
      .limit(1);
    if (!line) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Model line not found" });
    }

    const model = await loadFullPotentialModel(tx, line.modelId);
    assertModelEditor(model, actor);

    await tx
      .delete(fullPotentialModelEvidenceLinks)
      .where(eq(fullPotentialModelEvidenceLinks.modelLineId, lineId));
    await tx
      .delete(fullPotentialModelLines)
      .where(eq(fullPotentialModelLines.id, lineId));
    await recomputeModelTotals(tx, model);

    return { deleted: true };
  });
}
