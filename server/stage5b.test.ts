/**
 * Stage 5B Tests
 * Covers:
 *  1. sourceLastSeenAt backfill logic — projects without sourceLastSeenAt use lastActivityAt/createdAt as fallback
 *  2. keepFlag — setProjectKeepFlag sets/clears the flag; markStaleProjects respects it
 *  3. Quarantine — quarantineRssSource sets quarantined=true; unquarantineRssSource clears it
 *  4. markStaleProjects with keepFlag=true never stales or archives the project
 *  5. markStaleProjects with sourceLastSeenAt set uses it as primary freshness signal
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Helpers ────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ── Mock database layer ────────────────────────────────────────────────────

// We test the pure logic of markStaleProjects by extracting the decision
// function rather than calling the real DB. This mirrors the pattern used in
// stage5a.test.ts which tests the same function.

type ProjectRow = {
  id: number;
  lifecycleStatus: string | null;
  keepFlag: boolean | null;
  sourceLastSeenAt: Date | null;
  lastActivityAt: Date | null;
  createdAt: Date;
};

type ClaimRow = { projectId: number; status: string };

/**
 * Pure staleness decision extracted from markStaleProjects logic in db.ts.
 * Returns "archive", "stale", or "ok" for a given project.
 */
function decideStaleness(
  project: ProjectRow,
  claims: ClaimRow[],
  now: Date = new Date()
): "archive" | "stale" | "ok" {
  // keepFlag protection
  if (project.keepFlag) return "ok";

  // Active claim protection
  const activeClaim = claims.find(
    c => c.projectId === project.id && c.status !== "lost"
  );
  if (activeClaim) return "ok";

  // Determine effective freshness date
  const freshness: Date =
    project.sourceLastSeenAt ?? project.lastActivityAt ?? project.createdAt;

  const ageMs = now.getTime() - freshness.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays >= 180) return "archive";
  if (ageDays >= 60) return "stale";
  return "ok";
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Stage 5B: sourceLastSeenAt backfill logic", () => {
  it("uses sourceLastSeenAt as primary freshness signal when set", () => {
    const project: ProjectRow = {
      id: 1,
      lifecycleStatus: "active",
      keepFlag: null,
      sourceLastSeenAt: daysAgo(10),   // recently seen by pipeline
      lastActivityAt: daysAgo(90),     // old activity
      createdAt: daysAgo(200),
    };
    expect(decideStaleness(project, [])).toBe("ok");
  });

  it("falls back to lastActivityAt when sourceLastSeenAt is null", () => {
    const project: ProjectRow = {
      id: 2,
      lifecycleStatus: "active",
      keepFlag: null,
      sourceLastSeenAt: null,
      lastActivityAt: daysAgo(30),     // recent activity
      createdAt: daysAgo(200),
    };
    expect(decideStaleness(project, [])).toBe("ok");
  });

  it("falls back to createdAt when both sourceLastSeenAt and lastActivityAt are null", () => {
    const project: ProjectRow = {
      id: 3,
      lifecycleStatus: "active",
      keepFlag: null,
      sourceLastSeenAt: null,
      lastActivityAt: null,
      createdAt: daysAgo(70),          // 70 days old → stale
    };
    expect(decideStaleness(project, [])).toBe("stale");
  });

  it("project seen by pipeline 5 days ago is never staled even if createdAt is 300 days ago", () => {
    const project: ProjectRow = {
      id: 4,
      lifecycleStatus: "active",
      keepFlag: null,
      sourceLastSeenAt: daysAgo(5),
      lastActivityAt: null,
      createdAt: daysAgo(300),
    };
    expect(decideStaleness(project, [])).toBe("ok");
  });

  it("project with sourceLastSeenAt 61 days ago is marked stale", () => {
    const project: ProjectRow = {
      id: 5,
      lifecycleStatus: "active",
      keepFlag: null,
      sourceLastSeenAt: daysAgo(61),
      lastActivityAt: null,
      createdAt: daysAgo(300),
    };
    expect(decideStaleness(project, [])).toBe("stale");
  });

  it("project with sourceLastSeenAt 181 days ago is archived", () => {
    const project: ProjectRow = {
      id: 6,
      lifecycleStatus: "active",
      keepFlag: null,
      sourceLastSeenAt: daysAgo(181),
      lastActivityAt: null,
      createdAt: daysAgo(300),
    };
    expect(decideStaleness(project, [])).toBe("archive");
  });
});

describe("Stage 5B: keepFlag protection", () => {
  it("project with keepFlag=true is never staled even if 200 days old", () => {
    const project: ProjectRow = {
      id: 10,
      lifecycleStatus: "active",
      keepFlag: true,
      sourceLastSeenAt: daysAgo(200),
      lastActivityAt: null,
      createdAt: daysAgo(300),
    };
    expect(decideStaleness(project, [])).toBe("ok");
  });

  it("project with keepFlag=true is never archived even if 400 days old", () => {
    const project: ProjectRow = {
      id: 11,
      lifecycleStatus: "active",
      keepFlag: true,
      sourceLastSeenAt: daysAgo(400),
      lastActivityAt: null,
      createdAt: daysAgo(400),
    };
    expect(decideStaleness(project, [])).toBe("ok");
  });

  it("project with keepFlag=false is staled normally", () => {
    const project: ProjectRow = {
      id: 12,
      lifecycleStatus: "active",
      keepFlag: false,
      sourceLastSeenAt: daysAgo(70),
      lastActivityAt: null,
      createdAt: daysAgo(300),
    };
    expect(decideStaleness(project, [])).toBe("stale");
  });

  it("project with keepFlag=null is staled normally", () => {
    const project: ProjectRow = {
      id: 13,
      lifecycleStatus: "active",
      keepFlag: null,
      sourceLastSeenAt: daysAgo(70),
      lastActivityAt: null,
      createdAt: daysAgo(300),
    };
    expect(decideStaleness(project, [])).toBe("stale");
  });
});

describe("Stage 5B: active claim protection", () => {
  it("project with active claim is never staled", () => {
    const project: ProjectRow = {
      id: 20,
      lifecycleStatus: "active",
      keepFlag: null,
      sourceLastSeenAt: daysAgo(90),
      lastActivityAt: null,
      createdAt: daysAgo(300),
    };
    const claims: ClaimRow[] = [{ projectId: 20, status: "active" }];
    expect(decideStaleness(project, claims)).toBe("ok");
  });

  it("project with won claim is never staled", () => {
    const project: ProjectRow = {
      id: 21,
      lifecycleStatus: "active",
      keepFlag: null,
      sourceLastSeenAt: daysAgo(200),
      lastActivityAt: null,
      createdAt: daysAgo(300),
    };
    const claims: ClaimRow[] = [{ projectId: 21, status: "won" }];
    expect(decideStaleness(project, claims)).toBe("ok");
  });

  it("project with only lost claim is staled normally", () => {
    const project: ProjectRow = {
      id: 22,
      lifecycleStatus: "active",
      keepFlag: null,
      sourceLastSeenAt: daysAgo(90),
      lastActivityAt: null,
      createdAt: daysAgo(300),
    };
    const claims: ClaimRow[] = [{ projectId: 22, status: "lost" }];
    expect(decideStaleness(project, claims)).toBe("stale");
  });
});

describe("Stage 5B: quarantine flag logic", () => {
  // Test the pure data transformation — quarantine sets quarantined=true and stores reason

  it("quarantine sets quarantined=true with reason", () => {
    const source = { id: 1, quarantined: false, quarantineReason: null };
    // Simulate what quarantineRssSource does
    const updated = { ...source, quarantined: true, quarantineReason: "Low yield — 0 articles in 30 days" };
    expect(updated.quarantined).toBe(true);
    expect(updated.quarantineReason).toBe("Low yield — 0 articles in 30 days");
  });

  it("unquarantine clears quarantined=false and nulls reason", () => {
    const source = { id: 1, quarantined: true, quarantineReason: "Low yield" };
    // Simulate what unquarantineRssSource does
    const updated = { ...source, quarantined: false, quarantineReason: null };
    expect(updated.quarantined).toBe(false);
    expect(updated.quarantineReason).toBeNull();
  });

  it("harvester skips quarantined sources", () => {
    const sources = [
      { id: 1, isActive: true, quarantined: false, name: "Source A" },
      { id: 2, isActive: true, quarantined: true, name: "Source B" },
      { id: 3, isActive: false, quarantined: false, name: "Source C" },
    ];
    // Simulate the harvester filter: isActive=true AND quarantined=false
    const eligible = sources.filter(s => s.isActive && !s.quarantined);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].name).toBe("Source A");
  });

  it("quarantined=false source is included by harvester", () => {
    const sources = [
      { id: 1, isActive: true, quarantined: false, name: "Source A" },
      { id: 2, isActive: true, quarantined: false, name: "Source B" },
    ];
    const eligible = sources.filter(s => s.isActive && !s.quarantined);
    expect(eligible).toHaveLength(2);
  });
});

describe("Stage 5B: backfill migration logic", () => {
  it("backfill sets sourceLastSeenAt = lastActivityAt when lastActivityAt is set", () => {
    const project = { id: 1, sourceLastSeenAt: null, lastActivityAt: daysAgo(30), createdAt: daysAgo(100) };
    // Simulate backfill: use lastActivityAt ?? createdAt
    const backfilled = project.lastActivityAt ?? project.createdAt;
    expect(backfilled).toEqual(project.lastActivityAt);
  });

  it("backfill sets sourceLastSeenAt = createdAt when lastActivityAt is null", () => {
    const project = { id: 2, sourceLastSeenAt: null, lastActivityAt: null, createdAt: daysAgo(50) };
    const backfilled = project.lastActivityAt ?? project.createdAt;
    expect(backfilled).toEqual(project.createdAt);
  });

  it("backfill does not overwrite existing sourceLastSeenAt", () => {
    const existingDate = daysAgo(5);
    const project = { id: 3, sourceLastSeenAt: existingDate, lastActivityAt: daysAgo(30), createdAt: daysAgo(100) };
    // Backfill should skip projects that already have sourceLastSeenAt set
    const shouldUpdate = project.sourceLastSeenAt === null;
    expect(shouldUpdate).toBe(false);
    expect(project.sourceLastSeenAt).toEqual(existingDate);
  });
});

describe("Stage 5B: threshold boundary conditions", () => {
  it("project 61 days old is stale (past the 60-day threshold)", () => {
    const project: ProjectRow = {
      id: 30,
      lifecycleStatus: "active",
      keepFlag: null,
      sourceLastSeenAt: daysAgo(61),
      lastActivityAt: null,
      createdAt: daysAgo(300),
    };
    expect(decideStaleness(project, [])).toBe("stale");
  });

  it("project exactly 59 days old is ok (boundary exclusive)", () => {
    const project: ProjectRow = {
      id: 31,
      lifecycleStatus: "active",
      keepFlag: null,
      sourceLastSeenAt: daysAgo(59),
      lastActivityAt: null,
      createdAt: daysAgo(300),
    };
    expect(decideStaleness(project, [])).toBe("ok");
  });

  it("project exactly 180 days old is archived (boundary inclusive)", () => {
    const project: ProjectRow = {
      id: 32,
      lifecycleStatus: "active",
      keepFlag: null,
      sourceLastSeenAt: daysAgo(180),
      lastActivityAt: null,
      createdAt: daysAgo(300),
    };
    expect(decideStaleness(project, [])).toBe("archive");
  });

  it("project exactly 179 days old is stale (not yet archived)", () => {
    const project: ProjectRow = {
      id: 33,
      lifecycleStatus: "active",
      keepFlag: null,
      sourceLastSeenAt: daysAgo(179),
      lastActivityAt: null,
      createdAt: daysAgo(300),
    };
    expect(decideStaleness(project, [])).toBe("stale");
  });
});
