/**
 * Exact-link helpers for the Ryan-facing This Week projection.
 *
 * These helpers intentionally know nothing about project names, owners or
 * company strings. A contact belongs to a project only when the server's
 * contactProjects projection contains that exact positive project ID.
 */
export interface ExactProjectContactProjection {
  linkedProjectIds?: readonly number[] | null;
  outreachEligibleProjectIds?: readonly number[] | null;
}

export function contactsExactlyLinkedToProject<
  T extends ExactProjectContactProjection,
>(contacts: readonly T[], projectId: number): T[] {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return [];

  return contacts.filter(contact =>
    Array.isArray(contact.linkedProjectIds) &&
    contact.linkedProjectIds.some(linkedId =>
      Number.isSafeInteger(linkedId) && linkedId > 0 && linkedId === projectId,
    ),
  );
}

export function isContactOutreachEligibleForProject(
  contact: ExactProjectContactProjection,
  projectId: number,
): boolean {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return false;

  return (
    contactsExactlyLinkedToProject([contact], projectId).length === 1 &&
    Array.isArray(contact.outreachEligibleProjectIds) &&
    contact.outreachEligibleProjectIds.some(eligibleId =>
      Number.isSafeInteger(eligibleId) && eligibleId > 0 && eligibleId === projectId,
    )
  );
}

export function isThisWeekActionReady(project: {
  priority: "hot" | "warm" | "cold";
  contactCTA: { action: string };
}): boolean {
  return (
    (project.priority === "hot" || project.priority === "warm") &&
    project.contactCTA.action === "view_best"
  );
}
