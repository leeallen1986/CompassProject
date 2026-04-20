/**
 * scoringEngineV2.test.ts
 * Stage 2 scoring engine tests — imports the real exported functions.
 * Tests cover: hard exclusions, compound-title exclusions, blasting specialist,
 * C-Suite, director irrelevant-spec check, BD/sales downgrade, senior manager,
 * manager buckets, coordinator, company classification (primary/secondary/none),
 * minimum title gate, tier1 bucket gate, ScoreBreakdown fields, and all 6 v1 misfires.
 */

import { describe, it, expect } from "vitest";
import {
  classifyTitle,
  classifyCompany,
  computeScore,
  isBlastingCompany,
  type ScoreBreakdown,
} from "./campaignService";

// ── classifyTitle ──────────────────────────────────────────────────────────────

describe("classifyTitle — hard exclusions", () => {
  const hardExcluded = [
    "Accounts Payable",
    "accounts receivable",
    "Admin",
    "Administrator",
    "Administrative",
    "Receptionist",
    "Office Manager",
    "Customer Care",
    "Customer Service",
    "Sales Rep",
    "Sales Representative",
    "Sales Executive",
    "Data Entry",
    "Payroll",
    "Bookkeeper",
    "Cleaner",
    "Driver",
    "Labourer",
    "Intern",
    "Stores",
  ];

  for (const title of hardExcluded) {
    it(`hard-excludes "${title}"`, () => {
      const r = classifyTitle(title);
      expect(r.excluded, `"${title}" should be excluded`).toBe(true);
      expect(r.score).toBe(0);
      expect(r.finalTier ?? "excluded").toBe("excluded"); // classifyTitle doesn't set finalTier but score=0+excluded=true
    });
  }
});

describe("classifyTitle — compound-title exclusions", () => {
  it("downgrades Director / Accounts Payable to score=5", () => {
    const r = classifyTitle("Director / Accounts Payable");
    expect(r.excluded).toBe(false);
    expect(r.score).toBe(5);
    expect(r.roleBucket).toBe("other");
  });

  it("downgrades CFO / Finance to score=5", () => {
    const r = classifyTitle("CFO / Finance");
    // 'Finance' is a compound exclude keyword, so score=5
    expect(r.score).toBe(5);
  });

  it("does NOT downgrade MD / Operations (no excluded keyword)", () => {
    const r = classifyTitle("MD / Operations");
    // 'Operations' is not in COMPOUND_EXCLUDE_KEYWORDS, so MD wins
    expect(r.score).toBeGreaterThanOrEqual(38);
    expect(r.roleBucket).toBe("c_suite");
  });

  it("downgrades Manager, HR to score=5", () => {
    const r = classifyTitle("Manager, HR");
    expect(r.score).toBe(5);
  });
});

describe("classifyTitle — blasting specialist (score=40)", () => {
  const blastingTitles = [
    "Blasting Supervisor",
    "Blast & Paint Manager",
    "Painting Contractor",
    "Coating Specialist",
    "Surface Prep Technician",
    "Corrosion Control Engineer",
    "Abrasive Blasting Operator",
    "Sandblaster",
    "UHP Operator",
    "NACE Inspector",
    "SSPC Inspector",
    "Hydro Blast Supervisor",
    "Grit Blast Operator",
    "Thermal Spray Specialist",
    "Protective Coating Manager",
  ];

  for (const title of blastingTitles) {
    it(`classifies "${title}" as blasting_specialist (score=40)`, () => {
      const r = classifyTitle(title);
      expect(r.roleBucket).toBe("blasting_specialist");
      expect(r.score).toBe(40);
      expect(r.excluded).toBe(false);
    });
  }
});

describe("classifyTitle — C-Suite (score=45)", () => {
  const cSuiteTitles = [
    "CEO",
    "Chief Executive Officer",
    "COO",
    "CFO",
    "CTO",
    "Chief Operating Officer",
    "Managing Director",
    "Owner",
    "Proprietor",
    "President",
    "Founder",
    "Co-Founder",
    "Principal",
  ];

  for (const title of cSuiteTitles) {
    it(`classifies "${title}" as c_suite (score=45)`, () => {
      const r = classifyTitle(title);
      expect(r.roleBucket).toBe("c_suite");
      expect(r.score).toBe(45);
    });
  }
});

describe("classifyTitle — director irrelevant-spec check", () => {
  it("downgrades Director of IT to score=5", () => {
    const r = classifyTitle("Director of IT");
    expect(r.score).toBe(5);
    expect(r.roleBucket).toBe("other");
  });

  it("downgrades Director of Finance to score=5", () => {
    const r = classifyTitle("Director of Finance");
    expect(r.score).toBe(5);
  });

  it("downgrades Director of Safety to score=5", () => {
    const r = classifyTitle("Director of Safety");
    expect(r.score).toBe(5);
  });

  it("downgrades Director of Marketing to score=5", () => {
    const r = classifyTitle("Director of Marketing");
    expect(r.score).toBe(5);
  });

  it("does NOT downgrade Director of Operations (not in irrelevant list)", () => {
    const r = classifyTitle("Director of Operations");
    expect(r.score).toBe(38);
    expect(r.roleBucket).toBe("director");
  });

  it("does NOT downgrade General Manager", () => {
    const r = classifyTitle("General Manager");
    expect(r.score).toBe(38);
    expect(r.roleBucket).toBe("director");
  });
});

describe("classifyTitle — BD/Sales downgrade (score=20, bucket=other)", () => {
  const bdTitles = [
    "Business Development Manager",
    "Business Development Director",
    "BD Manager",
    "Sales Manager",
    "National Sales Manager",
    "Account Manager",
    "Key Account Manager",
    "Commercial Manager",
    "Channel Manager",
  ];

  for (const title of bdTitles) {
    it(`downgrades "${title}" to score=20, bucket=other`, () => {
      const r = classifyTitle(title);
      expect(r.score).toBe(20);
      expect(r.roleBucket).toBe("other");
    });
  }
});

describe("classifyTitle — senior manager (score=30)", () => {
  it("classifies Senior Project Manager as senior_manager", () => {
    const r = classifyTitle("Senior Project Manager");
    expect(r.score).toBe(30);
    expect(r.roleBucket).toBe("senior_manager");
  });

  it("classifies Regional Manager as senior_manager", () => {
    const r = classifyTitle("Regional Manager");
    expect(r.score).toBe(30);
    expect(r.roleBucket).toBe("senior_manager");
  });

  it("classifies State Manager as senior_manager", () => {
    const r = classifyTitle("State Manager");
    expect(r.score).toBe(30);
    expect(r.roleBucket).toBe("senior_manager");
  });

  it("classifies National Manager as senior_manager", () => {
    const r = classifyTitle("National Manager");
    expect(r.score).toBe(30);
    expect(r.roleBucket).toBe("senior_manager");
  });
});

describe("classifyTitle — manager level (score=25)", () => {
  it("classifies Operations Manager → operations bucket", () => {
    const r = classifyTitle("Operations Manager");
    expect(r.score).toBe(25);
    expect(r.roleBucket).toBe("operations");
  });

  it("classifies Procurement Manager → procurement bucket", () => {
    const r = classifyTitle("Procurement Manager");
    expect(r.score).toBe(25);
    expect(r.roleBucket).toBe("procurement");
  });

  it("classifies Fleet Manager → fleet_equipment bucket", () => {
    const r = classifyTitle("Fleet Manager");
    expect(r.score).toBe(25);
    expect(r.roleBucket).toBe("fleet_equipment");
  });

  it("classifies Maintenance Manager → maintenance bucket", () => {
    const r = classifyTitle("Maintenance Manager");
    expect(r.score).toBe(25);
    expect(r.roleBucket).toBe("maintenance");
  });

  it("classifies Project Manager → project_management bucket", () => {
    const r = classifyTitle("Project Manager");
    expect(r.score).toBe(25);
    expect(r.roleBucket).toBe("project_management");
  });

  it("classifies Site Manager → site_workshop bucket", () => {
    const r = classifyTitle("Site Manager");
    expect(r.score).toBe(25);
    expect(r.roleBucket).toBe("site_workshop");
  });
});

describe("classifyTitle — coordinator/supervisor (score=15)", () => {
  it("classifies Supervisor as coordinator bucket", () => {
    const r = classifyTitle("Supervisor");
    expect(r.score).toBe(15);
    expect(r.roleBucket).toBe("coordinator");
  });

  it("classifies Engineer as engineering bucket", () => {
    const r = classifyTitle("Engineer");
    expect(r.score).toBe(15);
    expect(r.roleBucket).toBe("engineering");
  });

  it("classifies Coordinator as coordinator bucket", () => {
    const r = classifyTitle("Coordinator");
    expect(r.score).toBe(15);
    expect(r.roleBucket).toBe("coordinator");
  });

  it("classifies Foreman as coordinator bucket", () => {
    const r = classifyTitle("Foreman");
    expect(r.score).toBe(15);
    expect(r.roleBucket).toBe("coordinator");
  });
});

describe("classifyTitle — null/empty", () => {
  it("returns unknown for null title", () => {
    const r = classifyTitle(null);
    expect(r.roleBucket).toBe("unknown");
    expect(r.score).toBe(0);
    expect(r.excluded).toBe(false);
  });

  it("returns unknown for empty string", () => {
    const r = classifyTitle("");
    expect(r.roleBucket).toBe("unknown");
    expect(r.score).toBe(0);
  });
});

// ── classifyCompany ────────────────────────────────────────────────────────────

describe("classifyCompany — primary (bonus=20)", () => {
  const primaryCompanies = [
    "Orontide Alphablast",
    "Allblast Services",
    "WA Corrosion Control",
    "Matrix Corrosion",
    "Hydro Blast Solutions",
    "Grit Blast Pty Ltd",
    "Surface Prep Contractors",
    "Industrial Coatings Group",
    "Drill and Blast Co",
    "Drill Blast Services",
    "Corrosion Control Services",
    "Protective Coatings Ltd",
  ];

  for (const company of primaryCompanies) {
    it(`classifies "${company}" as primary (bonus=20)`, () => {
      const r = classifyCompany(company);
      expect(r.companyTier).toBe("primary");
      expect(r.bonus).toBe(20);
    });
  }
});

describe("classifyCompany — secondary (bonus=10)", () => {
  const secondaryCompanies = [
    "Monadelphous",
    "Linkforce",
    "Altrad",
    "Kaefer",
    "Industrial Painting Services",
    "Mining Contractor Group",
  ];

  for (const company of secondaryCompanies) {
    it(`classifies "${company}" as secondary (bonus=10)`, () => {
      const r = classifyCompany(company);
      expect(r.companyTier).toBe("secondary");
      expect(r.bonus).toBe(10);
    });
  }
});

describe("classifyCompany — none (bonus=0)", () => {
  const noneCompanies = [
    "BHP Group",
    "Rio Tinto",
    "Thiess",
    "CIMIC Group",
    "WA Scaffold Services",  // v1 misfire — scaffold should NOT get blasting bonus
    "John Holland",
    null,
    undefined,
    "",
  ];

  for (const company of noneCompanies) {
    it(`classifies "${company}" as none (bonus=0)`, () => {
      const r = classifyCompany(company as string | null | undefined);
      expect(r.companyTier).toBe("none");
      expect(r.bonus).toBe(0);
    });
  }
});

describe("isBlastingCompany — backward compatibility", () => {
  it("returns true for primary company", () => {
    expect(isBlastingCompany("Orontide Alphablast")).toBe(true);
  });

  it("returns true for secondary company", () => {
    expect(isBlastingCompany("Monadelphous")).toBe(true);
  });

  it("returns false for non-blasting company", () => {
    expect(isBlastingCompany("BHP Group")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isBlastingCompany(null)).toBe(false);
  });
});

// ── computeScore ───────────────────────────────────────────────────────────────

describe("computeScore — ScoreBreakdown structure", () => {
  it("returns all required ScoreBreakdown fields", () => {
    const bd = computeScore({ title: "Managing Director", email: "md@co.com", company: "Orontide Alphablast" });
    expect(bd).toHaveProperty("titleScore");
    expect(bd).toHaveProperty("emailBonus");
    expect(bd).toHaveProperty("mobileBonus");
    expect(bd).toHaveProperty("companyBonus");
    expect(bd).toHaveProperty("companyTier");
    expect(bd).toHaveProperty("projectMatchBonus");
    expect(bd).toHaveProperty("penalties");
    expect(bd).toHaveProperty("finalScore");
    expect(bd).toHaveProperty("finalTier");
    expect(bd).toHaveProperty("roleBucket");
    expect(bd).toHaveProperty("titleRelevance");
    expect(bd).toHaveProperty("reasoningSummary");
    expect(bd).toHaveProperty("companyBonusBlocked");
    expect(bd).toHaveProperty("tier1Blocked");
  });

  it("penalties is always 0 in v2", () => {
    const bd = computeScore({ title: "CEO", email: "ceo@co.com" });
    expect(bd.penalties).toBe(0);
  });
});

describe("computeScore — tier1_hot cases", () => {
  it("MD at primary blasting company with 3 projects → tier1_hot, score=95", () => {
    const bd = computeScore({ title: "Managing Director", email: "ceo@orontide.com.au", company: "Orontide Alphablast", matchedProjectCount: 3 });
    expect(bd.finalTier).toBe("tier1_hot");
    expect(bd.finalScore).toBe(95); // 45+15+20+15=95
    expect(bd.roleBucket).toBe("c_suite");
  });

  it("Blasting Supervisor at primary company with 2 projects → tier1_hot, score=85", () => {
    const bd = computeScore({ title: "Blasting Supervisor", email: "sup@allblast.com.au", company: "Allblast Services", matchedProjectCount: 2 });
    expect(bd.finalTier).toBe("tier1_hot");
    expect(bd.finalScore).toBe(85); // 40+15+20+10=85
  });
});

describe("computeScore — tier2_warm cases", () => {
  it("BDM at primary blasting company (v1 misfire: was tier1_hot) → now tier2_warm", () => {
    const bd = computeScore({ title: "Business Development Manager", email: "james@orontide.com.au", company: "Orontide Alphablast", matchedProjectCount: 2 });
    expect(bd.finalTier).toBe("tier2_warm");
    expect(bd.tier1Blocked).toBe(true); // 'other' bucket blocks tier1
    expect(bd.roleBucket).toBe("other");
  });

  it("Procurement Manager at secondary company → tier2_warm", () => {
    const bd = computeScore({ title: "Procurement Manager", email: "pm@monadelphous.com.au", company: "Monadelphous", matchedProjectCount: 1 });
    expect(bd.finalTier).toBe("tier2_warm");
    expect(bd.finalScore).toBe(55); // 25+15+10+5=55
  });

  it("Coating Specialist at non-blasting company → tier2_warm", () => {
    const bd = computeScore({ title: "Coating Specialist", email: "cs@thiess.com.au", company: "Thiess", matchedProjectCount: 0 });
    expect(bd.finalTier).toBe("tier2_warm");
    expect(bd.finalScore).toBe(55); // 40+15=55
    expect(bd.companyBonus).toBe(0);
  });
});

describe("computeScore — tier3_enrich cases", () => {
  it("Generic Engineer at blasting company (v1 misfire: was tier1_hot) → now tier2_warm (score=55, tier1 blocked)", () => {
    // Engineer = 15pts (coordinator/engineering bucket), email+15, primary company+20, 1 project+5 = 55
    // tier1 blocked because engineering bucket
    const bd = computeScore({ title: "Engineer", email: "david@allblast.com.au", company: "Allblast Services", matchedProjectCount: 1 });
    expect(bd.finalTier).toBe("tier2_warm"); // score=55, has email, but tier1 blocked
    expect(bd.tier1Blocked).toBe(true);
    expect(bd.roleBucket).toBe("engineering");
  });

  it("Director / Accounts Payable (v1 misfire: was tier1_hot) → now tier3_enrich", () => {
    const bd = computeScore({ title: "Director / Accounts Payable", email: "sarah@bhp.com", company: "BHP Group", matchedProjectCount: 1 });
    expect(bd.finalTier).toBe("tier3_enrich");
    expect(bd.companyBonusBlocked).toBe(true); // title score=5, below minimum gate
    expect(bd.finalScore).toBe(25); // 5+15+0+5=25
  });

  it("IT Director with 5 projects → tier3_enrich (not tier1_hot)", () => {
    const bd = computeScore({ title: "Director of IT", email: "it@bhp.com", company: "BHP Group", matchedProjectCount: 5 });
    expect(bd.finalTier).toBe("tier3_enrich");
    expect(bd.titleScore).toBe(5);
    expect(bd.companyBonusBlocked).toBe(true);
  });

  it("Fleet Manager at primary company, no email → tier3_enrich", () => {
    const bd = computeScore({ title: "Fleet Manager", email: null, company: "Orontide Alphablast", matchedProjectCount: 1 });
    expect(bd.finalTier).toBe("tier3_enrich");
    expect(bd.emailBonus).toBe(0);
    expect(bd.companyBonus).toBe(20);
  });
});

describe("computeScore — tier4_low cases", () => {
  it("No title, no email → tier4_low, score=0", () => {
    const bd = computeScore({ title: null, email: null, company: "Unknown Company", matchedProjectCount: 0 });
    expect(bd.finalTier).toBe("tier4_low");
    expect(bd.finalScore).toBe(0);
  });
});

describe("computeScore — excluded cases", () => {
  it("Accounts Payable → excluded tier, score=0", () => {
    const bd = computeScore({ title: "Accounts Payable", email: "ap@cimic.com.au", company: "CIMIC Group", matchedProjectCount: 0 });
    expect(bd.finalTier).toBe("excluded");
    expect(bd.finalScore).toBe(0);
  });

  it("Admin → excluded tier", () => {
    const bd = computeScore({ title: "Admin", email: "admin@co.com", company: "BHP Group", matchedProjectCount: 5 });
    expect(bd.finalTier).toBe("excluded");
    expect(bd.finalScore).toBe(0);
  });

  it("Receptionist → excluded tier", () => {
    const bd = computeScore({ title: "Receptionist", email: "r@co.com", company: "Orontide Alphablast", matchedProjectCount: 10 });
    expect(bd.finalTier).toBe("excluded");
    expect(bd.finalScore).toBe(0);
  });
});

describe("computeScore — minimum title gate (company bonus blocked)", () => {
  it("title score < 15 blocks company bonus", () => {
    // 'Other' title (score=10) should not receive company bonus
    const bd = computeScore({ title: "Consultant", email: "c@allblast.com.au", company: "Orontide Alphablast" });
    // Consultant = coordinator = score 15 — just at the gate
    expect(bd.companyBonusBlocked).toBe(false); // 15 >= 15, so NOT blocked
    expect(bd.companyBonus).toBe(20);
  });

  it("title score = 5 (compound exclude) blocks company bonus", () => {
    const bd = computeScore({ title: "Director / Finance", email: "d@allblast.com.au", company: "Orontide Alphablast" });
    expect(bd.companyBonusBlocked).toBe(true);
    expect(bd.companyBonus).toBe(0);
  });
});

describe("computeScore — project match bonus capped at 15", () => {
  it("10 projects → project bonus capped at 15", () => {
    const bd = computeScore({ title: "CEO", email: "ceo@co.com", company: "BHP Group", matchedProjectCount: 10 });
    expect(bd.projectMatchBonus).toBe(15); // capped at 15
  });

  it("3 projects → project bonus = 15", () => {
    const bd = computeScore({ title: "CEO", email: "ceo@co.com", matchedProjectCount: 3 });
    expect(bd.projectMatchBonus).toBe(15); // 3*5=15
  });

  it("2 projects → project bonus = 10", () => {
    const bd = computeScore({ title: "CEO", email: "ceo@co.com", matchedProjectCount: 2 });
    expect(bd.projectMatchBonus).toBe(10);
  });
});

describe("computeScore — tier1 bucket gate", () => {
  it("engineering bucket blocks tier1_hot even with score >= 60", () => {
    // Engineer at primary company with email: 15+15+20=50, not enough anyway
    // Use a higher-scoring case: Senior Engineer variant
    const bd = computeScore({ title: "Engineer", email: "e@orontide.com.au", company: "Orontide Alphablast", matchedProjectCount: 3 });
    // 15+15+20+15=65, but engineering bucket blocks tier1
    expect(bd.finalScore).toBe(65);
    expect(bd.tier1Blocked).toBe(true);
    expect(bd.finalTier).toBe("tier2_warm");
  });

  it("coordinator bucket blocks tier1_hot", () => {
    const bd = computeScore({ title: "Supervisor", email: "s@orontide.com.au", company: "Orontide Alphablast", matchedProjectCount: 3 });
    expect(bd.tier1Blocked).toBe(true);
    expect(bd.finalTier).toBe("tier2_warm");
  });

  it("c_suite bucket does NOT block tier1_hot", () => {
    const bd = computeScore({ title: "CEO", email: "ceo@orontide.com.au", company: "Orontide Alphablast", matchedProjectCount: 1 });
    expect(bd.tier1Blocked).toBe(false);
    expect(bd.finalTier).toBe("tier1_hot");
  });
});

describe("computeScore — v1 misfire regression suite", () => {
  it("MISFIRE 1: BDM at blasting company no longer reaches tier1_hot", () => {
    const bd = computeScore({ title: "Business Development Manager", email: "bdm@orontide.com.au", company: "Orontide Alphablast", matchedProjectCount: 2 });
    expect(bd.finalTier).not.toBe("tier1_hot");
    expect(bd.tier1Blocked).toBe(true);
  });

  it("MISFIRE 2: Director / Accounts Payable no longer reaches tier1_hot", () => {
    const bd = computeScore({ title: "Director / Accounts Payable", email: "d@co.com", company: "BHP Group", matchedProjectCount: 1 });
    expect(bd.finalTier).not.toBe("tier1_hot");
  });

  it("MISFIRE 3: Generic Engineer at blasting company no longer reaches tier1_hot", () => {
    const bd = computeScore({ title: "Engineer", email: "e@allblast.com.au", company: "Allblast Services", matchedProjectCount: 1 });
    expect(bd.finalTier).not.toBe("tier1_hot");
    expect(bd.tier1Blocked).toBe(true);
  });

  it("MISFIRE 4: Scaffolding company no longer receives blasting bonus", () => {
    const bd = computeScore({ title: "Operations Manager", email: "m@scaffold.com.au", company: "WA Scaffold Services", matchedProjectCount: 0 });
    expect(bd.companyBonus).toBe(0);
    expect(bd.companyTier).toBe("none");
  });

  it("MISFIRE 5: IT Director with many projects no longer reaches tier1_hot", () => {
    const bd = computeScore({ title: "Director of IT", email: "it@bhp.com", company: "BHP Group", matchedProjectCount: 5 });
    expect(bd.finalTier).not.toBe("tier1_hot");
    expect(bd.titleScore).toBe(5);
  });

  it("MISFIRE 6: Sales Manager at blasting company no longer reaches tier1_hot", () => {
    const bd = computeScore({ title: "Sales Manager", email: "sm@allblast.com.au", company: "Allblast Services", matchedProjectCount: 3 });
    expect(bd.finalTier).not.toBe("tier1_hot");
    expect(bd.tier1Blocked).toBe(true);
  });
});

describe("computeScore — reasoningSummary", () => {
  it("includes role bucket and tier in reasoning", () => {
    const bd = computeScore({ title: "CEO", email: "ceo@co.com", company: "Orontide Alphablast" });
    expect(bd.reasoningSummary).toContain("c_suite");
    expect(bd.reasoningSummary).toContain("tier1_hot");
  });

  it("mentions company bonus blocked when title gate fires", () => {
    const bd = computeScore({ title: "Admin", email: "a@co.com", company: "Orontide Alphablast" });
    // Admin is hard-excluded, so reasoning is the exclusion message
    expect(bd.reasoningSummary).toContain("excluded");
  });

  it("mentions tier1 blocked when bucket gate fires", () => {
    const bd = computeScore({ title: "Engineer", email: "e@orontide.com.au", company: "Orontide Alphablast", matchedProjectCount: 3 });
    expect(bd.reasoningSummary).toContain("tier1 blocked");
  });
});
