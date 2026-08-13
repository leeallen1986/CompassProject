import { getProjectBuyerRouteInputs } from "./db";
import { buildProjectBuyerRoute, type ProjectBuyerRoute } from "./projectBuyerRoute";
import {
  getThisWeekSummary as getBaseCommercialSummary,
  type SuggestedAction,
  type ThisWeekProject,
  type ThisWeekStakeholder,
  type ThisWeekSummary,
  type StageChange,
  type UserContext,
} from "./thisWeekCommercialService";
import type {
  PortableAirCommercialAction,
  PortableAirCommercialTruth,
} from "./thisWeekCommercialTruth";
import {
  applyPortableAirRepPolicy,
  commercialTruthRepName,
  organisationMatchesManagedAccount,
  type CommercialTruthRep,
  type PortableAirCommercialPolicyResult,
  type PortableAirPolicyAction,
} from "./portableAirCommercialPolicy";

export type {
  SuggestedAction,
  ThisWeekProject,
  ThisWeekStakeholder,
  ThisWeekSummary,
  StageChange,
  UserContext,
} from "./thisWeekCommercialService";

type BaseCommercialProject = ThisWeekProject & {
  application?: string;
  routeStatus?: PortableAirCommercialTruth["routeStatus"];
  timingStatus?: PortableAirCommercialTruth["timingStatus"];
  buyerStatus?: PortableAirCommercialTruth["buyerStatus"];
  commercialAction?: PortableAirCommercialAction;
  commercialTruth?: PortableAirCommercialTruth;
};

type PolicyProject = ThisWeekProject & {
  application?: string;
  routeStatus?: PortableAirCommercialPolicyResult["routeStatus"];
  timingStatus?: PortableAirCommercialPolicyResult["timingStatus"];
  buyerStatus?: PortableAirCommercialPolicyResult["buyerStatus"];
  commercialAction?: PortableAirPolicyAction;
  commercialTruth?: PortableAirCommercialPolicyResult;
  ownershipStatus?: PortableAirCommercialPolicyResult["ownershipStatus"];
  channelPolicy?: PortableAirCommercialPolicyResult["channelPolicy"];
  managedAccount?: PortableAirCommercialPolicyResult["managedAccount"];
  managedAccountOwner?: PortableAirCommercialPolicyResult["managedAccountOwner"];
  territoryOwner?: PortableAirCommercialPolicyResult["territoryOwner"];
  nitrogenCollaboration?: PortableAirCommercialPolicyResult["nitrogenCollaboration"];
};

async function loadDossier(projectId: number): Promise<ProjectBuyerRoute | null> {
  try {
    const inputs = await getProjectBuyerRouteInputs(projectId);
    return inputs ? buildProjectBuyerRoute(inputs) : null;
  } catch (error) {
    console.warn(
      `[ThisWeekCommercialPolicy] buyer-route recheck failed for project ${projectId}; failing closed`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

function matchedDossierContact(
  dossier: ProjectBuyerRoute | null,
  contactId: number | null,
) {
  if (!dossier || !contactId) return null;
  return dossier.contacts.find(contact => contact.contactId === contactId) ?? null;
}

function normaliseOrganisation(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(pty|ltd|limited|inc|corp|corporation|group|australia)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function preferredBuyerMatchesRecordedPackage(
  truth: PortableAirCommercialPolicyResult,
  dossier: ProjectBuyerRoute | null,
): boolean {
  if (!truth.actionReady) return false;
  const preferred = matchedDossierContact(dossier, truth.preferredBuyerContactId);
  if (!preferred?.effectivelySendReady) return false;

  const preferredOrg = normaliseOrganisation(preferred.organisation.recordedName);
  const holderMatch = truth.recordedPackageHolders.some(holder =>
    normaliseOrganisation(holder) === preferredOrg,
  );
  if (!holderMatch) return false;

  if (truth.managedAccount) {
    const managedHolderMatch = truth.recordedPackageHolders.some(holder =>
      organisationMatchesManagedAccount(truth.managedAccount!, holder),
    );
    if (!managedHolderMatch) return false;
    if (!organisationMatchesManagedAccount(truth.managedAccount, preferred.organisation.recordedName)) {
      return false;
    }
  }

  return true;
}

function failClosedForBuyerSafety(
  truth: PortableAirCommercialPolicyResult,
): PortableAirCommercialPolicyResult {
  if (!truth.actionReady) return truth;

  const hasQualifiedHolder = truth.managedAccount
    ? truth.recordedPackageHolders.some(holder =>
        organisationMatchesManagedAccount(truth.managedAccount!, holder),
      )
    : truth.recordedPackageHolders.length > 0;

  return {
    ...truth,
    actionReady: false,
    preferredBuyerContactId: null,
    buyerStatus: hasQualifiedHolder ? "find_buyer" : "map_package_holder",
    recommendedAction: hasQualifiedHolder ? "find_contacts" : "map_package_holder",
    whyNow: truth.managedAccount
      ? "The managed-account route is direct, but the response could not re-establish a safe buyer at the managed buying organisation."
      : "The route appears commercially relevant, but the package-matched safe buyer could not be re-established for this response.",
    bestNextMove: hasQualifiedHolder
      ? "Find an exact-linked plant/fleet/procurement/technical buyer at the qualifying package holder before outreach."
      : truth.managedAccount
        ? `Confirm ${truth.managedAccount} as the recorded buying organisation/package holder before outreach.`
        : "Confirm the awarded contractor/JV and the package that will procure or hire the equipment.",
    reasonCodes: [...truth.reasonCodes, "safety:preferred_buyer_recheck_failed"],
  };
}

function policyContactCTA(
  truth: PortableAirCommercialPolicyResult,
  dossier: ProjectBuyerRoute | null,
): ThisWeekProject["contactCTA"] {
  const preferred = matchedDossierContact(dossier, truth.preferredBuyerContactId);

  switch (truth.recommendedAction) {
    case "view_best":
      if (preferred?.effectivelySendReady) {
        return {
          action: "view_best",
          label: "View Best Contacts",
          contactName: preferred.name,
          trustTier: preferred.effectiveTrustTier,
        };
      }
      return {
        action: "why_no_contacts",
        label: "Map package buyer",
        blockedReason: "The package-matched safe buyer could not be re-established for this response.",
      };

    case "validate_contacts":
      return {
        action: "validate_contacts",
        label: "Validate package buyer",
        contactCount: Math.max(1, truth.packageMatchedNamedBuyerCount),
      };

    case "find_contacts":
      return {
        action: "find_contacts",
        label: "Find package buyer",
        reason: truth.bestNextMove,
      };

    case "map_package_holder":
      return {
        action: "why_no_contacts",
        label: "Map package holder",
        blockedReason: truth.bestNextMove,
      };

    case "confirm_product_scope":
      return {
        action: "why_no_contacts",
        label: "Confirm product scope",
        blockedReason: truth.bestNextMove,
      };

    case "monitor_next_program":
      return {
        action: "why_no_contacts",
        label: "Monitor next program",
        blockedReason: truth.bestNextMove,
      };

    case "route_via_cea":
      return {
        action: "why_no_contacts",
        label: "Route via CEA",
        blockedReason: truth.bestNextMove,
      };

    case "route_via_dealer":
      return {
        action: "why_no_contacts",
        label: "Route via CP/dealer",
        blockedReason: truth.bestNextMove,
      };

    case "refer_managed_account":
      return {
        action: "why_no_contacts",
        label: `Managed by ${truth.managedAccountOwner ?? "another rep"}`,
        blockedReason: truth.bestNextMove,
      };

    case "refer_territory_owner":
      return {
        action: "why_no_contacts",
        label: `Owned by ${truth.territoryOwner ?? "another rep"}`,
        blockedReason: truth.bestNextMove,
      };

    case "specialist_support_only":
      return {
        action: "why_no_contacts",
        label: "Specialist support only",
        blockedReason: truth.bestNextMove,
      };

    case "confirm_territory":
      return {
        action: "why_no_contacts",
        label: "Confirm territory",
        blockedReason: truth.bestNextMove,
      };
  }
}

async function applyPolicyToProject(
  project: BaseCommercialProject,
  repName: CommercialTruthRep,
): Promise<PolicyProject> {
  const baseTruth = project.commercialTruth;
  if (!baseTruth) return project as PolicyProject;

  const policyTruth = applyPortableAirRepPolicy({
    repName,
    project: {
      name: project.name,
      owner: project.owner,
      matchedAccountPrior: project.matchedAccountPrior,
      location: project.location,
      overview: project.overview,
      opportunityRoute: project.opportunityRoute,
      equipmentSignals: project.equipmentSignals,
      detectedActivities: project.detectedActivities,
    },
    truth: baseTruth,
  });

  const dossier = await loadDossier(project.id);
  const truth = policyTruth.actionReady && !preferredBuyerMatchesRecordedPackage(policyTruth, dossier)
    ? failClosedForBuyerSafety(policyTruth)
    : policyTruth;
  const finalPreferred = matchedDossierContact(dossier, truth.preferredBuyerContactId);
  const finalPreferredSafe = truth.actionReady
    && finalPreferred?.effectivelySendReady
    && preferredBuyerMatchesRecordedPackage(truth, dossier);

  const safeStakeholder = finalPreferredSafe && finalPreferred
    ? {
        name: finalPreferred.name,
        title: finalPreferred.title,
        company: finalPreferred.organisation.recordedName,
        relevance: "high",
        email: finalPreferred.email.value,
        linkedin: finalPreferred.linkedin.profileUrl,
      }
    : null;

  const validationCandidates = dossier?.contacts
    .filter(contact =>
      contact.contactId === truth.preferredBuyerContactId
      || (
        truth.recordedPackageHolders.some(holder =>
          normaliseOrganisation(holder) === normaliseOrganisation(contact.organisation.recordedName),
        )
        && contact.effectiveTrustTier !== "llm_inferred"
      ),
    )
    .slice(0, 3)
    .map(contact => ({
      name: contact.name,
      title: contact.title,
      company: contact.organisation.recordedName,
      relevance: "high",
      linkedin: contact.linkedin.profileUrl,
    })) ?? [];

  return {
    ...project,
    bestStakeholder: safeStakeholder,
    suggestedStakeholders: truth.actionReady
      ? project.suggestedStakeholders
      : validationCandidates,
    suggestedAction: truth.bestNextMove,
    whyItMatters: truth.whyNow,
    whyNow: truth.whyNow,
    routeToBuy: truth.routeToBuy,
    bestNextMove: truth.bestNextMove,
    channel: truth.channel,
    airFit: truth.airFit,
    opportunityType: truth.opportunityType,
    bestProductAngle: truth.bestProductAngle,
    contactCTA: policyContactCTA(truth, dossier),
    reasonCodes: [
      ...project.reasonCodes.filter(code => !code.startsWith("commercial:")),
      ...truth.reasonCodes.map(code => `commercial:${code}`),
    ],
    application: truth.application,
    routeStatus: truth.routeStatus,
    timingStatus: truth.timingStatus,
    buyerStatus: truth.buyerStatus,
    commercialAction: truth.recommendedAction,
    commercialTruth: truth,
    ownershipStatus: truth.ownershipStatus,
    channelPolicy: truth.channelPolicy,
    managedAccount: truth.managedAccount,
    managedAccountOwner: truth.managedAccountOwner,
    territoryOwner: truth.territoryOwner,
    nitrogenCollaboration: truth.nitrogenCollaboration,
  };
}

function actionPriority(project: ThisWeekProject): "urgent" | "high" | "medium" {
  if (project.priority === "hot") return "urgent";
  if (project.priority === "warm") return "high";
  return "medium";
}

function policySuggestedAction(project: PolicyProject): SuggestedAction | null {
  const truth = project.commercialTruth;
  if (!truth) return null;

  const base = {
    priority: actionPriority(project),
    projectId: project.id,
    projectName: project.name,
  };

  switch (truth.recommendedAction) {
    case "view_best":
      if (!project.bestStakeholder || !truth.preferredBuyerContactId) return null;
      return {
        ...base,
        type: "contact_outreach",
        title: `Contact ${project.bestStakeholder.name} on ${project.name}`,
        description: truth.bestNextMove,
        contactId: truth.preferredBuyerContactId,
        contactName: project.bestStakeholder.name,
        actionKey: `commercial:view_best:${project.id}:${truth.preferredBuyerContactId}`,
      };

    case "validate_contacts":
      return {
        ...base,
        type: "contact_validation",
        title: `Validate the package buyer for ${project.name}`,
        description: truth.bestNextMove,
        contactId: truth.preferredBuyerContactId ?? undefined,
        actionKey: `commercial:validate:${project.id}:${truth.preferredBuyerContactId ?? 0}`,
      };

    case "find_contacts":
      return {
        ...base,
        type: "tier1_new",
        title: `Find the package buyer for ${project.name}`,
        description: truth.bestNextMove,
        actionKey: `commercial:find_buyer:${project.id}:0`,
      };

    case "map_package_holder":
      return {
        ...base,
        type: "contractor_gap",
        title: `Map the buying package for ${project.name}`,
        description: truth.bestNextMove,
        actionKey: `commercial:map_package:${project.id}:0`,
      };

    case "confirm_product_scope":
      return {
        ...base,
        type: "high_value",
        title: `Confirm Portable Air scope for ${project.name}`,
        description: truth.bestNextMove,
        actionKey: `commercial:confirm_scope:${project.id}:0`,
      };

    case "confirm_territory":
      return {
        ...base,
        type: "high_value",
        title: `Confirm territory for ${project.name}`,
        description: truth.bestNextMove,
        actionKey: `commercial:confirm_territory:${project.id}:0`,
      };

    case "monitor_next_program":
    case "route_via_cea":
    case "route_via_dealer":
    case "refer_managed_account":
    case "refer_territory_owner":
    case "specialist_support_only":
      return null;
  }
}

function actionBucket(project: PolicyProject): number {
  const action = project.commercialAction;
  if (action === "view_best") return 0;
  if (
    action === "validate_contacts"
    || action === "find_contacts"
    || action === "map_package_holder"
    || action === "confirm_product_scope"
    || action === "confirm_territory"
  ) return 1;
  return 2;
}

export async function getThisWeekSummary(
  userId?: number,
  repNameOverride?: string | null,
): Promise<ThisWeekSummary> {
  const summary = await getBaseCommercialSummary(userId);
  const repName = commercialTruthRepName(repNameOverride ?? summary.userContext.repName);
  if (!repName) return summary;

  const commerciallyGated = await Promise.all(
    summary.topProjects.map(project =>
      applyPolicyToProject(project as BaseCommercialProject, repName),
    ),
  );

  const topProjects = commerciallyGated
    .map((project, index) => ({ project, index }))
    .sort((a, b) => actionBucket(a.project) - actionBucket(b.project) || a.index - b.index)
    .map(({ project }) => project);

  const suggestedActions = topProjects
    .map(project => policySuggestedAction(project))
    .filter((action): action is SuggestedAction => action !== null)
    .slice(0, 10);

  const preferredByProject = new Map<number, number>();
  for (const project of topProjects) {
    const truth = project.commercialTruth;
    if (truth?.actionReady && truth.preferredBuyerContactId) {
      preferredByProject.set(project.id, truth.preferredBuyerContactId);
    }
  }

  // Digest/summary stakeholder cards must follow the same package-matched policy,
  // not merely legacy exact-link/send-ready eligibility.
  const newStakeholders = summary.newStakeholders.filter(stakeholder =>
    preferredByProject.get(stakeholder.projectId) === stakeholder.id,
  );

  const actionReadyCount = topProjects.filter(project =>
    project.commercialTruth?.actionReady === true
    && (project.priority === "hot" || project.priority === "warm"),
  ).length;

  const needDiscoveryCount = topProjects.filter(project =>
    ["validate_contacts", "find_contacts", "map_package_holder", "confirm_product_scope", "confirm_territory"]
      .includes(project.commercialAction ?? "")
    && (project.priority === "hot" || project.priority === "warm"),
  ).length;

  return {
    ...summary,
    topProjects,
    newStakeholders,
    suggestedActions,
    stats: {
      ...summary.stats,
      actionReadyCount,
      needDiscoveryCount,
    },
  };
}

export async function getThisWeekForEmail(userId?: number): Promise<{
  top3Projects: ThisWeekProject[];
  top2Stakeholders: ThisWeekStakeholder[];
  urgentAction: SuggestedAction | null;
  weekLabel: string;
  stats: ThisWeekSummary["stats"];
}> {
  const summary = await getThisWeekSummary(userId);
  return {
    top3Projects: summary.topProjects.slice(0, 3),
    top2Stakeholders: summary.newStakeholders.slice(0, 2),
    urgentAction: summary.suggestedActions.find(action => action.priority === "urgent")
      ?? summary.suggestedActions[0]
      ?? null,
    weekLabel: summary.weekLabel,
    stats: summary.stats,
  };
}
