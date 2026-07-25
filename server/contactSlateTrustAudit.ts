import {
  validateStoredCandidateSlate,
  type SlatePolicyContact,
  type SlateValidationIssueCode,
  type StoredCandidateSlate,
} from "./contactSlateTrustPolicy";

export type SlateAuditSeverity = "ok" | "warn" | "error";

export interface SlateTrustAuditRow {
  slateId: number;
  projectId: number;
  status: "current" | "stale" | "invalid";
  severity: SlateAuditSeverity;
  isStale: boolean;
  generatedAt: string;
  totalSlotsFilled: number;
  sendReadySlots: number;
  namedUnverifiedSlots: number;
  llmSlots: number;
  computedTotalSlotsFilled: number;
  computedSendReadySlots: number;
  computedNamedUnverifiedSlots: number;
  issueCodes: SlateValidationIssueCode[];
  issueDetails: string[];
  requiresAction: boolean;
}

export interface SlateTrustAuditSummary {
  generatedAt: string;
  totalSlates: number;
  current: number;
  stale: number;
  invalid: number;
  requiresAction: number;
  issueCounts: Partial<Record<SlateValidationIssueCode, number>>;
}

export interface SlateTrustAuditResult {
  summary: SlateTrustAuditSummary;
  rows: SlateTrustAuditRow[];
}

/** Build a complete, read-only audit from already-loaded database rows. */
export function buildSlateTrustAudit(
  slates: StoredCandidateSlate[],
  liveContacts: ReadonlyMap<number, SlatePolicyContact>,
  linksByProject: ReadonlyMap<number, ReadonlySet<number>>,
  generatedAt = new Date(),
): SlateTrustAuditResult {
  const rows: SlateTrustAuditRow[] = slates
    .map(slate => {
      const validation = validateStoredCandidateSlate(
        slate,
        liveContacts,
        linksByProject.get(slate.projectId) || new Set<number>(),
      );
      const severity: SlateAuditSeverity = validation.status === "current"
        ? "ok"
        : validation.status === "stale"
          ? "warn"
          : "error";
      return {
        slateId: slate.id,
        projectId: slate.projectId,
        status: validation.status,
        severity,
        isStale: slate.isStale === true || slate.isStale === 1,
        generatedAt: slate.generatedAt.toISOString(),
        totalSlotsFilled: slate.totalSlotsFilled,
        sendReadySlots: slate.sendReadySlots,
        namedUnverifiedSlots: slate.namedUnverifiedSlots,
        llmSlots: slate.llmSlots,
        computedTotalSlotsFilled: validation.computed.totalSlotsFilled,
        computedSendReadySlots: validation.computed.sendReadySlots,
        computedNamedUnverifiedSlots: validation.computed.namedUnverifiedSlots,
        issueCodes: [...new Set(validation.issues.map(issue => issue.code))],
        issueDetails: validation.issues.map(issue => issue.detail),
        requiresAction: validation.status !== "current",
      };
    })
    .sort((a, b) => a.slateId - b.slateId);

  const issueCounts: Partial<Record<SlateValidationIssueCode, number>> = {};
  for (const row of rows) {
    for (const code of row.issueCodes) issueCounts[code] = (issueCounts[code] || 0) + 1;
  }

  return {
    summary: {
      generatedAt: generatedAt.toISOString(),
      totalSlates: rows.length,
      current: rows.filter(row => row.status === "current").length,
      stale: rows.filter(row => row.status === "stale").length,
      invalid: rows.filter(row => row.status === "invalid").length,
      requiresAction: rows.filter(row => row.requiresAction).length,
      issueCounts,
    },
    rows,
  };
}
