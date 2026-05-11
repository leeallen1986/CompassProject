/**
 * Digest Hardening Gates — Test Replay of Known Failure Patterns
 *
 * These tests replay real failure modes discovered during manual QA:
 * 1. Bill Faber — wrong company (US Water Services, not Water Corporation WA)
 * 2. Melanie Mayne — fabricated email from P.E. suffix parse error
 * 3. Prison/school/hospital junk reaching Must Act
 * 4. LLM-inferred contact as primary
 * 5. Truncated domain (wateroration.com.au)
 * 6. Delta regression (weaker project displacing stronger)
 * 7. University professor in industrial digest
 */

import { describe, it, expect } from "vitest";
import {
  checkJunkSuppression,
  checkContactDefensibility,
  runRepSendGate,
  computeDelta,
  type RepSendGateResult,
} from "./digestHardeningGates";

// ═══════════════════════════════════════════════════════════════════════════════
// TEST DATA — Real failure cases from manual QA sessions
// ═══════════════════════════════════════════════════════════════════════════════

const BILL_FABER_CONTACT = {
  name: "Bill Faber",
  email: "bill.faber@wateroration.com.au",
  title: "Asset/Fleet Manager at U,S.Water Services Corporation",
  company: "U.S. Water Services",
  trustTier: "send_ready",
  source: "apollo",
  verificationScore: 92,
  isDowngraded: false,
  isLlmInferred: false,
};

const MELANIE_MAYNE_CONTACT = {
  name: "Melanie Mayne P.E.",
  email: "melanie.pe@worley.com.au",
  title: "Senior Process Engineer",
  company: "Worley",
  trustTier: "send_ready",
  source: "apollo",
  verificationScore: 95,
  isDowngraded: false,
  isLlmInferred: false,
};

const VALID_CONTACT = {
  name: "John Vedova",
  email: "john.vedova@monadelphous.com.au",
  title: "General Manager - Engineering",
  company: "Monadelphous Group",
  trustTier: "send_ready",
  source: "apollo",
  verificationScore: 97,
  isDowngraded: false,
  isLlmInferred: false,
};

const LLM_INFERRED_CONTACT = {
  name: "Sarah Thompson",
  email: "sarah.thompson@bhp.com",
  title: "Procurement Manager",
  company: "BHP",
  trustTier: "send_ready",
  source: "llm_inferred",
  verificationScore: null,
  isDowngraded: false,
  isLlmInferred: true,
};

const UNIVERSITY_CONTACT = {
  name: "Prof. James Wilson",
  email: "j.wilson@sydney.edu.au",
  title: "Professor of Mining Engineering",
  company: "University of Sydney",
  trustTier: "send_ready",
  source: "web_search",
  verificationScore: 85,
  isDowngraded: false,
  isLlmInferred: false,
};

// ═══════════════════════════════════════════════════════════════════════════════
// PART D — JUNK SUPPRESSION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Junk Suppression Gate", () => {
  it("catches prison projects for Portable Air", () => {
    const result = checkJunkSuppression(
      { name: "New Maximum Security Prison Facility", overview: "Construction of 500-bed correctional facility", sector: "infrastructure", owner: "Department of Justice" },
      "portable_air",
    );
    expect(result.isJunk).toBe(true);
    expect(result.pattern).toContain("prison");
  });

  it("catches school projects for Portable Air", () => {
    const result = checkJunkSuppression(
      { name: "Regional High School Expansion", overview: "New classrooms and gymnasium", sector: "education", owner: "Department of Education" },
      "portable_air",
    );
    expect(result.isJunk).toBe(true);
  });

  it("catches hospital projects for Portable Air", () => {
    const result = checkJunkSuppression(
      { name: "Metropolitan Hospital Redevelopment", overview: "New emergency department and ward block", sector: "health", owner: "NSW Health" },
      "portable_air",
    );
    expect(result.isJunk).toBe(true);
  });

  it("catches data centre projects for Portable Air", () => {
    const result = checkJunkSuppression(
      { name: "Hyperscale Data Centre Development", overview: "500MW data centre campus", sector: "technology", owner: "Microsoft Azure" },
      "portable_air",
    );
    expect(result.isJunk).toBe(true);
  });

  it("allows mining projects for Portable Air", () => {
    const result = checkJunkSuppression(
      { name: "Mulgine Trench Gold Mine Expansion", overview: "Underground gold mine development", sector: "mining", owner: "Tungsten Mining" },
      "portable_air",
    );
    expect(result.isJunk).toBe(false);
  });

  it("allows BESS projects for PAL/BESS lane", () => {
    const result = checkJunkSuppression(
      { name: "Richmond Valley Solar and BESS", overview: "200MW solar farm with 400MWh battery", sector: "energy", owner: "Ark Energy" },
      "pal_bess",
    );
    expect(result.isJunk).toBe(false);
  });

  it("catches student housing for Portable Air", () => {
    const result = checkJunkSuppression(
      { name: "Large-Scale Student Housing Project", overview: "1200-bed student accommodation", sector: "residential", owner: "UniLodge" },
      "portable_air",
    );
    expect(result.isJunk).toBe(true);
  });

  it("catches police station for Portable Air", () => {
    const result = checkJunkSuppression(
      { name: "New Police Station and Emergency Services Hub", overview: "Police station with custody suite", sector: "government", owner: "WA Police" },
      "portable_air",
    );
    expect(result.isJunk).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PART B — CONTACT DEFENSIBILITY TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Contact Defensibility Gate", () => {
  it("catches Bill Faber — wrong company (US Water Services vs Water Corporation WA)", () => {
    const result = checkContactDefensibility(
      BILL_FABER_CONTACT,
      { name: "Regional WA Water Pipeline", owner: "Water Corporation", contractors: ["Monadelphous", "Downer"] },
      "portable_air",
    );
    expect(result.passes).toBe(false);
    expect(result.failedChecks).toContain("domain_not_defensible");
  });

  it("catches Melanie Mayne — fabricated email from PE suffix", () => {
    const result = checkContactDefensibility(
      MELANIE_MAYNE_CONTACT,
      { name: "Multiple Large-Scale Renewable Energy", owner: "Worley", contractors: null },
      "portable_air",
    );
    // The email pattern melanie.pe@ is suspicious — "pe" is not a surname
    expect(result.passes).toBe(false);
  });

  it("catches truncated domain (wateroration.com.au)", () => {
    const contact = { ...VALID_CONTACT, email: "john.smith@wateroration.com.au", company: "Water Corporation" };
    const result = checkContactDefensibility(
      contact,
      { name: "Regional WA Water Pipeline", owner: "Water Corporation", contractors: null },
      "portable_air",
    );
    expect(result.passes).toBe(false);
    expect(result.failedChecks).toContain("domain_not_defensible");
  });

  it("catches LLM-inferred contact", () => {
    const result = checkContactDefensibility(
      LLM_INFERRED_CONTACT,
      { name: "Iron Ore Expansion", owner: "BHP", contractors: null },
      "portable_air",
    );
    expect(result.passes).toBe(false);
    expect(result.failedChecks).toContain("llm_inferred_primary");
  });

  it("catches university professor in industrial context", () => {
    const result = checkContactDefensibility(
      UNIVERSITY_CONTACT,
      { name: "Gold Mine Expansion", owner: "Newcrest Mining", contractors: ["Byrnecut"] },
      "portable_air",
    );
    expect(result.passes).toBe(false);
    // University contacts are caught by domain (.edu.au) and/or title (professor)
    const hasDomainOrTitleFail = result.failedChecks.includes("non_defensible_domain") ||
      result.failedChecks.includes("non_industrial_title") ||
      result.failedChecks.includes("cross_industry_mismatch");
    expect(hasDomainOrTitleFail).toBe(true);
  });

  it("passes valid industrial contact", () => {
    const result = checkContactDefensibility(
      VALID_CONTACT,
      { name: "Regional WA Water Pipeline", owner: "Water Corporation", contractors: ["Monadelphous Group"] },
      "portable_air",
    );
    expect(result.passes).toBe(true);
    expect(result.failedChecks).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PART A — REP SEND GATE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Rep Send Gate", () => {
  it("HOLDS rep when all top 3 have junk projects", () => {
    const result = runRepSendGate(
      1, "Test Rep",
      [
        { id: 1, name: "New Prison Facility", laneFitLabel: "High", bestContact: VALID_CONTACT },
        { id: 2, name: "Regional School Expansion", laneFitLabel: "High", bestContact: VALID_CONTACT },
        { id: 3, name: "Hospital Redevelopment", laneFitLabel: "High", bestContact: VALID_CONTACT },
      ],
      "portable_air",
    );
    expect(result.decision).toBe("HOLD");
    expect(result.blockers.some(b => b.criterion === "no_junk_in_must_act")).toBe(true);
  });

  it("HOLDS rep when fewer than 2 contacts are defensible", () => {
    const result = runRepSendGate(
      1, "Test Rep",
      [
        { id: 1, name: "Gold Mine Expansion", laneFitLabel: "High", bestContact: LLM_INFERRED_CONTACT },
        { id: 2, name: "Iron Ore Development", laneFitLabel: "High", bestContact: null },
        { id: 3, name: "Copper Mine", laneFitLabel: "High", bestContact: VALID_CONTACT },
      ],
      "portable_air",
    );
    expect(result.decision).toBe("HOLD");
    // Should be HOLD due to either insufficient_defensible_contacts or no_llm_inferred_primary or wrong_contact_pattern
    const hasRelevantBlocker = result.blockers.some(b =>
      b.criterion === "insufficient_defensible_contacts" ||
      b.criterion === "no_llm_inferred_primary" ||
      b.criterion === "wrong_contact_pattern" ||
      b.criterion === "contact_not_defensible"
    );
    expect(hasRelevantBlocker).toBe(true);
  });

  it("HOLDS rep when LLM-inferred contact is primary", () => {
    const result = runRepSendGate(
      1, "Test Rep",
      [
        { id: 1, name: "Gold Mine Expansion", laneFitLabel: "High", bestContact: LLM_INFERRED_CONTACT },
        { id: 2, name: "Iron Ore Development", laneFitLabel: "High", bestContact: VALID_CONTACT },
        { id: 3, name: "Copper Mine", laneFitLabel: "High", bestContact: VALID_CONTACT },
      ],
      "portable_air",
    );
    expect(result.decision).toBe("HOLD");
    expect(result.blockers.some(b => b.criterion === "no_llm_inferred_primary")).toBe(true);
  });

  it("SENDS rep when all criteria pass", () => {
    const result = runRepSendGate(
      1, "Test Rep",
      [
        { id: 1, name: "Mulgine Trench Gold Mine", laneFitLabel: "High", bestContact: VALID_CONTACT, owner: "Tungsten Mining", contractors: ["Byrnecut"] },
        { id: 2, name: "United North Underground", laneFitLabel: "High", bestContact: { ...VALID_CONTACT, name: "Mark Smith", email: "mark.smith@nrw.com.au", company: "NRW Holdings" }, owner: "Rox Resources", contractors: ["NRW Holdings"] },
        { id: 3, name: "Fortescue Iron Bridge", laneFitLabel: "Medium", bestContact: { ...VALID_CONTACT, name: "Tim Brown", email: "tim.brown@fortescue.com", company: "Fortescue" }, owner: "Fortescue", contractors: ["Monadelphous Group"] },
      ],
      "portable_air",
    );
    expect(result.decision).toBe("SEND");
    expect(result.blockers.filter(b => b.severity === "blocking")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PART C — DELTA REGRESSION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Delta Regression Detection", () => {
  it("detects when a weaker project displaces a stronger one", () => {
    const before = [
      { id: 1, name: "Strong Mining Project", relevanceScore: 95, contactQuality: 97 },
      { id: 2, name: "Good Infrastructure", relevanceScore: 88, contactQuality: 92 },
      { id: 3, name: "Solid Energy Project", relevanceScore: 85, contactQuality: 90 },
    ];
    const after = [
      { id: 1, name: "Strong Mining Project", relevanceScore: 95, contactQuality: 97 },
      { id: 2, name: "Good Infrastructure", relevanceScore: 88, contactQuality: 92 },
      { id: 4, name: "Weak Newcomer", relevanceScore: 60, contactQuality: 50 },
    ];
    const result = computeDelta(1, "Test Rep", before, after);
    expect(result.qualityDelta).toBe("weakened");
    expect(result.flaggedForReview).toBe(true);
    // The implementation uses "promoted" for new entries and "demoted" for removed ones
    expect(result.changes.some(c => c.type === "promoted" && c.projectName === "Weak Newcomer")).toBe(true);
    expect(result.changes.some(c => c.type === "demoted" && c.projectName === "Solid Energy Project")).toBe(true);
  });

  it("does not flag when quality improves", () => {
    const before = [
      { id: 1, name: "Mining Project", relevanceScore: 80, contactQuality: 70 },
      { id: 2, name: "Infrastructure", relevanceScore: 75, contactQuality: 65 },
      { id: 3, name: "Energy Project", relevanceScore: 70, contactQuality: 60 },
    ];
    const after = [
      { id: 1, name: "Mining Project", relevanceScore: 80, contactQuality: 70 },
      { id: 4, name: "Better Project", relevanceScore: 92, contactQuality: 95 },
      { id: 3, name: "Energy Project", relevanceScore: 70, contactQuality: 60 },
    ];
    const result = computeDelta(1, "Test Rep", before, after);
    expect(result.qualityDelta).toBe("improved");
    expect(result.flaggedForReview).toBe(false);
  });

  it("handles unchanged top 3", () => {
    const before = [
      { id: 1, name: "Mining Project", relevanceScore: 80, contactQuality: 70 },
      { id: 2, name: "Infrastructure", relevanceScore: 75, contactQuality: 65 },
      { id: 3, name: "Energy Project", relevanceScore: 70, contactQuality: 60 },
    ];
    const result = computeDelta(1, "Test Rep", before, before);
    expect(result.qualityDelta).toBe("unchanged");
    expect(result.flaggedForReview).toBe(false);
    expect(result.changes).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX VALIDATION — isTruncatedDomain false positives (2026-05-11)
// These test cases validate the fix for ICN-registered legal names causing
// legitimate corporate domains to be falsely flagged as truncated.
// ═══════════════════════════════════════════════════════════════════════════════
describe("isTruncatedDomain fix — ICN legal name false positives", () => {
  it("passes fortescuemetals.com.au with ICN owner 'Fortescue Metals Group Ltd'", () => {
    const contact = { ...VALID_CONTACT, email: "john.smith@fortescuemetals.com.au", company: "Fortescue Metals Group" };
    const result = checkContactDefensibility(
      contact,
      { name: "Iron Bridge Magnetite", owner: "Fortescue Metals Group Ltd", contractors: null },
      "portable_air",
    );
    expect(result.failedChecks).not.toContain("domain_not_defensible");
  });

  it("passes chevron.com.au with ICN owner 'Chevron Australia Pty Limited'", () => {
    const contact = { ...VALID_CONTACT, email: "jane.doe@chevron.com.au", company: "Chevron Australia" };
    const result = checkContactDefensibility(
      contact,
      { name: "Gorgon Stage 2", owner: "Chevron Australia Pty Limited", contractors: null },
      "portable_air",
    );
    expect(result.failedChecks).not.toContain("domain_not_defensible");
  });

  it("passes woodsideenergy.com with ICN owner 'Woodside Energy Ltd'", () => {
    const contact = { ...VALID_CONTACT, email: "ops@woodsideenergy.com", company: "Woodside Energy" };
    const result = checkContactDefensibility(
      contact,
      { name: "Scarborough Gas", owner: "Woodside Energy Ltd", contractors: null },
      "portable_air",
    );
    expect(result.failedChecks).not.toContain("domain_not_defensible");
  });

  it("passes baesystems.com.au with ICN owner 'BAE Systems Australia Limited'", () => {
    const contact = { ...VALID_CONTACT, email: "procurement@baesystems.com.au", company: "BAE Systems" };
    const result = checkContactDefensibility(
      contact,
      { name: "Hunter Class Frigate", owner: "BAE Systems Australia Limited", contractors: null },
      "portable_air",
    );
    expect(result.failedChecks).not.toContain("domain_not_defensible");
  });

  it("still catches genuine truncation (wateroration.com.au)", () => {
    const contact = { ...VALID_CONTACT, email: "john.smith@wateroration.com.au", company: "Water Corporation" };
    const result = checkContactDefensibility(
      contact,
      { name: "Regional WA Water Pipeline", owner: "Water Corporation", contractors: null },
      "portable_air",
    );
    expect(result.passes).toBe(false);
    expect(result.failedChecks).toContain("domain_not_defensible");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX VALIDATION — Government domain allowlist (2026-05-11)
// These test cases validate that verified government procurement domains
// are no longer blanket-blocked by the .gov.au exclusion.
// ═══════════════════════════════════════════════════════════════════════════════
describe("Government domain allowlist", () => {
  it("passes cyber.qld.gov.au (allowlisted)", () => {
    const contact = { ...VALID_CONTACT, email: "procurement@cyber.qld.gov.au", company: "QLD Cyber Infrastructure" };
    const result = checkContactDefensibility(
      contact,
      { name: "QLD Cyber Security Centre", owner: "Queensland Government", contractors: null },
      "portable_air",
    );
    expect(result.failedChecks).not.toContain("non_defensible_domain");
  });

  it("passes defence.gov.au (allowlisted)", () => {
    const contact = { ...VALID_CONTACT, email: "ops@defence.gov.au", company: "Department of Defence" };
    const result = checkContactDefensibility(
      contact,
      { name: "LAND 400 Phase 3", owner: "Australian Defence", contractors: ["Rheinmetall"] },
      "portable_air",
    );
    expect(result.failedChecks).not.toContain("non_defensible_domain");
  });

  it("still blocks random .gov.au domains not in allowlist", () => {
    const contact = { ...VALID_CONTACT, email: "info@treasury.gov.au", company: "Treasury" };
    const result = checkContactDefensibility(
      contact,
      { name: "Budget Office Renovation", owner: "Commonwealth Treasury", contractors: null },
      "portable_air",
    );
    expect(result.failedChecks).toContain("non_defensible_domain");
  });

  it("still blocks .edu.au domains", () => {
    const contact = { ...VALID_CONTACT, email: "prof@sydney.edu.au", company: "University of Sydney" };
    const result = checkContactDefensibility(
      contact,
      { name: "Campus Expansion", owner: "University of Sydney", contractors: null },
      "portable_air",
    );
    expect(result.failedChecks).toContain("non_defensible_domain");
  });
});
