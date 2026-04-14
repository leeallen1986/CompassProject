/**
 * roleCategories.test.ts — Tests for PREDEFINED_ROLES role categories
 * Tests the REAL role patterns (not mocked) to verify new categories work correctly
 */

import { describe, it, expect } from "vitest";
import { PREDEFINED_ROLES, getAvailableRoles } from "./hunterContactSearch";

describe("PREDEFINED_ROLES — owner_principal category", () => {
  const patterns = PREDEFINED_ROLES.owner_principal.patterns;
  const matchesAny = (title: string) => patterns.some(p => p.test(title));

  it("should exist with correct display name", () => {
    expect(PREDEFINED_ROLES.owner_principal).toBeDefined();
    expect(PREDEFINED_ROLES.owner_principal.name).toBe("Owner / Principal");
  });

  it("should match Owner titles", () => {
    expect(matchesAny("Owner")).toBe(true);
    expect(matchesAny("Owner/Operator")).toBe(true);
    expect(matchesAny("Business Owner")).toBe(true);
    expect(matchesAny("Company Owner")).toBe(true);
  });

  it("should match Principal titles", () => {
    expect(matchesAny("Principal")).toBe(true);
    expect(matchesAny("Principal Driller")).toBe(true);
    expect(matchesAny("Principal Engineer")).toBe(true);
  });

  it("should match Founder titles", () => {
    expect(matchesAny("Founder")).toBe(true);
    expect(matchesAny("Co-Founder")).toBe(true);
    expect(matchesAny("CoFounder")).toBe(true);
    expect(matchesAny("Founder & Managing Director")).toBe(true);
  });

  it("should match Partner and Proprietor titles", () => {
    expect(matchesAny("Partner")).toBe(true);
    expect(matchesAny("Managing Partner")).toBe(true);
    expect(matchesAny("Proprietor")).toBe(true);
    expect(matchesAny("Sole Proprietor")).toBe(true);
  });

  it("should NOT match unrelated titles", () => {
    expect(matchesAny("Operations Manager")).toBe(false);
    expect(matchesAny("Engineer")).toBe(false);
    expect(matchesAny("Accountant")).toBe(false);
    expect(matchesAny("Receptionist")).toBe(false);
    expect(matchesAny("HR Manager")).toBe(false);
    expect(matchesAny("Marketing Director")).toBe(false);
  });
});

describe("PREDEFINED_ROLES — business_development category", () => {
  const patterns = PREDEFINED_ROLES.business_development.patterns;
  const matchesAny = (title: string) => patterns.some(p => p.test(title));

  it("should exist with correct display name", () => {
    expect(PREDEFINED_ROLES.business_development).toBeDefined();
    expect(PREDEFINED_ROLES.business_development.name).toBe("Business Development");
  });

  it("should match Business Development titles", () => {
    expect(matchesAny("Business Development Manager")).toBe(true);
    expect(matchesAny("Business Development Director")).toBe(true);
    expect(matchesAny("Head of Business Development")).toBe(true);
    expect(matchesAny("VP Business Development")).toBe(true);
  });

  it("should match Contracts titles", () => {
    expect(matchesAny("Contracts Manager")).toBe(true);
    expect(matchesAny("Contract Manager")).toBe(true);
    expect(matchesAny("Contracts Director")).toBe(true);
    expect(matchesAny("Contracts Administrator")).toBe(true);
  });

  it("should match Commercial titles", () => {
    expect(matchesAny("Commercial Manager")).toBe(true);
    expect(matchesAny("Commercial Director")).toBe(true);
  });

  it("should match BD and Tender titles", () => {
    expect(matchesAny("BD Manager")).toBe(true);
    expect(matchesAny("Tender Manager")).toBe(true);
    expect(matchesAny("Tender Coordinator")).toBe(true);
  });

  it("should NOT match unrelated titles", () => {
    expect(matchesAny("Operations Manager")).toBe(false);
    expect(matchesAny("Engineer")).toBe(false);
    expect(matchesAny("Accountant")).toBe(false);
    expect(matchesAny("Driller")).toBe(false);
  });
});

describe("getAvailableRoles — includes all categories", () => {
  it("should include owner_principal in the available roles", () => {
    const roles = getAvailableRoles();
    const ownerRole = roles.find(r => r.key === "owner_principal");
    expect(ownerRole).toBeDefined();
    expect(ownerRole!.name).toBe("Owner / Principal");
  });

  it("should include business_development in the available roles", () => {
    const roles = getAvailableRoles();
    const bdRole = roles.find(r => r.key === "business_development");
    expect(bdRole).toBeDefined();
    expect(bdRole!.name).toBe("Business Development");
  });

  it("should return at least 12 role categories (10 original + 2 new)", () => {
    const roles = getAvailableRoles();
    expect(roles.length).toBeGreaterThanOrEqual(12);
  });

  it("should still include all original role categories", () => {
    const roles = getAvailableRoles();
    const keys = roles.map(r => r.key);
    expect(keys).toContain("operations");
    expect(keys).toContain("fleet_equipment");
    expect(keys).toContain("procurement");
    expect(keys).toContain("project_management");
    expect(keys).toContain("engineering");
    expect(keys).toContain("site_management");
    expect(keys).toContain("rc_driller");
    expect(keys).toContain("blasting");
    expect(keys).toContain("exploration");
    expect(keys).toContain("water_well");
  });
});

describe("Role matching — real-world Australian drilling company titles", () => {
  const allPatterns = Object.values(PREDEFINED_ROLES).flatMap(r => r.patterns);
  const matchesAnyRole = (title: string) => allPatterns.some(p => p.test(title));

  it("should match small drilling company decision-maker titles", () => {
    expect(matchesAnyRole("Owner")).toBe(true);
    expect(matchesAnyRole("Principal")).toBe(true);
    expect(matchesAnyRole("Founder & Managing Director")).toBe(true);
    expect(matchesAnyRole("Owner/Operator")).toBe(true);
  });

  it("should match drilling-specific titles", () => {
    expect(matchesAnyRole("Drill Manager")).toBe(true);
    expect(matchesAnyRole("Senior Driller")).toBe(true);
    expect(matchesAnyRole("Rig Manager")).toBe(true);
    expect(matchesAnyRole("Drilling Superintendent")).toBe(true);
  });

  it("should match fleet and equipment titles", () => {
    expect(matchesAnyRole("Fleet Manager")).toBe(true);
    expect(matchesAnyRole("Equipment Manager")).toBe(true);
    expect(matchesAnyRole("Plant Manager")).toBe(true);
    expect(matchesAnyRole("Workshop Manager")).toBe(true);
  });

  it("should match business development and contracts titles", () => {
    expect(matchesAnyRole("Business Development Manager")).toBe(true);
    expect(matchesAnyRole("Contracts Manager")).toBe(true);
    expect(matchesAnyRole("Commercial Manager")).toBe(true);
    expect(matchesAnyRole("Tender Manager")).toBe(true);
  });
});
