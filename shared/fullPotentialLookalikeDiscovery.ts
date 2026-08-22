export const FP_LOOKALIKE_METHOD_VERSION = "fp-lookalike-v1" as const;
export const FP_LOOKALIKE_SEGMENT_CAP_DEFAULT = 20 as const;

export const FP_LOOKALIKE_SOURCE_KINDS = [
  "first_party_company",
  "official_oem",
  "government",
  "industry_association",
  "reputable_trade_media",
] as const;

export const FP_LOOKALIKE_MARKET_ROLES = [
  "buyer",
  "dealer",
  "competitor",
  "reseller",
  "context",
] as const;

export const FP_LOOKALIKE_IDENTITY_STATUSES = [
  "not_checked",
  "new_identity",
  "existing_account",
  "ambiguous_identity",
] as const;

export const FP_LOOKALIKE_REVIEW_STATES = [
  "pending_review",
  "approved_for_qualification",
  "deferred",
  "rejected",
] as const;

export const FP_LOOKALIKE_DISPOSITIONS = [
  "ranked_candidate",
  "identity_check_required",
  "existing_account",
  "ambiguous_identity",
  "excluded_market_participant",
  "insufficient_evidence",
  "segment_cap_exceeded",
] as const;

export const FP_LOOKALIKE_PRIORITY_BANDS = [
  "high_priority_review",
  "review",
  "watchlist",
  "below_threshold",
  "not_scored",
] as const;

export type FullPotentialLookalikeSourceKind = typeof FP_LOOKALIKE_SOURCE_KINDS[number];
export type FullPotentialLookalikeMarketRole = typeof FP_LOOKALIKE_MARKET_ROLES[number];
export type FullPotentialLookalikeIdentityStatus = typeof FP_LOOKALIKE_IDENTITY_STATUSES[number];
export type FullPotentialLookalikeReviewState = typeof FP_LOOKALIKE_REVIEW_STATES[number];
export type FullPotentialLookalikeDisposition = typeof FP_LOOKALIKE_DISPOSITIONS[number];
export type FullPotentialLookalikePriorityBand = typeof FP_LOOKALIKE_PRIORITY_BANDS[number];

export type FullPotentialLookalikeBranchFootprint =
  | "single_site"
  | "regional"
  | "multi_state"
  | "national";

export interface FullPotentialLookalikePublicSource {
  sourceName: string;
  sourceUrl: string;
  observedAt: string;
  sourceKind: FullPotentialLookalikeSourceKind;
  publicObservation: string;
}

export interface FullPotentialLookalikeReviewedEvidenceCount {
  reviewed: boolean;
  count: number;
}

export interface FullPotentialLookalikeFeatures {
  buyerSegment: string;
  subsegments: string[];
  applications: string[];
  productCells: string[];
  cfmBands: string[];
  pressureBands: string[];
  geographies: string[];
  oemExposure: string[];
  branchFootprint: FullPotentialLookalikeBranchFootprint;
  recurringProgrammeEvidence: FullPotentialLookalikeReviewedEvidenceCount;
  currentSignalEvidence: FullPotentialLookalikeReviewedEvidenceCount;
}

export interface FullPotentialLookalikeSeed {
  seedKey: string;
  seedName: string;
  clusterKey: string;
  features: FullPotentialLookalikeFeatures;
  publicSources: FullPotentialLookalikePublicSource[];
  methodologyVersion: typeof FP_LOOKALIKE_METHOD_VERSION;
}

export interface FullPotentialLookalikeCandidate {
  candidateKey: string;
  candidateName: string;
  marketRole: FullPotentialLookalikeMarketRole;
  identityStatus: FullPotentialLookalikeIdentityStatus;
  reviewState: FullPotentialLookalikeReviewState;
  proposedRouteToMarket: string;
  proposedOwner: string | null;
  publicSimilarityRationale: string;
  features: FullPotentialLookalikeFeatures;
  publicSources: FullPotentialLookalikePublicSource[];
  methodologyVersion: typeof FP_LOOKALIKE_METHOD_VERSION;
}

export interface FullPotentialLookalikeScoreComponents {
  buyerSegment: number;
  subsegments: number;
  applications: number;
  productCells: number;
  cfmBands: number;
  pressureBands: number;
  geographies: number;
  oemExposure: number;
  branchFootprint: number;
  evidenceStrength: number;
  recurringProgrammeEvidence: number;
}

export interface FullPotentialLookalikeRankedCandidate {
  candidateKey: string;
  candidateName: string;
  buyerSegment: string;
  marketRole: FullPotentialLookalikeMarketRole;
  identityStatus: FullPotentialLookalikeIdentityStatus;
  reviewState: FullPotentialLookalikeReviewState;
  disposition: FullPotentialLookalikeDisposition;
  priorityBand: FullPotentialLookalikePriorityBand;
  similarityScore: number;
  matchedSeedKey: string | null;
  matchedSeedName: string | null;
  matchedClusterKey: string | null;
  scoreComponents: FullPotentialLookalikeScoreComponents | null;
  explanation: string[];
  publicSources: FullPotentialLookalikePublicSource[];
  proposedRouteToMarket: string;
  proposedOwner: string | null;
  countsTowardPotential: false;
  monetaryImpactAud: 0;
  crmC4cMutationAllowed: false;
  contactEnrichmentAllowed: false;
  weeklyRecommendationEligible: boolean;
  durableActionCreated: false;
  manualApprovalRequired: true;
}

export interface FullPotentialLookalikeSummary {
  methodologyVersion: typeof FP_LOOKALIKE_METHOD_VERSION;
  asOfDate: string;
  seedCount: number;
  candidateCount: number;
  scoredCandidateCount: number;
  rankedCandidateCount: number;
  identityCheckRequiredCount: number;
  excludedMarketParticipantCount: number;
  insufficientEvidenceCount: number;
  existingAccountCount: number;
  ambiguousIdentityCount: number;
  segmentCapExceededCount: number;
  weeklyRecommendationEligibleCount: number;
  monetaryImpactAud: 0;
  crmC4cMutations: 0;
  contactEnrichmentMutations: 0;
  durableActionsCreated: 0;
  results: FullPotentialLookalikeRankedCandidate[];
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?61|0)[\s().-]*(?:\d[\s().-]*){8,10}/;
const PRIVATE_LANGUAGE_PATTERN = /\b(?:customer said|customer told|private conversation|confidential tender|quoted price|quotation price|discount|crm note|purchasing intent|intends? to buy|agreed to buy)\b/i;
const SAFE_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

const SCORE_WEIGHTS = Object.freeze({
  buyerSegment: 20,
  subsegments: 10,
  applications: 16,
  productCells: 14,
  cfmBands: 12,
  pressureBands: 8,
  geographies: 6,
  oemExposure: 5,
  branchFootprint: 3,
  evidenceStrength: 4,
  recurringProgrammeEvidence: 2,
});

const FOOTPRINT_LEVEL: Record<FullPotentialLookalikeBranchFootprint, number> = {
  single_site: 1,
  regional: 2,
  multi_state: 3,
  national: 4,
};

function cleanText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function assertSafeText(value: unknown, field: string): void {
  const text = cleanText(value);
  if (!text) throw new Error(`${field} is required`);
  if (EMAIL_PATTERN.test(text)) throw new Error(`${field} must not contain an email address`);
  if (PHONE_PATTERN.test(text)) throw new Error(`${field} must not contain a phone number`);
  if (PRIVATE_LANGUAGE_PATTERN.test(text)) {
    throw new Error(`${field} appears to contain confidential or CRM-style intelligence`);
  }
}

function assertSafeKey(value: unknown, field: string): void {
  if (!SAFE_KEY_PATTERN.test(cleanText(value))) throw new Error(`${field} is invalid`);
}

function canonicalTokens(values: string[], field: string): string[] {
  if (!Array.isArray(values)) throw new Error(`${field} must be an array`);
  const tokens = values
    .map(value => cleanText(value).toLowerCase())
    .filter(Boolean);
  if (tokens.some(token => token.length > 96)) throw new Error(`${field} contains an oversized token`);
  return [...new Set(tokens)].sort();
}

function assertReviewedEvidenceCount(
  input: FullPotentialLookalikeReviewedEvidenceCount,
  field: string,
): void {
  if (typeof input?.reviewed !== "boolean") throw new Error(`${field}.reviewed must be boolean`);
  if (!Number.isSafeInteger(input.count) || input.count < 0 || input.count > 10_000) {
    throw new Error(`${field}.count must be a bounded non-negative integer`);
  }
  if (!input.reviewed && input.count !== 0) {
    throw new Error(`${field}.count must be zero until the evidence is reviewed`);
  }
}

function assertPublicSource(
  source: FullPotentialLookalikePublicSource,
  field: string,
): void {
  assertSafeText(source.sourceName, `${field}.sourceName`);
  if (!/^https:\/\//i.test(cleanText(source.sourceUrl))) {
    throw new Error(`${field}.sourceUrl must be an https URL`);
  }
  const parsed = new URL(source.sourceUrl);
  if (parsed.username || parsed.password) {
    throw new Error(`${field}.sourceUrl must not contain credentials`);
  }
  if (Number.isNaN(Date.parse(source.observedAt))) {
    throw new Error(`${field}.observedAt must be a valid date`);
  }
  assertSafeText(source.publicObservation, `${field}.publicObservation`);
}

function assertFeatures(features: FullPotentialLookalikeFeatures, field: string): void {
  assertSafeKey(features.buyerSegment, `${field}.buyerSegment`);
  canonicalTokens(features.subsegments, `${field}.subsegments`);
  canonicalTokens(features.applications, `${field}.applications`);
  canonicalTokens(features.productCells, `${field}.productCells`);
  canonicalTokens(features.cfmBands, `${field}.cfmBands`);
  canonicalTokens(features.pressureBands, `${field}.pressureBands`);
  canonicalTokens(features.geographies, `${field}.geographies`);
  canonicalTokens(features.oemExposure, `${field}.oemExposure`);
  if (!(features.branchFootprint in FOOTPRINT_LEVEL)) {
    throw new Error(`${field}.branchFootprint is invalid`);
  }
  assertReviewedEvidenceCount(
    features.recurringProgrammeEvidence,
    `${field}.recurringProgrammeEvidence`,
  );
  assertReviewedEvidenceCount(
    features.currentSignalEvidence,
    `${field}.currentSignalEvidence`,
  );
}

export function assertFullPotentialLookalikeSeed(
  seed: FullPotentialLookalikeSeed,
): void {
  if (seed.methodologyVersion !== FP_LOOKALIKE_METHOD_VERSION) {
    throw new Error(`Unsupported seed methodologyVersion ${seed.methodologyVersion}`);
  }
  assertSafeKey(seed.seedKey, "seedKey");
  assertSafeKey(seed.clusterKey, "clusterKey");
  assertSafeText(seed.seedName, "seedName");
  assertFeatures(seed.features, `seed:${seed.seedKey}`);
  if (!Array.isArray(seed.publicSources) || seed.publicSources.length < 1 || seed.publicSources.length > 10) {
    throw new Error(`seed:${seed.seedKey}.publicSources must contain 1-10 sources`);
  }
  seed.publicSources.forEach((source, index) => assertPublicSource(source, `seed:${seed.seedKey}.publicSources[${index}]`));
}

export function assertFullPotentialLookalikeCandidate(
  candidate: FullPotentialLookalikeCandidate,
): void {
  if (candidate.methodologyVersion !== FP_LOOKALIKE_METHOD_VERSION) {
    throw new Error(`Unsupported candidate methodologyVersion ${candidate.methodologyVersion}`);
  }
  assertSafeKey(candidate.candidateKey, "candidateKey");
  assertSafeText(candidate.candidateName, "candidateName");
  assertSafeText(candidate.publicSimilarityRationale, "publicSimilarityRationale");
  assertSafeKey(candidate.proposedRouteToMarket, "proposedRouteToMarket");
  if (candidate.proposedOwner !== null) {
    assertSafeText(candidate.proposedOwner, "proposedOwner");
  }
  assertFeatures(candidate.features, `candidate:${candidate.candidateKey}`);
  if (!Array.isArray(candidate.publicSources) || candidate.publicSources.length < 1 || candidate.publicSources.length > 10) {
    throw new Error(`candidate:${candidate.candidateKey}.publicSources must contain 1-10 sources`);
  }
  candidate.publicSources.forEach((source, index) => assertPublicSource(source, `candidate:${candidate.candidateKey}.publicSources[${index}]`));
}

function jaccard(leftValues: string[], rightValues: string[]): number {
  const left = new Set(canonicalTokens(leftValues, "leftValues"));
  const right = new Set(canonicalTokens(rightValues, "rightValues"));
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
}

function weightedOverlap(left: string[], right: string[], weight: number): number {
  return Math.round(jaccard(left, right) * weight * 10) / 10;
}

function evidenceStrength(
  candidate: FullPotentialLookalikeCandidate,
  asOfDate: string,
): number {
  const asOf = Date.parse(asOfDate);
  if (Number.isNaN(asOf)) throw new Error("asOfDate must be a valid date");
  const firstParty = candidate.publicSources.some(source => source.sourceKind === "first_party_company");
  const sourceBreadth = candidate.publicSources.length >= 2;
  const latest = Math.max(...candidate.publicSources.map(source => Date.parse(source.observedAt)));
  const ageDays = Math.max(0, (asOf - latest) / 86_400_000);
  return Math.min(
    SCORE_WEIGHTS.evidenceStrength,
    (firstParty ? 2 : 0) + (sourceBreadth ? 1 : 0) + (ageDays <= 548 ? 1 : 0),
  );
}

function footprintSimilarity(
  left: FullPotentialLookalikeBranchFootprint,
  right: FullPotentialLookalikeBranchFootprint,
): number {
  const distance = Math.abs(FOOTPRINT_LEVEL[left] - FOOTPRINT_LEVEL[right]);
  return Math.round((1 - distance / 3) * SCORE_WEIGHTS.branchFootprint * 10) / 10;
}

function scoreAgainstSeed(
  candidate: FullPotentialLookalikeCandidate,
  seed: FullPotentialLookalikeSeed,
  asOfDate: string,
): { score: number; components: FullPotentialLookalikeScoreComponents } {
  const components: FullPotentialLookalikeScoreComponents = {
    buyerSegment: candidate.features.buyerSegment === seed.features.buyerSegment
      ? SCORE_WEIGHTS.buyerSegment
      : 0,
    subsegments: weightedOverlap(candidate.features.subsegments, seed.features.subsegments, SCORE_WEIGHTS.subsegments),
    applications: weightedOverlap(candidate.features.applications, seed.features.applications, SCORE_WEIGHTS.applications),
    productCells: weightedOverlap(candidate.features.productCells, seed.features.productCells, SCORE_WEIGHTS.productCells),
    cfmBands: weightedOverlap(candidate.features.cfmBands, seed.features.cfmBands, SCORE_WEIGHTS.cfmBands),
    pressureBands: weightedOverlap(candidate.features.pressureBands, seed.features.pressureBands, SCORE_WEIGHTS.pressureBands),
    geographies: weightedOverlap(candidate.features.geographies, seed.features.geographies, SCORE_WEIGHTS.geographies),
    oemExposure: weightedOverlap(candidate.features.oemExposure, seed.features.oemExposure, SCORE_WEIGHTS.oemExposure),
    branchFootprint: footprintSimilarity(candidate.features.branchFootprint, seed.features.branchFootprint),
    evidenceStrength: evidenceStrength(candidate, asOfDate),
    recurringProgrammeEvidence:
      candidate.features.recurringProgrammeEvidence.reviewed
      && candidate.features.recurringProgrammeEvidence.count > 0
        ? SCORE_WEIGHTS.recurringProgrammeEvidence
        : 0,
  };
  const score = Math.round(
    (Object.values(components).reduce((sum, value) => sum + value, 0) + Number.EPSILON) * 10,
  ) / 10;
  return { score, components };
}

function evidenceDimensionCount(candidate: FullPotentialLookalikeCandidate): number {
  const dimensions = [
    candidate.features.subsegments,
    candidate.features.applications,
    candidate.features.productCells,
    candidate.features.cfmBands,
    candidate.features.pressureBands,
    candidate.features.geographies,
    candidate.features.oemExposure,
  ];
  return dimensions.filter(values => canonicalTokens(values, "candidateDimension").length > 0).length
    + (candidate.features.branchFootprint ? 1 : 0);
}

function hasMinimumPublicEvidence(candidate: FullPotentialLookalikeCandidate): boolean {
  return candidate.publicSources.some(source => source.sourceKind === "first_party_company")
    && evidenceDimensionCount(candidate) >= 4;
}

function priorityBand(score: number): FullPotentialLookalikePriorityBand {
  if (score >= 70) return "high_priority_review";
  if (score >= 55) return "review";
  if (score >= 40) return "watchlist";
  return "below_threshold";
}

function identityDisposition(
  candidate: FullPotentialLookalikeCandidate,
): FullPotentialLookalikeDisposition {
  if (candidate.identityStatus === "existing_account") return "existing_account";
  if (candidate.identityStatus === "ambiguous_identity") return "ambiguous_identity";
  if (candidate.identityStatus === "not_checked") return "identity_check_required";
  return "ranked_candidate";
}

function weeklyRecommendationEligible(
  candidate: FullPotentialLookalikeCandidate,
  disposition: FullPotentialLookalikeDisposition,
): boolean {
  return candidate.reviewState === "approved_for_qualification"
    && ["ranked_candidate", "existing_account"].includes(disposition)
    && Boolean(cleanText(candidate.proposedOwner))
    && !["manual_review", "exclude"].includes(candidate.proposedRouteToMarket)
    && candidate.features.currentSignalEvidence.reviewed
    && candidate.features.currentSignalEvidence.count > 0;
}

function explanationFor(
  candidate: FullPotentialLookalikeCandidate,
  seed: FullPotentialLookalikeSeed | null,
  components: FullPotentialLookalikeScoreComponents | null,
  disposition: FullPotentialLookalikeDisposition,
): string[] {
  const explanation = [candidate.publicSimilarityRationale];
  if (seed && components) {
    explanation.push(`Best public-evidence match: ${seed.seedName} (${seed.clusterKey}).`);
    const strongest = Object.entries(components)
      .filter(([, value]) => value > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 4)
      .map(([key, value]) => `${key} ${value}`);
    explanation.push(`Strongest deterministic score components: ${strongest.join(", ")}.`);
  }
  if (disposition === "identity_check_required") {
    explanation.push("Canonical account and alias reconciliation is required before candidate creation.");
  }
  if (disposition === "excluded_market_participant") {
    explanation.push("Dealer, competitor, reseller or context entities remain market evidence and cannot become buyer candidates in this release.");
  }
  explanation.push("Candidate is non-counting, has zero monetary impact and creates no CRM record or sales action.");
  return explanation;
}

export function rankFullPotentialLookalikes(input: {
  seeds: FullPotentialLookalikeSeed[];
  candidates: FullPotentialLookalikeCandidate[];
  asOfDate: string;
  segmentCap?: number;
}): FullPotentialLookalikeSummary {
  const segmentCap = input.segmentCap ?? FP_LOOKALIKE_SEGMENT_CAP_DEFAULT;
  if (!Number.isSafeInteger(segmentCap) || segmentCap < 1 || segmentCap > 100) {
    throw new Error("segmentCap must be an integer between 1 and 100");
  }
  if (Number.isNaN(Date.parse(input.asOfDate))) throw new Error("asOfDate must be valid");
  if (!Array.isArray(input.seeds) || input.seeds.length < 1) throw new Error("At least one seed is required");
  if (!Array.isArray(input.candidates)) throw new Error("candidates must be an array");

  const seedKeys = new Set<string>();
  for (const seed of input.seeds) {
    assertFullPotentialLookalikeSeed(seed);
    if (seedKeys.has(seed.seedKey)) throw new Error(`Duplicate seedKey ${seed.seedKey}`);
    seedKeys.add(seed.seedKey);
  }

  const candidateKeys = new Set<string>();
  const candidateNames = new Set<string>();
  for (const candidate of input.candidates) {
    assertFullPotentialLookalikeCandidate(candidate);
    if (candidateKeys.has(candidate.candidateKey)) {
      throw new Error(`Duplicate candidateKey ${candidate.candidateKey}`);
    }
    const normalizedName = cleanText(candidate.candidateName).toLowerCase();
    if (candidateNames.has(normalizedName)) {
      throw new Error(`Duplicate candidateName ${candidate.candidateName}`);
    }
    candidateKeys.add(candidate.candidateKey);
    candidateNames.add(normalizedName);
  }

  const preliminary = input.candidates.map<FullPotentialLookalikeRankedCandidate>(candidate => {
    let disposition: FullPotentialLookalikeDisposition;
    let bestSeed: FullPotentialLookalikeSeed | null = null;
    let bestScore = 0;
    let bestComponents: FullPotentialLookalikeScoreComponents | null = null;

    if (candidate.marketRole !== "buyer") {
      disposition = "excluded_market_participant";
    } else if (!hasMinimumPublicEvidence(candidate)) {
      disposition = "insufficient_evidence";
    } else {
      for (const seed of input.seeds) {
        const scored = scoreAgainstSeed(candidate, seed, input.asOfDate);
        if (
          scored.score > bestScore
          || (scored.score === bestScore && seed.seedKey.localeCompare(bestSeed?.seedKey ?? "") < 0)
        ) {
          bestScore = scored.score;
          bestSeed = seed;
          bestComponents = scored.components;
        }
      }
      disposition = identityDisposition(candidate);
    }

    const scored = bestSeed !== null && bestComponents !== null;
    const priority = scored ? priorityBand(bestScore) : "not_scored";
    return {
      candidateKey: candidate.candidateKey,
      candidateName: candidate.candidateName,
      buyerSegment: candidate.features.buyerSegment,
      marketRole: candidate.marketRole,
      identityStatus: candidate.identityStatus,
      reviewState: candidate.reviewState,
      disposition,
      priorityBand: priority,
      similarityScore: scored ? bestScore : 0,
      matchedSeedKey: bestSeed?.seedKey ?? null,
      matchedSeedName: bestSeed?.seedName ?? null,
      matchedClusterKey: bestSeed?.clusterKey ?? null,
      scoreComponents: bestComponents,
      explanation: explanationFor(candidate, bestSeed, bestComponents, disposition),
      publicSources: [...candidate.publicSources].sort((left, right) =>
        left.sourceUrl.localeCompare(right.sourceUrl)),
      proposedRouteToMarket: candidate.proposedRouteToMarket,
      proposedOwner: candidate.proposedOwner,
      countsTowardPotential: false,
      monetaryImpactAud: 0,
      crmC4cMutationAllowed: false,
      contactEnrichmentAllowed: false,
      weeklyRecommendationEligible: weeklyRecommendationEligible(candidate, disposition),
      durableActionCreated: false,
      manualApprovalRequired: true,
    };
  });

  const bySegment = new Map<string, FullPotentialLookalikeRankedCandidate[]>();
  for (const result of preliminary) {
    if (!["ranked_candidate", "identity_check_required"].includes(result.disposition)) continue;
    const rows = bySegment.get(result.buyerSegment) ?? [];
    rows.push(result);
    bySegment.set(result.buyerSegment, rows);
  }
  for (const rows of bySegment.values()) {
    rows.sort((left, right) =>
      right.similarityScore - left.similarityScore
      || left.candidateName.localeCompare(right.candidateName));
    rows.slice(segmentCap).forEach(row => {
      row.disposition = "segment_cap_exceeded";
      row.weeklyRecommendationEligible = false;
      row.explanation.push(`Segment candidate cap ${segmentCap} exceeded; retained outside the ranked review set.`);
    });
  }

  const results = preliminary.sort((left, right) =>
    right.similarityScore - left.similarityScore
    || left.candidateName.localeCompare(right.candidateName));

  const count = (disposition: FullPotentialLookalikeDisposition) =>
    results.filter(result => result.disposition === disposition).length;

  return {
    methodologyVersion: FP_LOOKALIKE_METHOD_VERSION,
    asOfDate: new Date(input.asOfDate).toISOString(),
    seedCount: input.seeds.length,
    candidateCount: input.candidates.length,
    scoredCandidateCount: results.filter(result => result.scoreComponents !== null).length,
    rankedCandidateCount: count("ranked_candidate"),
    identityCheckRequiredCount: count("identity_check_required"),
    excludedMarketParticipantCount: count("excluded_market_participant"),
    insufficientEvidenceCount: count("insufficient_evidence"),
    existingAccountCount: count("existing_account"),
    ambiguousIdentityCount: count("ambiguous_identity"),
    segmentCapExceededCount: count("segment_cap_exceeded"),
    weeklyRecommendationEligibleCount: results.filter(result => result.weeklyRecommendationEligible).length,
    monetaryImpactAud: 0,
    crmC4cMutations: 0,
    contactEnrichmentMutations: 0,
    durableActionsCreated: 0,
    results,
  };
}
