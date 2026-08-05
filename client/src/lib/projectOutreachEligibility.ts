/**
 * The server owns the outreach trust policy and projects the exact projects for
 * which each persisted contact is currently send-ready. The client must not
 * reconstruct that policy from display fields such as trust labels or email
 * presence: missing projection data is intentionally treated as ineligible.
 */
export interface ProjectOutreachProjection {
  id?: number | null;
  outreachEligibleProjectIds?: readonly number[] | null;
}

export function isPositivePersistedId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isProjectOutreachEligible(
  contact: ProjectOutreachProjection | null | undefined,
  projectId: number | null | undefined,
): boolean {
  if (!contact || !isPositivePersistedId(contact.id) || !isPositivePersistedId(projectId)) {
    return false;
  }

  return (
    Array.isArray(contact.outreachEligibleProjectIds) &&
    contact.outreachEligibleProjectIds.some(
      eligibleProjectId =>
        isPositivePersistedId(eligibleProjectId) && eligibleProjectId === projectId,
    )
  );
}
