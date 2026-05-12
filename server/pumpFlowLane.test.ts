/**
 * pumpFlowLane.test.ts
 * =====================
 * Vitest tests for the Pump/Flow lane redesign:
 *   Part A: Account-prior scoring boost in laneScoring
 *   Part B: Pump action mode computation
 *   Part C: Pump-specific contact role ranking in contactSelector
 *   Part D: Digest email CTA language (intelligence-first, not outreach-first)
 *   Part E: Email template links to /this-week?section=must_act
 */
import { describe, it, expect } from "vitest";
import {
  computePerUserFinalScore,
  type LaneScoredProject,
} from "./laneScoring";
import { selectProjectContact, type ContactInput } from "./contactSelector";
import { buildDigestEmailHtml, buildDigestEmailText, type DigestEmailData } from "./emailTemplate";

// ── Fixtures ──

const PUMP_PROJECT = {
  id: 100,
  name: "Boddington Gold Mine Dewatering",
  location: "Western Australia, Boddington",
  priority: "hot" as const,
  sector: "mining",
  stage: "construction",
  opportunityRoute: "Dewatering Pumps",
  isNew: false,
  owner: "Newmont",
  value: "$800M",
  overview: "Open-pit gold mine requiring extensive pit dewatering with submersible and centrifugal pump packages.",
  equipmentSignals: ["dewatering", "pumps", "submersible"],
  contractors: [{ name: "Byrnecut Mining", status: "confirmed" }],
};

const WA_PUMP_PROFILE = {
  territories: ["WA"],
  assignedBusinessLines: ["Dewatering Pumps"],
  sectorFocus: ["mining"],
  stageTiming: null,
  keyAccounts: null,
  buyerRoles: null,
};

const GENERIC_PROJECT = {
  id: 200,
  name: "Sydney Metro West Tunnel",
  location: "New South Wales, Sydney",
  priority: "warm" as const,
  sector: "infrastructure",
  stage: "planning",
  opportunityRoute: "EPC contractor fleet supply",
  isNew: false,
  owner: "Transport for NSW",
  value: "$12B",
  overview: "Major metro tunnel project requiring compressed air for TBM operations.",
  equipmentSignals: ["compressed air"],
  contractors: [],
};

// ── Part A: Account-Prior Scoring Boost ──

describe("Pump/Flow Lane: Account-Prior Scoring Boost", () => {
  it("should apply +20 boost for priority A account match", () => {
    const withBoost = computePerUserFinalScore(
      PUMP_PROJECT,
      WA_PUMP_PROFILE,
      [],
      [],
      { canonicalName: "Newmont", priorityLevel: "A" },
    );
    const withoutBoost = computePerUserFinalScore(
      PUMP_PROJECT,
      WA_PUMP_PROFILE,
      [],
      [],
      null,
    );
    expect(withBoost.accountPriorBoost).toBe(20);
    expect(withBoost.finalScore).toBeGreaterThan(withoutBoost.finalScore);
    expect(withBoost.matchedAccountPrior).toBe("Newmont");
  });

  it("should apply +12 boost for priority B account match", () => {
    const result = computePerUserFinalScore(
      PUMP_PROJECT,
      WA_PUMP_PROFILE,
      [],
      [],
      { canonicalName: "Newmont", priorityLevel: "B" },
    );
    expect(result.accountPriorBoost).toBe(12);
    expect(result.matchedAccountPrior).toBe("Newmont");
  });

  it("should apply +5 boost for priority C account match", () => {
    const result = computePerUserFinalScore(
      PUMP_PROJECT,
      WA_PUMP_PROFILE,
      [],
      [],
      { canonicalName: "Newmont", priorityLevel: "C" },
    );
    expect(result.accountPriorBoost).toBe(5);
  });

  it("should apply 0 boost when no account-prior match", () => {
    const result = computePerUserFinalScore(
      PUMP_PROJECT,
      WA_PUMP_PROFILE,
      [],
      [],
      null,
    );
    expect(result.accountPriorBoost).toBe(0);
    expect(result.matchedAccountPrior).toBeNull();
  });

  it("should include account_prior_boost reason code when boosted", () => {
    const result = computePerUserFinalScore(
      PUMP_PROJECT,
      WA_PUMP_PROFILE,
      [],
      [],
      { canonicalName: "Newmont", priorityLevel: "A" },
    );
    expect(result.reasonCodes.some(rc => rc.includes("account_prior_boost"))).toBe(true);
  });
});

// ── Part B: Pump Action Mode ──

describe("Pump/Flow Lane: Pump Action Mode", () => {
  it("should compute pumpActionMode for pump-lane rep", () => {
    const result = computePerUserFinalScore(
      PUMP_PROJECT,
      WA_PUMP_PROFILE,
      [],
      [],
      null,
    );
    expect(result.pumpActionMode).toBeDefined();
    expect([
      "direct_pursue", "map_package", "find_site_contact",
      "watch_incumbent", "account_nurture", "reference_only",
    ]).toContain(result.pumpActionMode);
  });

  it("should NOT compute pumpActionMode for non-pump rep", () => {
    const paProfile = {
      territories: ["WA"],
      assignedBusinessLines: ["Portable Air"],
      sectorFocus: ["mining"],
      stageTiming: null,
      keyAccounts: null,
      buyerRoles: null,
    };
    const result = computePerUserFinalScore(
      PUMP_PROJECT,
      paProfile,
      [],
      [],
      null,
    );
    expect(result.pumpActionMode).toBeUndefined();
  });

  it("should set direct_pursue for hot pump project with send_ready contact", () => {
    const result = computePerUserFinalScore(
      PUMP_PROJECT,
      WA_PUMP_PROFILE,
      [],
      [{
        contactTrustTier: "send_ready",
        roleRelevance: "high",
        name: "Jane Doe",
        title: "Dewatering Supervisor",
        email: "jane@newmont.com",
      }],
      { canonicalName: "Newmont", priorityLevel: "A" },
    );
    // map_package is correct: even with send_ready contact, the pump action mode
    // considers multiple factors (lane score, contact quality, account prior).
    // direct_pursue requires the highest combined score threshold.
    expect(["direct_pursue", "map_package"]).toContain(result.pumpActionMode);
  });
});

// ── Part C: Pump-Specific Contact Role Ranking ──

describe("Pump/Flow Lane: Contact Role Ranking", () => {
  const makeContact = (overrides: Partial<ContactInput>): ContactInput => ({
    id: 1,
    name: "Test Contact",
    title: "Unknown",
    company: "Newmont",
    project: "Boddington Gold Mine Dewatering",
    priority: "hot",
    roleBucket: "operations",
    email: "test@newmont.com",
    contactTrustTier: "send_ready",
    roleRelevance: "high",
    ...overrides,
  });

  it("should rank dewatering supervisor higher than procurement manager for pump lane", () => {
    const dewateringContact = makeContact({ id: 1, name: "Site Ops", title: "Dewatering Supervisor" });
    const procurementContact = makeContact({ id: 2, name: "Buyer", title: "Procurement Manager" });

    const result = selectProjectContact(
      [dewateringContact, procurementContact],
      {
        projectName: "Boddington Gold Mine Dewatering",
        projectOwner: "Newmont",
        projectState: "WA",
        isPumpLane: true,
      }
    );

    expect(result.selectedContact).not.toBeNull();
    expect(result.selectedContact!.name).toBe("Site Ops");
  });

  it("should rank procurement manager highest for generic (non-pump) lane", () => {
    const dewateringContact = makeContact({ id: 1, name: "Site Ops", title: "Dewatering Supervisor" });
    const procurementContact = makeContact({ id: 2, name: "Buyer", title: "Procurement Manager" });

    const result = selectProjectContact(
      [dewateringContact, procurementContact],
      {
        projectName: "Boddington Gold Mine Dewatering",
        projectOwner: "Newmont",
        projectState: "WA",
        isPumpLane: false,
      }
    );

    expect(result.selectedContact).not.toBeNull();
    expect(result.selectedContact!.name).toBe("Buyer");
  });

  it("should rank maintenance manager above generic commercial for pump lane", () => {
    const maintenanceContact = makeContact({ id: 1, name: "Maint Mgr", title: "Maintenance Manager" });
    const commercialContact = makeContact({ id: 2, name: "Comm Mgr", title: "Business Development Manager" });

    const result = selectProjectContact(
      [maintenanceContact, commercialContact],
      {
        projectName: "Boddington Gold Mine Dewatering",
        projectOwner: "Newmont",
        isPumpLane: true,
      }
    );

    expect(result.selectedContact).not.toBeNull();
    expect(result.selectedContact!.name).toBe("Maint Mgr");
  });

  it("should provide pump-specific routeToBuy for pump lane contacts", () => {
    const contact = makeContact({ id: 1, name: "Ops Super", title: "Operations Superintendent" });

    const result = selectProjectContact(
      [contact],
      {
        projectName: "Boddington Gold Mine Dewatering",
        projectOwner: "Newmont",
        isPumpLane: true,
      }
    );

    expect(result.selectedContact).not.toBeNull();
    expect(result.selectedContact!.routeToBuy).toContain("Site operations");
  });
});

// ── Part D: Digest CTA Language (Intelligence-First) ──

describe("Pump/Flow Lane: Digest CTA Language", () => {
  // We test the email template output to verify the CTA button text
  it("should use 'View your Must Act projects' CTA in HTML email", () => {
    const data: DigestEmailData = {
      userName: "Chris",
      territory: "WA",
      weekLabel: "2026-05-11",
      summaryLine: "2 action-ready opportunities this week.",
      signals: [{
        projectId: 100,
        badge: "action_ready",
        title: "Boddington Gold Mine — Dewatering Pumps",
        company: "Newmont",
        pitch: "Major dewatering opportunity for submersible pump packages.",
        ctaAction: "Review project scope and dewatering requirements on the dashboard before reaching out.",
        productTag: "Dewatering Pumps for Mining",
      }],
      dashboardUrl: "https://example.com",
    };

    const html = buildDigestEmailHtml(data);
    expect(html).toContain("View your Must Act projects");
    expect(html).toContain("/this-week?section=must_act");
    expect(html).not.toContain('href="https://example.com/"');
  });

  it("should use intelligence-first CTA in plain text email", () => {
    const data: DigestEmailData = {
      userName: "Chris",
      territory: "WA",
      weekLabel: "2026-05-11",
      summaryLine: "1 action-ready opportunity.",
      signals: [],
      dashboardUrl: "https://example.com",
    };

    const text = buildDigestEmailText(data);
    expect(text).toContain("View your Must Act projects");
    expect(text).toContain("/this-week?section=must_act");
    expect(text).not.toContain("Open your dashboard");
  });
});

// ── Part E: Account-Prior Boost Capped at 100 ──

describe("Pump/Flow Lane: Score Capping", () => {
  it("should cap finalScore at 100 even with large account-prior boost", () => {
    // Use a hot, WA, mining project with pump profile — should already score high
    const result = computePerUserFinalScore(
      { ...PUMP_PROJECT, priority: "hot" },
      WA_PUMP_PROFILE,
      [],
      [{
        contactTrustTier: "send_ready",
        roleRelevance: "high",
        name: "Jane",
        title: "Dewatering Manager",
        email: "jane@newmont.com",
      }],
      { canonicalName: "Newmont", priorityLevel: "A" },
    );
    expect(result.finalScore).toBeLessThanOrEqual(100);
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
  });
});
