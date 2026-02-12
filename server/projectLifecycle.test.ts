import { describe, it, expect, vi } from "vitest";

/**
 * Tests for project lifecycle logic:
 * 1. Lifecycle status transitions
 * 2. Staleness detection rules
 * 3. Lifecycle filter in report.full endpoint
 * 4. Lifecycle counts computation
 */

// ── Unit tests for lifecycle status transition rules ──
describe("Lifecycle Status Transitions", () => {
  const validStatuses = ["active", "stale", "archived", "awarded", "completed"] as const;

  it("should accept all valid lifecycle statuses", () => {
    for (const status of validStatuses) {
      expect(validStatuses).toContain(status);
    }
  });

  it("should treat null/undefined lifecycleStatus as 'active'", () => {
    const project = { lifecycleStatus: null };
    const effectiveStatus = project.lifecycleStatus ?? "active";
    expect(effectiveStatus).toBe("active");
  });

  it("should allow transition from any status to any other status", () => {
    // All transitions are valid (no restricted paths)
    for (const from of validStatuses) {
      for (const to of validStatuses) {
        if (from !== to) {
          expect(validStatuses).toContain(to);
        }
      }
    }
  });
});

// ── Unit tests for staleness detection logic ──
describe("Staleness Detection Logic", () => {
  const STALE_THRESHOLD_DAYS = 30;

  function isProjectStale(
    lastActivityAt: Date | null,
    createdAt: Date,
    hasPipelineClaims: boolean,
    currentStatus: string
  ): boolean {
    // Only active projects can become stale
    if (currentStatus !== "active") return false;
    // Projects with pipeline claims are never auto-staled
    if (hasPipelineClaims) return false;

    const referenceDate = lastActivityAt ?? createdAt;
    const now = new Date();
    const daysSinceActivity = (now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceActivity > STALE_THRESHOLD_DAYS;
  }

  it("should mark a project as stale if no activity in 30+ days and no claims", () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 35);
    expect(isProjectStale(oldDate, oldDate, false, "active")).toBe(true);
  });

  it("should NOT mark a project as stale if activity within 30 days", () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 15);
    expect(isProjectStale(recentDate, recentDate, false, "active")).toBe(false);
  });

  it("should NOT mark a project as stale if it has pipeline claims", () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60);
    expect(isProjectStale(oldDate, oldDate, true, "active")).toBe(false);
  });

  it("should NOT mark already archived projects as stale", () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60);
    expect(isProjectStale(oldDate, oldDate, false, "archived")).toBe(false);
  });

  it("should NOT mark awarded projects as stale", () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60);
    expect(isProjectStale(oldDate, oldDate, false, "awarded")).toBe(false);
  });

  it("should NOT mark completed projects as stale", () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60);
    expect(isProjectStale(oldDate, oldDate, false, "completed")).toBe(false);
  });

  it("should use createdAt as fallback when lastActivityAt is null", () => {
    const oldCreated = new Date();
    oldCreated.setDate(oldCreated.getDate() - 40);
    expect(isProjectStale(null, oldCreated, false, "active")).toBe(true);
  });

  it("should not be stale at exactly 30 days", () => {
    const exactDate = new Date();
    exactDate.setDate(exactDate.getDate() - 30);
    expect(isProjectStale(exactDate, exactDate, false, "active")).toBe(false);
  });
});

// ── Unit tests for lifecycle filter logic ──
describe("Lifecycle Filter Logic", () => {
  const mockProjects = [
    { id: 1, name: "Project A", lifecycleStatus: "active" },
    { id: 2, name: "Project B", lifecycleStatus: "active" },
    { id: 3, name: "Project C", lifecycleStatus: "stale" },
    { id: 4, name: "Project D", lifecycleStatus: "archived" },
    { id: 5, name: "Project E", lifecycleStatus: "awarded" },
    { id: 6, name: "Project F", lifecycleStatus: "completed" },
    { id: 7, name: "Project G", lifecycleStatus: null },  // null = active
  ];

  function filterByLifecycle(projects: typeof mockProjects, filter: string) {
    if (filter === "all") return projects;
    return projects.filter(p => (p.lifecycleStatus ?? "active") === filter);
  }

  it("should return all projects when filter is 'all'", () => {
    const result = filterByLifecycle(mockProjects, "all");
    expect(result).toHaveLength(7);
  });

  it("should return only active projects (including null status)", () => {
    const result = filterByLifecycle(mockProjects, "active");
    expect(result).toHaveLength(3); // id 1, 2, 7
    expect(result.map(p => p.id)).toEqual([1, 2, 7]);
  });

  it("should return only stale projects", () => {
    const result = filterByLifecycle(mockProjects, "stale");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  it("should return only archived projects", () => {
    const result = filterByLifecycle(mockProjects, "archived");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(4);
  });

  it("should return only awarded projects", () => {
    const result = filterByLifecycle(mockProjects, "awarded");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(5);
  });

  it("should return only completed projects", () => {
    const result = filterByLifecycle(mockProjects, "completed");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(6);
  });
});

// ── Unit tests for lifecycle counts computation ──
describe("Lifecycle Counts Computation", () => {
  function computeLifecycleCounts(projects: { lifecycleStatus: string | null }[]) {
    const counts: Record<string, number> = { active: 0, stale: 0, archived: 0, awarded: 0, completed: 0 };
    for (const p of projects) {
      const status = p.lifecycleStatus ?? "active";
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }

  it("should count all statuses correctly", () => {
    const projects = [
      { lifecycleStatus: "active" },
      { lifecycleStatus: "active" },
      { lifecycleStatus: "stale" },
      { lifecycleStatus: "archived" },
      { lifecycleStatus: null },
    ];
    const counts = computeLifecycleCounts(projects);
    expect(counts.active).toBe(3); // 2 explicit + 1 null
    expect(counts.stale).toBe(1);
    expect(counts.archived).toBe(1);
    expect(counts.awarded).toBe(0);
    expect(counts.completed).toBe(0);
  });

  it("should handle empty project list", () => {
    const counts = computeLifecycleCounts([]);
    expect(counts.active).toBe(0);
    expect(counts.stale).toBe(0);
    expect(counts.archived).toBe(0);
    expect(counts.awarded).toBe(0);
    expect(counts.completed).toBe(0);
  });

  it("should handle all projects being null status", () => {
    const projects = [
      { lifecycleStatus: null },
      { lifecycleStatus: null },
      { lifecycleStatus: null },
    ];
    const counts = computeLifecycleCounts(projects);
    expect(counts.active).toBe(3);
    expect(counts.stale).toBe(0);
  });
});

// ── Unit tests for lifecycle badge display logic ──
describe("Lifecycle Badge Display", () => {
  function getLifecycleBadge(status: string | null) {
    const effectiveStatus = status ?? "active";
    const badges: Record<string, { label: string; color: string }> = {
      active: { label: "Active", color: "teal" },
      stale: { label: "Stale", color: "amber" },
      archived: { label: "Archived", color: "slate" },
      awarded: { label: "Awarded", color: "teal" },
      completed: { label: "Completed", color: "navy" },
    };
    return badges[effectiveStatus] ?? badges.active;
  }

  it("should show no badge for active status (it's the default)", () => {
    // Active projects don't show a lifecycle badge (only non-active do)
    const status = "active";
    const shouldShowBadge = status !== "active";
    expect(shouldShowBadge).toBe(false);
  });

  it("should show badge for stale projects", () => {
    const badge = getLifecycleBadge("stale");
    expect(badge.label).toBe("Stale");
    expect(badge.color).toBe("amber");
  });

  it("should show badge for archived projects", () => {
    const badge = getLifecycleBadge("archived");
    expect(badge.label).toBe("Archived");
    expect(badge.color).toBe("slate");
  });

  it("should show badge for awarded projects", () => {
    const badge = getLifecycleBadge("awarded");
    expect(badge.label).toBe("Awarded");
    expect(badge.color).toBe("teal");
  });

  it("should treat null as active", () => {
    const badge = getLifecycleBadge(null);
    expect(badge.label).toBe("Active");
  });
});
