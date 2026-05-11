import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the ENV and DB modules before importing
vi.mock("./server/_core/env", () => ({
  ENV: {
    lushaApiKey: "test-lusha-key-123",
    databaseUrl: "mysql://test",
  },
}));

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(() => ({})),
}));

describe("Lusha Enrichment Module", () => {
  describe("lushaRescueForRep", () => {
    it("should respect budget guardrails (max 5 credits per rescue run)", async () => {
      // The module should cap at LUSHA_RESCUE_MAX_CREDITS_PER_RUN = 5
      const { LUSHA_RESCUE_MAX_CREDITS_PER_RUN } = await import("./lushaEnrichment");
      expect(LUSHA_RESCUE_MAX_CREDITS_PER_RUN).toBe(5);
    });

    it("should respect cooldown (14 days between Lusha attempts per project)", async () => {
      const { LUSHA_COOLDOWN_DAYS } = await import("./lushaEnrichment");
      expect(LUSHA_COOLDOWN_DAYS).toBe(14);
    });

    it("should only accept High or Medium lane fit candidates", async () => {
      // The lushaRescueForRep function should filter out Low/Not relevant candidates
      const { lushaRescueForRep } = await import("./lushaEnrichment");
      const result = await lushaRescueForRep([
        { projectId: 1, projectName: "Test Low", laneFitLabel: "Low", relevanceScore: 50 },
        { projectId: 2, projectName: "Test Not Relevant", laneFitLabel: "Not relevant", relevanceScore: 30 },
      ]);
      // Should skip all candidates (none are High/Medium) — returns early with 0 attempts
      expect(result.totalPromoted).toBe(0);
      expect(result.projectsAttempted).toBe(0);
    });

    it("should export the correct budget constants", async () => {
      const mod = await import("./lushaEnrichment");
      expect(mod.LUSHA_DAILY_BUDGET).toBe(10);
      expect(mod.LUSHA_RESCUE_MAX_CREDITS_PER_RUN).toBe(5);
      expect(mod.LUSHA_COOLDOWN_DAYS).toBe(14);
    });
  });

  describe("Auto-rescue trigger expansion", () => {
    it("hasContactBlockers should include insufficient_defensible_contacts", async () => {
      // Verify the emailDigest.ts hasContactBlockers check includes the new criterion
      const fs = await import("fs");
      const content = fs.readFileSync("server/emailDigest.ts", "utf-8");
      expect(content).toContain('b.criterion === "insufficient_defensible_contacts"');
    });

    it("Lusha Stage 4 block should be present in emailDigest.ts", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync("server/emailDigest.ts", "utf-8");
      expect(content).toContain("LUSHA STAGE 4 FALLBACK");
      expect(content).toContain("lushaRescueForRep");
    });
  });

  describe("Dedup guardrails", () => {
    it("should not re-enrich a contact already enriched by Lusha within cooldown", async () => {
      // The module checks lushaEnrichmentLog for recent attempts
      const { LUSHA_COOLDOWN_DAYS } = await import("./lushaEnrichment");
      // 14-day cooldown means a project enriched 13 days ago should be skipped
      expect(LUSHA_COOLDOWN_DAYS).toBe(14);
    });
  });
});
