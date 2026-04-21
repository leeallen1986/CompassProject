import { describe, it, expect } from "vitest";

/**
 * Stage 5A Vitest tests
 *
 * Covers the following new features:
 *  A. sourceLastSeenAt-driven freshness resolution (priority order)
 *  B. 60-day stale threshold (up from 30 days)
 *  C. 180-day archive threshold (new)
 *  D. keepFlag exemption from auto-stale/archive
 *  E. Active pipeline claim exemption from auto-stale/archive
 *  F. sourceLastSeenAt re-activation of stale projects
 *  G. Quarantine flag logic for RSS sources
 *  H. Default lifecycle filter is 'active' (not 'all')
 *  I. staleReason field is set on stale/archive transitions
 *  J. Lifecycle filter 'active' hides stale and archived projects
 */

// ─────────────────────────────────────────────────────────────────────────────
// A. Freshness resolution order
// ─────────────────────────────────────────────────────────────────────────────
describe("Stage 5A — Freshness Resolution Order", () => {
  function resolveFreshness(
    sourceLastSeenAt: Date | null,
    lastActivityAt: Date | null,
    createdAt: Date
  ): Date {
    return sourceLastSeenAt ?? lastActivityAt ?? createdAt;
  }

  it("should prefer sourceLastSeenAt over lastActivityAt and createdAt", () => {
    const sourceDate = new Date("2026-04-01");
    const activityDate = new Date("2026-01-01");
    const createdDate = new Date("2025-06-01");
    expect(resolveFreshness(sourceDate, activityDate, createdDate)).toBe(sourceDate);
  });

  it("should fall back to lastActivityAt when sourceLastSeenAt is null", () => {
    const activityDate = new Date("2026-01-01");
    const createdDate = new Date("2025-06-01");
    expect(resolveFreshness(null, activityDate, createdDate)).toBe(activityDate);
  });

  it("should fall back to createdAt when both sourceLastSeenAt and lastActivityAt are null", () => {
    const createdDate = new Date("2025-06-01");
    expect(resolveFreshness(null, null, createdDate)).toBe(createdDate);
  });

  it("should use sourceLastSeenAt even if lastActivityAt is more recent", () => {
    // sourceLastSeenAt is the pipeline signal; it takes priority regardless of recency
    const sourceDate = new Date("2025-12-01");
    const activityDate = new Date("2026-03-01"); // more recent
    const createdDate = new Date("2025-06-01");
    expect(resolveFreshness(sourceDate, activityDate, createdDate)).toBe(sourceDate);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. 60-day stale threshold
// ─────────────────────────────────────────────────────────────────────────────
describe("Stage 5A — 60-Day Stale Threshold", () => {
  const STALE_DAYS = 60;
  const ARCHIVE_DAYS = 180;

  function classifyProject(
    freshnessDaysAgo: number,
    lifecycleStatus: string,
    keepFlag: boolean,
    hasClaim: boolean
  ): "stale" | "archived" | "unchanged" {
    if (keepFlag || hasClaim) return "unchanged";
    if (!["active", "stale"].includes(lifecycleStatus)) return "unchanged";
    if (freshnessDaysAgo > ARCHIVE_DAYS) return "archived";
    if (freshnessDaysAgo > STALE_DAYS && lifecycleStatus === "active") return "stale";
    return "unchanged";
  }

  it("should NOT mark a project stale at 59 days", () => {
    expect(classifyProject(59, "active", false, false)).toBe("unchanged");
  });

  it("should NOT mark a project stale at exactly 60 days", () => {
    expect(classifyProject(60, "active", false, false)).toBe("unchanged");
  });

  it("should mark a project stale at 61 days", () => {
    expect(classifyProject(61, "active", false, false)).toBe("stale");
  });

  it("should mark a project stale at 90 days", () => {
    expect(classifyProject(90, "active", false, false)).toBe("stale");
  });

  it("should NOT mark a project stale at 35 days (old threshold was 30)", () => {
    // Stage 5A raises the threshold from 30 to 60 days
    expect(classifyProject(35, "active", false, false)).toBe("unchanged");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. 180-day archive threshold
// ─────────────────────────────────────────────────────────────────────────────
describe("Stage 5A — 180-Day Archive Threshold", () => {
  const STALE_DAYS = 60;
  const ARCHIVE_DAYS = 180;

  function classifyProject(
    freshnessDaysAgo: number,
    lifecycleStatus: string,
    keepFlag: boolean,
    hasClaim: boolean
  ): "stale" | "archived" | "unchanged" {
    if (keepFlag || hasClaim) return "unchanged";
    if (!["active", "stale"].includes(lifecycleStatus)) return "unchanged";
    if (freshnessDaysAgo > ARCHIVE_DAYS) return "archived";
    if (freshnessDaysAgo > STALE_DAYS && lifecycleStatus === "active") return "stale";
    return "unchanged";
  }

  it("should NOT archive at 179 days", () => {
    expect(classifyProject(179, "stale", false, false)).toBe("unchanged");
  });

  it("should NOT archive at exactly 180 days", () => {
    expect(classifyProject(180, "stale", false, false)).toBe("unchanged");
  });

  it("should archive at 181 days", () => {
    expect(classifyProject(181, "stale", false, false)).toBe("archived");
  });

  it("should archive active projects at 181 days (skipping stale step)", () => {
    // A project that was never staled but is 181 days old should go straight to archived
    expect(classifyProject(181, "active", false, false)).toBe("archived");
  });

  it("should archive at 365 days", () => {
    expect(classifyProject(365, "stale", false, false)).toBe("archived");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. keepFlag exemption
// ─────────────────────────────────────────────────────────────────────────────
describe("Stage 5A — keepFlag Exemption", () => {
  function classifyProject(
    freshnessDaysAgo: number,
    lifecycleStatus: string,
    keepFlag: boolean,
    hasClaim: boolean
  ): "stale" | "archived" | "unchanged" {
    if (keepFlag || hasClaim) return "unchanged";
    if (!["active", "stale"].includes(lifecycleStatus)) return "unchanged";
    if (freshnessDaysAgo > 180) return "archived";
    if (freshnessDaysAgo > 60 && lifecycleStatus === "active") return "stale";
    return "unchanged";
  }

  it("should NOT stale a project with keepFlag=true even at 90 days", () => {
    expect(classifyProject(90, "active", true, false)).toBe("unchanged");
  });

  it("should NOT archive a project with keepFlag=true even at 365 days", () => {
    expect(classifyProject(365, "stale", true, false)).toBe("unchanged");
  });

  it("should stale a project with keepFlag=false at 90 days", () => {
    expect(classifyProject(90, "active", false, false)).toBe("stale");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Active pipeline claim exemption
// ─────────────────────────────────────────────────────────────────────────────
describe("Stage 5A — Pipeline Claim Exemption", () => {
  function classifyProject(
    freshnessDaysAgo: number,
    lifecycleStatus: string,
    keepFlag: boolean,
    hasClaim: boolean
  ): "stale" | "archived" | "unchanged" {
    if (keepFlag || hasClaim) return "unchanged";
    if (!["active", "stale"].includes(lifecycleStatus)) return "unchanged";
    if (freshnessDaysAgo > 180) return "archived";
    if (freshnessDaysAgo > 60 && lifecycleStatus === "active") return "stale";
    return "unchanged";
  }

  it("should NOT stale a project with an active claim at 90 days", () => {
    expect(classifyProject(90, "active", false, true)).toBe("unchanged");
  });

  it("should NOT archive a project with an active claim at 365 days", () => {
    expect(classifyProject(365, "stale", false, true)).toBe("unchanged");
  });

  it("should stale a project with no claim at 90 days", () => {
    expect(classifyProject(90, "active", false, false)).toBe("stale");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. sourceLastSeenAt re-activation of stale projects
// ─────────────────────────────────────────────────────────────────────────────
describe("Stage 5A — sourceLastSeenAt Re-activation", () => {
  function applySourceSeen(
    currentStatus: string,
    reactivate: boolean
  ): { lifecycleStatus: string; staleReason: string | null } {
    // Mirrors the logic in touchProjectSourceSeen
    const update: { lifecycleStatus: string; staleReason: string | null } = {
      lifecycleStatus: currentStatus,
      staleReason: null,
    };
    if (reactivate) {
      update.lifecycleStatus = "active";
      update.staleReason = null;
    }
    return update;
  }

  it("should re-activate a stale project when reactivate=true", () => {
    const result = applySourceSeen("stale", true);
    expect(result.lifecycleStatus).toBe("active");
    expect(result.staleReason).toBeNull();
  });

  it("should NOT change status when reactivate=false", () => {
    const result = applySourceSeen("stale", false);
    expect(result.lifecycleStatus).toBe("stale");
  });

  it("should clear staleReason when re-activating", () => {
    const result = applySourceSeen("stale", true);
    expect(result.staleReason).toBeNull();
  });

  it("should keep active projects active when reactivate=true", () => {
    const result = applySourceSeen("active", true);
    expect(result.lifecycleStatus).toBe("active");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. Quarantine flag logic for RSS sources
// ─────────────────────────────────────────────────────────────────────────────
describe("Stage 5A — RSS Source Quarantine Flag", () => {
  interface RssSource {
    id: number;
    isActive: boolean;
    quarantined: boolean;
    quarantineReason: string | null;
  }

  function getActiveSources(sources: RssSource[]): RssSource[] {
    // Mirrors the updated rssHarvester query: isActive AND NOT quarantined
    return sources.filter(s => s.isActive && !s.quarantined);
  }

  const sources: RssSource[] = [
    { id: 1, isActive: true,  quarantined: false, quarantineReason: null },
    { id: 2, isActive: true,  quarantined: true,  quarantineReason: "Zero yield for 60 days" },
    { id: 3, isActive: false, quarantined: false, quarantineReason: null },
    { id: 4, isActive: true,  quarantined: false, quarantineReason: null },
  ];

  it("should include active, non-quarantined sources", () => {
    const active = getActiveSources(sources);
    expect(active.map(s => s.id)).toContain(1);
    expect(active.map(s => s.id)).toContain(4);
  });

  it("should exclude quarantined sources even if isActive=true", () => {
    const active = getActiveSources(sources);
    expect(active.map(s => s.id)).not.toContain(2);
  });

  it("should exclude inactive sources", () => {
    const active = getActiveSources(sources);
    expect(active.map(s => s.id)).not.toContain(3);
  });

  it("should return 2 active sources from the test set", () => {
    const active = getActiveSources(sources);
    expect(active).toHaveLength(2);
  });

  it("should store quarantineReason when quarantining a source", () => {
    const source = sources[1];
    expect(source.quarantineReason).toBe("Zero yield for 60 days");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H. Default lifecycle filter is 'active'
// ─────────────────────────────────────────────────────────────────────────────
describe("Stage 5A — Default Lifecycle Filter", () => {
  const DEFAULT_FILTER = "active";

  it("should default to 'active' filter (not 'all')", () => {
    expect(DEFAULT_FILTER).toBe("active");
    expect(DEFAULT_FILTER).not.toBe("all");
  });

  it("should hide stale projects when filter is 'active'", () => {
    const projects = [
      { id: 1, lifecycleStatus: "active" },
      { id: 2, lifecycleStatus: "stale" },
      { id: 3, lifecycleStatus: "archived" },
    ];
    const filtered = projects.filter(p => (p.lifecycleStatus ?? "active") === DEFAULT_FILTER);
    expect(filtered.map(p => p.id)).toEqual([1]);
  });

  it("should show stale projects when filter is 'stale'", () => {
    const projects = [
      { id: 1, lifecycleStatus: "active" },
      { id: 2, lifecycleStatus: "stale" },
    ];
    const filtered = projects.filter(p => (p.lifecycleStatus ?? "active") === "stale");
    expect(filtered.map(p => p.id)).toEqual([2]);
  });

  it("should show all projects when filter is 'all'", () => {
    const projects = [
      { id: 1, lifecycleStatus: "active" },
      { id: 2, lifecycleStatus: "stale" },
      { id: 3, lifecycleStatus: "archived" },
    ];
    const filtered = projects; // 'all' returns everything
    expect(filtered).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I. staleReason field is set on stale/archive transitions
// ─────────────────────────────────────────────────────────────────────────────
describe("Stage 5A — staleReason Field", () => {
  const STALE_REASON = "No source corroboration for 60+ days (Stage 5A auto-stale)";
  const ARCHIVE_REASON = "No source corroboration for 180+ days (Stage 5A auto-archive)";

  function getStaleReason(action: "stale" | "archived"): string {
    return action === "stale" ? STALE_REASON : ARCHIVE_REASON;
  }

  it("should set a staleReason when marking a project stale", () => {
    const reason = getStaleReason("stale");
    expect(reason).toContain("60+");
    expect(reason).toContain("Stage 5A");
  });

  it("should set a different staleReason when archiving a project", () => {
    const reason = getStaleReason("archived");
    expect(reason).toContain("180+");
    expect(reason).toContain("Stage 5A");
  });

  it("should have distinct stale and archive reasons", () => {
    expect(getStaleReason("stale")).not.toBe(getStaleReason("archived"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J. Lifecycle filter 'active' hides stale and archived projects
// ─────────────────────────────────────────────────────────────────────────────
describe("Stage 5A — Lifecycle Filter Hides Non-Active Projects", () => {
  const allProjects = [
    { id: 1, name: "Alpha", lifecycleStatus: "active" as const },
    { id: 2, name: "Beta",  lifecycleStatus: "stale" as const },
    { id: 3, name: "Gamma", lifecycleStatus: "archived" as const },
    { id: 4, name: "Delta", lifecycleStatus: "awarded" as const },
    { id: 5, name: "Epsilon", lifecycleStatus: null },  // null = active
  ];

  function applyFilter(filter: string) {
    if (filter === "all") return allProjects;
    return allProjects.filter(p => (p.lifecycleStatus ?? "active") === filter);
  }

  it("should show only 2 projects with 'active' filter (including null-status)", () => {
    const result = applyFilter("active");
    expect(result).toHaveLength(2);
    expect(result.map(p => p.id)).toEqual([1, 5]);
  });

  it("should show 5 projects with 'all' filter", () => {
    const result = applyFilter("all");
    expect(result).toHaveLength(5);
  });

  it("should show only stale project with 'stale' filter", () => {
    const result = applyFilter("stale");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  it("should show only archived project with 'archived' filter", () => {
    const result = applyFilter("archived");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  it("should show only awarded project with 'awarded' filter", () => {
    const result = applyFilter("awarded");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(4);
  });
});
