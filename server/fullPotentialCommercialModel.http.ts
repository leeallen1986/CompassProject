import type { Request, Response } from "express";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { FP_PRODUCT_FAMILIES } from "@shared/const";
import { sdk } from "./_core/sdk";
import { getFullPotentialCommercialWorkspace } from "./fullPotentialCommercialModel.read";
import {
  addFullPotentialEvidence,
  createFullPotentialModelDraft,
  reviewFullPotentialEvidence,
} from "./fullPotentialCommercialModel.model";
import {
  removeFullPotentialModelLine,
  upsertFullPotentialModelLine,
} from "./fullPotentialCommercialModel.lines";
import {
  reviewFullPotentialModel,
  submitFullPotentialModel,
} from "./fullPotentialCommercialModel.workflow";
import { updateFullPotentialAccountRelationship } from "./fullPotentialCommercialModel.relationships";
import {
  FP_CONFIDENCE_LEVELS,
  FP_EVIDENCE_TYPES,
  FP_RECORD_STATUSES,
  FP_RELATIONSHIP_TYPES,
  FP_ROUTE_VALUES,
} from "./fullPotentialCommercialModel.shared";

const idParam = z.coerce.number().int().positive();
const optionalAud = z
  .string()
  .trim()
  .regex(/^\d{1,12}(?:\.\d{1,2})?$/, "Use a non-negative number with at most two decimal places")
  .optional()
  .nullable();
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

const evidenceSchema = z.object({
  accountId: z.number().int().positive(),
  productFamily: z.enum(FP_PRODUCT_FAMILIES).optional().nullable(),
  evidenceType: z.enum(FP_EVIDENCE_TYPES),
  title: z.string().trim().min(3).max(512),
  summary: z.string().trim().min(3).max(10000),
  sourceName: optionalText(256),
  sourceUrl: z.string().trim().url().max(1024).optional().nullable(),
  sourceReference: optionalText(512),
  observedAt: z.coerce.date().optional().nullable(),
  confidenceLevel: z.enum(FP_CONFIDENCE_LEVELS),
});

const evidenceReviewSchema = z.object({
  decision: z.enum(["verified", "rejected", "superseded"]),
  note: z.string().trim().min(3).max(10000),
});

const modelLineSchema = z.object({
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
});

const submitSchema = z.object({
  assumptionsSummary: z.string().trim().min(10).max(10000),
});

const modelReviewSchema = z.object({
  decision: z.enum(["approve", "return"]),
  note: z.string().trim().min(3).max(10000),
});

const relationshipSchema = z.object({
  parentAccountId: z.number().int().positive().optional().nullable(),
  mergedIntoAccountId: z.number().int().positive().optional().nullable(),
  relationshipType: z.enum(FP_RELATIONSHIP_TYPES),
  recordStatus: z.enum(FP_RECORD_STATUSES),
  countsTowardPotential: z.boolean(),
});

type AuthenticatedUser = Awaited<ReturnType<typeof sdk.authenticateRequest>>;

function actor(user: AuthenticatedUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

async function authenticateInternal(req: Request, res: Response): Promise<AuthenticatedUser | null> {
  try {
    const user = await sdk.authenticateRequest(req);
    if (user.role === "distributor") {
      res.status(403).json({ error: "Full Potential commercial modelling requires internal sales access" });
      return null;
    }
    return user;
  } catch {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
}

function sendError(res: Response, error: unknown, operation: string) {
  if (error instanceof TRPCError) {
    const status =
      error.code === "UNAUTHORIZED" ? 401 :
      error.code === "FORBIDDEN" ? 403 :
      error.code === "NOT_FOUND" ? 404 :
      error.code === "CONFLICT" ? 409 :
      error.code === "BAD_REQUEST" ? 400 : 500;
    return res.status(status).json({ error: error.message, code: error.code });
  }
  console.error(`[FullPotentialCommercialModel] ${operation} failed`, error);
  return res.status(500).json({ error: `${operation} failed` });
}

export async function handleGetFullPotentialCommercialWorkspace(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  const user = await authenticateInternal(req, res);
  if (!user) return;
  const parsedId = idParam.safeParse(req.params.accountId);
  if (!parsedId.success) return res.status(400).json({ error: "Invalid accountId" });
  try {
    return res.json(await getFullPotentialCommercialWorkspace(parsedId.data));
  } catch (error) {
    return sendError(res, error, "Load commercial model workspace");
  }
}

export async function handleCreateFullPotentialModelDraft(req: Request, res: Response) {
  const user = await authenticateInternal(req, res);
  if (!user) return;
  const parsedId = idParam.safeParse(req.params.accountId);
  if (!parsedId.success) return res.status(400).json({ error: "Invalid accountId" });
  try {
    return res.json(await createFullPotentialModelDraft(parsedId.data, actor(user)));
  } catch (error) {
    return sendError(res, error, "Create commercial model draft");
  }
}

export async function handleAddFullPotentialEvidence(req: Request, res: Response) {
  const user = await authenticateInternal(req, res);
  if (!user) return;
  const parsed = evidenceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid evidence record", details: parsed.error.flatten() });
  }
  try {
    return res.json(await addFullPotentialEvidence(parsed.data, actor(user)));
  } catch (error) {
    return sendError(res, error, "Add evidence");
  }
}

export async function handleReviewFullPotentialEvidence(req: Request, res: Response) {
  const user = await authenticateInternal(req, res);
  if (!user) return;
  if (user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  const parsedId = idParam.safeParse(req.params.evidenceId);
  const parsed = evidenceReviewSchema.safeParse(req.body);
  if (!parsedId.success || !parsed.success) {
    return res.status(400).json({ error: "Invalid evidence review", details: parsed.success ? undefined : parsed.error.flatten() });
  }
  try {
    return res.json(
      await reviewFullPotentialEvidence(parsedId.data, parsed.data.decision, parsed.data.note, actor(user)),
    );
  } catch (error) {
    return sendError(res, error, "Review evidence");
  }
}

export async function handleUpsertFullPotentialModelLine(req: Request, res: Response) {
  const user = await authenticateInternal(req, res);
  if (!user) return;
  const parsed = modelLineSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid model line", details: parsed.error.flatten() });
  }
  try {
    return res.json(await upsertFullPotentialModelLine(parsed.data, actor(user)));
  } catch (error) {
    return sendError(res, error, "Save model line");
  }
}

export async function handleRemoveFullPotentialModelLine(req: Request, res: Response) {
  const user = await authenticateInternal(req, res);
  if (!user) return;
  const parsedId = idParam.safeParse(req.params.lineId);
  if (!parsedId.success) return res.status(400).json({ error: "Invalid lineId" });
  try {
    return res.json(await removeFullPotentialModelLine(parsedId.data, actor(user)));
  } catch (error) {
    return sendError(res, error, "Remove model line");
  }
}

export async function handleSubmitFullPotentialModel(req: Request, res: Response) {
  const user = await authenticateInternal(req, res);
  if (!user) return;
  const parsedId = idParam.safeParse(req.params.modelId);
  const parsed = submitSchema.safeParse(req.body);
  if (!parsedId.success || !parsed.success) {
    return res.status(400).json({ error: "Invalid model submission", details: parsed.success ? undefined : parsed.error.flatten() });
  }
  try {
    return res.json(await submitFullPotentialModel(parsedId.data, parsed.data.assumptionsSummary, actor(user)));
  } catch (error) {
    return sendError(res, error, "Submit model");
  }
}

export async function handleReviewFullPotentialModel(req: Request, res: Response) {
  const user = await authenticateInternal(req, res);
  if (!user) return;
  if (user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  const parsedId = idParam.safeParse(req.params.modelId);
  const parsed = modelReviewSchema.safeParse(req.body);
  if (!parsedId.success || !parsed.success) {
    return res.status(400).json({ error: "Invalid model review", details: parsed.success ? undefined : parsed.error.flatten() });
  }
  try {
    return res.json(await reviewFullPotentialModel(parsedId.data, parsed.data.decision, parsed.data.note, actor(user)));
  } catch (error) {
    return sendError(res, error, "Review model");
  }
}

export async function handleUpdateFullPotentialRelationship(req: Request, res: Response) {
  const user = await authenticateInternal(req, res);
  if (!user) return;
  if (user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  const parsedId = idParam.safeParse(req.params.accountId);
  const parsed = relationshipSchema.safeParse(req.body);
  if (!parsedId.success || !parsed.success) {
    return res.status(400).json({ error: "Invalid account relationship", details: parsed.success ? undefined : parsed.error.flatten() });
  }
  try {
    return res.json(
      await updateFullPotentialAccountRelationship(
        { accountId: parsedId.data, ...parsed.data },
        actor(user),
      ),
    );
  } catch (error) {
    return sendError(res, error, "Update account relationship");
  }
}
