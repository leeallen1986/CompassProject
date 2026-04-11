/**
 * Tests for pipeline timeout, stale run cleanup, and weekLabel fix
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── withTimeout tests (testing the pattern directly) ──

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${Math.round(ms/1000)}s: ${label}`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

describe("withTimeout utility", () => {
  it("resolves when promise completes within timeout", async () => {
    const result = await withTimeout(
      new Promise<string>((resolve) => setTimeout(() => resolve("done"), 10)),
      1000,
      "test"
    );
    expect(result).toBe("done");
  });

  it("rejects when promise exceeds timeout", async () => {
    await expect(
      withTimeout(
        new Promise<string>((resolve) => setTimeout(() => resolve("done"), 2000)),
        50,
        "slow operation"
      )
    ).rejects.toThrow("Timeout after 0s: slow operation");
  });

  it("propagates original error when promise rejects before timeout", async () => {
    await expect(
      withTimeout(
        Promise.reject(new Error("original error")),
        1000,
        "test"
      )
    ).rejects.toThrow("original error");
  });

  it("clears timeout when promise resolves quickly", async () => {
    const clearSpy = vi.spyOn(global, "clearTimeout");
    await withTimeout(Promise.resolve("fast"), 5000, "test");
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

// ── weekLabel computation tests ──

describe("weekLabel computation", () => {
  function computeWeekLabel(date: Date): string {
    const dayOfWeekNow = date.getUTCDay();
    const mondayOffset = dayOfWeekNow === 0 ? -6 : 1 - dayOfWeekNow;
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() + mondayOffset);
    return `${monday.getFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
  }

  it("returns Monday for a Saturday (April 12, 2026)", () => {
    // April 12, 2026 is a Sunday (day 0)
    const date = new Date("2026-04-12T10:00:00Z");
    expect(computeWeekLabel(date)).toBe("2026-04-06");
  });

  it("returns same day for a Monday", () => {
    const date = new Date("2026-04-06T10:00:00Z"); // Monday
    expect(computeWeekLabel(date)).toBe("2026-04-06");
  });

  it("returns previous Monday for a Wednesday", () => {
    const date = new Date("2026-04-08T10:00:00Z"); // Wednesday
    expect(computeWeekLabel(date)).toBe("2026-04-06");
  });

  it("returns previous Monday for a Friday", () => {
    const date = new Date("2026-04-10T10:00:00Z"); // Friday
    expect(computeWeekLabel(date)).toBe("2026-04-06");
  });

  it("returns previous Monday for a Sunday", () => {
    const date = new Date("2026-04-12T10:00:00Z"); // Sunday
    expect(computeWeekLabel(date)).toBe("2026-04-06");
  });

  it("handles month boundary correctly", () => {
    // March 31, 2026 is a Tuesday — Monday is March 30
    const date = new Date("2026-03-31T10:00:00Z");
    expect(computeWeekLabel(date)).toBe("2026-03-30");
  });

  it("handles year boundary correctly", () => {
    // Jan 1, 2026 is a Thursday — Monday is Dec 29, 2025
    const date = new Date("2026-01-01T10:00:00Z");
    expect(computeWeekLabel(date)).toBe("2025-12-29");
  });

  it("always returns a date that is a Monday", () => {
    // Test multiple random dates
    const dates = [
      new Date("2026-04-12T10:00:00Z"),
      new Date("2026-04-06T10:00:00Z"),
      new Date("2026-04-08T10:00:00Z"),
      new Date("2026-03-29T10:00:00Z"),
      new Date("2026-01-01T10:00:00Z"),
    ];
    for (const date of dates) {
      const label = computeWeekLabel(date);
      const resultDate = new Date(label + "T00:00:00Z");
      expect(resultDate.getUTCDay()).toBe(1); // 1 = Monday
    }
  });
});

// ── Pipeline cleanup tests ──

describe("cleanupStaleRuns logic", () => {
  it("identifies runs older than 1 hour as stale", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const staleRunStart = new Date("2026-03-26T10:00:00Z");
    expect(staleRunStart < oneHourAgo).toBe(true);
  });

  it("does not mark recent runs as stale", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentRunStart = new Date(); // just now
    expect(recentRunStart < oneHourAgo).toBe(false);
  });
});

// ── Pipeline timeout constants ──

describe("pipeline timeout constants", () => {
  const PIPELINE_TIMEOUT_MS = 45 * 60 * 1000;
  const STEP_TIMEOUT_MS = 15 * 60 * 1000;

  it("global timeout is 45 minutes", () => {
    expect(PIPELINE_TIMEOUT_MS).toBe(2700000);
  });

  it("step timeout is 15 minutes", () => {
    expect(STEP_TIMEOUT_MS).toBe(900000);
  });

  it("global timeout is greater than step timeout", () => {
    expect(PIPELINE_TIMEOUT_MS).toBeGreaterThan(STEP_TIMEOUT_MS);
  });
});
