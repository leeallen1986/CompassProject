export type RentalCoverageGapCode =
  | "relationship_cycle"
  | "missing_relationship_target"
  | "child_without_parent"
  | "duplicate_counts_toward_potential"
  | "missing_state"
  | "ownership_review"
  | "route_manual_review"
  | "channel_owner_missing"
  | "product_fit_missing"
  | "installed_base_unknown"
  | "supplier_missing"
  | "financial_potential_missing"
  | "evidence_missing"
  | "verified_evidence_missing"
  | "priority_action_missing"
  | "alias_coverage_missing";

export type RentalCoverageCandidateDisposition =
  | "existing_account"
  | "possible_existing_account"
  | "branch_or_site_candidate"
  | "new_account_candidate"
  | "ambiguous_manual_review"
  | "excluded_by_source";

export interface RentalCoverageAccountInput {
  id: number;
  stableKey: string;
  canonicalName: string;
  displayName?: string | null;
  parentGroup?: string | null;
  rowClass: string;
  parentAccountId?: number | null;
  mergedIntoAccountId?: number | null;
  relationshipType: string;
  recordStatus: string;
  countsTowardPotential: boolean | number;
  country: string;
  state?: string | null;
  region?: string | null;
  segment?: string | null;
  subsegment?: string | null;
  applicationPlays?: string[] | null;
  routeToMarket: string;
  ownerName?: string | null;
  channelOwner?: string | null;
  fpStatus: string;
  priorityTier: string;
  platformPushDecision: string;
  currentRevenueAud?: string | number | null;
  fullPotentialAud?: string | number | null;
  target2026Aud?: string | number | null;
  remainingPotentialAud?: string | number | null;
  evidenceSources?: string[] | null;
  confidenceLevel: string;
  currentSupplier?: string | null;
  installedBaseStatus: string;
  installedBaseNotes?: string | null;
  c4cStatus: string;
  nextAction?: string | null;
  nextActionDate?: Date | string | null;
  activeInMyWeek?: boolean | number;
  sourceWorkbookVersion?: string | null;
  sourceSheet?: string | null;
  sourceRowNumber?: number | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  isRentalHire: boolean;
  expectedOwnerNames: string[];
  ownershipModel: string;
  ownerAlignment: string;
  ownershipReviewReason?: string | null;
}

export interface RentalCoverageAliasInput {
  id: number;
  accountId: number;
  aliasName: string;
  aliasType?: string | null;
  source?: string | null;
  confidenceLevel?: string | null;
}

export interface RentalCoverageActionInput {
  id: number;
  accountId: number;
  status: string;
  actionType?: string | null;
  dueDate?: Date | string | null;
}

export interface RentalCoverageSignalInput {
  id: number;
  accountId?: number | null;
  status: string;
  urgency?: string | null;
  signalType?: string | null;
}

export interface RentalCoverageEvidenceInput {
  id: number;
  accountId: number;
  status: string;
  productFamily?: string | null;
  confidenceLevel?: string | null;
}

export interface RentalCoverageCandidateInput {
  candidateName: string;
  parentName?: string | null;
  website?: string | null;
  state?: string | null;
  branchOrLocation?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  evidenceSummary?: string | null;
  productFit?: string | null;
  notes?: string | null;
  excludeReason?: string | null;
}

export interface RentalCoverageCensusInput {
  allAccounts: RentalCoverageAccountInput[];
  aliases: RentalCoverageAliasInput[];
  actions: RentalCoverageActionInput[];
  signals: RentalCoverageSignalInput[];
  evidence: RentalCoverageEvidenceInput[];
  candidates?: RentalCoverageCandidateInput[];
}

export interface RentalCoverageCensusRow {
  accountId: number;
  stableKey: string;
  canonicalName: string;
  displayName: string;
  parentGroup: string;
  rootAccountId: number;
  rootCanonicalName: string;
  relationshipPath: number[];
  relationshipType: string;
  recordStatus: string;
  countsTowardPotential: boolean;
  rowClass: string;
  country: string;
  state: string;
  region: string;
  segment: string;
  subsegment: string;
  routeToMarket: string;
  ownerName: string;
  channelOwner: string;
  expectedOwnerNames: string[];
  ownershipModel: string;
  ownerAlignment: string;
  ownershipReviewReason: string;
  priorityTier: string;
  platformPushDecision: string;
  fpStatus: string;
  applicationPlays: string[];
  installedBaseStatus: string;
  installedBaseNotes: string;
  currentSupplier: string;
  currentRevenueAud: number;
  fullPotentialAud: number;
  target2026Aud: number;
  remainingPotentialAud: number;
  aliasCount: number;
  childRecordCount: number;
  groupStateCoverage: string[];
  openActionCount: number;
  liveSignalCount: number;
  evidenceCount: number;
  verifiedEvidenceCount: number;
  gapCodes: RentalCoverageGapCode[];
  criticalGapCount: number;
  highGapCount: number;
  mediumGapCount: number;
  coverageScore: number;
}

export interface RentalCoverageCanonicalGroup {
  rootAccountId: number;
  rootCanonicalName: string;
  memberAccountIds: number[];
  countingAccountIds: number[];
  childContextAccountIds: number[];
  duplicateAccountIds: number[];
  states: string[];
  routes: string[];
  owners: string[];
  gapCodes: RentalCoverageGapCode[];
}

export interface RentalCoverageCandidateResult extends RentalCoverageCandidateInput {
  normalizedCandidateName: string;
  disposition: RentalCoverageCandidateDisposition;
  matchedAccountIds: number[];
  matchedCanonicalNames: string[];
  matchBasis: string[];
  reviewComment: string;
}

export interface RentalCoverageSummary {
  generatedAt: string;
  totalAccountsRead: number;
  rentalRows: number;
  canonicalGroups: number;
  countingRentalAccounts: number;
  childContextRows: number;
  duplicateRows: number;
  tierA: number;
  tierB: number;
  pushNow: number;
  ownerAlignment: Record<string, number>;
  routes: Record<string, number>;
  states: Record<string, number>;
  gapCounts: Partial<Record<RentalCoverageGapCode, number>>;
  coverageScoreBands: Record<string, number>;
  candidateDispositionCounts: Record<RentalCoverageCandidateDisposition, number>;
}

export interface RentalCoverageCensusResult {
  summary: RentalCoverageSummary;
  rows: RentalCoverageCensusRow[];
  groups: RentalCoverageCanonicalGroup[];
  gapQueue: RentalCoverageCensusRow[];
  candidateReconciliation: RentalCoverageCandidateResult[];
}

const OPEN_ACTION_STATUSES = new Set(["not_started", "in_progress", "contacted", "meeting_booked", "quoted"]);
const LIVE_SIGNAL_STATUSES = new Set(["new", "reviewed", "promoted"]);
const CHANNEL_ROUTES = new Set([
  "cea",
  "cp_aps",
  "cp_blastone",
  "cp_pneumatic_engineering",
  "cp_more_air",
  "nz_distributor",
  "png_oceania",
]);

const CRITICAL_GAPS = new Set<RentalCoverageGapCode>([
  "relationship_cycle",
  "missing_relationship_target",
  "child_without_parent",
  "duplicate_counts_toward_potential",
  "missing_state",
  "ownership_review",
  "route_manual_review",
  "channel_owner_missing",
]);
const HIGH_GAPS = new Set<RentalCoverageGapCode>([
  "product_fit_missing",
  "installed_base_unknown",
  "supplier_missing",
  "financial_potential_missing",
]);

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function boolValue(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

function numberValue(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueSorted<T extends string | number>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b), "en", { numeric: true }));
}

export function normalizeCoverageAccountName(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCoverageAccountNameLoose(value: unknown): string {
  const legalSuffixes = new Set([
    "pty", "ltd", "limited", "inc", "incorporated", "corp", "corporation",
    "company", "co", "group", "holdings", "holding", "australia", "australian",
  ]);
  return normalizeCoverageAccountName(value)
    .split(" ")
    .filter(token => !legalSuffixes.has(token))
    .join(" ");
}

interface RootResolution {
  rootAccountId: number;
  path: number[];
  issues: RentalCoverageGapCode[];
}

export function resolveCoverageRoot(
  accountId: number,
  accountMap: ReadonlyMap<number, RentalCoverageAccountInput>,
): RootResolution {
  const path: number[] = [];
  const seen = new Set<number>();
  let currentId = accountId;
  const issues: RentalCoverageGapCode[] = [];

  while (true) {
    if (seen.has(currentId)) {
      issues.push("relationship_cycle");
      return { rootAccountId: accountId, path: [...path, currentId], issues };
    }
    seen.add(currentId);
    path.push(currentId);

    const current = accountMap.get(currentId);
    if (!current) {
      issues.push("missing_relationship_target");
      return { rootAccountId: accountId, path, issues };
    }

    const nextId = current.mergedIntoAccountId ?? current.parentAccountId ?? null;
    if (nextId == null) return { rootAccountId: currentId, path, issues };
    if (!accountMap.has(nextId)) {
      issues.push("missing_relationship_target");
      return { rootAccountId: currentId, path: [...path, nextId], issues };
    }
    currentId = nextId;
  }
}

function countBy<T extends string>(values: Iterable<T>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value || "<blank>"] = (result[value || "<blank>"] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function gapSeverity(gap: RentalCoverageGapCode): "critical" | "high" | "medium" {
  if (CRITICAL_GAPS.has(gap)) return "critical";
  if (HIGH_GAPS.has(gap)) return "high";
  return "medium";
}

function candidateIndex(
  accounts: RentalCoverageAccountInput[],
  aliases: RentalCoverageAliasInput[],
): {
  strict: Map<string, Set<number>>;
  loose: Map<string, Set<number>>;
  aliasesByAccount: Map<number, string[]>;
} {
  const strict = new Map<string, Set<number>>();
  const loose = new Map<string, Set<number>>();
  const aliasesByAccount = new Map<number, string[]>();

  const add = (map: Map<string, Set<number>>, key: string, accountId: number) => {
    if (!key) return;
    const set = map.get(key) || new Set<number>();
    set.add(accountId);
    map.set(key, set);
  };

  for (const account of accounts) {
    const names = [account.canonicalName, account.displayName, account.parentGroup].filter(Boolean) as string[];
    for (const name of names) {
      add(strict, normalizeCoverageAccountName(name), account.id);
      add(loose, normalizeCoverageAccountNameLoose(name), account.id);
    }
  }
  for (const alias of aliases) {
    add(strict, normalizeCoverageAccountName(alias.aliasName), alias.accountId);
    add(loose, normalizeCoverageAccountNameLoose(alias.aliasName), alias.accountId);
    const values = aliasesByAccount.get(alias.accountId) || [];
    values.push(alias.aliasName);
    aliasesByAccount.set(alias.accountId, values);
  }
  return { strict, loose, aliasesByAccount };
}

export function reconcileRentalCoverageCandidates(
  candidates: RentalCoverageCandidateInput[],
  accounts: RentalCoverageAccountInput[],
  aliases: RentalCoverageAliasInput[],
): RentalCoverageCandidateResult[] {
  const accountMap = new Map(accounts.map(account => [account.id, account]));
  const index = candidateIndex(accounts, aliases);

  return candidates.map(candidate => {
    const normalizedCandidateName = normalizeCoverageAccountName(candidate.candidateName);
    if (clean(candidate.excludeReason)) {
      return {
        ...candidate,
        normalizedCandidateName,
        disposition: "excluded_by_source" as const,
        matchedAccountIds: [],
        matchedCanonicalNames: [],
        matchBasis: ["source_exclusion"],
        reviewComment: clean(candidate.excludeReason),
      };
    }

    const strictMatches = new Set(index.strict.get(normalizedCandidateName) || []);
    const looseName = normalizeCoverageAccountNameLoose(candidate.candidateName);
    const looseMatches = new Set(index.loose.get(looseName) || []);
    const parentStrict = clean(candidate.parentName)
      ? new Set(index.strict.get(normalizeCoverageAccountName(candidate.parentName)) || [])
      : new Set<number>();
    const allMatches = new Set<number>([...strictMatches, ...looseMatches]);

    let disposition: RentalCoverageCandidateDisposition;
    const matchBasis: string[] = [];
    let matchedAccountIds: number[] = [];
    let reviewComment = "";

    if (strictMatches.size === 1) {
      disposition = "existing_account";
      matchedAccountIds = [...strictMatches];
      matchBasis.push("canonical_display_parent_or_alias_exact");
      reviewComment = "Exact normalized identity already exists in the Full Potential universe.";
    } else if (strictMatches.size > 1) {
      disposition = "ambiguous_manual_review";
      matchedAccountIds = uniqueSorted(strictMatches);
      matchBasis.push("ambiguous_exact_identity");
      reviewComment = "The candidate matches more than one current account or alias; no automatic selection is safe.";
    } else if (looseMatches.size === 1) {
      disposition = "possible_existing_account";
      matchedAccountIds = [...looseMatches];
      matchBasis.push("legal_suffix_normalized_match");
      reviewComment = "A unique legal-suffix-normalized match exists and requires operator confirmation.";
    } else if (looseMatches.size > 1) {
      disposition = "ambiguous_manual_review";
      matchedAccountIds = uniqueSorted(looseMatches);
      matchBasis.push("ambiguous_loose_identity");
      reviewComment = "Loose identity matching reaches multiple accounts; review parent, state and source evidence.";
    } else if (parentStrict.size === 1) {
      disposition = "branch_or_site_candidate";
      matchedAccountIds = [...parentStrict];
      matchBasis.push("existing_parent_identity");
      reviewComment = "The stated parent exists. Review whether this should be an alias, branch/site context row or genuinely separate counting account.";
    } else if (parentStrict.size > 1) {
      disposition = "ambiguous_manual_review";
      matchedAccountIds = uniqueSorted(parentStrict);
      matchBasis.push("ambiguous_parent_identity");
      reviewComment = "The stated parent resolves to multiple current records.";
    } else {
      disposition = "new_account_candidate";
      matchedAccountIds = [];
      matchBasis.push("no_current_identity_match");
      reviewComment = "No current canonical, display, parent or alias identity match was found. Evidence and commercial-fit review are required before import.";
    }

    return {
      ...candidate,
      normalizedCandidateName,
      disposition,
      matchedAccountIds,
      matchedCanonicalNames: matchedAccountIds
        .map(id => accountMap.get(id)?.canonicalName || `Account ${id}`),
      matchBasis,
      reviewComment,
    };
  }).sort((a, b) => {
    const dispositionOrder: RentalCoverageCandidateDisposition[] = [
      "ambiguous_manual_review",
      "new_account_candidate",
      "branch_or_site_candidate",
      "possible_existing_account",
      "existing_account",
      "excluded_by_source",
    ];
    const order = dispositionOrder.indexOf(a.disposition) - dispositionOrder.indexOf(b.disposition);
    return order || a.normalizedCandidateName.localeCompare(b.normalizedCandidateName);
  });
}

export function buildRentalCoverageCensus(
  input: RentalCoverageCensusInput,
  generatedAt = new Date(),
): RentalCoverageCensusResult {
  const accountMap = new Map(input.allAccounts.map(account => [account.id, account]));
  const rentalAccounts = input.allAccounts.filter(account => account.isRentalHire);
  const aliasesByAccount = new Map<number, RentalCoverageAliasInput[]>();
  for (const alias of input.aliases) {
    const values = aliasesByAccount.get(alias.accountId) || [];
    values.push(alias);
    aliasesByAccount.set(alias.accountId, values);
  }
  const openActionsByAccount = new Map<number, RentalCoverageActionInput[]>();
  for (const action of input.actions) {
    if (!OPEN_ACTION_STATUSES.has(action.status)) continue;
    const values = openActionsByAccount.get(action.accountId) || [];
    values.push(action);
    openActionsByAccount.set(action.accountId, values);
  }
  const liveSignalsByAccount = new Map<number, RentalCoverageSignalInput[]>();
  for (const signal of input.signals) {
    if (signal.accountId == null || !LIVE_SIGNAL_STATUSES.has(signal.status)) continue;
    const values = liveSignalsByAccount.get(signal.accountId) || [];
    values.push(signal);
    liveSignalsByAccount.set(signal.accountId, values);
  }
  const evidenceByAccount = new Map<number, RentalCoverageEvidenceInput[]>();
  for (const evidence of input.evidence) {
    const values = evidenceByAccount.get(evidence.accountId) || [];
    values.push(evidence);
    evidenceByAccount.set(evidence.accountId, values);
  }

  const resolutions = new Map<number, RootResolution>();
  for (const account of rentalAccounts) resolutions.set(account.id, resolveCoverageRoot(account.id, accountMap));

  const membersByRoot = new Map<number, RentalCoverageAccountInput[]>();
  for (const account of rentalAccounts) {
    const root = resolutions.get(account.id)!.rootAccountId;
    const values = membersByRoot.get(root) || [];
    values.push(account);
    membersByRoot.set(root, values);
  }

  const rows: RentalCoverageCensusRow[] = rentalAccounts.map(account => {
    const resolution = resolutions.get(account.id)!;
    const root = accountMap.get(resolution.rootAccountId) || account;
    const members = membersByRoot.get(resolution.rootAccountId) || [account];
    const aliases = aliasesByAccount.get(account.id) || [];
    const actions = openActionsByAccount.get(account.id) || [];
    const signals = liveSignalsByAccount.get(account.id) || [];
    const evidence = evidenceByAccount.get(account.id) || [];
    const gaps = new Set<RentalCoverageGapCode>(resolution.issues);
    const countsTowardPotential = boolValue(account.countsTowardPotential);
    const childRelationship = ["division", "branch", "site", "service_unit"].includes(account.relationshipType);

    if (childRelationship && account.parentAccountId == null) gaps.add("child_without_parent");
    if (
      (account.relationshipType === "duplicate" || account.recordStatus === "merged" || account.mergedIntoAccountId != null)
      && countsTowardPotential
    ) gaps.add("duplicate_counts_toward_potential");
    if (!clean(account.state)) gaps.add("missing_state");
    if (["mismatch", "unassigned", "manual_review"].includes(account.ownerAlignment)) gaps.add("ownership_review");
    if (account.routeToMarket === "manual_review") gaps.add("route_manual_review");
    if (CHANNEL_ROUTES.has(account.routeToMarket) && !clean(account.channelOwner)) gaps.add("channel_owner_missing");
    if (countsTowardPotential && (account.applicationPlays || []).length === 0) gaps.add("product_fit_missing");
    if (countsTowardPotential && account.installedBaseStatus === "unknown") gaps.add("installed_base_unknown");
    if (countsTowardPotential && !clean(account.currentSupplier)) gaps.add("supplier_missing");

    const financialValues = [
      account.currentRevenueAud,
      account.fullPotentialAud,
      account.target2026Aud,
      account.remainingPotentialAud,
    ].map(numberValue);
    if (countsTowardPotential && financialValues.every(value => value <= 0)) gaps.add("financial_potential_missing");
    if (countsTowardPotential && evidence.length === 0 && (account.evidenceSources || []).length === 0) gaps.add("evidence_missing");
    if (countsTowardPotential && evidence.filter(item => item.status === "verified").length === 0) gaps.add("verified_evidence_missing");
    if (countsTowardPotential && ["tier_a", "tier_b"].includes(account.priorityTier) && actions.length === 0) gaps.add("priority_action_missing");
    if (countsTowardPotential && aliases.length === 0) gaps.add("alias_coverage_missing");

    const gapCodes = uniqueSorted(gaps);
    const criticalGapCount = gapCodes.filter(gap => gapSeverity(gap) === "critical").length;
    const highGapCount = gapCodes.filter(gap => gapSeverity(gap) === "high").length;
    const mediumGapCount = gapCodes.filter(gap => gapSeverity(gap) === "medium").length;
    const totalChecks = 14;
    const coverageScore = Math.max(0, Math.round(((totalChecks - gapCodes.length) / totalChecks) * 100));

    return {
      accountId: account.id,
      stableKey: account.stableKey,
      canonicalName: account.canonicalName,
      displayName: clean(account.displayName),
      parentGroup: clean(account.parentGroup),
      rootAccountId: resolution.rootAccountId,
      rootCanonicalName: root.canonicalName,
      relationshipPath: resolution.path,
      relationshipType: account.relationshipType,
      recordStatus: account.recordStatus,
      countsTowardPotential,
      rowClass: account.rowClass,
      country: account.country,
      state: clean(account.state),
      region: clean(account.region),
      segment: clean(account.segment),
      subsegment: clean(account.subsegment),
      routeToMarket: account.routeToMarket,
      ownerName: clean(account.ownerName),
      channelOwner: clean(account.channelOwner),
      expectedOwnerNames: uniqueSorted(account.expectedOwnerNames),
      ownershipModel: account.ownershipModel,
      ownerAlignment: account.ownerAlignment,
      ownershipReviewReason: clean(account.ownershipReviewReason),
      priorityTier: account.priorityTier,
      platformPushDecision: account.platformPushDecision,
      fpStatus: account.fpStatus,
      applicationPlays: uniqueSorted(account.applicationPlays || []),
      installedBaseStatus: account.installedBaseStatus,
      installedBaseNotes: clean(account.installedBaseNotes),
      currentSupplier: clean(account.currentSupplier),
      currentRevenueAud: financialValues[0],
      fullPotentialAud: financialValues[1],
      target2026Aud: financialValues[2],
      remainingPotentialAud: financialValues[3],
      aliasCount: aliases.length,
      childRecordCount: Math.max(0, members.length - 1),
      groupStateCoverage: uniqueSorted(members.map(member => clean(member.state)).filter(Boolean)),
      openActionCount: actions.length,
      liveSignalCount: signals.length,
      evidenceCount: evidence.length,
      verifiedEvidenceCount: evidence.filter(item => item.status === "verified").length,
      gapCodes,
      criticalGapCount,
      highGapCount,
      mediumGapCount,
      coverageScore,
    };
  }).sort((a, b) => {
    if (b.criticalGapCount !== a.criticalGapCount) return b.criticalGapCount - a.criticalGapCount;
    if (b.highGapCount !== a.highGapCount) return b.highGapCount - a.highGapCount;
    if (a.coverageScore !== b.coverageScore) return a.coverageScore - b.coverageScore;
    return a.canonicalName.localeCompare(b.canonicalName) || a.accountId - b.accountId;
  });

  const rowById = new Map(rows.map(row => [row.accountId, row]));
  const groups: RentalCoverageCanonicalGroup[] = [...membersByRoot.entries()].map(([rootAccountId, members]) => {
    const root = accountMap.get(rootAccountId) || members[0];
    const groupRows = members.map(member => rowById.get(member.id)!).filter(Boolean);
    return {
      rootAccountId,
      rootCanonicalName: root.canonicalName,
      memberAccountIds: uniqueSorted(members.map(member => member.id)),
      countingAccountIds: uniqueSorted(members.filter(member => boolValue(member.countsTowardPotential)).map(member => member.id)),
      childContextAccountIds: uniqueSorted(members.filter(member => !boolValue(member.countsTowardPotential)).map(member => member.id)),
      duplicateAccountIds: uniqueSorted(members.filter(member => member.relationshipType === "duplicate" || member.recordStatus === "merged").map(member => member.id)),
      states: uniqueSorted(members.map(member => clean(member.state)).filter(Boolean)),
      routes: uniqueSorted(members.map(member => member.routeToMarket).filter(Boolean)),
      owners: uniqueSorted(members.map(member => clean(member.ownerName)).filter(Boolean)),
      gapCodes: uniqueSorted(groupRows.flatMap(row => row.gapCodes)),
    };
  }).sort((a, b) => a.rootCanonicalName.localeCompare(b.rootCanonicalName) || a.rootAccountId - b.rootAccountId);

  const candidateReconciliation = reconcileRentalCoverageCandidates(
    input.candidates || [],
    input.allAccounts,
    input.aliases,
  );
  const gapCounts: Partial<Record<RentalCoverageGapCode, number>> = {};
  for (const row of rows) for (const gap of row.gapCodes) gapCounts[gap] = (gapCounts[gap] || 0) + 1;

  const summary: RentalCoverageSummary = {
    generatedAt: generatedAt.toISOString(),
    totalAccountsRead: input.allAccounts.length,
    rentalRows: rows.length,
    canonicalGroups: groups.length,
    countingRentalAccounts: rows.filter(row => row.countsTowardPotential).length,
    childContextRows: rows.filter(row => !row.countsTowardPotential).length,
    duplicateRows: rows.filter(row => row.relationshipType === "duplicate" || row.recordStatus === "merged").length,
    tierA: rows.filter(row => row.countsTowardPotential && row.priorityTier === "tier_a").length,
    tierB: rows.filter(row => row.countsTowardPotential && row.priorityTier === "tier_b").length,
    pushNow: rows.filter(row => row.countsTowardPotential && row.platformPushDecision === "push_now").length,
    ownerAlignment: countBy(rows.map(row => row.ownerAlignment)),
    routes: countBy(rows.map(row => row.routeToMarket)),
    states: countBy(rows.flatMap(row => row.groupStateCoverage.length > 0 ? row.groupStateCoverage : ["<blank>"])),
    gapCounts,
    coverageScoreBands: {
      "90_100": rows.filter(row => row.coverageScore >= 90).length,
      "75_89": rows.filter(row => row.coverageScore >= 75 && row.coverageScore < 90).length,
      "50_74": rows.filter(row => row.coverageScore >= 50 && row.coverageScore < 75).length,
      "0_49": rows.filter(row => row.coverageScore < 50).length,
    },
    candidateDispositionCounts: countBy(candidateReconciliation.map(candidate => candidate.disposition)) as Record<RentalCoverageCandidateDisposition, number>,
  };

  return {
    summary,
    rows,
    groups,
    gapQueue: rows.filter(row => row.gapCodes.length > 0),
    candidateReconciliation,
  };
}
