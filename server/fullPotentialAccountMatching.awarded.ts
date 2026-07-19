import { loadFullPotentialMatchIndex } from "./fullPotentialAccountMatching";
import { resolveProjectFullPotentialContext, type ProjectFullPotentialContext } from "./fullPotentialAccountMatching.shared";

export interface AwardedProjectLikeForFullPotentialMatching {
  id: number;
  project: string;
  winningContractor: string;
  location?: string | null;
  stage?: string | null;
  opportunity?: string | null;
}

export async function enrichAwardedProjectsWithFullPotentialContext<T extends AwardedProjectLikeForFullPotentialMatching>(
  awardedRows: T[],
): Promise<Array<T & { fullPotentialContext: ProjectFullPotentialContext }>> {
  if (awardedRows.length === 0) return [];
  const index = await loadFullPotentialMatchIndex();

  return awardedRows.map(award => ({
    ...award,
    fullPotentialContext: resolveProjectFullPotentialContext(
      {
        id: award.id,
        name: award.project,
        owner: null,
        location: award.location ?? null,
        projectState: award.location ?? null,
        sourcePurpose: "awarded",
        lifecycleStatus: "awarded",
        contractors: [],
      },
      index,
      { awardedContractor: award.winningContractor },
    ),
  }));
}
