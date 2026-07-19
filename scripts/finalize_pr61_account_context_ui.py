from pathlib import Path

path = Path(__file__).resolve().parents[1] / "client/src/pages/Home.tsx"
text = path.read_text()

old_metrics = '''  const accountRouteMetrics = summarizeProjectAccountContexts(
    laneFiltered.map((project: ProjectData) => project.fullPotentialContext),
  );
'''
new_metrics = '''  const accountRouteMetrics = summarizeProjectAccountContexts(
    filteredProjects.map((project: ProjectData) => project.fullPotentialContext),
  );
'''
if old_metrics in text:
    text = text.replace(old_metrics, new_metrics, 1)
elif new_metrics not in text:
    raise SystemExit("account-route metrics location was not found")

old_awarded = '''                          <FullPotentialAccountContext
                            context={contextsByAwardedProjectId.get(Number(ap.id))}
                            compact
                            showEmpty
                          />
'''
new_awarded = '''                          <FullPotentialAccountContext
                            context={contextsByAwardedProjectId.get(Number(ap.id))}
                            compact
                          />
'''
if old_awarded in text:
    text = text.replace(old_awarded, new_awarded, 1)
elif new_awarded not in text:
    raise SystemExit("awarded-project account-context location was not found")

path.write_text(text)
print("Applied final PR61 account-context safeguards")
