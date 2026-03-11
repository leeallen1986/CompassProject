/**
 * Tests for daily pipeline step-level logging and status tracking.
 */
import { describe, it, expect } from "vitest";
import type { PipelineStep } from "../drizzle/schema";

// ── Helper function tests (replicate the helpers from dailyPipeline.ts) ──

function startStep(name: string): PipelineStep {
  return {
    name,
    status: "skipped",
    startedAt: new Date().toISOString(),
  };
}

function completeStep(step: PipelineStep, counts?: Record<string, number>): PipelineStep {
  step.status = "completed";
  step.completedAt = new Date().toISOString();
  step.durationMs = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
  if (counts) step.counts = counts;
  return step;
}

function failStep(step: PipelineStep, error: string): PipelineStep {
  step.status = "failed";
  step.completedAt = new Date().toISOString();
  step.durationMs = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
  step.error = error;
  return step;
}

function skipStep(step: PipelineStep, reason?: string): PipelineStep {
  step.status = "skipped";
  step.completedAt = new Date().toISOString();
  step.durationMs = 0;
  if (reason) step.error = reason;
  return step;
}

describe("Pipeline Step Tracking Helpers", () => {
  it("startStep creates a step with skipped status and ISO timestamp", () => {
    const step = startStep("RSS Harvest");
    expect(step.name).toBe("RSS Harvest");
    expect(step.status).toBe("skipped");
    expect(step.startedAt).toBeTruthy();
    expect(new Date(step.startedAt).getTime()).not.toBeNaN();
    expect(step.completedAt).toBeUndefined();
    expect(step.durationMs).toBeUndefined();
    expect(step.counts).toBeUndefined();
    expect(step.error).toBeUndefined();
  });

  it("completeStep sets status to completed with duration and counts", () => {
    const step = startStep("AI Extraction");
    const counts = { processed: 10, extracted: 5, duplicates: 3, failed: 2 };
    completeStep(step, counts);
    expect(step.status).toBe("completed");
    expect(step.completedAt).toBeTruthy();
    expect(step.durationMs).toBeGreaterThanOrEqual(0);
    expect(step.counts).toEqual(counts);
    expect(step.error).toBeUndefined();
  });

  it("completeStep works without counts", () => {
    const step = startStep("Staleness Check");
    completeStep(step);
    expect(step.status).toBe("completed");
    expect(step.counts).toBeUndefined();
  });

  it("failStep sets status to failed with error message", () => {
    const step = startStep("Contact Enrichment");
    failStep(step, "Apollo API rate limit exceeded");
    expect(step.status).toBe("failed");
    expect(step.error).toBe("Apollo API rate limit exceeded");
    expect(step.completedAt).toBeTruthy();
    expect(step.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("skipStep sets status to skipped with optional reason", () => {
    const step = startStep("Projectory Scrape");
    skipStep(step, "Runs on Mondays only");
    expect(step.status).toBe("skipped");
    expect(step.durationMs).toBe(0);
    expect(step.error).toBe("Runs on Mondays only");
  });

  it("skipStep works without reason", () => {
    const step = startStep("Weekly Digest");
    skipStep(step);
    expect(step.status).toBe("skipped");
    expect(step.durationMs).toBe(0);
    expect(step.error).toBeUndefined();
  });
});

describe("Pipeline Step Status Logic", () => {
  it("distinguishes completed from failed status correctly", () => {
    const successStep = startStep("Step A");
    completeStep(successStep, { items: 5 });

    const failedStep = startStep("Step B");
    failStep(failedStep, "Network error");

    expect(successStep.status).toBe("completed");
    expect(failedStep.status).toBe("failed");
    expect(successStep.status).not.toBe(failedStep.status);
  });

  it("all three statuses are distinct", () => {
    const completed = startStep("A");
    completeStep(completed);

    const failed = startStep("B");
    failStep(failed, "err");

    const skipped = startStep("C");
    skipStep(skipped, "not today");

    const statuses = new Set([completed.status, failed.status, skipped.status]);
    expect(statuses.size).toBe(3);
    expect(statuses).toContain("completed");
    expect(statuses).toContain("failed");
    expect(statuses).toContain("skipped");
  });
});

describe("Pipeline Step Array Simulation", () => {
  it("simulates a full pipeline run with mixed step statuses", () => {
    const steps: PipelineStep[] = [];

    // Step 1: RSS Harvest - completed
    const harvest = startStep("RSS Harvest");
    completeStep(harvest, { sources: 20, newArticles: 15, duplicates: 5, errors: 0 });
    steps.push(harvest);

    // Step 2: AI Extraction - completed
    const extraction = startStep("AI Extraction");
    completeStep(extraction, { processed: 15, extracted: 8, duplicates: 4, failed: 3 });
    steps.push(extraction);

    // Step 3: Projectory - skipped (not Monday)
    const projectory = startStep("Projectory Scrape");
    skipStep(projectory, "Runs on Mondays only");
    steps.push(projectory);

    // Step 4: Gov - skipped (not Tuesday)
    const gov = startStep("Gov Major Projects Scrape");
    skipStep(gov, "Runs on Tuesdays only");
    steps.push(gov);

    // Step 5: DMIRS - skipped (not Wednesday)
    const dmirs = startStep("DMIRS MINEDEX Scrape");
    skipStep(dmirs, "Runs on Wednesdays only");
    steps.push(dmirs);

    // Step 6: AusTender - skipped (not Thursday)
    const austender = startStep("AusTender Scrape");
    skipStep(austender, "Runs on Thursdays only");
    steps.push(austender);

    // Step 7: AEMO - skipped (not Friday)
    const aemo = startStep("AEMO Scrape");
    skipStep(aemo, "Runs on Fridays only");
    steps.push(aemo);

    // Step 8: ICN - skipped (not Saturday)
    const icn = startStep("ICN Gateway Scrape");
    skipStep(icn, "Runs on Saturdays only");
    steps.push(icn);

    // Step 9: Enrichment - failed
    const enrichment = startStep("Contact Enrichment");
    failStep(enrichment, "Apollo API key expired");
    steps.push(enrichment);

    // Step 10: Digest - skipped
    const digest = startStep("Weekly Digest");
    skipStep(digest, "Runs on Mondays only");
    steps.push(digest);

    // Step 11: Staleness - completed
    const staleness = startStep("Staleness Check");
    completeStep(staleness, { markedStale: 2 });
    steps.push(staleness);

    expect(steps).toHaveLength(11);
    expect(steps.filter(s => s.status === "completed")).toHaveLength(3);
    expect(steps.filter(s => s.status === "skipped")).toHaveLength(7);
    expect(steps.filter(s => s.status === "failed")).toHaveLength(1);

    // Verify the overall status logic
    const hasFailed = steps.some(s => s.status === "failed");
    expect(hasFailed).toBe(true);
    const overallStatus = hasFailed ? "failed" : "completed";
    expect(overallStatus).toBe("failed");
  });

  it("all-completed pipeline returns completed status", () => {
    const steps: PipelineStep[] = [];

    const harvest = startStep("RSS Harvest");
    completeStep(harvest, { sources: 20, newArticles: 10 });
    steps.push(harvest);

    const extraction = startStep("AI Extraction");
    completeStep(extraction, { processed: 10, extracted: 5 });
    steps.push(extraction);

    const enrichment = startStep("Contact Enrichment");
    completeStep(enrichment, { enriched: 3 });
    steps.push(enrichment);

    const hasFailed = steps.some(s => s.status === "failed");
    expect(hasFailed).toBe(false);
    const overallStatus = hasFailed ? "failed" : "completed";
    expect(overallStatus).toBe("completed");
  });

  it("steps are serializable to JSON for database storage", () => {
    const steps: PipelineStep[] = [];

    const step1 = startStep("RSS Harvest");
    completeStep(step1, { sources: 20, newArticles: 15 });
    steps.push(step1);

    const step2 = startStep("AI Extraction");
    failStep(step2, "LLM timeout");
    steps.push(step2);

    const json = JSON.stringify(steps);
    const parsed = JSON.parse(json) as PipelineStep[];

    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("RSS Harvest");
    expect(parsed[0].status).toBe("completed");
    expect(parsed[0].counts?.sources).toBe(20);
    expect(parsed[1].name).toBe("AI Extraction");
    expect(parsed[1].status).toBe("failed");
    expect(parsed[1].error).toBe("LLM timeout");
  });
});

describe("PipelineStep Type Validation", () => {
  it("PipelineStep interface has all required fields", () => {
    const step: PipelineStep = {
      name: "Test Step",
      status: "completed",
      startedAt: new Date().toISOString(),
    };
    expect(step.name).toBe("Test Step");
    expect(step.status).toBe("completed");
    expect(step.startedAt).toBeTruthy();
  });

  it("PipelineStep allows all optional fields", () => {
    const step: PipelineStep = {
      name: "Full Step",
      status: "failed",
      startedAt: "2026-03-11T00:00:00.000Z",
      completedAt: "2026-03-11T00:01:30.000Z",
      durationMs: 90000,
      counts: { processed: 100, extracted: 50 },
      error: "Rate limit exceeded",
    };
    expect(step.completedAt).toBe("2026-03-11T00:01:30.000Z");
    expect(step.durationMs).toBe(90000);
    expect(step.counts?.processed).toBe(100);
    expect(step.error).toBe("Rate limit exceeded");
  });

  it("status enum only allows valid values", () => {
    const validStatuses: PipelineStep["status"][] = ["completed", "failed", "skipped"];
    validStatuses.forEach(status => {
      const step: PipelineStep = { name: "Test", status, startedAt: new Date().toISOString() };
      expect(["completed", "failed", "skipped"]).toContain(step.status);
    });
  });
});

describe("Pipeline Duration Calculation", () => {
  it("calculates duration correctly for completed steps", () => {
    const step = startStep("Test");
    // Simulate passage of time
    const start = new Date(step.startedAt).getTime();
    step.completedAt = new Date(start + 5000).toISOString();
    step.durationMs = new Date(step.completedAt).getTime() - start;
    expect(step.durationMs).toBe(5000);
  });

  it("skipped steps have zero duration", () => {
    const step = startStep("Skipped Step");
    skipStep(step);
    expect(step.durationMs).toBe(0);
  });
});

describe("Pipeline Run Overall Status Determination", () => {
  it("returns failed if any step failed", () => {
    const steps: PipelineStep[] = [
      { name: "A", status: "completed", startedAt: "2026-01-01T00:00:00Z" },
      { name: "B", status: "failed", startedAt: "2026-01-01T00:01:00Z", error: "err" },
      { name: "C", status: "skipped", startedAt: "2026-01-01T00:02:00Z" },
    ];
    const hasFailed = steps.some(s => s.status === "failed");
    expect(hasFailed).toBe(true);
  });

  it("returns completed if no step failed", () => {
    const steps: PipelineStep[] = [
      { name: "A", status: "completed", startedAt: "2026-01-01T00:00:00Z" },
      { name: "B", status: "skipped", startedAt: "2026-01-01T00:01:00Z" },
      { name: "C", status: "completed", startedAt: "2026-01-01T00:02:00Z" },
    ];
    const hasFailed = steps.some(s => s.status === "failed");
    expect(hasFailed).toBe(false);
  });

  it("empty steps array means completed (no failures)", () => {
    const steps: PipelineStep[] = [];
    const hasFailed = steps.some(s => s.status === "failed");
    expect(hasFailed).toBe(false);
  });
});
