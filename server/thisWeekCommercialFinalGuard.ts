import type { ThisWeekProject, ThisWeekSummary, SuggestedAction } from "./thisWeekServiceLegacy";
import type {
  PortableAirCommercialPolicyResult,
  PortableAirPolicyAction,
} from "./portableAirCommercialPolicy";

export interface CommercialGuardProjectEvidence {
  name: string;
  overview: string | null;
  opportunityRoute: string;
  equipmentSignals: string[] | null;
  detectedActivities: string[];
  managedAccount: "Coates" | "EPSA" | null;
  truth: PortableAirCommercialPolicyResult | undefined;
}

const SPECIALTY_DIRECT = new Set([
  "high_pressure_booster",
  "pipeline_testing",
  "purging_inerting",
  "specialty_air_package",
  "air_treatment",
  "electric_portable_air",
]);

function projectText(project: CommercialGuardProjectEvidence): string {
  return [
    project.name,
    project.overview ?? "",
    project.opportunityRoute,
    ...(project.equipmentSignals ?? []),
    ...project.detectedActivities,
  ].join(" ").toLowerCase();
}

/**
 * The Issue #106 base resolver historically treated any project name containing
 * "Coates" as a direct key-account signal. Issue #109 owns account exceptions in
 * structured rep policy instead. This guard prevents that legacy name-only signal
 * from leaking into a primary CTA while preserving genuinely independent direct
 * product evidence.
 */
export function shouldFailClosedLegacyManagedName(
  project: CommercialGuardProjectEvidence,
): boolean {
  const truth = project.truth;
  if (!truth || truth.routeStatus !== "direct_proven") return false;
  if (project.managedAccount !== null) return false;
  if (!/\bcoates(?:\s+hire)?\b/i.test(project.name)) return false;

  if (truth.reasonCodes.some(code => code.startsWith("evidence:cfm:") && Number(code.split(":").at(-1)) > 600)) {
    return false;
  }
  if (SPECIALTY_DIRECT.has(truth.opportunityType)) return false;

  const text = projectText(project);
  if (
    truth.opportunityType === "drilling_blasting"
    && /\b(reverse circulation|rc drill(?:ing)?|aircore|air core|dth|down-the-hole|blast-hole|blasthole|drill rig|drilling campaign)\b/i.test(text)
  ) {
    return false;
  }

  return true;
}

type GuardedProject = ThisWeekProject & {
  managedAccount?: "Coates" | "EPSA" | null;
  commercialAction?: PortableAirPolicyAction;
  commercialTruth?: PortableAirCommercialPolicyResult;
};

function actionPriority(project: ThisWeekProject): "urgent" | "high" | "medium" {
  if (project.priority === "hot") return "urgent";
  if (project.priority === "warm") return "high";
  return "medium";
}

function failClosedProject(project: GuardedProject): GuardedProject {
  const truth = project.commercialTruth;
  if (!truth) return project;

  const guardedTruth: PortableAirCommercialPolicyResult = {
    ...truth,
    routeStatus: "confirm_product_scope",
    channel: "monitor",
    actionReady: false,
    preferredBuyerContactId: null,
    recommendedAction: "confirm_product_scope",
    whyNow: "The project has a possible Portable Air use case, but a project-name account mention is not sufficient evidence for a direct route.",
    routeToBuy: "Confirm product scope and structured account ownership before assigning direct vs channel",
    bestNextMove: "Confirm required cfm, pressure, product family and the actual buying account before outreach.",
    reasonCodes: [
      ...truth.reasonCodes.filter(code => !code.startsWith("route:")),
      "route:confirm_product_scope",
      "safety:legacy_managed_name_signal_rejected",
    ],
  };

  return {
    ...project,
    bestStakeholder: null,
    suggestedStakeholders: [],
    suggestedAction: guardedTruth.bestNextMove,
    whyItMatters: guardedTruth.whyNow,
    whyNow: guardedTruth.whyNow,
    routeToBuy: guardedTruth.routeToBuy,
    bestNextMove: guardedTruth.bestNextMove,
    channel: "monitor",
    contactCTA: {
      action: "why_no_contacts",
      label: "Confirm product scope",
      blockedReason: guardedTruth.bestNextMove,
    },
    reasonCodes: [
      ...project.reasonCodes.filter(code => !code.startsWith("commercial:")),
      ...guardedTruth.reasonCodes.map(code => `commercial:${code}`),
    ],
    commercialAction: "confirm_product_scope",
    commercialTruth: guardedTruth,
  };
}

function actionBucket(project: GuardedProject): number {
  if (project.commercialAction === "view_best") return 0;
  if (["validate_contacts", "find_contacts", "map_package_holder", "confirm_product_scope", "confirm_territory"]
    .includes(project.commercialAction ?? "")) return 1;
  return 2;
}

export function applyLegacyManagedNameGuard(summary: ThisWeekSummary): ThisWeekSummary {
  const guardedIds = new Set<number>();
  const topProjects = summary.topProjects
    .map((rawProject, index) => {
      const project = rawProject as GuardedProject;
      const shouldGuard = shouldFailClosedLegacyManagedName({
        name: project.name,
        overview: project.overview,
        opportunityRoute: project.opportunityRoute,
        equipmentSignals: project.equipmentSignals,
        detectedActivities: project.detectedActivities,
        managedAccount: project.managedAccount ?? null,
        truth: project.commercialTruth,
      });
      if (!shouldGuard) return { project, index };
      guardedIds.add(project.id);
      return { project: failClosedProject(project), index };
    })
    .sort((a, b) => actionBucket(a.project) - actionBucket(b.project) || a.index - b.index)
    .map(({ project }) => project);

  if (guardedIds.size === 0) return summary;

  const replacementActions: SuggestedAction[] = topProjects
    .filter(project => guardedIds.has(project.id))
    .map(project => ({
      type: "high_value" as const,
      priority: actionPriority(project),
      title: `Confirm Portable Air scope for ${project.name}`,
      description: project.bestNextMove,
      projectId: project.id,
      projectName: project.name,
      actionKey: `commercial:confirm_scope:${project.id}:0`,
    }));

  const suggestedActions = [
    ...summary.suggestedActions.filter(action => !action.projectId || !guardedIds.has(action.projectId)),
    ...replacementActions,
  ].slice(0, 10);

  const actionReadyIds = new Map<number, number>();
  for (const project of topProjects) {
    const truth = project.commercialTruth;
    if (truth?.actionReady && truth.preferredBuyerContactId) {
      actionReadyIds.set(project.id, truth.preferredBuyerContactId);
    }
  }

  const newStakeholders = summary.newStakeholders.filter(stakeholder =>
    actionReadyIds.get(stakeholder.projectId) === stakeholder.id,
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
    stats: { ...summary.stats, actionReadyCount, needDiscoveryCount },
  };
}
