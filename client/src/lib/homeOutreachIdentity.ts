/**
 * Fail-closed identity checks for outreach launched from Home's contacts table.
 *
 * Display-only contact text (name, company, and the legacy `project` column) is
 * deliberately excluded from this module. An outreach context may only be
 * assembled from persisted IDs and the exact contact-project link/eligibility
 * arrays returned by the API.
 */

export interface HomeOutreachContactIdentity {
  id: number;
  email: string | null;
  emailVerified?: boolean | number | null;
  verificationStatus?: string | null;
  contactTrustTier?: string | null;
  rejectionReason?: string | null;
  crmOrphan?: boolean | number | null;
  linkedProjectIds?: number[] | null;
  outreachEligibleProjectIds?: number[] | null;
}

export interface PersistedProjectIdentity {
  id: number;
}

export interface HomeOutreachSelectionIds {
  contactId: number;
  projectId: number;
}

export function isPositivePersistedId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isExplicitlyTrue(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

function isExplicitlyFalse(value: boolean | number | null | undefined): boolean {
  return value === false || value === 0;
}

/**
 * Require the full effective-send-ready contract. Undefined fields are unsafe:
 * older/incomplete API payloads must not regain outreach through UI inference.
 */
export function hasActionableHomeOutreachTrust(contact: HomeOutreachContactIdentity): boolean {
  return (
    isPositivePersistedId(contact.id) &&
    contact.contactTrustTier === "send_ready" &&
    typeof contact.email === "string" &&
    contact.email.trim().length > 0 &&
    isExplicitlyTrue(contact.emailVerified) &&
    contact.verificationStatus === "verified" &&
    contact.rejectionReason === null &&
    isExplicitlyFalse(contact.crmOrphan)
  );
}

/**
 * Resolve projects by exact persisted ID only. A project must be present in
 * both the exact-link list and the server-computed eligibility list, and must
 * also exist in the projects returned to this view.
 */
export function getExactHomeOutreachProjects<
  TProject extends PersistedProjectIdentity,
>(
  contact: HomeOutreachContactIdentity,
  projects: readonly TProject[],
): TProject[] {
  if (!hasActionableHomeOutreachTrust(contact)) return [];
  if (!Array.isArray(contact.linkedProjectIds)) return [];
  if (!Array.isArray(contact.outreachEligibleProjectIds)) return [];

  const linkedProjectIds = new Set(
    contact.linkedProjectIds.filter(isPositivePersistedId),
  );
  const eligibleProjectIds = new Set(
    contact.outreachEligibleProjectIds.filter(isPositivePersistedId),
  );

  const seen = new Set<number>();
  return projects.filter(project => {
    if (!isPositivePersistedId(project.id)) return false;
    if (seen.has(project.id)) return false;
    if (!linkedProjectIds.has(project.id) || !eligibleProjectIds.has(project.id)) {
      return false;
    }
    seen.add(project.id);
    return true;
  });
}

/** Resolve displayable linked projects without treating them as actionable. */
export function getExactLinkedProjects<TProject extends PersistedProjectIdentity>(
  contact: Pick<HomeOutreachContactIdentity, "linkedProjectIds">,
  projects: readonly TProject[],
): TProject[] {
  if (!Array.isArray(contact.linkedProjectIds)) return [];
  const linkedProjectIds = new Set(
    contact.linkedProjectIds.filter(isPositivePersistedId),
  );
  return projects.filter(
    project => isPositivePersistedId(project.id) && linkedProjectIds.has(project.id),
  );
}

/**
 * Re-resolve a stored ID pair against the latest API rows. Keeping snapshots in
 * component state would preserve a revoked trust/link decision across refresh.
 */
export function resolveExactHomeOutreachSelection<
  TContact extends HomeOutreachContactIdentity,
  TProject extends PersistedProjectIdentity,
>(
  selection: HomeOutreachSelectionIds | null,
  contacts: readonly TContact[],
  projects: readonly TProject[],
): { contact: TContact; project: TProject } | null {
  if (
    !selection ||
    !isPositivePersistedId(selection.contactId) ||
    !isPositivePersistedId(selection.projectId)
  ) {
    return null;
  }

  const contact = contacts.find(row => row.id === selection.contactId);
  const project = projects.find(row => row.id === selection.projectId);
  if (!contact || !project) return null;

  return getExactHomeOutreachProjects(contact, projects)
    .some(row => row.id === project.id)
    ? { contact, project }
    : null;
}
