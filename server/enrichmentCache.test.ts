import { describe, it, expect } from "vitest";

/**
 * Tests for enrichment caching and profile-aware enrichment logic.
 * These test the pure functions and logic without requiring database access.
 */

// ── getUserPreferredRoles logic ──────────────────────────────────────────────

describe("getUserPreferredRoles", () => {
  // Simulate the logic from contactEnrichment.ts
  function getUserPreferredRoles(
    buyerRoles: string[] | null | undefined,
    sector: string
  ): string[] {
    if (buyerRoles && buyerRoles.length > 0) {
      return buyerRoles;
    }
    // Fallback to sector-based defaults (matching getTargetRoles logic)
    const sectorRoles: Record<string, string[]> = {
      mining: ["Mining Manager", "Project Manager", "Maintenance Manager", "Site Manager", "Procurement Manager"],
      oil_gas: ["Project Manager", "Operations Manager", "Procurement Manager", "Engineering Manager"],
      infrastructure: ["Project Director", "Construction Manager", "Procurement Manager", "Site Manager"],
      energy: ["Project Manager", "Operations Manager", "Engineering Manager", "Procurement Manager"],
      defence: ["Project Manager", "Procurement Manager", "Engineering Manager", "Logistics Manager"],
    };
    return sectorRoles[sector] || ["Project Manager", "Procurement Manager", "Operations Manager"];
  }

  it("returns user preferred roles when available", () => {
    const roles = getUserPreferredRoles(
      ["Fleet Manager", "Rental Manager", "Equipment Coordinator"],
      "mining"
    );
    expect(roles).toEqual(["Fleet Manager", "Rental Manager", "Equipment Coordinator"]);
  });

  it("falls back to sector defaults when no user roles", () => {
    const roles = getUserPreferredRoles(null, "mining");
    expect(roles).toContain("Mining Manager");
    expect(roles).toContain("Procurement Manager");
  });

  it("falls back to sector defaults when empty array", () => {
    const roles = getUserPreferredRoles([], "oil_gas");
    expect(roles).toContain("Operations Manager");
    expect(roles).toContain("Procurement Manager");
  });

  it("uses generic defaults for unknown sector", () => {
    const roles = getUserPreferredRoles(null, "unknown_sector");
    expect(roles).toContain("Project Manager");
    expect(roles).toContain("Procurement Manager");
    expect(roles).toContain("Operations Manager");
  });

  it("returns all five mining roles when no user preference", () => {
    const roles = getUserPreferredRoles(null, "mining");
    expect(roles).toHaveLength(5);
  });

  it("preserves exact user role strings", () => {
    const roles = getUserPreferredRoles(
      ["VP of Engineering", "Chief Procurement Officer"],
      "energy"
    );
    expect(roles[0]).toBe("VP of Engineering");
    expect(roles[1]).toBe("Chief Procurement Officer");
  });
});

// ── Cache freshness logic ────────────────────────────────────────────────────

describe("Cache freshness check", () => {
  const CACHE_TTL_DAYS = 7;

  function isCacheFresh(enrichedAt: Date): boolean {
    const now = new Date();
    const diffMs = now.getTime() - enrichedAt.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays < CACHE_TTL_DAYS;
  }

  it("considers cache from 1 hour ago as fresh", () => {
    const oneHourAgo = new Date(Date.now() - 1000 * 60 * 60);
    expect(isCacheFresh(oneHourAgo)).toBe(true);
  });

  it("considers cache from 3 days ago as fresh", () => {
    const threeDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 3);
    expect(isCacheFresh(threeDaysAgo)).toBe(true);
  });

  it("considers cache from 6 days ago as fresh", () => {
    const sixDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 6);
    expect(isCacheFresh(sixDaysAgo)).toBe(true);
  });

  it("considers cache from 8 days ago as stale", () => {
    const eightDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 8);
    expect(isCacheFresh(eightDaysAgo)).toBe(false);
  });

  it("considers cache from 30 days ago as stale", () => {
    const thirtyDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);
    expect(isCacheFresh(thirtyDaysAgo)).toBe(false);
  });
});

// ── API calls saved calculation ──────────────────────────────────────────────

describe("API calls saved calculation", () => {
  function calculateApiCallsSaved(
    rolesSearched: string[],
    companiesCount: number
  ): number {
    // Each role × each company = 1 LinkedIn API call
    return rolesSearched.length * companiesCount;
  }

  it("calculates correctly for 5 roles × 2 companies", () => {
    const saved = calculateApiCallsSaved(
      ["Mining Manager", "Project Manager", "Maintenance Manager", "Site Manager", "Procurement Manager"],
      2
    );
    expect(saved).toBe(10);
  });

  it("calculates correctly for 3 roles × 1 company", () => {
    const saved = calculateApiCallsSaved(
      ["Fleet Manager", "Rental Manager", "Equipment Coordinator"],
      1
    );
    expect(saved).toBe(3);
  });

  it("returns 0 for empty roles", () => {
    const saved = calculateApiCallsSaved([], 3);
    expect(saved).toBe(0);
  });

  it("returns 0 for 0 companies", () => {
    const saved = calculateApiCallsSaved(["Project Manager"], 0);
    expect(saved).toBe(0);
  });
});

// ── forceRefresh behavior ────────────────────────────────────────────────────

describe("forceRefresh behavior", () => {
  function shouldUseCache(
    isCached: boolean,
    isFresh: boolean,
    forceRefresh: boolean
  ): boolean {
    if (forceRefresh) return false;
    return isCached && isFresh;
  }

  it("uses cache when cached, fresh, and no force refresh", () => {
    expect(shouldUseCache(true, true, false)).toBe(true);
  });

  it("skips cache when force refresh is true", () => {
    expect(shouldUseCache(true, true, true)).toBe(false);
  });

  it("skips cache when not cached", () => {
    expect(shouldUseCache(false, true, false)).toBe(false);
  });

  it("skips cache when stale", () => {
    expect(shouldUseCache(true, false, false)).toBe(false);
  });

  it("skips cache when stale even without force refresh", () => {
    expect(shouldUseCache(true, false, false)).toBe(false);
  });
});

// ── Enrichment cap tracking ──────────────────────────────────────────────────

describe("Enrichment daily cap", () => {
  const DAILY_CAP = 100;

  function isUnderCap(todayCount: number): boolean {
    return todayCount < DAILY_CAP;
  }

  it("allows enrichment when under cap", () => {
    expect(isUnderCap(50)).toBe(true);
  });

  it("allows enrichment at 99", () => {
    expect(isUnderCap(99)).toBe(true);
  });

  it("blocks enrichment at cap", () => {
    expect(isUnderCap(100)).toBe(false);
  });

  it("blocks enrichment over cap", () => {
    expect(isUnderCap(150)).toBe(false);
  });

  it("allows enrichment at 0", () => {
    expect(isUnderCap(0)).toBe(true);
  });
});

// ── Cache entry data structure ───────────────────────────────────────────────

describe("Cache entry structure", () => {
  interface CacheEntry {
    projectId: number;
    enrichedAt: Date;
    contactsFound: number;
    rolesSearched: string[];
    apiCallsMade: number;
    enrichedByUserId: string | null;
  }

  it("creates valid cache entry for on-demand enrichment", () => {
    const entry: CacheEntry = {
      projectId: 42,
      enrichedAt: new Date(),
      contactsFound: 3,
      rolesSearched: ["Mining Manager", "Procurement Manager"],
      apiCallsMade: 4,
      enrichedByUserId: "user-123",
    };
    expect(entry.projectId).toBe(42);
    expect(entry.contactsFound).toBe(3);
    expect(entry.rolesSearched).toHaveLength(2);
    expect(entry.enrichedByUserId).toBe("user-123");
  });

  it("creates valid cache entry for auto-enrichment (no user)", () => {
    const entry: CacheEntry = {
      projectId: 99,
      enrichedAt: new Date(),
      contactsFound: 5,
      rolesSearched: ["Project Manager", "Operations Manager", "Engineering Manager"],
      apiCallsMade: 6,
      enrichedByUserId: null,
    };
    expect(entry.enrichedByUserId).toBeNull();
    expect(entry.apiCallsMade).toBe(6);
  });
});
