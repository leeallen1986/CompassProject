import { getUserById } from "./db";
import { commercialTruthRepName } from "./portableAirCommercialPolicy";
import {
  getThisWeekSummary as getPolicyThisWeekSummary,
} from "./thisWeekCommercialPolicyService";
import {
  getThisWeekSummary as getLegacyThisWeekSummary,
  type SuggestedAction,
  type ThisWeekProject,
  type ThisWeekStakeholder,
  type ThisWeekSummary,
  type StageChange,
  type UserContext,
} from "./thisWeekServiceLegacy";

export type {
  SuggestedAction,
  ThisWeekProject,
  ThisWeekStakeholder,
  ThisWeekSummary,
  StageChange,
  UserContext,
} from "./thisWeekServiceLegacy";

/**
 * Issue #109 enables the accepted Portable Air commercial-truth chain only for
 * Ryan Pemberton, Paul Lueth and Dan Day. Other users retain the legacy projection.
 */
export async function getThisWeekSummary(userId?: number): Promise<ThisWeekSummary> {
  if (!userId) return getLegacyThisWeekSummary(userId);

  try {
    const user = await getUserById(userId);
    const repName = commercialTruthRepName(user?.name);
    if (repName) {
      return getPolicyThisWeekSummary(userId, repName);
    }
  } catch (error) {
    console.warn(
      "[ThisWeekCommercialTruth] Rep identity lookup failed; using legacy projection",
      error instanceof Error ? error.message : String(error),
    );
  }

  return getLegacyThisWeekSummary(userId);
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
