export type FullPotentialMatchCertainty =
  | "confirmed"
  | "likely_high"
  | "likely_medium"
  | "unresolved";

export interface FullPotentialAccountRuntimeContext {
  id: number;
  canonicalName: string;
  displayName?: string | null;
  ownerName?: string | null;
  channelOwner?: string | null;
  routeToMarket?: string | null;
  priorityTier?: string | null;
  platformPushDecision?: string | null;
  fpStatus?: string | null;
  currentSupplier?: string | null;
  installedBaseStatus?: string | null;
  c4cStatus?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | Date | null;
  approvedModelId?: number | null;
  approvedModelKey?: string | null;
  approvedModelVersion?: number | null;
  approvedModelPotentialAud?: string | number | null;
  approvedModelConfidence?: string | null;
  openActionCount?: number;
  nextOpenActionType?: string | null;
  nextOpenActionDueDate?: string | Date | null;
  activePursuitCount?: number;
  activePursuitStatuses?: string[];
}

export interface FullPotentialAccountMatch {
  candidateName: string;
  candidateSource: string;
  candidateRole: string;
  relationshipEvidence: string;
  relationshipConfidence: number;
  accountId: number;
  canonicalName: string;
  displayName: string | null;
  matchedSourceAccountId: number;
  matchMethod: string;
  matchScore: number;
  certainty: Exclude<FullPotentialMatchCertainty, "unresolved">;
  matchReason: string;
  matchedTerm: string;
  account: FullPotentialAccountRuntimeContext;
}

export interface UnresolvedFullPotentialCandidate {
  candidateName: string;
  candidateSource: string;
  candidateRole: string;
  relationshipEvidence: string;
  reason: "no_match" | "ambiguous_match" | "weak_match";
  possibleAccountIds: number[];
  bestScore: number;
}

export interface ProjectFullPotentialContext {
  primaryMatch: FullPotentialAccountMatch | null;
  matches: FullPotentialAccountMatch[];
  unresolvedCandidates: UnresolvedFullPotentialCandidate[];
  candidateCount: number;
  confirmedCount: number;
  likelyCount: number;
}

export interface ProjectContextResult {
  projectId: number;
  context: ProjectFullPotentialContext;
}

export interface AwardedProjectContextResult {
  awardedProject: { id: number; [key: string]: unknown };
  context: ProjectFullPotentialContext;
}

export interface ProjectAccountContextMetrics {
  matchedAccounts: number;
  confirmedRoutes: number;
  likelyRoutes: number;
  unresolvedRoutes: number;
}

const EMPTY_CONTEXT: ProjectFullPotentialContext = {
  primaryMatch: null,
  matches: [],
  unresolvedCandidates: [],
  candidateCount: 0,
  confirmedCount: 0,
  likelyCount: 0,
};

export function emptyProjectFullPotentialContext(): ProjectFullPotentialContext {
  return { ...EMPTY_CONTEXT, matches: [], unresolvedCandidates: [] };
}

export function uniquePositiveProjectIds(projectIds: readonly number[]): number[] {
  return [...new Set(projectIds)]
    .filter(projectId => Number.isInteger(projectId) && projectId > 0)
    .sort((a, b) => a - b);
}

export function chunkProjectIds(projectIds: readonly number[], chunkSize = 100): number[][] {
  const ids = uniquePositiveProjectIds(projectIds);
  const safeSize = Math.max(1, Math.min(250, Math.floor(chunkSize)));
  const chunks: number[][] = [];
  for (let index = 0; index < ids.length; index += safeSize) {
    chunks.push(ids.slice(index, index + safeSize));
  }
  return chunks;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload.error) detail = payload.error;
    } catch {
      // Keep the HTTP status when an error response is not JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export async function fetchProjectFullPotentialContexts(
  projectIds: readonly number[],
  signal?: AbortSignal,
): Promise<Map<number, ProjectFullPotentialContext>> {
  const chunks = chunkProjectIds(projectIds);
  if (chunks.length === 0) return new Map();

  const payloads = await Promise.all(chunks.map(async ids => {
    const response = await fetch(
      `/api/full-potential/project-matches?projectIds=${ids.join(",")}`,
      { credentials: "include", signal },
    );
    return readJson<{ results: ProjectContextResult[] }>(response);
  }));

  const contexts = new Map<number, ProjectFullPotentialContext>();
  for (const payload of payloads) {
    for (const result of payload.results ?? []) {
      contexts.set(Number(result.projectId), result.context ?? emptyProjectFullPotentialContext());
    }
  }
  return contexts;
}

export async function fetchAwardedProjectFullPotentialContexts(
  limit = 500,
  signal?: AbortSignal,
): Promise<Map<number, ProjectFullPotentialContext>> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const response = await fetch(
    `/api/full-potential/awarded-project-matches?limit=${safeLimit}`,
    { credentials: "include", signal },
  );
  const payload = await readJson<{ results: AwardedProjectContextResult[] }>(response);
  return new Map(
    (payload.results ?? []).map(result => [Number(result.awardedProject.id), result.context]),
  );
}

export function certaintyLabel(certainty: FullPotentialMatchCertainty | null | undefined): string {
  if (certainty === "confirmed") return "Confirmed account";
  if (certainty === "likely_high") return "Likely account · high";
  if (certainty === "likely_medium") return "Likely account · validate";
  return "Account unresolved";
}

export function candidateRoleLabel(role: string | null | undefined): string {
  const labels: Record<string, string> = {
    winning_contractor: "Winning contractor",
    epc: "EPC",
    contractor: "Contractor",
    subcontractor: "Subcontractor",
    rental: "Rental / hire",
    supplier: "Supplier",
    project_owner: "Project owner",
    contact_company: "Contact company",
    consultant: "Consultant",
    unknown: "Commercial entity",
  };
  return labels[role ?? "unknown"] ?? String(role ?? "Commercial entity").replace(/_/g, " ");
}

export function routeToMarketLabel(route: string | null | undefined): string {
  const labels: Record<string, string> = {
    direct_ape: "Direct APE",
    cea: "CEA",
    cp_aps: "APS channel",
    cp_blastone: "BlastOne channel",
    cp_pneumatic_engineering: "Pneumatic Engineering channel",
    cp_more_air: "More Air channel",
    nz_distributor: "NZ distributor",
    png_oceania: "PNG / Oceania",
    hybrid_strategic: "Hybrid strategic",
    product_support: "Product support",
    manual_review: "Route review",
    exclude: "Excluded",
  };
  return labels[route ?? ""] ?? String(route ?? "Route unknown").replace(/_/g, " ");
}

export function priorityTierLabel(tier: string | null | undefined): string {
  if (!tier || tier === "unassigned") return "Tier unassigned";
  return tier.replace("tier_", "Tier ").toUpperCase();
}

export function accountContextNextGap(context: ProjectFullPotentialContext | null | undefined): string {
  const match = context?.primaryMatch;
  if (!match) {
    return (context?.candidateCount ?? 0) > 0
      ? "Confirm the buying account and route"
      : "No Full Potential buying account identified";
  }

  const account = match.account;
  if ((account.activePursuitCount ?? 0) > 0) return "Attributed pursuit active";
  if (!account.approvedModelId) return "Build and approve the evidence-backed model";
  if (!account.currentSupplier?.trim() || account.currentSupplier.toLowerCase() === "unknown") {
    return "Validate the current supplier";
  }
  if (!account.installedBaseStatus || account.installedBaseStatus === "unknown") {
    return "Validate installed base and fleet need";
  }
  if ((account.openActionCount ?? 0) === 0 && !account.nextAction?.trim()) {
    return "Set the next evidence-generating action";
  }
  return "Account route is ready for commercial validation";
}

export function summarizeProjectAccountContexts(
  contexts: readonly (ProjectFullPotentialContext | null | undefined)[],
): ProjectAccountContextMetrics {
  const accountIds = new Set<number>();
  let confirmedRoutes = 0;
  let likelyRoutes = 0;
  let unresolvedRoutes = 0;

  for (const context of contexts) {
    const match = context?.primaryMatch;
    if (match) {
      accountIds.add(match.accountId);
      if (match.certainty === "confirmed") confirmedRoutes += 1;
      else likelyRoutes += 1;
    } else if ((context?.candidateCount ?? 0) > 0) {
      unresolvedRoutes += 1;
    }
  }

  return {
    matchedAccounts: accountIds.size,
    confirmedRoutes,
    likelyRoutes,
    unresolvedRoutes,
  };
}
