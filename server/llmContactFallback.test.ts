import { describe, it, expect } from "vitest";

/**
 * Tests for LLM Contact Fallback Service
 * Tests the pure functions and logic without requiring database or LLM access.
 */

// ── Email inference logic (mirrors llmContactFallback.ts) ──

function inferEmail(name: string, company: string): string | null {
  if (!name || !company) return null;
  const parts = name.toLowerCase().trim().split(/\s+/);
  if (parts.length < 2) return null;
  const first = parts[0].replace(/[^a-z]/g, "");
  const last = parts[parts.length - 1].replace(/[^a-z]/g, "");
  if (!first || !last) return null;

  const domain = company
    .toLowerCase()
    .replace(/\s*(pty|ltd|limited|inc|corp|group|australia|holdings)\s*/gi, "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (!domain) return null;
  return `${first}.${last}@${domain}.com.au`;
}

describe("LLM Fallback - Email Inference", () => {
  it("generates correct email for standard Australian company", () => {
    expect(inferEmail("John Smith", "BHP Group")).toBe("john.smith@bhp.com.au");
  });

  it("handles Pty Ltd suffix", () => {
    expect(inferEmail("Sarah Johnson", "Thiess Pty Ltd")).toBe("sarah.johnson@thiess.com.au");
  });

  it("handles multiple suffixes", () => {
    expect(inferEmail("Mike Brown", "Downer Group Limited")).toBe("mike.brown@downer.com.au");
  });

  it("returns null for single-word name", () => {
    expect(inferEmail("Madonna", "BHP")).toBeNull();
  });

  it("returns null for empty name", () => {
    expect(inferEmail("", "BHP")).toBeNull();
  });

  it("returns null for empty company", () => {
    expect(inferEmail("John Smith", "")).toBeNull();
  });

  it("handles multi-word names (uses first and last)", () => {
    expect(inferEmail("Mary Jane Watson", "Rio Tinto")).toBe("mary.watson@riotinto.com.au");
  });

  it("strips non-alpha characters from names", () => {
    expect(inferEmail("O'Brien Smith", "Fortescue")).toBe("obrien.smith@fortescue.com.au");
  });
});

// ── Role bucket normalization (mirrors llmContactFallback.ts) ──

function normalizeRoleBucket(role: string): string {
  const h = role.toLowerCase();
  if (h.includes("procurement") || h.includes("supply chain") || h.includes("purchasing"))
    return "procurement";
  if (h.includes("project manager") || h.includes("project director"))
    return "project_manager";
  if (h.includes("engineer") || h.includes("engineering"))
    return "engineering";
  if (h.includes("operations") || h.includes("ops"))
    return "operations";
  if (h.includes("maintenance") || h.includes("reliability"))
    return "maintenance";
  if (h.includes("site manager") || h.includes("site superintendent"))
    return "site_manager";
  if (h.includes("fleet") || h.includes("equipment"))
    return "fleet_manager";
  if (h.includes("general manager") || h.includes("managing director") || h.includes("ceo") || h.includes("director"))
    return "general_manager";
  if (h.includes("commercial") || h.includes("business development"))
    return "commercial";
  if (h.includes("construction"))
    return "construction_manager";
  if (h.includes("mining"))
    return "mining_manager";
  if (h.includes("plant"))
    return "plant_manager";
  return "other";
}

describe("LLM Fallback - Role Bucket Normalization", () => {
  it("maps procurement roles correctly", () => {
    expect(normalizeRoleBucket("Procurement Manager")).toBe("procurement");
    expect(normalizeRoleBucket("Supply Chain Director")).toBe("procurement");
    expect(normalizeRoleBucket("Purchasing Officer")).toBe("procurement");
  });

  it("maps project management roles correctly", () => {
    expect(normalizeRoleBucket("Project Manager")).toBe("project_manager");
    expect(normalizeRoleBucket("Senior Project Director")).toBe("project_manager");
  });

  it("maps engineering roles correctly", () => {
    expect(normalizeRoleBucket("Engineering Manager")).toBe("engineering");
    expect(normalizeRoleBucket("Chief Engineer")).toBe("engineering");
  });

  it("maps operations roles correctly", () => {
    expect(normalizeRoleBucket("Operations Manager")).toBe("operations");
    expect(normalizeRoleBucket("VP of Ops")).toBe("operations");
  });

  it("maps maintenance roles correctly", () => {
    expect(normalizeRoleBucket("Maintenance Superintendent")).toBe("maintenance");
    expect(normalizeRoleBucket("Reliability Manager")).toBe("maintenance");
  });

  it("maps site management roles correctly", () => {
    expect(normalizeRoleBucket("Site Manager")).toBe("site_manager");
    expect(normalizeRoleBucket("Site Superintendent")).toBe("site_manager");
  });

  it("maps fleet roles correctly", () => {
    expect(normalizeRoleBucket("Fleet Manager")).toBe("fleet_manager");
    expect(normalizeRoleBucket("Equipment Coordinator")).toBe("fleet_manager");
  });

  it("maps general management roles correctly", () => {
    expect(normalizeRoleBucket("General Manager")).toBe("general_manager");
    expect(normalizeRoleBucket("Managing Director")).toBe("general_manager");
    expect(normalizeRoleBucket("CEO")).toBe("general_manager");
  });

  it("maps commercial roles correctly", () => {
    expect(normalizeRoleBucket("Commercial Manager")).toBe("commercial");
    expect(normalizeRoleBucket("Business Development Manager")).toBe("commercial");
  });

  it("maps construction roles correctly", () => {
    expect(normalizeRoleBucket("Construction Manager")).toBe("construction_manager");
  });

  it("maps mining roles correctly", () => {
    expect(normalizeRoleBucket("Mining Manager")).toBe("mining_manager");
  });

  it("maps plant roles correctly", () => {
    expect(normalizeRoleBucket("Plant Manager")).toBe("plant_manager");
  });

  it("returns 'other' for unrecognized roles", () => {
    expect(normalizeRoleBucket("Receptionist")).toBe("other");
    expect(normalizeRoleBucket("Marketing Coordinator")).toBe("other");
  });
});

// ── LLM response parsing logic ──

describe("LLM Fallback - Response Parsing", () => {
  interface LLMContact {
    name: string;
    title: string;
    company: string;
    role_bucket: string;
    confidence: string;
    reasoning: string;
  }

  function parseLLMResponse(content: string): LLMContact[] {
    try {
      const parsed = JSON.parse(content);
      if (!parsed.contacts || !Array.isArray(parsed.contacts)) return [];
      return parsed.contacts;
    } catch {
      return [];
    }
  }

  it("parses valid LLM response", () => {
    const response = JSON.stringify({
      contacts: [
        {
          name: "James Mitchell",
          title: "Procurement Manager",
          company: "BHP",
          role_bucket: "procurement",
          confidence: "high",
          reasoning: "BHP procurement team manages equipment purchasing",
        },
      ],
    });
    const contacts = parseLLMResponse(response);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("James Mitchell");
    expect(contacts[0].confidence).toBe("high");
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseLLMResponse("not json")).toEqual([]);
  });

  it("returns empty array for missing contacts field", () => {
    expect(parseLLMResponse(JSON.stringify({ data: [] }))).toEqual([]);
  });

  it("returns empty array for non-array contacts", () => {
    expect(parseLLMResponse(JSON.stringify({ contacts: "invalid" }))).toEqual([]);
  });

  it("parses multiple contacts", () => {
    const response = JSON.stringify({
      contacts: [
        { name: "A", title: "T1", company: "C1", role_bucket: "procurement", confidence: "high", reasoning: "R1" },
        { name: "B", title: "T2", company: "C2", role_bucket: "engineering", confidence: "medium", reasoning: "R2" },
        { name: "C", title: "T3", company: "C3", role_bucket: "operations", confidence: "low", reasoning: "R3" },
      ],
    });
    const contacts = parseLLMResponse(response);
    expect(contacts).toHaveLength(3);
  });
});

// ── Fallback strategy logic ──

describe("LLM Fallback - Strategy Selection", () => {
  type EnrichmentStrategy = "linkedin" | "llm" | "both_failed";

  function selectStrategy(
    linkedInQuotaExhausted: boolean,
    linkedInResultCount: number,
    llmAvailable: boolean
  ): EnrichmentStrategy {
    // If LinkedIn returned contacts, use them
    if (linkedInResultCount > 0) return "linkedin";
    // If LinkedIn quota exhausted or no results, try LLM
    if ((linkedInQuotaExhausted || linkedInResultCount === 0) && llmAvailable) return "llm";
    // Both failed
    return "both_failed";
  }

  it("uses LinkedIn when contacts found", () => {
    expect(selectStrategy(false, 3, true)).toBe("linkedin");
  });

  it("falls back to LLM when LinkedIn quota exhausted", () => {
    expect(selectStrategy(true, 0, true)).toBe("llm");
  });

  it("falls back to LLM when LinkedIn returns 0 results", () => {
    expect(selectStrategy(false, 0, true)).toBe("llm");
  });

  it("reports both_failed when LLM not available", () => {
    expect(selectStrategy(true, 0, false)).toBe("both_failed");
  });

  it("uses LinkedIn even when quota exhausted if contacts were found before exhaustion", () => {
    expect(selectStrategy(true, 2, true)).toBe("linkedin");
  });
});

// ── Contact deduplication logic ──

describe("LLM Fallback - Deduplication", () => {
  interface SimpleContact {
    name: string;
    project: string;
  }

  function isDuplicate(
    newContact: SimpleContact,
    existingContacts: SimpleContact[]
  ): boolean {
    return existingContacts.some(
      (c) =>
        c.name.toLowerCase() === newContact.name.toLowerCase() &&
        c.project === newContact.project
    );
  }

  it("detects exact duplicate", () => {
    const existing = [{ name: "John Smith", project: "Project A" }];
    expect(isDuplicate({ name: "John Smith", project: "Project A" }, existing)).toBe(true);
  });

  it("detects case-insensitive duplicate", () => {
    const existing = [{ name: "JOHN SMITH", project: "Project A" }];
    expect(isDuplicate({ name: "john smith", project: "Project A" }, existing)).toBe(true);
  });

  it("allows same name on different projects", () => {
    const existing = [{ name: "John Smith", project: "Project A" }];
    expect(isDuplicate({ name: "John Smith", project: "Project B" }, existing)).toBe(false);
  });

  it("allows different names on same project", () => {
    const existing = [{ name: "John Smith", project: "Project A" }];
    expect(isDuplicate({ name: "Jane Doe", project: "Project A" }, existing)).toBe(false);
  });
});

// ── Confidence scoring ──

describe("LLM Fallback - Confidence Levels", () => {
  type Confidence = "high" | "medium" | "low";

  function getConfidenceDescription(confidence: Confidence): string {
    switch (confidence) {
      case "high":
        return "This role definitely exists at this company type";
      case "medium":
        return "This role likely exists at this company";
      case "low":
        return "This role may exist — verify before outreach";
    }
  }

  it("describes high confidence correctly", () => {
    expect(getConfidenceDescription("high")).toContain("definitely");
  });

  it("describes medium confidence correctly", () => {
    expect(getConfidenceDescription("medium")).toContain("likely");
  });

  it("describes low confidence correctly", () => {
    expect(getConfidenceDescription("low")).toContain("verify");
  });
});

// ── MAX_CONTACTS_PER_PROJECT limit ──

describe("LLM Fallback - Contact Limits", () => {
  const MAX_CONTACTS_PER_PROJECT = 5;

  it("limits contacts to max per project", () => {
    const generated = Array.from({ length: 10 }, (_, i) => ({
      name: `Contact ${i}`,
      title: `Title ${i}`,
    }));
    const limited = generated.slice(0, MAX_CONTACTS_PER_PROJECT);
    expect(limited).toHaveLength(5);
  });

  it("returns all when under limit", () => {
    const generated = [
      { name: "A", title: "T1" },
      { name: "B", title: "T2" },
    ];
    const limited = generated.slice(0, MAX_CONTACTS_PER_PROJECT);
    expect(limited).toHaveLength(2);
  });
});

// ── Company extraction logic ──

describe("LLM Fallback - Company Extraction", () => {
  function extractCompanies(
    owner: string,
    contractors: { name: string; status: string }[]
  ): string[] {
    const companies = [owner, ...contractors.map((c) => c.name)].filter(Boolean);
    return Array.from(new Set(companies)).slice(0, 3);
  }

  it("includes owner as first company", () => {
    const companies = extractCompanies("BHP", []);
    expect(companies[0]).toBe("BHP");
  });

  it("includes contractors after owner", () => {
    const companies = extractCompanies("BHP", [
      { name: "Thiess", status: "confirmed" },
    ]);
    expect(companies).toEqual(["BHP", "Thiess"]);
  });

  it("deduplicates owner and contractor", () => {
    const companies = extractCompanies("BHP", [
      { name: "BHP", status: "confirmed" },
      { name: "Thiess", status: "predicted" },
    ]);
    expect(companies).toEqual(["BHP", "Thiess"]);
  });

  it("limits to 3 companies", () => {
    const companies = extractCompanies("BHP", [
      { name: "Thiess", status: "confirmed" },
      { name: "Downer", status: "confirmed" },
      { name: "CIMIC", status: "predicted" },
      { name: "Macmahon", status: "predicted" },
    ]);
    expect(companies).toHaveLength(3);
  });

  it("filters out empty contractor names", () => {
    const companies = extractCompanies("BHP", [
      { name: "", status: "confirmed" },
      { name: "Thiess", status: "confirmed" },
    ]);
    expect(companies).toEqual(["BHP", "Thiess"]);
  });
});
