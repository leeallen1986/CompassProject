import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () => readFileSync(
  new URL("./operationsReliabilityV2.ts", import.meta.url),
  "utf8",
);

describe("Issue #104 worker-owned recovery plane", () => {
  it("defaults the web service to observer mode", () => {
    const text = source();
    expect(text).toContain('process.env.ENABLE_WEB_SELF_HEALING === "true"');
    expect(text).toContain('return "worker_recovery_pending"');
    expect(text).toContain('recoveryExecutionPlane: WEB_SELF_HEALING_ENABLED ? "web_legacy_override" : "dedicated_worker"');
  });

  it("checks the worker-plane gate before the legacy web retry can mark the window or run the pipeline", () => {
    const text = source();
    const gate = text.indexOf("if (!WEB_SELF_HEALING_ENABLED)");
    const legacy = text.indexOf("const previousRetryId = (await loadLatestSelfHealingRetry())?.id ?? null");
    expect(gate).toBeGreaterThan(-1);
    expect(legacy).toBeGreaterThan(gate);
  });

  it("notifies once from the persisted worker recovery row rather than execution promise truth", () => {
    const text = source();
    expect(text).toContain('const LAST_NOTIFIED_WORKER_RECOVERY_KEY = "ops.v2.lastNotifiedSelfHealingRunId"');
    expect(text).toContain("const truth = classifyPersistedSelfHealingRetry(run)");
    expect(text).toContain("Dedicated-worker recovery run ${truth.runId} reached persisted status completed.");
    expect(text).toContain("selfHealingFailureSummary(truth)");
    expect(text).toContain("await setSystemKv(LAST_NOTIFIED_WORKER_RECOVERY_KEY, String(run.id))");
  });

  it("retains persisted-status truth on the explicit legacy compatibility path", () => {
    const text = source();
    expect(text).toContain("const truth = await loadNewRetryTruth(previousRetryId)");
    expect(text).toContain("if (!truth.succeeded)");
    expect(text).toContain('if (outcome === "retry_succeeded")');
  });
});
