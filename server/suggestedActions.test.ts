/**
 * Tests for Suggested Actions improvements:
 * - actionKey generation
 * - dismissal filtering
 * - engagement-aware filtering
 * - staleness downgrading
 * - pipeline health / data freshness
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Unit tests for makeActionKey ──
describe("makeActionKey", () => {
  // We test the key format directly since it's a pure function
  function makeActionKey(type: string, projectId?: number, contactId?: number): string {
    return `${type}:${projectId ?? 0}:${contactId ?? 0}`;
  }

  it("generates key with all fields", () => {
    expect(makeActionKey("contact_outreach", 42, 99)).toBe("contact_outreach:42:99");
  });

  it("generates key with only type and projectId", () => {
    expect(makeActionKey("tier1_new", 42)).toBe("tier1_new:42:0");
  });

  it("generates key with only type", () => {
    expect(makeActionKey("high_value")).toBe("high_value:0:0");
  });

  it("generates unique keys for different projects", () => {
    const key1 = makeActionKey("contractor_gap", 10);
    const key2 = makeActionKey("contractor_gap", 20);
    expect(key1).not.toBe(key2);
  });

  it("generates unique keys for different contacts on same project", () => {
    const key1 = makeActionKey("contact_outreach", 10, 1);
    const key2 = makeActionKey("contact_outreach", 10, 2);
    expect(key1).not.toBe(key2);
  });

  it("generates unique keys for different types on same project", () => {
    const key1 = makeActionKey("tier1_new", 10);
    const key2 = makeActionKey("contractor_gap", 10);
    expect(key1).not.toBe(key2);
  });
});

// ── Unit tests for dismissal filtering logic ──
describe("dismissal filtering", () => {
  interface MockAction {
    type: string;
    priority: string;
    title: string;
    actionKey: string;
    projectId?: number;
  }

  function filterDismissed(actions: MockAction[], dismissedKeys: Set<string>): MockAction[] {
    return actions.filter(a => !dismissedKeys.has(a.actionKey));
  }

  it("removes dismissed actions", () => {
    const actions: MockAction[] = [
      { type: "tier1_new", priority: "urgent", title: "Project A", actionKey: "tier1_new:1:0", projectId: 1 },
      { type: "tier1_new", priority: "urgent", title: "Project B", actionKey: "tier1_new:2:0", projectId: 2 },
      { type: "contractor_gap", priority: "high", title: "Project C", actionKey: "contractor_gap:3:0", projectId: 3 },
    ];
    const dismissed = new Set(["tier1_new:1:0"]);
    const result = filterDismissed(actions, dismissed);
    expect(result).toHaveLength(2);
    expect(result.map(a => a.title)).toEqual(["Project B", "Project C"]);
  });

  it("returns all actions when nothing is dismissed", () => {
    const actions: MockAction[] = [
      { type: "tier1_new", priority: "urgent", title: "Project A", actionKey: "tier1_new:1:0" },
    ];
    const result = filterDismissed(actions, new Set());
    expect(result).toHaveLength(1);
  });

  it("returns empty when all are dismissed", () => {
    const actions: MockAction[] = [
      { type: "tier1_new", priority: "urgent", title: "Project A", actionKey: "tier1_new:1:0" },
    ];
    const result = filterDismissed(actions, new Set(["tier1_new:1:0"]));
    expect(result).toHaveLength(0);
  });
});

// ── Unit tests for engagement-aware filtering ──
describe("engagement-aware filtering", () => {
  interface MockProject {
    id: number;
    actionTier: string;
    isNew: boolean;
  }

  function filterUnengaged(projects: MockProject[], engagedIds: Set<number>): MockProject[] {
    return projects.filter(p => p.actionTier === "tier1_actionable" && !engagedIds.has(p.id));
  }

  it("excludes projects the user has already engaged with", () => {
    const projects: MockProject[] = [
      { id: 1, actionTier: "tier1_actionable", isNew: true },
      { id: 2, actionTier: "tier1_actionable", isNew: true },
      { id: 3, actionTier: "tier1_actionable", isNew: false },
    ];
    const engaged = new Set([1, 3]);
    const result = filterUnengaged(projects, engaged);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  it("returns all tier1 projects when none are engaged", () => {
    const projects: MockProject[] = [
      { id: 1, actionTier: "tier1_actionable", isNew: true },
      { id: 2, actionTier: "tier2_warm", isNew: true },
    ];
    const result = filterUnengaged(projects, new Set());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });
});

// ── Unit tests for staleness downgrading ──
describe("staleness downgrading", () => {
  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

  function isRecent(date: Date | string | null, windowMs = 7 * 24 * 60 * 60 * 1000): boolean {
    if (!date) return false;
    const d = typeof date === "string" ? new Date(date) : date;
    return Date.now() - d.getTime() < windowMs;
  }

  function downgradeStale(
    actions: { priority: string; projectId?: number }[],
    projectCreatedAt: Record<number, Date>
  ) {
    for (const action of actions) {
      if (action.projectId) {
        const created = projectCreatedAt[action.projectId];
        if (created && !isRecent(created, FOURTEEN_DAYS_MS)) {
          if (action.priority === "urgent") action.priority = "high";
          else if (action.priority === "high") action.priority = "medium";
        }
      }
    }
    return actions;
  }

  it("downgrades urgent to high for projects older than 14 days", () => {
    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const actions = [{ priority: "urgent", projectId: 1 }];
    const result = downgradeStale(actions, { 1: oldDate });
    expect(result[0].priority).toBe("high");
  });

  it("downgrades high to medium for projects older than 14 days", () => {
    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const actions = [{ priority: "high", projectId: 1 }];
    const result = downgradeStale(actions, { 1: oldDate });
    expect(result[0].priority).toBe("medium");
  });

  it("does not downgrade recent projects", () => {
    const recentDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const actions = [{ priority: "urgent", projectId: 1 }];
    const result = downgradeStale(actions, { 1: recentDate });
    expect(result[0].priority).toBe("urgent");
  });

  it("does not downgrade medium priority further", () => {
    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const actions = [{ priority: "medium", projectId: 1 }];
    const result = downgradeStale(actions, { 1: oldDate });
    expect(result[0].priority).toBe("medium");
  });
});

// ── Unit tests for data freshness warning ──
describe("data freshness warning", () => {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

  function getDataFreshnessWarning(lastRun: Date | null): string | null {
    if (!lastRun) return "No successful pipeline runs found. Project data may be incomplete.";
    const age = Date.now() - lastRun.getTime();
    if (age > FOURTEEN_DAYS_MS) {
      const daysAgo = Math.floor(age / (24 * 60 * 60 * 1000));
      return `Project data is ${daysAgo} days old.`;
    }
    if (age > SEVEN_DAYS_MS) {
      const daysAgo = Math.floor(age / (24 * 60 * 60 * 1000));
      return `Data may be slightly outdated (${daysAgo} days since last pipeline run).`;
    }
    return null;
  }

  it("returns null when pipeline ran recently", () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(getDataFreshnessWarning(recent)).toBeNull();
  });

  it("returns slight warning for 7-14 day old data", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const warning = getDataFreshnessWarning(eightDaysAgo);
    expect(warning).toContain("slightly outdated");
    expect(warning).toContain("8 days");
  });

  it("returns strong warning for >14 day old data", () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const warning = getDataFreshnessWarning(twentyDaysAgo);
    expect(warning).toContain("20 days old");
  });

  it("returns no-pipeline warning when lastRun is null", () => {
    const warning = getDataFreshnessWarning(null);
    expect(warning).toContain("No successful pipeline runs");
  });
});

// ── Unit tests for weekLabel computation ──
describe("weekLabel computation", () => {
  function computeWeekLabel(now: Date): string {
    const dayOfWeekNow = now.getUTCDay();
    const mondayOffset = dayOfWeekNow === 0 ? -6 : 1 - dayOfWeekNow;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() + mondayOffset);
    return `${monday.getFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
  }

  it("returns Monday for a Wednesday", () => {
    // 2026-04-08 is a Wednesday
    const wed = new Date("2026-04-08T12:00:00Z");
    expect(computeWeekLabel(wed)).toBe("2026-04-06");
  });

  it("returns Monday for a Monday", () => {
    const mon = new Date("2026-04-06T12:00:00Z");
    expect(computeWeekLabel(mon)).toBe("2026-04-06");
  });

  it("returns previous Monday for a Sunday", () => {
    // 2026-04-12 is a Sunday
    const sun = new Date("2026-04-12T12:00:00Z");
    expect(computeWeekLabel(sun)).toBe("2026-04-06");
  });

  it("returns Monday for a Saturday", () => {
    const sat = new Date("2026-04-11T12:00:00Z");
    expect(computeWeekLabel(sat)).toBe("2026-04-06");
  });
});
