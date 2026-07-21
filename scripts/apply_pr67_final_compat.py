from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text)


def replace_once(text: str, old: str, new: str, path: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected target once, found {count}\n--- target ---\n{old[:800]}")
    return text.replace(old, new, 1)


# Preserve the public test/config key while sourcing the value from one shared cap.
path = "server/apolloEligibility.ts"
text = read(path)
text = replace_once(
    text,
    '''export const _config = {
  APOLLO_DAILY_CREDIT_CAP,
  PER_PROJECT_CREDIT_CAP,
  MIN_CONTACTS_THRESHOLD,
  MONTHLY_BUDGET_CAP,
};''',
    '''export const _config = {
  DAILY_CREDIT_CAP: APOLLO_DAILY_CREDIT_CAP,
  PER_PROJECT_CREDIT_CAP,
  MIN_CONTACTS_THRESHOLD,
  MONTHLY_BUDGET_CAP,
};''',
    path,
)
write(path, text)

# Apollo's provider module does not own the budget gate; remove the unused import.
path = "server/apolloEnrichment.ts"
text = read(path)
text = replace_once(
    text,
    'import { APOLLO_DAILY_CREDIT_CAP } from "./intelligenceTrustPolicy";\n',
    '',
    path,
)
write(path, text)

# Align the inline comment with the fail-closed mailbox policy.
path = "server/hunterVerification.ts"
text = read(path)
text = replace_once(
    text,
    '      // accept_all is common on enterprise/mining domains — include if confidence ≥70\n',
    '      // An accept-all domain does not verify the named person\'s mailbox.\n',
    path,
)
write(path, text)

# Update the legacy web-discovery tests: guessed mailboxes are no longer a feature.
path = "server/webStakeholderDiscovery.test.ts"
text = read(path)
text = replace_once(
    text,
    ' * - Email inference from name + company\n',
    ' * - Unverified contacts never receive a guessed mailbox\n',
    path,
)
text = replace_once(
    text,
    '''import {
  buildSearchQueries,
  _normalizeRoleBucket,
  _inferEmail,
} from "./webStakeholderDiscovery";
import * as schema from "../drizzle/schema";''',
    '''import {
  buildSearchQueries,
  _normalizeRoleBucket,
} from "./webStakeholderDiscovery";
import { unverifiedContactEmail } from "./intelligenceTrustPolicy";
import * as schema from "../drizzle/schema";''',
    path,
)
old_email_tests = '''// ── inferEmail ──

describe("inferEmail", () => {
  it("generates firstname.lastname@company.com.au pattern", () => {
    const email = _inferEmail("John Smith", "BHP Group");
    expect(email).toBe("john.smith@bhp.com.au");
  });

  it("strips common company suffixes", () => {
    const email = _inferEmail("Jane Doe", "Rio Tinto Limited");
    expect(email).toBe("jane.doe@riotinto.com.au");
  });

  it("handles multi-word names (uses first and last)", () => {
    const email = _inferEmail("Mary Jane Watson", "Fortescue Metals Group");
    expect(email).toBe("mary.watson@fortescuemetals.com.au");
  });

  it("returns null for empty name", () => {
    expect(_inferEmail("", "BHP")).toBeNull();
  });

  it("returns null for empty company", () => {
    expect(_inferEmail("John Smith", "")).toBeNull();
  });

  it("returns null for single-word name", () => {
    expect(_inferEmail("John", "BHP")).toBeNull();
  });
});
'''
new_email_tests = '''// ── Email trust ──

describe("unverified contact email handling", () => {
  it("never creates a guessed mailbox for a discovered person", () => {
    expect(unverifiedContactEmail()).toBeNull();
  });
});
'''
text = replace_once(text, old_email_tests, new_email_tests, path)
text = replace_once(
    text,
    '''  it("exports inferEmail", () => {
    expect(typeof _inferEmail).toBe("function");
  });

''',
    '',
    path,
)
write(path, text)

print("PR67 final compatibility fixes applied")
