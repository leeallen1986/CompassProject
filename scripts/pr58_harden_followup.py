from pathlib import Path

path = Path("server/fullPotentialDailyActivation.shared.ts")
text = path.read_text()

old = '''  } else if (openActions.length > 0) {
    // Existing commitments stay in the dedicated FP action dock. Do not
    // create a second generic action for the same account.
    return null;
  } else if (approved && activeClaims.length === 0) {
'''
new = '''  } else if (approved && activeClaims.length === 0) {
'''
if old in text:
    text = text.replace(old, new, 1)

anchor = '''  const recommendationKey = `fp-${context.weekLabel}-${account.id}-${kind}-${sourceType ?? "account"}-${sourceId ?? 0}`;
'''
insert = '''  const currentKindIdentity = `-${account.id}-${kind}-`;
  const hasCurrentDecisionAction = openActions.some(action =>
    action.notes?.includes(`[fp_daily:fp-${context.weekLabel}-`) &&
    action.notes.includes(currentKindIdentity),
  );
  const highPriorityCanCoexist = [
    "overdue_action",
    "returned_model",
    "manager_review",
    "fresh_signal",
    "advance_pursuit",
  ].includes(kind);
  if (openActions.length > 0 && !hasCurrentDecisionAction && !highPriorityCanCoexist) {
    // Existing commitments stay in the dedicated FP action dock. Do not
    // create a second generic commitment for the same account.
    return null;
  }

  const recommendationKey = `fp-${context.weekLabel}-${account.id}-${kind}-${sourceType ?? "account"}-${sourceId ?? 0}`;
'''
if insert not in text:
    if anchor not in text:
        raise RuntimeError("recommendation-key anchor not found")
    text = text.replace(anchor, insert, 1)

path.write_text(text)
