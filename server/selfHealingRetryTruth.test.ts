import { describe, expect, it } from "vitest";
import {
  classifyPersistedSelfHealingRetry,
  selfHealingFailureSummary,
} from "./selfHealingRetryTruth";

function run(status: string, steps: unknown = []) {
  return {
    id: 3960001,
    status,
    triggeredBy: "self-healing-retry",
    steps,
  };
}

describe("Issue #115 persisted retry truth", () => {
  it("accepts success only from persisted completed status", () => {
    expect(classifyPersistedSelfHealingRetry(run("completed"))).toEqual({
      runId: 3960001,
      state: "completed",
      succeeded: true,
      criticalFailures: [],
    });
  });

  it("rejects a resolved retry whose persisted row failed", () => {
    const truth = classifyPersistedSelfHealingRetry(run("failed", [
      { name: "AI Extraction", status: "failed", error: "provider payload must not escape" },
      { name: "QTOL NT", status: "failed", error: "non-critical raw failure" },
      { name: "Tier Classification", status: "completed" },
    ]));
    expect(truth).toEqual({
      runId: 3960001,
      state: "failed",
      succeeded: false,
      criticalFailures: ["AI Extraction"],
    });
    const summary = selfHealingFailureSummary(truth);
    expect(summary).toContain("AI Extraction");
    expect(summary).not.toContain("provider payload");
    expect(summary).not.toContain("non-critical raw failure");
  });

  it("fails closed when the persisted retry is still running", () => {
    expect(classifyPersistedSelfHealingRetry(run("running"))).toMatchObject({
      state: "incomplete",
      succeeded: false,
    });
  });

  it("fails closed when no new persisted retry row can be found", () => {
    const truth = classifyPersistedSelfHealingRetry(null);
    expect(truth).toEqual({
      runId: null,
      state: "missing",
      succeeded: false,
      criticalFailures: [],
    });
    expect(selfHealingFailureSummary(truth)).toContain("Success could not be confirmed");
  });

  it("deduplicates and sorts bounded critical stage names", () => {
    const truth = classifyPersistedSelfHealingRetry(run("failed", [
      { name: "Staleness Check", status: "failed" },
      { name: "AI Extraction", status: "failed" },
      { name: "AI Extraction", status: "failed" },
      { name: "Apollo Gap-Fill", status: "failed" },
    ]));
    expect(truth.criticalFailures).toEqual(["AI Extraction", "Staleness Check"]);
  });
});
