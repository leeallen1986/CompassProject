import { beforeEach, describe, expect, it, vi } from "vitest";
import { LLMInvokeError } from "./_core/llmErrors";

const { invokeLLM } = vi.hoisted(() => ({ invokeLLM: vi.fn() }));
vi.mock("./_core/llm", () => ({ invokeLLM }));
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("../drizzle/schema", () => ({
  outreachEmails: {},
  pipelineClaims: {},
}));

import { generateOutreachEmail, type OutreachInput } from "./outreachEmail";

const INPUT: OutreachInput = {
  contactName: "Casey Buyer",
  contactTitle: "Procurement Manager",
  contactCompany: "Build Co",
  contactEmail: "casey@example.com",
  contactRoleBucket: "procurement",
  projectName: "Northern Water Upgrade",
  projectLocation: "Western Australia",
  projectValue: "$100m",
  projectSector: "infrastructure",
  projectStage: "planning",
  projectOverview: null,
  equipmentSignals: null,
  opportunityRoute: "Direct CAPEX",
  matchedBusinessLines: ["Portable Air"],
  senderName: "Alex",
  tone: "consultative",
};

describe("generateOutreachEmail quota fallback", () => {
  beforeEach(() => invokeLLM.mockReset());

  it("returns a deterministic draft after the observed quota-exhausted failure", async () => {
    invokeLLM.mockRejectedValueOnce(new LLMInvokeError({
      kind: "quota_exhausted",
      status: 412,
    }));

    const result = await generateOutreachEmail({
      ...INPUT,
      fallbackPolicy: "deterministic_template",
    });

    expect(result.generationMode).toBe("deterministic_template");
    expect(result.aiUnavailableReason).toBe("quota_exhausted");
    expect(invokeLLM).toHaveBeenCalledTimes(1);
    expect(invokeLLM.mock.calls[0][0]).toMatchObject({
      feature: "project_outreach_email",
      maxTokens: 1_600,
      timeoutMs: 30_000,
    });
  });

  it("does not silently apply project fallback to other consumers", async () => {
    const failure = new LLMInvokeError({ kind: "quota_exhausted", status: 412 });
    invokeLLM.mockRejectedValueOnce(failure);

    await expect(generateOutreachEmail(INPUT)).rejects.toBe(failure);
    expect(invokeLLM).toHaveBeenCalledTimes(1);
  });

  it("does not convert malformed model output into a quota fallback", async () => {
    invokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "not-json" } }],
    });

    await expect(generateOutreachEmail({
      ...INPUT,
      fallbackPolicy: "deterministic_template",
    })).rejects.toMatchObject({ kind: "malformed_response" });
  });
});
