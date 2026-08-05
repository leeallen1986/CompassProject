import {
  evaluateSlateEligibility,
  isEffectivelySendReady,
  type SlatePolicyContact,
} from "./contactSlateTrustPolicy";

export interface ExactContactProjectLink {
  contactId: number;
  projectId: number;
}

export interface OutreachContactProjection {
  /** Exact persisted contactProjects links. Never inferred from names or free text. */
  linkedProjectIds: number[];
  /** Exact links for which the contact satisfies the complete outreach policy. */
  outreachEligibleProjectIds: number[];
}

function addExactLink(
  linksByContact: Map<number, Set<number>>,
  link: ExactContactProjectLink,
): void {
  if (!Number.isSafeInteger(link.contactId) || link.contactId <= 0) return;
  if (!Number.isSafeInteger(link.projectId) || link.projectId <= 0) return;

  const projectIds = linksByContact.get(link.contactId) ?? new Set<number>();
  projectIds.add(link.projectId);
  linksByContact.set(link.contactId, projectIds);
}

/**
 * Add a fail-closed outreach projection to rep-facing contact rows.
 *
 * The client receives IDs only. It does not reinterpret trust labels, merge
 * contacts by name, or infer project links from contact.project/company text.
 */
export function attachOutreachContactProjection<T extends SlatePolicyContact>(
  contacts: readonly T[],
  links: readonly ExactContactProjectLink[],
): Array<T & OutreachContactProjection> {
  const linksByContact = new Map<number, Set<number>>();
  for (const link of links) addExactLink(linksByContact, link);

  return contacts.map(contact => {
    const linkedProjectIds = Array.from(linksByContact.get(contact.id) ?? [])
      .sort((a, b) => a - b);
    const slateEligibility = evaluateSlateEligibility(
      contact,
      linkedProjectIds.length > 0,
    );
    const outreachEligible =
      slateEligibility.eligible && isEffectivelySendReady(contact);

    return {
      ...contact,
      linkedProjectIds,
      outreachEligibleProjectIds: outreachEligible ? linkedProjectIds : [],
    };
  });
}
