import { getUserById } from "./db";
import {
  getThisWeekSummary as getCommercialThisWeekSummary,
} from "./thisWeekCommercialService";
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

function isRyanPemberton(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === "ryan pemberton";
}

/**
 * Issue #106 is intentionally a Ryan-only pilot.
 *
 * Paul/Dan and other sales users remain on the unchanged legacy projection until
 * the same commercial-truth rules have been verified against Ryan's live 15-project
 * set. This prevents a Ryan-specific routing fix from silently changing other reps.
 */
export async function getThisWeekSummary(userId?: number): Promise<ThisWeekSummary> {
  if (!userId) return getLegacyThisWeekSummary(userId);

  try {
    const user = await getUserById(userId);
    if (isRyanPemberton(user?.name)) {
      return getCommercialThisWeekSummary(userId);
    }
  } catch (error) {
    console.warn(
      "[ThisWeekCommercialTruth] Ryan identity lookup failed; using legacy projection",
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
