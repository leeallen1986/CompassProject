import { describe, it, expect } from "vitest";

describe("Lusha API Key Validation", () => {
  it("should have LUSHA_API_KEY set in environment", () => {
    const key = process.env.LUSHA_API_KEY;
    expect(key).toBeDefined();
    expect(key).not.toBe("");
    expect(key!.length).toBeGreaterThan(10);
  });

  it("should authenticate successfully against Lusha API", async () => {
    const key = process.env.LUSHA_API_KEY;
    if (!key) {
      console.warn("LUSHA_API_KEY not set — skipping live API test");
      return;
    }

    // Use a lightweight request to validate the key without consuming credits
    // Lusha returns 401 for invalid keys, 200/422 for valid keys with bad params
    const response = await fetch(
      "https://api.lusha.com/v2/person?firstName=test&lastName=test&company=test",
      {
        headers: {
          "api_key": key,
          "Accept": "application/json",
        },
      },
    );

    // Valid key: 200 (found) or 404 (not found) or 422 (validation error)
    // Invalid key: 401 or 403
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
    console.log(`Lusha API responded with status ${response.status} — key is valid`);
  });
});
