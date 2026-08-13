import { describe, expect, it } from "vitest";
import type { ProjectBuyerRoute } from "./projectBuyerRoute";
import {
  buildRyanPortfolioAudit,
  classifyRyanPortfolioProject,
  type RyanPortfolioAuditInput,
  type RyanPortfolioAuditProject,
} from "./ryanPortfolioAudit.shared";

function project(
  override: Partial<RyanPortfolioAuditProject> = {},
): RyanPortfolioAuditProject {
  return {
    rank: 1,
    id: 1001,
    name: "Project Atlas",
    owner: "Principal Co",
    priority: "hot",
    actionTier: "tier1_actionable",
    relevanceScore: 92,
    laneFitLabel: "High",
    airFit: "High",
    bestProductAngle: "Temporary compressed air for construction and commissioning",
    equipmentSignals: ["compressed air"],
    detectedActivities: ["commissioning"],
    routeToBuy: "Contractor package",
    bestNextMove: "Confirm package owner and plant contact",
    contactCTAAction: "view_best",
    bestStakeholder: {
      name: "Alex Buyer",
      company: "Contractor Co",
      email: "alex@example.com",
    },
    ...override,
  };
}

function contact(options: {
  id?: number;
  name?: string;
  company?: string;
  lane?: "principal" | "contractor" | "commercial" | "technical" | "referral" | "unknown";
  effectivelySendReady?: boolean;
  effectiveTrustTier?: "send_ready" | "named_unverified" | "llm_inferred";
} = {}): ProjectBuyerRoute["contacts"][number] {
  const effectivelySendReady = options.effectivelySendReady ?? true;
  return {
    contactId: options.id ?? 2001,
    name: options.name ?? "Alex Buyer",
    title: "Plant & Equipment Manager",
    organisation: {
      recordedName: options.company ?? "Contractor Co",
      evidenceState: "not_recorded",
    },
    lane: {
      value: options.lane ?? "contractor",
      basis: "inferred",
    },
    storedTrustTier: effectivelySendReady ? "send_ready" : "named_unverified",
    effectiveTrustTier: options.effectiveTrustTier ?? (
      effectivelySendReady ? "send_ready" : "named_unverified"
    ),
    effectivelySendReady,
    eligibilityReasons: [],
    email: {
      value: effectivelySendReady ? "alex@example.com" : null,
      state: effectivelySendReady ? "verified" : "unverified",
    },
    linkedin: { profileUrl: null, searchUrl: null },
    source: {
      type: "apollo",
      url: null,
      evidenceMeaning: "identity_discovery_not_employment_proof",
    },
    lastChecked: { at: null, basis: "not_recorded" },
    projectLink: {
      exactPersistedLink: true,
      relevance: "primary",
      linkedAt: null,
      externalEvidenceState: "not_recorded",
    },
    whyRelevant: {
      text: "Role suggests a contractor-side equipment route.",
      evidenceState: "inferred",
    },
  };
}

function dossier(options: {
  contacts?: ProjectBuyerRoute["contacts"];
  packageHolders?: ProjectBuyerRoute["packageHolders"];
} = {}): ProjectBuyerRoute {
  return {
    projectId: 1001,
    principal: {
      organisation: "Principal Co",
      role: "principal",
      evidenceState: "recorded_unverified",
      buyerMeaning: "referral_and_package_confirmation_not_assumed_purchaser",
    },
    projectLevelSources: [],
    packageHolders: options.packageHolders ?? [{
      organisation: "Contractor Co",
      organisationType: "organisation",
      recordedRole: "contractor",
      recordedStatus: "confirmed",
      packageScope: "Construction package",
      evidenceState: "recorded_unverified",
      ingestionSources: ["project_record"],
    }],
    likelyEquipmentBuyer: {
      organisation: null,
      functions: ["plant_equipment_fleet", "procurement_commercial"],
      statement: "Contractor-side plant and procurement functions are the likely route.",
      evidenceState: "inferred",
    },
    principalValue: {
      statement: "Use the principal for package confirmation and referral.",
      evidenceState: "inferred",
    },
    unmappedScopes: [],
    contacts: options.contacts ?? [contact()],
    gaps: [],
  };
}

function input(
  projectOverride: Partial<RyanPortfolioAuditProject> = {},
  dossierOverride?: ProjectBuyerRoute | null,
): RyanPortfolioAuditInput {
  return {
    project: project(projectOverride),
    dossier: dossierOverride === undefined ? dossier() : dossierOverride,
  };
}

describe("Ryan-mode project classification", () => {
  it("classifies a complete contractor-side route as action_ready", () => {
    const result = classifyRyanPortfolioProject(input());
    expect(result.primaryClassification).toBe("action_ready");
    expect(result.metrics.effectiveBuyerContactCount).toBe(1);
  });

  it("flags unsafe outreach when the card exposes an unverified contact", () => {
    const unsafeDossier = dossier({
      contacts: [contact({ effectivelySendReady: false })],
    });
    const result = classifyRyanPortfolioProject(input({}, unsafeDossier));
    expect(result.primaryClassification).toBe("unsafe_outreach_exposed");
    expect(result.flags).toContain("right_project_wrong_contact");
  });

  it("flags hidden exact-linked evidence when the card asks to find contacts", () => {
    const result = classifyRyanPortfolioProject(input({
      contactCTAAction: "find_contacts",
      bestStakeholder: null,
    }));
    expect(result.primaryClassification).toBe("contact_evidence_hidden");
    expect(result.metrics.contactEvidenceHidden).toBe(true);
  });

  it("flags contractor_unmapped when product fit is credible but no package holder is recorded", () => {
    const result = classifyRyanPortfolioProject(input({
      contactCTAAction: "find_contacts",
      bestStakeholder: null,
    }, dossier({ packageHolders: [], contacts: [] })));
    expect(result.primaryClassification).toBe("contractor_unmapped");
    expect(result.flags).toContain("contractor_unmapped");
    expect(result.metrics.recordedPackageHolderCount).toBe(0);
    expect(result.metrics.cardMatchesPackageBuyer).toBe(false);
  });

  it("flags principal_only when every named contact is a principal/referral route", () => {
    const principalDossier = dossier({
      contacts: [contact({
        name: "Pat Principal",
        company: "Principal Co",
        lane: "principal",
        effectivelySendReady: false,
      })],
    });
    const result = classifyRyanPortfolioProject(input({
      contactCTAAction: "validate_contacts",
      bestStakeholder: {
        name: "Pat Principal",
        company: "Principal Co",
        email: null,
      },
    }, principalDossier));
    expect(result.primaryClassification).toBe("principal_only");
    expect(result.flags).toContain("right_project_wrong_contact");
  });

  it("flags buyer_lane_unmapped when a package holder exists but no buyer contact lane exists", () => {
    const result = classifyRyanPortfolioProject(input({
      contactCTAAction: "find_contacts",
      bestStakeholder: null,
    }, dossier({ contacts: [] })));
    expect(result.primaryClassification).toBe("buyer_lane_unmapped");
  });

  it("flags right_project_wrong_contact for a mapped but unverified buyer-lane contact", () => {
    const unverifiedDossier = dossier({
      contacts: [contact({
        lane: "commercial",
        effectivelySendReady: false,
      })],
    });
    const result = classifyRyanPortfolioProject(input({
      contactCTAAction: "validate_contacts",
      bestStakeholder: {
        name: "Alex Buyer",
        company: "Contractor Co",
        email: null,
      },
    }, unverifiedDossier));
    expect(result.primaryClassification).toBe("right_project_wrong_contact");
  });

  it("flags product_fit_unproven before recommending contact action", () => {
    const result = classifyRyanPortfolioProject(input({
      laneFitLabel: "Low",
      airFit: "None",
      bestProductAngle: "",
      equipmentSignals: [],
      detectedActivities: [],
    }));
    expect(result.primaryClassification).toBe("product_fit_unproven");
    expect(result.flags).not.toContain("right_project_wrong_contact");
  });
});

describe("Ryan-mode portfolio report", () => {
  it("orders the worst projects by safety severity then commercial relevance", () => {
    const report = buildRyanPortfolioAudit([
      input({ id: 1, name: "Unproven", relevanceScore: 99, laneFitLabel: "Low", airFit: "None", bestProductAngle: "", equipmentSignals: [], detectedActivities: [] }),
      input({ id: 2, name: "Unsafe", relevanceScore: 50 }, dossier({ contacts: [contact({ effectivelySendReady: false })] })),
      input({ id: 3, name: "Ready", relevanceScore: 100 }),
    ], {
      userId: 77,
      userName: "Ryan Test",
      weekLabel: "11 Aug 2026",
      generatedAt: new Date("2026-08-11T00:00:00Z"),
    });

    expect(report.worst15.map(row => row.projectName)).toEqual(["Unsafe", "Unproven"]);
    expect(report.summary.actionReadyCount).toBe(1);
    expect(report.summary.projectsRequiringCorrection).toBe(2);
  });

  it("does not expose plaintext contact emails in the audit output", () => {
    const report = buildRyanPortfolioAudit([input()], {
      userId: 77,
      userName: "Ryan Test",
      weekLabel: "11 Aug 2026",
    });
    expect(JSON.stringify(report)).not.toContain("alex@example.com");
    expect(report.rows[0].cardState.bestStakeholderEmailShown).toBe(true);
  });
});
