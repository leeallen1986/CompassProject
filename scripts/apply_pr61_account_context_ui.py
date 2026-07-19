from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match in {path}, found {count}")
    path.write_text(text.replace(old, new, 1))


project_card = ROOT / "client/src/components/ProjectCard.tsx"
replace_once(
    project_card,
    'import { sanitizeContractorName, deriveWhyNow } from "@shared/utils";\n',
    'import { sanitizeContractorName, deriveWhyNow } from "@shared/utils";\n'
    'import FullPotentialAccountContext from "@/components/FullPotentialAccountContext";\n'
    'import type { ProjectFullPotentialContext } from "@/lib/fullPotentialProjectContext";\n',
    "ProjectCard account-context imports",
)
replace_once(
    project_card,
    "  matchedAccountPrior?: string | null;\n}\n",
    "  matchedAccountPrior?: string | null;\n"
    "  fullPotentialContext?: ProjectFullPotentialContext | null;\n"
    "}\n",
    "ProjectData account context",
)
replace_once(
    project_card,
    '''        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground mb-2">
          <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" />{project.owner}</span>
          <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{project.location}</span>
          {project.value && project.value !== "Unknown" && (
            <span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" />{project.value}</span>
          )}
        </div>

        {/* Row 4: Why now */}
''',
    '''        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground mb-2">
          <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" />{project.owner}</span>
          <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{project.location}</span>
          {project.value && project.value !== "Unknown" && (
            <span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" />{project.value}</span>
          )}
        </div>

        <FullPotentialAccountContext context={project.fullPotentialContext} compact />

        {/* Row 4: Why now */}
''',
    "ProjectCard collapsed account context",
)
replace_once(
    project_card,
    '''            <div className="px-4 sm:px-5 pb-5 border-t border-border space-y-5 pt-4">

              {/* 1. Contacts — moved to top */}
''',
    '''            <div className="px-4 sm:px-5 pb-5 border-t border-border space-y-5 pt-4">

              {project.fullPotentialContext && (
                <FullPotentialAccountContext context={project.fullPotentialContext} showEmpty />
              )}

              {/* 1. Contacts — moved to top */}
''',
    "ProjectCard expanded account context",
)


home = ROOT / "client/src/pages/Home.tsx"
replace_once(
    home,
    'import ContractorPatterns from "@/components/ContractorPatterns";\n',
    'import ContractorPatterns from "@/components/ContractorPatterns";\n'
    'import FullPotentialAccountContext from "@/components/FullPotentialAccountContext";\n'
    'import { useAwardedProjectFullPotentialContexts, useFullPotentialProjectContexts } from "@/hooks/useFullPotentialProjectContexts";\n'
    'import { summarizeProjectAccountContexts } from "@/lib/fullPotentialProjectContext";\n',
    "Home account-context imports",
)
replace_once(
    home,
    '''  const { data: fullReport, isLoading: reportLoading } = trpc.report.full.useQuery(
    { lifecycleFilter },
    { enabled: isAuthenticated }
   );

  // Once data loads and we have a pending project, scroll to it
''',
    '''  const { data: fullReport, isLoading: reportLoading } = trpc.report.full.useQuery(
    { lifecycleFilter },
    { enabled: isAuthenticated }
   );

  const dashboardProjectIds = useMemo(
    () => ((fullReport?.projects ?? []) as Array<{ id: number }>).map(project => Number(project.id)),
    [fullReport?.projects],
  );
  const { contextsByProjectId } = useFullPotentialProjectContexts(
    dashboardProjectIds,
    isAuthenticated && !!fullReport,
  );
  const { contextsByAwardedProjectId } = useAwardedProjectFullPotentialContexts(
    isAuthenticated && !!fullReport,
    500,
  );

  // Once data loads and we have a pending project, scroll to it
''',
    "Home context hooks",
)
replace_once(
    home,
    '''  const { report, projects, contacts, drillingCampaigns, awardedProjects, lifecycleCounts } = fullReport;

  const actionItems: string[] = (report.actionItems as string[]) ?? [];
''',
    '''  const { report, projects, contacts, drillingCampaigns, awardedProjects, lifecycleCounts } = fullReport;
  const projectsWithAccountContext = (projects as ProjectData[]).map(project => ({
    ...project,
    fullPotentialContext: contextsByProjectId.get(project.id) ?? null,
  }));

  const actionItems: string[] = (report.actionItems as string[]) ?? [];
''',
    "Home project context attachment",
)
replace_once(
    home,
    '''  const personalizedProjects = scoreAndRankProjects(
    projects as ProjectData[],
    profileData,
''',
    '''  const personalizedProjects = scoreAndRankProjects(
    projectsWithAccountContext,
    profileData,
''',
    "Home personalization input",
)
replace_once(
    home,
    '''  const hotProjects = laneFiltered.filter((p: ProjectData) => p.priority === "hot");
  const warmProjects = laneFiltered.filter((p: ProjectData) => p.priority === "warm");
  const coldProjects = laneFiltered.filter((p: ProjectData) => p.priority === "cold");

  return (
''',
    '''  const hotProjects = laneFiltered.filter((p: ProjectData) => p.priority === "hot");
  const warmProjects = laneFiltered.filter((p: ProjectData) => p.priority === "warm");
  const coldProjects = laneFiltered.filter((p: ProjectData) => p.priority === "cold");
  const accountRouteMetrics = summarizeProjectAccountContexts(
    laneFiltered.map((project: ProjectData) => project.fullPotentialContext),
  );

  return (
''',
    "Home account route metrics",
)
replace_once(
    home,
    '''            {/* KPI Cards — 4 focused metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KPICard value={businessLineFiltered.length} label="Your Projects" accent="teal" />
              <KPICard value={tier1Count} label="Action Now" accent="hot" />
              <KPICard value={hotProjects.length} label="Hot Priority" accent="gold" />
              <KPICard value={businessLineFiltered.filter((p: any) => p.isNew).length} label="New This Week" accent="warm" />
            </div>
''',
    '''            {/* KPI Cards — buying-account route metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KPICard value={accountRouteMetrics.matchedAccounts} label="Matched Buying Accounts" accent="teal" />
              <KPICard value={accountRouteMetrics.confirmedRoutes} label="Confirmed Account Routes" accent="gold" />
              <KPICard value={accountRouteMetrics.likelyRoutes} label="Likely Routes to Validate" accent="warm" />
              <KPICard value={accountRouteMetrics.unresolvedRoutes} label="Needs Account Resolution" accent="hot" />
            </div>
''',
    "Home account route KPI strip",
)
replace_once(
    home,
    '''                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Winning Contractor</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Location</th>
''',
    '''                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Winning Contractor</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Full Potential Account</th>
                    <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Location</th>
''',
    "Awarded table account heading",
)
replace_once(
    home,
    '''                        <td className="px-4 py-3">{ap.winningContractor}</td>
                        <td className="px-4 py-3 text-muted-foreground">{ap.location}</td>
''',
    '''                        <td className="px-4 py-3">{ap.winningContractor}</td>
                        <td className="px-4 py-3 min-w-[250px]">
                          <FullPotentialAccountContext
                            context={contextsByAwardedProjectId.get(Number(ap.id))}
                            compact
                            showEmpty
                          />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{ap.location}</td>
''',
    "Awarded table account context",
)


this_week = ROOT / "client/src/pages/ThisWeek.tsx"
replace_once(
    this_week,
    'import { LaneBadge } from "@/components/LaneBadge";\n',
    'import { LaneBadge } from "@/components/LaneBadge";\n'
    'import FullPotentialAccountContext from "@/components/FullPotentialAccountContext";\n'
    'import { useFullPotentialProjectContexts } from "@/hooks/useFullPotentialProjectContexts";\n',
    "ThisWeek account-context imports",
)
replace_once(
    this_week,
    '''  const { data: closingSoonProjects } = trpc.report.closingSoon.useQuery(
    { daysAhead: 14 },
    { enabled: isAuthenticated, staleTime: 10 * 60 * 1000 }
  );

  // ── Destructure summary ──
  const topProjects: any[] = summary?.topProjects ?? [];
''',
    '''  const { data: closingSoonProjects } = trpc.report.closingSoon.useQuery(
    { daysAhead: 14 },
    { enabled: isAuthenticated, staleTime: 10 * 60 * 1000 }
  );

  const accountContextProjectIds = useMemo(() => [
    ...((summary?.topProjects ?? []) as Array<{ id: number }>).map(project => Number(project.id)),
    ...((closingSoonProjects ?? []) as Array<{ id: number }>).map(project => Number(project.id)),
  ], [summary?.topProjects, closingSoonProjects]);
  const { contextsByProjectId } = useFullPotentialProjectContexts(
    accountContextProjectIds,
    isAuthenticated,
  );

  // ── Destructure summary ──
  const rawTopProjects: any[] = summary?.topProjects ?? [];
  const topProjects = useMemo(
    () => rawTopProjects.map(project => ({
      ...project,
      fullPotentialContext: contextsByProjectId.get(Number(project.id)) ?? null,
    })),
    [rawTopProjects, contextsByProjectId],
  );
''',
    "ThisWeek context hooks and top projects",
)
replace_once(
    this_week,
    '''  const closingSoon = useMemo(() => {
    return (closingSoonProjects ?? []).filter((p: any) =>
      p.priority === "hot" || p.priority === "warm"
    );
  }, [closingSoonProjects]);
''',
    '''  const closingSoon = useMemo(() => {
    return (closingSoonProjects ?? [])
      .filter((p: any) => p.priority === "hot" || p.priority === "warm")
      .map((project: any) => ({
        ...project,
        fullPotentialContext: contextsByProjectId.get(Number(project.id)) ?? null,
      }));
  }, [closingSoonProjects, contextsByProjectId]);
''',
    "ThisWeek closing-soon contexts",
)
replace_once(
    this_week,
    '''      <h3 className="text-sm font-bold text-navy leading-snug line-clamp-2">
        {project?.name || action.projectName || action.title}
      </h3>

      {/* Short pitch */}
''',
    '''      <h3 className="text-sm font-bold text-navy leading-snug line-clamp-2">
        {project?.name || action.projectName || action.title}
      </h3>

      <FullPotentialAccountContext context={project?.fullPotentialContext} compact />

      {/* Short pitch */}
''',
    "ThisWeek top action context",
)
replace_once(
    this_week,
    '''        {project.overview && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {project.overview.slice(0, 80)}
          </div>
        )}
      </div>
''',
    '''        {project.overview && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {project.overview.slice(0, 80)}
          </div>
        )}
        <FullPotentialAccountContext context={project.fullPotentialContext} compact />
      </div>
''',
    "ThisWeek compact row context",
)

print("Applied PR61 account-context UI patches")
