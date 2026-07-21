import type { ProjectFullPotentialContext } from "@/lib/fullPotentialProjectContext";

export type ExploreProjectsView =
  | "for-you"
  | "confirmed"
  | "likely"
  | "awarded"
  | "tenders"
  | "all-intelligence";

export const EXPLORE_PROJECTS_VIEWS: Array<{
  key: ExploreProjectsView;
  label: string;
  description: string;
}> = [
  {
    key: "for-you",
    label: "For You",
    description: "Lane-gated projects ranked by the same server-side scoring used by This Week.",
  },
  {
    key: "confirmed",
    label: "Confirmed Contractors",
    description: "Actionable projects with a confirmed canonical buying account or contractor route.",
  },
  {
    key: "likely",
    label: "Likely Contractors",
    description: "Strong account hypotheses that still require rep validation before action.",
  },
  {
    key: "awarded",
    label: "Awarded & Mobilising",
    description: "Funded work with a named winning contractor and an account route to validate.",
  },
  {
    key: "tenders",
    label: "Live Tenders",
    description: "Lane-gated tenders closing within 14 days.",
  },
  {
    key: "all-intelligence",
    label: "All Intelligence",
    description: "Broad research view for investigation, not the default rep action list.",
  },
];

export interface ExploreProjectLike {
  id: number;
  name: string;
  location?: string | null;
  priority?: string | null;
  stage?: string | null;
  relevanceScore?: number | null;
  visibilityTier?: string | null;
  laneFitLabel?: string | null;
  channel?: string | null;
  whyNow?: string | null;
  routeToBuy?: string | null;
  bestNextMove?: string | null;
  bestProductAngle?: string | null;
  airFit?: string | null;
  tenderCloseDate?: Date | string | null;
  fullPotentialContext?: ProjectFullPotentialContext | null;
}

export interface ExploreRouteMetrics {
  actionableProjects: number;
  matchedAccounts: number;
  confirmedRoutes: number;
  likelyRoutes: number;
  unresolvedRoutes: number;
}

const PRIORITY_ORDER: Record<string, number> = {
  hot: 3,
  warm: 2,
  cold: 1,
};

const VISIBILITY_ORDER: Record<string, number> = {
  must_act_candidate: 4,
  watchlist_candidate: 3,
  monitor_only: 2,
  suppress: 1,
};

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function certaintyForProject(project: ExploreProjectLike): string | null {
  return project.fullPotentialContext?.primaryMatch?.certainty ?? null;
}

export function hasUnresolvedBuyingRoute(project: ExploreProjectLike): boolean {
  const context = project.fullPotentialContext;
  return Boolean(context && !context.primaryMatch && context.candidateCount > 0);
}

export function sortExploreProjects<T extends ExploreProjectLike>(projects: readonly T[]): T[] {
  return [...projects].sort((left, right) => {
    const visibilityDelta =
      (VISIBILITY_ORDER[right.visibilityTier ?? ""] ?? 0)
      - (VISIBILITY_ORDER[left.visibilityTier ?? ""] ?? 0);
    if (visibilityDelta !== 0) return visibilityDelta;

    const relevanceDelta = Number(right.relevanceScore ?? 0) - Number(left.relevanceScore ?? 0);
    if (relevanceDelta !== 0) return relevanceDelta;

    const priorityDelta =
      (PRIORITY_ORDER[right.priority ?? ""] ?? 0)
      - (PRIORITY_ORDER[left.priority ?? ""] ?? 0);
    if (priorityDelta !== 0) return priorityDelta;

    return left.name.localeCompare(right.name);
  });
}

export function filterExploreProjects<T extends ExploreProjectLike>(
  projects: readonly T[],
  view: ExploreProjectsView,
): T[] {
  // This Week owns the operating rank. Explore Projects may filter that array,
  // but must not silently create a second client-side ordering truth.
  const ordered = [...projects];
  if (view === "confirmed") {
    return ordered.filter(project => certaintyForProject(project) === "confirmed");
  }
  if (view === "likely") {
    return ordered.filter(project => {
      const certainty = certaintyForProject(project);
      return certainty === "likely_high" || certainty === "likely_medium";
    });
  }
  return ordered;
}

export function searchExploreProjects<T extends ExploreProjectLike>(
  projects: readonly T[],
  query: string,
): T[] {
  const term = normalize(query);
  if (!term) return [...projects];

  return projects.filter(project => {
    const match = project.fullPotentialContext?.primaryMatch;
    const account = match?.account;
    const values = [
      project.name,
      project.location,
      project.stage,
      project.whyNow,
      project.routeToBuy,
      match?.canonicalName,
      match?.displayName,
      match?.candidateName,
      account?.ownerName,
      account?.channelOwner,
      account?.routeToMarket,
    ];
    return values.some(value => normalize(value).includes(term));
  });
}

export function buildExploreRouteMetrics(projects: readonly ExploreProjectLike[]): ExploreRouteMetrics {
  const matchedAccountIds = new Set<number>();
  let confirmedRoutes = 0;
  let likelyRoutes = 0;
  let unresolvedRoutes = 0;

  for (const project of projects) {
    const context = project.fullPotentialContext;
    const match = context?.primaryMatch;
    if (match) {
      matchedAccountIds.add(match.accountId);
      if (match.certainty === "confirmed") confirmedRoutes += 1;
      else likelyRoutes += 1;
    } else if (context && context.candidateCount > 0) {
      unresolvedRoutes += 1;
    }
  }

  return {
    actionableProjects: projects.length,
    matchedAccounts: matchedAccountIds.size,
    confirmedRoutes,
    likelyRoutes,
    unresolvedRoutes,
  };
}

export function parseExploreProjectsLocation(search: string): {
  view: ExploreProjectsView;
  redirectToLegacy: boolean;
} {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const explicitView = params.get("view") as ExploreProjectsView | null;
  if (explicitView && EXPLORE_PROJECTS_VIEWS.some(view => view.key === explicitView)) {
    return { view: explicitView, redirectToLegacy: explicitView === "all-intelligence" };
  }

  const tab = params.get("tab");
  if (tab === "awarded") return { view: "awarded", redirectToLegacy: false };
  if (tab === "live-tenders") return { view: "tenders", redirectToLegacy: false };
  if (tab === "projects" || tab === "overview" || !tab) {
    const legacyOnlyParam = params.has("collateralId") || params.has("project") || params.has("expandFilters");
    return { view: "for-you", redirectToLegacy: legacyOnlyParam };
  }

  const legacyTabs = new Set(["contacts", "drilling", "ai-search", "contractors", "sources"]);
  return {
    view: legacyTabs.has(tab) ? "all-intelligence" : "for-you",
    redirectToLegacy: legacyTabs.has(tab),
  };
}

export function exploreViewSearch(view: ExploreProjectsView): string {
  return view === "for-you" ? "" : `?view=${encodeURIComponent(view)}`;
}

export function legacyIntelligenceHref(search: string): string {
  const suffix = search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `/dashboard/intelligence${suffix}`;
}

export function closingWindowLabel(
  value: Date | string | null | undefined,
  now = new Date(),
): string {
  if (!value) return "Close date not confirmed";
  const closeDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(closeDate.getTime()) || Number.isNaN(now.getTime())) {
    return "Close date not confirmed";
  }

  const closeDay = Date.UTC(
    closeDate.getUTCFullYear(),
    closeDate.getUTCMonth(),
    closeDate.getUTCDate(),
  );
  const currentDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const days = Math.round((closeDay - currentDay) / (24 * 60 * 60 * 1000));

  if (days < 0) return "Closed";
  if (days === 0) return "Closes today";
  if (days === 1) return "Closes tomorrow";
  return `Closes in ${days} days`;
}

export function locationMatchesExploreTerritories(
  location: string | null | undefined,
  territories: readonly string[],
): boolean {
  if (territories.length === 0) return true;
  const normalizedTerritories = territories.map(value => value.toUpperCase());
  if (normalizedTerritories.includes("NATIONAL") || normalizedTerritories.length >= 8) return true;

  const haystack = ` ${normalize(location).replace(/[^a-z0-9]+/g, " ")} `;
  const aliases: Record<string, string[]> = {
    WA: ["wa", "western australia", "perth", "pilbara", "karratha", "kalgoorlie", "port hedland"],
    QLD: ["qld", "queensland", "brisbane", "mackay", "gladstone", "bowen basin"],
    NSW: ["nsw", "new south wales", "sydney", "newcastle", "hunter valley"],
    VIC: ["vic", "victoria", "melbourne", "geelong"],
    SA: ["sa", "south australia", "adelaide", "whyalla", "olympic dam"],
    NT: ["nt", "northern territory", "darwin"],
    TAS: ["tas", "tasmania", "hobart"],
    ACT: ["act", "australian capital territory", "canberra"],
    OFFSHORE_AU: ["offshore", "fpso", "north west shelf", "nwshelf"],
    OFFSHORE: ["offshore", "fpso", "north west shelf", "nwshelf"],
  };

  return normalizedTerritories.some(territory =>
    (aliases[territory] ?? [territory.toLowerCase()]).some(alias => {
      const normalizedAlias = alias.toLowerCase();
      return normalizedAlias.length <= 3
        ? haystack.includes(` ${normalizedAlias} `)
        : haystack.includes(normalizedAlias);
    }),
  );
}
