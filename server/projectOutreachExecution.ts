import {
  resolveOutreachContext,
  type OutreachContext,
} from "./projectOutreachGuard";

export interface GuardedOutreachIds {
  contactId: number;
  projectId: number;
  businessLineNames?: Record<number, string>;
}

/**
 * The only executor used by project-outreach routes. The operation callback is
 * unreachable until the authoritative persisted-contact guard has succeeded.
 */
export async function executeGuardedProjectOutreach<T>(
  ids: GuardedOutreachIds,
  operation: (context: OutreachContext) => Promise<T> | T,
): Promise<T> {
  const context = await resolveOutreachContext(
    ids.contactId,
    ids.projectId,
    ids.businessLineNames,
  );
  return operation(context);
}
