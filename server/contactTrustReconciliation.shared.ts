import { createHash } from "node:crypto";

export const CONTACT_TRUST_MANIFEST_VERSION = 2 as const;

export const CONTACT_TRUST_DISPOSITIONS = [
  "safe_keep",
  "safe_demote",
  "safe_promote",
  "safe_clear_generated_email",
  "safe_link_to_project",
  "manual_review",
  "no_change",
] as const;

export type ContactTrustDisposition = (typeof CONTACT_TRUST_DISPOSITIONS)[number];

export const APPLYABLE_CONTACT_TRUST_DISPOSITIONS = [
  "safe_demote",
  "safe_promote",
  "safe_clear_generated_email",
  "safe_link_to_project",
] as const satisfies readonly ContactTrustDisposition[];

export type ApplyableContactTrustDisposition = (typeof APPLYABLE_CONTACT_TRUST_DISPOSITIONS)[number];

export function dispositionInvalidatesCandidateSlates(disposition: ContactTrustDisposition): boolean {
  return (APPLYABLE_CONTACT_TRUST_DISPOSITIONS as readonly ContactTrustDisposition[]).includes(disposition);
}

export interface ContactTrustContactSnapshot {
  id: number;
  name: string;
  title: string;
  company: string;
  legacyProjectText: string;
  email: string | null;
  emailVerified: boolean;
  contactTrustTier: "send_ready" | "named_unverified" | "llm_inferred";
  enrichmentSource: string | null;
  verificationStatus: string | null;
  verifiedByUserId: number | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  linkedin: string | null;
  linkedinProfileUrl: string | null;
  verifiedLinkedinUrl: string | null;
  source: string | null;
  crmOrphan: boolean;
  createdAt: string;
}

export interface ContactTrustHunterLog {
  id: number;
  contactId: number;
  hunterStatus: string | null;
  hunterConfidence: number | null;
  emailFound: string | null;
  queryInput: Record<string, string> | null;
  contactUpdated: boolean;
  tierPromoted: boolean;
  createdAt: string;
}

export interface ContactTrustApolloLog {
  id: number;
  contactId: number | null;
  action: string;
  apolloPersonId: string | null;
  createdAt: string;
}

export interface ContactTrustValidationAction {
  id: number;
  contactId: number;
  action: string;
  userId: number;
  hunterVerified: boolean;
  hunterConfidence: number | null;
  hunterStatus: string | null;
  createdAt: string;
}

export interface ContactTrustProjectReference {
  id: number;
  name: string;
  lifecycleStatus: string | null;
  suppressed: boolean | null;
  mergedIntoId: number | null;
}

export interface ContactTrustEvidenceSummary {
  exactHistoricGeneratedEmail: string | null;
  generatedEmailMatches: boolean;
  humanEmailVerified: boolean;
  humanContactAccepted: boolean;
  hunterValidForCurrentEmail: boolean;
  hunterAcceptAllPromotion: boolean;
  hunterAcceptAllOnly: boolean;
  laterHunterValidAfterAcceptAll: boolean;
  apolloVerifiedState: boolean;
  apolloPersonIds: string[];
  strongEmailEvidence: boolean;
  rejectionEvidence: boolean;
  latestHunterStatus: string | null;
  latestHunterConfidence: number | null;
  evidenceReasons: string[];
}

export interface ContactDuplicateInfo {
  strongDuplicateGroupId: string | null;
  strongDuplicateContactIds: number[];
  strongDuplicateKeys: string[];
  recommendedSurvivorContactId: number | null;
  nameEmployerCandidateContactIds: number[];
}

export interface ContactTrustContext {
  contact: ContactTrustContactSnapshot;
  linkedProjectIds: number[];
  exactProjectMatches: ContactTrustProjectReference[];
  evidence: ContactTrustEvidenceSummary;
  duplicates: ContactDuplicateInfo;
}

export interface ContactTrustExpectedState {
  email: string | null;
  emailVerified: boolean;
  contactTrustTier: ContactTrustContactSnapshot["contactTrustTier"];
  verificationStatus: string | null;
  linkProjectId: number | null;
  linkProjectName: string | null;
}

export interface ContactTrustManifestRow {
  contactId: number;
  approved: boolean;
  disposition: ContactTrustDisposition;
  reason: string;
  reviewFlags: string[];
  before: ContactTrustContactSnapshot;
  expectedAfter: ContactTrustExpectedState;
  linkedProjectIds: number[];
  exactProjectMatchIds: number[];
  evidence: ContactTrustEvidenceSummary;
  duplicates: ContactDuplicateInfo;
  recordHash: string;
}

export interface ContactTrustManifestSummary {
  totalContacts: number;
  dispositions: Record<ContactTrustDisposition, number>;
  exactGeneratedEmailMatches: number;
  acceptAllHistoricPromotions: number;
  strongDuplicateContacts: number;
  nameEmployerReviewContacts: number;
  orphanContacts: number;
  deterministicLinkCandidates: number;
}

export interface ContactTrustManifestDraft {
  schemaVersion: typeof CONTACT_TRUST_MANIFEST_VERSION;
  generatedAt: string;
  databaseIdentity: string;
  databaseFingerprint: string;
  sealed: false;
  summary: ContactTrustManifestSummary;
  rows: ContactTrustManifestRow[];
}

export interface ContactTrustManifestSealed extends Omit<ContactTrustManifestDraft, "sealed"> {
  sealed: true;
  sealedAt: string;
  manifestHash: string;
}

export interface DuplicateIdentityInput {
  contactId: number;
  normalisedName: string;
  normalisedEmployer: string;
  verifiedEmail: string | null;
  linkedinUrl: string | null;
  apolloPersonIds: string[];
  qualityScore: number;
}

export interface ContactTrustSelectionOptions {
  contactIds?: readonly number[];
  projectIds?: readonly number[];
  dispositions?: readonly ContactTrustDisposition[];
  maxApply?: number;
}

function normaliseScalar(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normaliseScalar);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, normaliseScalar(nested)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normaliseScalar(value));
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function normaliseEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() || "";
  return email || null;
}

export function normaliseIdentityText(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normaliseLinkedinUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
  return trimmed || null;
}

/** Reproduces the exact historic first.last@cleanedcompany.com.au generator. */
export function historicGeneratedEmail(name: string, company: string): string | null {
  if (!name || !company) return null;
  const parts = name.toLowerCase().trim().split(/\s+/);
  if (parts.length < 2) return null;
  const first = parts[0].replace(/[^a-z]/g, "");
  const last = parts[parts.length - 1].replace(/[^a-z]/g, "");
  if (!first || !last) return null;
  const domain = company
    .toLowerCase()
    .replace(/\s*(pty|ltd|limited|inc|corp|group|australia|holdings)\s*/gi, "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (!domain) return null;
  return `${first}.${last}@${domain}.com.au`;
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function latestByCreatedAt<T extends { createdAt: string }>(rows: readonly T[]): T | null {
  return rows.reduce<T | null>((latest, row) => {
    if (!latest || parseTimestamp(row.createdAt) > parseTimestamp(latest.createdAt)) return row;
    return latest;
  }, null);
}

function hunterEmailMatchesCurrent(log: ContactTrustHunterLog, currentEmail: string | null): boolean {
  if (!currentEmail) return false;
  const inputEmail = normaliseEmail(log.queryInput?.email);
  const foundEmail = normaliseEmail(log.emailFound);
  return inputEmail === currentEmail || foundEmail === currentEmail;
}

export function deriveContactTrustEvidence(input: {
  contact: ContactTrustContactSnapshot;
  hunterLogs: readonly ContactTrustHunterLog[];
  apolloLogs: readonly ContactTrustApolloLog[];
  validationActions: readonly ContactTrustValidationAction[];
}): ContactTrustEvidenceSummary {
  const { contact, hunterLogs, apolloLogs, validationActions } = input;
  const currentEmail = normaliseEmail(contact.email);
  const generated = historicGeneratedEmail(contact.name, contact.company);
  const generatedEmailMatches = !!generated && normaliseEmail(generated) === currentEmail;

  const validHunterLogs = hunterLogs.filter(log =>
    log.hunterStatus === "valid"
    && Number(log.hunterConfidence || 0) >= 70
    && hunterEmailMatchesCurrent(log, currentEmail),
  );
  const latestValidHunter = latestByCreatedAt(validHunterLogs);
  const acceptAllPromotions = hunterLogs.filter(log =>
    log.hunterStatus === "accept_all" && (log.tierPromoted || log.contactUpdated),
  );
  const latestAcceptAllPromotion = latestByCreatedAt(acceptAllPromotions);
  const laterHunterValidAfterAcceptAll = !!latestAcceptAllPromotion && validHunterLogs.some(log =>
    parseTimestamp(log.createdAt) > parseTimestamp(latestAcceptAllPromotion.createdAt),
  );

  const humanVerifyActions = validationActions.filter(action => action.action === "verify_email");
  const humanAcceptActions = validationActions.filter(action => action.action === "accept");
  const rejectionActions = validationActions.filter(action =>
    action.action === "reject" || action.action === "wrong_company",
  );

  const humanEmailVerified = humanVerifyActions.length > 0 || (
    contact.emailVerified
    && contact.verifiedByUserId !== null
    && contact.verifiedAt !== null
  );
  const humanContactAccepted = humanAcceptActions.length > 0;

  const apolloPersonIds = Array.from(new Set(
    apolloLogs.map(log => log.apolloPersonId).filter((value): value is string => !!value),
  )).sort();
  const apolloVerifiedState = !!currentEmail
    && contact.enrichmentSource === "apollo"
    && contact.emailVerified
    && contact.verificationStatus === "verified";

  const hunterValidForCurrentEmail = !!latestValidHunter;
  const hunterAcceptAllPromotion = !!latestAcceptAllPromotion;
  const hunterAcceptAllOnly = hunterAcceptAllPromotion
    && !laterHunterValidAfterAcceptAll
    && !humanEmailVerified
    && !apolloVerifiedState;
  const rejectionEvidence = !!contact.rejectionReason || rejectionActions.length > 0;
  const strongEmailEvidence = humanEmailVerified || hunterValidForCurrentEmail || apolloVerifiedState;
  const latestHunter = latestByCreatedAt(hunterLogs);

  const evidenceReasons: string[] = [];
  if (generatedEmailMatches) evidenceReasons.push("exact_historic_generated_email_match");
  if (humanEmailVerified) evidenceReasons.push("human_email_verification");
  if (humanContactAccepted) evidenceReasons.push("human_contact_acceptance");
  if (hunterValidForCurrentEmail) evidenceReasons.push("hunter_valid_current_email");
  if (hunterAcceptAllPromotion) evidenceReasons.push("historic_hunter_accept_all_promotion");
  if (laterHunterValidAfterAcceptAll) evidenceReasons.push("later_hunter_valid_after_accept_all");
  if (apolloVerifiedState) evidenceReasons.push("apollo_verified_contact_state");
  if (rejectionEvidence) evidenceReasons.push("rejection_evidence");

  return {
    exactHistoricGeneratedEmail: generated,
    generatedEmailMatches,
    humanEmailVerified,
    humanContactAccepted,
    hunterValidForCurrentEmail,
    hunterAcceptAllPromotion,
    hunterAcceptAllOnly,
    laterHunterValidAfterAcceptAll,
    apolloVerifiedState,
    apolloPersonIds,
    strongEmailEvidence,
    rejectionEvidence,
    latestHunterStatus: latestHunter?.hunterStatus || null,
    latestHunterConfidence: latestHunter?.hunterConfidence ?? null,
    evidenceReasons,
  };
}

class UnionFind {
  private readonly parent = new Map<number, number>();

  add(value: number) {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: number): number {
    this.add(value);
    const parent = this.parent.get(value)!;
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(a: number, b: number) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

export function buildContactDuplicateIndex(inputs: readonly DuplicateIdentityInput[]): Map<number, ContactDuplicateInfo> {
  const union = new UnionFind();
  const keyMembers = new Map<string, number[]>();
  const inputById = new Map(inputs.map(input => [input.contactId, input]));

  const addKey = (key: string | null, contactId: number) => {
    if (!key) return;
    const members = keyMembers.get(key) || [];
    members.push(contactId);
    keyMembers.set(key, members);
  };

  for (const input of inputs) {
    union.add(input.contactId);
    addKey(input.linkedinUrl ? `linkedin:${input.linkedinUrl}` : null, input.contactId);
    addKey(input.verifiedEmail ? `verified_email:${input.verifiedEmail}` : null, input.contactId);
    for (const personId of input.apolloPersonIds) addKey(`apollo:${personId}`, input.contactId);
  }

  for (const members of keyMembers.values()) {
    if (members.length < 2) continue;
    const [first, ...rest] = members;
    for (const member of rest) union.union(first, member);
  }

  const strongGroups = new Map<number, number[]>();
  for (const input of inputs) {
    const root = union.find(input.contactId);
    const group = strongGroups.get(root) || [];
    group.push(input.contactId);
    strongGroups.set(root, group);
  }

  const nameEmployerGroups = new Map<string, number[]>();
  for (const input of inputs) {
    if (!input.normalisedName || !input.normalisedEmployer) continue;
    const key = `${input.normalisedName}|${input.normalisedEmployer}`;
    const group = nameEmployerGroups.get(key) || [];
    group.push(input.contactId);
    nameEmployerGroups.set(key, group);
  }

  const result = new Map<number, ContactDuplicateInfo>();
  for (const input of inputs) {
    const root = union.find(input.contactId);
    const strongMembers = (strongGroups.get(root) || []).sort((a, b) => a - b);
    const actualStrongMembers = strongMembers.length > 1 ? strongMembers : [];
    const strongKeys = Array.from(keyMembers.entries())
      .filter(([, members]) => members.includes(input.contactId) && members.length > 1)
      .map(([key]) => key)
      .sort();

    const nameEmployerKey = input.normalisedName && input.normalisedEmployer
      ? `${input.normalisedName}|${input.normalisedEmployer}`
      : "";
    const nameEmployerMembers = nameEmployerKey
      ? (nameEmployerGroups.get(nameEmployerKey) || []).sort((a, b) => a - b)
      : [];

    let recommendedSurvivorContactId: number | null = null;
    if (actualStrongMembers.length > 1) {
      recommendedSurvivorContactId = [...actualStrongMembers].sort((a, b) => {
        const scoreDifference = (inputById.get(b)?.qualityScore || 0) - (inputById.get(a)?.qualityScore || 0);
        return scoreDifference || a - b;
      })[0];
    }

    result.set(input.contactId, {
      strongDuplicateGroupId: actualStrongMembers.length > 1 ? `strong:${sha256(actualStrongMembers).slice(0, 16)}` : null,
      strongDuplicateContactIds: actualStrongMembers,
      strongDuplicateKeys: strongKeys,
      recommendedSurvivorContactId,
      nameEmployerCandidateContactIds: nameEmployerMembers.length > 1 ? nameEmployerMembers : [],
    });
  }

  return result;
}

function unchangedExpectedState(contact: ContactTrustContactSnapshot): ContactTrustExpectedState {
  return {
    email: contact.email,
    emailVerified: contact.emailVerified,
    contactTrustTier: contact.contactTrustTier,
    verificationStatus: contact.verificationStatus,
    linkProjectId: null,
    linkProjectName: null,
  };
}

function correctionResult(
  context: ContactTrustContext,
  disposition: ContactTrustDisposition,
  reason: string,
  expectedAfter: ContactTrustExpectedState,
  reviewFlags: string[],
): ContactTrustManifestRow {
  const base = {
    contactId: context.contact.id,
    approved: false,
    disposition,
    reason,
    reviewFlags: Array.from(new Set(reviewFlags)).sort(),
    before: context.contact,
    expectedAfter,
    linkedProjectIds: [...context.linkedProjectIds].sort((a, b) => a - b),
    exactProjectMatchIds: context.exactProjectMatches.map(project => project.id).sort((a, b) => a - b),
    evidence: context.evidence,
    duplicates: context.duplicates,
  };
  return { ...base, recordHash: sha256(base) };
}

export function classifyContactTrustDisposition(context: ContactTrustContext): ContactTrustManifestRow {
  const { contact, evidence, duplicates } = context;
  const reviewFlags: string[] = [];
  const exactProject = context.exactProjectMatches.length === 1 ? context.exactProjectMatches[0] : null;
  const hasNoLinks = context.linkedProjectIds.length === 0;

  if (duplicates.strongDuplicateContactIds.length > 1) reviewFlags.push("strong_duplicate_identity");
  if (duplicates.nameEmployerCandidateContactIds.length > 1) reviewFlags.push("duplicate_name_employer_candidate");
  if (hasNoLinks) reviewFlags.push("orphan_contact");
  if (context.exactProjectMatches.length > 1) reviewFlags.push("ambiguous_project_name_match");
  if (contact.crmOrphan) reviewFlags.push("crm_orphan");

  if (duplicates.strongDuplicateContactIds.length > 1 || duplicates.nameEmployerCandidateContactIds.length > 1) {
    return correctionResult(
      context,
      "manual_review",
      "Contact belongs to a duplicate identity candidate group; no automatic trust change is safe.",
      unchangedExpectedState(contact),
      reviewFlags,
    );
  }

  if (evidence.rejectionEvidence && contact.contactTrustTier === "send_ready") {
    return correctionResult(
      context,
      "safe_demote",
      "A rejected contact cannot remain send-ready.",
      { ...unchangedExpectedState(contact), emailVerified: false, contactTrustTier: "named_unverified", verificationStatus: "unverified" },
      reviewFlags,
    );
  }

  const generatedByHistoricPath = evidence.generatedEmailMatches
    && (contact.enrichmentSource === "linkedin" || contact.enrichmentSource === "web_search")
    && !evidence.strongEmailEvidence;
  if (generatedByHistoricPath) {
    reviewFlags.push("historic_generated_email_fingerprint");
    if (contact.emailVerified || contact.verificationStatus === "verified") {
      reviewFlags.push("historic_generated_email_verified_state_conflict");
      return correctionResult(
        context,
        "manual_review",
        "The address matches the historic generator, but persisted verification flags conflict with the missing evidence trail; automatic clearing is unsafe.",
        unchangedExpectedState(contact),
        reviewFlags,
      );
    }
    if (contact.contactTrustTier === "send_ready") {
      return correctionResult(
        context,
        "safe_demote",
        "The address matches the historic generator and lacks later evidence; demote trust but preserve the address for review or re-verification.",
        { ...unchangedExpectedState(contact), emailVerified: false, contactTrustTier: "named_unverified", verificationStatus: "unverified" },
        reviewFlags,
      );
    }
    return correctionResult(
      context,
      "manual_review",
      "The address matches the historic generator but is not currently send-ready; retain it for review rather than deleting contact data automatically.",
      unchangedExpectedState(contact),
      reviewFlags,
    );
  }

  if (evidence.hunterAcceptAllOnly && contact.contactTrustTier === "send_ready") {
    return correctionResult(
      context,
      "safe_demote",
      "Historic Hunter accept-all evidence does not verify an individual mailbox and no later valid evidence exists.",
      { ...unchangedExpectedState(contact), emailVerified: false, contactTrustTier: "named_unverified", verificationStatus: "unverified" },
      reviewFlags,
    );
  }

  if (contact.contactTrustTier === "send_ready") {
    if (!contact.email) {
      return correctionResult(
        context,
        "safe_demote",
        "Send-ready contact has no email address.",
        { ...unchangedExpectedState(contact), emailVerified: false, contactTrustTier: "named_unverified", verificationStatus: "unverified" },
        reviewFlags,
      );
    }
    if (!contact.emailVerified) {
      if (evidence.strongEmailEvidence) {
        return correctionResult(
          context,
          "safe_promote",
          "Strong provider or human evidence exists; reconcile the stale verification flags while retaining send-ready status.",
          { ...unchangedExpectedState(contact), emailVerified: true, contactTrustTier: "send_ready", verificationStatus: "verified" },
          reviewFlags,
        );
      }
      return correctionResult(
        context,
        "safe_demote",
        "Send-ready contact lacks mailbox-level or human verification.",
        { ...unchangedExpectedState(contact), emailVerified: false, contactTrustTier: "named_unverified", verificationStatus: "unverified" },
        reviewFlags,
      );
    }
    if (contact.enrichmentSource === "llm" && !evidence.humanEmailVerified) {
      return correctionResult(
        context,
        "safe_demote",
        "LLM-inferred contact lacks independent human verification.",
        { ...unchangedExpectedState(contact), emailVerified: false, contactTrustTier: "named_unverified", verificationStatus: "unverified" },
        reviewFlags,
      );
    }
    return correctionResult(
      context,
      "safe_keep",
      "Send-ready state is supported by a non-rejected verified email state.",
      unchangedExpectedState(contact),
      reviewFlags,
    );
  }

  if (contact.contactTrustTier === "named_unverified") {
    if (contact.email && evidence.strongEmailEvidence && !evidence.rejectionEvidence) {
      return correctionResult(
        context,
        "safe_promote",
        "Named contact has conclusive mailbox-level or human verification.",
        { ...unchangedExpectedState(contact), emailVerified: true, contactTrustTier: "send_ready", verificationStatus: "verified" },
        reviewFlags,
      );
    }
    if (contact.emailVerified && !evidence.strongEmailEvidence) {
      return correctionResult(
        context,
        "manual_review",
        "Verification flag is set but no conclusive provider or human evidence was found.",
        unchangedExpectedState(contact),
        reviewFlags,
      );
    }
  }

  if (contact.contactTrustTier === "llm_inferred") {
    if (evidence.humanEmailVerified && contact.email && !evidence.rejectionEvidence) {
      return correctionResult(
        context,
        "safe_promote",
        "A human explicitly verified the email for an originally inferred contact.",
        { ...unchangedExpectedState(contact), emailVerified: true, contactTrustTier: "send_ready", verificationStatus: "verified" },
        reviewFlags,
      );
    }
    if (contact.emailVerified || evidence.hunterValidForCurrentEmail || evidence.apolloVerifiedState) {
      return correctionResult(
        context,
        "manual_review",
        "An originally inferred identity has provider evidence but requires identity review before promotion.",
        unchangedExpectedState(contact),
        reviewFlags,
      );
    }
  }

  if (hasNoLinks && exactProject && !contact.crmOrphan) {
    return correctionResult(
      context,
      "safe_link_to_project",
      "Legacy project text matches exactly one project and the contact has no existing project links.",
      { ...unchangedExpectedState(contact), linkProjectId: exactProject.id, linkProjectName: exactProject.name },
      reviewFlags,
    );
  }

  if (hasNoLinks && !contact.crmOrphan && contact.legacyProjectText.trim()) {
    return correctionResult(
      context,
      "manual_review",
      context.exactProjectMatches.length > 1
        ? "Legacy project text matches multiple projects."
        : "Contact has legacy project text but no deterministic project match.",
      unchangedExpectedState(contact),
      reviewFlags,
    );
  }

  return correctionResult(
    context,
    "no_change",
    "No safe automatic correction is supported by the current evidence.",
    unchangedExpectedState(contact),
    reviewFlags,
  );
}

export function buildManifestSummary(rows: readonly ContactTrustManifestRow[]): ContactTrustManifestSummary {
  const dispositions = Object.fromEntries(CONTACT_TRUST_DISPOSITIONS.map(value => [value, 0])) as Record<ContactTrustDisposition, number>;
  for (const row of rows) dispositions[row.disposition] += 1;
  return {
    totalContacts: rows.length,
    dispositions,
    exactGeneratedEmailMatches: rows.filter(row => row.evidence.generatedEmailMatches).length,
    acceptAllHistoricPromotions: rows.filter(row => row.evidence.hunterAcceptAllPromotion).length,
    strongDuplicateContacts: rows.filter(row => row.duplicates.strongDuplicateContactIds.length > 1).length,
    nameEmployerReviewContacts: rows.filter(row => row.duplicates.nameEmployerCandidateContactIds.length > 1).length,
    orphanContacts: rows.filter(row => row.linkedProjectIds.length === 0).length,
    deterministicLinkCandidates: rows.filter(row => row.disposition === "safe_link_to_project").length,
  };
}

export function sealContactTrustManifest(
  draft: ContactTrustManifestDraft,
  sealedAt = new Date().toISOString(),
): ContactTrustManifestSealed {
  if (draft.schemaVersion !== CONTACT_TRUST_MANIFEST_VERSION || draft.sealed !== false) {
    throw new Error("Only an unsealed contact-trust manifest draft can be sealed");
  }
  const applyable = new Set<ContactTrustDisposition>(APPLYABLE_CONTACT_TRUST_DISPOSITIONS);
  for (const row of draft.rows) {
    const { recordHash, ...rowWithoutHash } = row;
    const untamperedPayload = { ...rowWithoutHash, approved: false };
    if (sha256(untamperedPayload) !== recordHash) {
      throw new Error(`Contact ${row.contactId}: manifest row changed outside the approved flag`);
    }
    if (row.approved && !applyable.has(row.disposition)) {
      throw new Error(`Contact ${row.contactId}: disposition ${row.disposition} cannot be approved for automatic apply`);
    }
  }
  const withoutHash = {
    ...draft,
    sealed: true as const,
    sealedAt,
  };
  return { ...withoutHash, manifestHash: sha256(withoutHash) };
}

export function verifySealedContactTrustManifest(manifest: ContactTrustManifestSealed): boolean {
  const { manifestHash, ...withoutHash } = manifest;
  return manifest.schemaVersion === CONTACT_TRUST_MANIFEST_VERSION
    && manifest.sealed === true
    && sha256(withoutHash) === manifestHash;
}

export function selectApprovedManifestRows(
  manifest: ContactTrustManifestSealed,
  options: ContactTrustSelectionOptions = {},
): ContactTrustManifestRow[] {
  const contactIds = options.contactIds?.length ? new Set(options.contactIds) : null;
  const projectIds = options.projectIds?.length ? new Set(options.projectIds) : null;
  const dispositions = options.dispositions?.length ? new Set(options.dispositions) : null;
  let rows = manifest.rows.filter(row => row.approved);
  if (contactIds) rows = rows.filter(row => contactIds.has(row.contactId));
  if (projectIds) {
    rows = rows.filter(row =>
      row.linkedProjectIds.some(id => projectIds.has(id))
      || (row.expectedAfter.linkProjectId !== null && projectIds.has(row.expectedAfter.linkProjectId)),
    );
  }
  if (dispositions) rows = rows.filter(row => dispositions.has(row.disposition));
  if (options.maxApply !== undefined) {
    if (!Number.isInteger(options.maxApply) || options.maxApply < 1) throw new Error("maxApply must be a positive integer");
    rows = rows.slice(0, options.maxApply);
  }
  return rows;
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const rendered = typeof value === "string" ? value : stableStringify(value);
  return /[",\n\r]/.test(rendered) ? `"${rendered.replace(/"/g, '""')}"` : rendered;
}

export function manifestRowsToCsv(rows: readonly ContactTrustManifestRow[]): string {
  const headers = [
    "contactId", "approved", "disposition", "reason", "name", "company", "title",
    "emailBefore", "emailVerifiedBefore", "tierBefore", "emailAfter", "emailVerifiedAfter",
    "tierAfter", "linkProjectId", "linkedProjectIds", "reviewFlags", "evidenceReasons",
    "strongDuplicateContactIds", "nameEmployerCandidateContactIds", "recordHash",
  ];
  const lines = rows.map(row => [
    row.contactId,
    row.approved,
    row.disposition,
    row.reason,
    row.before.name,
    row.before.company,
    row.before.title,
    row.before.email,
    row.before.emailVerified,
    row.before.contactTrustTier,
    row.expectedAfter.email,
    row.expectedAfter.emailVerified,
    row.expectedAfter.contactTrustTier,
    row.expectedAfter.linkProjectId,
    row.linkedProjectIds,
    row.reviewFlags,
    row.evidence.evidenceReasons,
    row.duplicates.strongDuplicateContactIds,
    row.duplicates.nameEmployerCandidateContactIds,
    row.recordHash,
  ].map(csvEscape).join(","));
  return `${headers.join(",")}\n${lines.join("\n")}\n`;
}
