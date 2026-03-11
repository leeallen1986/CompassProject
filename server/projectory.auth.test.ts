import { describe, it, expect } from "vitest";

/**
 * Validate Projectory credentials by performing a real login flow.
 * 1. GET /login to obtain CSRF token + session cookie
 * 2. POST /login with credentials
 * 3. Expect HTTP 204 (successful auth)
 */
describe("Projectory Authentication", () => {
  const email = process.env.PROJECTORY_EMAIL;
  const password = process.env.PROJECTORY_PASSWORD;

  it("should have credentials configured", () => {
    expect(email).toBeTruthy();
    expect(password).toBeTruthy();
    expect(email).toContain("@");
  });

  it("should login successfully with credentials", async () => {
    // Step 1: Get CSRF token and session cookie
    const loginPageRes = await fetch("https://www.projectory.com.au/login", {
      redirect: "manual",
    });
    expect(loginPageRes.ok).toBe(true);

    const html = await loginPageRes.text();
    const csrfMatch = html.match(/csrfToken":"([^"]+)"/);
    expect(csrfMatch).toBeTruthy();
    const csrfToken = csrfMatch![1];

    // Extract cookies from response
    const setCookies = loginPageRes.headers.getSetCookie?.() ?? [];
    const cookieHeader = setCookies
      .map((c: string) => c.split(";")[0])
      .join("; ");
    expect(cookieHeader).toContain("laravel_session");

    // Step 2: POST login
    const loginRes = await fetch("https://www.projectory.com.au/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-TOKEN": csrfToken,
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        Referer: "https://www.projectory.com.au/login",
        Origin: "https://www.projectory.com.au",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({ email, password }),
      redirect: "manual",
    });

    // 204 = success, 422 = validation error, 401 = bad credentials
    expect(loginRes.status).toBe(204);
  }, 15000);
});
