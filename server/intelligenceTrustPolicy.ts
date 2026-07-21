/**
 * Shared trust policy for contractor hypotheses, contact discovery and paid
 * enrichment. These helpers are deliberately pure so every ingestion path
 * applies the same evidence standard.
 */

export const APOLLO_DAILY_CREDIT_CAP = 200;
export const HUNTER_MIN_CONFIDENCE_FOR_PROMOTION = 70;

export interface LinkedInNamedResult {
  fullName?: string | null;
}

function normalisePersonName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Resolve a LinkedIn result only when the requested person name is supported.
 * Returning the first search result is intentionally forbidden.
 */
export function selectLinkedInPersonMatch<T extends LinkedInNamedResult>(
  requestedName: string,
  items: readonly T[],
): T | null {
  const requested = normalisePersonName(requestedName);
  if (!requested) return null;

  const exact = items.find(item => normalisePersonName(item.fullName || "") === requested);
  if (exact) return exact;

  const parts = requested.split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts[parts.length - 1];

  const partialMatches = items.filter(item => {
    const candidate = normalisePersonName(item.fullName || "");
    if (!candidate) return false;
    const candidateParts = candidate.split(" ");
    return candidateParts[0] === first && candidateParts[candidateParts.length - 1] === last;
  });

  return partialMatches.length === 1 ? partialMatches[0] : null;
}

/** Pattern guesses are not contact data and must never occupy contacts.email. */
export function unverifiedContactEmail(): null {
  return null;
}

export function shouldPromoteHunterResult(input: {
  status: string | null | undefined;
  score: number | null | undefined;
  disposable?: boolean;
  block?: boolean;
}): boolean {
  return input.status === "valid"
    && Number(input.score || 0) >= HUNTER_MIN_CONFIDENCE_FOR_PROMOTION
    && !input.disposable
    && !input.block;
}

export interface ContractorHypothesisInput {
  name: string;
  role: string;
  confidence: string;
  detail: string;
}

/**
 * LLM-only contractor suggestions are hypotheses. Model confidence never
 * converts an unsourced suggestion into a confirmed commercial fact.
 */
export function toPersistedContractorHypothesis(input: ContractorHypothesisInput) {
  const confidence = input.confidence.toLowerCase() === "high"
    ? 70
    : input.confidence.toLowerCase() === "medium"
      ? 55
      : 35;

  return {
    name: input.name,
    status: "Predicted",
    confidence,
    detail: `[LLM hypothesis; unverified] ${input.role}: ${input.detail}`,
  } as const;
}

const GENERIC_COMPANY_VALUES = /^(unknown|various|multiple|tba|tbc|tbd|n\/?a|not specified|to be confirmed)$/i;

export function hasCredibleBuyingRoute(project: {
  owner?: string | null;
  opportunityRoute?: string | null;
  contractors?: unknown;
}): boolean {
  const owner = (project.owner || "").trim();
  if (project.opportunityRoute === "Direct CAPEX" && owner && !GENERIC_COMPANY_VALUES.test(owner)) {
    return true;
  }

  const contractors = Array.isArray(project.contractors) ? project.contractors : [];
  return contractors.some((contractor: any) => {
    const name = String(contractor?.name || "").trim();
    const status = String(contractor?.status || "").toLowerCase();
    return !!name
      && !GENERIC_COMPANY_VALUES.test(name)
      && (status === "confirmed" || status === "awarded" || status === "winning_contractor");
  });
}
