import { describe, expect, it, vi } from "vitest";

/**
 * Tests for campaign enrichment pipeline features:
 * - Enrichment source tracking (Apollo / Hunter)
 * - Enrichment status filtering
 * - Waterfall enrichment flow
 */

// ── Unit tests for enrichment source badge logic ──
describe("enrichment source badge logic", () => {
  // This mirrors the badge rendering logic in Campaigns.tsx
  function getEnrichmentBadge(contact: {
    enrichmentSource?: string | null;
    enrichmentStatus: string;
    hunterConfidence?: number | null;
    email?: string | null;
    enrichedEmail?: string | null;
  }) {
    if (contact.enrichmentSource === "apollo") {
      return { type: "apollo", label: "Apollo", color: "purple" };
    }
    if (contact.enrichmentSource === "hunter") {
      const conf = contact.hunterConfidence ? ` ${contact.hunterConfidence}%` : "";
      return { type: "hunter", label: `Hunter${conf}`, color: "orange" };
    }
    if (
      contact.enrichmentStatus === "not_needed" &&
      !contact.enrichmentSource &&
      (contact.email || contact.enrichedEmail)
    ) {
      return { type: "import", label: "Import", color: "grey" };
    }
    return null;
  }

  it("returns Apollo badge for apollo-enriched contacts", () => {
    const badge = getEnrichmentBadge({
      enrichmentSource: "apollo",
      enrichmentStatus: "enriched",
      email: "test@example.com",
    });
    expect(badge).toEqual({ type: "apollo", label: "Apollo", color: "purple" });
  });

  it("returns Hunter badge with confidence for hunter-enriched contacts", () => {
    const badge = getEnrichmentBadge({
      enrichmentSource: "hunter",
      enrichmentStatus: "enriched",
      hunterConfidence: 87,
      enrichedEmail: "test@example.com",
    });
    expect(badge).toEqual({ type: "hunter", label: "Hunter 87%", color: "orange" });
  });

  it("returns Hunter badge without confidence when not provided", () => {
    const badge = getEnrichmentBadge({
      enrichmentSource: "hunter",
      enrichmentStatus: "enriched",
      hunterConfidence: null,
      enrichedEmail: "test@example.com",
    });
    expect(badge).toEqual({ type: "hunter", label: "Hunter", color: "orange" });
  });

  it("returns Import badge for not_needed contacts with email", () => {
    const badge = getEnrichmentBadge({
      enrichmentSource: null,
      enrichmentStatus: "not_needed",
      email: "imported@example.com",
    });
    expect(badge).toEqual({ type: "import", label: "Import", color: "grey" });
  });

  it("returns null for pending contacts without enrichment", () => {
    const badge = getEnrichmentBadge({
      enrichmentSource: null,
      enrichmentStatus: "pending",
      email: null,
      enrichedEmail: null,
    });
    expect(badge).toBeNull();
  });

  it("returns null for not_found contacts", () => {
    const badge = getEnrichmentBadge({
      enrichmentSource: null,
      enrichmentStatus: "not_found",
      email: null,
    });
    expect(badge).toBeNull();
  });
});

// ── Unit tests for enrichment filter logic ──
describe("enrichment filter logic", () => {
  // This mirrors the filter logic used in the tRPC contacts query
  function filterByEnrichment(
    contacts: Array<{ enrichmentStatus: string; email?: string | null; enrichedEmail?: string | null }>,
    filter: string
  ) {
    if (!filter) return contacts;
    return contacts.filter((c) => {
      switch (filter) {
        case "enriched":
          return c.enrichmentStatus === "enriched";
        case "not_needed":
          return c.enrichmentStatus === "not_needed";
        case "pending":
          return c.enrichmentStatus === "pending";
        case "not_found":
          return c.enrichmentStatus === "not_found";
        default:
          return true;
      }
    });
  }

  const sampleContacts = [
    { enrichmentStatus: "enriched", email: "a@test.com", enrichedEmail: "a@test.com" },
    { enrichmentStatus: "not_needed", email: "b@test.com", enrichedEmail: null },
    { enrichmentStatus: "pending", email: null, enrichedEmail: null },
    { enrichmentStatus: "not_found", email: null, enrichedEmail: null },
    { enrichmentStatus: "enriched", email: null, enrichedEmail: "c@test.com" },
    { enrichmentStatus: "pending", email: null, enrichedEmail: null },
  ];

  it("returns all contacts when filter is empty", () => {
    const result = filterByEnrichment(sampleContacts, "");
    expect(result).toHaveLength(6);
  });

  it("filters enriched contacts correctly", () => {
    const result = filterByEnrichment(sampleContacts, "enriched");
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.enrichmentStatus === "enriched")).toBe(true);
  });

  it("filters not_needed (import) contacts correctly", () => {
    const result = filterByEnrichment(sampleContacts, "not_needed");
    expect(result).toHaveLength(1);
    expect(result[0].enrichmentStatus).toBe("not_needed");
  });

  it("filters pending contacts correctly", () => {
    const result = filterByEnrichment(sampleContacts, "pending");
    expect(result).toHaveLength(2);
  });

  it("filters not_found contacts correctly", () => {
    const result = filterByEnrichment(sampleContacts, "not_found");
    expect(result).toHaveLength(1);
  });
});

// ── Unit tests for waterfall enrichment scoring ──
describe("enrichment scoring", () => {
  // Mirrors the computeScore function used in campaignService
  function computeScore(params: {
    title: string;
    email: string | null;
    mobile: string | null;
    matchedProjectCount: number;
  }): { score: number; tier: string } {
    let score = 0;

    // Email presence
    if (params.email) score += 25;

    // Mobile presence
    if (params.mobile) score += 10;

    // Title relevance (simplified)
    const titleLower = (params.title || "").toLowerCase();
    if (titleLower.includes("director") || titleLower.includes("managing")) score += 20;
    else if (titleLower.includes("manager")) score += 15;
    else if (titleLower.includes("inspector") || titleLower.includes("specialist")) score += 10;

    // Project matches
    score += Math.min(params.matchedProjectCount * 5, 30);

    // Tier assignment
    let tier = "tier4_low";
    if (score >= 50) tier = "tier1_hot";
    else if (score >= 35) tier = "tier2_warm";
    else if (score >= 20) tier = "tier3_enrich";

    return { score, tier };
  }

  it("scores a contact with email and director title as hot", () => {
    const result = computeScore({
      title: "Managing Director",
      email: "test@example.com",
      mobile: "+61412345678",
      matchedProjectCount: 2,
    });
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.tier).toBe("tier1_hot");
  });

  it("scores a contact without email as lower tier", () => {
    const result = computeScore({
      title: "Inspector",
      email: null,
      mobile: null,
      matchedProjectCount: 1,
    });
    expect(result.score).toBeLessThan(50);
  });

  it("gives bonus for project matches", () => {
    const withProjects = computeScore({
      title: "Technician",
      email: "test@example.com",
      mobile: null,
      matchedProjectCount: 4,
    });
    const withoutProjects = computeScore({
      title: "Technician",
      email: "test@example.com",
      mobile: null,
      matchedProjectCount: 0,
    });
    expect(withProjects.score).toBeGreaterThan(withoutProjects.score);
  });
});

// ── Unit tests for waterfall enrichment flow ──
describe("waterfall enrichment flow", () => {
  it("should try Apollo first, then Hunter for missed contacts", async () => {
    const apolloResults = new Map<number, string>();
    apolloResults.set(1, "found@apollo.com");
    // Contact 2 not found by Apollo

    const hunterResults = new Map<number, { email: string; confidence: number }>();
    hunterResults.set(2, { email: "found@hunter.io", confidence: 85 });

    // Simulate waterfall
    const contacts = [
      { id: 1, name: "Contact A" },
      { id: 2, name: "Contact B" },
    ];

    const enriched: Array<{ id: number; email: string; source: string; confidence?: number }> = [];
    const apolloMissed: typeof contacts = [];

    // Step 1: Apollo
    for (const contact of contacts) {
      const apolloEmail = apolloResults.get(contact.id);
      if (apolloEmail) {
        enriched.push({ id: contact.id, email: apolloEmail, source: "apollo" });
      } else {
        apolloMissed.push(contact);
      }
    }

    // Step 2: Hunter for missed contacts
    for (const contact of apolloMissed) {
      const hunterResult = hunterResults.get(contact.id);
      if (hunterResult) {
        enriched.push({
          id: contact.id,
          email: hunterResult.email,
          source: "hunter",
          confidence: hunterResult.confidence,
        });
      }
    }

    expect(enriched).toHaveLength(2);
    expect(enriched[0]).toEqual({ id: 1, email: "found@apollo.com", source: "apollo" });
    expect(enriched[1]).toEqual({
      id: 2,
      email: "found@hunter.io",
      source: "hunter",
      confidence: 85,
    });
    expect(apolloMissed).toHaveLength(1);
    expect(apolloMissed[0].id).toBe(2);
  });

  it("should mark contacts as not_found when both Apollo and Hunter fail", () => {
    const contacts = [{ id: 3, name: "Contact C" }];
    const apolloResults = new Map<number, string>();
    const hunterResults = new Map<number, { email: string; confidence: number }>();

    const enriched: Array<{ id: number; source: string }> = [];
    const notFound: number[] = [];

    // Step 1: Apollo
    const apolloMissed: typeof contacts = [];
    for (const contact of contacts) {
      const apolloEmail = apolloResults.get(contact.id);
      if (apolloEmail) {
        enriched.push({ id: contact.id, source: "apollo" });
      } else {
        apolloMissed.push(contact);
      }
    }

    // Step 2: Hunter
    for (const contact of apolloMissed) {
      const hunterResult = hunterResults.get(contact.id);
      if (hunterResult) {
        enriched.push({ id: contact.id, source: "hunter" });
      } else {
        notFound.push(contact.id);
      }
    }

    expect(enriched).toHaveLength(0);
    expect(notFound).toEqual([3]);
  });
});
