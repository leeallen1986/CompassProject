import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Award,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock,
  Compass,
  ExternalLink,
  Filter,
  Loader2,
  Search,
  Shield,
  Sparkles,
  Target,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import ExploreOpportunityCard, {
  type ExploreOpportunityProject,
} from "@/components/ExploreOpportunityCard";
import FullPotentialAccountContext from "@/components/FullPotentialAccountContext";
import { useAwardedProjectFullPotentialContexts, useFullPotentialProjectContexts } from "@/hooks/useFullPotentialProjectContexts";
import {
  EXPLORE_PROJECTS_VIEWS,
  buildExploreRouteMetrics,
  closingWindowLabel,
  exploreViewSearch,
  filterExploreProjects,
  legacyIntelligenceHref,
  locationMatchesExploreTerritories,
  parseExploreProjectsLocation,
  searchExploreProjects,
  type ExploreProjectLike,
  type ExploreProjectsView,
} from "@/lib/exploreProjects";
import { trpc } from "@/lib/trpc";

function MetricCard({
  value,
  label,
  detail,
  icon,
}: {
  value: number;
  label: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-bold text-navy">{value}</div>
          <div className="mt-0.5 text-xs font-bold text-slate-700">{label}</div>
          <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{detail}</div>
        </div>
        <div className="rounded-lg bg-navy/5 p-2 text-navy">{icon}</div>
      </div>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center">
      <Target className="mx-auto h-8 w-8 text-slate-300" />
      <h3 className="mt-3 text-sm font-bold text-navy">{title}</h3>
      <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-border bg-card">
      <div className="text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-gold" />
        <p className="mt-3 text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export default function ExploreProjects() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const initialLocation = useMemo(
    () => parseExploreProjectsLocation(typeof window === "undefined" ? "" : window.location.search),
    [],
  );
  const [activeView, setActiveView] = useState<ExploreProjectsView>(initialLocation.view);
  const [search, setSearch] = useState("");
  const internalUser = Boolean(isAuthenticated && user && user.role !== "distributor");

  useEffect(() => {
    if (!initialLocation.redirectToLegacy) return;
    navigate(legacyIntelligenceHref(window.location.search));
  }, [initialLocation.redirectToLegacy, navigate]);

  const summaryQuery = trpc.thisWeek.summary.useQuery(undefined, {
    enabled: internalUser && !initialLocation.redirectToLegacy,
    staleTime: 5 * 60 * 1000,
  });
  const closingSoonQuery = trpc.report.closingSoon.useQuery(
    { daysAhead: 14 },
    {
      enabled: internalUser && activeView === "tenders",
      staleTime: 5 * 60 * 1000,
    },
  );
  const awardedReportQuery = trpc.report.full.useQuery(
    { lifecycleFilter: "active" },
    {
      enabled: internalUser && activeView === "awarded",
      staleTime: 5 * 60 * 1000,
    },
  );

  const topProjectIds = useMemo(
    () => ((summaryQuery.data?.topProjects ?? []) as Array<{ id: number }>).map(project => Number(project.id)),
    [summaryQuery.data?.topProjects],
  );
  const topContextQuery = useFullPotentialProjectContexts(
    topProjectIds,
    internalUser && topProjectIds.length > 0,
  );

  const tenderProjectIds = useMemo(
    () => ((closingSoonQuery.data ?? []) as Array<{ id: number }>).map(project => Number(project.id)),
    [closingSoonQuery.data],
  );
  const tenderContextQuery = useFullPotentialProjectContexts(
    tenderProjectIds,
    internalUser && activeView === "tenders" && tenderProjectIds.length > 0,
  );
  const awardedContextQuery = useAwardedProjectFullPotentialContexts(
    internalUser && activeView === "awarded",
    500,
  );

  const topProjects = useMemo<ExploreOpportunityProject[]>(() => {
    return ((summaryQuery.data?.topProjects ?? []) as ExploreOpportunityProject[]).map(project => ({
      ...project,
      fullPotentialContext: topContextQuery.contextsByProjectId.get(Number(project.id)) ?? null,
    }));
  }, [summaryQuery.data?.topProjects, topContextQuery.contextsByProjectId]);

  const topProjectsById = useMemo(
    () => new Map(topProjects.map(project => [Number(project.id), project])),
    [topProjects],
  );

  const tenderProjects = useMemo<ExploreOpportunityProject[]>(() => {
    return ((closingSoonQuery.data ?? []) as ExploreOpportunityProject[]).map(project => {
      const ranked = topProjectsById.get(Number(project.id));
      return {
        ...project,
        relevanceScore: ranked?.relevanceScore ?? project.relevanceScore ?? null,
        laneFitLabel: ranked?.laneFitLabel ?? project.laneFitLabel ?? null,
        channel: ranked?.channel ?? project.channel ?? null,
        whyNow: ranked?.whyNow ?? project.whyNow ?? null,
        routeToBuy: ranked?.routeToBuy ?? project.routeToBuy ?? null,
        bestNextMove: ranked?.bestNextMove ?? project.bestNextMove ?? null,
        bestProductAngle: ranked?.bestProductAngle ?? project.bestProductAngle ?? null,
        fullPotentialContext: tenderContextQuery.contextsByProjectId.get(Number(project.id)) ?? null,
      };
    });
  }, [closingSoonQuery.data, tenderContextQuery.contextsByProjectId, topProjectsById]);

  const laneProjects = useMemo(() => {
    const filtered = filterExploreProjects(topProjects, activeView);
    return searchExploreProjects(filtered, search);
  }, [activeView, search, topProjects]);

  const territories = summaryQuery.data?.userContext?.territories ?? [];
  const awardedRows = useMemo(() => {
    const rows = (awardedReportQuery.data?.awardedProjects ?? []) as any[];
    const normalizedSearch = search.trim().toLowerCase();
    return rows
      .filter(row => locationMatchesExploreTerritories(row.location, territories))
      .filter(row => {
        if (!normalizedSearch) return true;
        const context = awardedContextQuery.contextsByAwardedProjectId.get(Number(row.id));
        const match = context?.primaryMatch;
        return [row.project, row.winningContractor, row.location, match?.canonicalName, match?.account?.ownerName]
          .some(value => String(value ?? "").toLowerCase().includes(normalizedSearch));
      });
  }, [awardedContextQuery.contextsByAwardedProjectId, awardedReportQuery.data?.awardedProjects, search, territories]);

  const visibleTenders = useMemo(
    () => searchExploreProjects(tenderProjects, search),
    [search, tenderProjects],
  );

  const metricProjects = useMemo<ExploreProjectLike[]>(() => {
    if (activeView === "awarded") {
      return awardedRows.map(row => ({
        id: Number(row.id),
        name: String(row.project ?? row.winningContractor ?? `Awarded project ${row.id}`),
        fullPotentialContext:
          awardedContextQuery.contextsByAwardedProjectId.get(Number(row.id)) ?? null,
      }));
    }
    if (activeView === "tenders") return visibleTenders;
    return laneProjects;
  }, [
    activeView,
    awardedContextQuery.contextsByAwardedProjectId,
    awardedRows,
    laneProjects,
    visibleTenders,
  ]);
  const routeMetrics = useMemo(
    () => buildExploreRouteMetrics(metricProjects),
    [metricProjects],
  );

  const confirmedCount = filterExploreProjects(topProjects, "confirmed").length;
  const likelyCount = filterExploreProjects(topProjects, "likely").length;
  const viewCounts: Partial<Record<ExploreProjectsView, number>> = {
    "for-you": topProjects.length,
    confirmed: confirmedCount,
    likely: likelyCount,
    awarded: awardedRows.length,
    tenders: visibleTenders.length,
  };
  const activeMeta = EXPLORE_PROJECTS_VIEWS.find(view => view.key === activeView) ?? EXPLORE_PROJECTS_VIEWS[0];

  const changeView = (view: ExploreProjectsView) => {
    setActiveView(view);
    setSearch("");
    const suffix = exploreViewSearch(view);
    window.history.replaceState({}, "", `/dashboard${suffix}`);
  };

  if (initialLocation.redirectToLegacy) {
    return <LoadingState label="Opening the broad intelligence research view…" />;
  }

  if (authLoading) return <LoadingState label="Loading your commercial intelligence…" />;

  if (!isAuthenticated || !user) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-10 text-center">
        <Shield className="mx-auto h-10 w-10 text-navy" />
        <h2 className="mt-3 text-lg font-bold text-navy">Internal sales access required</h2>
        <p className="mt-2 text-sm text-muted-foreground">Sign in to see lane-ranked project and buying-account intelligence.</p>
        <Link href="/login" className="mt-5 inline-flex rounded-lg bg-navy px-5 py-2.5 text-sm font-semibold text-white">
          Sign in
        </Link>
      </div>
    );
  }

  if (user.role === "distributor") {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-10 text-center">
        <Shield className="mx-auto h-10 w-10 text-amber-600" />
        <h2 className="mt-3 text-lg font-bold text-navy">Internal account context</h2>
        <p className="mt-2 text-sm text-amber-900/80">
          Canonical Full Potential accounts, internal ownership and route-to-market context are available only to the internal sales team.
        </p>
      </div>
    );
  }

  if (summaryQuery.isLoading || !summaryQuery.data) {
    return <LoadingState label="Applying your territory and lane scoring…" />;
  }

  const contextError = topContextQuery.error || tenderContextQuery.error || awardedContextQuery.error;

  return (
    <main className="container space-y-6 py-6 sm:py-8">
      <section className="overflow-hidden rounded-2xl border border-navy/10 bg-gradient-to-br from-navy via-navy to-slate-800 p-6 text-white shadow-lg sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold text-slate-200">
              <Compass className="h-3.5 w-3.5 text-gold" /> Same server-side lane truth as This Week
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Explore Projects</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
              Start with projects that fit your selling lane, then confirm the contractor, canonical buying account and next evidence-generating action. The broad market feed remains available as a secondary research view.
            </p>
          </div>
          <Link
            href="/dashboard/intelligence"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/15"
          >
            <BarChart3 className="h-4 w-4" /> Open all intelligence
          </Link>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 text-[11px] text-slate-300">
          {(summaryQuery.data.userContext?.territories ?? []).map((territory: string) => (
            <span key={territory} className="rounded-full bg-white/10 px-2.5 py-1">{territory}</span>
          ))}
          {(summaryQuery.data.userContext?.assignedBusinessLines ?? []).map((line: string) => (
            <span key={line} className="rounded-full bg-gold/15 px-2.5 py-1 text-gold-light">{line}</span>
          ))}
        </div>
      </section>

      {contextError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>Project ranking is available, but some internal Full Potential account context could not be loaded. No false no-match labels are shown.</span>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard
          value={routeMetrics.actionableProjects}
          label="Actionable for You"
          detail="Passed the shared lane and territory gates"
          icon={<Sparkles className="h-5 w-5" />}
        />
        <MetricCard
          value={routeMetrics.matchedAccounts}
          label="Matched Buying Accounts"
          detail="Unique canonical Full Potential accounts"
          icon={<Building2 className="h-5 w-5" />}
        />
        <MetricCard
          value={routeMetrics.confirmedRoutes}
          label="Confirmed Routes"
          detail="Contractor or account relationship confirmed"
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
        />
        <MetricCard
          value={routeMetrics.likelyRoutes}
          label="Likely — Validate"
          detail="Strong hypothesis requiring rep confirmation"
          icon={<Target className="h-5 w-5 text-blue-600" />}
        />
        <MetricCard
          value={routeMetrics.unresolvedRoutes}
          label="Needs Resolution"
          detail="Commercial entity found, canonical account unclear"
          icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {EXPLORE_PROJECTS_VIEWS.map(view => {
            const active = activeView === view.key;
            const count = viewCounts[view.key];
            return (
              <button
                key={view.key}
                type="button"
                onClick={() => changeView(view.key)}
                className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-navy text-white shadow-sm"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-navy"
                }`}
              >
                {view.label}{count !== undefined ? ` · ${count}` : ""}
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-navy">{activeMeta.label}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{activeMeta.description}</p>
          </div>
          {activeView !== "all-intelligence" && (
            <div className="relative min-w-[240px] flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search project, account, owner or route…"
                className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
            </div>
          )}
        </div>

        {(activeView === "for-you" || activeView === "confirmed" || activeView === "likely") && (
          laneProjects.length > 0 ? (
            <div className="space-y-3">
              {laneProjects.map(project => <ExploreOpportunityCard key={project.id} project={project} />)}
            </div>
          ) : (
            <EmptyState
              title="No projects in this view"
              detail={activeView === "confirmed"
                ? "No current lane-ranked project has a confirmed canonical buying route. Review Likely Contractors or unresolved account routes."
                : activeView === "likely"
                  ? "No current lane-ranked project has a likely account hypothesis waiting for validation."
                  : "No lane-gated projects match the current search."}
            />
          )
        )}

        {activeView === "tenders" && (
          closingSoonQuery.isLoading || tenderContextQuery.isLoading ? (
            <LoadingState label="Loading lane-gated tenders…" />
          ) : visibleTenders.length > 0 ? (
            <div className="space-y-3">
              {visibleTenders.map(project => (
                <ExploreOpportunityCard
                  key={project.id}
                  project={project}
                  tenderTiming={closingWindowLabel(project.tenderCloseDate)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No lane-gated tenders closing soon"
              detail="The full tender library remains available in All Intelligence, but no tender currently passes your lane and territory gate within the next 14 days."
            />
          )
        )}

        {activeView === "awarded" && (
          awardedReportQuery.isLoading || awardedContextQuery.isLoading ? (
            <LoadingState label="Loading awarded contractor routes…" />
          ) : awardedRows.length > 0 ? (
            <div className="space-y-3">
              {awardedRows.map((award: any) => {
                const context = awardedContextQuery.contextsByAwardedProjectId.get(Number(award.id));
                return (
                  <article key={award.id} className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                            <Award className="h-3 w-3" /> Awarded
                          </span>
                          {award.opportunity && (
                            <span className="rounded bg-gold/15 px-2 py-0.5 text-[10px] font-semibold text-gold-dark">{award.opportunity}</span>
                          )}
                          {award.stage && (
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{award.stage}</span>
                          )}
                        </div>
                        <h3 className="mt-2 text-base font-bold text-navy">{award.project}</h3>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />Winning contractor: {award.winningContractor}</span>
                          <span>{award.location}</span>
                          {award.value && <span>{award.value}</span>}
                        </div>
                      </div>
                      {award.sourceUrl && (
                        <a
                          href={award.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-teal"
                        >
                          Source <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                    <div className="mt-3">
                      <FullPotentialAccountContext context={context} showEmpty />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No awarded projects in the current territory"
              detail="Awarded intelligence remains available in the broad research view if you need to inspect work outside your primary territory."
            />
          )
        )}

        {activeView === "all-intelligence" && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center sm:p-12">
            <Filter className="mx-auto h-10 w-10 text-slate-400" />
            <h3 className="mt-4 text-lg font-bold text-navy">Broad market-intelligence research view</h3>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Use this only when you need the complete project, contact, drilling, contractor or source library. It is intentionally secondary to the lane-gated sales board and may contain monitoring intelligence that does not require immediate sales action.
            </p>
            <Link
              href={legacyIntelligenceHref("")}
              className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-navy-light"
            >
              Open all intelligence <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </section>

      <footer className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-xs leading-relaxed text-blue-900">
        <strong>Compass boundary:</strong> this board identifies the project, buying account, route and next evidence-generating action. C4C remains the system of record once the pursuit is genuinely qualified.
      </footer>
    </main>
  );
}
