import {
  normalizeCoverageAccountName,
  normalizeCoverageAccountNameLoose,
  resolveCoverageRoot,
  type RentalCoverageAccountInput,
  type RentalCoverageActionInput,
  type RentalCoverageAliasInput,
  type RentalCoverageCandidateInput,
  type RentalCoverageCensusInput,
  type RentalCoverageEvidenceInput,
  type RentalCoverageSignalInput,
} from "./fullPotentialRentalCoverageCensus";

export type CanonicalRentalCoverageGapCode =
  | "relationship_cycle"
  | "missing_relationship_target"
  | "child_without_parent"
  | "duplicate_counts_toward_potential"
  | "inactive_counts_toward_potential"
  | "missing_counting_record"
  | "multiple_counting_records_in_group"
  | "missing_state"
  | "ownership_review"
  | "owner_conflict"
  | "route_manual_review"
  | "route_conflict"
  | "channel_owner_missing"
  | "product_fit_missing"
  | "installed_base_unknown"
  | "supplier_missing"
  | "financial_potential_missing"
  | "evidence_missing"
  | "verified_evidence_missing"
  | "priority_action_missing"
  | "alias_coverage_missing";

export type CanonicalRentalCandidateDisposition =
  | "existing_account"
  | "possible_existing_account"
  | "branch_or_site_candidate"
  | "new_account_candidate"
  | "ambiguous_manual_review"
  | "excluded_by_source";

export type CandidateResearchFlag =
  | "source_missing"
  | "source_url_missing"
  | "evidence_summary_missing"
  | "product_fit_missing"
  | "state_missing";

export interface CanonicalRentalCoverageRow {
  accountId: number;
  stableKey: string;
  canonicalName: string;
  displayName: string;
  rootAccountId: number;
  rootCanonicalName: string;
  relationshipPath: number[];
  relationshipType: string;
  recordStatus: string;
  countsTowardPotential: boolean;
  isActiveCountingRecord: boolean;
  rowClass: string;
  country: string;
  state: string;
  region: string;
  routeToMarket: string;
  ownerName: string;
  ownerAlignment: string;
  ownershipModel: string;
  priorityTier: string;
  platformPushDecision: string;
  applicationPlays: string[];
  installedBaseStatus: string;
  currentSupplier: string;
  aliasCount: number;
  openActionCount: number;
  nextActionPresent: boolean;
  activeInMyWeek: boolean;
  liveSignalCount: number;
  evidenceCount: number;
  verifiedEvidenceCount: number;
  rowGapCodes: CanonicalRentalCoverageGapCode[];
  groupGapCodes: CanonicalRentalCoverageGapCode[];
}

export interface CanonicalRentalCoverageGroup {
  rootAccountId: number;
  rootCanonicalName: string;
  memberAccountIds: number[];
  activeCountingAccountIds: number[];
  flaggedCountingAccountIds: number[];
  childContextAccountIds: number[];
  duplicateAccountIds: number[];
  countries: string[];
  states: string[];
  routes: string[];
  owners: string[];
  expectedOwners: string[];
  ownerAlignment: "aligned" | "shared_aligned" | "review";
  priorityTier: string;
  pushNow: boolean;
  applicationPlays: string[];
  installedBaseStatuses: string[];
  suppliers: string[];
  aliasCount: number;
  openActionCount: number;
  nextActionCount: number;
  activeInMyWeekCount: number;
  liveSignalCount: number;
  evidenceCount: number;
  verifiedEvidenceCount: number;
  evidenceSourceCount: number;
  hasFinancialPotential: boolean;
  gapCodes: CanonicalRentalCoverageGapCode[];
  criticalGapCount: number;
  highGapCount: number;
  mediumGapCount: number;
  coverageScore: number;
}

export interface CanonicalRentalCandidateResult extends RentalCoverageCandidateInput {
  normalizedCandidateName: string;
  disposition: CanonicalRentalCandidateDisposition;
  matchedAccountIds: number[];
  matchedCanonicalNames: string[];
  matchedMemberAccountIds: number[];
  matchedSegments: string[];
  matchBasis: string[];
  researchFlags: CandidateResearchFlag[];
  researchComplete: boolean;
  recommendedForImport: false;
  reviewComment: string;
}

export interface CanonicalRentalCoverageSummary {
  generatedAt: string;
  scopeCountry: string;
  totalAccountsRead: number;
  allRentalRows: number;
  nonScopeRentalRowsExcluded: number;
  rentalRows: number;
  canonicalGroups: number;
  countingCanonicalGroups: number;
  countingRentalAccounts: number;
  countingRows: number;
  groupsWithMultipleCountingRows: number;
  groupsWithoutCountingRow: number;
  childContextRows: number;
  duplicateRows: number;
  tierA: number;
  tierB: number;
  pushNow: number;
  ownerAlignment: Record<string, number>;
  routes: Record<string, number>;
  states: Record<string, number>;
  groupGapCounts: Partial<Record<CanonicalRentalCoverageGapCode, number>>;
  rowGapCounts: Partial<Record<CanonicalRentalCoverageGapCode, number>>;
  coverageScoreBands: Record<string, number>;
  candidateDispositionCounts: Record<string, number>;
  candidateResearchFlagCounts: Record<string, number>;
}

export interface CanonicalRentalCoverageResult {
  summary: CanonicalRentalCoverageSummary;
  rows: CanonicalRentalCoverageRow[];
  groups: CanonicalRentalCoverageGroup[];
  gapQueue: CanonicalRentalCoverageGroup[];
  candidateReconciliation: CanonicalRentalCandidateResult[];
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
const INACTIVE_RECORD_STATUSES = new Set(["merged", "parked", "excluded"]);
const PRIORITY_ORDER = ["tier_a", "tier_b", "tier_c", "tier_d", "unassigned"];

const CRITICAL_GAPS = new Set<CanonicalRentalCoverageGapCode>([
  "relationship_cycle",
  "missing_relationship_target",
  "child_without_parent",
  "duplicate_counts_toward_potential",
  "inactive_counts_toward_potential",
  "missing_counting_record",
  "multiple_counting_records_in_group",
  "missing_state",
  "ownership_review",
  "owner_conflict",
  "route_manual_review",
  "route_conflict",
  "channel_owner_missing",
]);
const HIGH_GAPS = new Set<CanonicalRentalCoverageGapCode>([
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

function countBy(values: Iterable<string>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const raw of values) {
    const value = raw || "<blank>";
    result[value] = (result[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function gapSeverity(gap: CanonicalRentalCoverageGapCode): "critical" | "high" | "medium" {
  if (CRITICAL_GAPS.has(gap)) return "critical";
  if (HIGH_GAPS.has(gap)) return "high";
  return "medium";
}

function isFlaggedCountingRecord(account: RentalCoverageAccountInput): boolean {
  return boolValue(account.countsTowardPotential);
}

function isActiveCountingRecord(account: RentalCoverageAccountInput): boolean {
  return (
    isFlaggedCountingRecord(account)
    && !INACTIVE_RECORD_STATUSES.has(account.recordStatus)
    && account.relationshipType !== "duplicate"
    && account.mergedIntoAccountId == null
  );
}

function priorityOf(accounts: RentalCoverageAccountInput[]): string {
  for (const tier of PRIORITY_ORDER) {
    if (accounts.some(account => account.priorityTier === tier)) return tier;
  }
  return "unassigned";
}

function financialPotentialPresent(accounts: RentalCoverageAccountInput[]): boolean {
  return accounts.some(account => [
    account.currentRevenueAud,
    account.fullPotentialAud,
    account.target2026Aud,
    account.remainingPotentialAud,
  ].some(value => numberValue(value) > 0));
}

function actionCoveragePresent(
  members: RentalCoverageAccountInput[],
  openActions: RentalCoverageActionInput[],
): boolean {
  return (
    openActions.length > 0
    || members.some(member => clean(member.nextAction).length > 0)
    || members.some(member => boolValue(member.activeInMyWeek))
  );
}

function groupCoverageScore(gaps: CanonicalRentalCoverageGapCode[]): number {
  const penalty = gaps.reduce((total, gap) => {
    const severity = gapSeverity(gap);
    return total + (severity === "critical" ? 12 : severity === "high" ? 7 : 3);
  }, 0);
  return Math.max(0, 100 - penalty);
}

function accountRowGaps(account: RentalCoverageAccountInput, relationshipIssues: string[]): CanonicalRentalCoverageGapCode[] {
  const gaps = new Set<CanonicalRentalCoverageGapCode>(relationshipIssues as CanonicalRentalCoverageGapCode[]);
  const childRelationship = ["division", "branch", "site", "service_unit"].includes(account.relationshipType);
  const flagged = isFlaggedCountingRecord(account);
  const activeCounting = isActiveCountingRecord(account);

  if (childRelationship && account.parentAccountId == null) gaps.add("child_without_parent");
  if ((account.relationshipType === "duplicate" || account.recordStatus === "merged" || account.mergedIntoAccountId != null) && flagged) {
    gaps.add("duplicate_counts_toward_potential");
  }
  if (flagged && !activeCounting) gaps.add("inactive_counts_toward_potential");
  if (!clean(account.state)) gaps.add("missing_state");

  if (activeCounting) {
    if (["mismatch", "unassigned", "manual_review"].includes(account.ownerAlignment)) gaps.add("ownership_review");
    if (account.routeToMarket === "manual_review") gaps.add("route_manual_review");
    if (CHANNEL_ROUTES.has(account.routeToMarket) && !clean(account.channelOwner)) gaps.add("channel_owner_missing");
    if ((account.applicationPlays || []).length === 0) gaps.add("product_fit_missing");
    if (account.installedBaseStatus === "unknown") gaps.add("installed_base_unknown");
    if (!clean(account.currentSupplier)) gaps.add("supplier_missing");
    if (!financialPotentialPresent([account])) gaps.add("financial_potential_missing");
  }

  return uniqueSorted(gaps);
}

function buildRootMap(accounts: RentalCoverageAccountInput[]): Map<number, number> {
  const accountMap = new Map(accounts.map(account => [account.id, account]));
  return new Map(accounts.map(account => [account.id, resolveCoverageRoot(account.id, accountMap).rootAccountId]));
}

interface CandidateIndex {
  strict: Map<string, Set<number>>;
  loose: Map<string, Set<number>>;
  memberIdsByRoot: Map<number, Set<number>>;
}

function buildCandidateIndex(
  accounts: RentalCoverageAccountInput[],
  aliases: RentalCoverageAliasInput[],
): CandidateIndex {
  const rootByAccount = buildRootMap(accounts);
  const strict = new Map<string, Set<number>>();
  const loose = new Map<string, Set<number>>();
  const memberIdsByRoot = new Map<number, Set<number>>();

  const add = (map: Map<string, Set<number>>, key: string, rootId: number) => {
    if (!key) return;
    const values = map.get(key) || new Set<number>();
    values.add(rootId);
    map.set(key, values);
  };

  for (const account of accounts) {
    const rootId = rootByAccount.get(account.id) ?? account.id;
    const members = memberIdsByRoot.get(rootId) || new Set<number>();
    members.add(account.id);
    memberIdsByRoot.set(rootId, members);
    for (const name of [account.canonicalName, account.displayName, account.parentGroup].filter(Boolean) as string[]) {
      add(strict, normalizeCoverageAccountName(name), rootId);
      add(loose, normalizeCoverageAccountNameLoose(name), rootId);
    }
  }

  for (const alias of aliases) {
    const rootId = rootByAccount.get(alias.accountId) ?? alias.accountId;
    add(strict, normalizeCoverageAccountName(alias.aliasName), rootId);
    add(loose, normalizeCoverageAccountNameLoose(alias.aliasName), rootId);
  }

  return { strict, loose, memberIdsByRoot };
}

function candidateResearchFlags(candidate: RentalCoverageCandidateInput): CandidateResearchFlag[] {
  const flags: CandidateResearchFlag[] = [];
  if (!clean(candidate.sourceName)) flags.push("source_missing");
  if (!clean(candidate.sourceUrl)) flags.push("source_url_missing");
  if (!clean(candidate.evidenceSummary)) flags.push("evidence_summary_missing");
  if (!clean(candidate.productFit)) flags.push("product_fit_missing");
  if (!clean(candidate.state)) flags.push("state_missing");
  return flags;
}

export function reconcileCanonicalRentalCandidates(
  candidates: RentalCoverageCandidateInput[],
  accounts: RentalCoverageAccountInput[],
  aliases: RentalCoverageAliasInput[],
): CanonicalRentalCandidateResult[] {
  const accountMap = new Map(accounts.map(account => [account.id, account]));
  const index = buildCandidateIndex(accounts, aliases);

  return candidates.map(candidate => {
    const normalizedCandidateName = normalizeCoverageAccountName(candidate.candidateName);
    const researchFlags = candidateResearchFlags(candidate);
    const researchComplete = researchFlags.length === 0;

    if (clean(candidate.excludeReason)) {
      return {
        ...candidate,
        normalizedCandidateName,
        disposition: "excluded_by_source" as const,
        matchedAccountIds: [],
        matchedCanonicalNames: [],
        matchedMemberAccountIds: [],
        matchedSegments: [],
        matchBasis: ["source_exclusion"],
        researchFlags,
        researchComplete,
        recommendedForImport: false as const,
        reviewComment: clean(candidate.excludeReason),
      };
    }

    const strictMatches = new Set(index.strict.get(normalizedCandidateName) || []);
    const looseMatches = new Set(index.loose.get(normalizeCoverageAccountNameLoose(candidate.candidateName)) || []);
    const parentMatches = clean(candidate.parentName)
      ? new Set(index.strict.get(normalizeCoverageAccountName(candidate.parentName)) || [])
      : new Set<number>();

    let disposition: CanonicalRentalCandidateDisposition;
    let roots: number[] = [];
    const matchBasis: string[] = [];
    let reviewComment = "";

    if (strictMatches.size === 1) {
      disposition = "existing_account";
      roots = [...strictMatches];
      matchBasis.push("canonical_root_collapsed_exact_match");
      reviewComment = "An exact normalized identity already resolves to one canonical Full Potential root.";
    } else if (strictMatches.size > 1) {
      disposition = "ambiguous_manual_review";
      roots = uniqueSorted(strictMatches);
      matchBasis.push("multiple_canonical_roots_exact_match");
      reviewComment = "The exact identity resolves to more than one canonical root; no automatic selection is safe.";
    } else if (looseMatches.size === 1) {
      disposition = "possible_existing_account";
      roots = [...looseMatches];
      matchBasis.push("canonical_root_collapsed_legal_suffix_match");
      reviewComment = "A unique legal-suffix-normalized canonical root exists and requires operator confirmation.";
    } else if (looseMatches.size > 1) {
      disposition = "ambiguous_manual_review";
      roots = uniqueSorted(looseMatches);
      matchBasis.push("multiple_canonical_roots_loose_match");
      reviewComment = "Loose identity matching reaches multiple canonical roots; review source, parent and geography.";
    } else if (parentMatches.size === 1) {
      disposition = "branch_or_site_candidate";
      roots = [...parentMatches];
      matchBasis.push("existing_canonical_parent");
      reviewComment = "The stated parent resolves to one canonical root. Review whether this is an alias, branch/site context row or separate buying authority.";
    } else if (parentMatches.size > 1) {
      disposition = "ambiguous_manual_review";
      roots = uniqueSorted(parentMatches);
      matchBasis.push("multiple_canonical_parent_roots");
      reviewComment = "The stated parent resolves to multiple canonical roots.";
    } else {
      disposition = "new_account_candidate";
      matchBasis.push("no_current_canonical_identity_match");
      reviewComment = "No current canonical, display, parent or alias identity resolves to this candidate. Evidence and commercial-fit review remain mandatory.";
    }

    const members = uniqueSorted(roots.flatMap(rootId => [...(index.memberIdsByRoot.get(rootId) || [])]));
    const segments = uniqueSorted(members.map(id => clean(accountMap.get(id)?.segment)).filter(Boolean));
    const names = roots.map(rootId => accountMap.get(rootId)?.canonicalName || `Account ${rootId}`);

    return {
      ...candidate,
      normalizedCandidateName,
      disposition,
      matchedAccountIds: roots,
      matchedCanonicalNames: names,
      matchedMemberAccountIds: members,
      matchedSegments: segments,
      matchBasis,
      researchFlags,
      researchComplete,
      recommendedForImport: false,
      reviewComment,
    };
  }).sort((a, b) => {
    const order: CanonicalRentalCandidateDisposition[] = [
      "ambiguous_manual_review",
      "new_account_candidate",
      "branch_or_site_candidate",
      "possible_existing_account",
      "existing_account",
      "excluded_by_source",
    ];
    return order.indexOf(a.disposition) - order.indexOf(b.disposition)
      || a.normalizedCandidateName.localeCompare(b.normalizedCandidateName);
  });
}

function groupInputRows<T extends { accountId: number }>(
  rows: T[],
  memberIds: ReadonlySet<number>,
): T[] {
  return rows.filter(row => memberIds.has(row.accountId));
}

function groupSignals(
  rows: RentalCoverageSignalInput[],
  memberIds: ReadonlySet<number>,
): RentalCoverageSignalInput[] {
  return rows.filter(row => row.accountId != null && memberIds.has(row.accountId));
}

export function buildCanonicalRentalCoverageCensus(
  input: RentalCoverageCensusInput,
  generatedAt = new Date(),
  scopeCountry = "AU",
): CanonicalRentalCoverageResult {
  const normalizedCountry = scopeCountry.toUpperCase();
  const accountMap = new Map(input.allAccounts.map(account => [account.id, account]));
  const allRentalAccounts = input.allAccounts.filter(account => account.isRentalHire);
  const rentalAccounts = allRentalAccounts.filter(account => clean(account.country).toUpperCase() === normalizedCountry);
  const resolutions = new Map(rentalAccounts.map(account => [
    account.id,
    resolveCoverageRoot(account.id, accountMap),
  ]));

  const membersByRoot = new Map<number, RentalCoverageAccountInput[]>();
  for (const account of rentalAccounts) {
    const rootId = resolutions.get(account.id)!.rootAccountId;
    const members = membersByRoot.get(rootId) || [];
    members.push(account);
    membersByRoot.set(rootId, members);
  }

  const aliasesByAccount = new Map<number, RentalCoverageAliasInput[]>();
  for (const alias of input.aliases) {
    const values = aliasesByAccount.get(alias.accountId) || [];
    values.push(alias);
    aliasesByAccount.set(alias.accountId, values);
  }
  const openActions = input.actions.filter(action => OPEN_ACTION_STATUSES.has(action.status));
  const liveSignals = input.signals.filter(signal => signal.accountId != null && LIVE_SIGNAL_STATUSES.has(signal.status));

  const preliminaryRows = new Map<number, Omit<CanonicalRentalCoverageRow, "groupGapCodes">>();
  for (const account of rentalAccounts) {
    const resolution = resolutions.get(account.id)!;
    const aliases = aliasesByAccount.get(account.id) || [];
    const accountActions = openActions.filter(action => action.accountId === account.id);
    const accountSignals = liveSignals.filter(signal => signal.accountId === account.id);
    const accountEvidence = input.evidence.filter(evidence => evidence.accountId === account.id);
    preliminaryRows.set(account.id, {
      accountId: account.id,
      stableKey: account.stableKey,
      canonicalName: account.canonicalName,
      displayName: clean(account.displayName),
      rootAccountId: resolution.rootAccountId,
      rootCanonicalName: accountMap.get(resolution.rootAccountId)?.canonicalName || account.canonicalName,
      relationshipPath: resolution.path,
      relationshipType: account.relationshipType,
      recordStatus: account.recordStatus,
      countsTowardPotential: isFlaggedCountingRecord(account),
      isActiveCountingRecord: isActiveCountingRecord(account),
      rowClass: account.rowClass,
      country: clean(account.country).toUpperCase(),
      state: clean(account.state),
      region: clean(account.region),
      routeToMarket: account.routeToMarket,
      ownerName: clean(account.ownerName),
      ownerAlignment: account.ownerAlignment,
      ownershipModel: account.ownershipModel,
      priorityTier: account.priorityTier,
      platformPushDecision: account.platformPushDecision,
      applicationPlays: uniqueSorted(account.applicationPlays || []),
      installedBaseStatus: account.installedBaseStatus,
      currentSupplier: clean(account.currentSupplier),
      aliasCount: aliases.length,
      openActionCount: accountActions.length,
      nextActionPresent: clean(account.nextAction).length > 0,
      activeInMyWeek: boolValue(account.activeInMyWeek),
      liveSignalCount: accountSignals.length,
      evidenceCount: accountEvidence.length,
      verifiedEvidenceCount: accountEvidence.filter(evidence => evidence.status === "verified").length,
      rowGapCodes: accountRowGaps(account, resolution.issues),
    });
  }

  const groups: CanonicalRentalCoverageGroup[] = [...membersByRoot.entries()].map(([rootAccountId, members]) => {
    const memberIds = new Set(members.map(member => member.id));
    const activeCounting = members.filter(isActiveCountingRecord);
    const flaggedCounting = members.filter(isFlaggedCountingRecord);
    const structuralGaps = members.flatMap(member => preliminaryRows.get(member.id)?.rowGapCodes || []);
    const gaps = new Set<CanonicalRentalCoverageGapCode>(structuralGaps);
    const groupAliases = members.flatMap(member => aliasesByAccount.get(member.id) || []);
    const groupActions = groupInputRows(openActions, memberIds);
    const groupLiveSignals = groupSignals(liveSignals, memberIds);
    const groupEvidence = groupInputRows(input.evidence, memberIds);
    const analysisRows = activeCounting.length > 0 ? activeCounting : members;
    const routes = uniqueSorted(analysisRows.map(member => member.routeToMarket).filter(Boolean));
    const owners = uniqueSorted(analysisRows.map(member => clean(member.ownerName)).filter(Boolean));
    const expectedOwners = uniqueSorted(analysisRows.flatMap(member => member.expectedOwnerNames || []));
    const states = uniqueSorted(members.map(member => clean(member.state)).filter(Boolean));
    const applicationPlays = uniqueSorted(analysisRows.flatMap(member => member.applicationPlays || []));
    const installedBaseStatuses = uniqueSorted(analysisRows.map(member => member.installedBaseStatus).filter(Boolean));
    const suppliers = uniqueSorted(analysisRows.map(member => clean(member.currentSupplier)).filter(Boolean));
    const priorityTier = priorityOf(analysisRows);

    if (activeCounting.length === 0) gaps.add("missing_counting_record");
    if (activeCounting.length > 1) gaps.add("multiple_counting_records_in_group");
    if (flaggedCounting.some(member => !isActiveCountingRecord(member))) gaps.add("inactive_counts_toward_potential");
    if (states.length === 0) gaps.add("missing_state");
    if (analysisRows.some(member => ["mismatch", "unassigned", "manual_review"].includes(member.ownerAlignment))) gaps.add("ownership_review");
    if (owners.length > 1 && !analysisRows.every(member => member.ownershipModel === "shared_territory")) gaps.add("owner_conflict");
    if (routes.includes("manual_review")) gaps.add("route_manual_review");
    if (routes.length > 1) gaps.add("route_conflict");
    if (analysisRows.some(member => CHANNEL_ROUTES.has(member.routeToMarket) && !clean(member.channelOwner))) gaps.add("channel_owner_missing");
    if (applicationPlays.length === 0) gaps.add("product_fit_missing");
    if (!installedBaseStatuses.some(status => ["known", "partial", "not_applicable"].includes(status))) gaps.add("installed_base_unknown");
    if (suppliers.length === 0) gaps.add("supplier_missing");
    if (!financialPotentialPresent(analysisRows)) gaps.add("financial_potential_missing");

    const evidenceSourceCount = uniqueSorted(members.flatMap(member => member.evidenceSources || []).filter(Boolean)).length;
    if (groupEvidence.length === 0 && evidenceSourceCount === 0) gaps.add("evidence_missing");
    if (groupEvidence.every(evidence => evidence.status !== "verified")) gaps.add("verified_evidence_missing");
    if (["tier_a", "tier_b"].includes(priorityTier) && !actionCoveragePresent(members, groupActions)) gaps.add("priority_action_missing");
    if (groupAliases.length === 0) gaps.add("alias_coverage_missing");

    const gapCodes = uniqueSorted(gaps);
    const ownerAlignment: CanonicalRentalCoverageGroup["ownerAlignment"] =
      gapCodes.includes("ownership_review") || gapCodes.includes("owner_conflict")
        ? "review"
        : analysisRows.some(member => member.ownerAlignment === "shared_aligned")
          ? "shared_aligned"
          : "aligned";

    return {
      rootAccountId,
      rootCanonicalName: accountMap.get(rootAccountId)?.canonicalName || members[0].canonicalName,
      memberAccountIds: uniqueSorted(members.map(member => member.id)),
      activeCountingAccountIds: uniqueSorted(activeCounting.map(member => member.id)),
      flaggedCountingAccountIds: uniqueSorted(flaggedCounting.map(member => member.id)),
      childContextAccountIds: uniqueSorted(members.filter(member => !isActiveCountingRecord(member)).map(member => member.id)),
      duplicateAccountIds: uniqueSorted(members.filter(member => member.relationshipType === "duplicate" || member.recordStatus === "merged").map(member => member.id)),
      countries: uniqueSorted(members.map(member => clean(member.country).toUpperCase()).filter(Boolean)),
      states,
      routes,
      owners,
      expectedOwners,
      ownerAlignment,
      priorityTier,
      pushNow: analysisRows.some(member => member.platformPushDecision === "push_now"),
      applicationPlays,
      installedBaseStatuses,
      suppliers,
      aliasCount: groupAliases.length,
      openActionCount: groupActions.length,
      nextActionCount: members.filter(member => clean(member.nextAction).length > 0).length,
      activeInMyWeekCount: members.filter(member => boolValue(member.activeInMyWeek)).length,
      liveSignalCount: groupLiveSignals.length,
      evidenceCount: groupEvidence.length,
      verifiedEvidenceCount: groupEvidence.filter(evidence => evidence.status === "verified").length,
      evidenceSourceCount,
      hasFinancialPotential: financialPotentialPresent(analysisRows),
      gapCodes,
      criticalGapCount: gapCodes.filter(gap => gapSeverity(gap) === "critical").length,
      highGapCount: gapCodes.filter(gap => gapSeverity(gap) === "high").length,
      mediumGapCount: gapCodes.filter(gap => gapSeverity(gap) === "medium").length,
      coverageScore: groupCoverageScore(gapCodes),
    };
  }).sort((a, b) => {
    if (b.criticalGapCount !== a.criticalGapCount) return b.criticalGapCount - a.criticalGapCount;
    if (b.highGapCount !== a.highGapCount) return b.highGapCount - a.highGapCount;
    if (a.coverageScore !== b.coverageScore) return a.coverageScore - b.coverageScore;
    return a.rootCanonicalName.localeCompare(b.rootCanonicalName) || a.rootAccountId - b.rootAccountId;
  });

  const groupByRoot = new Map(groups.map(group => [group.rootAccountId, group]));
  const rows: CanonicalRentalCoverageRow[] = [...preliminaryRows.values()].map(row => ({
    ...row,
    groupGapCodes: groupByRoot.get(row.rootAccountId)?.gapCodes || [],
  })).sort((a, b) => a.rootCanonicalName.localeCompare(b.rootCanonicalName) || a.accountId - b.accountId);

  const candidateReconciliation = reconcileCanonicalRentalCandidates(input.candidates || [], input.allAccounts, input.aliases);
  const groupGapCounts: Partial<Record<CanonicalRentalCoverageGapCode, number>> = {};
  const rowGapCounts: Partial<Record<CanonicalRentalCoverageGapCode, number>> = {};
  for (const group of groups) for (const gap of group.gapCodes) groupGapCounts[gap] = (groupGapCounts[gap] || 0) + 1;
  for (const row of rows) for (const gap of row.rowGapCodes) rowGapCounts[gap] = (rowGapCounts[gap] || 0) + 1;

  const summary: CanonicalRentalCoverageSummary = {
    generatedAt: generatedAt.toISOString(),
    scopeCountry: normalizedCountry,
    totalAccountsRead: input.allAccounts.length,
    allRentalRows: allRentalAccounts.length,
    nonScopeRentalRowsExcluded: allRentalAccounts.length - rentalAccounts.length,
    rentalRows: rentalAccounts.length,
    canonicalGroups: groups.length,
    countingCanonicalGroups: groups.filter(group => group.activeCountingAccountIds.length > 0).length,
    countingRentalAccounts: groups.filter(group => group.activeCountingAccountIds.length > 0).length,
    countingRows: groups.reduce((total, group) => total + group.activeCountingAccountIds.length, 0),
    groupsWithMultipleCountingRows: groups.filter(group => group.activeCountingAccountIds.length > 1).length,
    groupsWithoutCountingRow: groups.filter(group => group.activeCountingAccountIds.length === 0).length,
    childContextRows: rows.filter(row => !row.isActiveCountingRecord).length,
    duplicateRows: rows.filter(row => row.relationshipType === "duplicate" || row.recordStatus === "merged").length,
    tierA: groups.filter(group => group.priorityTier === "tier_a").length,
    tierB: groups.filter(group => group.priorityTier === "tier_b").length,
    pushNow: groups.filter(group => group.pushNow).length,
    ownerAlignment: countBy(groups.map(group => group.ownerAlignment)),
    routes: countBy(groups.map(group => group.routes.length === 1 ? group.routes[0] : group.routes.length === 0 ? "<blank>" : "<multiple>")),
    states: countBy(groups.flatMap(group => group.states.length > 0 ? group.states : ["<blank>"])),
    groupGapCounts,
    rowGapCounts,
    coverageScoreBands: {
      "90_100": groups.filter(group => group.coverageScore >= 90).length,
      "75_89": groups.filter(group => group.coverageScore >= 75 && group.coverageScore < 90).length,
      "50_74": groups.filter(group => group.coverageScore >= 50 && group.coverageScore < 75).length,
      "0_49": groups.filter(group => group.coverageScore < 50).length,
    },
    candidateDispositionCounts: countBy(candidateReconciliation.map(candidate => candidate.disposition)),
    candidateResearchFlagCounts: countBy(candidateReconciliation.flatMap(candidate => candidate.researchFlags)),
  };

  return {
    summary,
    rows,
    groups,
    gapQueue: groups.filter(group => group.gapCodes.length > 0),
    candidateReconciliation,
  };
}
