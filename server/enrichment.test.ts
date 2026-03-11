import { describe, expect, it } from "vitest";
import { getSessionStatus } from "./projectoryEnrichment";

describe("projectoryEnrichment — session management", () => {
  it("getSessionStatus returns inactive when no session exists", () => {
    const status = getSessionStatus();
    expect(status).toHaveProperty("active");
    expect(status).toHaveProperty("expiresIn");
    expect(status.active).toBe(false);
    expect(status.expiresIn).toBeNull();
  });
});

// Test the ICN enrichment module exports
import { validateAllProjects } from "./icnEnrichment";

describe("icnEnrichment — exports", () => {
  it("validateAllProjects is a function", () => {
    expect(typeof validateAllProjects).toBe("function");
  });
});

// Test the daily pipeline result type structure
import type { DailyPipelineResult } from "./dailyPipeline";

describe("dailyPipeline — result type", () => {
  it("DailyPipelineResult includes all source categories", () => {
    // Type-level test: if this compiles, the type includes all required fields
    const mockResult: Partial<DailyPipelineResult> = {
      harvest: { totalSources: 0, totalNew: 0, totalDuplicates: 0, totalErrors: 0 },
      extraction: { processed: 0, extracted: 0, duplicates: 0, failed: 0, creditsUsed: 0 },
      enrichment: { processed: 0, enriched: 0, notFound: 0, failed: 0, dailyUsed: 0 },
      asxMonitor: {
        ran: false, companiesChecked: 0, announcementsScanned: 0,
        projectSignals: 0, newProjects: 0, duplicates: 0, errors: 0, duration: 0,
      },
      projectoryEnrichment: {
        ran: false, enriched: 0, contractorsFound: 0, failed: 0, sessionExpired: false,
      },
      icnValidation: {
        ran: false, validated: 0, contractorsFound: 0, failed: 0,
      },
    };
    expect(mockResult.asxMonitor).toBeDefined();
    expect(mockResult.projectoryEnrichment).toBeDefined();
    expect(mockResult.icnValidation).toBeDefined();
  });
});
