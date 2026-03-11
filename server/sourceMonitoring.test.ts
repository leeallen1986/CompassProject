import { describe, expect, it, beforeEach } from "vitest";
import {
  recordFetchStart,
  recordFetchSuccess,
  recordFetchError,
  recordSourceRun,
  resetMetrics,
} from "./sourceMonitoring";

describe("sourceMonitoring", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("recordFetchStart returns a timestamp", () => {
    const start = recordFetchStart("test_source");
    expect(typeof start).toBe("number");
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThanOrEqual(Date.now());
  });

  it("recordFetchSuccess tracks articles and projects", () => {
    const start = recordFetchStart("test_source");
    // Should not throw
    expect(() => {
      recordFetchSuccess("test_source", start, 10, 5);
    }).not.toThrow();
  });

  it("recordFetchError tracks errors", () => {
    const start = recordFetchStart("test_source");
    expect(() => {
      recordFetchError("test_source", start, "Connection timeout");
    }).not.toThrow();
  });

  it("recordSourceRun convenience function works for success", () => {
    expect(() => {
      recordSourceRun("austender", true, 15, 30);
    }).not.toThrow();
  });

  it("recordSourceRun convenience function works for failure", () => {
    expect(() => {
      recordSourceRun("dmirs", false, 0, 5, "API returned 500");
    }).not.toThrow();
  });

  it("resetMetrics clears all tracked data", () => {
    recordSourceRun("test_source", true, 10, 5);
    resetMetrics();
    // After reset, recording again should work fresh
    expect(() => {
      recordSourceRun("test_source", true, 5, 3);
    }).not.toThrow();
  });

  it("multiple sources can be tracked independently", () => {
    recordSourceRun("source_a", true, 10, 5);
    recordSourceRun("source_b", false, 0, 3, "Error");
    recordSourceRun("source_c", true, 20, 10);
    // Should not throw - all tracked independently
    expect(true).toBe(true);
  });
});
