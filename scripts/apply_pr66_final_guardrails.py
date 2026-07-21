from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exact block once, found {count}")
    file.write_text(text.replace(old, new, 1))


shared = Path("server/fullPotentialNextBest5.shared.ts")
text = shared.read_text()
patterns_start = text.index("const EXPLICIT_AIR_PATTERNS")
patterns_end = text.index("function normalizeIdentity", patterns_start)
new_patterns = '''const EXPLICIT_AIR_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\\b(?:compressed air|portable air|air compressor|compressor package|portable compressor)\\b/i, label: "portable compressed-air package" },
  { pattern: /\\b(?:\\d{2,4}\\s*(?:cfm|psi)|\\d{1,3}\\s*bar(?:\\s+air)?)\\b/i, label: "specified air capacity or pressure" },
  { pattern: /\\b(?:exploration drilling|production drilling|drilling campaign|drill(?:ing)? program|blast hole|blasthole|aircore|air core|rc drill|reverse circulation|dth|down-the-hole|rock drill|borehole)\\b/i, label: "drilling and blasting air demand" },
  { pattern: /(?:\\b(?:compressed air|portable compressor)\\b.{0,60}\\b(?:piling|pile driving|micropile)\\b|\\b(?:piling|pile driving|micropile)\\b.{0,60}\\b(?:compressed air|portable compressor)\\b|\\b(?:pneumatic tool|jackhammer|rock breaking)\\b)/i, label: "piling or pneumatic civil works" },
  { pattern: /\\b(?:abrasive blasting|sandblast|grit blast|shot blast)\\b/i, label: "abrasive-blasting air demand" },
  { pattern: /(?:\\b(?:commissioning air|temporary plant air|instrument air|control air)\\b|\\b(?:shutdown|turnaround)\\b.{0,80}\\b(?:compressor|compressed air|portable air|plant air)\\b|\\b(?:compressor|compressed air|portable air|plant air)\\b.{0,80}\\b(?:shutdown|turnaround)\\b)/i, label: "temporary or commissioning air" },
  { pattern: /(?:\\b(?:pneumatic test|air pressure test|pipeline pressure test|gas pressure test)\\b|\\bcompressed air\\b.{0,50}\\b(?:test|testing|leak test|leak testing)\\b|\\b(?:leak test|leak testing)\\b.{0,50}\\b(?:compressed air|air|gas)\\b)/i, label: "pressure-testing requirement" },
  { pattern: /\\b(?:nitrogen|n2 membrane|purging|inerting|dry-out|dryout|pipeline drying)\\b/i, label: "specialty-air or nitrogen requirement" },
  { pattern: /\\b(?:booster compressor|air booster|gas booster|high pressure booster)\\b/i, label: "booster requirement" },
  { pattern: /\\b(?:air dryer|desiccant dryer|refrigerant dryer|aftercooler|dew point)\\b/i, label: "air-treatment requirement" },
];

'''
text = text[:patterns_start] + new_patterns + text[patterns_end:]

hypothesis_start = text.index("function productHypothesis(")
hypothesis_end = text.index("function routeUncertainty", hypothesis_start)
new_hypothesis = '''function productHypothesis(
  project: ThisWeekProject,
  persistedProject: NextBest5PersistedProject,
): NextBest5ProductHypothesis {
  // Product guidance is derived from the same persisted-text evidence that
  // admitted the project. Inferred equipmentSignals cannot choose the product.
  const text = sourceText(persistedProject).toLowerCase();
  const evidence = explicitAirEvidence(persistedProject);
  const confidence: NextBest5Confidence = evidence.length >= 2
    || /\\d{2,4}\\s*(?:cfm|psi)|\\b\\d{1,3}\\s*bar(?:\\s+air)?\\b/i.test(text)
    ? "high"
    : "medium";

  if (evidence.includes("booster requirement")) {
    return { label: "Specialty Air — Booster", application: "High-pressure air or gas boosting", confidence, basis: "explicit_project_evidence" };
  }
  if (evidence.includes("specialty-air or nitrogen requirement")) {
    return { label: "Specialty Air — Nitrogen", application: "Purging, inerting, nitrogen membrane or dry-out duty", confidence, basis: "explicit_project_evidence" };
  }
  if (evidence.includes("air-treatment requirement")) {
    return { label: "Air Treatment", application: "Dryer, aftercooler or instrument-quality air", confidence, basis: "explicit_project_evidence" };
  }
  if (evidence.includes("pressure-testing requirement")) {
    return { label: "Portable Air package", application: "Pneumatic or compressed-air pressure testing", confidence, basis: "explicit_project_evidence" };
  }
  if (evidence.includes("drilling and blasting air demand")) {
    return { label: "Portable Air", application: "Drilling and blasting", confidence, basis: "explicit_project_evidence" };
  }
  if (evidence.includes("piling or pneumatic civil works")) {
    return { label: "Portable Air", application: "Piling or pneumatic civil works", confidence, basis: "explicit_project_evidence" };
  }
  if (evidence.includes("abrasive-blasting air demand")) {
    return { label: "Portable Air", application: "Abrasive blasting and surface preparation", confidence, basis: "explicit_project_evidence" };
  }
  if (evidence.includes("temporary or commissioning air")) {
    return { label: "Portable Air", application: "Temporary plant air or commissioning", confidence, basis: "explicit_project_evidence" };
  }
  return { label: "Portable Air", application: "Evidence-backed compressed-air requirement", confidence, basis: "explicit_project_evidence" };
}

'''
text = text[:hypothesis_start] + new_hypothesis + text[hypothesis_end:]

anchor = '''function routeUncertainty(match: FullPotentialAccountMatch): string[] {
'''
role_guard = '''const DIRECT_BUYING_ROLES = new Set([
  "winning_contractor",
  "epc",
  "contractor",
  "subcontractor",
  "rental",
  "supplier",
]);

function hasCredibleBuyingRole(
  match: FullPotentialAccountMatch,
  project: NextBest5PersistedProject,
): boolean {
  if (DIRECT_BUYING_ROLES.has(match.candidateRole)) return true;
  if (match.candidateRole !== "project_owner") return false;

  // Project-owner fallback is eligible only for an explicitly direct CAPEX path.
  // It cannot substitute for a missing contractor on Fleet CAPEX intelligence.
  return normalizeIdentity(project.opportunityRoute) === "direct capex"
    && normalizeIdentity(project.sourcePurpose) !== "contractor path";
}

function routeUncertainty(match: FullPotentialAccountMatch): string[] {
'''
if text.count(anchor) != 1:
    raise SystemExit("route uncertainty anchor not found exactly once")
text = text.replace(anchor, role_guard, 1)
text = text.replace(
    '''  if (!["confirmed", "likely_high"].includes(match.certainty)) return "weak_account_route";
  if ((match.account.activePursuitCount ?? 0) > 0 || (match.account.openActionCount ?? 0) > 0) {''',
    '''  if (!["confirmed", "likely_high"].includes(match.certainty)) return "weak_account_route";
  if (!hasCredibleBuyingRole(match, persistedProject)) return "weak_account_route";
  if ((match.account.activePursuitCount ?? 0) > 0 || (match.account.openActionCount ?? 0) > 0) {''',
    1,
)
shared.write_text(text)

test_path = Path("server/fullPotentialNextBest5.shared.test.ts")
test_text = test_path.read_text()
overview_old = 'overview: "Confirmed drilling program requiring a 900 CFM portable compressor package.",'
overview_new = 'overview: "Confirmed blast-hole drilling program requiring a 900 CFM portable compressor package.",'
if test_text.count(overview_old) != 2:
    raise SystemExit(f"expected two test overview fixtures, found {test_text.count(overview_old)}")
test_path.write_text(test_text.replace(overview_old, overview_new))

replace_once(
    "server/fullPotentialNextBest5.shared.test.ts",
    '''  it("requires a confirmed or likely-high canonical buying route", () => {''',
    '''  it("rejects project-owner fallback unless the route is explicit Direct CAPEX", () => {
    expect(exclusionReason(input(1, {
      persisted: { opportunityRoute: "Fleet CAPEX", sourcePurpose: "contractor_path" },
      match: { candidateRole: "project_owner", candidateSource: "project_owner" },
    }), USER, NOW)).toBe("weak_account_route");

    expect(exclusionReason(input(2, {
      persisted: { opportunityRoute: "Direct CAPEX", sourcePurpose: "project_signal" },
      match: { candidateRole: "project_owner", candidateSource: "project_owner" },
    }), USER, NOW)).toBeNull();
  });

  it("requires a confirmed or likely-high canonical buying route", () => {''',
)
replace_once(
    "server/fullPotentialNextBest5.shared.test.ts",
    '''  it("uses explicit persisted project text rather than inferred equipment signals", () => {
    expect(explicitAirEvidence(persisted(1))).toContain("drilling and blasting air demand");

    expect(explicitAirEvidence(persisted(2, {
      overview: "Generic civil construction project.",
      opportunityNote: null,
      opportunityRoute: "Fleet CAPEX",
      equipmentSignals: ["portable air compressors"],
    }))).toEqual([]);
  });''',
    '''  it("uses explicit persisted project text rather than inferred equipment signals", () => {
    expect(explicitAirEvidence(persisted(1))).toContain("drilling and blasting air demand");

    expect(explicitAirEvidence(persisted(2, {
      overview: "Generic civil construction project.",
      opportunityNote: null,
      opportunityRoute: "Fleet CAPEX",
      equipmentSignals: ["portable air compressors"],
    }))).toEqual([]);
  });

  it("does not treat generic shutdown, hydrotest, piling or surface preparation as explicit air evidence", () => {
    expect(explicitAirEvidence(persisted(3, {
      overview: "Plant shutdown, hydrotest, piling and surface preparation works.",
      opportunityNote: null,
      opportunityRoute: "Fleet CAPEX",
      equipmentSignals: [],
    }))).toEqual([]);
  });''',
)

replace_once(
    "docs/full-potential-read-only-next-best-5.md",
    '''- linked to a confirmed or likely-high canonical account route
- owned by the authenticated rep''',
    '''- linked to a confirmed or likely-high canonical account route
- linked to a contractor, EPC, subcontractor, rental, supplier or awarded-contractor buying role; project-owner fallback is allowed only for explicit Direct CAPEX
- owned by the authenticated rep''',
)

print("Applied PR66 final commercial guardrails")
