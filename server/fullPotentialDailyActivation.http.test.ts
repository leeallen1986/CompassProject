import type { Request, Response } from "express";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getActivation: vi.fn(),
  respond: vi.fn(),
  brief: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({
  sdk: {
    authenticateRequest: mocks.authenticateRequest,
  },
}));

vi.mock("./fullPotentialDailyActivation", () => ({
  getFullPotentialDailyActivation: mocks.getActivation,
  respondToFullPotentialDailyRecommendation: mocks.respond,
  generateFullPotentialDailyAiBrief: mocks.brief,
}));

import {
  handleGenerateFullPotentialDailyBrief,
  handleGetFullPotentialDailyActivation,
  handleRespondFullPotentialDailyActivation,
} from "./fullPotentialDailyActivation.http";

function createRequest(body: unknown = {}): Request {
  return { body } as Request;
}

function createResponse() {
  let statusCode = 200;
  let body: unknown;
  const res = {} as Response;
  res.setHeader = vi.fn() as unknown as Response["setHeader"];
  res.status = vi.fn((code: number) => {
    statusCode = code;
    return res;
  }) as unknown as Response["status"];
  res.json = vi.fn((payload: unknown) => {
    body = payload;
    return res;
  }) as unknown as Response["json"];
  return {
    res,
    getStatus: () => statusCode,
    getBody: () => body as Record<string, any>,
  };
}

const internalUser = {
  id: 42,
  name: "Validation User",
  email: "validation@example.com",
  role: "user",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue(internalUser);
  mocks.getActivation.mockResolvedValue({
    generatedAt: "2026-07-20T09:00:00.000Z",
    weekLabel: "2026-07-20",
    recommendations: [],
    summary: {},
    managerRollup: null,
  });
  mocks.respond.mockResolvedValue({ action: { id: 11, status: "not_started" }, alreadyExists: false });
  mocks.brief.mockResolvedValue({
    generatedBy: "deterministic_fallback",
    accountBrief: "Grounded brief",
    whyNow: "No evidence yet",
    evidenceGaps: ["Installed base is unknown"],
    productFamilyHypothesis: {
      productFamily: null,
      application: null,
      rationale: "Unknown",
      confidence: "unknown",
      basis: "unknown",
    },
    questionsToAsk: ["What equipment is in the fleet?"],
    recommendedAction: "Capture evidence",
    expectedOutcome: "Evidence-backed decision",
    warnings: ["Do not infer value"],
    sources: [],
  });
});

describe("Full Potential daily activation HTTP handlers", () => {
  it("returns 401 before loading activation when authentication fails", async () => {
    mocks.authenticateRequest.mockRejectedValue(new Error("No session"));
    const { res, getStatus, getBody } = createResponse();

    await handleGetFullPotentialDailyActivation(createRequest(), res);

    expect(getStatus()).toBe(401);
    expect(getBody()).toEqual({ error: "Authentication required" });
    expect(mocks.getActivation).not.toHaveBeenCalled();
  });

  it("blocks distributor access before the activation service runs", async () => {
    mocks.authenticateRequest.mockResolvedValue({ ...internalUser, role: "distributor" });
    const { res, getStatus, getBody } = createResponse();

    await handleGetFullPotentialDailyActivation(createRequest(), res);

    expect(getStatus()).toBe(403);
    expect(getBody().error).toMatch(/internal sales access/i);
    expect(mocks.getActivation).not.toHaveBeenCalled();
  });

  it("returns the internal user's activation feed with no-store headers", async () => {
    const { res, getStatus, getBody } = createResponse();

    await handleGetFullPotentialDailyActivation(createRequest(), res);

    expect(getStatus()).toBe(200);
    expect(getBody().weekLabel).toBe("2026-07-20");
    expect(mocks.getActivation).toHaveBeenCalledWith(internalUser);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
  });

  it("rejects an invalid recommendation response before service access", async () => {
    const { res, getStatus, getBody } = createResponse();

    await handleRespondFullPotentialDailyActivation(createRequest({ decision: "accepted" }), res);

    expect(getStatus()).toBe(400);
    expect(getBody().error).toBe("Invalid recommendation response");
    expect(mocks.respond).not.toHaveBeenCalled();
  });

  it("passes a valid human decision to the response service", async () => {
    const requestBody = {
      recommendationKey: "fp-2026-07-20-269-capture_evidence-account-0",
      decision: "edited",
      editedAction: "Confirm fleet size and replacement timing with the customer.",
      dueDate: "2026-07-27",
      reason: "Adjusted to the specific evidence gap.",
    };
    const { res, getStatus, getBody } = createResponse();

    await handleRespondFullPotentialDailyActivation(createRequest(requestBody), res);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ action: { id: 11 }, alreadyExists: false });
    expect(mocks.respond).toHaveBeenCalledWith(requestBody, internalUser);
  });

  it("rejects an invalid AI brief request before invoking the brief service", async () => {
    const { res, getStatus, getBody } = createResponse();

    await handleGenerateFullPotentialDailyBrief(createRequest({ accountId: -1 }), res);

    expect(getStatus()).toBe(400);
    expect(getBody().error).toBe("Invalid accountId");
    expect(mocks.brief).not.toHaveBeenCalled();
  });

  it("returns a grounded brief and maps service validation errors", async () => {
    const success = createResponse();
    await handleGenerateFullPotentialDailyBrief(createRequest({ accountId: 269 }), success.res);

    expect(success.getStatus()).toBe(200);
    expect(success.getBody().generatedBy).toBe("deterministic_fallback");
    expect(mocks.brief).toHaveBeenCalledWith(269, internalUser);

    mocks.brief.mockRejectedValue(new TRPCError({
      code: "BAD_REQUEST",
      message: "Recommendation is stale",
    }));
    const failure = createResponse();
    await handleGenerateFullPotentialDailyBrief(createRequest({ accountId: 269 }), failure.res);

    expect(failure.getStatus()).toBe(400);
    expect(failure.getBody()).toEqual({ error: "Recommendation is stale", code: "BAD_REQUEST" });
  });
});
