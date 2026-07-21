import type {
  FullPotentialAccountMatch,
  ProjectFullPotentialContext,
} from "./fullPotentialAccountMatching.shared";
import type { ThisWeekProject, UserContext } from "./thisWeekService";

export type NextBest5Confidence = "high" | "medium";
export type NextBest5ExclusionReason =
  | "not_must_act"
  | "not_tier1"
  | "not_hot"
  | "not_active"
  | "suppressed_or_merged"
  | "no_source"
  | "no_explicit_air_evidence"
  | "no_account_route"
  | "weak_account_route"
  | "already_managed"
  | "owner_mismatch";

export interface NextBest5User {
  id: number;
  name?: string | null;
  email?: string | null;
  role: "user" | "admin" | "distributor";
}

export interface NextBest5PersistedProject {
  id: number;
  name: string;
  projectState?: string | null;
  location?: string | null;
  lifecycleStatus?: string | null;
  stageCode?: string | null;
  sourcePurpose?: string | null;
  overview?: string | null;
  opportunityNote?: string | null;
  opportunityRoute?: string | null;
  equipmentSignals?: string[] | null;
  contractors?: Array<{
    name?: string | null;
    status?: string | null;
    confidence?: number | null;
    detail?: string | null;
    role?: string | null;
  }> | null;
  sources?: Array<{ label?: string | null; url?: string | null; date?: string | null }> | null;
  sourceLastSeenAt?: Date | string | null;
  createdAt?: Date | string | null;
  staleReason?: string | null;
  suppressed?: boolean | null;
  mergedIntoId?: number | null;
}

export interface NextBest5Source {
  label: string;
  url: string | null;
  date: string | null;
}

export interface NextBest5ProductHypothesis {
  label: string;
  application: string;
  confidence: NextBest5Confidence;
  basis: "explicit_project_evidence";
}

export interface NextBest5Recommendation {
  rank: number;
  serverPosition: number;
  projectId: number;
  projectName: string;
  projectState: string | null;
  location: string;
  relevanceScore: number;
  laneScore: number;
  visibilityTier: string;
  laneFitLabel: string;
  accountId: number;
  accountName: string;
  candidateName: string;
  candidateRole: string;
  certainty: FullPotentialAccountMatch["certainty"];
  matchMethod: FullPotentialAccountMatch["matchMethod"];
  ownerName: string | null;
  channelOwner: string | null;
  routeToMarket: string | null;
  priorityTier: string | null;
  whyNow: string;
  supportingEvidence: string[];
  uncertainties: string[];
  productHypothesis: NextBest5ProductHypothesis;
  recommendedAction: string;
  expectedOutcome: string;
  sources: NextBest5Source[];
  projectHref: string;
  accountHref: string;
}

export interface NextBest5Input {
  project: ThisWeekProject;
  persistedProject: NextBest5PersistedProject;
  context: ProjectFullPotentialContext;
  serverPosition: number;
}

export interface NextBest5Response {
  readOnly: true;
  generatedAt: string;
  weekLabel: string;
  userContext: UserContext;
  candidatePoolSize: number;
  eligibleCount: number;
  recommendations: NextBest5Recommendation[];
  exclusions: Record<NextBest5ExclusionReason, number>;
  crmBoundary: string;
}

const EXPLICIT_AIR_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:compressed air|portable air|air compressor|compressor package|portable compressor)\b/i, label: "portable compressed-air package" },
  { pattern: /\b(?:cfm|psi|bar pressure)\b/i, label: "specified air capacity or pressure" },
  { pattern: /\b(?:drilling|blast hole|blasthole|aircore|air core|dth|down-the-hole|rock drill|borehole)\b/i, label: "drilling and blasting air demand" },
  { pattern: /\b(?:piling|pile driving|micropile|pneumatic tool|jackhammer|rock breaking)\b/i, label: "piling or pneumatic civil works" },
  { pattern: /\b(?:abrasive blasting|sandblast|grit blast|shot blast|surface preparation)\b/i, label: "abrasive-blasting air demand" },
  { pattern: /\b(?:commissioning air|temporary plant air|shutdown|turnaround|instrument air|control air)\b/i, label: "temporary or commissioning air" },
  { pattern: /\b(?:pressure test|pressure testing|pneumatic test|pipeline testing|hydrotest|leak testing)\b/i, label: "pressure-testing requirement" },
  { pattern: /\b(?:nitrogen|n2 membrane|purging|inerting|dry-out|dryout|pipeline drying)\b/i, label: "specialty-air or nitrogen requirement" },
  { pattern: /\b(?:booster compressor|air booster|gas booster|high pressure booster)\b/i, label: "booster requirement" },
  { pattern: /\b(?:air dryer|desiccant dryer|refrigerant dryer|aftercooler|dew point)\b/i, label: "air-treatment requirement" },
];

function normalizeIdentity(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function truncate(value: unknown, max = 220): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function dateValue(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function latestSourceTime(project: NextBest5PersistedProject): number {
  const sourceDates = (project.sources ?? [])
    .map(source => dateValue(source.date ?? null))
    .filter(value => value > 0);
  return Math.max(
    dateValue(project.sourceLastSeenAt),
    dateValue(project.createdAt),
    ...sourceDates,
    0,
  );
}

function sourceText(project: NextBest5PersistedProject): string {
  return [
    project.name,
    project.overview,
    project.opportunityNote,
    project.opportunityRoute,
  ].filter(Boolean).join(" ");
}

export function explicitAirEvidence(project: NextBest5PersistedProject): string[] {
  const text = sourceText(project);
  return unique(
    EXPLICIT_AIR_PATTERNS
      .filter(item => item.pattern.test(text))
      .map(item => item.label),
  );
}

function accountOwnerMatchesUser(
  match: FullPotentialAccountMatch,
  user: NextBest5User,
): boolean {
  if (user.role === "admin") return true;
  const userTokens = [user.name, user.email]
    .map(normalizeIdentity)
    .filter(Boolean);
  if (userTokens.length === 0) return false;

  const ownerTokens = [match.account.ownerName, match.account.channelOwner]
    .map(normalizeIdentity)
    .filter(Boolean);
  return ownerTokens.some(owner =>
    userTokens.some(identity =>
      owner === identity
      || owner.includes(identity)
      || identity.includes(owner),
    ),
  );
}

function productHypothesis(project: ThisWeekProject): NextBest5ProductHypothesis {
  const angle = String(project.bestProductAngle ?? "").toLowerCase();
  const opportunity = String(project.opportunityType ?? "").toLowerCase();

  if (angle.includes("booster") || opportunity.includes("booster")) {
    return {
      label: "Specialty Air — Booster",
      application: "High-pressure air or gas boosting",
      confidence: project.airFit === "High" ? "high" : "medium",
      basis: "explicit_project_evidence",
    };
  }
  if (angle.includes("n2") || angle.includes("nitrogen") || opportunity.includes("purging")) {
    return {
      label: "Specialty Air — Nitrogen",
      application: "Purging, inerting or nitrogen membrane duty",
      confidence: project.airFit === "High" ? "high" : "medium",
      basis: "explicit_project_evidence",
    };
  }
  if (angle.includes("dryer") || opportunity.includes("air_treatment")) {
    return {
      label: "Air Treatment",
      application: "Dryer, aftercooler or instrument-quality air",
      confidence: project.airFit === "High" ? "high" : "medium",
      basis: "explicit_project_evidence",
    };
  }
  if (angle.includes("package")) {
    return {
      label: opportunity.includes("specialty") || opportunity.includes("pipeline")
        ? "Specialty Air package"
        : "Portable Air package",
      application: project.opportunityType.replace(/_/g, " "),
      confidence: project.airFit === "High" ? "high" : "medium",
      basis: "explicit_project_evidence",
    };
  }
  return {
    label: "Portable Air",
    application: project.opportunityType
      ? project.opportunityType.replace(/_/g, " ")
      : "Evidence-backed compressed-air requirement",
    confidence: project.airFit === "High" ? "high" : "medium",
    basis: "explicit_project_evidence",
  };
}

function routeUncertainty(match: FullPotentialAccountMatch): string[] {
  if (match.certainty === "confirmed") return [];
  return [
    `Validate that ${match.candidateName} is the accountable buying entity before outreach.`,
  ];
}

function accountUncertainties(match: FullPotentialAccountMatch): string[] {
  const account = match.account;
  const gaps: string[] = [];
  if (!account.approvedModelId) gaps.push("No manager-approved Full Potential model.");
  if (!account.currentSupplier || normalizeIdentity(account.currentSupplier).includes("unknown")) {
    gaps.push("Current supplier is not verified.");
  }
  if (!account.installedBaseStatus || normalizeIdentity(account.installedBaseStatus).includes("unknown")) {
    gaps.push("Installed base is not verified.");
  }
  if (!account.c4cStatus || normalizeIdentity(account.c4cStatus).includes("unknown")) {
    gaps.push("C4C opportunity status is not confirmed.");
  }
  return gaps;
}

function recommendationAction(
  match: FullPotentialAccountMatch,
  project: ThisWeekProject,
  hypothesis: NextBest5ProductHypothesis,
): { action: string; outcome: string } {
  const accountName = match.displayName || match.canonicalName;
  if (match.certainty !== "confirmed") {
    return {
      action: `Validate that ${match.candidateName} is the buying entity for ${project.name}; then confirm the ${hypothesis.label} requirement, timing and decision owner.`,
      outcome: "A verified route-to-buy and an evidence-backed account decision—not a CRM opportunity.",
    };
  }
  if (!match.account.approvedModelId) {
    return {
      action: `Contact ${accountName} to validate the ${hypothesis.label} requirement, incumbent supplier, installed base and decision timing; record the evidence in Full Potential.`,
      outcome: "Enough verified evidence to submit or update the commercial model.",
    };
  }
  return {
    action: `Confirm the decision timing and accountable buyer for the ${hypothesis.label} opportunity with ${accountName}; start an attributed pursuit only if the commercial need is genuine.`,
    outcome: "A defensible pursue, defer or reject decision, with C4C used only after genuine qualification.",
  };
}

function supportingEvidence(
  input: NextBest5Input,
  match: FullPotentialAccountMatch,
  explicitEvidence: string[],
): string[] {
  const { project, persistedProject } = input;
  const evidence = [
    project.whyNow,
    explicitEvidence.length > 0
      ? `Explicit project evidence: ${explicitEvidence.join(", ")}.`
      : "",
    `Buying route: ${match.candidateName} matched to ${match.displayName || match.canonicalName} as ${match.candidateRole.replace(/_/g, " ")} via ${match.matchMethod.replace(/_/g, " ")}.`,
    persistedProject.stageCode || project.stage
      ? `Project stage: ${persistedProject.stageCode || project.stage}.`
      : "",
    persistedProject.overview
      ? `Source summary: ${truncate(persistedProject.overview)}`
      : "",
  ];
  return unique(evidence);
}

function normalizedSources(project: NextBest5PersistedProject): NextBest5Source[] {
  return (project.sources ?? [])
    .filter(source => Boolean(source.url?.trim()))
    .slice(0, 3)
    .map(source => ({
      label: source.label?.trim() || "Project source",
      url: source.url?.trim() || null,
      date: source.date?.trim() || null,
    }));
}

export function exclusionReason(
  input: NextBest5Input,
  user: NextBest5User,
  now = new Date(),
): NextBest5ExclusionReason | null {
  const { project, persistedProject, context } = input;
  if (project.visibilityTier !== "must_act_candidate") return "not_must_act";
  if (project.actionTier !== "tier1_actionable") return "not_tier1";
  if (project.priority !== "hot") return "not_hot";
  if (persistedProject.lifecycleStatus !== "active") return "not_active";
  if (persistedProject.suppressed || persistedProject.mergedIntoId) return "suppressed_or_merged";

  const sources = normalizedSources(persistedProject);
  if (sources.length === 0) return "no_source";

  const evidence = explicitAirEvidence(persistedProject);
  if (evidence.length === 0) return "no_explicit_air_evidence";

  const freshest = latestSourceTime(persistedProject);
  if (freshest > 0 && now.getTime() - freshest > 90 * 24 * 60 * 60 * 1000) {
    return "not_active";
  }

  const match = context.primaryMatch;
  if (!match) return "no_account_route";
  if (!["confirmed", "likely_high"].includes(match.certainty)) return "weak_account_route";
  if ((match.account.activePursuitCount ?? 0) > 0 || (match.account.openActionCount ?? 0) > 0) {
    return "already_managed";
  }
  if (!accountOwnerMatchesUser(match, user)) return "owner_mismatch";
  return null;
}

export function buildNextBest5Recommendation(
  input: NextBest5Input,
  rank: number,
): NextBest5Recommendation {
  const { project, persistedProject, context, serverPosition } = input;
  const match = context.primaryMatch;
  if (!match) throw new Error("A primary account match is required");
  const hypothesis = productHypothesis(project);
  const action = recommendationAction(match, project, hypothesis);
  const explicitEvidence = explicitAirEvidence(persistedProject);
  const accountName = match.displayName || match.canonicalName;

  return {
    rank,
    serverPosition,
    projectId: project.id,
    projectName: project.name,
    projectState: persistedProject.projectState ?? null,
    location: project.location,
    relevanceScore: project.relevanceScore,
    laneScore: project.laneScore,
    visibilityTier: project.visibilityTier,
    laneFitLabel: project.laneFitLabel,
    accountId: match.accountId,
    accountName,
    candidateName: match.candidateName,
    candidateRole: match.candidateRole,
    certainty: match.certainty,
    matchMethod: match.matchMethod,
    ownerName: match.account.ownerName ?? null,
    channelOwner: match.account.channelOwner ?? null,
    routeToMarket: match.account.routeToMarket ?? null,
    priorityTier: match.account.priorityTier ?? null,
    whyNow: project.whyNow,
    supportingEvidence: supportingEvidence(input, match, explicitEvidence),
    uncertainties: unique([
      ...routeUncertainty(match),
      ...accountUncertainties(match),
    ]).slice(0, 4),
    productHypothesis: hypothesis,
    recommendedAction: action.action,
    expectedOutcome: action.outcome,
    sources: normalizedSources(persistedProject),
    projectHref: `/project/${project.id}`,
    accountHref: `/full-potential/commercial-model?accountId=${match.accountId}`,
  };
}

export function buildReadOnlyNextBest5(
  inputs: NextBest5Input[],
  user: NextBest5User,
  options: {
    limit?: number;
    now?: Date;
  } = {},
): {
  recommendations: NextBest5Recommendation[];
  exclusions: Record<NextBest5ExclusionReason, number>;
  eligibleCount: number;
} {
  const limit = Math.max(1, Math.min(options.limit ?? 5, 5));
  const now = options.now ?? new Date();
  const exclusions = {
    not_must_act: 0,
    not_tier1: 0,
    not_hot: 0,
    not_active: 0,
    suppressed_or_merged: 0,
    no_source: 0,
    no_explicit_air_evidence: 0,
    no_account_route: 0,
    weak_account_route: 0,
    already_managed: 0,
    owner_mismatch: 0,
  } satisfies Record<NextBest5ExclusionReason, number>;

  const eligible: NextBest5Input[] = [];
  for (const input of inputs) {
    const reason = exclusionReason(input, user, now);
    if (reason) exclusions[reason] += 1;
    else eligible.push(input);
  }

  return {
    recommendations: eligible
      .slice(0, limit)
      .map((input, index) => buildNextBest5Recommendation(input, index + 1)),
    exclusions,
    eligibleCount: eligible.length,
  };
}
