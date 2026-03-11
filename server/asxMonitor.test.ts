import { describe, expect, it } from "vitest";
import { _testing, getAsxWatchlist } from "./asxMonitor";

const {
  isProjectRelated,
  isFinancialOnly,
  filterAnnouncements,
  ASX_WATCHLIST,
  ASX_PROJECT_KEYWORDS,
  ASX_FINANCIAL_DISCARD_KEYWORDS,
} = _testing;

describe("asxMonitor — configuration", () => {
  it("has a non-empty target company watchlist", () => {
    expect(ASX_WATCHLIST.length).toBeGreaterThan(0);
  });

  it("every target company has required fields", () => {
    for (const company of ASX_WATCHLIST) {
      expect(company.code).toBeTruthy();
      expect(company.code).toMatch(/^[A-Z0-9]{2,4}$/); // ASX codes are 2-4 alphanumeric chars
      expect(company.name).toBeTruthy();
      expect(company.sector).toBeTruthy();
    }
  });

  it("includes major miners in the watchlist", () => {
    const codes = ASX_WATCHLIST.map((c: any) => c.code);
    expect(codes).toContain("BHP");
    expect(codes).toContain("RIO");
    expect(codes).toContain("FMG");
  });

  it("has no duplicate company codes", () => {
    const codes = ASX_WATCHLIST.map((c: any) => c.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it("has project-related keywords for filtering", () => {
    expect(ASX_PROJECT_KEYWORDS.length).toBeGreaterThan(5);
    const keywords = ASX_PROJECT_KEYWORDS.map((k: string) => k.toLowerCase());
    expect(keywords).toContain("project");
    expect(keywords).toContain("construction");
    expect(keywords.some((k: string) => k.includes("contract"))).toBe(true);
  });

  it("has exclusion keywords to filter out financial noise", () => {
    expect(ASX_FINANCIAL_DISCARD_KEYWORDS.length).toBeGreaterThan(0);
    const keywords = ASX_FINANCIAL_DISCARD_KEYWORDS.map((k: string) => k.toLowerCase());
    // Should exclude purely financial announcements
    expect(keywords.some((k: string) => k.includes("dividend") || k.includes("buyback"))).toBe(true);
  });
});

describe("asxMonitor — filtering logic", () => {
  it("isProjectRelated returns true for project announcements", () => {
    expect(isProjectRelated("New mining project approved in WA")).toBe(true);
    expect(isProjectRelated("Construction begins on solar farm")).toBe(true);
    expect(isProjectRelated("Contract awarded for infrastructure development")).toBe(true);
  });

  it("isProjectRelated returns false for unrelated announcements", () => {
    expect(isProjectRelated("Board meeting minutes")).toBe(false);
    expect(isProjectRelated("Change of company secretary")).toBe(false);
  });

  it("isFinancialOnly returns true for financial announcements", () => {
    expect(isFinancialOnly("Final dividend declared at 50c per share")).toBe(true);
    expect(isFinancialOnly("Share buyback program announced")).toBe(true);
  });

  it("isFinancialOnly returns false for project announcements", () => {
    expect(isFinancialOnly("New mining project approved")).toBe(false);
    expect(isFinancialOnly("Construction contract awarded")).toBe(false);
  });

  it("getAsxWatchlist returns the watchlist", () => {
    const list = getAsxWatchlist();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });
});
