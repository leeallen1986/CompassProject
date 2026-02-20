import { describe, it, expect } from "vitest";
import { validateApolloApiKey, apolloPeopleSearch } from "./apolloEnrichment";

describe("Apollo.io API Integration", () => {
  it("should have APOLLO_API_KEY configured", () => {
    const key = process.env.APOLLO_API_KEY;
    expect(key).toBeDefined();
    expect(key).not.toBe("");
    expect(typeof key).toBe("string");
  });

  it("should validate the Apollo API key with a lightweight search", async () => {
    const result = await validateApolloApiKey();
    expect(result.valid).toBe(true);
    if (!result.valid) {
      console.error("Apollo API key validation failed:", result.error);
    }
  }, 15000);

  it("should return people from a known company search", async () => {
    const result = await apolloPeopleSearch({
      organizationDomains: ["bhp.com"],
      personTitles: ["Project Manager"],
      organizationLocations: ["australia"],
      perPage: 5,
    });

    expect(result).toBeDefined();
    expect(result.people).toBeDefined();
    expect(Array.isArray(result.people)).toBe(true);
    // BHP is a huge company, should have results
    expect(result.people.length).toBeGreaterThan(0);

    // Verify the structure of returned people (api_search format)
    const person = result.people[0];
    expect(person.id).toBeDefined();
    expect(person.first_name).toBeDefined();
    expect(person.last_name_obfuscated).toBeDefined(); // Obfuscated last name
    expect(person.title).toBeDefined();
    expect(typeof person.has_email).toBe("boolean");

    // api_search does NOT return email or full last name
    expect(person).not.toHaveProperty("email");
    expect(person).not.toHaveProperty("last_name");

    // Should have total_entries at top level
    expect(result.total_entries).toBeDefined();
    expect(result.total_entries).toBeGreaterThan(0);
  }, 15000);

  it("should handle search with no results gracefully", async () => {
    const result = await apolloPeopleSearch({
      organizationDomains: ["thiscompanydoesnotexist12345xyz.com"],
      personTitles: ["CEO"],
      perPage: 1,
    });

    expect(result).toBeDefined();
    expect(result.people).toBeDefined();
    expect(Array.isArray(result.people)).toBe(true);
    // May return 0 results for a non-existent company
    expect(result.people.length).toBe(0);
  }, 15000);
});
