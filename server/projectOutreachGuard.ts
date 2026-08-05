/**
 * projectOutreachGuard.ts — Authoritative server-side trust boundary for project outreach
 *
 * This guard is the single authoritative check that MUST execute before any
 * project-outreach operation (generate, save, downloadEml, prepareOpenInEmail,
 * personalise). It:
 *
 * 1. Loads the contact by contactId from the database.
 * 2. Loads the project by projectId from the database.
 * 3. Requires an exact contactProjects row matching both IDs.
 * 4. Calls evaluateSlateEligibility(contact, true).
 * 5. Calls isEffectivelySendReady(contact).
 * 6. Fails if crmOrphan is true, even if a project link exists.
 * 7. Returns canonical contact and project values from the database.
 *
 * The guard NEVER:
 * - Uses contacts.project text field for matching.
 * - Uses fuzzy project-name or company matching.
 * - Accepts client-provided contact/project names or emails.
 * - Includes the recipient email in error messages.
 * - Returns a mailbox address unless eligibility has fully passed.
 */

import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { getDb } from "./db";
import { contacts, projects, contactProjects } from "../drizzle/schema";
import {
  evaluateSlateEligibility,
  isEffectivelySendReady,
  isExplicitlyNotCrmOrphan,
} from "./contactSlateTrustPolicy";

export interface OutreachContext {
  contactId: number;
  contactName: string;
  contactTitle: string;
  contactCompany: string;
  /** Canonical email from the database — only present after full eligibility check */
  contactEmail: string;
  contactRoleBucket: string;
  projectId: number;
  projectName: string;
  projectLocation: string;
  projectValue: string;
  projectSector: string;
  projectStage: string | null;
  projectOverview: string | null;
  equipmentSignals: string[] | null;
  opportunityRoute: string;
  matchedBusinessLines: string[];
}

/**
 * Resolve and validate a project-outreach context from persisted IDs only.
 *
 * Throws a TRPCError (BAD_REQUEST or FORBIDDEN) with a safe user-facing
 * message on any eligibility failure. Never leaks credential material or raw
 * database rows in error messages.
 *
 * @param contactId — must be a positive persisted integer
 * @param projectId — must be a positive persisted integer
 * @param businessLineNames — optional map from BL id to name for string conversion
 */
export async function resolveOutreachContext(
  contactId: number,
  projectId: number,
  businessLineNames?: Record<number, string>,
): Promise<OutreachContext> {
  // 0. Input sanity
  if (!Number.isSafeInteger(contactId) || contactId <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A valid persisted contact is required for outreach.",
    });
  }
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A valid persisted project is required for outreach.",
    });
  }

  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available.",
    });
  }

  // 1. Load contact
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!contact) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Contact not found.",
    });
  }

  // 2. Load project
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Project not found.",
    });
  }

  // 3. Require exact contactProjects link
  const [link] = await db
    .select()
    .from(contactProjects)
    .where(
      and(
        eq(contactProjects.contactId, contactId),
        eq(contactProjects.projectId, projectId),
      ),
    )
    .limit(1);

  if (!link) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This contact is not linked to the selected project.",
    });
  }

  // 4. crmOrphan check (fail-closed, even with a project link)
  if (!isExplicitlyNotCrmOrphan(contact.crmOrphan)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This contact is not eligible for outreach.",
    });
  }

  // 5. Slate eligibility (llm_inferred, rejected, orphan)
  const eligibility = evaluateSlateEligibility(contact, true);
  if (!eligibility.eligible) {
    const reason = eligibility.reasons.includes("llm_inferred")
      ? "AI-inferred contacts are not eligible for outreach. Validate the contact first."
      : eligibility.reasons.includes("rejected")
        ? "This contact has been flagged and is not eligible for outreach."
        : "This contact is not eligible for outreach.";
    throw new TRPCError({ code: "FORBIDDEN", message: reason });
  }

  // 6. Effective send-ready check
  if (!isEffectivelySendReady(contact)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "This contact does not have a verified email address. Validate the contact before sending outreach.",
    });
  }

  // 7. Build and return canonical context
  // Convert matchedBusinessLines (number[]) to string[] using the provided map
  const blIds: number[] = Array.isArray(project.matchedBusinessLines)
    ? (project.matchedBusinessLines as number[])
    : [];
  const matchedBusinessLines: string[] = blIds
    .map((id) => businessLineNames?.[id] ?? String(id))
    .filter(Boolean);

  return {
    contactId: contact.id,
    contactName: contact.name,
    contactTitle: contact.title,
    contactCompany: contact.company,
    contactEmail: contact.email as string,
    contactRoleBucket: contact.roleBucket,
    projectId: project.id,
    projectName: project.name,
    projectLocation: project.location,
    projectValue: project.value,
    projectSector: project.sector,
    projectStage: project.stage ?? null,
    projectOverview: project.overview ?? null,
    equipmentSignals: Array.isArray(project.equipmentSignals)
      ? (project.equipmentSignals as string[])
      : null,
    opportunityRoute: project.opportunityRoute,
    matchedBusinessLines,
  };
}
