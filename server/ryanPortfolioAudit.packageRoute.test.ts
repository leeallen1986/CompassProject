import { describe, expect, it } from "vitest";
import type { ProjectBuyerRoute } from "./projectBuyerRoute";
import {
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
    bestProductAngle: "Large portable air for project works",
    equipmentSignals: ["large portable compressor"],
    detectedActivities: ["commissioning"],
    routeToBuy: "Contractor package",
    bestNextMove: "Contact package buyer",
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
  name?: string;
  company?: string;
  lane?: "principal" | "contractor" | "commercial" | "technical" | "referral" | "unknown";
  effectivelySendReady?: boolean;
} = {}): ProjectBuyerRoute["contacts"][number] {
  const effectivelySendReady = options.effectivelySendReady ?? true;
  return {
    contactId: 2001,
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
    effectiveTrustTier: effectivelySendReady ? "send_ready" : "named_unverified",
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
      text: "Recorded project-linked buyer role.",
      evidenceState: "inferred",
    },
  };
}

function packageHolder(options: {
  organisation?: string;
  evidenceState?: ProjectBuyerRoute["packageHolders"][number]["evidenceState"];
} = {}): ProjectBuyerRoute["packageHolders"][number] {
  return {
    organisation: options.organisation ?? "Contractor Co",
    organisationType: "organisation",
    recordedRole: "contractor",
    recordedStatus: "confirmed",
    packageScope: "Construction package",
    evidenceState: options.evidenceState ?? "recorded_unverified",
    ingestionSources: ["project_record"],
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
    packageHolders: options.packageHolders ?? [packageHolder()],
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
  dossierOverride: ProjectBuyerRoute = dossier(),
): RyanPortfolioAuditInput {
  return {
    project: project(projectOverride),
    dossier: dossierOverride,
  };
}

describe("Ryan portfolio package-route boundary", () => {
  it("allows action_ready only when the card buyer matches a recorded package holder", () => {
    const result = classifyRyanPortfolioProject(input());

    expect(result.primaryClassification).toBe("action_ready");
    expect(result.metrics.recordedPackageHolderCount).toBe(1);
    expect(result.metrics.effectivePackageMatchedBuyerCount).toBe(1);
    expect(result.metrics.cardMatchesPackageBuyer).toBe(true);
  });

  it("fails closed when a verified buyer belongs to an unrelated contractor", () => {
    const unrelated = dossier({
      packageHolders: [packageHolder({ organisation: "Awarded Contractor" })],
      contacts: [contact({ company: "Other Contractor" })],
    });
    const result = classifyRyanPortfolioProject(input({
      bestStakeholder: {
        name: "Alex Buyer",
        company: "Other Contractor",
        email: "alex@example.com",
      },
    }, unrelated));

    expect(result.primaryClassification).toBe("unsafe_outreach_exposed");
    expect(result.flags).toContain("buyer_lane_unmapped");
    expect(result.flags).toContain("right_project_wrong_contact");
    expect(result.metrics.effectivePackageMatchedBuyerCount).toBe(0);
    expect(result.metrics.cardMatchesPackageBuyer).toBe(false);
  });

  it("does not treat an inferred or predicted package holder as action-ready proof", () => {
    const inferred = dossier({
      packageHolders: [packageHolder({ evidenceState: "inferred" })],
      contacts: [contact()],
    });
    const result = classifyRyanPortfolioProject(input({}, inferred));

    expect(result.flags).toContain("contractor_unmapped");
    expect(result.primaryClassification).toBe("unsafe_outreach_exposed");
    expect(result.metrics.recordedPackageHolderCount).toBe(0);
  });

  it("does not accept a principal contact when the package buyer is a contractor", () => {
    const principalOnly = dossier({
      packageHolders: [packageHolder({ organisation: "Contractor Co" })],
      contacts: [contact({
        name: "Pat Principal",
        company: "Principal Co",
        lane: "principal",
      })],
    });
    const result = classifyRyanPortfolioProject(input({
      bestStakeholder: {
        name: "Pat Principal",
        company: "Principal Co",
        email: "pat@example.com",
      },
    }, principalOnly));

    expect(result.primaryClassification).toBe("unsafe_outreach_exposed");
    expect(result.flags).toContain("principal_only");
    expect(result.metrics.cardMatchesPackageBuyer).toBe(false);
  });
});
