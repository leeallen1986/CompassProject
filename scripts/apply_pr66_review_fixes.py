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
text = text.replace(
    '  | "already_managed"\n  | "owner_mismatch";',
    '  | "already_managed"\n  | "owner_mismatch"\n  | "duplicate_account";',
    1,
)

start = text.index("function productHypothesis(")
end = text.index("function routeUncertainty", start)
new_hypothesis = '''function productHypothesis(
  project: ThisWeekProject,
  persistedProject: NextBest5PersistedProject,
): NextBest5ProductHypothesis {
  // Product guidance is derived from persisted source text, not AI-inferred
  // equipmentSignals or a downstream classifier that may have consumed them.
  const text = sourceText(persistedProject).toLowerCase();
  const evidenceCount = explicitAirEvidence(persistedProject).length;
  const confidence: NextBest5Confidence = evidenceCount >= 2
    || /\\d{2,4}\\s*(?:cfm|psi)|\\b\\d{1,3}\\s*bar\\b/i.test(text)
    ? "high"
    : "medium";

  if (/\\b(?:booster compressor|air booster|gas booster|high pressure booster)\\b/i.test(text)) {
    return {
      label: "Specialty Air — Booster",
      application: "High-pressure air or gas boosting",
      confidence,
      basis: "explicit_project_evidence",
    };
  }
  if (/\\b(?:nitrogen|n2 membrane|purging|inerting|dry-out|dryout|pipeline drying)\\b/i.test(text)) {
    return {
      label: "Specialty Air — Nitrogen",
      application: "Purging, inerting, nitrogen membrane or dry-out duty",
      confidence,
      basis: "explicit_project_evidence",
    };
  }
  if (/\\b(?:air dryer|desiccant dryer|refrigerant dryer|aftercooler|dew point|instrument air|control air)\\b/i.test(text)) {
    return {
      label: "Air Treatment",
      application: "Dryer, aftercooler or instrument-quality air",
      confidence,
      basis: "explicit_project_evidence",
    };
  }
  if (/\\b(?:pressure test|pressure testing|pneumatic test|pipeline testing|hydrotest|leak testing)\\b/i.test(text)) {
    return {
      label: "Portable Air package",
      application: "Pressure testing and pipeline preparation",
      confidence,
      basis: "explicit_project_evidence",
    };
  }
  if (/\\b(?:drilling|blast hole|blasthole|aircore|air core|dth|down-the-hole|rock drill|borehole)\\b/i.test(text)) {
    return {
      label: "Portable Air",
      application: "Drilling and blasting",
      confidence,
      basis: "explicit_project_evidence",
    };
  }
  if (/\\b(?:piling|pile driving|micropile|pneumatic tool|jackhammer|rock breaking)\\b/i.test(text)) {
    return {
      label: "Portable Air",
      application: "Piling or pneumatic civil works",
      confidence,
      basis: "explicit_project_evidence",
    };
  }
  if (/\\b(?:abrasive blasting|sandblast|grit blast|shot blast|surface preparation)\\b/i.test(text)) {
    return {
      label: "Portable Air",
      application: "Abrasive blasting and surface preparation",
      confidence,
      basis: "explicit_project_evidence",
    };
  }
  if (/\\b(?:commissioning air|temporary plant air|shutdown|turnaround)\\b/i.test(text)) {
    return {
      label: "Portable Air",
      application: "Temporary plant air or commissioning",
      confidence,
      basis: "explicit_project_evidence",
    };
  }
  return {
    label: "Portable Air",
    application: "Evidence-backed compressed-air requirement",
    confidence,
    basis: "explicit_project_evidence",
  };
}

'''
text = text[:start] + new_hypothesis + text[end:]
text = text.replace(
    "  const hypothesis = productHypothesis(project);",
    "  const hypothesis = productHypothesis(project, persistedProject);",
    1,
)
text = text.replace(
    '    owner_mismatch: 0,\n  } satisfies Record<NextBest5ExclusionReason, number>;',
    '    owner_mismatch: 0,\n    duplicate_account: 0,\n  } satisfies Record<NextBest5ExclusionReason, number>;',
    1,
)
text = text.replace(
    '''  const eligible: NextBest5Input[] = [];
  for (const input of inputs) {
    const reason = exclusionReason(input, user, now);
    if (reason) exclusions[reason] += 1;
    else eligible.push(input);
  }
''',
    '''  const eligible: NextBest5Input[] = [];
  const seenAccountIds = new Set<number>();
  for (const input of inputs) {
    const reason = exclusionReason(input, user, now);
    if (reason) {
      exclusions[reason] += 1;
      continue;
    }

    const accountId = input.context.primaryMatch?.accountId;
    if (!accountId) {
      exclusions.no_account_route += 1;
      continue;
    }
    if (seenAccountIds.has(accountId)) {
      exclusions.duplicate_account += 1;
      continue;
    }
    seenAccountIds.add(accountId);
    eligible.push(input);
  }
''',
    1,
)
shared.write_text(text)

replace_once(
    "server/fullPotentialNextBest5.ts",
    '''      already_managed: 0,
      owner_mismatch: 0,
    },''',
    '''      already_managed: 0,
      owner_mismatch: 0,
      duplicate_account: 0,
    },''',
)

replace_once(
    "server/fullPotentialNextBest5.shared.test.ts",
    '''  it("returns fewer than five rather than filling with lower-quality projects", () => {''',
    '''  it("deduplicates canonical accounts while preserving the first server-ranked project", () => {
    const sharedAccount = match(99);
    const result = buildReadOnlyNextBest5([
      input(8, { match: sharedAccount }),
      input(2, { match: sharedAccount }),
      input(9),
    ], USER, { now: NOW });

    expect(result.recommendations.map(item => item.projectId)).toEqual([8, 9]);
    expect(result.exclusions.duplicate_account).toBe(1);
    expect(result.eligibleCount).toBe(2);
  });

  it("returns fewer than five rather than filling with lower-quality projects", () => {''',
)

replace_once(
    "server/fullPotentialNextBest5.shared.test.ts",
    '''  it("maps explicit specialty-air evidence without inventing a financial value", () => {''',
    '''  it("does not let inferred product fields override the persisted source evidence", () => {
    const result = buildReadOnlyNextBest5([
      input(1, {
        project: {
          bestProductAngle: "N2 Membrane",
          opportunityType: "purging_inerting",
          equipmentSignals: ["nitrogen membrane"],
        },
        persisted: {
          overview: "Confirmed blast-hole drilling requires a portable compressor.",
          opportunityNote: "Drilling contractor is mobilising.",
        },
      }),
    ], USER, { now: NOW });

    expect(result.recommendations[0].productHypothesis.label).toBe("Portable Air");
    expect(result.recommendations[0].productHypothesis.application).toBe("Drilling and blasting");
  });

  it("maps explicit specialty-air evidence without inventing a financial value", () => {''',
)

print("Applied PR66 review fixes")
