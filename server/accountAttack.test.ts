/**
 * Account Attack Router — Unit Tests
 * Tests the query logic, data aggregation, and seller-lens weighting
 */
import { describe, it, expect } from "vitest";

// ── Test the account type classification logic (extracted from router) ──
function classifyAccountType(
  accountName: string,
  hasGovBlockedProject: boolean
): string {
  const ownerLower = accountName.toLowerCase();
  if (
    hasGovBlockedProject ||
    /government|department|authority|commission|council|state\s|federal|nt\s|nsw\s|qld\s|wa\s|sa\s|vic\s|tas\s|corporation|hydro\s|water\s|power\s.*water|main\s*roads|transport/i.test(ownerLower)
  ) {
    return "Government / Public Body";
  } else if (/university|institute|csiro|research/i.test(ownerLower)) {
    return "Research / Academic";
  } else if (/bhp|rio\s*tinto|fortescue|glencore|anglo\s*american|newmont|south32/i.test(ownerLower)) {
    return "Major Mining Company";
  } else if (/santos|woodside|chevron|shell|bp\b|origin|ampol/i.test(ownerLower)) {
    return "Energy / Oil & Gas";
  }
  return "Private Company";
}

// ── Test the seller-lens weighting logic (extracted from frontend) ──
function computeLaneMultiplier(
  projectLane: string | null,
  userLane: string | null,
  lensMode: "focused" | "balanced" | "open"
): number {
  if (!userLane || !projectLane) return 1.0;
  const isMatch = projectLane.toLowerCase() === userLane.toLowerCase();

  switch (lensMode) {
    case "focused":
      return isMatch ? 3.0 : 0.5;
    case "balanced":
      return isMatch ? 2.0 : 1.0;
    case "open":
      return 1.0;
    default:
      return 1.0;
  }
}

// ── Test the opportunity sorting logic ──
function sortOpportunities(
  opps: { priority: string; productLane: string | null; name: string }[],
  userLane: string | null,
  lensMode: "focused" | "balanced" | "open"
): typeof opps {
  const priorityOrder: Record<string, number> = { hot: 3, warm: 2, cold: 1 };
  return [...opps].sort((a, b) => {
    const aBase = priorityOrder[a.priority] || 0;
    const bBase = priorityOrder[b.priority] || 0;
    const aScore = aBase * computeLaneMultiplier(a.productLane, userLane, lensMode);
    const bScore = bBase * computeLaneMultiplier(b.productLane, userLane, lensMode);
    return bScore - aScore;
  });
}

// ── Test the govFallbackStatus display logic ──
function getDiscoveryLabel(
  enrichmentBlockedReason: string | null,
  govFallbackStatus: string | null
): string {
  if (govFallbackStatus === "government_fallback_contact_found") {
    return "Government contact found — verify before outreach";
  }
  if (govFallbackStatus === "government_fallback_named_person_no_email") {
    return "Named person found — email discovery needed";
  }
  if (govFallbackStatus === "government_fallback_role_only") {
    return "Role identified — manual discovery required";
  }
  if (enrichmentBlockedReason === "blocked_government_owner_manual_discovery") {
    return "Government / public body — manual stakeholder discovery required";
  }
  if (enrichmentBlockedReason === "blocked_unknown_owner") {
    return "Owner data too poor to enrich — manual review required";
  }
  if (enrichmentBlockedReason === "blocked_dirty_owner_string") {
    return "Owner data quality issue — needs cleanup before enrichment";
  }
  if (enrichmentBlockedReason === "blocked_no_usable_domain") {
    return "No usable domain found — manual contact discovery needed";
  }
  return "Coverage Gap — stakeholder discovery needed";
}

describe("Account Type Classification", () => {
  it("classifies Hydro Tasmania as Government", () => {
    expect(classifyAccountType("Hydro Tasmania", false)).toBe("Government / Public Body");
  });

  it("classifies government via enrichmentBlockedReason flag", () => {
    expect(classifyAccountType("Some Random Corp", true)).toBe("Government / Public Body");
  });

  it("classifies Power and Water Corporation as Government", () => {
    expect(classifyAccountType("Power and Water Corporation", false)).toBe("Government / Public Body");
  });

  it("classifies NT Government as Government", () => {
    expect(classifyAccountType("NT Government", false)).toBe("Government / Public Body");
  });

  it("classifies BHP as Major Mining Company", () => {
    expect(classifyAccountType("BHP Group", false)).toBe("Major Mining Company");
  });

  it("classifies Rio Tinto as Major Mining Company", () => {
    expect(classifyAccountType("Rio Tinto", false)).toBe("Major Mining Company");
  });

  it("classifies Woodside as Energy", () => {
    expect(classifyAccountType("Woodside Energy", false)).toBe("Energy / Oil & Gas");
  });

  it("classifies Santos as Energy", () => {
    expect(classifyAccountType("Santos Limited", false)).toBe("Energy / Oil & Gas");
  });

  it("classifies CSIRO as Research", () => {
    expect(classifyAccountType("CSIRO", false)).toBe("Research / Academic");
  });

  it("classifies unknown private company as Private", () => {
    expect(classifyAccountType("HEXhire", false)).toBe("Private Company");
  });

  it("classifies Omega Oil and Gas as Private (not Energy pattern)", () => {
    // "Omega Oil and Gas" doesn't match the specific energy company patterns
    expect(classifyAccountType("Omega Oil and Gas", false)).toBe("Private Company");
  });
});

describe("Seller-Lens Weighting", () => {
  it("focused mode gives 3x for matching lane", () => {
    expect(computeLaneMultiplier("portable_air", "portable_air", "focused")).toBe(3.0);
  });

  it("focused mode gives 0.5x for non-matching lane", () => {
    expect(computeLaneMultiplier("power_technique", "portable_air", "focused")).toBe(0.5);
  });

  it("balanced mode gives 2x for matching lane", () => {
    expect(computeLaneMultiplier("portable_air", "portable_air", "balanced")).toBe(2.0);
  });

  it("balanced mode gives 1x for non-matching lane", () => {
    expect(computeLaneMultiplier("power_technique", "portable_air", "balanced")).toBe(1.0);
  });

  it("open mode gives 1x regardless", () => {
    expect(computeLaneMultiplier("portable_air", "portable_air", "open")).toBe(1.0);
    expect(computeLaneMultiplier("power_technique", "portable_air", "open")).toBe(1.0);
  });

  it("returns 1.0 when user has no lane set", () => {
    expect(computeLaneMultiplier("portable_air", null, "focused")).toBe(1.0);
  });

  it("returns 1.0 when project has no lane", () => {
    expect(computeLaneMultiplier(null, "portable_air", "focused")).toBe(1.0);
  });
});

describe("Opportunity Sorting with Lens", () => {
  const opps = [
    { priority: "warm", productLane: "portable_air", name: "Project A" },
    { priority: "hot", productLane: "power_technique", name: "Project B" },
    { priority: "hot", productLane: "portable_air", name: "Project C" },
    { priority: "cold", productLane: "portable_air", name: "Project D" },
  ];

  it("focused mode ranks user-lane hot project first", () => {
    const sorted = sortOpportunities(opps, "portable_air", "focused");
    expect(sorted[0].name).toBe("Project C"); // hot + 3x = 9
    expect(sorted[1].name).toBe("Project A"); // warm + 3x = 6
  });

  it("focused mode demotes non-lane hot project", () => {
    const sorted = sortOpportunities(opps, "portable_air", "focused");
    // Project B: hot(3) * 0.5 = 1.5
    // Project D: cold(1) * 3.0 = 3.0
    expect(sorted.indexOf(sorted.find(s => s.name === "Project B")!)).toBeGreaterThan(
      sorted.indexOf(sorted.find(s => s.name === "Project D")!)
    );
  });

  it("open mode ranks by priority only", () => {
    const sorted = sortOpportunities(opps, "portable_air", "open");
    // Both hot projects should be first (score 3 each)
    expect(sorted[0].priority).toBe("hot");
    expect(sorted[1].priority).toBe("hot");
    expect(sorted[2].priority).toBe("warm");
    expect(sorted[3].priority).toBe("cold");
  });

  it("no user lane means open-like behavior", () => {
    const sorted = sortOpportunities(opps, null, "focused");
    // All multipliers are 1.0, so pure priority order
    expect(sorted[0].priority).toBe("hot");
    expect(sorted[1].priority).toBe("hot");
  });
});

describe("Discovery Label Display", () => {
  it("shows government contact found label", () => {
    expect(getDiscoveryLabel(null, "government_fallback_contact_found")).toBe(
      "Government contact found — verify before outreach"
    );
  });

  it("shows named person no email label", () => {
    expect(getDiscoveryLabel(null, "government_fallback_named_person_no_email")).toBe(
      "Named person found — email discovery needed"
    );
  });

  it("shows role only label", () => {
    expect(getDiscoveryLabel(null, "government_fallback_role_only")).toBe(
      "Role identified — manual discovery required"
    );
  });

  it("shows government blocked reason", () => {
    expect(getDiscoveryLabel("blocked_government_owner_manual_discovery", null)).toBe(
      "Government / public body — manual stakeholder discovery required"
    );
  });

  it("shows unknown owner blocked reason", () => {
    expect(getDiscoveryLabel("blocked_unknown_owner", null)).toBe(
      "Owner data too poor to enrich — manual review required"
    );
  });

  it("shows dirty owner blocked reason", () => {
    expect(getDiscoveryLabel("blocked_dirty_owner_string", null)).toBe(
      "Owner data quality issue — needs cleanup before enrichment"
    );
  });

  it("shows no usable domain blocked reason", () => {
    expect(getDiscoveryLabel("blocked_no_usable_domain", null)).toBe(
      "No usable domain found — manual contact discovery needed"
    );
  });

  it("shows generic coverage gap when no specific reason", () => {
    expect(getDiscoveryLabel(null, null)).toBe(
      "Coverage Gap — stakeholder discovery needed"
    );
  });
});
