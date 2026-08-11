import { getProjectBuyerRouteInputs, getUserById } from "./db";
import { buildProjectBuyerRoute } from "./projectBuyerRoute";
import {
  buildRyanPortfolioAudit,
  type RyanPortfolioAuditInput,
  type RyanPortfolioAuditReport,
} from "./ryanPortfolioAudit.shared";
import { getThisWeekSummary } from "./thisWeekService";

export async function generateRyanPortfolioAudit(
  userId: number,
  options?: { worstLimit?: number; generatedAt?: Date },
): Promise<RyanPortfolioAuditReport> {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("Ryan portfolio audit requires a positive persisted user ID");
  }

  const [user, summary] = await Promise.all([
    getUserById(userId),
    getThisWeekSummary(userId),
  ]);
  if (!user) throw new Error(`User ${userId} was not found`);

  const inputs: RyanPortfolioAuditInput[] = await Promise.all(
    summary.topProjects.map(async (project, index) => {
      const buyerRouteInputs = await getProjectBuyerRouteInputs(project.id);
      const dossier = buyerRouteInputs
        ? buildProjectBuyerRoute(buyerRouteInputs)
        : null;

      return {
        project: {
          rank: index + 1,
          id: project.id,
          name: project.name,
          owner: project.owner,
          priority: project.priority,
          actionTier: project.actionTier,
          relevanceScore: project.relevanceScore,
          laneFitLabel: project.laneFitLabel,
          airFit: project.airFit,
          bestProductAngle: project.bestProductAngle,
          equipmentSignals: project.equipmentSignals,
          detectedActivities: project.detectedActivities,
          routeToBuy: project.routeToBuy,
          bestNextMove: project.bestNextMove,
          contactCTAAction: project.contactCTA.action,
          bestStakeholder: project.bestStakeholder
            ? {
                name: project.bestStakeholder.name,
                company: project.bestStakeholder.company,
                email: project.bestStakeholder.email,
              }
            : null,
        },
        dossier,
      };
    }),
  );

  return buildRyanPortfolioAudit(inputs, {
    userId,
    userName: user.name?.trim() || `User ${userId}`,
    weekLabel: summary.weekLabel,
    generatedAt: options?.generatedAt,
    worstLimit: options?.worstLimit,
  });
}
