import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () => readFileSync(
  new URL("./operationsReliabilityV2.ts", import.meta.url),
  "utf8",
);

describe("Issue #115 self-healing notification truth wiring", () => {
  it("re-reads a newly persisted self-healing row before declaring success", () => {
    const text = source();
    expect(text).toContain("const previousRetryId = (await loadLatestSelfHealingRetry())?.id ?? null");
    expect(text).toContain("const truth = await loadNewRetryTruth(previousRetryId)");
    expect(text).toContain("if (!truth.succeeded)");
    expect(text).toContain("Self-healing retry persisted completed status");
  });

  it("keeps the green notification gated on persisted retry success", () => {
    const text = source();
    expect(text).toContain('if (outcome === "retry_succeeded")');
    expect(text).toContain("its persisted pipeline status is completed");
  });

  it("does not include a thrown raw error message in owner notification text", () => {
    const text = source();
    expect(text).not.toContain("Error: ${message}");
    expect(text).toContain("errorType");
    expect(text).toContain("selfHealingFailureSummary(truth)");
  });

  it("retains one-retry-per-window and stale-writer blocking", () => {
    const text = source();
    expect(text).toContain("retryAlreadyAttempted(windowStart)");
    expect(text).toContain("markRetryAttempted(windowStart)");
    expect(text).toContain('return "blocked_stale_running"');
  });
});
