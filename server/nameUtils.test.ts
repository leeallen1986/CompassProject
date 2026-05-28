import { describe, it, expect } from "vitest";
import { cleanContactName, parseContactName, isEnrichableName } from "./nameUtils";

describe("cleanContactName", () => {
  it("returns a normal name unchanged", () => {
    expect(cleanContactName("John Smith")).toBe("John Smith");
  });

  it("returns null for names starting with emoji", () => {
    expect(cleanContactName("🪷 Successful on Paper. Depleted in Life")).toBeNull();
  });

  it("returns null for names starting with non-letter characters", () => {
    expect(cleanContactName("123 Test")).toBeNull();
    expect(cleanContactName("@handle")).toBeNull();
  });

  it("strips credentials after comma", () => {
    expect(cleanContactName("Elizabeth Calo, MBA, SPHR, SHRM-SCP")).toBe("Elizabeth Calo");
    expect(cleanContactName("John Smith, PhD")).toBe("John Smith");
    expect(cleanContactName("Jane Doe, PMP, CSM")).toBe("Jane Doe");
  });

  it("strips parenthetical nicknames", () => {
    expect(cleanContactName("Mohamed Kenawy (Mo)")).toBe("Mohamed Kenawy");
    expect(cleanContactName("Laura Ivonne H. (née Jones)")).toBe("Laura Ivonne H.");
    expect(cleanContactName("Bob Smith (Bobby)")).toBe("Bob Smith");
  });

  it("strips post-nominal credential tokens after last name", () => {
    expect(cleanContactName("Arash Dalir FIEAust CPEng RPEV")).toBe("Arash Dalir");
    expect(cleanContactName("Craig Lawlor PE MBA")).toBe("Craig Lawlor");
  });

  it("preserves multi-word last names that are not credentials", () => {
    // "van der Berg" — tokens beyond index 1 are lowercase, not credentials
    expect(cleanContactName("Jan van der Berg")).toBe("Jan van der Berg");
  });

  it("handles names with both comma credentials and parenthetical nicknames", () => {
    expect(cleanContactName("Alice Brown (Ali), PhD, MBA")).toBe("Alice Brown");
  });

  it("returns null for empty string", () => {
    expect(cleanContactName("")).toBeNull();
    expect(cleanContactName("   ")).toBeNull();
  });

  it("handles single-word names", () => {
    expect(cleanContactName("Madonna")).toBe("Madonna");
  });

  it("preserves accented characters in names", () => {
    expect(cleanContactName("José García")).toBe("José García");
    expect(cleanContactName("Björn Ångström")).toBe("Björn Ångström");
  });
});

describe("parseContactName", () => {
  it("splits a two-part name correctly", () => {
    expect(parseContactName("John Smith")).toEqual({ firstName: "John", lastName: "Smith" });
  });

  it("handles single-word name", () => {
    expect(parseContactName("Madonna")).toEqual({ firstName: "Madonna", lastName: "" });
  });

  it("handles multi-word last name", () => {
    expect(parseContactName("Jan van Berg")).toEqual({ firstName: "Jan", lastName: "van Berg" });
  });
});

describe("isEnrichableName", () => {
  it("returns true for a clean two-part name", () => {
    expect(isEnrichableName("John Smith")).toBe(true);
  });

  it("returns false for emoji names", () => {
    expect(isEnrichableName("🪷 Successful on Paper")).toBe(false);
  });

  it("returns true for names with credentials after cleaning", () => {
    expect(isEnrichableName("Elizabeth Calo, MBA, SPHR")).toBe(true);
    expect(isEnrichableName("Mohamed Kenawy (Mo)")).toBe(true);
    expect(isEnrichableName("Arash Dalir FIEAust CPEng")).toBe(true);
  });

  it("returns false for single-letter first names", () => {
    expect(isEnrichableName("J Smith")).toBe(false);
  });

  it("returns false for names with only a single letter after cleaning", () => {
    // "Laura Ivonne H." — after cleaning still has "H." as last name which fails alpha check
    // Actually "H." contains "." which is not alpha — should return false
    expect(isEnrichableName("Laura Ivonne H.")).toBe(false);
  });

  it("returns true for single-word names (no last name required)", () => {
    expect(isEnrichableName("Madonna")).toBe(true);
  });
});
