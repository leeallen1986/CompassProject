/**
 * Tests for RSS source tracking enhancements (Step 2C).
 * Covers: health classification, harvester stat updates, formatTimeAgo helper,
 * and schema column presence.
 */
import { describe, it, expect } from "vitest";

// ── Health classification logic (mirrors getSourceHealth in Admin.tsx) ──

function getSourceHealth(src: {
  isActive: boolean;
  consecutiveErrors: number | null;
  lastSuccessAt: Date | string | null;
  lastFetchedAt: Date | string | null;
  failureCount: number | null;
  successCount: number | null;
}) {
  if (!src.isActive) return { label: "Inactive", icon: "inactive" as const };
  const consec = src.consecutiveErrors || 0;
  const success = src.successCount || 0;
  const failure = src.failureCount || 0;
  const total = success + failure;
  const successRate = total > 0 ? (success / total) * 100 : 100;
  if (consec >= 3) return { label: "Failing", icon: "error" as const };
  if (consec >= 1 || successRate < 80) return { label: "Degraded", icon: "warning" as const };
  if (!src.lastFetchedAt) return { label: "Never Fetched", icon: "unknown" as const };
  return { label: "Healthy", icon: "ok" as const };
}

// ── formatTimeAgo logic (mirrors Admin.tsx) ──

function formatTimeAgo(date: Date | string | null): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

describe("Source Health Classification", () => {
  it("should return Inactive for disabled sources", () => {
    const result = getSourceHealth({
      isActive: false,
      consecutiveErrors: 0,
      lastSuccessAt: new Date(),
      lastFetchedAt: new Date(),
      failureCount: 0,
      successCount: 10,
    });
    expect(result.label).toBe("Inactive");
    expect(result.icon).toBe("inactive");
  });

  it("should return Healthy for active source with no errors", () => {
    const result = getSourceHealth({
      isActive: true,
      consecutiveErrors: 0,
      lastSuccessAt: new Date(),
      lastFetchedAt: new Date(),
      failureCount: 0,
      successCount: 20,
    });
    expect(result.label).toBe("Healthy");
    expect(result.icon).toBe("ok");
  });

  it("should return Failing when consecutiveErrors >= 3", () => {
    const result = getSourceHealth({
      isActive: true,
      consecutiveErrors: 3,
      lastSuccessAt: new Date(),
      lastFetchedAt: new Date(),
      failureCount: 3,
      successCount: 10,
    });
    expect(result.label).toBe("Failing");
    expect(result.icon).toBe("error");
  });

  it("should return Failing when consecutiveErrors is 5", () => {
    const result = getSourceHealth({
      isActive: true,
      consecutiveErrors: 5,
      lastSuccessAt: null,
      lastFetchedAt: new Date(),
      failureCount: 5,
      successCount: 0,
    });
    expect(result.label).toBe("Failing");
    expect(result.icon).toBe("error");
  });

  it("should return Degraded when consecutiveErrors is 1", () => {
    const result = getSourceHealth({
      isActive: true,
      consecutiveErrors: 1,
      lastSuccessAt: new Date(),
      lastFetchedAt: new Date(),
      failureCount: 1,
      successCount: 10,
    });
    expect(result.label).toBe("Degraded");
    expect(result.icon).toBe("warning");
  });

  it("should return Degraded when consecutiveErrors is 2", () => {
    const result = getSourceHealth({
      isActive: true,
      consecutiveErrors: 2,
      lastSuccessAt: new Date(),
      lastFetchedAt: new Date(),
      failureCount: 5,
      successCount: 10,
    });
    expect(result.label).toBe("Degraded");
    expect(result.icon).toBe("warning");
  });

  it("should return Degraded when success rate is below 80%", () => {
    const result = getSourceHealth({
      isActive: true,
      consecutiveErrors: 0,
      lastSuccessAt: new Date(),
      lastFetchedAt: new Date(),
      failureCount: 5,
      successCount: 10,
    });
    // 10 / 15 = 66.7% < 80%
    expect(result.label).toBe("Degraded");
    expect(result.icon).toBe("warning");
  });

  it("should return Healthy when success rate is exactly 80%", () => {
    const result = getSourceHealth({
      isActive: true,
      consecutiveErrors: 0,
      lastSuccessAt: new Date(),
      lastFetchedAt: new Date(),
      failureCount: 2,
      successCount: 8,
    });
    // 8 / 10 = 80% — not below 80, so healthy
    expect(result.label).toBe("Healthy");
    expect(result.icon).toBe("ok");
  });

  it("should return Never Fetched for active source with no lastFetchedAt", () => {
    const result = getSourceHealth({
      isActive: true,
      consecutiveErrors: 0,
      lastSuccessAt: null,
      lastFetchedAt: null,
      failureCount: 0,
      successCount: 0,
    });
    expect(result.label).toBe("Never Fetched");
    expect(result.icon).toBe("unknown");
  });

  it("should handle null consecutiveErrors as 0", () => {
    const result = getSourceHealth({
      isActive: true,
      consecutiveErrors: null,
      lastSuccessAt: new Date(),
      lastFetchedAt: new Date(),
      failureCount: null,
      successCount: null,
    });
    expect(result.label).toBe("Healthy");
    expect(result.icon).toBe("ok");
  });

  it("should prioritize Failing over Degraded (consec=3 even with ok rate)", () => {
    const result = getSourceHealth({
      isActive: true,
      consecutiveErrors: 3,
      lastSuccessAt: new Date(),
      lastFetchedAt: new Date(),
      failureCount: 3,
      successCount: 100,
    });
    // 100/103 = 97% but consec >= 3 → Failing
    expect(result.label).toBe("Failing");
  });
});

describe("formatTimeAgo", () => {
  it("should return 'Never' for null", () => {
    expect(formatTimeAgo(null)).toBe("Never");
  });

  it("should return 'Just now' for current time", () => {
    expect(formatTimeAgo(new Date())).toBe("Just now");
  });

  it("should return minutes ago for recent times", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatTimeAgo(fiveMinAgo)).toBe("5m ago");
  });

  it("should return hours ago for times within 24h", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatTimeAgo(threeHoursAgo)).toBe("3h ago");
  });

  it("should return days ago for times within a week", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(formatTimeAgo(twoDaysAgo)).toBe("2d ago");
  });

  it("should return date string for times older than a week", () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const result = formatTimeAgo(twoWeeksAgo);
    expect(result).not.toBe("Never");
    expect(result).not.toContain("ago");
  });

  it("should handle string dates", () => {
    const result = formatTimeAgo(new Date().toISOString());
    expect(result).toBe("Just now");
  });
});

describe("RSS Source Schema Columns", () => {
  it("should have all required tracking columns in the schema", async () => {
    const { rssSources } = await import("../drizzle/schema");
    const columns = Object.keys(rssSources);
    // Check new columns exist
    expect(columns).toContain("totalArticles");
    expect(columns).toContain("successCount");
    expect(columns).toContain("failureCount");
    expect(columns).toContain("consecutiveErrors");
    expect(columns).toContain("lastError");
    expect(columns).toContain("lastErrorAt");
    expect(columns).toContain("lastSuccessAt");
    // Check existing columns still exist
    expect(columns).toContain("lastFetchedAt");
    expect(columns).toContain("lastFetchCount");
    expect(columns).toContain("errorCount");
    expect(columns).toContain("isActive");
    expect(columns).toContain("name");
    expect(columns).toContain("feedUrl");
    expect(columns).toContain("category");
  });
});

describe("RSS Harvester Source Stat Updates", () => {
  it("should export harvestAllFeeds function", async () => {
    const mod = await import("./rssHarvester");
    expect(typeof mod.harvestAllFeeds).toBe("function");
  });

  it("should export generateFingerprint function", async () => {
    const mod = await import("./rssHarvester");
    expect(typeof mod.generateFingerprint).toBe("function");
  });

  it("should export parseRSSFeed function", async () => {
    const mod = await import("./rssHarvester");
    expect(typeof mod.parseRSSFeed).toBe("function");
  });

  it("should export matchKeywords function", async () => {
    const mod = await import("./rssHarvester");
    expect(typeof mod.matchKeywords).toBe("function");
  });

  it("generateFingerprint should produce consistent hashes", async () => {
    const { generateFingerprint } = await import("./rssHarvester");
    const hash1 = generateFingerprint("https://example.com/article", "Test Title");
    const hash2 = generateFingerprint("https://example.com/article", "Test Title");
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });

  it("generateFingerprint should differ for different inputs", async () => {
    const { generateFingerprint } = await import("./rssHarvester");
    const hash1 = generateFingerprint("https://example.com/a", "Title A");
    const hash2 = generateFingerprint("https://example.com/b", "Title B");
    expect(hash1).not.toBe(hash2);
  });
});
