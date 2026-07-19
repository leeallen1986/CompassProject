from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"{label} anchor not found")
    return text.replace(old, new, 1)


shared_path = Path("server/fullPotentialDailyActivation.shared.ts")
shared = shared_path.read_text()
shared = replace_once(
    shared,
    '''  suggestedAction?: string | null;
  productHints?: string[] | null;
}
''',
    '''  suggestedAction?: string | null;
  productHints?: string[] | null;
  actionState?: {
    hasOpenAction: boolean;
    hasClosedAction?: boolean;
  };
}
''',
    "DailyActivationSignal interface",
)

feedback_anchor = '''function feedbackAction(actions: DailyActivationAction[], recommendationKey: string): DailyActivationAction | null {
  return [...actions]
    .filter(action => action.notes?.includes(`[fp_daily:${recommendationKey}]`))
    .sort((left, right) => dateValue(right.createdAt) - dateValue(left.createdAt))[0] ?? null;
}
'''
feedback_extension = feedback_anchor + '''
function markerFromNotes(notes: string | null | undefined): string | null {
  return notes?.match(/\\[fp_daily:([^\\]]+)\\]/)?.[1] ?? null;
}

function recentRecommendationDisposition(
  actions: DailyActivationAction[],
  accountId: number,
  kind: RecommendationKind,
  now: Date,
): DailyRecommendation["disposition"] | null {
  const identity = `-${accountId}-${kind}-`;
  const candidates = [...actions]
    .filter(action => action.notes?.includes("[fp_daily:fp-") && action.notes.includes(identity))
    .map(action => ({
      action,
      decision: actionDecision(action.notes, markerFromNotes(action.notes) ?? ""),
    }))
    .filter(item => item.decision === "rejected" || item.decision === "not_relevant")
    .sort((left, right) => dateValue(right.action.createdAt) - dateValue(left.action.createdAt));
  const latest = candidates[0];
  if (!latest?.decision) return null;
  const ageDays = (now.getTime() - dateValue(latest.action.createdAt)) / 86_400_000;
  const suppressionDays = latest.decision === "not_relevant" ? 90 : 28;
  return ageDays >= 0 && ageDays <= suppressionDays ? latest.decision : null;
}
'''
shared = replace_once(shared, feedback_anchor, feedback_extension, "feedback helper")
shared = shared.replace(
    '  } else if (signal && !signal.actionState?.hasOpenAction) {',
    '  } else if (signal && !signal.actionState?.hasOpenAction && !signal.actionState?.hasClosedAction) {',
    1,
)
shared = replace_once(
    shared,
    '''    dueDays = signal.urgency === "hot" ? 3 : 7;
  } else if (approved && activeClaims.length === 0) {
''',
    '''    dueDays = signal.urgency === "hot" ? 3 : 7;
  } else if (openActions.length > 0) {
    // Existing commitments stay in the dedicated FP action dock. Do not
    // create a second generic action for the same account.
    return null;
  } else if (approved && activeClaims.length === 0) {
''',
    "open-action branch",
)
shared = replace_once(
    shared,
    '''  const recorded = feedbackAction(context.actions, recommendationKey);
  const disposition = recorded ? actionDecision(recorded.notes, recommendationKey) ?? (CLOSED_RECOMMENDATION_STATUSES.has(recorded.status) ? "rejected" : "accepted") : "pending";
''',
    '''  const recorded = feedbackAction(context.actions, recommendationKey);
  const recentDisposition = recorded
    ? null
    : recentRecommendationDisposition(context.actions, account.id, kind, now);
  const disposition = recorded
    ? actionDecision(recorded.notes, recommendationKey) ?? (CLOSED_RECOMMENDATION_STATUSES.has(recorded.status) ? "rejected" : "accepted")
    : recentDisposition ?? "pending";
''',
    "disposition",
)
shared_path.write_text(shared)

service_path = Path("server/fullPotentialDailyActivation.ts")
service = service_path.read_text()
service = service.replace(
    '    db.select().from(fullPotentialSignals).where(inArray(fullPotentialSignals.accountId, accountIds)).orderBy(desc(fullPotentialSignals.signalDate)),',
    '    db.select().from(fullPotentialSignals).orderBy(desc(fullPotentialSignals.signalDate)),',
    1,
)

if "Exact unlinked-signal name match" not in service:
    old_start = service.index("  const directSignalsByAccount = new Map<number, DailyActivationSignal[]>();")
    old_end = service.index("  const evidenceByAccount = new Map<number, DailyActivationEvidence[]>();")
    new_block = '''  const directSignalsByAccount = new Map<number, DailyActivationSignal[]>();
  for (const signal of signals) {
    if (["dismissed", "archived"].includes(signal.status)) continue;

    let matches: Array<{ accountId: number; matchReason: string }> = [];
    if (signal.accountId && accountById.has(signal.accountId)) {
      matches = [{ accountId: signal.accountId, matchReason: "Directly linked Full Potential signal" }];
    } else if (signal.accountId === null || signal.accountId === undefined) {
      const title = normalizeCorporateName(signal.signalTitle);
      if (!title) continue;
      const exact = eligibleAccounts
        .filter(account => (termsByAccount.get(account.id) ?? []).some(term => term === title))
        .map(account => ({ accountId: account.id, matchReason: "Exact unlinked-signal name match" }));
      matches = exact.length > 0
        ? exact
        : partialCandidates
            .filter(account => {
              const stateCompatible = !account.state || !signal.state || normalizeActivationIdentity(account.state) === normalizeActivationIdentity(signal.state);
              return stateCompatible && (termsByAccount.get(account.id) ?? []).some(term => term.length >= 5 && (title.includes(term) || term.includes(title)));
            })
            .slice(0, 3)
            .map(account => ({ accountId: account.id, matchReason: "Unlinked signal name match with compatible state" }));
    }

    for (const match of matches) {
      const relatedActions = actionsByAccount.get(match.accountId) ?? [];
      const matchingActions = relatedActions.filter(action => action.signalId === signal.id);
      const list = directSignalsByAccount.get(match.accountId) ?? [];
      if (list.length >= 8) continue;
      list.push({
        sourceType: "fp_signal",
        sourceId: signal.id,
        accountId: match.accountId,
        title: signal.signalTitle,
        summary: signal.signalSummary,
        sourceName: signal.sourceName,
        sourceUrl: signal.sourceUrl,
        signalDate: signal.signalDate ?? signal.createdAt,
        urgency: signal.urgency,
        confidence: signal.confidenceLevel,
        matchReason: match.matchReason,
        suggestedAction: signal.suggestedAction,
        productHints: [signal.applicationPlay].filter(Boolean) as string[],
        actionState: {
          hasOpenAction: matchingActions.some(action => OPEN_ACTION_STATUSES.has(action.status)),
          hasClosedAction: matchingActions.some(action => !OPEN_ACTION_STATUSES.has(action.status)),
        },
      });
      directSignalsByAccount.set(match.accountId, list);
    }
  }

'''
    service = service[:old_start] + new_block + service[old_end:]

service = replace_once(
    service,
    '''      actionState: {
        hasOpenAction: accountActions.some(action => action.projectId === signal.sourceId && OPEN_ACTION_STATUSES.has(action.status)),
      },
''',
    '''      actionState: {
        hasOpenAction: accountActions.some(action => action.projectId === signal.sourceId && OPEN_ACTION_STATUSES.has(action.status)),
        hasClosedAction: accountActions.some(action => action.projectId === signal.sourceId && !OPEN_ACTION_STATUSES.has(action.status)),
      },
''',
    "project action state",
)
service = service.replace(
    '''  const feedbackActions = (actions as unknown as DailyActivationAction[]).filter(action =>
    isWithin(action.createdAt, weekStart) && !!markerKey(action),
  );
''',
    "",
    1,
)
service = service.replace(
    '''        productFamily: recommendation.productHypothesis.productFamily && parsed.productFamilyHypothesis.productFamily === recommendation.productHypothesis.productFamily
          ? recommendation.productHypothesis.productFamily
          : recommendation.productHypothesis.productFamily,
''',
    '''        productFamily: recommendation.productHypothesis.productFamily,
''',
    1,
)
service_path.write_text(service)

augmentation = Path("server/fullPotentialDailyActivation.augmentation.d.ts")
if augmentation.exists():
    augmentation.unlink()

test_path = Path("server/fullPotentialDailyActivation.shared.test.ts")
tests = test_path.read_text()
if "does not create a second generic recommendation" not in tests:
    insertion = '''

  it("does not create a second generic recommendation while an open FP commitment exists", () => {
    const openAction: DailyActivationAction = {
      id: 202,
      accountId: 269,
      userId: 42,
      ownerName: "Ryan Pemberton",
      actionType: "customer_call",
      recommendedAction: "Confirm supplier and fleet age.",
      dueDate: "2026-07-25T00:00:00.000Z",
      status: "not_started",
      createdAt: "2026-07-19T00:00:00.000Z",
    };

    expect(buildDailyRecommendation(context({ actions: [openAction] }))).toBeNull();
  });

  it("suppresses a recently rejected generic recommendation across week boundaries", () => {
    const rejected: DailyActivationAction = {
      id: 203,
      accountId: 269,
      userId: 42,
      ownerName: "Ryan Pemberton",
      actionType: "account_review",
      recommendedAction: "Capture evidence.",
      dueDate: null,
      status: "not_relevant",
      notes: "[fp_daily:fp-2026-07-13-269-capture_evidence-account-0]\\nFP daily decision: rejected",
      createdAt: "2026-07-15T00:00:00.000Z",
    };

    const recommendation = buildDailyRecommendation(context({ actions: [rejected] }));
    expect(recommendation?.kind).toBe("capture_evidence");
    expect(recommendation?.disposition).toBe("rejected");
  });
'''
    close = tests.rfind("\n});")
    if close < 0:
        raise RuntimeError("test-suite closing anchor not found")
    tests = tests[:close] + insertion + tests[close:]
    test_path.write_text(tests)
