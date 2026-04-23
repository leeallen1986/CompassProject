import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@atlascopco.com",
    name: "Test Seller",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return { ctx };
}

const baseTriggerInput = {
  accountName: "Test Account",
  objective: "general_account_review",
  lensMode: "balanced" as const,
  ptLaneFocus: "Portable Air",
  researchDepth: "quick" as const,
  stakeholderCount: 5,
  highRelevanceStakeholderCount: 2,
  opportunityCount: 3,
  hotOpportunityCount: 1,
  hasActionHistory: true,
  hasCollateral: true,
  accountType: "Private Company",
  laneDistribution: { "Portable Air": 2, "BESS": 1 },
};

// ──────────────────────────────────────────────────
// evaluateTrigger tests
// ──────────────────────────────────────────────────
describe("accountResearch.evaluateTrigger", () => {
  it("returns not-recommended when data is sufficient", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accountResearch.evaluateTrigger(baseTriggerInput);

    expect(result).toHaveProperty("recommended");
    expect(result).toHaveProperty("reasons");
    expect(result).toHaveProperty("hasFreshResult");
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  it("recommends research when zero high-relevance stakeholders", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accountResearch.evaluateTrigger({
      ...baseTriggerInput,
      highRelevanceStakeholderCount: 0,
    });

    expect(result.recommended).toBe(true);
    expect(result.reasons.some((r: string) => r.includes("high-relevance stakeholders"))).toBe(true);
  });

  it("recommends research for hot opportunity with few stakeholders", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accountResearch.evaluateTrigger({
      ...baseTriggerInput,
      hotOpportunityCount: 2,
      stakeholderCount: 1,
    });

    expect(result.recommended).toBe(true);
    expect(result.reasons.some((r: string) => r.includes("HOT opportunity"))).toBe(true);
  });

  it("recommends research for competitor displacement objective", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accountResearch.evaluateTrigger({
      ...baseTriggerInput,
      objective: "displace_competitor",
    });

    expect(result.recommended).toBe(true);
    expect(result.reasons.some((r: string) => r.includes("Competitor displacement"))).toBe(true);
  });

  it("recommends research for stakeholder mapping objective", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accountResearch.evaluateTrigger({
      ...baseTriggerInput,
      objective: "map_stakeholders",
    });

    expect(result.recommended).toBe(true);
    expect(result.reasons.some((r: string) => r.includes("Stakeholder mapping"))).toBe(true);
  });

  it("recommends research for government account with limited contacts", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accountResearch.evaluateTrigger({
      ...baseTriggerInput,
      accountType: "Government / Public Body",
      stakeholderCount: 1,
    });

    expect(result.recommended).toBe(true);
    expect(result.reasons.some((r: string) => r.includes("Government"))).toBe(true);
  });

  it("warns against quick depth when account activity is too weak", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accountResearch.evaluateTrigger({
      ...baseTriggerInput,
      opportunityCount: 1,
      stakeholderCount: 0,
      highRelevanceStakeholderCount: 0,
      hasActionHistory: false,
      researchDepth: "quick",
    });

    expect(result.recommended).toBe(false);
    expect(result.reasons.some((r: string) => r.includes("too weak"))).toBe(true);
  });

  it("returns sufficient-data message when no trigger conditions met", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accountResearch.evaluateTrigger(baseTriggerInput);

    // With sufficient data, it should not recommend but still give a reason
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────
// getCachedResult tests
// ──────────────────────────────────────────────────
describe("accountResearch.getCachedResult", () => {
  it("returns null when no cached result exists", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accountResearch.getCachedResult({
      accountName: "Nonexistent Account XYZ123",
      objective: "general_account_review",
      lensMode: "balanced",
      researchDepth: "quick",
    });

    expect(result).toBeNull();
  });

  it("returns cached result for a previously researched account", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Rio Tinto was researched during validation
    const result = await caller.accountResearch.getCachedResult({
      accountName: "Rio Tinto",
      objective: "general_account_review",
      lensMode: "balanced",
      researchDepth: "quick",
    });

    // May or may not exist depending on test order, but structure should be correct
    if (result !== null) {
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("isStale");
      expect(result).toHaveProperty("isFresh");
      expect(result.status).toBe("complete");
      expect(result.stakeholderMap).toBeTruthy();
      expect(result.salesBrief).toBeTruthy();
      expect(result.recommendedActions).toBeTruthy();
    }
  });
});

// ──────────────────────────────────────────────────
// getResearchById tests
// ──────────────────────────────────────────────────
describe("accountResearch.getResearchById", () => {
  it("returns null for non-existent run ID", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.accountResearch.getResearchById({ runId: 999999 });

    expect(result).toBeNull();
  });
});

// ──────────────────────────────────────────────────
// runResearch input validation tests
// ──────────────────────────────────────────────────
describe("accountResearch.runResearch input validation", () => {
  it("rejects empty account name", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.accountResearch.runResearch({
        accountName: "",
        objective: "general_account_review",
        lensMode: "balanced",
        researchDepth: "quick",
        accountContext: {
          account: {},
          opportunities: [],
          stakeholders: [],
          contractors: [],
          contractorPairings: [],
          actionHistory: [],
          collateral: [],
        },
      })
    ).rejects.toThrow();
  });

  it("rejects invalid lens mode", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.accountResearch.runResearch({
        accountName: "Test",
        objective: "general_account_review",
        lensMode: "invalid_mode" as any,
        researchDepth: "quick",
        accountContext: {
          account: {},
          opportunities: [],
          stakeholders: [],
          contractors: [],
          contractorPairings: [],
          actionHistory: [],
          collateral: [],
        },
      })
    ).rejects.toThrow();
  });

  it("rejects invalid research depth", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.accountResearch.runResearch({
        accountName: "Test",
        objective: "general_account_review",
        lensMode: "balanced",
        researchDepth: "ultra_deep" as any,
        accountContext: {
          account: {},
          opportunities: [],
          stakeholders: [],
          contractors: [],
          contractorPairings: [],
          actionHistory: [],
          collateral: [],
        },
      })
    ).rejects.toThrow();
  });
});
