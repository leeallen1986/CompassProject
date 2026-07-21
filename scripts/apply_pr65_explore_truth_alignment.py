from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exact block once, found {count}")
    file.write_text(text.replace(old, new, 1))


# Preserve the server-provided project order for For You and derivative views.
replace_once(
    "client/src/lib/exploreProjects.ts",
    '''export function filterExploreProjects<T extends ExploreProjectLike>(
  projects: readonly T[],
  view: ExploreProjectsView,
): T[] {
  const sorted = sortExploreProjects(projects);
  if (view === "confirmed") {
    return sorted.filter(project => certaintyForProject(project) === "confirmed");
  }
  if (view === "likely") {
    return sorted.filter(project => {
      const certainty = certaintyForProject(project);
      return certainty === "likely_high" || certainty === "likely_medium";
    });
  }
  return sorted;
}
''',
    '''export function filterExploreProjects<T extends ExploreProjectLike>(
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
''',
)

# Update the regression to prove the input/server order survives filtering.
replace_once(
    "client/src/lib/exploreProjects.test.ts",
    '''  searchExploreProjects,
  sortExploreProjects,
  type ExploreProjectLike,
''',
    '''  searchExploreProjects,
  type ExploreProjectLike,
''',
)
replace_once(
    "client/src/lib/exploreProjects.test.ts",
    '''  it("keeps server visibility and relevance as the ordering truth", () => {
    expect(sortExploreProjects([
      project(1, 99, null, { visibilityTier: "monitor_only", priority: "hot" }),
      project(2, 70, null, { visibilityTier: "must_act_candidate", priority: "warm" }),
      project(3, 80, null, { visibilityTier: "must_act_candidate", priority: "cold" }),
    ]).map(item => item.id)).toEqual([3, 2, 1]);
  });
''',
    '''  it("preserves the server order in For You and account-route filters", () => {
    const serverOrdered = [
      project(9, 70, match(269, "confirmed")),
      project(2, 99, match(270, "likely_high")),
      project(7, 80, match(271, "confirmed")),
      project(4, 75, unresolved()),
    ];

    expect(filterExploreProjects(serverOrdered, "for-you").map(item => item.id))
      .toEqual([9, 2, 7, 4]);
    expect(filterExploreProjects(serverOrdered, "confirmed").map(item => item.id))
      .toEqual([9, 7]);
    expect(filterExploreProjects(serverOrdered, "likely").map(item => item.id))
      .toEqual([2]);
  });
''',
)

# Use the actual visible/search-filtered collection for the account-route KPI strip.
replace_once(
    "client/src/pages/ExploreProjects.tsx",
    '''  searchExploreProjects,
  type ExploreProjectsView,
''',
    '''  searchExploreProjects,
  type ExploreProjectLike,
  type ExploreProjectsView,
''',
)
replace_once(
    "client/src/pages/ExploreProjects.tsx",
    '''  const routeMetrics = useMemo(() => buildExploreRouteMetrics(topProjects), [topProjects]);
  const laneProjects = useMemo(() => {
''',
    '''  const laneProjects = useMemo(() => {
''',
)
replace_once(
    "client/src/pages/ExploreProjects.tsx",
    '''  const visibleTenders = useMemo(
    () => searchExploreProjects(tenderProjects, search),
    [search, tenderProjects],
  );

  const confirmedCount = filterExploreProjects(topProjects, "confirmed").length;
''',
    '''  const visibleTenders = useMemo(
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
''',
)

print("PR65 Explore ranking and visible-metric alignment applied")
