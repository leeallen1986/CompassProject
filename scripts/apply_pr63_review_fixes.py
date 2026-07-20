from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    file_path = ROOT / path
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected block once, found {count}")
    file_path.write_text(text.replace(old, new, 1))


replace_once(
    "server/laneScoring.ts",
    '  const accommodationProjectPattern = /\\b(student accommodation|student housing|university accommodation|university housing|dormitory|dormitories|apartment development|residential accommodation)\\b/i;\n',
    '  const accommodationProjectPattern = /\\b(student accommodation|student housing|university accommodation|university housing|dormitory|dormitories|apartment development|residential accommodation|residential development|townhouse|housing estate|retirement village|social housing|affordable housing)\\b/i;\n',
)

replace_once(
    "server/laneScoring.ts",
    '    [/\\b(residential|townhouse|housing estate|retirement village|social housing|affordable housing)\\b/, "residential development — no portable air demand"],\n',
    '',
)

replace_once(
    "server/fullPotentialAccountMatching.shared.ts",
    '''  if (/\\b(national|nationwide|australia|multi state|all states)\\b/.test(normalized)) {
    return new Set(["NATIONAL"]);
  }
''',
    '''  if (/^(national|nationwide|australia|australia wide|across australia|multi state|all states)$/.test(normalized)) {
    return new Set(["NATIONAL"]);
  }
''',
)

path = ROOT / "server/fullPotentialAccountMatching.composites.test.ts"
text = path.read_text()
needle = '''  it("extracts alliance participants instead of retaining the whole alliance string", () => {
    const candidates = extractProjectAccountCandidates({
      id: 12,
      name: "Rail Alliance",
      owner: null,
      contractors: [{
        name: "Alliance comprising John Holland Group, Kellogg Brown & Root (KBR), Metro Trains Melbourne",
        status: "confirmed",
        confidence: 100,
      }],
    });

    expect(candidates.map(candidate => candidate.name)).toContain("John Holland Group");
    expect(candidates.map(candidate => candidate.name)).toContain("Kellogg Brown & Root");
    expect(candidates.map(candidate => candidate.name)).toContain("Metro Trains Melbourne");
    expect(candidates.some(candidate => candidate.name.startsWith("Alliance comprising"))).toBe(false);
  });
'''
addition = needle + '''
  it("uses Western Australia as WA context rather than national context", () => {
    const waAccount = { ...account(501, "Regional Mining Services"), state: "WA" };
    const nswAccount = { ...account(502, "Regional Mining Services"), state: "NSW" };
    const result = resolveFullPotentialCandidate({
      name: "Regional Mining Services",
      source: "project_contractor",
      role: "contractor",
      relationshipEvidence: "confirmed",
      confidence: 95,
      state: "Western Australia",
    }, buildFullPotentialMatchIndex([waAccount, nswAccount], []));

    expect(result.match?.accountId).toBe(501);
    expect(result.unresolved).toBeNull();
  });
'''
if text.count(needle) != 1:
    raise SystemExit(f"composite state test anchor expected once, found {text.count(needle)}")
path.write_text(text.replace(needle, addition, 1))

print("PR63 review fixes applied")
