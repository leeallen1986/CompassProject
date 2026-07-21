import type { ContactTrustManifestRow } from "./contactTrustReconciliation.shared";

export interface ContactTrustSlateSnapshotReference {
  contactId?: number | null;
}

export interface ContactTrustSlateRecord {
  id: number;
  projectId: number;
  primaryContactId: number | null;
  backup1ContactId: number | null;
  backup2ContactId: number | null;
  commercialContactId: number | null;
  technicalContactId: number | null;
  primarySnapshot?: ContactTrustSlateSnapshotReference | null;
  backup1Snapshot?: ContactTrustSlateSnapshotReference | null;
  backup2Snapshot?: ContactTrustSlateSnapshotReference | null;
  commercialSnapshot?: ContactTrustSlateSnapshotReference | null;
  technicalSnapshot?: ContactTrustSlateSnapshotReference | null;
  isStale: boolean;
}

export interface ContactTrustSlateInvalidationPlan {
  selectedContactIds: number[];
  linkProjectIds: number[];
  matchedSlateIds: number[];
  freshSlateIds: number[];
  alreadyStaleSlateIds: number[];
  matchedProjectIds: number[];
}

function slateContactIds(slate: ContactTrustSlateRecord): number[] {
  return [
    slate.primaryContactId,
    slate.backup1ContactId,
    slate.backup2ContactId,
    slate.commercialContactId,
    slate.technicalContactId,
    slate.primarySnapshot?.contactId,
    slate.backup1Snapshot?.contactId,
    slate.backup2Snapshot?.contactId,
    slate.commercialSnapshot?.contactId,
    slate.technicalSnapshot?.contactId,
  ].filter((value): value is number => Number.isInteger(value) && Number(value) > 0);
}

/**
 * Contact trust changes invalidate every slate that currently references the
 * contact. A newly linked project invalidates that project's slate even when
 * the contact is not yet assigned to a slot, allowing regeneration to include it.
 */
export function buildContactTrustSlateInvalidationPlan(
  slates: readonly ContactTrustSlateRecord[],
  selectedRows: readonly ContactTrustManifestRow[],
): ContactTrustSlateInvalidationPlan {
  const selectedContactIds = Array.from(new Set(
    selectedRows.map(row => row.contactId).filter(id => Number.isInteger(id) && id > 0),
  )).sort((a, b) => a - b);
  const selectedContacts = new Set(selectedContactIds);

  const linkProjectIds = Array.from(new Set(
    selectedRows
      .map(row => row.expectedAfter.linkProjectId)
      .filter((id): id is number => Number.isInteger(id) && Number(id) > 0),
  )).sort((a, b) => a - b);
  const linkedProjects = new Set(linkProjectIds);

  const matched = slates.filter(slate => {
    if (linkedProjects.has(slate.projectId)) return true;
    return slateContactIds(slate).some(contactId => selectedContacts.has(contactId));
  });

  return {
    selectedContactIds,
    linkProjectIds,
    matchedSlateIds: matched.map(slate => slate.id).sort((a, b) => a - b),
    freshSlateIds: matched.filter(slate => !slate.isStale).map(slate => slate.id).sort((a, b) => a - b),
    alreadyStaleSlateIds: matched.filter(slate => slate.isStale).map(slate => slate.id).sort((a, b) => a - b),
    matchedProjectIds: Array.from(new Set(matched.map(slate => slate.projectId))).sort((a, b) => a - b),
  };
}
