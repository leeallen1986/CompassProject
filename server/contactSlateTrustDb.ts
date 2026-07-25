import { and, eq, inArray, or } from "drizzle-orm";
import {
  contactCandidateSlates,
  contactProjects,
  contacts,
  type ContactCandidateSlate,
} from "../drizzle/schema";
import {
  validateStoredCandidateSlate,
  type SlatePolicyContact,
  type SlateValidationResult,
  type StoredCandidateSlate,
} from "./contactSlateTrustPolicy";

const liveContactSelection = {
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

export interface ValidatedStoredSlate {
  slate: ContactCandidateSlate;
  validation: SlateValidationResult;
}

/** Bulk-load the live contact/link state needed to validate stored slates. */
export async function validateStoredSlatesReadOnly(
  db: any,
  slates: ContactCandidateSlate[],
): Promise<Map<number, ValidatedStoredSlate>> {
  const contactIds = new Set<number>();
  const projectIds = new Set<number>();

  for (const slate of slates) {
    projectIds.add(slate.projectId);
    for (const id of [
      slate.primaryContactId,
      slate.backup1ContactId,
      slate.backup2ContactId,
      slate.commercialContactId,
      slate.technicalContactId,
    ]) {
      if (id != null) contactIds.add(id);
    }
  }

  const contactIdList = [...contactIds];
  const projectIdList = [...projectIds];

  const liveRows: SlatePolicyContact[] = contactIdList.length > 0
    ? await db
        .select(liveContactSelection)
        .from(contacts)
        .where(inArray(contacts.id, contactIdList))
    : [];

  const linkRows: Array<{ contactId: number; projectId: number }> =
    contactIdList.length > 0 && projectIdList.length > 0
      ? await db
          .select({
            contactId: contactProjects.contactId,
            projectId: contactProjects.projectId,
          })
          .from(contactProjects)
          .where(
            and(
              inArray(contactProjects.contactId, contactIdList),
              inArray(contactProjects.projectId, projectIdList),
            ),
          )
      : [];

  const liveMap = new Map(liveRows.map(row => [row.id, row]));
  const linksByProject = new Map<number, Set<number>>();
  for (const link of linkRows) {
    const set = linksByProject.get(link.projectId) || new Set<number>();
    set.add(link.contactId);
    linksByProject.set(link.projectId, set);
  }

  const result = new Map<number, ValidatedStoredSlate>();
  for (const slate of slates) {
    const validation = validateStoredCandidateSlate(
      slate as unknown as StoredCandidateSlate,
      liveMap,
      linksByProject.get(slate.projectId) || new Set<number>(),
    );
    result.set(slate.id, { slate, validation });
  }
  return result;
}

export interface SlateInvalidationResult {
  affectedSlateIds: number[];
  newlyStaleSlateIds: number[];
  alreadyStaleSlateIds: number[];
  affectedProjectIds: number[];
}

/**
 * Identify and invalidate every slate affected by a contact change. This helper
 * must be called inside the same database transaction as the contact/log write.
 */
export async function invalidateAffectedSlatesInTransaction(
  tx: any,
  contactId: number,
  explicitProjectId: number | undefined,
  now: Date,
): Promise<SlateInvalidationResult> {
  const linkedProjects: Array<{ projectId: number }> = await tx
    .select({ projectId: contactProjects.projectId })
    .from(contactProjects)
    .where(eq(contactProjects.contactId, contactId));

  const affectedProjectIds = new Set(linkedProjects.map(row => row.projectId));
  if (explicitProjectId != null) affectedProjectIds.add(explicitProjectId);

  const directReferenceCondition = or(
    eq(contactCandidateSlates.primaryContactId, contactId),
    eq(contactCandidateSlates.backup1ContactId, contactId),
    eq(contactCandidateSlates.backup2ContactId, contactId),
    eq(contactCandidateSlates.commercialContactId, contactId),
    eq(contactCandidateSlates.technicalContactId, contactId),
  );

  const projectIdList = [...affectedProjectIds];
  const whereCondition = projectIdList.length > 0
    ? or(
        directReferenceCondition,
        inArray(contactCandidateSlates.projectId, projectIdList),
      )
    : directReferenceCondition;

  const rows: Array<{ id: number; projectId: number; isStale: boolean | number; staleSince: Date | null }> =
    await tx
      .select({
        id: contactCandidateSlates.id,
        projectId: contactCandidateSlates.projectId,
        isStale: contactCandidateSlates.isStale,
        staleSince: contactCandidateSlates.staleSince,
      })
      .from(contactCandidateSlates)
      .where(whereCondition);

  const deduped = new Map(rows.map(row => [row.id, row]));
  const affectedRows = [...deduped.values()];
  const alreadyStaleSlateIds = affectedRows
    .filter(row => row.isStale === true || row.isStale === 1)
    .map(row => row.id)
    .sort((a, b) => a - b);
  const newlyStaleSlateIds = affectedRows
    .filter(row => row.isStale !== true && row.isStale !== 1)
    .map(row => row.id)
    .sort((a, b) => a - b);

  if (newlyStaleSlateIds.length > 0) {
    await tx
      .update(contactCandidateSlates)
      .set({ isStale: true, staleSince: now })
      .where(
        and(
          inArray(contactCandidateSlates.id, newlyStaleSlateIds),
          eq(contactCandidateSlates.isStale, false),
        ),
      );
  }

  const affectedSlateIds = affectedRows.map(row => row.id).sort((a, b) => a - b);
  if (affectedSlateIds.length > 0) {
    const verificationRows: Array<{ id: number; isStale: boolean | number }> = await tx
      .select({ id: contactCandidateSlates.id, isStale: contactCandidateSlates.isStale })
      .from(contactCandidateSlates)
      .where(inArray(contactCandidateSlates.id, affectedSlateIds));

    const notStale = verificationRows
      .filter(row => row.isStale !== true && row.isStale !== 1)
      .map(row => row.id);
    if (notStale.length > 0 || verificationRows.length !== affectedSlateIds.length) {
      throw new Error(
        `Affected candidate slates were not atomically invalidated: ${notStale.join(",") || "missing rows"}`,
      );
    }
  }

  return {
    affectedSlateIds,
    newlyStaleSlateIds,
    alreadyStaleSlateIds,
    affectedProjectIds: [...new Set(affectedRows.map(row => row.projectId))].sort((a, b) => a - b),
  };
}
