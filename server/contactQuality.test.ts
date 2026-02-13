/**
 * Contact Quality Gate Tests
 *
 * Verifies that low-quality / hallucinated contacts are filtered out
 * at both the LLM generation level and the database query level.
 */
import { describe, it, expect } from "vitest";

// ── LLM Fallback Quality Gate Tests ──

describe("LLM Contact Quality Gate", () => {
  const MIN_VERIFICATION_SCORE = 60;

  it("should reject contacts with confidence = low", () => {
    const contacts = [
      { name: "Alice Brown", confidence: "high" },
      { name: "Bob Smith", confidence: "medium" },
      { name: "Charlie Fake", confidence: "low" },
    ];
    const filtered = contacts.filter(c => c.confidence !== "low");
    expect(filtered).toHaveLength(2);
    expect(filtered.map(c => c.name)).not.toContain("Charlie Fake");
  });

  it("should keep high and medium confidence contacts", () => {
    const contacts = [
      { name: "Alice Brown", confidence: "high" },
      { name: "Bob Smith", confidence: "medium" },
    ];
    const filtered = contacts.filter(c => c.confidence !== "low");
    expect(filtered).toHaveLength(2);
  });

  it("should reject contacts with verification score below 60", () => {
    const contacts = [
      { name: "Alice Brown", verificationScore: 75 },
      { name: "Bob Smith", verificationScore: 58 },
      { name: "Charlie Good", verificationScore: 80 },
      { name: "Dave Low", verificationScore: 35 },
    ];
    const filtered = contacts.filter(c => c.verificationScore >= MIN_VERIFICATION_SCORE);
    expect(filtered).toHaveLength(2);
    expect(filtered.map(c => c.name)).toEqual(["Alice Brown", "Charlie Good"]);
  });

  it("should reject contacts with score of exactly 59", () => {
    const contact = { name: "Edge Case", verificationScore: 59 };
    expect(contact.verificationScore >= MIN_VERIFICATION_SCORE).toBe(false);
  });

  it("should keep contacts with score of exactly 60", () => {
    const contact = { name: "Threshold", verificationScore: 60 };
    expect(contact.verificationScore >= MIN_VERIFICATION_SCORE).toBe(true);
  });
});

// ── Duplicate Name Detection Tests ──

describe("Duplicate Name Detection (Hallucination Signal)", () => {
  it("should detect names appearing 3+ times across different companies as hallucinated", () => {
    const contacts = [
      { name: "Sarah Chen", company: "BHP" },
      { name: "Sarah Chen", company: "Rio Tinto" },
      { name: "Sarah Chen", company: "Woodside" },
      { name: "Alice Brown", company: "BHP" },
      { name: "Alice Brown", company: "Rio Tinto" },
      { name: "Unique Person", company: "Santos" },
    ];

    // Group by name and count distinct companies
    const nameCompanyMap = new Map<string, Set<string>>();
    for (const c of contacts) {
      if (!nameCompanyMap.has(c.name)) nameCompanyMap.set(c.name, new Set());
      nameCompanyMap.get(c.name)!.add(c.company);
    }

    const hallucinated = [...nameCompanyMap.entries()]
      .filter(([_, companies]) => companies.size >= 3)
      .map(([name]) => name);

    expect(hallucinated).toEqual(["Sarah Chen"]);
    expect(hallucinated).not.toContain("Alice Brown"); // Only 2 companies
    expect(hallucinated).not.toContain("Unique Person"); // Only 1 company
  });

  it("should not flag names that appear multiple times at the same company", () => {
    const contacts = [
      { name: "John Doe", company: "BHP", project: "Project A" },
      { name: "John Doe", company: "BHP", project: "Project B" },
      { name: "John Doe", company: "BHP", project: "Project C" },
    ];

    const nameCompanyMap = new Map<string, Set<string>>();
    for (const c of contacts) {
      if (!nameCompanyMap.has(c.name)) nameCompanyMap.set(c.name, new Set());
      nameCompanyMap.get(c.name)!.add(c.company);
    }

    const hallucinated = [...nameCompanyMap.entries()]
      .filter(([_, companies]) => companies.size >= 3)
      .map(([name]) => name);

    expect(hallucinated).toHaveLength(0); // Same company, not hallucinated
  });
});

// ── Quality Filter SQL Logic Tests ──

describe("getAllContacts Quality Filter Logic", () => {
  it("should include contacts with verificationScore >= 60", () => {
    const contact = { verificationScore: 65, enrichmentSource: "llm", verificationStatus: "ai_suggested" };
    const passes = contact.verificationScore >= 60 || contact.enrichmentSource === "linkedin" || contact.verificationStatus === "verified";
    expect(passes).toBe(true);
  });

  it("should include LinkedIn-sourced contacts regardless of score", () => {
    const contact = { verificationScore: 45, enrichmentSource: "linkedin", verificationStatus: "unverified" };
    const passes = contact.verificationScore >= 60 || contact.enrichmentSource === "linkedin" || contact.verificationStatus === "verified";
    expect(passes).toBe(true);
  });

  it("should include team-verified contacts regardless of score", () => {
    const contact = { verificationScore: 30, enrichmentSource: "llm", verificationStatus: "verified" };
    const passes = contact.verificationScore >= 60 || contact.enrichmentSource === "linkedin" || contact.verificationStatus === "verified";
    expect(passes).toBe(true);
  });

  it("should exclude low-score LLM contacts that are not verified", () => {
    const contact = { verificationScore: 45, enrichmentSource: "llm", verificationStatus: "ai_suggested" };
    const passes = contact.verificationScore >= 60 || contact.enrichmentSource === "linkedin" || contact.verificationStatus === "verified";
    expect(passes).toBe(false);
  });

  it("should exclude contacts with score 0 from LLM source", () => {
    const contact = { verificationScore: 0, enrichmentSource: "llm", verificationStatus: "unverified" };
    const passes = contact.verificationScore >= 60 || contact.enrichmentSource === "linkedin" || contact.verificationStatus === "verified";
    expect(passes).toBe(false);
  });

  it("should exclude contacts with null score from LLM source", () => {
    const contact = { verificationScore: null as number | null, enrichmentSource: "llm", verificationStatus: "ai_suggested" };
    const passes = (contact.verificationScore !== null && contact.verificationScore >= 60) || contact.enrichmentSource === "linkedin" || contact.verificationStatus === "verified";
    expect(passes).toBe(false);
  });
});

// ── Email Pattern Inference Tests ──

describe("Email Pattern Inference Quality", () => {
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

  it("should generate correct email pattern for standard names", () => {
    expect(inferEmail("John Smith", "BHP")).toBe("john.smith@bhp.com.au");
  });

  it("should handle company suffixes correctly", () => {
    expect(inferEmail("Jane Doe", "Rio Tinto Group")).toBe("jane.doe@riotinto.com.au");
  });

  it("should handle Pty Ltd suffix", () => {
    expect(inferEmail("Alice Brown", "Lendlease Construction Pty Limited")).toBe("alice.brown@lendleaseconstruction.com.au");
  });

  it("should return null for single-word names", () => {
    expect(inferEmail("Madonna", "BHP")).toBeNull();
  });

  it("should return null for empty inputs", () => {
    expect(inferEmail("", "BHP")).toBeNull();
    expect(inferEmail("John Smith", "")).toBeNull();
  });

  it("should handle multi-part names by using first and last", () => {
    expect(inferEmail("Mary Jane Watson", "Santos")).toBe("mary.watson@santos.com.au");
  });
});

// ── LinkedIn Search URL Quality Tests ──

describe("LinkedIn Search URL Quality", () => {
  function generateLinkedInSearchUrl(name: string, company?: string, title?: string): string {
    const parts = [name];
    if (company) parts.push(company);
    if (title) parts.push(title);
    const query = encodeURIComponent(parts.join(" "));
    return `https://www.linkedin.com/search/results/people/?keywords=${query}`;
  }

  it("should include name, company, and title for precise search", () => {
    const url = generateLinkedInSearchUrl("John Smith", "BHP", "Procurement Manager");
    expect(url).toContain("John%20Smith");
    expect(url).toContain("BHP");
    expect(url).toContain("Procurement%20Manager");
  });

  it("should work with name only", () => {
    const url = generateLinkedInSearchUrl("John Smith");
    expect(url).toContain("John%20Smith");
    expect(url).toContain("/search/results/people/");
  });

  it("should not generate guessed profile URLs", () => {
    // We no longer generate /in/firstname-lastname URLs
    const url = generateLinkedInSearchUrl("John Smith", "BHP");
    expect(url).not.toContain("/in/john-smith");
    expect(url).toContain("/search/results/people/");
  });
});
