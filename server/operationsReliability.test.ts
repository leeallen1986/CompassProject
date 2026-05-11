/**
 * Tests for the Operations Reliability module.
 * Validates warm-up endpoint, operator status, and self-healing logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleWarmup, getOperatorStatus } from "./operationsReliability";

describe("handleWarmup", () => {
  it("returns a valid JSON response with ok=true", () => {
    const req = {};
    const res = {
      json: vi.fn(),
    };
    handleWarmup(req, res);
    expect(res.json).toHaveBeenCalledTimes(1);
    const response = res.json.mock.calls[0][0];
    expect(response.ok).toBe(true);
    expect(response.ts).toBeDefined();
    expect(typeof response.uptime).toBe("number");
    expect(typeof response.selfHealingActive).toBe("boolean");
    expect(typeof response.missedRunCheckerActive).toBe("boolean");
    expect(typeof response.selfHealingAttempts).toBe("number");
  });
});

describe("getOperatorStatus", () => {
  it("returns a valid operator status object", async () => {
    const status = await getOperatorStatus();
    expect(status).toBeDefined();
    expect(status.pipelineStatus).toBeDefined();
    expect(["fresh", "stale", "failed", "never_run", "running"]).toContain(status.pipelineStatus);
    expect(typeof status.isFresh).toBe("boolean");
    expect(typeof status.isRunning).toBe("boolean");
    expect(typeof status.isMissedRun).toBe("boolean");
    expect(status.lastSuccessfulRun).toBeDefined();
    expect(status.lastAttempt).toBeDefined();
    expect(status.nextScheduledRun).toBeDefined();
    expect(typeof status.nextScheduledRun.expectedAt).toBe("string");
    expect(typeof status.nextScheduledRun.hoursUntil).toBe("number");
    expect(status.selfHealing).toBeDefined();
    expect(typeof status.selfHealing.active).toBe("boolean");
    expect(typeof status.selfHealing.attemptCount).toBe("number");
    expect(status.missedRunChecker).toBeDefined();
    expect(typeof status.missedRunChecker.active).toBe("boolean");
    expect(typeof status.serverUptimeSeconds).toBe("number");
  });
});
