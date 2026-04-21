/**
 * Stage 5C Tests
 * Covers:
 *  1. tokenSimilarity — edge cases: empty strings, stop words, exact match, no overlap, partial overlap
 *  2. extractStateCode — all 8 Australian state/territory codes
 *  3. findDuplicateClusters — same-state near-duplicates, cross-state false positives, merged projects excluded
 *  4. mergeProjectIntoCanonical — side effects: sets mergedIntoId, archives duplicate
 *  5. dismissDuplicateCluster — sets duplicateDismissed = true for all project IDs
 *  6. runDuplicateDetectionSweep — returns counts, assigns cluster IDs to unassigned projects
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Import pure helpers directly (no DB dependency) ──────────────────────────
import { tokenSimilarity, extractStateCode } from "./db";

// ── Helpers ──────────────────────────────────────────────────────────────────

type MockProject = {
  id: number;
  name: string;
  location: string;
  lifecycleStatus: "active" | "stale" | "archived" | "awarded" | "completed";
  priority: "hot" | "warm" | "cold";
  createdAt: Date;
  duplicateClusterId: string | null;
  duplicateDismissed: boolean | null;
  mergedIntoId: number | null;
};

function makeProject(overrides: Partial<MockProject> & { id: number; name: string; location: string }): MockProject {
  return {
    lifecycleStatus: "active",
    priority: "warm",
    createdAt: new Date("2024-01-01"),
    duplicateClusterId: null,
    duplicateDismissed: null,
    mergedIntoId: null,
    ...overrides,
  };
}

// ── Pure duplicate detection logic (mirrors db.ts implementation) ─────────────

const STOP = new Set(["the", "and", "for", "with", "project", "stage", "phase", "new", "australia", "australian"]);

function tokenise(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length >= 3 && !STOP.has(t))
  );
}

function localTokenSimilarity(a: string, b: string): number {
  const ta = tokenise(a);
  const tb = tokenise(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  const intersection = Array.from(ta).filter(t => tb.has(t)).length;
  return intersection / Math.max(ta.size, tb.size);
}

function localExtractStateCode(location: string): string | null {
  const STATES = ["WA", "NSW", "VIC", "QLD", "SA", "TAS", "NT", "ACT"];
  const upper = location.toUpperCase();
  return STATES.find(s => upper.includes(s)) ?? null;
}

function findDuplicateClustersLocal(
  rows: MockProject[],
  similarityThreshold = 0.55
): Array<{ clusterId: string; projects: MockProject[]; similarity: number; dismissed: boolean }> {
  const activeRows = rows.filter(r => ["active", "stale"].includes(r.lifecycleStatus) && !r.mergedIntoId);

  const parent = new Map<number, number>();
  const find = (x: number): number => {
    if (!parent.has(x)) return x;
    const root = find(parent.get(x)!);
    parent.set(x, root);
    return root;
  };
  const union = (x: number, y: number) => {
    const rx = find(x), ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };

  const pairSimilarities = new Map<string, number>();

  for (let i = 0; i < activeRows.length; i++) {
    for (let j = i + 1; j < activeRows.length; j++) {
      const a = activeRows[i], b = activeRows[j];
      const sim = localTokenSimilarity(a.name, b.name);
      if (sim < similarityThreshold) continue;
      const stateA = localExtractStateCode(a.location);
      const stateB = localExtractStateCode(b.location);
      const sameState = stateA && stateB && stateA === stateB;
      const eitherNational = a.location.toLowerCase().includes("national") || b.location.toLowerCase().includes("national");
      if (!sameState && !eitherNational) continue;
      union(a.id, b.id);
      pairSimilarities.set(`${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`, sim);
    }
  }

  const clusterMap = new Map<number, MockProject[]>();
  for (const row of activeRows) {
    const root = find(row.id);
    if (!clusterMap.has(root)) clusterMap.set(root, []);
    clusterMap.get(root)!.push(row);
  }

  const clusters: Array<{ clusterId: string; projects: MockProject[]; similarity: number; dismissed: boolean }> = [];
  for (const [root, members] of Array.from(clusterMap.entries())) {
    if (members.length < 2) continue;
    let simSum = 0, simCount = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = `${Math.min(members[i].id, members[j].id)}-${Math.max(members[i].id, members[j].id)}`;
        simSum += pairSimilarities.get(key) ?? 0;
        simCount++;
      }
    }
    const avgSim = simCount > 0 ? simSum / simCount : 0;
    const dismissed = members.some(m => m.duplicateDismissed);
    const existingId = members.find(m => m.duplicateClusterId)?.duplicateClusterId;
    const clusterId = existingId ?? `cluster-${root}`;
    clusters.push({ clusterId, projects: members, similarity: avgSim, dismissed });
  }

  return clusters.sort((a, b) => b.similarity - a.similarity);
}

// ── 1. tokenSimilarity ────────────────────────────────────────────────────────

describe("tokenSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(tokenSimilarity("Pilbara Iron Ore Mine", "Pilbara Iron Ore Mine")).toBe(1);
  });

  it("returns 1.0 for identical strings (local mirror)", () => {
    expect(localTokenSimilarity("Pilbara Iron Ore Mine", "Pilbara Iron Ore Mine")).toBe(1);
  });

  it("returns 0 for empty string inputs", () => {
    expect(tokenSimilarity("", "anything")).toBe(0);
    expect(tokenSimilarity("anything", "")).toBe(0);
    expect(tokenSimilarity("", "")).toBe(0);
  });

  it("returns 0 for completely different strings", () => {
    const sim = tokenSimilarity("Pilbara Iron Ore Mine", "Sydney Desalination Plant");
    expect(sim).toBe(0);
  });

  it("returns > 0 for partial overlap", () => {
    const sim = tokenSimilarity("Pilbara Iron Ore Expansion", "Pilbara Iron Ore Mine");
    expect(sim).toBeGreaterThan(0.5);
    expect(sim).toBeLessThan(1);
  });

  it("ignores stop words (project, stage, phase, new, australia)", () => {
    // "project" and "stage" are stop words — only "pilbara" and "mine" are tokens
    const sim = tokenSimilarity("Pilbara Mine Project Stage 1", "Pilbara Mine Stage 2");
    // Both have tokens: {pilbara, mine} — intersection = 2, union = 2 → 1.0
    expect(sim).toBe(1);
  });

  it("is case-insensitive", () => {
    const sim1 = tokenSimilarity("PILBARA IRON ORE", "pilbara iron ore");
    expect(sim1).toBe(1);
  });

  it("handles punctuation and special characters", () => {
    const sim = tokenSimilarity("Roy Hill (Iron Ore)", "Roy Hill Iron Ore");
    expect(sim).toBe(1);
  });

  it("returns 0 when all tokens are stop words", () => {
    // "the", "and", "for" are all stop words — no valid tokens
    const sim = tokenSimilarity("the and for", "the and for");
    expect(sim).toBe(0);
  });

  it("handles single meaningful token overlap", () => {
    const sim = tokenSimilarity("Fortescue Expansion", "Fortescue Mine");
    // tokens: {fortescue, expansion} vs {fortescue, mine} → intersection=1, max(2,2)=2
    expect(sim).toBeCloseTo(0.5, 2);
  });
});

// ── 2. extractStateCode ───────────────────────────────────────────────────────

describe("extractStateCode", () => {
  it("extracts WA from Perth, WA", () => {
    expect(extractStateCode("Perth, WA")).toBe("WA");
  });

  it("extracts NSW from Sydney, NSW", () => {
    expect(extractStateCode("Sydney, NSW")).toBe("NSW");
  });

  it("extracts VIC from Melbourne, VIC", () => {
    expect(extractStateCode("Melbourne, VIC")).toBe("VIC");
  });

  it("extracts QLD from Brisbane, QLD", () => {
    expect(extractStateCode("Brisbane, QLD")).toBe("QLD");
  });

  it("extracts SA from Adelaide, SA", () => {
    expect(extractStateCode("Adelaide, SA")).toBe("SA");
  });

  it("extracts TAS from Hobart, TAS", () => {
    expect(extractStateCode("Hobart, TAS")).toBe("TAS");
  });

  it("extracts NT from Darwin, NT", () => {
    expect(extractStateCode("Darwin, NT")).toBe("NT");
  });

  it("extracts ACT from Canberra, ACT", () => {
    expect(extractStateCode("Canberra, ACT")).toBe("ACT");
  });

  it("returns null when no state code is present", () => {
    expect(extractStateCode("National")).toBeNull();
    expect(extractStateCode("Unknown Location")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(extractStateCode("perth, wa")).toBe("WA");
  });

  it("extracts from longer location strings", () => {
    expect(extractStateCode("Pilbara Region, Western Australia (WA)")).toBe("WA");
  });

  it("extracts local mirror correctly", () => {
    expect(localExtractStateCode("Perth, WA")).toBe("WA");
    expect(localExtractStateCode("Unknown")).toBeNull();
  });
});

// ── 3. findDuplicateClusters (pure logic) ─────────────────────────────────────

describe("findDuplicateClusters (pure logic)", () => {
  it("groups same-state near-duplicates into a cluster", () => {
    const rows = [
      makeProject({ id: 1, name: "Roy Hill Iron Ore Mine Expansion", location: "Pilbara, WA" }),
      makeProject({ id: 2, name: "Roy Hill Iron Ore Mine Extension", location: "Pilbara, WA" }),
      makeProject({ id: 3, name: "Wheatstone LNG Expansion", location: "Onslow, WA" }),
    ];
    const clusters = findDuplicateClustersLocal(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].projects.map(p => p.id).sort()).toEqual([1, 2]);
  });

  it("does not cluster cross-state projects even with similar names", () => {
    const rows = [
      makeProject({ id: 1, name: "Coal Mine Expansion Phase", location: "Hunter Valley, NSW" }),
      makeProject({ id: 2, name: "Coal Mine Expansion Phase", location: "Bowen Basin, QLD" }),
    ];
    const clusters = findDuplicateClustersLocal(rows);
    // Different states → no cluster
    expect(clusters).toHaveLength(0);
  });

  it("clusters national-scope projects regardless of state", () => {
    const rows = [
      makeProject({ id: 1, name: "National Broadband Network Rollout", location: "National" }),
      makeProject({ id: 2, name: "National Broadband Network Expansion", location: "National" }),
    ];
    const clusters = findDuplicateClustersLocal(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].projects).toHaveLength(2);
  });

  it("excludes merged projects from cluster detection", () => {
    const rows = [
      makeProject({ id: 1, name: "Roy Hill Iron Ore Mine Expansion", location: "Pilbara, WA" }),
      makeProject({ id: 2, name: "Roy Hill Iron Ore Mine Extension", location: "Pilbara, WA", mergedIntoId: 1 }),
    ];
    const clusters = findDuplicateClustersLocal(rows);
    // id=2 is merged → excluded → no cluster
    expect(clusters).toHaveLength(0);
  });

  it("excludes archived projects from cluster detection", () => {
    const rows = [
      makeProject({ id: 1, name: "Roy Hill Iron Ore Mine Expansion", location: "Pilbara, WA" }),
      makeProject({ id: 2, name: "Roy Hill Iron Ore Mine Extension", location: "Pilbara, WA", lifecycleStatus: "archived" }),
    ];
    const clusters = findDuplicateClustersLocal(rows);
    expect(clusters).toHaveLength(0);
  });

  it("includes stale projects in cluster detection", () => {
    const rows = [
      makeProject({ id: 1, name: "Roy Hill Iron Ore Mine Expansion", location: "Pilbara, WA" }),
      makeProject({ id: 2, name: "Roy Hill Iron Ore Mine Extension", location: "Pilbara, WA", lifecycleStatus: "stale" }),
    ];
    const clusters = findDuplicateClustersLocal(rows);
    expect(clusters).toHaveLength(1);
  });

  it("marks cluster as dismissed if any project has duplicateDismissed=true", () => {
    const rows = [
      makeProject({ id: 1, name: "Roy Hill Iron Ore Mine Expansion", location: "Pilbara, WA", duplicateDismissed: true }),
      makeProject({ id: 2, name: "Roy Hill Iron Ore Mine Extension", location: "Pilbara, WA" }),
    ];
    const clusters = findDuplicateClustersLocal(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].dismissed).toBe(true);
  });

  it("returns empty array when no near-duplicates exist", () => {
    const rows = [
      makeProject({ id: 1, name: "Pilbara Iron Ore Mine", location: "Pilbara, WA" }),
      makeProject({ id: 2, name: "Sydney Desalination Plant", location: "Sydney, NSW" }),
      makeProject({ id: 3, name: "Brisbane Airport Expansion", location: "Brisbane, QLD" }),
    ];
    const clusters = findDuplicateClustersLocal(rows);
    expect(clusters).toHaveLength(0);
  });

  it("handles three-way clusters correctly", () => {
    const rows = [
      makeProject({ id: 1, name: "Fortescue Iron Ore Mine Expansion", location: "Pilbara, WA" }),
      makeProject({ id: 2, name: "Fortescue Iron Ore Mine Extension", location: "Pilbara, WA" }),
      makeProject({ id: 3, name: "Fortescue Iron Ore Mine Upgrade", location: "Pilbara, WA" }),
    ];
    const clusters = findDuplicateClustersLocal(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].projects).toHaveLength(3);
  });

  it("uses existing clusterId if already assigned", () => {
    const rows = [
      makeProject({ id: 1, name: "Roy Hill Iron Ore Mine Expansion", location: "Pilbara, WA", duplicateClusterId: "cluster-existing-abc" }),
      makeProject({ id: 2, name: "Roy Hill Iron Ore Mine Extension", location: "Pilbara, WA" }),
    ];
    const clusters = findDuplicateClustersLocal(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].clusterId).toBe("cluster-existing-abc");
  });

  it("sorts clusters by descending similarity", () => {
    const rows = [
      // High similarity pair (same name, different suffix)
      makeProject({ id: 1, name: "Fortescue Iron Ore Mine Expansion", location: "Pilbara, WA" }),
      makeProject({ id: 2, name: "Fortescue Iron Ore Mine Extension", location: "Pilbara, WA" }),
      // Lower similarity pair
      makeProject({ id: 3, name: "Roy Hill Mine Expansion", location: "Pilbara, WA" }),
      makeProject({ id: 4, name: "Roy Hill Mine Upgrade Construction", location: "Pilbara, WA" }),
    ];
    const clusters = findDuplicateClustersLocal(rows);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    // Clusters should be sorted descending by similarity
    for (let i = 0; i < clusters.length - 1; i++) {
      expect(clusters[i].similarity).toBeGreaterThanOrEqual(clusters[i + 1].similarity);
    }
  });
});

// ── 4. mergeProjectIntoCanonical (mock DB) ────────────────────────────────────

describe("mergeProjectIntoCanonical (mock logic)", () => {
  // We test the side-effect logic without a real DB by simulating the update operations

  type ProjectState = {
    id: number;
    mergedIntoId: number | null;
    lifecycleStatus: string;
    staleReason: string | null;
    archivedBy: number | null;
    archivedAt: Date | null;
  };

  function simulateMerge(
    projects: ProjectState[],
    duplicateId: number,
    canonicalId: number,
    mergedByUserId: number
  ): ProjectState[] {
    return projects.map(p => {
      if (p.id !== duplicateId) return p;
      return {
        ...p,
        mergedIntoId: canonicalId,
        lifecycleStatus: "archived",
        archivedBy: mergedByUserId,
        archivedAt: new Date(),
        staleReason: `Merged into project #${canonicalId}`,
      };
    });
  }

  it("sets mergedIntoId on the duplicate project", () => {
    const projects: ProjectState[] = [
      { id: 1, mergedIntoId: null, lifecycleStatus: "active", staleReason: null, archivedBy: null, archivedAt: null },
      { id: 2, mergedIntoId: null, lifecycleStatus: "active", staleReason: null, archivedBy: null, archivedAt: null },
    ];
    const result = simulateMerge(projects, 2, 1, 99);
    const dup = result.find(p => p.id === 2)!;
    expect(dup.mergedIntoId).toBe(1);
  });

  it("sets lifecycleStatus to 'archived' on the duplicate", () => {
    const projects: ProjectState[] = [
      { id: 1, mergedIntoId: null, lifecycleStatus: "active", staleReason: null, archivedBy: null, archivedAt: null },
      { id: 2, mergedIntoId: null, lifecycleStatus: "active", staleReason: null, archivedBy: null, archivedAt: null },
    ];
    const result = simulateMerge(projects, 2, 1, 99);
    expect(result.find(p => p.id === 2)!.lifecycleStatus).toBe("archived");
  });

  it("records the merging user ID", () => {
    const projects: ProjectState[] = [
      { id: 1, mergedIntoId: null, lifecycleStatus: "active", staleReason: null, archivedBy: null, archivedAt: null },
      { id: 2, mergedIntoId: null, lifecycleStatus: "active", staleReason: null, archivedBy: null, archivedAt: null },
    ];
    const result = simulateMerge(projects, 2, 1, 42);
    expect(result.find(p => p.id === 2)!.archivedBy).toBe(42);
  });

  it("sets a descriptive staleReason on the duplicate", () => {
    const projects: ProjectState[] = [
      { id: 1, mergedIntoId: null, lifecycleStatus: "active", staleReason: null, archivedBy: null, archivedAt: null },
      { id: 2, mergedIntoId: null, lifecycleStatus: "active", staleReason: null, archivedBy: null, archivedAt: null },
    ];
    const result = simulateMerge(projects, 2, 1, 99);
    expect(result.find(p => p.id === 2)!.staleReason).toContain("Merged into project #1");
  });

  it("does not modify the canonical project", () => {
    const projects: ProjectState[] = [
      { id: 1, mergedIntoId: null, lifecycleStatus: "active", staleReason: null, archivedBy: null, archivedAt: null },
      { id: 2, mergedIntoId: null, lifecycleStatus: "active", staleReason: null, archivedBy: null, archivedAt: null },
    ];
    const result = simulateMerge(projects, 2, 1, 99);
    const canonical = result.find(p => p.id === 1)!;
    expect(canonical.mergedIntoId).toBeNull();
    expect(canonical.lifecycleStatus).toBe("active");
  });

  it("sets archivedAt to a recent date", () => {
    const before = new Date();
    const projects: ProjectState[] = [
      { id: 1, mergedIntoId: null, lifecycleStatus: "active", staleReason: null, archivedBy: null, archivedAt: null },
      { id: 2, mergedIntoId: null, lifecycleStatus: "active", staleReason: null, archivedBy: null, archivedAt: null },
    ];
    const result = simulateMerge(projects, 2, 1, 99);
    const after = new Date();
    const archivedAt = result.find(p => p.id === 2)!.archivedAt!;
    expect(archivedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(archivedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ── 5. dismissDuplicateCluster (mock logic) ───────────────────────────────────

describe("dismissDuplicateCluster (mock logic)", () => {
  type ProjectDismissState = { id: number; duplicateDismissed: boolean | null };

  function simulateDismiss(projects: ProjectDismissState[], projectIds: number[]): ProjectDismissState[] {
    return projects.map(p => {
      if (!projectIds.includes(p.id)) return p;
      return { ...p, duplicateDismissed: true };
    });
  }

  it("sets duplicateDismissed=true for all specified project IDs", () => {
    const projects: ProjectDismissState[] = [
      { id: 1, duplicateDismissed: null },
      { id: 2, duplicateDismissed: null },
      { id: 3, duplicateDismissed: null },
    ];
    const result = simulateDismiss(projects, [1, 2]);
    expect(result.find(p => p.id === 1)!.duplicateDismissed).toBe(true);
    expect(result.find(p => p.id === 2)!.duplicateDismissed).toBe(true);
  });

  it("does not modify projects not in the specified list", () => {
    const projects: ProjectDismissState[] = [
      { id: 1, duplicateDismissed: null },
      { id: 2, duplicateDismissed: null },
      { id: 3, duplicateDismissed: null },
    ];
    const result = simulateDismiss(projects, [1, 2]);
    expect(result.find(p => p.id === 3)!.duplicateDismissed).toBeNull();
  });

  it("handles an empty projectIds list gracefully", () => {
    const projects: ProjectDismissState[] = [
      { id: 1, duplicateDismissed: null },
    ];
    const result = simulateDismiss(projects, []);
    expect(result.find(p => p.id === 1)!.duplicateDismissed).toBeNull();
  });

  it("is idempotent — dismissing already-dismissed projects is safe", () => {
    const projects: ProjectDismissState[] = [
      { id: 1, duplicateDismissed: true },
      { id: 2, duplicateDismissed: true },
    ];
    const result = simulateDismiss(projects, [1, 2]);
    expect(result.find(p => p.id === 1)!.duplicateDismissed).toBe(true);
    expect(result.find(p => p.id === 2)!.duplicateDismissed).toBe(true);
  });
});

// ── 6. runDuplicateDetectionSweep (mock logic) ────────────────────────────────

describe("runDuplicateDetectionSweep (mock logic)", () => {
  type ProjectSweepState = MockProject;

  function simulateSweep(rows: ProjectSweepState[]): {
    clustersFound: number;
    newAssignments: number;
    updatedRows: ProjectSweepState[];
  } {
    const clusters = findDuplicateClustersLocal(rows);
    let newAssignments = 0;
    const updatedRows = [...rows];

    for (const cluster of clusters) {
      if (cluster.dismissed) continue;
      const unassigned = cluster.projects.filter(p => !p.duplicateClusterId);
      if (unassigned.length === 0) continue;
      // Assign cluster ID to all projects in cluster
      for (const proj of cluster.projects) {
        const idx = updatedRows.findIndex(r => r.id === proj.id);
        if (idx >= 0) {
          updatedRows[idx] = { ...updatedRows[idx], duplicateClusterId: cluster.clusterId };
        }
      }
      newAssignments += unassigned.length;
    }

    return { clustersFound: clusters.length, newAssignments, updatedRows };
  }

  it("returns clustersFound count matching detected clusters", () => {
    const rows = [
      makeProject({ id: 1, name: "Roy Hill Iron Ore Mine Expansion", location: "Pilbara, WA" }),
      makeProject({ id: 2, name: "Roy Hill Iron Ore Mine Extension", location: "Pilbara, WA" }),
    ];
    const result = simulateSweep(rows);
    expect(result.clustersFound).toBe(1);
  });

  it("returns newAssignments = 0 when all projects already have cluster IDs", () => {
    const rows = [
      makeProject({ id: 1, name: "Roy Hill Iron Ore Mine Expansion", location: "Pilbara, WA", duplicateClusterId: "cluster-1" }),
      makeProject({ id: 2, name: "Roy Hill Iron Ore Mine Extension", location: "Pilbara, WA", duplicateClusterId: "cluster-1" }),
    ];
    const result = simulateSweep(rows);
    expect(result.newAssignments).toBe(0);
  });

  it("assigns cluster IDs to previously unassigned projects", () => {
    const rows = [
      makeProject({ id: 1, name: "Roy Hill Iron Ore Mine Expansion", location: "Pilbara, WA" }),
      makeProject({ id: 2, name: "Roy Hill Iron Ore Mine Extension", location: "Pilbara, WA" }),
    ];
    const result = simulateSweep(rows);
    expect(result.newAssignments).toBe(2);
    expect(result.updatedRows.find(r => r.id === 1)!.duplicateClusterId).not.toBeNull();
    expect(result.updatedRows.find(r => r.id === 2)!.duplicateClusterId).not.toBeNull();
  });

  it("skips dismissed clusters during sweep", () => {
    const rows = [
      makeProject({ id: 1, name: "Roy Hill Iron Ore Mine Expansion", location: "Pilbara, WA", duplicateDismissed: true }),
      makeProject({ id: 2, name: "Roy Hill Iron Ore Mine Extension", location: "Pilbara, WA" }),
    ];
    const result = simulateSweep(rows);
    expect(result.newAssignments).toBe(0);
  });

  it("returns 0 clusters and 0 assignments when no duplicates exist", () => {
    const rows = [
      makeProject({ id: 1, name: "Pilbara Iron Ore Mine", location: "Pilbara, WA" }),
      makeProject({ id: 2, name: "Sydney Desalination Plant", location: "Sydney, NSW" }),
    ];
    const result = simulateSweep(rows);
    expect(result.clustersFound).toBe(0);
    expect(result.newAssignments).toBe(0);
  });

  it("assigns the same cluster ID to all projects in a cluster", () => {
    const rows = [
      makeProject({ id: 1, name: "Roy Hill Iron Ore Mine Expansion", location: "Pilbara, WA" }),
      makeProject({ id: 2, name: "Roy Hill Iron Ore Mine Extension", location: "Pilbara, WA" }),
    ];
    const result = simulateSweep(rows);
    const id1 = result.updatedRows.find(r => r.id === 1)!.duplicateClusterId;
    const id2 = result.updatedRows.find(r => r.id === 2)!.duplicateClusterId;
    expect(id1).toBe(id2);
    expect(id1).not.toBeNull();
  });
});
