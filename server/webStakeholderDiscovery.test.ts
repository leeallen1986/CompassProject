/**
 * Tests for the Open-Web Stakeholder Discovery Service
 *
 * Tests cover:
 * - Search query building from project metadata
 * - Role bucket normalisation
 * - Unverified contacts never receive a guessed mailbox
 * - Module exports and function signatures
 * - Schema columns for web_search contacts
 * - Verification scoring for web_search source
 */
import { describe, it, expect } from "vitest";
import {
  buildSearchQueries,
  _normalizeRoleBucket,
} from "./webStakeholderDiscovery";
import { unverifiedContactEmail } from "./intelligenceTrustPolicy";
import * as schema from "../drizzle/schema";

// ── buildSearchQueries ──

describe("buildSearchQueries", () => {
  it("returns up to 3 search queries", () => {
    const queries = buildSearchQueries({
      name: "Carmichael Mine",
      owner: "Adani Mining",
      contractors: [{ name: "CIMIC Group", status: "confirmed" }],
      sector: "mining",
      location: "QLD",
    });
    expect(queries.length).toBeLessThanOrEqual(3);
    expect(queries.length).toBeGreaterThanOrEqual(1);
  });

  it("includes owner name when available", () => {
    const queries = buildSearchQueries({
      name: "Olympic Dam Expansion",
      owner: "BHP",
      contractors: null,
      sector: "mining",
      location: "SA",
    });
    const ownerQuery = queries.find(q => q.includes("BHP"));
    expect(ownerQuery).toBeDefined();
  });

  it("uses contractor name when confirmed contractors exist", () => {
    const queries = buildSearchQueries({
      name: "West Gate Tunnel",
      owner: "Transurban",
      contractors: [
        { name: "CPB Contractors", status: "confirmed" },
        { name: "John Holland", status: "predicted" },
      ],
      sector: "infrastructure",
      location: "VIC",
    });
    const contractorQuery = queries.find(q => q.includes("CPB Contractors"));
    expect(contractorQuery).toBeDefined();
  });

  it("includes predicted contractors in search queries", () => {
    const queries = buildSearchQueries({
      name: "Test Project",
      owner: "Owner Co",
      contractors: [{ name: "Acme", status: "predicted" }],
      sector: "mining",
      location: "WA",
    });
    // Predicted contractors should now be included in search
    const acmeQuery = queries.find(q => q.includes("Acme"));
    expect(acmeQuery).toBeDefined();
  });

  it("falls back to owner when no eligible contractors", () => {
    const queries = buildSearchQueries({
      name: "Test Project",
      owner: "Owner Co",
      contractors: [{ name: "Acme", status: "unknown" }],
      sector: "mining",
      location: "WA",
    });
    // Should use owner as fallback in the third query
    const ownerQuery = queries.find(q => q.includes("Owner Co"));
    expect(ownerQuery).toBeDefined();
  });

  it("handles null contractors gracefully", () => {
    const queries = buildSearchQueries({
      name: "Test Project",
      owner: "Owner Co",
      contractors: null,
      sector: "energy",
      location: "QLD",
    });
    expect(queries.length).toBeGreaterThanOrEqual(1);
  });

  it("includes role-related keywords", () => {
    const queries = buildSearchQueries({
      name: "Test Project",
      owner: "BHP",
      contractors: null,
      sector: "mining",
      location: "WA",
    });
    const hasRoleKeywords = queries.some(q =>
      q.includes("project manager") || q.includes("procurement") ||
      q.includes("operations") || q.includes("director") ||
      q.includes("site manager") || q.includes("maintenance")
    );
    expect(hasRoleKeywords).toBe(true);
  });
});

// ── normalizeRoleBucket ──

describe("normalizeRoleBucket", () => {
  it("maps procurement roles", () => {
    expect(_normalizeRoleBucket("Procurement Manager")).toBe("procurement");
    expect(_normalizeRoleBucket("Supply Chain Director")).toBe("procurement");
    expect(_normalizeRoleBucket("Purchasing Officer")).toBe("procurement");
    expect(_normalizeRoleBucket("Contracts Manager")).toBe("procurement");
  });

  it("maps project management roles", () => {
    expect(_normalizeRoleBucket("Project Manager")).toBe("project_manager");
    expect(_normalizeRoleBucket("Project Director")).toBe("project_manager");
    expect(_normalizeRoleBucket("Project Lead")).toBe("project_manager");
  });

  it("maps engineering roles", () => {
    expect(_normalizeRoleBucket("Chief Engineer")).toBe("engineering");
    expect(_normalizeRoleBucket("Engineering Manager")).toBe("engineering");
  });

  it("maps operations roles", () => {
    expect(_normalizeRoleBucket("Operations Manager")).toBe("operations");
    expect(_normalizeRoleBucket("VP Operations")).toBe("operations");
  });

  it("maps general management roles", () => {
    expect(_normalizeRoleBucket("General Manager")).toBe("general_manager");
    expect(_normalizeRoleBucket("Managing Director")).toBe("general_manager");
    expect(_normalizeRoleBucket("CEO")).toBe("general_manager");
    expect(_normalizeRoleBucket("Director of Mining")).toBe("general_manager");
  });

  it("maps site management roles", () => {
    expect(_normalizeRoleBucket("Site Manager")).toBe("site_manager");
    expect(_normalizeRoleBucket("Site Superintendent")).toBe("site_manager");
  });

  it("maps fleet/equipment roles", () => {
    expect(_normalizeRoleBucket("Fleet Manager")).toBe("fleet_manager");
    expect(_normalizeRoleBucket("Equipment Manager")).toBe("fleet_manager");
  });

  it("maps maintenance roles", () => {
    expect(_normalizeRoleBucket("Maintenance Manager")).toBe("maintenance");
    expect(_normalizeRoleBucket("Reliability Engineer")).toBe("engineering"); // 'engineer' matches before 'reliability'
    expect(_normalizeRoleBucket("Reliability Manager")).toBe("maintenance");
  });

  it("maps commercial roles", () => {
    expect(_normalizeRoleBucket("Commercial Manager")).toBe("commercial");
    expect(_normalizeRoleBucket("Business Development Manager")).toBe("commercial");
  });

  it("returns 'other' for unknown roles", () => {
    expect(_normalizeRoleBucket("Receptionist")).toBe("other");
    expect(_normalizeRoleBucket("Intern")).toBe("other");
  });
});

// ── Email trust ──

describe("unverified contact email handling", () => {
  it("never creates a guessed mailbox for a discovered person", () => {
    expect(unverifiedContactEmail()).toBeNull();
  });
});

// ── Contractor status matching (case-insensitive + Predicted) ──

describe("buildSearchQueries — contractor status matching", () => {
  it("includes contractors with uppercase 'Confirmed' status", () => {
    const queries = buildSearchQueries({
      name: "Iron Bridge Magnetite",
      owner: "Fortescue",
      contractors: [{ name: "Monadelphous", status: "Confirmed" }],
      sector: "mining",
      location: "WA",
    });
    const contractorQuery = queries.find(q => q.includes("Monadelphous"));
    expect(contractorQuery).toBeDefined();
  });

  it("includes contractors with uppercase 'Predicted' status", () => {
    const queries = buildSearchQueries({
      name: "Olympic Dam Expansion",
      owner: "BHP",
      contractors: [{ name: "Thiess", status: "Predicted" }],
      sector: "mining",
      location: "SA",
    });
    const contractorQuery = queries.find(q => q.includes("Thiess"));
    expect(contractorQuery).toBeDefined();
  });

  it("includes contractors with lowercase 'confirmed' status", () => {
    const queries = buildSearchQueries({
      name: "West Gate Tunnel",
      owner: "Transurban",
      contractors: [{ name: "CPB Contractors", status: "confirmed" }],
      sector: "infrastructure",
      location: "VIC",
    });
    const contractorQuery = queries.find(q => q.includes("CPB Contractors"));
    expect(contractorQuery).toBeDefined();
  });

  it("includes contractors with 'awarded' status", () => {
    const queries = buildSearchQueries({
      name: "Snowy 2.0",
      owner: "Snowy Hydro",
      contractors: [{ name: "Webuild", status: "awarded" }],
      sector: "energy",
      location: "NSW",
    });
    const contractorQuery = queries.find(q => q.includes("Webuild"));
    expect(contractorQuery).toBeDefined();
  });

  it("excludes contractors with 'unknown' or empty status", () => {
    const queries = buildSearchQueries({
      name: "Test Project",
      owner: "TestOwner",
      contractors: [
        { name: "BadCo", status: "unknown" },
        { name: "EmptyCo", status: "" },
      ],
      sector: "mining",
      location: "WA",
    });
    const badQuery = queries.find(q => q.includes("BadCo") || q.includes("EmptyCo"));
    expect(badQuery).toBeUndefined();
  });

  it("prioritises first eligible contractor for search query", () => {
    const queries = buildSearchQueries({
      name: "Test Project",
      owner: "TestOwner",
      contractors: [
        { name: "FirstCo", status: "Predicted" },
        { name: "SecondCo", status: "Confirmed" },
      ],
      sector: "mining",
      location: "QLD",
    });
    const firstCoQuery = queries.find(q => q.includes("FirstCo"));
    expect(firstCoQuery).toBeDefined();
  });
});

// ── Schema columns ──

describe("contacts schema for web_search", () => {
  it("has enrichmentSource column with web_search enum value", () => {
    const table = schema.contacts;
    expect(table.enrichmentSource).toBeDefined();
    // Check the enum includes web_search
    const config = (table.enrichmentSource as any).config;
    if (config?.enumValues) {
      expect(config.enumValues).toContain("web_search");
    }
  });

  it("has sourceUrl column", () => {
    const table = schema.contacts;
    expect(table.sourceUrl).toBeDefined();
  });
});

// ── Module exports ──

describe("webStakeholderDiscovery module exports", () => {
  it("exports buildSearchQueries", () => {
    expect(typeof buildSearchQueries).toBe("function");
  });

  it("exports normalizeRoleBucket", () => {
    expect(typeof _normalizeRoleBucket).toBe("function");
  });

  it("exports discoverStakeholders", async () => {
    const mod = await import("./webStakeholderDiscovery");
    expect(typeof mod.discoverStakeholders).toBe("function");
  });

  it("exports discoverAndSaveStakeholders", async () => {
    const mod = await import("./webStakeholderDiscovery");
    expect(typeof mod.discoverAndSaveStakeholders).toBe("function");
  });

  it("exports runBulkWebDiscovery", async () => {
    const mod = await import("./webStakeholderDiscovery");
    expect(typeof mod.runBulkWebDiscovery).toBe("function");
  });
});

// ── Verification scoring for web_search ──

describe("verification scoring includes web_search", () => {
  it("web_search contacts get source score of 20", async () => {
    const { computeVerificationScore } = await import("./verificationScoring");
    const contact = {
      name: "John Smith",
      title: "Project Manager",
      company: "BHP",
      email: "john.smith@bhp.com",
      linkedin: null,
      enrichmentSource: "web_search" as const,
      verificationStatus: "ai_suggested" as const,
      verifiedByUserId: null,
      emailVerified: false,
      linkedinSearchUrl: "https://linkedin.com/search?q=john+smith+bhp",
      linkedinProfileUrl: null,
    };
    const result = computeVerificationScore(contact);
    // Source should be 20 for web_search
    expect(result.source).toBe(20);
    expect(result.total).toBeGreaterThanOrEqual(55);
  });
});
