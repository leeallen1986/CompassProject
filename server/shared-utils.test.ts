import { describe, it, expect } from "vitest";
import { sanitizeContractorName, deriveWhyNow } from "../shared/utils";

describe("sanitizeContractorName", () => {
  it("returns null for null input", () => {
    expect(sanitizeContractorName(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(sanitizeContractorName(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(sanitizeContractorName("")).toBeNull();
  });

  it("returns null for string too short", () => {
    expect(sanitizeContractorName("AB")).toBeNull();
  });

  it("returns null for strings containing HTML tags", () => {
    expect(sanitizeContractorName("<a href='x'>Foo</a>")).toBeNull();
  });

  it("returns null for strings containing http", () => {
    expect(sanitizeContractorName("https://example.com")).toBeNull();
  });

  it("returns null for strings containing //www.", () => {
    expect(sanitizeContractorName("//www.example.com")).toBeNull();
  });

  it("returns null for hex color codes", () => {
    expect(sanitizeContractorName("#FF5733")).toBeNull();
  });

  it("returns null for strings starting with double quote", () => {
    expect(sanitizeContractorName('"Quoted Name"')).toBeNull();
  });

  it("returns the sanitized name for valid input", () => {
    expect(sanitizeContractorName("  Thiess Pty Ltd  ")).toBe("Thiess Pty Ltd");
  });

  it("returns the name unchanged for a normal contractor name", () => {
    expect(sanitizeContractorName("BHP Billiton")).toBe("BHP Billiton");
  });

  it("returns null for strings longer than 200 chars", () => {
    const longStr = "A".repeat(201);
    expect(sanitizeContractorName(longStr)).toBeNull();
  });

  it("accepts strings exactly 200 chars", () => {
    const s = "A".repeat(200);
    expect(sanitizeContractorName(s)).toBe(s);
  });
});

describe("deriveWhyNow", () => {
  it("returns tier1 message for tier1_actionable", () => {
    const result = deriveWhyNow({ actionTier: "tier1_actionable" });
    expect(result).toContain("Action required now");
  });

  it("returns new project message for isNew", () => {
    const result = deriveWhyNow({ isNew: true });
    expect(result).toContain("New project");
  });

  it("tier1 takes precedence over isNew", () => {
    const result = deriveWhyNow({ actionTier: "tier1_actionable", isNew: true });
    expect(result).toContain("Action required now");
  });

  it("returns stageCode message when stage is present", () => {
    const result = deriveWhyNow({ stageCode: "Construction" });
    expect(result).toContain("Construction");
  });

  it("truncates long overview to 120 chars", () => {
    const longOverview = "A".repeat(150);
    const result = deriveWhyNow({ overview: longOverview });
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith("…")).toBe(true);
  });

  it("returns full overview when under 120 chars", () => {
    const short = "Short overview.";
    const result = deriveWhyNow({ overview: short });
    expect(result).toBe(short);
  });

  it("returns fallback message when no fields present", () => {
    const result = deriveWhyNow({});
    expect(result).toContain("Monitor");
  });
});
