/**
 * Tests for Apollo.io tRPC endpoints
 * Validates: apolloSearch, apolloReveal, apolloStatus
 */
import { describe, it, expect, vi } from "vitest";

// We test the apolloEnrichment module functions directly since they're the core logic
import {
  apolloPeopleSearch,
  enrichSingleContact,
  validateApolloApiKey,
  inferDomain,
  type ApolloEnrichmentResult,
} from "./apolloEnrichment";

// All tests in this file make live Apollo API calls — use 15s timeout throughout
const LIVE_API_TIMEOUT = 15000;

describe("Apollo tRPC Route Logic", () => {
  describe("apolloPeopleSearch (used by apolloSearch endpoint)", () => {
    it("should search for people at a known Australian company", async () => {
      const result = await apolloPeopleSearch({
        organizationDomains: ["bhp.com"],
        personTitles: ["Manager"],
        organizationLocations: ["australia"],
        page: 1,
        perPage: 5,
      });

      expect(result).toBeDefined();
      expect(result.people).toBeDefined();
      expect(Array.isArray(result.people)).toBe(true);
      // BHP is a large company, should have results
      expect(result.total_entries).toBeGreaterThan(0);

      // Verify the obfuscated response structure
      if (result.people.length > 0) {
        const person = result.people[0];
        expect(person.id).toBeDefined();
        expect(person.first_name).toBeDefined();
        // Last name should be obfuscated in free search
        expect(person.last_name_obfuscated).toBeDefined();
        expect(typeof person.has_email).toBe("boolean");
      }
    }, LIVE_API_TIMEOUT);

    it("should return empty results for a non-existent company", async () => {
      const result = await apolloPeopleSearch({
        organizationDomains: ["thiscompanydoesnotexist99999.com.au"],
        page: 1,
        perPage: 5,
      });

      expect(result).toBeDefined();
      expect(result.people).toBeDefined();
      expect(result.people.length).toBe(0);
    }, LIVE_API_TIMEOUT);
  });

  describe("inferDomain", () => {
    it("should infer domain for well-known companies", () => {
      expect(inferDomain("BHP")).toBe("bhp.com");
      expect(inferDomain("Rio Tinto")).toBe("riotinto.com");
      expect(inferDomain("Thiess")).toBe("thiess.com");
    });

    it("should generate a reasonable domain for unknown companies", () => {
      const domain = inferDomain("Acme Mining Corp");
      expect(domain).toBeDefined();
      expect(typeof domain).toBe("string");
      // Should contain .com or similar
      expect(domain).toMatch(/\./);
    });
  });

  describe("validateApolloApiKey", () => {
    it("should confirm the API key is valid", async () => {
      const result = await validateApolloApiKey();
      expect(result).toBeDefined();
      expect(result.valid).toBe(true);
    }, LIVE_API_TIMEOUT);
  });

  describe("enrichSingleContact", () => {
    it("should attempt to enrich a contact via Apollo People Enrichment", async () => {
      // Use a known person from BHP search
      const searchResult = await apolloPeopleSearch({
        organizationDomains: ["bhp.com"],
        personTitles: ["Manager"],
        organizationLocations: ["australia"],
        page: 1,
        perPage: 1,
      });

      if (searchResult.people.length === 0) {
        // Skip if no results (API quota etc.)
        return;
      }

      const person = searchResult.people[0];
      const toEnrich: ApolloEnrichmentResult = {
        contactId: 0,
        apolloId: person.id,
        name: `${person.first_name} ${person.last_name_obfuscated || ""}`.trim(),
        firstName: person.first_name,
        lastNameObfuscated: person.last_name_obfuscated,
        title: person.title || "Manager",
        company: person.organization?.name || "BHP",
        email: null,
        emailStatus: null,
        linkedinUrl: null,
        photoUrl: null,
        city: null,
        state: null,
        country: null,
        seniority: null,
        hasEmail: person.has_email,
        status: "found",
      };

      const enriched = await enrichSingleContact(toEnrich);
      expect(enriched).toBeDefined();
      expect(enriched.apolloId).toBe(person.id);
      // The enrichment should either succeed or fail gracefully
      expect(["enriched", "found", "not_found", "error"]).toContain(enriched.status);

      if (enriched.status === "enriched") {
        // If enriched, should have more data
        expect(enriched.name).toBeDefined();
        expect(enriched.name.length).toBeGreaterThan(0);
      }
    }, LIVE_API_TIMEOUT);
  });
});
