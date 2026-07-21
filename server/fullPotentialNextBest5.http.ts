import type { Request, Response } from "express";
import { TRPCError } from "@trpc/server";
import { sdk } from "./_core/sdk";
import { getReadOnlyNextBest5 } from "./fullPotentialNextBest5";
import type { NextBest5User } from "./fullPotentialNextBest5.shared";

type AuthenticateRequest = (req: Request) => Promise<NextBest5User>;
type NextBest5Service = (user: NextBest5User) => Promise<unknown>;

export interface NextBest5HttpDependencies {
  authenticateRequest: AuthenticateRequest;
  getNextBest5: NextBest5Service;
}

function statusFor(error: TRPCError): number {
  if (error.code === "UNAUTHORIZED") return 401;
  if (error.code === "FORBIDDEN") return 403;
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "BAD_REQUEST") return 400;
  return 500;
}

export function createReadOnlyNextBest5Handler(
  dependencies: NextBest5HttpDependencies,
) {
  return async function handleReadOnlyNextBest5(req: Request, res: Response) {
    res.setHeader("Cache-Control", "private, no-store");

    let user: NextBest5User;
    try {
      user = await dependencies.authenticateRequest(req);
    } catch {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (user.role === "distributor") {
      return res.status(403).json({
        error: "Next Best 5 requires internal sales access",
      });
    }

    try {
      return res.json(await dependencies.getNextBest5(user));
    } catch (error) {
      if (error instanceof TRPCError) {
        return res.status(statusFor(error)).json({
          error: error.message,
          code: error.code,
        });
      }
      console.error("[ReadOnlyNextBest5] Load failed", error);
      return res.status(500).json({
        error: "Load read-only Next Best 5 failed",
      });
    }
  };
}

export const handleReadOnlyNextBest5 = createReadOnlyNextBest5Handler({
  authenticateRequest: async req => {
    const user = await sdk.authenticateRequest(req);
    return {
      id: Number(user.id),
      name: user.name ?? null,
      email: user.email ?? null,
      role: user.role,
    };
  },
  getNextBest5: getReadOnlyNextBest5,
});
