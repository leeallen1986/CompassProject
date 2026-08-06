export type ContractorStatusKind = "confirmed" | "predicted" | "unknown";

export interface ContractorStatusView {
  kind: ContractorStatusKind;
  label: "Confirmed" | "Predicted" | "Status unknown";
}

export interface ExactProjectContactProjection {
  id: number;
  linkedProjectIds?: readonly number[] | null;
}

/**
 * Select display contacts only from the server's persisted-link projection.
 * Names, employers and free-text project fields are intentionally ignored.
 */
export function selectExactProjectContacts<T extends ExactProjectContactProjection>(
  projectId: number,
  contacts: readonly T[],
  limit = 10,
): T[] {
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || limit <= 0) return [];

  const seen = new Set<number>();
  return contacts.filter(contact => {
    if (!Number.isSafeInteger(contact.id) || contact.id <= 0 || seen.has(contact.id)) return false;
    const isExactLink = Array.isArray(contact.linkedProjectIds)
      && contact.linkedProjectIds.some(linkedId =>
        Number.isSafeInteger(linkedId) && linkedId > 0 && linkedId === projectId,
      );
    if (isExactLink) seen.add(contact.id);
    return isExactLink;
  }).slice(0, limit);
}

/**
 * Contractor data has arrived with inconsistent casing from historical
 * ingestion paths. Keep that storage detail out of the Ryan-facing UI.
 */
export function normaliseContractorStatus(status: string | null | undefined): ContractorStatusView {
  const normalised = status?.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (normalised === "confirmed" || normalised === "awarded" || normalised === "winning_contractor") {
    return { kind: "confirmed", label: "Confirmed" };
  }

  if (normalised === "predicted" || normalised === "likely" || normalised === "inferred") {
    return { kind: "predicted", label: "Predicted" };
  }

  return { kind: "unknown", label: "Status unknown" };
}

export function evidenceStateLabel(state: string | null | undefined): string {
  switch (state) {
    case "recorded_unverified":
      return "Recorded, unverified";
    case "inferred":
      return "Inferred";
    case "not_recorded":
      return "Not recorded";
    case "verified":
      return "Verified";
    case "unverified":
      return "Unverified";
    case "not_available":
      return "Not available";
    default:
      return "Evidence state unknown";
  }
}

export function buyerFunctionLabel(value: string): string {
  const labels: Record<string, string> = {
    project_package_lead: "Project / package lead",
    plant_equipment_fleet: "Plant, equipment or fleet",
    procurement_commercial: "Procurement / commercial",
    technical_site_operations: "Technical / site operations",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

export function laneLabel(value: string): string {
  const labels: Record<string, string> = {
    principal: "Principal",
    contractor: "Contractor",
    commercial: "Commercial",
    technical: "Technical",
    referral: "Referral",
    unknown: "Lane not established",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

export function sourceTypeLabel(value: string | null | undefined): string {
  if (!value) return "Source not recorded";
  const labels: Record<string, string> = {
    web_search: "Web search",
    linkedin: "LinkedIn",
    apollo: "Apollo",
    lusha: "Lusha",
    manual: "Manual review",
    crm: "CRM",
    scraper: "Source ingestion",
    llm: "AI suggestion",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

/**
 * Treat every persisted/provider URL as untrusted at the final render boundary.
 * Returning the original trimmed value preserves signed query strings while
 * rejecting script/data schemes and URLs containing embedded credentials.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    if ((url.protocol !== "https:" && url.protocol !== "http:")
      || url.username
      || url.password
      || !url.hostname) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

export function safeLinkedInUrl(value: string | null | undefined): string | null {
  const safeUrl = safeExternalUrl(value);
  if (!safeUrl) return null;

  const hostname = new URL(safeUrl).hostname.toLowerCase();
  return hostname === "linkedin.com" || hostname.endsWith(".linkedin.com")
    ? safeUrl
    : null;
}

export function lastCheckedLabel(
  at: Date | string | null | undefined,
  basis: string | null | undefined,
): string {
  if (!at) return "Not recorded";
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return "Not recorded";

  const basisLabels: Record<string, string> = {
    contact_verified_at: "verified",
    contact_enriched_at: "enriched",
    record_created_at: "recorded",
    not_recorded: "recorded",
  };
  const dateLabel = new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);

  return `${dateLabel} UTC (${basisLabels[basis ?? ""] ?? "checked"})`;
}
