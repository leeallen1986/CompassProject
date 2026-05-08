/**
 * Test: Login redirect should go to /login, not Manus OAuth
 * Verifies that no page-level components redirect directly to getLoginUrl()
 * for unauthenticated users — they should all redirect to /login instead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const pagesDir = join(process.cwd(), "client/src/pages");
const pagesToCheck = [
  "ThisWeek.tsx",
  "AccountAttack.tsx",
  "CollateralLibrary.tsx",
  "ContactValidation.tsx",
];

describe("Login redirect fix", () => {
  it("no page-level unauthenticated guard should redirect to getLoginUrl() directly", () => {
    const violations: string[] = [];
    for (const page of pagesToCheck) {
      const content = readFileSync(join(pagesDir, page), "utf-8");
      // Check for patterns that would redirect unauthenticated users to Manus OAuth
      // Allowed: getLoginUrl() in Login.tsx (it's the login page itself)
      // Not allowed: href={getLoginUrl()} or window.location.href = getLoginUrl() in auth guards
      const hasDirectOAuthRedirect =
        /href=\{getLoginUrl\(\)\}/.test(content) ||
        /window\.location\.href\s*=\s*getLoginUrl\(\)/.test(content);
      if (hasDirectOAuthRedirect) {
        violations.push(page);
      }
    }
    expect(violations).toEqual([]);
  });

  it("main.tsx redirects unauthorized tRPC errors to /login not Manus OAuth", () => {
    const mainContent = readFileSync(
      join(process.cwd(), "client/src/main.tsx"),
      "utf-8"
    );
    // Should redirect to /login
    expect(mainContent).toContain('window.location.href = "/login"');
    // Should NOT redirect directly to getLoginUrl() for unauthorized errors
    expect(mainContent).not.toMatch(/redirectToLoginIfUnauthorized[\s\S]*?getLoginUrl\(\)/m);
  });
});
