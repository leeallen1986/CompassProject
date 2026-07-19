from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROUTERS = ROOT / "server" / "routers.ts"
SHARED = ROOT / "server" / "fullPotentialAccountMatching.shared.ts"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


text = ROUTERS.read_text()

text = replace_once(
    text,
    'import { getThisWeekSummary } from "./thisWeekService";\n',
    'import { getThisWeekSummary } from "./thisWeekService";\n'
    'import { enrichProjectsWithFullPotentialContext, getProjectFullPotentialContext } from "./fullPotentialAccountMatching";\n'
    'import { enrichAwardedProjectsWithFullPotentialContext } from "./fullPotentialAccountMatching.awarded";\n',
    "account matching imports",
)

text = replace_once(
    text,
    '        if (!project) return { project: null, contacts: [], claims: [], businessLineNames: {}, scopeFlags: null };\n',
    '        if (!project) return { project: null, contacts: [], claims: [], businessLineNames: {}, scopeFlags: null, fullPotentialContext: null };\n',
    "project detail empty response",
)

text = replace_once(
    text,
    '        return { project, contacts: projectContacts, claims, userClaim, businessLineNames, scopeFlags, pumpActionMode, matchedAccountPrior };\n',
    '        const fullPotentialContext = (await getProjectFullPotentialContext(input.id)).context;\n'
    '        return { project, contacts: projectContacts, claims, userClaim, businessLineNames, scopeFlags, pumpActionMode, matchedAccountPrior, fullPotentialContext };\n',
    "project detail context response",
)

old_report = '''        // Apply ML ranking if user is authenticated
        let rankedProjects = filteredProjects;
        let rankings: Awaited<ReturnType<typeof rankProjectsForUser>> | null = null;
        if (ctx.user) {
          rankings = await rankProjectsForUser(ctx.user.id, filteredProjects);
          rankedProjects = rankings.map(r => r.project);
        }

        return {
          report: aggregateReport,
          projects: rankedProjects,
          lifecycleCounts,
          contacts: contactsList,
          drillingCampaigns: drillingList,
          awardedProjects: awardedList,
'''

new_report = '''        // Apply ML ranking if user is authenticated
        let rankedProjects = filteredProjects;
        let rankings: Awaited<ReturnType<typeof rankProjectsForUser>> | null = null;
        if (ctx.user) {
          rankings = await rankProjectsForUser(ctx.user.id, filteredProjects);
          rankedProjects = rankings.map(r => r.project);
        }

        // Attach the canonical Full Potential buying-account context after ranking.
        // This is read-only: no account, action, model or pursuit record is changed.
        const [projectsWithAccountContext, awardedProjectsWithAccountContext] = await Promise.all([
          enrichProjectsWithFullPotentialContext(rankedProjects),
          enrichAwardedProjectsWithFullPotentialContext(awardedList),
        ]);

        return {
          report: aggregateReport,
          projects: projectsWithAccountContext,
          lifecycleCounts,
          contacts: contactsList,
          drillingCampaigns: drillingList,
          awardedProjects: awardedProjectsWithAccountContext,
'''

text = replace_once(text, old_report, new_report, "report full account context")
ROUTERS.write_text(text)

shared = SHARED.read_text()
shared = replace_once(
    shared,
    '    const score = clamp(96 + TERM_KIND_BONUS[term.kind] + stateScore(candidate.state, account.state));\n',
    '    const score = 91 + TERM_KIND_BONUS[term.kind] + stateScore(candidate.state, account.state);\n',
    "state-aware exact score",
)
shared = replace_once(
    shared,
    '  if (exact && nameScore >= 96 && relationScore >= 85) return "confirmed";\n',
    '  if (exact && nameScore >= 94 && relationScore >= 85) return "confirmed";\n',
    "confirmed exact threshold",
)
SHARED.write_text(shared)
