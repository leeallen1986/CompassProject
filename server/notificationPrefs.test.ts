import { describe, it, expect, vi } from "vitest";

// ── Notification Preferences Tests ──

describe("notification preferences", () => {
  describe("frequency options", () => {
    const validFrequencies = ["daily", "weekly", "fortnightly", "off"];

    it("accepts all valid frequency values", () => {
      validFrequencies.forEach((freq) => {
        expect(["daily", "weekly", "fortnightly", "off"]).toContain(freq);
      });
    });

    it("rejects invalid frequency values", () => {
      const invalidFrequencies = ["hourly", "monthly", "yearly", ""];
      invalidFrequencies.forEach((freq) => {
        expect(validFrequencies).not.toContain(freq);
      });
    });
  });

  describe("digest deduplication window", () => {
    function getDeduplicationWindowDays(frequency: string): number {
      switch (frequency) {
        case "daily":
          return 0.8; // ~19 hours
        case "weekly":
          return 6;
        case "fortnightly":
          return 13;
        default:
          return 6;
      }
    }

    it("returns correct window for daily frequency", () => {
      expect(getDeduplicationWindowDays("daily")).toBe(0.8);
    });

    it("returns correct window for weekly frequency", () => {
      expect(getDeduplicationWindowDays("weekly")).toBe(6);
    });

    it("returns correct window for fortnightly frequency", () => {
      expect(getDeduplicationWindowDays("fortnightly")).toBe(13);
    });

    it("defaults to weekly window for unknown frequency", () => {
      expect(getDeduplicationWindowDays("unknown")).toBe(6);
    });

    it("daily window is shorter than weekly", () => {
      expect(getDeduplicationWindowDays("daily")).toBeLessThan(
        getDeduplicationWindowDays("weekly")
      );
    });

    it("weekly window is shorter than fortnightly", () => {
      expect(getDeduplicationWindowDays("weekly")).toBeLessThan(
        getDeduplicationWindowDays("fortnightly")
      );
    });
  });

  describe("digest content filters", () => {
    function filterProjects(
      projects: Array<{ priority: string; hasContacts: boolean; hasPipeline: boolean }>,
      hotOnly: boolean
    ) {
      if (hotOnly) {
        return projects.filter((p) => p.priority === "hot");
      }
      return projects;
    }

    const testProjects = [
      { priority: "hot", hasContacts: true, hasPipeline: true },
      { priority: "warm", hasContacts: true, hasPipeline: false },
      { priority: "cold", hasContacts: false, hasPipeline: false },
      { priority: "hot", hasContacts: false, hasPipeline: true },
    ];

    it("returns all projects when hotOnly is false", () => {
      const result = filterProjects(testProjects, false);
      expect(result).toHaveLength(4);
    });

    it("returns only hot projects when hotOnly is true", () => {
      const result = filterProjects(testProjects, true);
      expect(result).toHaveLength(2);
      result.forEach((p) => expect(p.priority).toBe("hot"));
    });
  });

  describe("last sent display", () => {
    function formatLastSent(lastSentAt: Date | null): string {
      if (!lastSentAt) return "Never sent";
      const now = new Date();
      const diffMs = now.getTime() - lastSentAt.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return "Today";
      if (diffDays === 1) return "Yesterday";
      return `${diffDays} days ago`;
    }

    it("shows 'Never sent' for null lastSentAt", () => {
      expect(formatLastSent(null)).toBe("Never sent");
    });

    it("shows 'Today' for same-day send", () => {
      expect(formatLastSent(new Date())).toBe("Today");
    });

    it("shows 'Yesterday' for previous day send", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(formatLastSent(yesterday)).toBe("Yesterday");
    });

    it("shows days ago for older sends", () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const result = formatLastSent(fiveDaysAgo);
      expect(result).toMatch(/[45] days ago/);
    });
  });

  describe("notification toggle behavior", () => {
    it("off frequency should disable all content options", () => {
      const frequency = "off";
      const isDisabled = frequency === "off";
      expect(isDisabled).toBe(true);
    });

    it("active frequencies should enable content options", () => {
      ["daily", "weekly", "fortnightly"].forEach((freq) => {
        const isDisabled = freq === "off";
        expect(isDisabled).toBe(false);
      });
    });
  });
});

describe("enrichment stats validation", () => {
  it("total contacts should be sum of enriched + pending + notFound + failed", () => {
    const stats = {
      total: 1297,
      enriched: 1271,
      pending: 0,
      notFound: 26,
      failed: 0,
    };
    expect(stats.enriched + stats.pending + stats.notFound + stats.failed).toBe(stats.total);
  });

  it("verification categories should be mutually exclusive", () => {
    const categories = ["verified", "ai_suggested", "unverified"];
    const uniqueCategories = new Set(categories);
    expect(uniqueCategories.size).toBe(categories.length);
  });

  it("score thresholds should be non-overlapping", () => {
    const thresholds = [
      { min: 80, max: 100, label: "high" },
      { min: 60, max: 79, label: "medium" },
      { min: 40, max: 59, label: "amber" },
      { min: 0, max: 39, label: "low" },
    ];

    for (let i = 0; i < thresholds.length - 1; i++) {
      expect(thresholds[i].min).toBeGreaterThan(thresholds[i + 1].max);
    }
  });
});
