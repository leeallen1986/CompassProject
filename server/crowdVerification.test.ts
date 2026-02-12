import { describe, it, expect } from "vitest";
import { computeVerificationScore, generateLinkedInSearchUrl, generateLinkedInProfileUrl, getScoreLabel, getScoreColor } from "./verificationScoring";

describe("Improved LinkedIn Search URL Generation", () => {
  it("generates search URL with name + company + title for maximum precision", () => {
    const url = generateLinkedInSearchUrl("John Smith", "BHP", "Procurement Manager");
    expect(url).toContain("linkedin.com/search/results/people/");
    expect(url).toContain("keywords=");
    // Should include all three parts
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("John Smith");
    expect(decoded).toContain("BHP");
    expect(decoded).toContain("Procurement Manager");
  });

  it("generates search URL with name + company when title is missing", () => {
    const url = generateLinkedInSearchUrl("Jane Doe", "Rio Tinto", null);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("Jane Doe");
    expect(decoded).toContain("Rio Tinto");
  });

  it("generates search URL with name only when company and title are missing", () => {
    const url = generateLinkedInSearchUrl("Alice Brown", null, null);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("Alice Brown");
  });

  it("returns empty string for empty name", () => {
    const url = generateLinkedInSearchUrl("", "BHP", "Manager");
    expect(url).toBe("");
  });

  it("strips filler words from title for cleaner search", () => {
    const url = generateLinkedInSearchUrl("Bob Jones", "Fortescue", "Head of Procurement - Australia");
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("Bob Jones");
    expect(decoded).toContain("Fortescue");
    // Should have extracted core title keywords
    expect(decoded).toContain("Head");
    expect(decoded).toContain("Procurement");
  });

  it("deprecated generateLinkedInProfileUrl now returns search URL", () => {
    const url = generateLinkedInProfileUrl("John Smith");
    expect(url).toContain("linkedin.com/search/results/people/");
    expect(url).not.toContain("/in/");
  });
});

describe("Crowdsourced Verification Score Boost", () => {
  const baseContact = {
    name: "John Smith",
    title: "Procurement Manager",
    company: "BHP",
    email: "john.smith@bhp.com",
    emailVerified: false,
    enrichmentSource: "llm" as const,
    verificationStatus: "ai_suggested" as const,
    linkedin: null,
    linkedinProfileUrl: null,
    linkedinSearchUrl: "https://www.linkedin.com/search/results/people/?keywords=John+Smith+BHP",
  };

  it("gives LLM-sourced contact a lower source score (10)", () => {
    const score = computeVerificationScore({ ...baseContact, verifiedByUserId: null });
    expect(score.source).toBe(10);
  });

  it("boosts source score to 30 when team-verified (verifiedByUserId set)", () => {
    const score = computeVerificationScore({ ...baseContact, verifiedByUserId: 42 });
    expect(score.source).toBe(30);
  });

  it("team-verified contact gets higher total score than unverified", () => {
    const unverified = computeVerificationScore({ ...baseContact, verifiedByUserId: null });
    const verified = computeVerificationScore({ ...baseContact, verifiedByUserId: 42 });
    expect(verified.total).toBeGreaterThan(unverified.total);
    expect(verified.total - unverified.total).toBe(20); // 30 - 10 = 20 point boost
  });

  it("LinkedIn API verified contact still gets full source score", () => {
    const score = computeVerificationScore({
      ...baseContact,
      enrichmentSource: "linkedin",
      verificationStatus: "verified",
      verifiedByUserId: null,
    });
    expect(score.source).toBe(30);
  });

  it("team-verified takes priority over LLM source", () => {
    const score = computeVerificationScore({
      ...baseContact,
      enrichmentSource: "llm",
      verificationStatus: "ai_suggested",
      verifiedByUserId: 1,
    });
    expect(score.source).toBe(30);
  });
});

describe("Verification Score Labels and Colors", () => {
  it("returns correct labels for score ranges", () => {
    expect(getScoreLabel(85)).toBe("High Confidence");
    expect(getScoreLabel(80)).toBe("High Confidence");
    expect(getScoreLabel(65)).toBe("Moderate Confidence");
    expect(getScoreLabel(60)).toBe("Moderate Confidence");
    expect(getScoreLabel(45)).toBe("Low Confidence");
    expect(getScoreLabel(40)).toBe("Low Confidence");
    expect(getScoreLabel(30)).toBe("Needs Verification");
    expect(getScoreLabel(0)).toBe("Needs Verification");
  });

  it("returns correct colors for score ranges", () => {
    expect(getScoreColor(85)).toBe("emerald");
    expect(getScoreColor(65)).toBe("blue");
    expect(getScoreColor(45)).toBe("amber");
    expect(getScoreColor(30)).toBe("red");
  });
});

describe("Full Verification Score Calculation", () => {
  it("gives known major company a higher company match score", () => {
    const bhp = computeVerificationScore({
      name: "John Smith",
      title: "Manager",
      company: "BHP",
      verifiedByUserId: null,
    });
    const unknown = computeVerificationScore({
      name: "John Smith",
      title: "Manager",
      company: "Small Mining Co",
      verifiedByUserId: null,
    });
    expect(bhp.companyMatch).toBe(10);
    expect(unknown.companyMatch).toBe(5);
  });

  it("gives full name higher name quality than single name", () => {
    const full = computeVerificationScore({
      name: "John Smith",
      title: "Manager",
      company: "BHP",
      verifiedByUserId: null,
    });
    const single = computeVerificationScore({
      name: "John",
      title: "Manager",
      company: "BHP",
      verifiedByUserId: null,
    });
    expect(full.nameQuality).toBeGreaterThan(single.nameQuality);
  });

  it("gives senior title higher specificity score", () => {
    const senior = computeVerificationScore({
      name: "John Smith",
      title: "General Manager of Procurement Operations",
      company: "BHP",
      verifiedByUserId: null,
    });
    const generic = computeVerificationScore({
      name: "John Smith",
      title: "Staff",
      company: "BHP",
      verifiedByUserId: null,
    });
    expect(senior.titleSpecificity).toBeGreaterThan(generic.titleSpecificity);
  });

  it("gives verified email higher quality score", () => {
    const verified = computeVerificationScore({
      name: "John Smith",
      title: "Manager",
      company: "BHP",
      email: "john@bhp.com",
      emailVerified: true,
      verifiedByUserId: null,
    });
    const unverified = computeVerificationScore({
      name: "John Smith",
      title: "Manager",
      company: "BHP",
      email: "john@bhp.com",
      emailVerified: false,
      verifiedByUserId: null,
    });
    expect(verified.emailQuality).toBeGreaterThan(unverified.emailQuality);
  });

  it("caps total score at 100", () => {
    const score = computeVerificationScore({
      name: "John Smith",
      title: "General Manager of Procurement Operations",
      company: "BHP",
      email: "john@bhp.com",
      emailVerified: true,
      enrichmentSource: "linkedin",
      verificationStatus: "verified",
      verifiedByUserId: 1,
      linkedin: "https://www.linkedin.com/in/john-smith",
      linkedinProfileUrl: "https://www.linkedin.com/in/john-smith",
    });
    expect(score.total).toBeLessThanOrEqual(100);
  });
});
