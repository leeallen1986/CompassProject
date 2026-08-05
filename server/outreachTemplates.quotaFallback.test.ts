import { beforeEach, describe, expect, it, vi } from "vitest";
import { LLMInvokeError } from "./_core/llmErrors";

const mocks = vi.hoisted(() => {
  const invokeLLM = vi.fn();
  const incrementWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: incrementWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const limit = vi.fn();
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const db = { select, update };
  return {
    invokeLLM,
    incrementWhere,
    updateSet,
    update,
    limit,
    db,
  };
});

vi.mock("./_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));
vi.mock("./db", () => ({ getDb: vi.fn().mockResolvedValue(mocks.db) }));
vi.mock("../drizzle/schema", () => ({
  outreachTemplates: {
    id: "outreachTemplates.id",
    usageCount: "outreachTemplates.usageCount",
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ column, value })),
  desc: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  like: vi.fn(),
  sql: vi.fn(),
}));

import { personaliseTemplate, type PersonaliseInput } from "./outreachTemplates";

const TEMPLATE = {
  id: 3,
  subject: "Old Customer — guaranteed savings",
  body: "Hi Pat, here are unverified performance claims.",
  tone: "consultative" as const,
};

const INPUT: PersonaliseInput = {
  templateId: 3,
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
  fallbackPolicy: "deterministic_template",
};

describe("personaliseTemplate quota fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.limit.mockResolvedValue([TEMPLATE]);
    mocks.incrementWhere.mockResolvedValue(undefined);
  });

  it("returns a factual provider-free draft and increments usage only after success", async () => {
    mocks.invokeLLM.mockRejectedValueOnce(new LLMInvokeError({
      kind: "quota_exhausted",
      status: 412,
    }));

    const result = await personaliseTemplate(INPUT);

    expect(result).toMatchObject({
      generationMode: "deterministic_template",
      aiUnavailableReason: "quota_exhausted",
    });
    expect(result.subject).toContain("Build Co");
    expect(result.body).not.toContain("guaranteed savings");
    expect(result.body).not.toContain("unverified performance claims");
    expect(mocks.invokeLLM).toHaveBeenCalledTimes(1);
    expect(mocks.invokeLLM.mock.calls[0][0]).toMatchObject({
      feature: "project_outreach_template_personalisation",
      maxTokens: 1_600,
      timeoutMs: 30_000,
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("does not increment usage when quota fallback was not authorised", async () => {
    const failure = new LLMInvokeError({ kind: "quota_exhausted", status: 412 });
    mocks.invokeLLM.mockRejectedValueOnce(failure);

    await expect(personaliseTemplate({
      ...INPUT,
      fallbackPolicy: undefined,
    })).rejects.toBe(failure);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not hide malformed model output or increment usage", async () => {
    mocks.invokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "not-json" } }],
    });

    await expect(personaliseTemplate(INPUT)).rejects.toMatchObject({
      kind: "malformed_response",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("records usage after a valid AI personalisation", async () => {
    mocks.invokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ subject: "Subject", body: "Body" }) } }],
    });

    await expect(personaliseTemplate(INPUT)).resolves.toMatchObject({
      subject: "Subject",
      body: "Body",
      generationMode: "ai",
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
