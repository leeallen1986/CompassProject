import type { Request, Response } from "express";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sdk } from "./_core/sdk";
import {
  generateFullPotentialDailyAiBrief,
  getFullPotentialDailyActivation,
  respondToFullPotentialDailyRecommendation,
} from "./fullPotentialDailyActivation";

const responseSchema = z.object({
  recommendationKey: z.string().min(10).max(180),
  decision: z.enum(["accepted", "edited", "deferred", "rejected", "not_relevant"]),
  editedAction: z.string().trim().min(3).max(512).optional().nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  reason: z.string().trim().min(3).max(1000).optional().nullable(),
});

const briefSchema = z.object({
  accountId: z.number().int().positive(),
});

type AuthenticatedUser = Awaited<ReturnType<typeof sdk.authenticateRequest>>;

async function authenticateInternal(req: Request, res: Response): Promise<AuthenticatedUser | null> {
  try {
    const user = await sdk.authenticateRequest(req);
    if (user.role === "distributor") {
      res.status(403).json({ error: "Full Potential daily activation requires internal sales access" });
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
  console.error(`[FullPotentialDailyActivation] ${operation} failed`, error);
  return res.status(500).json({ error: `${operation} failed` });
}

export async function handleGetFullPotentialDailyActivation(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  const user = await authenticateInternal(req, res);
  if (!user) return;
  try {
    return res.json(await getFullPotentialDailyActivation(user));
  } catch (error) {
    return sendError(res, error, "Load daily activation");
  }
}

export async function handleRespondFullPotentialDailyActivation(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  const user = await authenticateInternal(req, res);
  if (!user) return;
  const parsed = responseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid recommendation response", details: parsed.error.flatten() });
  }
  try {
    return res.json(await respondToFullPotentialDailyRecommendation(parsed.data, user));
  } catch (error) {
    return sendError(res, error, "Respond to recommendation");
  }
}

export async function handleGenerateFullPotentialDailyBrief(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  const user = await authenticateInternal(req, res);
  if (!user) return;
  const parsed = briefSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid accountId", details: parsed.error.flatten() });
  }
  try {
    return res.json(await generateFullPotentialDailyAiBrief(parsed.data.accountId, user));
  } catch (error) {
    return sendError(res, error, "Generate grounded AI brief");
  }
}
