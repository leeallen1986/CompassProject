import { describe, expect, it } from "vitest";
import {
  PIPELINE_STALL_MINUTES,
  classifyPipelineRun,
  expectedRunWindowKey,
  scheduledTriggerDecision,
  selfHealingDecision,
  staleRunMessage,
} from "./pipelineRunReliability";

const NOW = new Date("2026-08-14T00:00:00Z");

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 3840001,
    status: "running" as const,
    startedAt: "2026-08-13T23:30:00Z",
    completedAt: null,
    lastProgressAt: "2026-08-13T23:50:00Z",
    currentStep: "Government Scrapers",
    triggeredBy: "cron",
    ...overrides,
  } as any;
}

describe("Issue #104 persisted run health", () => {
  it("uses the 60-minute stall threshold", () => {
    expect(PIPELINE_STALL_MINUTES).toBe(60);
  });

  it("treats recent progress as healthy running and blocks duplicate triggers", () => {
    const result = classifyPipelineRun(run(), NOW);
    expect(result.health).toBe("healthy_running");
    expect(selfHealingDecision(result.health)).toBe("skip_healthy_running");
    expect(scheduledTriggerDecision(result.health)).toBe("block_healthy_running");
  });

  it("uses lastProgressAt rather than startedAt for stall detection even after four hours", () => {
    const result = classifyPipelineRun(run({
      startedAt: "2026-08-13T18:00:00Z",
      lastProgressAt: "2026-08-13T23:40:00Z",
    }), NOW);
    expect(result.health).toBe("healthy_running");
    expect(scheduledTriggerDecision(result.health)).toBe("block_healthy_running");
  });

  it("keeps 55 minutes without progress healthy", () => {
    const result = classifyPipelineRun(run({ lastProgressAt: "2026-08-13T23:05:00Z" }), NOW);
    expect(result.health).toBe("healthy_running");
  });

  it("classifies more than 60 minutes without progress as stale", () => {
    const result = classifyPipelineRun(run({ lastProgressAt: "2026-08-13T22:59:00Z" }), NOW);
    expect(result.health).toBe("stale_running");
    expect(selfHealingDecision(result.health)).toBe("block_stale_running");
    expect(scheduledTriggerDecision(result.health)).toBe("block_stale_running");
    expect(staleRunMessage(result)).toContain("Government Scrapers");
  });

  it("falls back to startedAt when legacy running rows have no progress timestamp", () => {
    const result = classifyPipelineRun(run({
      startedAt: "2026-08-13T22:00:00Z",
      lastProgressAt: null,
    }), NOW);
    expect(result.health).toBe("stale_running");
  });

  it("allows a persisted failed run to be retried", () => {
    const result = classifyPipelineRun(run({
      status: "failed",
      completedAt: "2026-08-13T22:40:00Z",
    }), NOW);
    expect(result.health).toBe("failed");
    expect(selfHealingDecision(result.health)).toBe("retry");
    expect(scheduledTriggerDecision(result.health)).toBe("allow");
  });

  it("does not retry a completed expected-window run", () => {
    const result = classifyPipelineRun(run({
      status: "completed",
      completedAt: "2026-08-13T23:00:00Z",
    }), NOW);
    expect(result.health).toBe("completed");
    expect(selfHealingDecision(result.health)).toBe("skip_completed");
  });

  it("allows a genuinely missing expected-window run to be recovered", () => {
    const result = classifyPipelineRun(null, NOW);
    expect(result.health).toBe("missing");
    expect(selfHealingDecision(result.health)).toBe("retry");
  });

  it("creates a stable persistence key for one retry per expected window", () => {
    expect(expectedRunWindowKey(new Date("2026-08-13T20:00:00Z"))).toBe("2026-08-13T20");
    expect(expectedRunWindowKey(new Date("2026-08-14T20:00:00Z"))).toBe("2026-08-14T20");
  });
});
