import { inArray } from "drizzle-orm";
import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { getProjectFullPotentialContexts } from "./fullPotentialAccountMatching";
import {
  buildReadOnlyNextBest5,
  type NextBest5Input,
  type NextBest5PersistedProject,
  type NextBest5Response,
  type NextBest5User,
} from "./fullPotentialNextBest5.shared";
import { getThisWeekSummary } from "./thisWeekService";

const CRM_BOUNDARY = "Compass recommends evidence-generating work. C4C remains authoritative after genuine qualification.";

function emptyResponse(
  generatedAt: string,
  summary: Awaited<ReturnType<typeof getThisWeekSummary>>,
): NextBest5Response {
  return {
    readOnly: true,
    generatedAt,
    weekLabel: summary.weekLabel,
    userContext: summary.userContext,
    candidatePoolSize: 0,
    eligibleCount: 0,
    recommendations: [],
    exclusions: {
      not_must_act: 0,
      not_tier1: 0,
      not_hot: 0,
      not_active: 0,
      suppressed_or_merged: 0,
      no_source: 0,
      no_explicit_air_evidence: 0,
      no_account_route: 0,
      weak_account_route: 0,
      already_managed: 0,
      owner_mismatch: 0,
      duplicate_account: 0,
    },
    crmBoundary: CRM_BOUNDARY,
  };
}

export async function getReadOnlyNextBest5(
  user: NextBest5User,
): Promise<NextBest5Response> {
  const summary = await getThisWeekSummary(user.id);
  const generatedAt = new Date().toISOString();

  if (!summary.userContext.scopeResolved || summary.topProjects.length === 0) {
    return emptyResponse(generatedAt, summary);
  }

  const topProjects = summary.topProjects;
  const projectIds = topProjects
    .map(project => Number(project.id))
    .filter(projectId => Number.isInteger(projectId) && projectId > 0);

  if (projectIds.length === 0) return emptyResponse(generatedAt, summary);

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [projectRows, contextRows] = await Promise.all([
    db.select().from(projects).where(inArray(projects.id, projectIds)),
    getProjectFullPotentialContexts(projectIds),
  ]);

  const persistedById = new Map(
    projectRows.map(project => [
      Number(project.id),
      project as unknown as NextBest5PersistedProject,
    ]),
  );
  const contextById = new Map(
    contextRows.map(row => [Number(row.projectId), row.context]),
  );

  const inputs: NextBest5Input[] = topProjects.flatMap((project, index) => {
    const persistedProject = persistedById.get(Number(project.id));
    const context = contextById.get(Number(project.id));
    if (!persistedProject || !context) return [];
    return [{
      project,
      persistedProject,
      context,
      serverPosition: index + 1,
    }];
  });

  const built = buildReadOnlyNextBest5(inputs, user);

  return {
    readOnly: true,
    generatedAt,
    weekLabel: summary.weekLabel,
    userContext: summary.userContext,
    candidatePoolSize: inputs.length,
    eligibleCount: built.eligibleCount,
    recommendations: built.recommendations,
    exclusions: built.exclusions,
    crmBoundary: CRM_BOUNDARY,
  };
}
