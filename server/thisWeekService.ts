import { getProjectBuyerRouteInputs } from "./db";
import { buildProjectBuyerRoute, type ProjectBuyerRoute } from "./projectBuyerRoute";
import {
  getThisWeekSummary as getLegacyThisWeekSummary,
  type SuggestedAction,
  type ThisWeekProject,
  type ThisWeekStakeholder,
  type ThisWeekSummary,
  type StageChange,
  type UserContext,
} from "./thisWeekServiceLegacy";
import {
  resolvePortableAirCommercialTruth,
  type PortableAirCommercialAction,
  type PortableAirCommercialTruth,
} from "./thisWeekCommercialTruth";

export type {
  SuggestedAction,
  ThisWeekProject,
  ThisWeekStakeholder,
  ThisWeekSummary,
  StageChange,
  UserContext,
} from "./thisWeekServiceLegacy";

/**
 * Issue #106 commercial-truth wrapper.
 *
 * The legacy service remains the ranking/data assembly source. This layer only
 * fail-closes Portable Air sales actions after the top-15 set exists, using the
 * existing exact-link buyer-route dossier plus deterministic product/route/timing
 * rules. It performs reads only and never invokes providers or enrichment.
 */

function isPortableAirSummary(summary: ThisWeekSummary): boolean {
  return summary.userContext.assignedBusinessLines.some(value =>
    value.toLowerCase().includes("portable air"),
  );
}

function matchedDossierContact(
  dossier: ProjectBuyerRoute | null,
  contactId: number | null,
) {
  if (!dossier || !contactId) return null;
  return dossier.contacts.find(contact => contact.contactId === contactId) ?? null;
}

function commercialContactCTA(
  truth: PortableAirCommercialTruth,
  dossier: ProjectBuyerRoute | null,
): any {
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
      // Defensive fail-close: a resolver/card mismatch must never expose outreach.
      return {
        action: "why_no_contacts",
        label: "Map package buyer",
        blockedReason: "Commercial truth expected a package-matched safe buyer but the dossier contact could not be resolved.",
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
  }
}

async function applyPortableAirCommercialTruth(project: ThisWeekProject) {
  let dossier: ProjectBuyerRoute | null = null;
  try {
    const inputs = await getProjectBuyerRouteInputs(project.id);
    dossier = inputs ? buildProjectBuyerRoute(inputs) : null;
  } catch (error) {
    console.warn(
      `[ThisWeekCommercialTruth] buyer-route read failed for project ${project.id}; failing closed`,
      error instanceof Error ? error.message : String(error),
    );
  }

  const truth = resolvePortableAirCommercialTruth({
    project: {
      name: project.name,
      owner: project.owner,
      stage: project.stage,
      overview: project.overview,
      opportunityRoute: project.opportunityRoute,
      equipmentSignals: project.equipmentSignals,
      detectedActivities: project.detectedActivities,
    },
    lane: {
      airFit: project.airFit,
      opportunityType: project.opportunityType,
      bestProductAngle: project.bestProductAngle,
      channel: project.channel,
    },
    dossier,
  });

  const preferred = matchedDossierContact(dossier, truth.preferredBuyerContactId);
  const safeStakeholder = truth.actionReady && preferred?.effectivelySendReady
    ? {
        name: preferred.name,
        title: preferred.title,
        company: preferred.organisation.recordedName,
        relevance: "high",
        email: preferred.email.value,
        linkedin: preferred.linkedin.profileUrl,
      }
    : null;

  const validationCandidates = dossier?.contacts
    .filter(contact =>
      contact.contactId === truth.preferredBuyerContactId
      || (
        truth.recordedPackageHolders.some(holder =>
          holder.trim().toLowerCase() === contact.organisation.recordedName.trim().toLowerCase(),
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
    contactCTA: commercialContactCTA(truth, dossier),
    reasonCodes: [
      ...project.reasonCodes.filter(code => !code.startsWith("commercial:")),
      ...truth.reasonCodes.map(code => `commercial:${code}`),
    ],
    // Additional fields are intentionally additive so existing clients remain
    // backward compatible while audit/management views can inspect the truth gate.
    application: truth.application,
    routeStatus: truth.routeStatus,
    timingStatus: truth.timingStatus,
    buyerStatus: truth.buyerStatus,
    commercialAction: truth.recommendedAction,
    commercialTruth: truth,
  } as ThisWeekProject & {
    application: string;
    routeStatus: PortableAirCommercialTruth["routeStatus"];
    timingStatus: PortableAirCommercialTruth["timingStatus"];
    buyerStatus: PortableAirCommercialTruth["buyerStatus"];
    commercialAction: PortableAirCommercialAction;
    commercialTruth: PortableAirCommercialTruth;
  };
}

function actionPriority(project: ThisWeekProject): "urgent" | "high" | "medium" {
  if (project.priority === "hot") return "urgent";
  if (project.priority === "warm") return "high";
  return "medium";
}

function commercialSuggestedAction(project: any): SuggestedAction | null {
  const truth = project.commercialTruth as PortableAirCommercialTruth | undefined;
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

    case "monitor_next_program":
    case "route_via_cea":
      // These remain visible as project intelligence but are not Ryan direct actions.
      return null;
  }
}

function actionBucket(project: any): number {
  const action = project.commercialAction as PortableAirCommercialAction | undefined;
  if (action === "view_best") return 0;
  if (
    action === "validate_contacts"
    || action === "find_contacts"
    || action === "map_package_holder"
    || action === "confirm_product_scope"
  ) return 1;
  return 2;
}

export async function getThisWeekSummary(userId?: number): Promise<ThisWeekSummary> {
  const summary = await getLegacyThisWeekSummary(userId);
  if (!isPortableAirSummary(summary)) return summary;

  const commerciallyGated = await Promise.all(
    summary.topProjects.map(project => applyPortableAirCommercialTruth(project)),
  );

  // Keep the existing relevance order inside each commercial bucket while moving
  // direct actions ahead of validation/mapping and monitor/channel intelligence.
  const topProjects = commerciallyGated
    .map((project, index) => ({ project, index }))
    .sort((a, b) => actionBucket(a.project) - actionBucket(b.project) || a.index - b.index)
    .map(({ project }) => project);

  const suggestedActions = topProjects
    .map(project => commercialSuggestedAction(project))
    .filter((action): action is SuggestedAction => action !== null)
    .slice(0, 10);

  const actionReadyCount = topProjects.filter((project: any) =>
    project.commercialTruth?.actionReady === true
    && (project.priority === "hot" || project.priority === "warm"),
  ).length;

  const needDiscoveryCount = topProjects.filter((project: any) =>
    ["validate_contacts", "find_contacts", "map_package_holder", "confirm_product_scope"]
      .includes(project.commercialAction)
    && (project.priority === "hot" || project.priority === "warm"),
  ).length;

  return {
    ...summary,
    topProjects,
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
