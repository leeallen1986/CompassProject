import { z } from "zod";
import { FP_PRODUCT_FAMILIES } from "@shared/const";
import {
  adminProcedure,
  internalSalesProcedure,
  router,
} from "../_core/trpc";
import { getFullPotentialCommercialWorkspace } from "../fullPotentialCommercialModel.read";
import {
  addFullPotentialEvidence,
  createFullPotentialModelDraft,
  reviewFullPotentialEvidence,
} from "../fullPotentialCommercialModel.model";
import {
  removeFullPotentialModelLine,
  upsertFullPotentialModelLine,
} from "../fullPotentialCommercialModel.lines";
import {
  reviewFullPotentialModel,
  submitFullPotentialModel,
} from "../fullPotentialCommercialModel.workflow";
import { updateFullPotentialAccountRelationship } from "../fullPotentialCommercialModel.relationships";
import {
  FP_CONFIDENCE_LEVELS,
  FP_EVIDENCE_TYPES,
  FP_RECORD_STATUSES,
  FP_RELATIONSHIP_TYPES,
  FP_ROUTE_VALUES,
} from "../fullPotentialCommercialModel.shared";

const optionalAud = z
  .string()
  .trim()
  .regex(/^\d{1,12}(?:\.\d{1,2})?$/, "Use a non-negative number with at most two decimal places")
  .optional()
  .nullable();

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

function actor(user: {
  id: number;
  name?: string | null;
  email?: string | null;
  role?: "user" | "admin" | "distributor";
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

export const fullPotentialCommercialModelRouter = router({
  workspace: internalSalesProcedure
    .input(z.object({ accountId: z.number().int().positive() }))
    .query(({ input }) => getFullPotentialCommercialWorkspace(input.accountId)),

  createDraft: internalSalesProcedure
    .input(z.object({ accountId: z.number().int().positive() }))
    .mutation(({ ctx, input }) => createFullPotentialModelDraft(input.accountId, actor(ctx.user))),

  addEvidence: internalSalesProcedure
    .input(z.object({
      accountId: z.number().int().positive(),
      productFamily: z.enum(FP_PRODUCT_FAMILIES).optional().nullable(),
      evidenceType: z.enum(FP_EVIDENCE_TYPES),
      title: z.string().trim().min(3).max(512),
      summary: z.string().trim().min(3).max(10000),
      sourceName: optionalText(256),
      sourceUrl: z.string().trim().url().max(1024).optional().nullable(),
      sourceReference: optionalText(512),
      observedAt: z.date().optional().nullable(),
      confidenceLevel: z.enum(FP_CONFIDENCE_LEVELS),
    }))
    .mutation(({ ctx, input }) => addFullPotentialEvidence(input, actor(ctx.user))),

  reviewEvidence: adminProcedure
    .input(z.object({
      evidenceId: z.number().int().positive(),
      decision: z.enum(["verified", "rejected", "superseded"]),
      note: z.string().trim().min(3).max(10000),
    }))
    .mutation(({ ctx, input }) =>
      reviewFullPotentialEvidence(input.evidenceId, input.decision, input.note, actor(ctx.user)),
    ),

  upsertLine: internalSalesProcedure
    .input(z.object({
      modelId: z.number().int().positive(),
      productFamily: z.enum(FP_PRODUCT_FAMILIES),
      application: z.string().trim().min(3).max(256),
      routeToMarket: z.enum(FP_ROUTE_VALUES),
      currentSupplier: optionalText(256),
      currentRevenueAud: optionalAud,
      knownAtlasFleetUnits: z.number().int().min(0).optional().nullable(),
      estimatedTotalFleetUnits: z.number().int().min(0).optional().nullable(),
      replacementCycleYears: optionalAud,
      annualReplacementUnits: optionalAud,
      averageSellingPriceAud: optionalAud,
      addressableSharePct: optionalAud,
      specialtyPotentialAud: optionalAud,
      replacementCycleSource: optionalText(512),
      assumptions: z.record(z.string(), z.unknown()).optional().nullable(),
      confidenceLevel: z.enum(FP_CONFIDENCE_LEVELS),
      evidenceIds: z.array(z.number().int().positive()).max(100).default([]),
    }))
    .mutation(({ ctx, input }) => upsertFullPotentialModelLine(input, actor(ctx.user))),

  removeLine: internalSalesProcedure
    .input(z.object({ lineId: z.number().int().positive() }))
    .mutation(({ ctx, input }) => removeFullPotentialModelLine(input.lineId, actor(ctx.user))),

  submit: internalSalesProcedure
    .input(z.object({
      modelId: z.number().int().positive(),
      assumptionsSummary: z.string().trim().min(10).max(10000),
    }))
    .mutation(({ ctx, input }) =>
      submitFullPotentialModel(input.modelId, input.assumptionsSummary, actor(ctx.user)),
    ),

  review: adminProcedure
    .input(z.object({
      modelId: z.number().int().positive(),
      decision: z.enum(["approve", "return"]),
      note: z.string().trim().min(3).max(10000),
    }))
    .mutation(({ ctx, input }) =>
      reviewFullPotentialModel(input.modelId, input.decision, input.note, actor(ctx.user)),
    ),

  updateRelationship: adminProcedure
    .input(z.object({
      accountId: z.number().int().positive(),
      parentAccountId: z.number().int().positive().optional().nullable(),
      mergedIntoAccountId: z.number().int().positive().optional().nullable(),
      relationshipType: z.enum(FP_RELATIONSHIP_TYPES),
      recordStatus: z.enum(FP_RECORD_STATUSES),
      countsTowardPotential: z.boolean(),
    }))
    .mutation(({ ctx, input }) => updateFullPotentialAccountRelationship(input, actor(ctx.user))),
});
