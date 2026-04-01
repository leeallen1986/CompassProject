import { describe, it, expect } from "vitest";

/**
 * Hunter.io API key validation test.
 * Uses the Account endpoint which costs 0 credits and verifies the key is valid.
 */
describe("Hunter.io API Key Validation", () => {
  it("should authenticate with the Hunter.io API", async () => {
    const apiKey = process.env.HUNTER_API_KEY;
    expect(apiKey, "HUNTER_API_KEY must be set").toBeTruthy();

    // Account endpoint is free and returns plan info
    const res = await fetch(
      `https://api.hunter.io/v2/account?api_key=${apiKey}`
    );

    expect(res.ok, `Hunter API returned ${res.status}`).toBe(true);

    const json = await res.json();
    expect(json.data).toBeDefined();
    expect(json.data.email).toBeDefined();

    console.log(`[Hunter] API key valid. Plan: ${json.data.plan_name}, Searches remaining: ${json.data.requests?.searches?.available ?? "unknown"}`);
  });

  it("should perform a domain search (0 credit test with known domain)", async () => {
    const apiKey = process.env.HUNTER_API_KEY;
    if (!apiKey) return;

    const res = await fetch(
      `https://api.hunter.io/v2/domain-search?domain=atlascopco.com&api_key=${apiKey}&limit=1`
    );

    expect(res.ok, `Domain search returned ${res.status}`).toBe(true);

    const json = await res.json();
    expect(json.data).toBeDefined();
    expect(json.data.domain).toBe("atlascopco.com");

    console.log(`[Hunter] Domain search works. Found ${json.meta?.results ?? 0} emails at atlascopco.com`);
  });
});
