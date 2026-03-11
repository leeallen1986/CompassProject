/**
 * Role Relevance Scoring Tests
 *
 * Tests the classifyRoleRelevance function which assigns contacts
 * to high/medium/low relevance for Atlas Copco equipment procurement.
 */
import { describe, it, expect } from "vitest";
import {
  classifyRoleRelevance,
  HIGH_RELEVANCE_KEYWORDS,
  MEDIUM_RELEVANCE_KEYWORDS,
  LOW_RELEVANCE_KEYWORDS,
  ROLE_BUCKET_RELEVANCE,
} from "./roleRelevance";

describe("roleRelevance", () => {
  // ── HIGH RELEVANCE: Construction & site roles ──
  describe("high relevance — construction & site roles", () => {
    it("classifies Construction Manager as high", () => {
      expect(classifyRoleRelevance("Construction Manager", "other")).toBe("high");
    });

    it("classifies Site Superintendent as high", () => {
      expect(classifyRoleRelevance("Site Superintendent", "other")).toBe("high");
    });

    it("classifies Site Manager as high", () => {
      expect(classifyRoleRelevance("Site Manager - Pilbara Operations", "site_manager")).toBe("high");
    });

    it("classifies Construction Superintendent as high", () => {
      expect(classifyRoleRelevance("Construction Superintendent", null)).toBe("high");
    });
  });

  // ── HIGH RELEVANCE: Project delivery roles ──
  describe("high relevance — project delivery roles", () => {
    it("classifies Project Manager as high", () => {
      expect(classifyRoleRelevance("Project Manager", "project_manager")).toBe("high");
    });

    it("classifies Project Engineer as high", () => {
      expect(classifyRoleRelevance("Project Engineer - Infrastructure", "engineering")).toBe("high");
    });

    it("classifies Project Coordinator as high", () => {
      expect(classifyRoleRelevance("Project Coordinator", "project_manager")).toBe("high");
    });
  });

  // ── HIGH RELEVANCE: Procurement & supply chain ──
  describe("high relevance — procurement roles", () => {
    it("classifies Procurement Manager as high", () => {
      expect(classifyRoleRelevance("Procurement Manager", "procurement")).toBe("high");
    });

    it("classifies Purchasing Manager as high", () => {
      expect(classifyRoleRelevance("Purchasing Manager", null)).toBe("high");
    });

    it("classifies Supply Chain Manager as high", () => {
      expect(classifyRoleRelevance("Supply Chain Manager", "procurement")).toBe("high");
    });

    it("classifies Contracts Manager as high", () => {
      expect(classifyRoleRelevance("Contracts Manager", "commercial")).toBe("high");
    });

    it("classifies Contracts Administrator as high", () => {
      expect(classifyRoleRelevance("Contracts Administrator", null)).toBe("high");
    });
  });

  // ── HIGH RELEVANCE: Engineering & technical ──
  describe("high relevance — engineering roles", () => {
    it("classifies Engineering Manager as high", () => {
      expect(classifyRoleRelevance("Engineering Manager", "engineering")).toBe("high");
    });

    it("classifies Chief Engineer as high", () => {
      expect(classifyRoleRelevance("Chief Engineer", "engineering")).toBe("high");
    });

    it("classifies Mechanical Engineer as high", () => {
      expect(classifyRoleRelevance("Mechanical Engineer", "engineering")).toBe("high");
    });
  });

  // ── HIGH RELEVANCE: Operations & maintenance ──
  describe("high relevance — operations & maintenance", () => {
    it("classifies Operations Manager as high", () => {
      expect(classifyRoleRelevance("Operations Manager", "operations")).toBe("high");
    });

    it("classifies Maintenance Manager as high", () => {
      expect(classifyRoleRelevance("Maintenance Manager", "maintenance")).toBe("high");
    });

    it("classifies Maintenance Planner as high", () => {
      expect(classifyRoleRelevance("Maintenance Planner", "maintenance")).toBe("high");
    });

    it("classifies Reliability Manager as high", () => {
      expect(classifyRoleRelevance("Reliability Manager", null)).toBe("high");
    });
  });

  // ── HIGH RELEVANCE: Fleet & equipment ──
  describe("high relevance — fleet & equipment", () => {
    it("classifies Fleet Manager as high", () => {
      expect(classifyRoleRelevance("Fleet Manager", "fleet_manager")).toBe("high");
    });

    it("classifies Equipment Manager as high", () => {
      expect(classifyRoleRelevance("Equipment Manager", null)).toBe("high");
    });

    it("classifies Plant Manager as high", () => {
      expect(classifyRoleRelevance("Plant Manager", "plant_manager")).toBe("high");
    });
  });

  // ── HIGH RELEVANCE: Mining-specific ──
  describe("high relevance — mining roles", () => {
    it("classifies Mining Manager as high", () => {
      expect(classifyRoleRelevance("Mining Manager", null)).toBe("high");
    });

    it("classifies Mine Manager as high", () => {
      expect(classifyRoleRelevance("Mine Manager", null)).toBe("high");
    });

    it("classifies Mining Engineer as high", () => {
      expect(classifyRoleRelevance("Mining Engineer", "engineering")).toBe("high");
    });

    it("classifies Drill and Blast roles as high", () => {
      expect(classifyRoleRelevance("Drill and Blast Superintendent", null)).toBe("high");
    });
  });

  // ── MEDIUM RELEVANCE: Indirect influencers ──
  describe("medium relevance — indirect influencers", () => {
    it("classifies Project Director as medium", () => {
      expect(classifyRoleRelevance("Project Director", null)).toBe("medium");
    });

    it("classifies Commercial Manager as medium", () => {
      expect(classifyRoleRelevance("Commercial Manager", "commercial")).toBe("medium");
    });

    it("classifies Estimating Manager as medium", () => {
      expect(classifyRoleRelevance("Estimating Manager", null)).toBe("medium");
    });

    it("classifies Quantity Surveyor as medium", () => {
      expect(classifyRoleRelevance("Quantity Surveyor", null)).toBe("medium");
    });

    it("classifies HSE Manager as medium", () => {
      expect(classifyRoleRelevance("HSE Manager", null)).toBe("medium");
    });

    it("classifies Technical Director as medium", () => {
      expect(classifyRoleRelevance("Technical Director", null)).toBe("medium");
    });

    it("classifies General Manager Operations as medium", () => {
      expect(classifyRoleRelevance("General Manager Operations", "general_manager")).toBe("medium");
    });

    it("classifies Head of Operations as medium", () => {
      expect(classifyRoleRelevance("Head of Operations", null)).toBe("medium");
    });

    it("classifies VP Engineering as medium", () => {
      expect(classifyRoleRelevance("VP Engineering", null)).toBe("medium");
    });

    it("classifies Shutdown Manager as medium", () => {
      expect(classifyRoleRelevance("Shutdown Manager", null)).toBe("medium");
    });

    it("classifies Turnaround Manager as medium", () => {
      expect(classifyRoleRelevance("Turnaround Manager", null)).toBe("medium");
    });

    it("classifies Logistics Manager as medium", () => {
      expect(classifyRoleRelevance("Logistics Manager", null)).toBe("medium");
    });
  });

  // ── LOW RELEVANCE: Corporate executives ──
  describe("low relevance — corporate executives", () => {
    it("classifies CEO as low", () => {
      expect(classifyRoleRelevance("CEO", null)).toBe("low");
    });

    it("classifies Chief Executive Officer as low", () => {
      expect(classifyRoleRelevance("Chief Executive Officer", "general_manager")).toBe("low");
    });

    it("classifies Managing Director as low", () => {
      expect(classifyRoleRelevance("Managing Director", null)).toBe("low");
    });

    it("classifies CFO as low", () => {
      expect(classifyRoleRelevance("CFO", null)).toBe("low");
    });

    it("classifies Chairman as low", () => {
      expect(classifyRoleRelevance("Chairman of the Board", null)).toBe("low");
    });

    it("classifies Non-Executive Director as low", () => {
      expect(classifyRoleRelevance("Non-Executive Director", null)).toBe("low");
    });
  });

  // ── LOW RELEVANCE: Finance & legal ──
  describe("low relevance — finance, legal, HR", () => {
    it("classifies Finance Director as low", () => {
      expect(classifyRoleRelevance("Finance Director", null)).toBe("low");
    });

    it("classifies Financial Controller as low", () => {
      expect(classifyRoleRelevance("Financial Controller", null)).toBe("low");
    });

    it("classifies General Counsel as low", () => {
      expect(classifyRoleRelevance("General Counsel", null)).toBe("low");
    });

    it("classifies HR Manager as low", () => {
      expect(classifyRoleRelevance("HR Manager", null)).toBe("low");
    });

    it("classifies Marketing Director as low", () => {
      expect(classifyRoleRelevance("Marketing Director", null)).toBe("low");
    });

    it("classifies Investor Relations as low", () => {
      expect(classifyRoleRelevance("Investor Relations Manager", null)).toBe("low");
    });

    it("classifies Compliance Manager as low", () => {
      expect(classifyRoleRelevance("Compliance Manager", null)).toBe("low");
    });
  });

  // ── PRIORITY ORDER: High > Low > Medium ──
  describe("priority ordering — high beats low beats medium", () => {
    it("title with both construction manager and director → high wins", () => {
      // "Construction Director" contains "construction" keywords
      expect(classifyRoleRelevance("Construction Director", null)).toBe("high");
    });

    it("Operations Manager beats generic director fallback", () => {
      expect(classifyRoleRelevance("Operations Manager", null)).toBe("high");
    });
  });

  // ── ROLE BUCKET FALLBACK ──
  describe("role bucket fallback — when title has no keyword match", () => {
    it("procurement bucket → high", () => {
      expect(classifyRoleRelevance("Senior Buyer", "procurement")).toBe("high");
    });

    it("project_manager bucket → high", () => {
      expect(classifyRoleRelevance("PM Lead", "project_manager")).toBe("high");
    });

    it("engineering bucket → high", () => {
      expect(classifyRoleRelevance("Lead Technical Specialist", "engineering")).toBe("high");
    });

    it("commercial bucket → medium", () => {
      expect(classifyRoleRelevance("Bid Coordinator", "commercial")).toBe("medium");
    });

    it("general_manager bucket → low", () => {
      expect(classifyRoleRelevance("Senior Leader", "general_manager")).toBe("low");
    });
  });

  // ── GENERIC TITLE FALLBACK ──
  describe("generic title fallback — manager/engineer/director keywords", () => {
    it("unknown 'manager' title defaults to medium", () => {
      expect(classifyRoleRelevance("Regional Manager", null)).toBe("medium");
    });

    it("unknown 'engineer' title defaults to medium", () => {
      expect(classifyRoleRelevance("Systems Engineer", null)).toBe("medium");
    });

    it("unknown 'superintendent' title defaults to medium", () => {
      expect(classifyRoleRelevance("Superintendent", null)).toBe("medium");
    });

    it("unknown 'director' title defaults to low", () => {
      expect(classifyRoleRelevance("Director", null)).toBe("low");
    });
  });

  // ── EDGE CASES ──
  describe("edge cases", () => {
    it("null title and null roleBucket → medium (default)", () => {
      expect(classifyRoleRelevance(null, null)).toBe("medium");
    });

    it("empty title and empty roleBucket → medium (default)", () => {
      expect(classifyRoleRelevance("", "")).toBe("medium");
    });

    it("undefined title and undefined roleBucket → medium (default)", () => {
      expect(classifyRoleRelevance(undefined, undefined)).toBe("medium");
    });

    it("case insensitive — CONSTRUCTION MANAGER → high", () => {
      expect(classifyRoleRelevance("CONSTRUCTION MANAGER", null)).toBe("high");
    });

    it("case insensitive — ceo → low", () => {
      expect(classifyRoleRelevance("ceo", null)).toBe("low");
    });

    it("title with extra whitespace → still matches", () => {
      expect(classifyRoleRelevance("  Project Manager  ", null)).toBe("high");
    });

    it("title with company suffix → still matches", () => {
      expect(classifyRoleRelevance("Construction Manager at BHP", null)).toBe("high");
    });

    it("title with location → still matches", () => {
      expect(classifyRoleRelevance("Procurement Manager - Perth, WA", "procurement")).toBe("high");
    });
  });

  // ── REAL-WORLD TITLES ──
  describe("real-world title scenarios", () => {
    it("Senior Project Manager, Major Projects → high", () => {
      expect(classifyRoleRelevance("Senior Project Manager, Major Projects", "project_manager")).toBe("high");
    });

    it("General Manager, Corporate Strategy → low (GM bucket maps to low)", () => {
      // No keyword match in HIGH/LOW/MEDIUM. roleBucket 'general_manager' maps to 'low'.
      // Step 4 catches it before the generic 'manager' fallback at Step 5.
      expect(classifyRoleRelevance("General Manager, Corporate Strategy", "general_manager")).toBe("low");
    });

    it("Chief Operating Officer → low", () => {
      expect(classifyRoleRelevance("Chief Operating Officer", null)).toBe("low");
    });

    it("Head of Procurement → medium (head of + procurement)", () => {
      expect(classifyRoleRelevance("Head of Procurement", "procurement")).toBe("medium");
    });

    it("VP Construction → medium", () => {
      expect(classifyRoleRelevance("VP Construction", null)).toBe("medium");
    });

    it("Drill and Blast Engineer → high", () => {
      expect(classifyRoleRelevance("Drill and Blast Engineer", null)).toBe("high");
    });

    it("Open Cut Manager → high", () => {
      expect(classifyRoleRelevance("Open Cut Manager", null)).toBe("high");
    });

    it("Underground Manager → high", () => {
      expect(classifyRoleRelevance("Underground Manager", null)).toBe("high");
    });
  });

  // ── KEYWORD LISTS INTEGRITY ──
  describe("keyword list integrity", () => {
    it("HIGH keywords are all lowercase", () => {
      HIGH_RELEVANCE_KEYWORDS.forEach(kw => {
        expect(kw).toBe(kw.toLowerCase());
      });
    });

    it("MEDIUM keywords are all lowercase", () => {
      MEDIUM_RELEVANCE_KEYWORDS.forEach(kw => {
        expect(kw).toBe(kw.toLowerCase());
      });
    });

    it("LOW keywords are all lowercase", () => {
      LOW_RELEVANCE_KEYWORDS.forEach(kw => {
        expect(kw).toBe(kw.toLowerCase());
      });
    });

    it("no duplicate keywords across HIGH/MEDIUM/LOW lists", () => {
      const all = [...HIGH_RELEVANCE_KEYWORDS, ...MEDIUM_RELEVANCE_KEYWORDS, ...LOW_RELEVANCE_KEYWORDS];
      const unique = new Set(all);
      expect(unique.size).toBe(all.length);
    });

    it("ROLE_BUCKET_RELEVANCE has valid values", () => {
      Object.values(ROLE_BUCKET_RELEVANCE).forEach(val => {
        expect(["high", "medium", "low"]).toContain(val);
      });
    });
  });

  // ── CONTACT SORTING IMPACT ──
  describe("contact sorting impact — high should rank above low", () => {
    const contacts = [
      { name: "CEO", relevance: classifyRoleRelevance("CEO", null) },
      { name: "Project Manager", relevance: classifyRoleRelevance("Project Manager", "project_manager") },
      { name: "Marketing Director", relevance: classifyRoleRelevance("Marketing Director", null) },
      { name: "Construction Manager", relevance: classifyRoleRelevance("Construction Manager", null) },
      { name: "Commercial Manager", relevance: classifyRoleRelevance("Commercial Manager", "commercial") },
    ];

    it("Project Manager and Construction Manager are high", () => {
      const highContacts = contacts.filter(c => c.relevance === "high");
      expect(highContacts.map(c => c.name)).toContain("Project Manager");
      expect(highContacts.map(c => c.name)).toContain("Construction Manager");
    });

    it("CEO and Marketing Director are low", () => {
      const lowContacts = contacts.filter(c => c.relevance === "low");
      expect(lowContacts.map(c => c.name)).toContain("CEO");
      expect(lowContacts.map(c => c.name)).toContain("Marketing Director");
    });

    it("Commercial Manager is medium", () => {
      const mediumContacts = contacts.filter(c => c.relevance === "medium");
      expect(mediumContacts.map(c => c.name)).toContain("Commercial Manager");
    });
  });
});
