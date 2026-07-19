import type { Request, Response } from "express";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sdk } from "./_core/sdk";
import {
  getAwardedProjectFullPotentialContexts,
  getProjectFullPotentialContext,
  getProjectFullPotentialContexts,
  resolveFullPotentialAccountName,
} from "./fullPotentialAccountMatching";

interface AccountMatchingDependencies {
  authenticateRequest: typeof sdk.authenticateRequest;
  getProjectContext: typeof getProjectFullPotentialContext;
  getProjectContexts: typeof getProjectFullPotentialContexts;
  getAwardedContexts: typeof getAwardedProjectFullPotentialContexts;
  resolveAccountName: typeof resolveFullPotentialAccountName;
}

const defaultDependencies: AccountMatchingDependencies = {
  authenticateRequest: sdk.authenticateRequest.bind(sdk),
  getProjectContext: getProjectFullPotentialContext,
  getProjectContexts: getProjectFullPotentialContexts,
  getAwardedContexts: getAwardedProjectFullPotentialContexts,
  resolveAccountName: resolveFullPotentialAccountName,
};

const positiveId = z.coerce.number().int().positive();
const accountNameQuery = z.object({
  name: z.string().trim().min(2).max(512),
  state: z.string().trim().max(64).optional(),
});

function parseProjectIds(value: unknown): number[] {
  const raw = Array.isArray(value) ? value.join(",") : String(value ?? "");
  const tokens = raw.split(",").map(token => token.trim()).filter(Boolean);
  if (tokens.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "projectIds is required" });
  }
  if (tokens.length > 250) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A maximum of 250 project IDs may be resolved at once" });
  }
  const ids = [...new Set(tokens.map(token => Number(token)))];
  if (ids.some(id => !Number.isInteger(id) || id <= 0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "projectIds must contain positive integers" });
  }
  return ids;
}

async function authenticateInternal(
  req: Request,
  res: Response,
  dependencies: AccountMatchingDependencies,
): Promise<boolean> {
  try {
    const user = await dependencies.authenticateRequest(req);
    if (user.role === "distributor") {
      res.status(403).json({ error: "Project-to-account matching requires internal sales access" });
      return false;
    }
    return true;
  } catch {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
}

function sendError(res: Response, error: unknown, operation: string) {
  if (error instanceof TRPCError) {
    const status =
      error.code === "UNAUTHORIZED" ? 401
        : error.code === "FORBIDDEN" ? 403
          : error.code === "NOT_FOUND" ? 404
            : error.code === "CONFLICT" ? 409
              : error.code === "BAD_REQUEST" ? 400
                : 500;
    return res.status(status).json({ error: error.message, code: error.code });
  }
  console.error(`[FullPotentialAccountMatching] ${operation} failed`, error);
  return res.status(500).json({ error: `${operation} failed` });
}

export function createFullPotentialAccountMatchingHandlers(
  dependencies: AccountMatchingDependencies = defaultDependencies,
) {
  return {
    async project(req: Request, res: Response) {
      res.setHeader("Cache-Control", "private, no-store");
      if (!await authenticateInternal(req, res, dependencies)) return;
      const parsed = positiveId.safeParse(req.params.projectId);
      if (!parsed.success) return res.status(400).json({ error: "Invalid projectId" });
      try {
        return res.json(await dependencies.getProjectContext(parsed.data));
      } catch (error) {
        return sendError(res, error, "Resolve project account context");
      }
    },

    async projects(req: Request, res: Response) {
      res.setHeader("Cache-Control", "private, no-store");
      if (!await authenticateInternal(req, res, dependencies)) return;
      try {
        const projectIds = parseProjectIds(req.query.projectIds);
        return res.json({ projectIds, results: await dependencies.getProjectContexts(projectIds) });
      } catch (error) {
        return sendError(res, error, "Resolve project account contexts");
      }
    },

    async awarded(req: Request, res: Response) {
      res.setHeader("Cache-Control", "private, no-store");
      if (!await authenticateInternal(req, res, dependencies)) return;
      const limit = req.query.limit === undefined ? 250 : Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return res.status(400).json({ error: "limit must be an integer between 1 and 500" });
      }
      try {
        return res.json({ results: await dependencies.getAwardedContexts(limit) });
      } catch (error) {
        return sendError(res, error, "Resolve awarded-project account contexts");
      }
    },

    async account(req: Request, res: Response) {
      res.setHeader("Cache-Control", "private, no-store");
      if (!await authenticateInternal(req, res, dependencies)) return;
      const parsed = accountNameQuery.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid account-match query", details: parsed.error.flatten() });
      }
      try {
        return res.json(await dependencies.resolveAccountName(parsed.data.name, { state: parsed.data.state }));
      } catch (error) {
        return sendError(res, error, "Resolve account name");
      }
    },
  };
}

const handlers = createFullPotentialAccountMatchingHandlers();

export const handleFullPotentialProjectMatch = handlers.project;
export const handleFullPotentialProjectMatches = handlers.projects;
export const handleFullPotentialAwardedProjectMatches = handlers.awarded;
export const handleFullPotentialAccountNameMatch = handlers.account;
