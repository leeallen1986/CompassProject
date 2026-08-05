/**
 * Candidate-slate trust policy.
 *
 * This module is deliberately database-independent. Every persisted-slate
 * eligibility, ranking, snapshot and read-time validation decision must flow
 * through these functions so the same trust definition is applied everywhere.
 */

export type ContactTrustTier = "send_ready" | "named_unverified" | "llm_inferred";
export type EffectiveSlateTier = "send_ready" | "named_unverified";
export type RoleLane = "primary" | "commercial" | "technical" | "backup";

export interface SlatePolicyContact {
  id: number;
  name: string;
  title: string;
  company: string;
  email: string | null;
  linkedin: string | null;
  enrichmentSource: string | null;
  contactTrustTier: ContactTrustTier | null;
  confidenceScore: "high" | "medium" | "low" | null;
  roleRelevance: "high" | "medium" | "low" | null;
  emailVerified: boolean | number | null;
  verificationStatus: string | null;
  rejectionReason: string | null;
  crmOrphan: boolean | number | null;
}

export interface RankedSlateContact extends SlatePolicyContact {
  effectiveTrustTier: EffectiveSlateTier;
  roleLane: RoleLane;
  compositeScore: number;
}

export type SlateEligibilityReason =
  | "llm_inferred"
  | "rejected"
  | "crm_orphan"
  | "not_linked_to_project";

export interface SlateEligibilityResult {
  eligible: boolean;
  reasons: SlateEligibilityReason[];
}

export interface SlateEligibilityReport {
  totalRows: number;
  uniqueContacts: number;
  duplicateRowsDropped: number;
  eligible: number;
  excluded: Record<SlateEligibilityReason, number>;
}

const PRIMARY_ROLE_KEYWORDS = [
  "project manager",
  "project director",
  "site manager",
  "construction manager",
  "project superintendent",
  "site superintendent",
  "project lead",
  "project head",
  "general manager",
  "operations director",
  "country manager",
  "regional manager",
  "managing director",
  "executive",
  "vp ",
  "vice president",
  "director",
];

const COMMERCIAL_ROLE_KEYWORDS = [
  "procurement",
  "commercial",
  "contracts manager",
  "contract manager",
  "purchasing",
  "supply chain",
  "category manager",
  "sourcing",
  "tendering",
  "bid manager",
  "estimator",
  "cost manager",
];

const TECHNICAL_ROLE_KEYWORDS = [
  "operations manager",
  "operations",
  "maintenance manager",
  "maintenance",
  "project engineer",
  "site engineer",
  "engineering manager",
  "plant manager",
  "equipment manager",
  "fleet manager",
  "hire manager",
  "rental manager",
  "mechanical engineer",
  "electrical engineer",
  "process engineer",
  "technical manager",
  "asset manager",
  "facilities manager",
];

export function classifyRoleLane(title: string): RoleLane {
  const normalised = title.toLowerCase();

  // Commercial precedes primary because procurement titles commonly contain
  // the generic word "manager".
  if (COMMERCIAL_ROLE_KEYWORDS.some(keyword => normalised.includes(keyword))) {
    return "commercial";
  }
  if (PRIMARY_ROLE_KEYWORDS.some(keyword => normalised.includes(keyword))) {
    return "primary";
  }
  if (TECHNICAL_ROLE_KEYWORDS.some(keyword => normalised.includes(keyword))) {
    return "technical";
  }
  return "backup";
}

export function normaliseBoolean(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

/** Missing/unknown orphan state is unsafe for contactable actions. */
export function isExplicitlyNotCrmOrphan(
  value: boolean | number | null | undefined,
): boolean {
  return value === false || value === 0;
}

export function hasNonEmptyEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().length > 0;
}

const SEND_READY_ENRICHMENT_SOURCES = new Set([
  "linkedin",
  "manual",
  "apollo",
  "web_search",
  "lusha",
]);

export function hasSendReadyEnrichmentSource(
  source: string | null | undefined,
): boolean {
  return typeof source === "string" &&
    SEND_READY_ENRICHMENT_SOURCES.has(source);
}

/**
 * A raw send_ready label is not enough. The mailbox must also be explicitly
 * verified and the contact must not be rejected.
 */
export function isEffectivelySendReady(contact: Pick<
  SlatePolicyContact,
  "contactTrustTier" | "email" | "emailVerified" | "verificationStatus" |
  "rejectionReason" | "enrichmentSource"
>): boolean {
  return (
    contact.contactTrustTier === "send_ready" &&
    hasSendReadyEnrichmentSource(contact.enrichmentSource) &&
    hasNonEmptyEmail(contact.email) &&
    normaliseBoolean(contact.emailVerified) &&
    contact.verificationStatus === "verified" &&
    contact.rejectionReason == null
  );
}

/**
 * Slates expose only two actionable trust states. Raw send_ready rows that do
 * not satisfy the full verification contract are downgraded in the snapshot
 * and coverage counts to named_unverified.
 */
export function deriveEffectiveSlateTier(contact: Pick<
  SlatePolicyContact,
  "contactTrustTier" | "email" | "emailVerified" | "verificationStatus" |
  "rejectionReason" | "enrichmentSource"
>): EffectiveSlateTier {
  return isEffectivelySendReady(contact) ? "send_ready" : "named_unverified";
}

export function evaluateSlateEligibility(
  contact: Pick<SlatePolicyContact, "contactTrustTier" | "rejectionReason"> & {
    crmOrphan?: boolean | number | null;
  },
  linkedToProject: boolean,
): SlateEligibilityResult {
  const reasons: SlateEligibilityReason[] = [];

  if (contact.contactTrustTier === "llm_inferred") reasons.push("llm_inferred");
  if (contact.rejectionReason != null) reasons.push("rejected");
  if (!isExplicitlyNotCrmOrphan(contact.crmOrphan)) reasons.push("crm_orphan");
  if (!linkedToProject) reasons.push("not_linked_to_project");

  return { eligible: reasons.length === 0, reasons };
}

/**
 * Score only eligible contacts. Effective send-ready receives a 40-point trust
 * advantage plus a 20-point verified-mailbox bonus. A raw but unsupported
 * send_ready label receives neither advantage.
 */
export function scoreSlateContact(contact: SlatePolicyContact): number {
  const effectiveTier = deriveEffectiveSlateTier(contact);
  let score = effectiveTier === "send_ready" ? 60 : 20;

  if (contact.linkedin?.trim()) score += 10;

  if (contact.confidenceScore === "high") score += 15;
  else if (contact.confidenceScore === "medium") score += 8;
  else score += 2;

  if (contact.roleRelevance === "high") score += 15;
  else if (contact.roleRelevance === "medium") score += 8;
  else score += 2;

  return score;
}

export function rankSlateContacts<T extends SlatePolicyContact>(contacts: T[]): Array<T & RankedSlateContact> {
  return contacts
    .map(contact => ({
      ...contact,
      effectiveTrustTier: deriveEffectiveSlateTier(contact),
      roleLane: classifyRoleLane(contact.title || ""),
      compositeScore: scoreSlateContact(contact),
    }))
    .sort((a, b) => {
      if (b.compositeScore !== a.compositeScore) {
        return b.compositeScore - a.compositeScore;
      }
      if (a.effectiveTrustTier !== b.effectiveTrustTier) {
        return a.effectiveTrustTier === "send_ready" ? -1 : 1;
      }
      return a.id - b.id;
    });
}

export function buildEligibilityReport(
  totalRows: number,
  uniqueContacts: SlatePolicyContact[],
  linkedContactIds: ReadonlySet<number>,
): SlateEligibilityReport {
  const excluded: Record<SlateEligibilityReason, number> = {
    llm_inferred: 0,
    rejected: 0,
    crm_orphan: 0,
    not_linked_to_project: 0,
  };

  let eligible = 0;
  for (const contact of uniqueContacts) {
    const result = evaluateSlateEligibility(contact, linkedContactIds.has(contact.id));
    if (result.eligible) {
      eligible += 1;
      continue;
    }
    for (const reason of result.reasons) excluded[reason] += 1;
  }

  return {
    totalRows,
    uniqueContacts: uniqueContacts.length,
    duplicateRowsDropped: Math.max(0, totalRows - uniqueContacts.length),
    eligible,
    excluded,
  };
}

export interface StoredSlotSnapshot {
  contactId: number;
  name: string;
  title: string;
  company: string;
  email: string | null;
  linkedin: string | null;
  enrichmentSource: string;
  contactTrustTier: ContactTrustTier;
  confidenceScore: string;
  roleRelevance: string;
  roleLane: RoleLane;
}

export interface StoredCandidateSlate {
  id: number;
  projectId: number;
  primaryContactId: number | null;
  backup1ContactId: number | null;
  backup2ContactId: number | null;
  commercialContactId: number | null;
  technicalContactId: number | null;
  primarySnapshot: StoredSlotSnapshot | null;
  backup1Snapshot: StoredSlotSnapshot | null;
  backup2Snapshot: StoredSlotSnapshot | null;
  commercialSnapshot: StoredSlotSnapshot | null;
  technicalSnapshot: StoredSlotSnapshot | null;
  totalSlotsFilled: number;
  sendReadySlots: number;
  namedUnverifiedSlots: number;
  llmSlots: number;
  sourcesUsed: string[] | null;
  generatedAt: Date;
  isStale: boolean | number;
  staleSince?: Date | null;
}

export type SlateValidationIssueCode =
  | "stale"
  | "id_without_snapshot"
  | "snapshot_without_id"
  | "slot_id_mismatch"
  | "duplicate_contact"
  | "missing_live_contact"
  | "llm_inferred"
  | "rejected"
  | "crm_orphan"
  | "not_linked_to_project"
  | "name_mismatch"
  | "title_mismatch"
  | "company_mismatch"
  | "email_mismatch"
  | "linkedin_mismatch"
  | "enrichment_source_mismatch"
  | "confidence_mismatch"
  | "role_relevance_mismatch"
  | "role_lane_mismatch"
  | "trust_tier_mismatch"
  | "verification_state_inconsistency"
  | "total_slots_mismatch"
  | "send_ready_count_mismatch"
  | "named_unverified_count_mismatch"
  | "llm_count_nonzero";

export interface SlateValidationIssue {
  code: SlateValidationIssueCode;
  slotName?: RoleLane | "backup1" | "backup2";
  contactId?: number;
  detail: string;
}

export interface SlateValidationResult {
  valid: boolean;
  status: "current" | "stale" | "invalid";
  issues: SlateValidationIssue[];
  computed: {
    totalSlotsFilled: number;
    sendReadySlots: number;
    namedUnverifiedSlots: number;
    llmSlots: 0;
  };
}

const slotDefinitions = [
  { name: "primary" as const, lane: "primary" as const, idKey: "primaryContactId" as const, snapshotKey: "primarySnapshot" as const },
  { name: "backup1" as const, lane: "backup" as const, idKey: "backup1ContactId" as const, snapshotKey: "backup1Snapshot" as const },
  { name: "backup2" as const, lane: "backup" as const, idKey: "backup2ContactId" as const, snapshotKey: "backup2Snapshot" as const },
  { name: "commercial" as const, lane: "commercial" as const, idKey: "commercialContactId" as const, snapshotKey: "commercialSnapshot" as const },
  { name: "technical" as const, lane: "technical" as const, idKey: "technicalContactId" as const, snapshotKey: "technicalSnapshot" as const },
];

function pushMismatch(
  issues: SlateValidationIssue[],
  condition: boolean,
  code: SlateValidationIssueCode,
  slotName: SlateValidationIssue["slotName"],
  contactId: number,
  detail: string,
): void {
  if (condition) issues.push({ code, slotName, contactId, detail });
}

/**
 * Validate every persisted slot against current contact rows and project links.
 * This function performs no writes and intentionally collects all detected
 * issues rather than stopping at the first failure.
 */
export function validateStoredCandidateSlate(
  slate: StoredCandidateSlate,
  liveContacts: ReadonlyMap<number, SlatePolicyContact>,
  linkedContactIds: ReadonlySet<number>,
): SlateValidationResult {
  const issues: SlateValidationIssue[] = [];
  const usedIds = new Set<number>();
  let computedTotal = 0;
  let computedSendReady = 0;
  let computedNamed = 0;

  if (normaliseBoolean(slate.isStale)) {
    issues.push({ code: "stale", detail: "The slate is explicitly marked stale." });
  }

  for (const definition of slotDefinitions) {
    const contactId = slate[definition.idKey];
    const snapshot = slate[definition.snapshotKey];

    if (contactId == null && snapshot == null) continue;

    if (contactId != null && snapshot == null) {
      issues.push({
        code: "id_without_snapshot",
        slotName: definition.name,
        contactId,
        detail: `${definition.name} has a contact ID but no snapshot.`,
      });
      continue;
    }

    if (contactId == null && snapshot != null) {
      issues.push({
        code: "snapshot_without_id",
        slotName: definition.name,
        contactId: snapshot.contactId,
        detail: `${definition.name} has a snapshot but no contact ID.`,
      });
      continue;
    }

    const resolvedId = contactId as number;
    const resolvedSnapshot = snapshot as StoredSlotSnapshot;
    computedTotal += 1;

    if (usedIds.has(resolvedId)) {
      issues.push({
        code: "duplicate_contact",
        slotName: definition.name,
        contactId: resolvedId,
        detail: `Contact ${resolvedId} is assigned to more than one slate slot.`,
      });
    }
    usedIds.add(resolvedId);

    if (resolvedSnapshot.contactId !== resolvedId) {
      issues.push({
        code: "slot_id_mismatch",
        slotName: definition.name,
        contactId: resolvedId,
        detail: `Snapshot contactId ${resolvedSnapshot.contactId} does not match slot contactId ${resolvedId}.`,
      });
    }

    const live = liveContacts.get(resolvedId);
    if (!live) {
      issues.push({
        code: "missing_live_contact",
        slotName: definition.name,
        contactId: resolvedId,
        detail: `Contact ${resolvedId} no longer exists.`,
      });
      continue;
    }

    const eligibility = evaluateSlateEligibility(live, linkedContactIds.has(resolvedId));
    for (const reason of eligibility.reasons) {
      issues.push({
        code: reason,
        slotName: definition.name,
        contactId: resolvedId,
        detail: `Contact ${resolvedId} is ineligible: ${reason}.`,
      });
    }

    const effectiveTier = deriveEffectiveSlateTier(live);
    if (effectiveTier === "send_ready") computedSendReady += 1;
    else computedNamed += 1;

    pushMismatch(issues, resolvedSnapshot.name !== live.name, "name_mismatch", definition.name, resolvedId, "Snapshot name differs from the live contact.");
    pushMismatch(issues, resolvedSnapshot.title !== live.title, "title_mismatch", definition.name, resolvedId, "Snapshot title differs from the live contact.");
    pushMismatch(issues, resolvedSnapshot.company !== live.company, "company_mismatch", definition.name, resolvedId, "Snapshot company differs from the live contact.");
    pushMismatch(issues, resolvedSnapshot.email !== live.email, "email_mismatch", definition.name, resolvedId, "Snapshot email differs from the live contact.");
    pushMismatch(issues, resolvedSnapshot.linkedin !== live.linkedin, "linkedin_mismatch", definition.name, resolvedId, "Snapshot LinkedIn URL differs from the live contact.");
    pushMismatch(
      issues,
      resolvedSnapshot.enrichmentSource !== (live.enrichmentSource || "unknown"),
      "enrichment_source_mismatch",
      definition.name,
      resolvedId,
      "Snapshot enrichment source differs from the live contact.",
    );
    pushMismatch(
      issues,
      resolvedSnapshot.confidenceScore !== (live.confidenceScore || "medium"),
      "confidence_mismatch",
      definition.name,
      resolvedId,
      "Snapshot confidence differs from the live contact.",
    );
    pushMismatch(
      issues,
      resolvedSnapshot.roleRelevance !== (live.roleRelevance || "medium"),
      "role_relevance_mismatch",
      definition.name,
      resolvedId,
      "Snapshot role relevance differs from the live contact.",
    );
    pushMismatch(
      issues,
      resolvedSnapshot.roleLane !== definition.lane,
      "role_lane_mismatch",
      definition.name,
      resolvedId,
      `Snapshot role lane ${resolvedSnapshot.roleLane} does not match slot lane ${definition.lane}.`,
    );
    pushMismatch(
      issues,
      resolvedSnapshot.contactTrustTier !== effectiveTier,
      "trust_tier_mismatch",
      definition.name,
      resolvedId,
      `Snapshot tier ${resolvedSnapshot.contactTrustTier} does not match effective tier ${effectiveTier}.`,
    );

    if (resolvedSnapshot.contactTrustTier === "send_ready" && !isEffectivelySendReady(live)) {
      issues.push({
        code: "verification_state_inconsistency",
        slotName: definition.name,
        contactId: resolvedId,
        detail: "Snapshot claims send_ready but the live mailbox state is not effectively verified.",
      });
    }
  }

  if (slate.totalSlotsFilled !== computedTotal) {
    issues.push({
      code: "total_slots_mismatch",
      detail: `Stored totalSlotsFilled=${slate.totalSlotsFilled}; computed=${computedTotal}.`,
    });
  }
  if (slate.sendReadySlots !== computedSendReady) {
    issues.push({
      code: "send_ready_count_mismatch",
      detail: `Stored sendReadySlots=${slate.sendReadySlots}; computed=${computedSendReady}.`,
    });
  }
  if (slate.namedUnverifiedSlots !== computedNamed) {
    issues.push({
      code: "named_unverified_count_mismatch",
      detail: `Stored namedUnverifiedSlots=${slate.namedUnverifiedSlots}; computed=${computedNamed}.`,
    });
  }
  if (slate.llmSlots !== 0) {
    issues.push({
      code: "llm_count_nonzero",
      detail: `Stored llmSlots=${slate.llmSlots}; persisted slates must contain zero LLM slots.`,
    });
  }

  const status = normaliseBoolean(slate.isStale)
    ? "stale"
    : issues.length > 0
      ? "invalid"
      : "current";

  return {
    valid: status === "current",
    status,
    issues,
    computed: {
      totalSlotsFilled: computedTotal,
      sendReadySlots: computedSendReady,
      namedUnverifiedSlots: computedNamed,
      llmSlots: 0,
    },
  };
}

export interface SafeSlateResponse {
  totalSlotsFilled: number;
  sendReadySlots: number;
  namedUnverifiedSlots: number;
  llmSlots: number;
  sourcesUsed: string[] | null;
  isStale: boolean;
  generatedAt: Date;
  primarySnapshot: StoredSlotSnapshot | null;
  backup1Snapshot: StoredSlotSnapshot | null;
  backup2Snapshot: StoredSlotSnapshot | null;
  commercialSnapshot: StoredSlotSnapshot | null;
  technicalSnapshot: StoredSlotSnapshot | null;
  validationIssues: SlateValidationIssue[];
}

/**
 * Invalid or stale snapshots are never returned as current recommendations.
 * Metadata remains visible so operators can see that coverage exists but needs
 * regeneration.
 */
export function sanitiseSlateForResponse(
  slate: StoredCandidateSlate | null | undefined,
  validation: SlateValidationResult | null,
): SafeSlateResponse | null {
  if (!slate) return null;
  const exposeSnapshots = validation?.valid === true;

  return {
    totalSlotsFilled: slate.totalSlotsFilled,
    sendReadySlots: slate.sendReadySlots,
    namedUnverifiedSlots: slate.namedUnverifiedSlots,
    llmSlots: slate.llmSlots,
    sourcesUsed: slate.sourcesUsed,
    isStale: normaliseBoolean(slate.isStale),
    generatedAt: slate.generatedAt,
    primarySnapshot: exposeSnapshots ? slate.primarySnapshot : null,
    backup1Snapshot: exposeSnapshots ? slate.backup1Snapshot : null,
    backup2Snapshot: exposeSnapshots ? slate.backup2Snapshot : null,
    commercialSnapshot: exposeSnapshots ? slate.commercialSnapshot : null,
    technicalSnapshot: exposeSnapshots ? slate.technicalSnapshot : null,
    validationIssues: validation?.issues || [],
  };
}
