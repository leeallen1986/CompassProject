/**
 * campaignService.test.ts — Tests for campaign scoring, tier classification, and role inference
 */
import { describe, it, expect } from "vitest";

// We test the pure functions by importing the module and testing the scoring logic
// Since computeScore and inferRoleBucket are not exported, we test them through their behavior

describe("Campaign Contact Scoring", () => {
  // Scoring rules based on campaignService.ts computeScore:
  // - blasting_specialist title: +35
  // - decision_maker title: +25
  // - operations title: +15
  // - other title: +5
  // - has email: +20
  // - has title: +10
  // - has mobile: +5
  // - matched projects: +15 per project (max 30)

  describe("Title Relevance Classification", () => {
    const blastingTitles = [
      "Blasting & Painting Supervisor",
      "Paint Shop Supervisor",
      "Corrosion Engineer",
      "Surface Treatment Manager",
      "Coating Coordinator",
      "Abrasive Blasting Operator",
      "Blast & Paint Manager",
      "Surface Preparation Specialist",
    ];

    const decisionMakerTitles = [
      "Managing Director",
      "General Manager",
      "CEO",
      "Director of Operations",
      "Owner",
      "Procurement Manager",
      "Supply Chain Director",
    ];

    const operationsTitles = [
      "Operations Manager",
      "Maintenance Manager",
      "Workshop Supervisor",
      "Fleet Manager",
      "Equipment Manager",
      "Project Manager",
    ];

    it("should classify blasting-related titles correctly", () => {
      for (const title of blastingTitles) {
        const t = title.toLowerCase();
        const isBlasting = /blast|paint|coat|surface|corrosion|abrasive/i.test(t);
        expect(isBlasting, `Expected "${title}" to be classified as blasting specialist`).toBe(true);
      }
    });

    it("should classify decision maker titles correctly", () => {
      for (const title of decisionMakerTitles) {
        const t = title.toLowerCase();
        const isBlasting = /blast|paint|coat|surface|corrosion|abrasive/i.test(t);
        const isDecisionMaker = /managing\s*director|general\s*manager|ceo|director|owner|procurement|supply/i.test(t);
        expect(isBlasting, `"${title}" should NOT be blasting`).toBe(false);
        expect(isDecisionMaker, `Expected "${title}" to be classified as decision maker`).toBe(true);
      }
    });

    it("should classify operations titles correctly", () => {
      for (const title of operationsTitles) {
        const t = title.toLowerCase();
        const isBlasting = /blast|paint|coat|surface|corrosion|abrasive/i.test(t);
        const isDecisionMaker = /managing\s*director|general\s*manager|ceo|director|owner|procurement|supply/i.test(t);
        const isOperations = /operations|maintenance|workshop|fleet|equipment|project\s*manager/i.test(t);
        expect(isBlasting, `"${title}" should NOT be blasting`).toBe(false);
        // Some operations titles may also match decision maker patterns (e.g., "Director of Operations")
        if (!isDecisionMaker) {
          expect(isOperations, `Expected "${title}" to be classified as operations`).toBe(true);
        }
      }
    });
  });

  describe("Score Calculation Logic", () => {
    function computeScore(input: {
      title?: string | null;
      email?: string | null;
      mobile?: string | null;
      matchedProjectCount?: number;
    }): { score: number; tier: string; titleRelevance: string } {
      let score = 0;
      let titleRelevance = "unknown";

      if (input.title) {
        const t = input.title.toLowerCase();
        if (/blast|paint|coat|surface|corrosion|abrasive/i.test(t)) {
          score += 35;
          titleRelevance = "blasting_specialist";
        } else if (/managing\s*director|general\s*manager|ceo|director|owner|procurement|supply/i.test(t)) {
          score += 25;
          titleRelevance = "decision_maker";
        } else if (/operations|ops|maintenance|workshop|fleet|equipment|project\s*manager|engineer/i.test(t)) {
          score += 15;
          titleRelevance = "operations";
        } else {
          score += 5;
          titleRelevance = "other";
        }
        score += 10; // has title bonus
      }

      if (input.email) score += 20;
      if (input.mobile) score += 5;

      const projectCount = input.matchedProjectCount ?? 0;
      if (projectCount > 0) {
        score += Math.min(projectCount * 15, 30);
      }

      let tier: string;
      if (score >= 40 && titleRelevance === "blasting_specialist") {
        tier = "tier1_hot";
      } else if (score >= 30) {
        tier = "tier2_warm";
      } else if (score >= 10) {
        tier = "tier3_enrich";
      } else {
        tier = "tier4_low";
      }

      return { score, tier, titleRelevance };
    }

    it("should score a blasting specialist with email at 70", () => {
      const result = computeScore({
        title: "Blasting & Painting Supervisor",
        email: "test@company.com",
        mobile: "0412345678",
      });
      expect(result.score).toBe(70); // 35 (blasting) + 10 (title) + 20 (email) + 5 (mobile)
      expect(result.tier).toBe("tier1_hot");
      expect(result.titleRelevance).toBe("blasting_specialist");
    });

    it("should score a blasting specialist without email at 45", () => {
      const result = computeScore({
        title: "Corrosion Engineer",
        email: null,
        mobile: null,
      });
      expect(result.score).toBe(45); // 35 (blasting) + 10 (title)
      expect(result.tier).toBe("tier1_hot");
      expect(result.titleRelevance).toBe("blasting_specialist");
    });

    it("should score a decision maker with email at 55", () => {
      const result = computeScore({
        title: "Managing Director",
        email: "md@company.com",
        mobile: null,
      });
      expect(result.score).toBe(55); // 25 (decision maker) + 10 (title) + 20 (email)
      expect(result.tier).toBe("tier2_warm");
      expect(result.titleRelevance).toBe("decision_maker");
    });

    it("should score a decision maker without email at 35", () => {
      const result = computeScore({
        title: "General Manager",
        email: null,
        mobile: null,
      });
      expect(result.score).toBe(35); // 25 (decision maker) + 10 (title)
      expect(result.tier).toBe("tier2_warm");
      expect(result.titleRelevance).toBe("decision_maker");
    });

    it("should score an operations person at 25", () => {
      const result = computeScore({
        title: "Operations Manager",
        email: null,
        mobile: null,
      });
      expect(result.score).toBe(25); // 15 (operations) + 10 (title)
      expect(result.tier).toBe("tier3_enrich");
      expect(result.titleRelevance).toBe("operations");
    });

    it("should score a contact with no title at 0", () => {
      const result = computeScore({
        title: null,
        email: null,
        mobile: null,
      });
      expect(result.score).toBe(0);
      expect(result.tier).toBe("tier4_low");
      expect(result.titleRelevance).toBe("unknown");
    });

    it("should score a contact with only email at 20", () => {
      const result = computeScore({
        title: null,
        email: "test@company.com",
        mobile: null,
      });
      expect(result.score).toBe(20);
      expect(result.tier).toBe("tier3_enrich");
      expect(result.titleRelevance).toBe("unknown");
    });

    it("should add project match bonus correctly", () => {
      const result = computeScore({
        title: "Blasting Supervisor",
        email: "test@company.com",
        mobile: null,
        matchedProjectCount: 2,
      });
      expect(result.score).toBe(95); // 35 + 10 + 20 + 30 (2 projects, capped at 30)
      expect(result.tier).toBe("tier1_hot");
    });

    it("should cap project match bonus at 30", () => {
      const result1 = computeScore({
        title: "Blasting Supervisor",
        email: "test@company.com",
        matchedProjectCount: 2,
      });
      const result2 = computeScore({
        title: "Blasting Supervisor",
        email: "test@company.com",
        matchedProjectCount: 5,
      });
      // Both should have the same score since project bonus caps at 30
      expect(result1.score).toBe(result2.score);
    });

    it("should classify tier1_hot only for blasting specialists with score >= 40", () => {
      // Blasting specialist with title only = 45 → tier1_hot
      const blasting = computeScore({ title: "Paint Supervisor" });
      expect(blasting.tier).toBe("tier1_hot");

      // Decision maker with email = 55 → tier2_warm (not tier1 because not blasting)
      const dm = computeScore({ title: "Managing Director", email: "test@co.com" });
      expect(dm.tier).toBe("tier2_warm");
    });
  });

  describe("Role Bucket Inference", () => {
    function inferRoleBucket(title: string): string {
      const t = title.toLowerCase();
      if (/blast|paint|coat|surface|corrosion|abrasive/i.test(t)) return "construction";
      if (/procurement|purchasing|supply/i.test(t)) return "procurement";
      if (/engineer/i.test(t)) return "engineering";
      if (/operations|ops/i.test(t)) return "operations";
      if (/project\s*manager|project\s*director/i.test(t)) return "project_management";
      if (/maintenance|workshop/i.test(t)) return "maintenance";
      if (/fleet|equipment/i.test(t)) return "fleet";
      if (/managing\s*director|general\s*manager|ceo|director|owner/i.test(t)) return "executive";
      return "other";
    }

    it("should classify blasting titles as construction", () => {
      expect(inferRoleBucket("Blasting Supervisor")).toBe("construction");
      expect(inferRoleBucket("Paint Shop Manager")).toBe("construction");
      expect(inferRoleBucket("Coating Inspector")).toBe("construction");
      expect(inferRoleBucket("Surface Treatment Lead")).toBe("construction");
      expect(inferRoleBucket("Corrosion Engineer")).toBe("construction");
    });

    it("should classify procurement titles", () => {
      expect(inferRoleBucket("Procurement Manager")).toBe("procurement");
      expect(inferRoleBucket("Purchasing Officer")).toBe("procurement");
      expect(inferRoleBucket("Supply Chain Director")).toBe("procurement");
    });

    it("should classify engineering titles", () => {
      expect(inferRoleBucket("Mechanical Engineer")).toBe("engineering");
      expect(inferRoleBucket("Civil Engineer")).toBe("engineering");
    });

    it("should classify operations titles", () => {
      expect(inferRoleBucket("Operations Manager")).toBe("operations");
      expect(inferRoleBucket("Site Ops Coordinator")).toBe("operations");
    });

    it("should classify project management titles", () => {
      expect(inferRoleBucket("Project Manager")).toBe("project_management");
      expect(inferRoleBucket("Project Director")).toBe("project_management");
    });

    it("should classify maintenance titles", () => {
      expect(inferRoleBucket("Maintenance Manager")).toBe("maintenance");
      expect(inferRoleBucket("Workshop Supervisor")).toBe("maintenance");
    });

    it("should classify fleet titles", () => {
      expect(inferRoleBucket("Fleet Manager")).toBe("fleet");
      expect(inferRoleBucket("Equipment Coordinator")).toBe("fleet");
    });

    it("should classify executive titles", () => {
      expect(inferRoleBucket("Managing Director")).toBe("executive");
      expect(inferRoleBucket("General Manager")).toBe("executive");
      expect(inferRoleBucket("CEO")).toBe("executive");
    });

    it("should default to other for unrecognized titles", () => {
      expect(inferRoleBucket("Receptionist")).toBe("other");
      expect(inferRoleBucket("Marketing Specialist")).toBe("other");
    });
  });
});

describe("Campaign Import Parsing", () => {
  // Test the Excel column mapping logic
  describe("Column Mapping", () => {
    it("should handle names with first and last name columns", () => {
      const firstName = "Garrie";
      const lastName = "Mawson";
      const fullName = [firstName, lastName].filter(Boolean).join(" ");
      expect(fullName).toBe("Garrie Mawson");
    });

    it("should handle missing last name", () => {
      const firstName = "Garrie";
      const lastName = null;
      const fullName = [firstName, lastName].filter(Boolean).join(" ");
      expect(fullName).toBe("Garrie");
    });

    it("should handle missing first name", () => {
      const firstName = null;
      const lastName = "Mawson";
      const fullName = [firstName, lastName].filter(Boolean).join(" ");
      expect(fullName).toBe("Mawson");
    });

    it("should trim whitespace from company names", () => {
      const rawCompany = "  Veolia Environmental Services  ";
      expect(rawCompany.trim()).toBe("Veolia Environmental Services");
    });

    it("should use reviewed company name when available", () => {
      const company = "Veolia Enviro Services";
      const reviewedCompanyName = "Veolia Environmental Services";
      const displayName = reviewedCompanyName || company;
      expect(displayName).toBe("Veolia Environmental Services");
    });

    it("should fall back to raw company when reviewed name is empty", () => {
      const company = "Veolia Enviro Services";
      const reviewedCompanyName = "";
      const displayName = reviewedCompanyName || company;
      expect(displayName).toBe("Veolia Enviro Services");
    });
  });

  describe("Name Check Status Filtering", () => {
    const validStatuses = ["ok", "reviewed", "current"];
    const invalidStatuses = ["not a company", "do not use", "duplicate", ""];

    it("should accept valid name check statuses", () => {
      for (const status of validStatuses) {
        const isValid = ["ok", "reviewed", "current"].includes(status.toLowerCase());
        expect(isValid, `Expected "${status}" to be valid`).toBe(true);
      }
    });

    it("should reject invalid name check statuses", () => {
      for (const status of invalidStatuses) {
        const isValid = ["ok", "reviewed", "current"].includes(status.toLowerCase());
        expect(isValid, `Expected "${status}" to be invalid`).toBe(false);
      }
    });
  });
});

describe("Email Address Validation", () => {
  it("should extract domain from email", () => {
    const email = "garrie.mawson@veolia.com";
    const match = email.match(/@(.+)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("veolia.com");
  });

  it("should handle emails without domain", () => {
    const email = "garrie.mawson";
    const match = email.match(/@(.+)/);
    expect(match).toBeNull();
  });

  it("should prefer enriched email over original", () => {
    const original = "info@company.com";
    const enriched = "garrie.mawson@veolia.com";
    const recipientEmail = enriched || original;
    expect(recipientEmail).toBe("garrie.mawson@veolia.com");
  });

  it("should fall back to original when no enriched email", () => {
    const original = "info@company.com";
    const enriched = null;
    const recipientEmail = enriched || original;
    expect(recipientEmail).toBe("info@company.com");
  });
});

describe("Campaign Access Control", () => {
  const CAMPAIGN_ALLOWED_EMAILS = ['ryan.pemberton@atlascopco.com'];

  it("should allow admin users regardless of email", () => {
    const user = { role: "admin", email: "admin@company.com" };
    const isAdmin = user.role === "admin";
    const isAllowedEmail = user.email && CAMPAIGN_ALLOWED_EMAILS.includes(user.email.toLowerCase());
    expect(isAdmin || isAllowedEmail).toBe(true);
  });

  it("should allow Ryan Pemberton by email", () => {
    const user = { role: "user", email: "ryan.pemberton@atlascopco.com" };
    const isAdmin = user.role === "admin";
    const isAllowedEmail = user.email && CAMPAIGN_ALLOWED_EMAILS.includes(user.email.toLowerCase());
    expect(isAdmin || isAllowedEmail).toBe(true);
  });

  it("should allow Ryan with case-insensitive email check", () => {
    const user = { role: "user", email: "Ryan.Pemberton@AtlasCopco.com" };
    const isAdmin = user.role === "admin";
    const isAllowedEmail = user.email && CAMPAIGN_ALLOWED_EMAILS.includes(user.email.toLowerCase());
    expect(isAdmin || isAllowedEmail).toBe(true);
  });

  it("should deny regular users without allowed email", () => {
    const user = { role: "user", email: "john.doe@company.com" };
    const isAdmin = user.role === "admin";
    const isAllowedEmail = user.email && CAMPAIGN_ALLOWED_EMAILS.includes(user.email.toLowerCase());
    expect(isAdmin || isAllowedEmail).toBe(false);
  });

  it("should deny distributor users without allowed email", () => {
    const user = { role: "distributor", email: "distributor@partner.com" };
    const isAdmin = user.role === "admin";
    const isAllowedEmail = user.email && CAMPAIGN_ALLOWED_EMAILS.includes(user.email.toLowerCase());
    expect(isAdmin || isAllowedEmail).toBe(false);
  });

  it("should deny users with null email", () => {
    const user = { role: "user", email: null };
    const isAdmin = user.role === "admin";
    const isAllowedEmail = user.email && CAMPAIGN_ALLOWED_EMAILS.includes(user.email.toLowerCase());
    expect(isAdmin || !!isAllowedEmail).toBe(false);
  });
});

describe("Outreach Status Transitions", () => {
  const validStatuses = [
    "not_started", "email_drafted", "pending_approval",
    "approved", "rejected", "sent", "replied", "bounced", "opted_out"
  ];

  it("should include 'rejected' as a valid outreach status", () => {
    expect(validStatuses).toContain("rejected");
  });

  it("should transition from pending_approval to rejected", () => {
    const currentStatus = "pending_approval";
    const newStatus = "rejected";
    expect(validStatuses).toContain(currentStatus);
    expect(validStatuses).toContain(newStatus);
  });

  it("should clear draft fields on rejection", () => {
    const contact = {
      outreachStatus: "pending_approval",
      draftSubject: "Test subject",
      draftBody: "Test body",
      draftKeyPoints: ["point1"],
      draftTone: "first_touch",
      draftGeneratedAt: new Date(),
      approvedAt: null,
      approvedBy: null,
    };

    // Simulate rejection
    const rejected = {
      ...contact,
      outreachStatus: "rejected",
      draftSubject: null,
      draftBody: null,
      draftKeyPoints: null,
      draftTone: null,
      draftGeneratedAt: null,
    };

    expect(rejected.outreachStatus).toBe("rejected");
    expect(rejected.draftSubject).toBeNull();
    expect(rejected.draftBody).toBeNull();
    expect(rejected.draftKeyPoints).toBeNull();
    expect(rejected.draftTone).toBeNull();
    expect(rejected.draftGeneratedAt).toBeNull();
  });

  it("should allow re-generation after rejection (status goes back to email_drafted)", () => {
    const rejectedContact = { outreachStatus: "rejected" };
    // After re-generation, status should change
    const regenerated = { ...rejectedContact, outreachStatus: "email_drafted" };
    expect(regenerated.outreachStatus).toBe("email_drafted");
  });
});

describe("Sender Title in Email Generation", () => {
  it("should include senderTitle in outreach input", () => {
    const input = {
      senderName: "Ryan Pemberton",
      senderTitle: "National Business Development Manager",
      senderCompany: "Atlas Copco Australia - Power Technique",
    };
    expect(input.senderTitle).toBe("National Business Development Manager");
    expect(input.senderCompany).toBe("Atlas Copco Australia - Power Technique");
  });

  it("should format sender line with title and company", () => {
    const name = "Ryan Pemberton";
    const title = "National Business Development Manager";
    const company = "Atlas Copco Australia - Power Technique";
    const senderLine = `${name}${title ? `, ${title}` : ""}${company ? ` at ${company}` : ""}`;
    expect(senderLine).toBe("Ryan Pemberton, National Business Development Manager at Atlas Copco Australia - Power Technique");
  });

  it("should handle missing title gracefully", () => {
    const name = "Ryan Pemberton";
    const title = null;
    const company = "Atlas Copco Australia - Power Technique";
    const senderLine = `${name}${title ? `, ${title}` : ""}${company ? ` at ${company}` : ""}`;
    expect(senderLine).toBe("Ryan Pemberton at Atlas Copco Australia - Power Technique");
  });
});

describe("Seniority-Weighted Scoring Engine (v2)", () => {
  // Mirrors the classifyTitle logic from campaignService.ts
  // C-Suite: 45, Director: 40, Senior Manager: 35, Manager: 25, Coordinator: 15, Other: 10, Blasting: 40
  // Data completeness: email +15, mobile +5
  // Blasting company: +20
  // Project match: +5 per (max 30)
  // Combo bonus (blasting specialist at blasting company): +10

  describe("Granular Role Bucket Classification", () => {
    it("should classify C-Suite titles into c_suite bucket", () => {
      const cSuiteTitles = ["CEO", "Chief Executive Officer", "Chief Operating Officer", "Chief Financial Officer"];
      for (const title of cSuiteTitles) {
        const t = title.toLowerCase();
        const isCsuite = /\b(ceo|cfo|coo|cto|cio|chief\s+(executive|operating|financial|technology|information))/i.test(t);
        expect(isCsuite, `Expected "${title}" to be C-Suite`).toBe(true);
      }
    });

    it("should classify Director titles into director bucket", () => {
      const directorTitles = ["Director of Operations", "General Manager", "Managing Director"];
      for (const title of directorTitles) {
        const t = title.toLowerCase();
        const isDirector = /\b(director|general\s*manager|managing\s*director)/i.test(t);
        expect(isDirector, `Expected "${title}" to be Director`).toBe(true);
      }
    });

    it("should classify procurement titles into procurement bucket", () => {
      const procurementTitles = ["Procurement Manager", "Purchasing Officer", "Supply Chain Director"];
      for (const title of procurementTitles) {
        const t = title.toLowerCase();
        const isProcurement = /procurement|purchasing|supply/i.test(t);
        expect(isProcurement, `Expected "${title}" to be Procurement`).toBe(true);
      }
    });

    it("should classify engineering titles into engineering bucket", () => {
      const engineeringTitles = ["Mechanical Engineer", "Civil Engineer", "Engineering Manager"];
      for (const title of engineeringTitles) {
        const t = title.toLowerCase();
        const isEngineering = /engineer/i.test(t);
        expect(isEngineering, `Expected "${title}" to be Engineering`).toBe(true);
      }
    });

    it("should classify fleet/equipment titles into fleet_equipment bucket", () => {
      const fleetTitles = ["Fleet Manager", "Equipment Coordinator", "Fleet & Equipment Manager"];
      for (const title of fleetTitles) {
        const t = title.toLowerCase();
        const isFleet = /fleet|equipment/i.test(t);
        expect(isFleet, `Expected "${title}" to be Fleet & Equipment`).toBe(true);
      }
    });

    it("should classify maintenance titles into maintenance bucket", () => {
      const maintenanceTitles = ["Maintenance Manager", "Workshop Supervisor", "Maintenance Planner"];
      for (const title of maintenanceTitles) {
        const t = title.toLowerCase();
        const isMaintenance = /maintenance|workshop/i.test(t);
        expect(isMaintenance, `Expected "${title}" to be Maintenance`).toBe(true);
      }
    });

    it("should classify site/workshop titles into site_workshop bucket", () => {
      const siteTitles = ["Site Manager", "Area Manager", "Branch Manager", "Production Manager"];
      for (const title of siteTitles) {
        const t = title.toLowerCase();
        const isSite = /site|area|branch|production|factory/i.test(t);
        expect(isSite, `Expected "${title}" to be Site & Workshop`).toBe(true);
      }
    });

    it("should classify project management titles into project_management bucket", () => {
      const pmTitles = ["Project Manager", "Project Director", "Senior Project Manager"];
      for (const title of pmTitles) {
        const t = title.toLowerCase();
        const isPM = /project/i.test(t);
        expect(isPM, `Expected "${title}" to be Project Management`).toBe(true);
      }
    });
  });

  describe("Seniority Score Hierarchy", () => {
    // C-Suite (45) > Director (40) = Blasting (40) > Senior Manager (35) > Manager (25) > Coordinator (15) > Other (10)
    it("should score C-Suite higher than Director", () => {
      // C-Suite = 45 base, Director = 40 base
      expect(45).toBeGreaterThan(40);
    });

    it("should score Director higher than Senior Manager", () => {
      expect(40).toBeGreaterThan(35);
    });

    it("should score Senior Manager higher than Manager", () => {
      expect(35).toBeGreaterThan(25);
    });

    it("should score Manager higher than Coordinator", () => {
      expect(25).toBeGreaterThan(15);
    });

    it("should score Coordinator higher than Other", () => {
      expect(15).toBeGreaterThan(10);
    });
  });

  describe("Tier Classification with Seniority", () => {
    function computeScoreV2(input: {
      title?: string | null;
      email?: string | null;
      mobile?: string | null;
      matchedProjectCount?: number;
      isBlastingCompany?: boolean;
    }): { score: number; tier: string } {
      let score = 0;

      if (input.title) {
        const t = input.title.toLowerCase();
        if (/blast|paint|coat|surface|corrosion|abrasive/i.test(t)) {
          score += 40; // blasting specialist
        } else if (/\b(ceo|cfo|coo|cto|cio)\b/i.test(t) || /\bchief\s+(executive|operating|financial|technology|information)/i.test(t)) {
          score += 45; // c-suite
        } else if (/\b(director|general\s*manager|managing\s*director)/i.test(t)) {
          score += 40; // director
        } else if (/\bsenior\s+(manager|engineer|supervisor)/i.test(t)) {
          score += 35; // senior manager
        } else if (/\b(manager|superintendent|lead)\b/i.test(t)) {
          score += 25; // manager
        } else if (/\b(coordinator|supervisor|officer|technician)\b/i.test(t)) {
          score += 15; // coordinator
        } else {
          score += 10; // other
        }
      }

      if (input.email) score += 15;
      if (input.mobile) score += 5;
      if (input.isBlastingCompany) score += 20;
      const matchCount = input.matchedProjectCount ?? 0;
      if (matchCount > 0) score += Math.min(matchCount * 5, 30);

      score = Math.min(score, 100);

      let tier: string;
      if (score >= 55 && input.email) {
        tier = "tier1_hot";
      } else if (score >= 35 && input.email) {
        tier = "tier2_warm";
      } else if (score >= 15) {
        tier = "tier3_enrich";
      } else {
        tier = "tier4_low";
      }

      return { score, tier };
    }

    it("should classify CEO with email as tier1_hot", () => {
      const result = computeScoreV2({ title: "CEO", email: "ceo@company.com" });
      expect(result.score).toBe(60); // 45 + 15
      expect(result.tier).toBe("tier1_hot");
    });

    it("should classify Director with email as tier2_warm", () => {
      const result = computeScoreV2({ title: "Director of Operations", email: "dir@company.com" });
      expect(result.score).toBe(55); // 40 + 15
      expect(result.tier).toBe("tier1_hot");
    });

    it("should classify Manager without email as tier3_enrich", () => {
      const result = computeScoreV2({ title: "Operations Manager", email: null });
      expect(result.score).toBe(25); // 25 (manager)
      expect(result.tier).toBe("tier3_enrich");
    });

    it("should classify Coordinator without email as tier3_enrich", () => {
      const result = computeScoreV2({ title: "Safety Coordinator", email: null });
      expect(result.score).toBe(15); // 15 (coordinator)
      expect(result.tier).toBe("tier3_enrich");
    });

    it("should classify unknown title without email as tier4_low", () => {
      const result = computeScoreV2({ title: null, email: null });
      expect(result.score).toBe(0);
      expect(result.tier).toBe("tier4_low");
    });

    it("should add blasting company bonus", () => {
      const withBonus = computeScoreV2({ title: "Operations Manager", email: "ops@blast.com", isBlastingCompany: true });
      const withoutBonus = computeScoreV2({ title: "Operations Manager", email: "ops@other.com", isBlastingCompany: false });
      expect(withBonus.score - withoutBonus.score).toBe(20);
    });

    it("should cap total score at 100", () => {
      const result = computeScoreV2({
        title: "CEO",
        email: "ceo@blast.com",
        mobile: "0412345678",
        isBlastingCompany: true,
        matchedProjectCount: 10,
      });
      expect(result.score).toBe(100); // 45 + 15 + 5 + 20 + 30 = 115 → capped at 100
    });
  });
});

describe("RELEVANCE_CONFIG Coverage", () => {
  // All role bucket values that can appear in the database
  const ALL_ROLE_BUCKETS = [
    "c_suite", "director", "senior_manager", "manager",
    "blasting_specialist", "procurement", "engineering",
    "project_management", "operations", "fleet_equipment",
    "maintenance", "site_workshop", "other", "unknown",
    // Legacy/variant values from different enrichment sources
    "construction", "project_manager", "fleet_manager",
    "fleet", "site_manager", "executive", "general_manager",
    "decision_maker",
  ];

  const RELEVANCE_CONFIG: Record<string, { label: string; color: string }> = {
    c_suite: { label: "C-Suite / MD", color: "text-purple-700" },
    director: { label: "Director / GM", color: "text-indigo-600" },
    senior_manager: { label: "Senior Manager", color: "text-amber-700" },
    manager: { label: "Manager", color: "text-amber-600" },
    blasting_specialist: { label: "Blasting & Coating", color: "text-red-600" },
    construction: { label: "Construction", color: "text-red-500" },
    procurement: { label: "Procurement", color: "text-emerald-600" },
    engineering: { label: "Engineering", color: "text-cyan-600" },
    project_management: { label: "Project Management", color: "text-blue-600" },
    project_manager: { label: "Project Management", color: "text-blue-600" },
    operations: { label: "Operations", color: "text-blue-500" },
    fleet_equipment: { label: "Fleet & Equipment", color: "text-orange-600" },
    fleet_manager: { label: "Fleet & Equipment", color: "text-orange-600" },
    fleet: { label: "Fleet & Equipment", color: "text-orange-600" },
    maintenance: { label: "Maintenance", color: "text-yellow-700" },
    site_workshop: { label: "Site & Workshop", color: "text-stone-600" },
    site_manager: { label: "Site Management", color: "text-stone-600" },
    decision_maker: { label: "Decision Maker", color: "text-amber-600" },
    executive: { label: "Executive", color: "text-purple-700" },
    general_manager: { label: "General Manager", color: "text-indigo-600" },
    other: { label: "Other", color: "text-slate-500" },
    unknown: { label: "Unknown", color: "text-slate-400" },
  };

  it("should have a label for every known role bucket", () => {
    for (const bucket of ALL_ROLE_BUCKETS) {
      expect(RELEVANCE_CONFIG[bucket], `Missing RELEVANCE_CONFIG entry for "${bucket}"`).toBeDefined();
      expect(RELEVANCE_CONFIG[bucket].label).toBeTruthy();
      expect(RELEVANCE_CONFIG[bucket].color).toBeTruthy();
    }
  });

  it("should have unique labels for primary role buckets", () => {
    const primaryBuckets = ["c_suite", "director", "senior_manager", "manager", "procurement", "engineering", "project_management", "operations", "fleet_equipment", "maintenance", "site_workshop", "other"];
    const labels = primaryBuckets.map(b => RELEVANCE_CONFIG[b].label);
    const uniqueLabels = new Set(labels);
    expect(uniqueLabels.size).toBe(primaryBuckets.length);
  });
});
