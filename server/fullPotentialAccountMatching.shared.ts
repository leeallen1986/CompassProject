export type FullPotentialMatchCertainty =
  | "confirmed"
  | "likely_high"
  | "likely_medium"
  | "unresolved";

export type FullPotentialCandidateSource =
  | "awarded_project"
  | "project_contractor"
  | "contractor_registry"
  | "project_owner"
  | "contact_company";

export type FullPotentialCandidateRole =
  | "winning_contractor"
  | "epc"
  | "contractor"
  | "subcontractor"
  | "rental"
  | "supplier"
  | "consultant"
  | "project_owner"
  | "contact_company"
  | "unknown";

export type FullPotentialRelationshipEvidence =
  | "confirmed"
  | "predicted"
  | "tendering"
  | "historical"
  | "unknown";

export type FullPotentialMatchMethod =
  | "canonical_name"
  | "display_name"
  | "alias"
  | "parent_group"
  | "contained_name"
  | "token_overlap"
  | "none";

export interface FullPotentialAccountForMatching {
  id: number;
  canonicalName: string;
  displayName?: string | null;
  parentGroup?: string | null;
  rowClass: string;
  parentAccountId?: number | null;
  mergedIntoAccountId?: number | null;
  relationshipType?: string | null;
  recordStatus?: string | null;
  countsTowardPotential?: boolean | null;
  state?: string | null;
  segment?: string | null;
  subsegment?: string | null;
  routeToMarket?: string | null;
  ownerName?: string | null;
  channelOwner?: string | null;
  fpStatus?: string | null;
  priorityTier?: string | null;
  platformPushDecision?: string | null;
  fullPotentialAud?: string | number | null;
  target2026Aud?: string | number | null;
  remainingPotentialAud?: string | number | null;
  confidenceLevel?: string | null;
  currentSupplier?: string | null;
  installedBaseStatus?: string | null;
  c4cStatus?: string | null;
  nextAction?: string | null;
  nextActionDate?: Date | string | null;
}

export interface FullPotentialAliasForMatching {
  accountId: number;
  aliasName: string;
  aliasType?: string | null;
  confidenceLevel?: string | null;
}

export interface FullPotentialAccountRuntimeState {
  approvedModelId?: number | null;
  approvedModelKey?: string | null;
  approvedModelVersion?: number | null;
  approvedModelPotentialAud?: string | number | null;
  approvedModelConfidence?: string | null;
  openActionCount?: number;
  nextOpenActionType?: string | null;
  nextOpenActionDueDate?: Date | string | null;
  activePursuitCount?: number;
  activePursuitStatuses?: string[];
}

export interface FullPotentialAccountCandidate {
  name: string;
  source: FullPotentialCandidateSource;
  role: FullPotentialCandidateRole;
  relationshipEvidence: FullPotentialRelationshipEvidence;
  confidence?: number | null;
  state?: string | null;
  detail?: string | null;
}

export interface ProjectLikeForFullPotentialMatching {
  id: number;
  name: string;
  owner?: string | null;
  projectState?: string | null;
  location?: string | null;
  sourcePurpose?: string | null;
  lifecycleStatus?: string | null;
  contractors?: Array<{
    name?: string | null;
    status?: string | null;
    confidence?: number | null;
    detail?: string | null;
    role?: string | null;
  }> | null;
}

export interface LinkedContractorForFullPotentialMatching {
  name: string;
  aliases?: string[] | null;
  role?: string | null;
  status?: string | null;
  confidence?: number | null;
  detail?: string | null;
}

interface FullPotentialMatchTerm {
  sourceAccountId: number;
  canonicalAccountId: number;
  value: string;
  normalized: string;
  kind: "canonical_name" | "display_name" | "alias" | "parent_group";
  aliasType?: string | null;
}

export interface FullPotentialMatchIndex {
  accountsById: Map<number, FullPotentialAccountForMatching>;
  canonicalTargetBySourceId: Map<number, number>;
  terms: FullPotentialMatchTerm[];
  termsByNormalized: Map<string, FullPotentialMatchTerm[]>;
  runtimeByAccountId: Map<number, FullPotentialAccountRuntimeState>;
}

export interface FullPotentialAccountMatch {
  candidateName: string;
  candidateSource: FullPotentialCandidateSource;
  candidateRole: FullPotentialCandidateRole;
  relationshipEvidence: FullPotentialRelationshipEvidence;
  relationshipConfidence: number;
  accountId: number;
  canonicalName: string;
  displayName: string | null;
  matchedSourceAccountId: number;
  matchMethod: FullPotentialMatchMethod;
  matchScore: number;
  certainty: Exclude<FullPotentialMatchCertainty, "unresolved">;
  matchReason: string;
  matchedTerm: string;
  account: FullPotentialAccountForMatching & FullPotentialAccountRuntimeState;
}

export interface UnresolvedFullPotentialCandidate {
  candidateName: string;
  candidateSource: FullPotentialCandidateSource;
  candidateRole: FullPotentialCandidateRole;
  relationshipEvidence: FullPotentialRelationshipEvidence;
  reason: "no_match" | "ambiguous_match" | "weak_match" | "composite_name";
  possibleAccountIds: number[];
  bestScore: number;
}

export interface ProjectFullPotentialContext {
  primaryMatch: FullPotentialAccountMatch | null;
  matches: FullPotentialAccountMatch[];
  unresolvedCandidates: UnresolvedFullPotentialCandidate[];
  candidateCount: number;
  confirmedCount: number;
  likelyCount: number;
}

const LEGAL_SUFFIX_PATTERNS = [
  /\bproprietary limited$/,
  /\bpty limited$/,
  /\bpty ltd$/,
  /\blimited$/,
  /\bltd$/,
  /\bincorporated$/,
  /\binc$/,
  /\bcorporation$/,
  /\bcorp$/,
  /\bllc$/,
  /\bplc$/,
  /\bholdings$/,
  /\bholding$/,
];

const GENERIC_COMPANY_TOKENS = new Set([
  "australia",
  "australian",
  "national",
  "group",
  "company",
  "companies",
  "services",
  "service",
  "industrial",
  "industries",
  "equipment",
  "solutions",
  "construction",
  "contracting",
  "contractors",
  "contractor",
  "engineering",
  "projects",
  "project",
  "hire",
  "rental",
  "rentals",
  "fleet",
  "systems",
  "resources",
  "operations",
  "joint",
  "venture",
  "jv",
  "alliance",
  "comprising",
  "package",
  "packages",
  "consortium",
  "partner",
  "partners",
  "the",
  "and",
]);

const ROLE_PRIORITY: Record<FullPotentialCandidateRole, number> = {
  winning_contractor: 100,
  epc: 92,
  contractor: 88,
  subcontractor: 82,
  rental: 80,
  supplier: 74,
  project_owner: 66,
  contact_company: 56,
  consultant: 45,
  unknown: 35,
};

const CERTAINTY_PRIORITY: Record<FullPotentialMatchCertainty, number> = {
  confirmed: 4,
  likely_high: 3,
  likely_medium: 2,
  unresolved: 1,
};

const TERM_KIND_BONUS: Record<FullPotentialMatchTerm["kind"], number> = {
  canonical_name: 4,
  display_name: 3,
  alias: 3,
  parent_group: 0,
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function normalizeCompanyName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " and ")
    .replace(/\bco\./g, " company ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLegalSuffixes(value: string): string {
  let current = value;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of LEGAL_SUFFIX_PATTERNS) {
      const next = current.replace(pattern, "").replace(/\s+/g, " ").trim();
      if (next !== current) {
        current = next;
        changed = true;
      }
    }
  }
  return current;
}

export function companyNameVariants(value: unknown): string[] {
  const normalized = normalizeCompanyName(value);
  if (!normalized) return [];
  const stripped = stripLegalSuffixes(normalized);
  const withoutTrailingAustralia = stripped
    .replace(/\b(australia|australian)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return unique([normalized, stripped, withoutTrailingAustralia].filter(Boolean));
}

export function significantCompanyTokens(value: unknown): string[] {
  return normalizeCompanyName(value)
    .split(" ")
    .filter(token => token.length >= 3 && !GENERIC_COMPANY_TOKENS.has(token));
}

export interface ParsedContractorIdentity {
  originalName: string;
  isComposite: boolean;
  operatingNames: string[];
  parentNames: string[];
}

function companyInitials(value: string): string {
  const words = String(value).match(/[A-Za-z0-9]+/g) ?? [];
  const initials: string[] = [];
  for (const word of words) {
    if (/^(and|the)$/i.test(word)) continue;
    if (/^[A-Z0-9]{2,5}$/.test(word)) initials.push(...word.toLowerCase().split(""));
    else initials.push(word[0].toLowerCase());
  }
  return initials.join("");
}

function splitParentheticalIdentity(value: string): {
  operatingName: string;
  parentName: string | null;
} {
  const match = value.trim().match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (!match) return { operatingName: value.trim(), parentName: null };
  const base = match[1].trim();
  const inside = match[2].trim();
  const normalisedInside = normalizeCompanyName(inside);
  const normalisedBase = normalizeCompanyName(base);
  const metadata = /^asx\s*:/i.test(inside)
    || normalisedBase.includes(normalisedInside)
    || (normalisedInside.length >= 2
      && normalisedInside.length <= 8
      && !normalisedInside.includes(" ")
      && companyInitials(base) === normalisedInside);
  return metadata
    ? { operatingName: base, parentName: null }
    : { operatingName: base, parentName: inside };
}

function cleanContractorParticipant(value: string): string {
  return value
    .replace(/^\s*(?:alliance\s+comprising|consortium\s+comprising|comprising)\s+/i, "")
    .replace(/^\s*(?:and|the)\s+/i, "")
    .replace(/\b(?:joint venture|consortium|alliance)\b\s*$/i, "")
    .replace(/^[,;\s]+|[,;\s]+$/g, "")
    .trim();
}

/**
 * Split multi-party contractor labels before account matching. Parent/group text is
 * retained as lower-confidence context and the whole composite is never fuzzy-matched.
 */
export function parseContractorIdentity(value: unknown): ParsedContractorIdentity {
  const originalName = String(value ?? "").trim();
  if (!originalName) return { originalName, isComposite: false, operatingNames: [], parentNames: [] };

  const hasCompositeMarker = /\b(joint venture|\bjv\b|alliance|consortium|comprising)\b/i.test(originalName)
    || /[,;]/.test(originalName)
    || /[–—]/.test(originalName);
  const stripped = originalName
    .replace(/^\s*(?:alliance\s+comprising|consortium\s+comprising|comprising)\s+/i, "")
    .replace(/\b(?:joint venture|consortium|alliance)\b\s*$/i, "")
    .trim();
  const rawParts = hasCompositeMarker
    ? stripped.split(/\s*,\s*|\s*;\s*|\s*[–—]\s*|\s+and\s+/i)
    : [stripped];

  const operatingNames: string[] = [];
  const parentNames: string[] = [];
  for (const rawPart of rawParts) {
    const participant = cleanContractorParticipant(rawPart);
    if (!participant) continue;
    const parsed = splitParentheticalIdentity(participant);
    if (parsed.operatingName && !operatingNames.includes(parsed.operatingName)) operatingNames.push(parsed.operatingName);
    if (parsed.parentName && !parentNames.includes(parsed.parentName)) parentNames.push(parsed.parentName);
  }

  return {
    originalName,
    isComposite: hasCompositeMarker || parentNames.length > 0 || operatingNames.length > 1,
    operatingNames,
    parentNames,
  };
}

function hasDistinctiveIdentity(value: string): boolean {
  const tokens = significantCompanyTokens(value);
  return tokens.length >= 2 || tokens.some(token => token.length >= 7);
}

function normalizeStateSet(value: unknown): Set<string> {
  const normalized = normalizeCompanyName(value);
  if (!normalized) return new Set();
  if (/^(national|nationwide|australia|australia wide|across australia|multi state|all states)$/.test(normalized)) {
    return new Set(["NATIONAL"]);
  }
  const aliases: Array<[RegExp, string]> = [
    [/\bwestern australia\b|\bwa\b/g, "WA"],
    [/\bqueensland\b|\bqld\b/g, "QLD"],
    [/\bnew south wales\b|\bnsw\b/g, "NSW"],
    [/\bvictoria\b|\bvic\b/g, "VIC"],
    [/\bsouth australia\b|\bsa\b/g, "SA"],
    [/\bnorthern territory\b|\bnt\b/g, "NT"],
    [/\btasmania\b|\btas\b/g, "TAS"],
    [/\baustralian capital territory\b|\bact\b/g, "ACT"],
    [/\bnew zealand\b|\bnz\b/g, "NZ"],
  ];
  const states = new Set<string>();
  for (const [pattern, state] of aliases) {
    pattern.lastIndex = 0;
    if (pattern.test(normalized)) states.add(state);
  }
  return states;
}

function stateScore(candidateState: unknown, accountState: unknown): number {
  const candidate = normalizeStateSet(candidateState);
  const account = normalizeStateSet(accountState);
  if (candidate.size === 0 || account.size === 0) return 0;
  if (candidate.has("NATIONAL") || account.has("NATIONAL")) return 2;
  for (const value of candidate) {
    if (account.has(value)) return 5;
  }
  return -8;
}

function isEligibleCanonicalAccount(account: FullPotentialAccountForMatching | undefined): boolean {
  if (!account) return false;
  if (account.rowClass !== "account") return false;
  if (account.countsTowardPotential === false) return false;
  if (["merged", "parked", "excluded"].includes(account.recordStatus ?? "")) return false;
  if (["park", "exclude"].includes(account.fpStatus ?? "")) return false;
  if (account.routeToMarket === "exclude") return false;
  return true;
}

function canonicalTargetFor(
  accountId: number,
  accountsById: Map<number, FullPotentialAccountForMatching>,
): number | null {
  let current = accountsById.get(accountId);
  const visited = new Set<number>();

  for (let depth = 0; current && depth < 8; depth += 1) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);

    const nextId = current.mergedIntoAccountId
      ?? (current.countsTowardPotential === false ? current.parentAccountId : null);
    if (!nextId) break;
    current = accountsById.get(nextId);
  }

  return current && isEligibleCanonicalAccount(current) ? current.id : null;
}

export function buildFullPotentialMatchIndex(
  accounts: FullPotentialAccountForMatching[],
  aliases: FullPotentialAliasForMatching[],
  runtime: Map<number, FullPotentialAccountRuntimeState> = new Map(),
): FullPotentialMatchIndex {
  const accountsById = new Map(accounts.map(account => [account.id, account]));
  const canonicalTargetBySourceId = new Map<number, number>();
  const aliasesByAccount = new Map<number, FullPotentialAliasForMatching[]>();

  for (const alias of aliases) {
    const list = aliasesByAccount.get(alias.accountId) ?? [];
    list.push(alias);
    aliasesByAccount.set(alias.accountId, list);
  }

  const terms: FullPotentialMatchTerm[] = [];
  const termsByNormalized = new Map<string, FullPotentialMatchTerm[]>();

  const addTerm = (
    sourceAccountId: number,
    canonicalAccountId: number,
    value: string | null | undefined,
    kind: FullPotentialMatchTerm["kind"],
    aliasType?: string | null,
  ) => {
    if (!value?.trim()) return;
    for (const normalized of companyNameVariants(value)) {
      if (normalized.length < 2) continue;
      const term: FullPotentialMatchTerm = {
        sourceAccountId,
        canonicalAccountId,
        value: value.trim(),
        normalized,
        kind,
        aliasType,
      };
      terms.push(term);
      const list = termsByNormalized.get(normalized) ?? [];
      if (!list.some(existing =>
        existing.canonicalAccountId === term.canonicalAccountId
        && existing.sourceAccountId === term.sourceAccountId
        && existing.kind === term.kind
        && existing.normalized === term.normalized
      )) {
        list.push(term);
        termsByNormalized.set(normalized, list);
      }
    }
  };

  for (const account of accounts) {
    const canonicalAccountId = canonicalTargetFor(account.id, accountsById);
    if (!canonicalAccountId) continue;
    canonicalTargetBySourceId.set(account.id, canonicalAccountId);

    addTerm(account.id, canonicalAccountId, account.canonicalName, "canonical_name");
    addTerm(account.id, canonicalAccountId, account.displayName, "display_name");
    addTerm(account.id, canonicalAccountId, account.parentGroup, "parent_group");
    for (const alias of aliasesByAccount.get(account.id) ?? []) {
      addTerm(account.id, canonicalAccountId, alias.aliasName, "alias", alias.aliasType);
    }
  }

  return {
    accountsById,
    canonicalTargetBySourceId,
    terms,
    termsByNormalized,
    runtimeByAccountId: runtime,
  };
}

function relationshipConfidence(candidate: FullPotentialAccountCandidate): number {
  const explicit = clamp(Number(candidate.confidence ?? 0));
  if (candidate.role === "winning_contractor") return explicit > 0 ? Math.max(95, explicit) : 100;
  if (candidate.relationshipEvidence === "confirmed") return explicit > 0 ? Math.max(85, explicit) : 92;
  if (candidate.role === "project_owner") return explicit > 0 ? Math.max(80, explicit) : 88;
  if (candidate.relationshipEvidence === "tendering") return explicit > 0 ? explicit : 78;
  if (candidate.relationshipEvidence === "predicted") return explicit > 0 ? explicit : 68;
  if (candidate.relationshipEvidence === "historical") return explicit > 0 ? Math.min(explicit, 60) : 50;
  if (candidate.source === "contact_company") return explicit > 0 ? Math.min(explicit, 65) : 55;
  return explicit > 0 ? explicit : 45;
}

function certaintyFor(nameScore: number, relationScore: number, exact: boolean): Exclude<FullPotentialMatchCertainty, "unresolved"> {
  if (exact && nameScore >= 96 && relationScore >= 85) return "confirmed";
  const combined = nameScore * 0.68 + relationScore * 0.32;
  if (combined >= 82) return "likely_high";
  return "likely_medium";
}

function termMethod(term: FullPotentialMatchTerm): FullPotentialMatchMethod {
  return term.kind;
}

function bestExactMatch(
  candidate: FullPotentialAccountCandidate,
  index: FullPotentialMatchIndex,
): { term: FullPotentialMatchTerm; score: number } | { ambiguous: number[]; score: number } | null {
  const matches: FullPotentialMatchTerm[] = [];
  for (const variant of companyNameVariants(candidate.name)) {
    matches.push(...(index.termsByNormalized.get(variant) ?? []));
  }
  if (matches.length === 0) return null;

  const bestByAccount = new Map<number, { term: FullPotentialMatchTerm; score: number }>();
  for (const term of matches) {
    const account = index.accountsById.get(term.canonicalAccountId);
    if (!account) continue;
    const score = clamp(96 + TERM_KIND_BONUS[term.kind] + stateScore(candidate.state, account.state));
    const current = bestByAccount.get(term.canonicalAccountId);
    if (!current || score > current.score) bestByAccount.set(term.canonicalAccountId, { term, score });
  }

  const ranked = [...bestByAccount.values()].sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 4) {
    return { ambiguous: ranked.filter(item => ranked[0].score - item.score < 4).map(item => item.term.canonicalAccountId), score: ranked[0].score };
  }
  return ranked[0];
}

function fuzzyTermScore(candidateName: string, term: FullPotentialMatchTerm): { score: number; method: FullPotentialMatchMethod } | null {
  const candidate = normalizeCompanyName(candidateName);
  const target = term.normalized;
  if (!candidate || !target || candidate === target) return null;

  const candidateDistinctive = significantCompanyTokens(candidate);
  const targetDistinctive = significantCompanyTokens(target);
  const shorter = candidate.length <= target.length ? candidate : target;
  const longer = candidate.length > target.length ? candidate : target;

  if (
    shorter.length >= 6
    && (longer.includes(shorter))
    && (hasDistinctiveIdentity(shorter) || (candidateDistinctive.length === 1 && targetDistinctive.length === 1 && shorter.length >= 8))
  ) {
    const ratio = shorter.length / Math.max(longer.length, 1);
    return { score: clamp(74 + ratio * 15 + TERM_KIND_BONUS[term.kind]), method: "contained_name" };
  }

  const candidateTokens = unique(candidateDistinctive);
  const targetTokens = unique(targetDistinctive);
  if (candidateTokens.length === 0 || targetTokens.length === 0) return null;
  const intersection = candidateTokens.filter(token => targetTokens.includes(token));
  const union = unique([...candidateTokens, ...targetTokens]);

  if (intersection.length >= 2) {
    const jaccard = intersection.length / Math.max(union.length, 1);
    return { score: clamp(58 + jaccard * 30 + TERM_KIND_BONUS[term.kind]), method: "token_overlap" };
  }

  if (
    intersection.length === 1
    && intersection[0].length >= 8
    && candidateTokens.length === 1
    && targetTokens.length === 1
  ) {
    return { score: clamp(76 + TERM_KIND_BONUS[term.kind]), method: "token_overlap" };
  }

  return null;
}

function bestFuzzyMatch(
  candidate: FullPotentialAccountCandidate,
  index: FullPotentialMatchIndex,
): { term: FullPotentialMatchTerm; score: number; method: FullPotentialMatchMethod } | { ambiguous: number[]; score: number } | null {
  if (!hasDistinctiveIdentity(normalizeCompanyName(candidate.name))) return null;

  const bestByAccount = new Map<number, { term: FullPotentialMatchTerm; score: number; method: FullPotentialMatchMethod }>();
  for (const term of index.terms) {
    const fuzzy = fuzzyTermScore(candidate.name, term);
    if (!fuzzy) continue;
    const account = index.accountsById.get(term.canonicalAccountId);
    if (!account) continue;
    const score = clamp(fuzzy.score + stateScore(candidate.state, account.state));
    const current = bestByAccount.get(term.canonicalAccountId);
    if (!current || score > current.score) bestByAccount.set(term.canonicalAccountId, { term, score, method: fuzzy.method });
  }

  const ranked = [...bestByAccount.values()].sort((a, b) => b.score - a.score);
  if (ranked.length === 0 || ranked[0].score < 72) return null;
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 6) {
    return { ambiguous: ranked.filter(item => ranked[0].score - item.score < 6).map(item => item.term.canonicalAccountId), score: ranked[0].score };
  }
  return ranked[0];
}

export function resolveFullPotentialCandidate(
  candidate: FullPotentialAccountCandidate,
  index: FullPotentialMatchIndex,
): { match: FullPotentialAccountMatch | null; unresolved: UnresolvedFullPotentialCandidate | null } {
  const normalizedCandidate = normalizeCompanyName(candidate.name);
  const parsedIdentity = parseContractorIdentity(candidate.name);
  if (parsedIdentity.isComposite) {
    return {
      match: null,
      unresolved: {
        candidateName: candidate.name,
        candidateSource: candidate.source,
        candidateRole: candidate.role,
        relationshipEvidence: candidate.relationshipEvidence,
        reason: "composite_name",
        possibleAccountIds: [],
        bestScore: 0,
      },
    };
  }
  if (normalizedCandidate.length < 2) {
    return {
      match: null,
      unresolved: {
        candidateName: candidate.name,
        candidateSource: candidate.source,
        candidateRole: candidate.role,
        relationshipEvidence: candidate.relationshipEvidence,
        reason: "weak_match",
        possibleAccountIds: [],
        bestScore: 0,
      },
    };
  }

  const exact = bestExactMatch(candidate, index);
  if (exact && "ambiguous" in exact) {
    return {
      match: null,
      unresolved: {
        candidateName: candidate.name,
        candidateSource: candidate.source,
        candidateRole: candidate.role,
        relationshipEvidence: candidate.relationshipEvidence,
        reason: "ambiguous_match",
        possibleAccountIds: unique(exact.ambiguous),
        bestScore: exact.score,
      },
    };
  }

  const fuzzy = exact ? null : bestFuzzyMatch(candidate, index);
  if (fuzzy && "ambiguous" in fuzzy) {
    return {
      match: null,
      unresolved: {
        candidateName: candidate.name,
        candidateSource: candidate.source,
        candidateRole: candidate.role,
        relationshipEvidence: candidate.relationshipEvidence,
        reason: "ambiguous_match",
        possibleAccountIds: unique(fuzzy.ambiguous),
        bestScore: fuzzy.score,
      },
    };
  }

  const selected = exact ?? fuzzy;
  if (!selected || "ambiguous" in selected) {
    return {
      match: null,
      unresolved: {
        candidateName: candidate.name,
        candidateSource: candidate.source,
        candidateRole: candidate.role,
        relationshipEvidence: candidate.relationshipEvidence,
        reason: "no_match",
        possibleAccountIds: [],
        bestScore: 0,
      },
    };
  }

  const account = index.accountsById.get(selected.term.canonicalAccountId);
  if (!account) {
    return {
      match: null,
      unresolved: {
        candidateName: candidate.name,
        candidateSource: candidate.source,
        candidateRole: candidate.role,
        relationshipEvidence: candidate.relationshipEvidence,
        reason: "no_match",
        possibleAccountIds: [],
        bestScore: 0,
      },
    };
  }

  const relationScore = relationshipConfidence(candidate);
  const exactMatch = Boolean(exact);
  const method: FullPotentialMatchMethod = "method" in selected ? selected.method as FullPotentialMatchMethod : termMethod(selected.term);
  const certainty = certaintyFor(selected.score, relationScore, exactMatch);
  const accountRuntime = index.runtimeByAccountId.get(account.id) ?? {};

  return {
    match: {
      candidateName: candidate.name,
      candidateSource: candidate.source,
      candidateRole: candidate.role,
      relationshipEvidence: candidate.relationshipEvidence,
      relationshipConfidence: relationScore,
      accountId: account.id,
      canonicalName: account.canonicalName,
      displayName: account.displayName ?? null,
      matchedSourceAccountId: selected.term.sourceAccountId,
      matchMethod: method,
      matchScore: Math.round(selected.score),
      certainty,
      matchReason: `${candidate.role.replace(/_/g, " ")} matched ${selected.term.kind.replace(/_/g, " ")} “${selected.term.value}”`,
      matchedTerm: selected.term.value,
      account: { ...account, ...accountRuntime },
    },
    unresolved: null,
  };
}

function normalizeRole(value: unknown): FullPotentialCandidateRole {
  const role = normalizeCompanyName(value).replace(/ /g, "_");
  if (role.includes("epc") || role.includes("head_contractor")) return "epc";
  if (role.includes("subcontract")) return "subcontractor";
  if (role.includes("rental") || role.includes("hire")) return "rental";
  if (role.includes("supplier")) return "supplier";
  if (role.includes("consult")) return "consultant";
  if (role.includes("contract")) return "contractor";
  return "unknown";
}

function normalizeRelationshipEvidence(value: unknown): FullPotentialRelationshipEvidence {
  const status = normalizeCompanyName(value);
  if (status.includes("confirm") || status.includes("award")) return "confirmed";
  if (status.includes("tender")) return "tendering";
  if (status.includes("histor")) return "historical";
  if (status.includes("predict") || status.includes("likely") || status.includes("possible")) return "predicted";
  return "unknown";
}

function candidateQuality(candidate: FullPotentialAccountCandidate): number {
  return ROLE_PRIORITY[candidate.role] + relationshipConfidence(candidate) / 10;
}

function dedupeCandidates(candidates: FullPotentialAccountCandidate[]): FullPotentialAccountCandidate[] {
  const byKey = new Map<string, FullPotentialAccountCandidate>();
  for (const candidate of candidates) {
    const normalized = normalizeCompanyName(candidate.name);
    if (!normalized) continue;
    const key = `${normalized}:${candidate.role}`;
    const existing = byKey.get(key);
    if (!existing || candidateQuality(candidate) > candidateQuality(existing)) byKey.set(key, candidate);
  }
  return [...byKey.values()].sort((a, b) => candidateQuality(b) - candidateQuality(a));
}

function pushParsedContractorCandidates(
  candidates: FullPotentialAccountCandidate[],
  name: string,
  template: Omit<FullPotentialAccountCandidate, "name">,
): void {
  const parsed = parseContractorIdentity(name);
  const operatingNames = parsed.operatingNames.length > 0 ? parsed.operatingNames : [name.trim()];
  for (const operatingName of operatingNames) {
    candidates.push({
      ...template,
      name: operatingName,
      detail: parsed.isComposite
        ? `${template.detail ?? "Contractor evidence"}; operating participant parsed from “${name}”`
        : template.detail,
    });
  }
  for (const parentName of parsed.parentNames) {
    candidates.push({
      ...template,
      name: parentName,
      role: "unknown",
      relationshipEvidence: "historical",
      confidence: Math.min(Number(template.confidence ?? 55), 60),
      detail: `Parent/group context parsed from “${name}”; validate the operating buying entity`,
    });
  }
}

export function extractProjectAccountCandidates(
  project: ProjectLikeForFullPotentialMatching,
  options: {
    linkedContractors?: LinkedContractorForFullPotentialMatching[];
    contactCompanies?: string[];
    awardedContractor?: string | null;
  } = {},
): FullPotentialAccountCandidate[] {
  const state = project.projectState ?? project.location ?? null;
  const candidates: FullPotentialAccountCandidate[] = [];

  if (options.awardedContractor?.trim()) {
    pushParsedContractorCandidates(candidates, options.awardedContractor.trim(), {
      source: "awarded_project",
      role: "winning_contractor",
      relationshipEvidence: "confirmed",
      confidence: 100,
      state,
      detail: `Winning contractor for ${project.name}`,
    });
  }

  for (const linked of options.linkedContractors ?? []) {
    const template = {
      source: "contractor_registry" as const,
      role: normalizeRole(linked.role),
      relationshipEvidence: normalizeRelationshipEvidence(linked.status),
      confidence: linked.confidence ?? null,
      state,
      detail: linked.detail ?? null,
    };
    pushParsedContractorCandidates(candidates, linked.name, template);
    for (const alias of linked.aliases ?? []) {
      pushParsedContractorCandidates(candidates, alias, template);
    }
  }

  for (const contractor of project.contractors ?? []) {
    if (!contractor.name?.trim()) continue;
    pushParsedContractorCandidates(candidates, contractor.name.trim(), {
      source: "project_contractor",
      role: normalizeRole(contractor.role ?? contractor.detail ?? "contractor"),
      relationshipEvidence: normalizeRelationshipEvidence(contractor.status),
      confidence: contractor.confidence ?? null,
      state,
      detail: contractor.detail ?? null,
    });
  }

  if (project.owner?.trim()) {
    candidates.push({
      name: project.owner.trim(),
      source: "project_owner",
      role: "project_owner",
      relationshipEvidence: "confirmed",
      confidence: 90,
      state,
      detail: `Project owner for ${project.name}`,
    });
  }

  for (const company of options.contactCompanies ?? []) {
    if (!company?.trim()) continue;
    candidates.push({
      name: company.trim(),
      source: "contact_company",
      role: "contact_company",
      relationshipEvidence: "unknown",
      confidence: 55,
      state,
      detail: `Company represented by a project-linked contact`,
    });
  }

  return dedupeCandidates(candidates);
}

export function resolveProjectFullPotentialContext(
  project: ProjectLikeForFullPotentialMatching,
  index: FullPotentialMatchIndex,
  options: {
    linkedContractors?: LinkedContractorForFullPotentialMatching[];
    contactCompanies?: string[];
    awardedContractor?: string | null;
  } = {},
): ProjectFullPotentialContext {
  const candidates = extractProjectAccountCandidates(project, options);
  const matches: FullPotentialAccountMatch[] = [];
  const unresolvedCandidates: UnresolvedFullPotentialCandidate[] = [];

  for (const candidate of candidates) {
    const result = resolveFullPotentialCandidate(candidate, index);
    if (result.match) matches.push(result.match);
    if (result.unresolved) unresolvedCandidates.push(result.unresolved);
  }

  const uniqueMatches = new Map<string, FullPotentialAccountMatch>();
  for (const match of matches) {
    const key = `${match.accountId}:${match.candidateRole}`;
    const existing = uniqueMatches.get(key);
    const currentRank = ROLE_PRIORITY[match.candidateRole] * 1000
      + CERTAINTY_PRIORITY[match.certainty] * 100
      + match.matchScore;
    const existingRank = existing
      ? ROLE_PRIORITY[existing.candidateRole] * 1000
        + CERTAINTY_PRIORITY[existing.certainty] * 100
        + existing.matchScore
      : -1;
    if (!existing || currentRank > existingRank) uniqueMatches.set(key, match);
  }

  const sorted = [...uniqueMatches.values()].sort((a, b) => {
    const roleDiff = ROLE_PRIORITY[b.candidateRole] - ROLE_PRIORITY[a.candidateRole];
    if (roleDiff !== 0) return roleDiff;
    const certaintyDiff = CERTAINTY_PRIORITY[b.certainty] - CERTAINTY_PRIORITY[a.certainty];
    if (certaintyDiff !== 0) return certaintyDiff;
    return b.matchScore - a.matchScore;
  });

  return {
    primaryMatch: sorted[0] ?? null,
    matches: sorted,
    unresolvedCandidates,
    candidateCount: candidates.length,
    confirmedCount: sorted.filter(match => match.certainty === "confirmed").length,
    likelyCount: sorted.filter(match => match.certainty !== "confirmed").length,
  };
}
