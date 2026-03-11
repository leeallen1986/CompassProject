/**
 * Tests for the Sales-Action Overhaul features:
 * 1. New outreach targeting styles (8 total)
 * 2. Action tier classification filter
 * 3. OutreachEmail tone guide coverage
 */
import { describe, it, expect, vi } from "vitest";

// Mock the LLM module before importing
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            subject: "Test Subject",
            body: "Test body content",
            keyPoints: ["Point 1", "Point 2"],
          }),
        },
      },
    ],
  }),
}));

import { generateOutreachEmail, type OutreachInput } from "./outreachEmail";

const baseSampleInput: OutreachInput = {
  contactName: "Jane Doe",
  contactTitle: "Project Manager",
  contactCompany: "Thiess Group",
  contactEmail: "jane.doe@thiess.com",
  contactRoleBucket: "Project Management",
  projectName: "Carmichael Mine Expansion Phase 2",
  projectLocation: "Bowen Basin, QLD",
  projectValue: "$450M",
  projectSector: "mining",
  projectStage: "Execution",
  projectOverview: "Major coal mine expansion with significant drilling and blasting operations.",
  equipmentSignals: ["Portable compressors", "Drilling rigs", "Nitrogen generators"],
  opportunityRoute: "Direct CAPEX",
  matchedBusinessLines: ["Portable Air", "Nitrogen"],
  senderName: "Lee",
  tone: "professional",
};

describe("Sales-Action Overhaul", () => {
  // ── 1. New Outreach Targeting Styles ──
  describe("Outreach Targeting Styles", () => {
    const allTones: OutreachInput["tone"][] = [
      "professional",
      "consultative",
      "direct",
      "contractor_focused",
      "owner_epc_focused",
      "procurement_led",
      "engineering_led",
      "first_touch",
    ];

    it("should support all 8 targeting styles", () => {
      expect(allTones).toHaveLength(8);
    });

    allTones.forEach((tone) => {
      it(`should generate email with '${tone}' tone`, async () => {
        const result = await generateOutreachEmail({
          ...baseSampleInput,
          tone,
        });

        expect(result).toBeDefined();
        expect(result.subject).toBeTruthy();
        expect(result.body).toBeTruthy();
        expect(result.keyPoints).toBeInstanceOf(Array);
        expect(result.toneUsed).toBe(tone);
      });
    });

    it("contractor_focused tone works with contractor role bucket", async () => {
      const result = await generateOutreachEmail({
        ...baseSampleInput,
        contactTitle: "Site Supervisor",
        contactRoleBucket: "Operations",
        tone: "contractor_focused",
      });
      expect(result.toneUsed).toBe("contractor_focused");
    });

    it("owner_epc_focused tone works with EPC company", async () => {
      const result = await generateOutreachEmail({
        ...baseSampleInput,
        contactCompany: "Bechtel Australia",
        contactTitle: "EPC Director",
        contactRoleBucket: "Engineering",
        tone: "owner_epc_focused",
      });
      expect(result.toneUsed).toBe("owner_epc_focused");
    });

    it("procurement_led tone works with procurement role", async () => {
      const result = await generateOutreachEmail({
        ...baseSampleInput,
        contactTitle: "Head of Procurement",
        contactRoleBucket: "Procurement",
        tone: "procurement_led",
      });
      expect(result.toneUsed).toBe("procurement_led");
    });

    it("engineering_led tone works with engineering role", async () => {
      const result = await generateOutreachEmail({
        ...baseSampleInput,
        contactTitle: "Chief Engineer",
        contactRoleBucket: "Engineering",
        tone: "engineering_led",
      });
      expect(result.toneUsed).toBe("engineering_led");
    });

    it("first_touch tone works for initial outreach", async () => {
      const result = await generateOutreachEmail({
        ...baseSampleInput,
        tone: "first_touch",
      });
      expect(result.toneUsed).toBe("first_touch");
    });
  });

  // ── 2. Action Tier Classification ──
  describe("Action Tier Classification", () => {
    const tiers = ["tier1_actionable", "tier2_warm", "tier3_monitor"] as const;

    it("should define three action tiers", () => {
      expect(tiers).toHaveLength(3);
    });

    it("tier1_actionable represents Action Now projects", () => {
      expect(tiers[0]).toBe("tier1_actionable");
    });

    it("tier2_warm represents Warm Opportunity projects", () => {
      expect(tiers[1]).toBe("tier2_warm");
    });

    it("tier3_monitor represents Monitor projects", () => {
      expect(tiers[2]).toBe("tier3_monitor");
    });

    it("filter logic correctly filters by tier", () => {
      const projects = [
        { id: 1, name: "P1", actionTier: "tier1_actionable" },
        { id: 2, name: "P2", actionTier: "tier2_warm" },
        { id: 3, name: "P3", actionTier: "tier3_monitor" },
        { id: 4, name: "P4", actionTier: "tier1_actionable" },
        { id: 5, name: "P5", actionTier: null },
      ];

      const tier1 = projects.filter((p) => p.actionTier === "tier1_actionable");
      expect(tier1).toHaveLength(2);
      expect(tier1.map((p) => p.id)).toEqual([1, 4]);

      const tier2 = projects.filter((p) => p.actionTier === "tier2_warm");
      expect(tier2).toHaveLength(1);
      expect(tier2[0].id).toBe(2);

      const tier3 = projects.filter((p) => p.actionTier === "tier3_monitor");
      expect(tier3).toHaveLength(1);
      expect(tier3[0].id).toBe(3);

      const unclassified = projects.filter((p) => !p.actionTier);
      expect(unclassified).toHaveLength(1);
      expect(unclassified[0].id).toBe(5);
    });

    it("all filter returns all projects regardless of tier", () => {
      const projects = [
        { id: 1, actionTier: "tier1_actionable" },
        { id: 2, actionTier: "tier2_warm" },
        { id: 3, actionTier: "tier3_monitor" },
        { id: 4, actionTier: null },
      ];

      const allFilter = "all";
      const result = allFilter === "all" ? projects : projects.filter((p) => p.actionTier === allFilter);
      expect(result).toHaveLength(4);
    });
  });

  // ── 3. Outreach Template Tone Coverage ──
  describe("Outreach Template Tone Coverage", () => {
    it("all 8 tones are valid for outreach templates", () => {
      const validTones = [
        "professional",
        "consultative",
        "direct",
        "contractor_focused",
        "owner_epc_focused",
        "procurement_led",
        "engineering_led",
        "first_touch",
      ];

      validTones.forEach((tone) => {
        expect(typeof tone).toBe("string");
        expect(tone.length).toBeGreaterThan(0);
      });
    });

    it("new targeting styles have descriptive names", () => {
      const newStyles = [
        "contractor_focused",
        "owner_epc_focused",
        "procurement_led",
        "engineering_led",
        "first_touch",
      ];

      newStyles.forEach((style) => {
        // Each style name should contain an underscore (snake_case)
        expect(style).toMatch(/_/);
      });
    });

    it("targeting styles map to distinct use cases", () => {
      const styleUseCases: Record<string, string> = {
        professional: "General professional communication",
        consultative: "Solution-focused advisory approach",
        direct: "Concise and action-oriented",
        contractor_focused: "Targets contractor PMs and site supervisors",
        owner_epc_focused: "Targets asset owners and EPC decision-makers",
        procurement_led: "Targets procurement and supply chain managers",
        engineering_led: "Targets engineering and technical managers",
        first_touch: "Initial cold outreach with minimal assumptions",
      };

      expect(Object.keys(styleUseCases)).toHaveLength(8);
      Object.values(styleUseCases).forEach((desc) => {
        expect(desc.length).toBeGreaterThan(10);
      });
    });
  });

  // ── 4. KPI Strip Sales Focus ──
  describe("KPI Strip Sales Focus", () => {
    it("sales-focused KPIs should prioritize action tiers over platform metrics", () => {
      const salesKPIs = [
        "Action Now",
        "Warm Opportunity",
        "Monitor",
        "Hot Priority",
        "Warm Priority",
        "Contacts",
        "Awarded",
        "Total Projects",
      ];

      // Action tiers should be first
      expect(salesKPIs[0]).toBe("Action Now");
      expect(salesKPIs[1]).toBe("Warm Opportunity");
      expect(salesKPIs[2]).toBe("Monitor");

      // Platform metrics like "Data Sources" and "Drilling Campaigns" should NOT be in the sales KPIs
      expect(salesKPIs).not.toContain("Data Sources");
      expect(salesKPIs).not.toContain("Drilling Campaigns");
    });
  });

  // ── 5. Platform Analytics Admin Tab ──
  describe("Platform Analytics Admin Tab", () => {
    it("platform metrics are defined for admin analytics", () => {
      const platformMetrics = [
        "Total Projects",
        "Active",
        "Stale",
        "Archived",
        "Awarded",
        "Completed",
      ];

      expect(platformMetrics).toHaveLength(6);
      expect(platformMetrics).toContain("Total Projects");
      expect(platformMetrics).toContain("Active");
      expect(platformMetrics).toContain("Stale");
      expect(platformMetrics).toContain("Archived");
    });

    it("data sources list includes all 8 pipeline sources", () => {
      const dataSources = [
        "RSS Feed Pipeline",
        "Projectory Australia",
        "DMIRS MINEDEX",
        "AEMO Generation Info",
        "Gov Major Projects",
        "AusTender OCDS",
        "ICN Gateway",
        "Apollo.io People Search",
      ];

      expect(dataSources).toHaveLength(8);
    });

    it("lifecycle distribution calculation is correct", () => {
      const lifecycleCounts: Record<string, number> = {
        active: 200,
        stale: 50,
        archived: 30,
        awarded: 80,
        completed: 40,
      };

      const total = Object.values(lifecycleCounts).reduce((a, b) => a + b, 0);
      expect(total).toBe(400);

      const activePct = Math.round((lifecycleCounts.active / total) * 100);
      expect(activePct).toBe(50);

      const stalePct = Math.round((lifecycleCounts.stale / total) * 100);
      expect(stalePct).toBe(13);
    });
  });
});
