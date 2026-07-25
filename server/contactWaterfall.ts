/**
 * Contact candidate-slate waterfall.
 *
 * Persisted slates contain only project-linked, non-rejected, non-orphan,
 * non-LLM contacts. A raw send_ready label is exposed as send-ready only when
 * the mailbox verification state is complete.
 */

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  contacts,
  contactProjects,
  contactCandidateSlates,
  type SlotSnapshot,
} from "../drizzle/schema";
import {
  buildEligibilityReport,
  deriveEffectiveSlateTier,
  evaluateSlateEligibility,
  rankSlateContacts,
  validateStoredCandidateSlate,
  type RankedSlateContact,
  type RoleLane,
  type SlateEligibilityReport,
  type SlatePolicyContact,
  type StoredCandidateSlate,
} from "./contactSlateTrustPolicy";

export { classifyRoleLane } from "./contactSlateTrustPolicy";
export type { RoleLane } from "./contactSlateTrustPolicy";

export type SlateCandidate = RankedSlateContact;

export interface CandidateSlate {
  projectId: number;
  primary: SlateCandidate | null;
  backup1: SlateCandidate | null;
  backup2: SlateCandidate | null;
  commercial: SlateCandidate | null;
  technical: SlateCandidate | null;
  totalSlotsFilled: number;
  sendReadySlots: number;
  namedUnverifiedSlots: number;
  llmSlots: 0;
  sourcesUsed: string[];
  eligibilityReport: SlateEligibilityReport;
}

export interface CandidateSlateRow extends SlatePolicyContact {}

function emptySlate(projectId: number, totalRows = 0): CandidateSlate {
  return {
    projectId,
    primary: null,
    backup1: null,
    backup2: null,
    commercial: null,
    technical: null,
    totalSlotsFilled: 0,
    sendReadySlots: 0,
    namedUnverifiedSlots: 0,
    llmSlots: 0,
    sourcesUsed: [],
    eligibilityReport: buildEligibilityReport(totalRows, [], new Set<number>()),
  };
}

function deduplicateRows(rows: CandidateSlateRow[]): CandidateSlateRow[] {
  const byId = new Map<number, CandidateSlateRow>();
  for (const row of rows) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

/** Database-independent slate construction used by generation and tests. */
export function buildCandidateSlateFromRows(
  projectId: number,
  rows: CandidateSlateRow[],
): CandidateSlate {
  const uniqueRows = deduplicateRows(rows);
  const linkedIds = new Set(uniqueRows.map(row => row.id));
  const eligibilityReport = buildEligibilityReport(rows.length, uniqueRows, linkedIds);
  const eligible = uniqueRows.filter(row => evaluateSlateEligibility(row, true).eligible);

  if (eligible.length === 0) {
    return { ...emptySlate(projectId, rows.length), eligibilityReport };
  }

  const ranked = rankSlateContacts(eligible);
  const primaryLane = ranked.filter(contact => contact.roleLane === "primary");
  const commercialLane = ranked.filter(contact => contact.roleLane === "commercial");
  const technicalLane = ranked.filter(contact => contact.roleLane === "technical");

  const primary = primaryLane[0] || ranked[0] || null;
  const usedIds = new Set<number>(primary ? [primary.id] : []);

  const commercial = commercialLane.find(contact => !usedIds.has(contact.id)) || null;
  if (commercial) usedIds.add(commercial.id);

  const technical = technicalLane.find(contact => !usedIds.has(contact.id)) || null;
  if (technical) usedIds.add(technical.id);

  const backups = ranked.filter(contact => !usedIds.has(contact.id));
  const backup1 = backups[0] || null;
  if (backup1) usedIds.add(backup1.id);
  const backup2 = backups.find(contact => !usedIds.has(contact.id)) || null;

  const selected = [primary, backup1, backup2, commercial, technical]
    .filter((contact): contact is SlateCandidate => contact != null);
  const sendReadySlots = selected.filter(
    contact => contact.effectiveTrustTier === "send_ready",
  ).length;
  const namedUnverifiedSlots = selected.length - sendReadySlots;

  return {
    projectId,
    primary,
    backup1,
    backup2,
    commercial,
    technical,
    totalSlotsFilled: selected.length,
    sendReadySlots,
    namedUnverifiedSlots,
    llmSlots: 0,
    sourcesUsed: [...new Set(selected.map(contact => contact.enrichmentSource || "unknown"))],
    eligibilityReport,
  };
}

const candidateSelection = {
  id: contacts.id,
  name: contacts.name,
  title: contacts.title,
  company: contacts.company,
  email: contacts.email,
  linkedin: contacts.linkedin,
  enrichmentSource: contacts.enrichmentSource,
  contactTrustTier: contacts.contactTrustTier,
  confidenceScore: contacts.confidenceScore,
  roleRelevance: contacts.roleRelevance,
  emailVerified: contacts.emailVerified,
  verificationStatus: contacts.verificationStatus,
  rejectionReason: contacts.rejectionReason,
  crmOrphan: contacts.crmOrphan,
};

export async function generateCandidateSlate(projectId: number): Promise<CandidateSlate> {
  const db = await getDb();
  if (!db) return emptySlate(projectId);

  const rows: CandidateSlateRow[] = await db
    .select(candidateSelection)
    .from(contacts)
    .innerJoin(contactProjects, eq(contactProjects.contactId, contacts.id))
    .where(eq(contactProjects.projectId, projectId));

  return buildCandidateSlateFromRows(projectId, rows);
}

function toSnapshot(contact: SlateCandidate, lane: RoleLane): SlotSnapshot {
  return {
    contactId: contact.id,
    name: contact.name,
    title: contact.title,
    company: contact.company,
    email: contact.email,
    linkedin: contact.linkedin,
    enrichmentSource: contact.enrichmentSource || "unknown",
    contactTrustTier: deriveEffectiveSlateTier(contact),
    confidenceScore: contact.confidenceScore || "medium",
    roleRelevance: contact.roleRelevance || "medium",
    roleLane: lane,
  };
}

interface SelectedSlot {
  lane: RoleLane;
  contactId: number;
}

function selectedSlots(slate: CandidateSlate): SelectedSlot[] {
  return [
    slate.primary ? { lane: "primary" as const, contactId: slate.primary.id } : null,
    slate.backup1 ? { lane: "backup" as const, contactId: slate.backup1.id } : null,
    slate.backup2 ? { lane: "backup" as const, contactId: slate.backup2.id } : null,
    slate.commercial ? { lane: "commercial" as const, contactId: slate.commercial.id } : null,
    slate.technical ? { lane: "technical" as const, contactId: slate.technical.id } : null,
  ].filter((slot): slot is SelectedSlot => slot != null);
}

/**
 * Atomically replace a project's slate. The selected contacts are reread inside
 * the transaction so a contact cannot become ineligible between generation and
 * persistence.
 */
export async function saveCandidateSlate(slate: CandidateSlate): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const slots = selectedSlots(slate);
  const selectedIds = slots.map(slot => slot.contactId);
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new Error("Candidate slate contains a duplicate contact assignment.");
  }

  await db.transaction(async tx => {
    const liveRows: CandidateSlateRow[] = selectedIds.length > 0
      ? await tx
          .select(candidateSelection)
          .from(contacts)
          .where(inArray(contacts.id, selectedIds))
      : [];

    const linkRows: Array<{ contactId: number }> = selectedIds.length > 0
      ? await tx
          .select({ contactId: contactProjects.contactId })
          .from(contactProjects)
          .where(
            and(
              eq(contactProjects.projectId, slate.projectId),
              inArray(contactProjects.contactId, selectedIds),
            ),
          )
      : [];

    const linkedIds = new Set(linkRows.map(row => row.contactId));
    const liveMap = new Map(liveRows.map(row => [row.id, row]));
    const rankedLive = new Map(rankSlateContacts(liveRows).map(row => [row.id, row]));

    for (const id of selectedIds) {
      const live = liveMap.get(id);
      if (!live) throw new Error(`Candidate contact ${id} no longer exists.`);
      const eligibility = evaluateSlateEligibility(live, linkedIds.has(id));
      if (!eligibility.eligible) {
        throw new Error(
          `Candidate contact ${id} became ineligible: ${eligibility.reasons.join(",")}`,
        );
      }
    }

    const liveFor = (candidate: SlateCandidate | null): SlateCandidate | null => {
      if (!candidate) return null;
      const current = rankedLive.get(candidate.id);
      if (!current) throw new Error(`Candidate contact ${candidate.id} missing during persistence.`);
      return current;
    };

    const primary = liveFor(slate.primary);
    const backup1 = liveFor(slate.backup1);
    const backup2 = liveFor(slate.backup2);
    const commercial = liveFor(slate.commercial);
    const technical = liveFor(slate.technical);
    const persistedContacts = [primary, backup1, backup2, commercial, technical]
      .filter((contact): contact is SlateCandidate => contact != null);
    const sendReadySlots = persistedContacts.filter(
      contact => contact.effectiveTrustTier === "send_ready",
    ).length;
    const namedUnverifiedSlots = persistedContacts.length - sendReadySlots;

    const values = {
      projectId: slate.projectId,
      primaryContactId: primary?.id || null,
      backup1ContactId: backup1?.id || null,
      backup2ContactId: backup2?.id || null,
      commercialContactId: commercial?.id || null,
      technicalContactId: technical?.id || null,
      primarySnapshot: primary ? toSnapshot(primary, "primary") : null,
      backup1Snapshot: backup1 ? toSnapshot(backup1, "backup") : null,
      backup2Snapshot: backup2 ? toSnapshot(backup2, "backup") : null,
      commercialSnapshot: commercial ? toSnapshot(commercial, "commercial") : null,
      technicalSnapshot: technical ? toSnapshot(technical, "technical") : null,
      totalSlotsFilled: persistedContacts.length,
      sendReadySlots,
      namedUnverifiedSlots,
      llmSlots: 0,
      sourcesUsed: [...new Set(persistedContacts.map(contact => contact.enrichmentSource || "unknown"))],
      generatedAt: new Date(),
      generatedBy: "waterfall_engine" as const,
      isStale: false,
      staleSince: null,
    };

    await tx
      .delete(contactCandidateSlates)
      .where(eq(contactCandidateSlates.projectId, slate.projectId));
    await tx.insert(contactCandidateSlates).values(values);

    const [inserted] = await tx
      .select()
      .from(contactCandidateSlates)
      .where(eq(contactCandidateSlates.projectId, slate.projectId))
      .limit(1);
    if (!inserted) {
      throw new Error(`Persisted slate for project ${slate.projectId} could not be reread.`);
    }

    const validation = validateStoredCandidateSlate(
      inserted as unknown as StoredCandidateSlate,
      liveMap,
      linkedIds,
    );
    if (!validation.valid) {
      throw new Error(
        `Persisted slate failed trust validation: ${validation.issues.map(issue => issue.code).join(",")}`,
      );
    }
  });
}

export interface BatchSlateResult {
  projectId: number;
  projectName: string;
  slate: CandidateSlate;
  status: "generated" | "failed";
  error?: string;
}

export async function generateSlatesForTopProjects(
  projectIds: number[],
): Promise<BatchSlateResult[]> {
  const db = await getDb();
  if (!db) return [];

  const { projects } = await import("../drizzle/schema");
  const projectRows = projectIds.length > 0
    ? await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(inArray(projects.id, projectIds))
    : [];
  const nameMap = new Map(projectRows.map(row => [row.id, row.name || `Project ${row.id}`]));

  const results: BatchSlateResult[] = [];
  for (const projectId of projectIds) {
    try {
      const slate = await generateCandidateSlate(projectId);
      await saveCandidateSlate(slate);
      results.push({
        projectId,
        projectName: nameMap.get(projectId) || `Project ${projectId}`,
        slate,
        status: "generated",
      });
    } catch (error) {
      results.push({
        projectId,
        projectName: nameMap.get(projectId) || `Project ${projectId}`,
        slate: emptySlate(projectId),
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
