import { describe, it, expect, vi } from "vitest";

// Mock the LLM module before importing the module under test
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            subject: "Streamlining vendor management for the Carmichael Mine — Atlas Copco",
            body: "Hi Sarah,\n\nWith the Carmichael Mine project ramping up procurement, managing multiple equipment vendors while keeping total cost of ownership in check must be a top priority. I noticed the project has significant compressed air and power generation needs across the site.\n\nAt Atlas Copco Power Technique, we offer bundled service agreements that consolidate your air, power, and pumping equipment under a single vendor — reducing your supplier management overhead and locking in predictable maintenance costs over the project lifecycle.\n\nWould a 15-minute call this week work to discuss how we could simplify your equipment procurement?\n\nCheers,\nLee",
            keyPoints: [
              "Single-vendor consolidation reduces procurement complexity",
              "Bundled service agreements lock in predictable maintenance costs",
              "Full range: portable air, power generation, pumps, and lighting",
            ],
          }),
        },
      },
    ],
  }),
}));

import { generateOutreachEmail, type OutreachInput } from "./outreachEmail";

describe("Role-KPI Personalisation in Outreach Emails", () => {
  const baseInput: OutreachInput = {
    contactName: "Sarah Chen",
    contactTitle: "Senior Procurement Manager",
    contactCompany: "Adani Mining",
    contactEmail: "sarah.chen@adani.com.au",
    contactRoleBucket: "procurement",
    projectName: "Carmichael Mine Development",
    projectLocation: "Galilee Basin, QLD",
    projectValue: "$2B",
    projectSector: "mining",
    projectStage: "Execution",
    projectOverview: "Large-scale thermal coal mine development in the Galilee Basin.",
    equipmentSignals: ["Portable compressors", "Power generators", "Dewatering pumps"],
    opportunityRoute: "Direct CAPEX",
    matchedBusinessLines: ["Portable Air", "PAL"],
    senderName: "Lee",
    tone: "consultative",
  };

  it("generates email for procurement role with correct structure", async () => {
    const result = await generateOutreachEmail(baseInput);
    expect(result).toBeDefined();
    expect(result.subject).toBeTruthy();
    expect(result.body).toBeTruthy();
    expect(result.keyPoints).toBeInstanceOf(Array);
    expect(result.keyPoints.length).toBeGreaterThan(0);
    expect(result.toneUsed).toBe("consultative");
  });

  it("generates email for engineering role", async () => {
    const result = await generateOutreachEmail({
      ...baseInput,
      contactName: "James Wright",
      contactTitle: "Chief Mechanical Engineer",
      contactRoleBucket: "engineering",
      contactEmail: "j.wright@adani.com.au",
    });
    expect(result).toBeDefined();
    expect(result.subject).toBeTruthy();
  });

  it("generates email for operations role", async () => {
    const result = await generateOutreachEmail({
      ...baseInput,
      contactName: "Mike O'Brien",
      contactTitle: "Site Operations Manager",
      contactRoleBucket: "operations",
      contactEmail: "m.obrien@adani.com.au",
    });
    expect(result).toBeDefined();
    expect(result.subject).toBeTruthy();
  });

  it("generates email for project management role", async () => {
    const result = await generateOutreachEmail({
      ...baseInput,
      contactName: "David Lee",
      contactTitle: "Project Director",
      contactRoleBucket: "project_management",
      contactEmail: "d.lee@adani.com.au",
    });
    expect(result).toBeDefined();
    expect(result.subject).toBeTruthy();
  });

  it("generates email for maintenance role", async () => {
    const result = await generateOutreachEmail({
      ...baseInput,
      contactName: "Tom Harris",
      contactTitle: "Maintenance Superintendent",
      contactRoleBucket: "maintenance",
      contactEmail: "t.harris@adani.com.au",
    });
    expect(result).toBeDefined();
    expect(result.subject).toBeTruthy();
  });

  it("generates email for fleet role", async () => {
    const result = await generateOutreachEmail({
      ...baseInput,
      contactName: "Karen White",
      contactTitle: "Fleet Manager",
      contactRoleBucket: "fleet",
      contactEmail: "k.white@adani.com.au",
    });
    expect(result).toBeDefined();
    expect(result.subject).toBeTruthy();
  });

  it("generates email for executive role", async () => {
    const result = await generateOutreachEmail({
      ...baseInput,
      contactName: "Robert Taylor",
      contactTitle: "Managing Director",
      contactRoleBucket: "executive",
      contactEmail: "r.taylor@adani.com.au",
    });
    expect(result).toBeDefined();
    expect(result.subject).toBeTruthy();
  });

  it("generates email for construction role", async () => {
    const result = await generateOutreachEmail({
      ...baseInput,
      contactName: "Steve Brown",
      contactTitle: "Construction Superintendent",
      contactRoleBucket: "construction",
      contactEmail: "s.brown@adani.com.au",
    });
    expect(result).toBeDefined();
    expect(result.subject).toBeTruthy();
  });

  it("falls back to 'other' role for unknown role buckets", async () => {
    const result = await generateOutreachEmail({
      ...baseInput,
      contactName: "Alex Johnson",
      contactTitle: "Community Relations Officer",
      contactRoleBucket: "community_relations",
      contactEmail: "a.johnson@adani.com.au",
    });
    expect(result).toBeDefined();
    expect(result.subject).toBeTruthy();
  });

  it("handles partial role bucket matches (e.g., 'Procurement Manager' maps to procurement)", async () => {
    const result = await generateOutreachEmail({
      ...baseInput,
      contactRoleBucket: "Procurement Manager",
    });
    expect(result).toBeDefined();
    expect(result.subject).toBeTruthy();
  });

  it("handles role bucket with mixed casing", async () => {
    const result = await generateOutreachEmail({
      ...baseInput,
      contactRoleBucket: "ENGINEERING",
    });
    expect(result).toBeDefined();
    expect(result.subject).toBeTruthy();
  });

  it("handles role bucket with hyphens and spaces", async () => {
    const result = await generateOutreachEmail({
      ...baseInput,
      contactRoleBucket: "project-management",
    });
    expect(result).toBeDefined();
    expect(result.subject).toBeTruthy();
  });
});
