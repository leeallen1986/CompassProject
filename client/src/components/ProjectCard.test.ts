import { describe, it, expect } from "vitest";

/**
 * Tests for the contact matching and ranking logic used in ProjectCard.
 * We replicate the core logic here since the functions are not exported from the component.
 */

// ── Replicate the core matching logic from ProjectCard.tsx ──

const STOP_WORDS = new Set(["the", "a", "an", "of", "in", "for", "and", "or", "to", "at", "by", "on", "is", "—", "-", "/"]);

function extractKeywords(text: string): string[] {
  return text.toLowerCase().split(/[\s/—\-–,()]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function hasKeywordOverlap(a: string, b: string): boolean {
  const kwA = extractKeywords(a);
  const kwB = extractKeywords(b);
  if (kwA.length === 0 || kwB.length === 0) return false;
  const shared = kwA.filter(w => kwB.some(bw => bw.includes(w) || w.includes(bw)));
  return shared.length >= 2 || (shared.length >= 1 && kwA.length <= 2);
}

interface TestContact {
  id: number;
  name: string;
  title: string;
  company: string;
  project: string;
  priority: "hot" | "warm" | "cold";
  roleBucket: string;
  email: string | null;
  linkedin: string | null;
  enrichmentSource?: string | null;
  verificationStatus?: string | null;
  confidenceScore?: string | null;
  linkedinSearchUrl?: string | null;
  emailVerified?: boolean | null;
  linkedinProfilePic?: string | null;
  verificationScore?: number | null;
  linkedinProfileUrl?: string | null;
}

function findProjectContacts(
  projectName: string,
  projectOwner: string,
  allContacts: TestContact[],
  buyerRoles?: string[] | null,
  limit: number = 5,
): TestContact[] {
  const projectNameLower = projectName.toLowerCase();
  const ownerLower = projectOwner.toLowerCase();
  const ownerParts = ownerLower.split(/[/&,]+/).map(s => s.trim()).filter(Boolean);

  const projectContacts = allContacts.filter(c => {
    const cProject = c.project.toLowerCase();
    const cCompany = c.company.toLowerCase();
    if (cProject.includes(projectNameLower) || projectNameLower.includes(cProject)) return true;
    if (hasKeywordOverlap(cProject, projectNameLower)) return true;
    if (ownerParts.some(op => cCompany.includes(op) || op.includes(cCompany))) return true;
    if (projectNameLower.includes(cCompany) && cCompany.length > 3) return true;
    return false;
  });

  if (projectContacts.length === 0) return [];

  // Deduplicate by name+company
  const seen = new Map<string, TestContact>();
  for (const c of projectContacts) {
    const key = `${c.name.toLowerCase()}|${c.company.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || (c.verificationScore ?? 0) > (existing.verificationScore ?? 0)) {
      seen.set(key, c);
    }
  }
  const deduped = Array.from(seen.values());

  const priorityScore = { hot: 3, warm: 2, cold: 1 };
  const scored = deduped.map(c => {
    let score = priorityScore[c.priority] || 0;
    if (buyerRoles && buyerRoles.length > 0) {
      const roleLower = c.roleBucket.toLowerCase();
      if (buyerRoles.some(r => roleLower.includes(r.toLowerCase()))) score += 10;
    }
    score += ((c.verificationScore ?? 0) / 20);
    if (c.email) score += 5;
    const cProject = c.project.toLowerCase();
    if (projectNameLower.includes(cProject) || cProject.includes(projectNameLower)) score += 3;
    if (c.verificationStatus === "verified") score += 8;
    return { contact: c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.contact);
}

// ── Test data ──

const makeContact = (overrides: Partial<TestContact> = {}): TestContact => ({
  id: 1,
  name: "John Smith",
  title: "Mining Engineer",
  company: "BHP",
  project: "BHP Iron Ore Expansion",
  priority: "hot",
  roleBucket: "engineering",
  email: "john.smith@bhp.com",
  linkedin: null,
  enrichmentSource: "llm",
  verificationStatus: "ai_suggested",
  confidenceScore: "medium",
  linkedinSearchUrl: null,
  emailVerified: false,
  linkedinProfilePic: null,
  verificationScore: 55,
  linkedinProfileUrl: "https://linkedin.com/in/john-smith",
  ...overrides,
});

describe("findProjectContacts", () => {
  it("returns empty array when no contacts match", () => {
    const contacts = [makeContact({ project: "Totally Unrelated Project", company: "Unrelated Corp" })];
    const result = findProjectContacts("BHP Iron Ore Expansion", "BHP", contacts);
    expect(result).toHaveLength(0);
  });

  it("matches contacts by direct project name substring", () => {
    const contacts = [makeContact({ project: "BHP Iron Ore Expansion" })];
    const result = findProjectContacts("BHP Iron Ore Expansion", "BHP", contacts);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("John Smith");
  });

  it("matches contacts by company/owner match", () => {
    const contacts = [makeContact({ project: "Some Other Project", company: "BHP" })];
    const result = findProjectContacts("BHP Iron Ore Expansion", "BHP", contacts);
    expect(result).toHaveLength(1);
  });

  it("matches contacts by keyword overlap", () => {
    const contacts = [makeContact({ project: "Rio Tinto Pilbara Maintenance", company: "Monadelphous" })];
    const result = findProjectContacts("Monadelphous Rio Tinto Pilbara Maintenance Services", "Rio Tinto", contacts);
    expect(result).toHaveLength(1);
  });

  it("ranks verified contacts higher than AI-suggested", () => {
    const contacts = [
      makeContact({ id: 1, name: "AI Contact", verificationStatus: "ai_suggested", verificationScore: 55 }),
      makeContact({ id: 2, name: "Verified Contact", verificationStatus: "verified", verificationScore: 90 }),
    ];
    const result = findProjectContacts("BHP Iron Ore Expansion", "BHP", contacts);
    expect(result[0].name).toBe("Verified Contact");
  });

  it("ranks contacts with preferred buyer roles higher", () => {
    const contacts = [
      makeContact({ id: 1, name: "Engineer", roleBucket: "engineering" }),
      makeContact({ id: 2, name: "Procurement Lead", roleBucket: "procurement" }),
    ];
    const result = findProjectContacts("BHP Iron Ore Expansion", "BHP", contacts, ["procurement"]);
    expect(result[0].name).toBe("Procurement Lead");
  });

  it("deduplicates contacts by name+company", () => {
    const contacts = [
      makeContact({ id: 1, name: "John Smith", company: "BHP", project: "BHP Project A", verificationScore: 55 }),
      makeContact({ id: 2, name: "John Smith", company: "BHP", project: "BHP Project B", verificationScore: 80 }),
    ];
    const result = findProjectContacts("BHP Iron Ore Expansion", "BHP", contacts);
    expect(result).toHaveLength(1);
    // Should keep the one with higher verification score
    expect(result[0].verificationScore).toBe(80);
  });

  it("respects the limit parameter", () => {
    const contacts = Array.from({ length: 10 }, (_, i) =>
      makeContact({ id: i + 1, name: `Contact ${i + 1}`, project: "BHP Iron Ore Expansion" })
    );
    const result = findProjectContacts("BHP Iron Ore Expansion", "BHP", contacts, null, 3);
    expect(result).toHaveLength(3);
  });

  it("handles multi-owner projects (slash-separated)", () => {
    const contacts = [
      makeContact({ id: 1, name: "Santos Contact", company: "Santos", project: "Santos LNG" }),
      makeContact({ id: 2, name: "BW Contact", company: "BW Offshore", project: "BW Offshore FPSO" }),
    ];
    const result = findProjectContacts("Joint Venture FPSO", "Santos / BW Offshore", contacts);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("contacts with email rank higher than those without", () => {
    const contacts = [
      makeContact({ id: 1, name: "No Email", email: null, verificationScore: 55 }),
      makeContact({ id: 2, name: "Has Email", email: "test@bhp.com", verificationScore: 55 }),
    ];
    const result = findProjectContacts("BHP Iron Ore Expansion", "BHP", contacts);
    expect(result[0].name).toBe("Has Email");
  });
});

describe("ContactData interface", () => {
  it("includes all verification fields", () => {
    const contact = makeContact();
    expect(contact).toHaveProperty("verificationScore");
    expect(contact).toHaveProperty("verificationStatus");
    expect(contact).toHaveProperty("linkedinProfileUrl");
    expect(contact).toHaveProperty("confidenceScore");
    expect(contact).toHaveProperty("enrichmentSource");
    expect(contact).toHaveProperty("emailVerified");
    expect(contact).toHaveProperty("linkedinSearchUrl");
  });

  it("verification score is numeric 0-100", () => {
    const contact = makeContact({ verificationScore: 85 });
    expect(typeof contact.verificationScore).toBe("number");
    expect(contact.verificationScore).toBeGreaterThanOrEqual(0);
    expect(contact.verificationScore).toBeLessThanOrEqual(100);
  });
});

describe("Verification score color coding", () => {
  it("high confidence (80+) gets emerald color", () => {
    const score = 85;
    const color = score >= 80 ? "emerald" : score >= 60 ? "blue" : score >= 40 ? "amber" : "red";
    expect(color).toBe("emerald");
  });

  it("good confidence (60-79) gets blue color", () => {
    const score = 68;
    const color = score >= 80 ? "emerald" : score >= 60 ? "blue" : score >= 40 ? "amber" : "red";
    expect(color).toBe("blue");
  });

  it("moderate confidence (40-59) gets amber color", () => {
    const score = 55;
    const color = score >= 80 ? "emerald" : score >= 60 ? "blue" : score >= 40 ? "amber" : "red";
    expect(color).toBe("amber");
  });

  it("low confidence (<40) gets red color", () => {
    const score = 25;
    const color = score >= 80 ? "emerald" : score >= 60 ? "blue" : score >= 40 ? "amber" : "red";
    expect(color).toBe("red");
  });
});

describe("extractKeywords", () => {
  it("extracts meaningful words from a string", () => {
    const result = extractKeywords("BHP Iron Ore Expansion");
    expect(result).toContain("bhp");
    expect(result).toContain("iron");
    expect(result).toContain("ore");
    expect(result).toContain("expansion");
  });

  it("filters out stop words", () => {
    const result = extractKeywords("The Project of the Year");
    expect(result).not.toContain("the");
    expect(result).not.toContain("of");
    expect(result).toContain("project");
    expect(result).toContain("year");
  });

  it("filters out short words (2 chars or less)", () => {
    const result = extractKeywords("A to B");
    expect(result).toHaveLength(0);
  });
});

describe("hasKeywordOverlap", () => {
  it("detects overlap between related project names", () => {
    expect(hasKeywordOverlap("Rio Tinto Pilbara Maintenance", "Monadelphous Rio Tinto Pilbara Maintenance Services")).toBe(true);
  });

  it("returns false for unrelated strings", () => {
    expect(hasKeywordOverlap("BHP Iron Ore", "Santos Gas Pipeline")).toBe(false);
  });

  it("handles empty strings", () => {
    expect(hasKeywordOverlap("", "Some Project")).toBe(false);
    expect(hasKeywordOverlap("Some Project", "")).toBe(false);
  });
});
