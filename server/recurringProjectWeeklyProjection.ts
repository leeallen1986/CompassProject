import type { RecurringWeeklyRecommendation } from "../shared/recurringProjectContract";

export type RecurringRecommendationDecision =
  | "accepted"
  | "deferred"
  | "not_relevant"
  | "dismissed";

export interface RecurringRecommendationDecisionSnapshot {
  recommendationKey: string;
  userId: number;
  decision: RecurringRecommendationDecision;
  deferredUntil?: string | null;
  createdProjectActionId?: number | null;
  createdFullPotentialActionId?: number | null;
}

export interface RecurringWeeklyProjectReference {
  projectId: number;
  projectName: string;
}

export interface RecurringWeeklyProjectedAction {
  type: "recurring_project_window";
  priority: "urgent" | "high" | "medium";
  title: string;
  description: string;
  actionKey: string;
  projectId?: number;
  projectName?: string;
  accountId: number | null;
  signalId: number | null;
  programmeId: number;
  occurrenceId: number;
  programmeName: string;
  cycleLabel: string;
  nextExpectedWindow: { startDate: string; endDate: string };
  whyNow: string;
  recommendedAction: string;
  requiresUserAcceptance: true;
  durableActionCreated: false;
  fullPotentialMonetaryImpactAud: 0;
}

export interface RecurringWeeklyProjectionResult {
  projectedActions: RecurringWeeklyProjectedAction[];
  suppressed: Array<{
    recommendationKey: string;
    reason: "already_decided" | "deferred" | "duplicate" | "missing_account_and_project";
  }>;
  invariants: {
    durableActionsCreated: 0;
    projectActionsCreated: 0;
    fullPotentialActionsCreated: 0;
    fullPotentialMonetaryMutations: 0;
  };
}

function parseDateOnly(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a valid date`);
  }
  return parsed;
}

/**
 * Read-only adapter for the existing weekly page. It projects recommendations
 * but never persists an action. A later user-acceptance mutation is a separate,
 * audited operation.
 */
export function projectRecurringRecommendationsForWeek(input: {
  userId: number;
  asOfDate: string;
  recommendations: RecurringWeeklyRecommendation[];
  decisions: RecurringRecommendationDecisionSnapshot[];
  projects: RecurringWeeklyProjectReference[];
  existingSuggestedActionKeys?: string[];
}): RecurringWeeklyProjectionResult {
  if (!Number.isInteger(input.userId) || input.userId <= 0) throw new Error("userId must be a positive integer");
  const asOf = parseDateOnly(input.asOfDate, "asOfDate");
  const projectById = new Map(input.projects.map(project => [project.projectId, project]));
  const decisionByKey = new Map(
    input.decisions
      .filter(decision => decision.userId === input.userId)
      .map(decision => [decision.recommendationKey, decision]),
  );
  const seen = new Set(input.existingSuggestedActionKeys ?? []);
  const projectedActions: RecurringWeeklyProjectedAction[] = [];
  const suppressed: RecurringWeeklyProjectionResult["suppressed"] = [];

  for (const recommendation of input.recommendations) {
    if (
      recommendation.requiresUserAcceptance !== true
      || recommendation.durableActionCreated !== false
      || recommendation.fullPotentialMonetaryImpactAud !== 0
    ) {
      throw new Error(`recommendation ${recommendation.recommendationKey} violates the projection-only contract`);
    }
    const decision = decisionByKey.get(recommendation.recommendationKey);
    if (decision) {
      if (decision.decision === "deferred" && decision.deferredUntil) {
        const deferredUntil = parseDateOnly(decision.deferredUntil, "deferredUntil");
        if (deferredUntil.getTime() > asOf.getTime()) {
          suppressed.push({ recommendationKey: recommendation.recommendationKey, reason: "deferred" });
          continue;
        }
      } else {
        suppressed.push({ recommendationKey: recommendation.recommendationKey, reason: "already_decided" });
        continue;
      }
    }

    if (seen.has(recommendation.recommendationKey)) {
      suppressed.push({ recommendationKey: recommendation.recommendationKey, reason: "duplicate" });
      continue;
    }
    if (!recommendation.projectId && !recommendation.accountId) {
      suppressed.push({ recommendationKey: recommendation.recommendationKey, reason: "missing_account_and_project" });
      continue;
    }
    seen.add(recommendation.recommendationKey);
    const project = recommendation.projectId
      ? projectById.get(recommendation.projectId)
      : undefined;

    projectedActions.push({
      type: "recurring_project_window",
      priority: recommendation.urgency,
      title: `${recommendation.programmeName} · ${recommendation.cycleLabel}`,
      description: recommendation.whyNow,
      actionKey: recommendation.recommendationKey,
      projectId: recommendation.projectId ?? undefined,
      projectName: project?.projectName,
      accountId: recommendation.accountId,
      signalId: recommendation.signalId,
      programmeId: recommendation.programmeId,
      occurrenceId: recommendation.occurrenceId,
      programmeName: recommendation.programmeName,
      cycleLabel: recommendation.cycleLabel,
      nextExpectedWindow: { ...recommendation.nextExpectedWindow },
      whyNow: recommendation.whyNow,
      recommendedAction: recommendation.recommendedAction,
      requiresUserAcceptance: true,
      durableActionCreated: false,
      fullPotentialMonetaryImpactAud: 0,
    });
  }

  projectedActions.sort((left, right) => {
    const rank = { urgent: 0, high: 1, medium: 2 } as const;
    return rank[left.priority] - rank[right.priority]
      || left.nextExpectedWindow.startDate.localeCompare(right.nextExpectedWindow.startDate)
      || left.actionKey.localeCompare(right.actionKey);
  });

  return {
    projectedActions,
    suppressed,
    invariants: {
      durableActionsCreated: 0,
      projectActionsCreated: 0,
      fullPotentialActionsCreated: 0,
      fullPotentialMonetaryMutations: 0,
    },
  };
}
