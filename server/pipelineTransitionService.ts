/**
 * pipelineTransitionService.ts — Sprint 2A: Pipeline Attribution Spine
 *
 * Single source of truth for all pipeline stage transitions.
 * Used by BOTH pipeline.updateStatus (project-sourced) and pipeline.advanceStage (FP-sourced).
 * No bypass path exists — all status changes flow through this service.
 *
 * Design decisions:
 *  - Allowed-transition matrix is enforced before gate validation.
 *  - Gate validation checks required fields for each target stage.
 *  - The update, pipelineActivity insert, and userActivity insert are wrapped in a single transaction.
 *  - Caller is responsible for ownership checks before calling this service.
 */

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  pipelineClaims, pipelineActivity,
  userActivity,
} from "../drizzle/schema";
import type { InsertPipelineClaim, PipelineClaim } from "../drizzle/schema";

// ── Types ────────────────────────────────────────────────────────────────────

export type PipelineStatus =
  | "identified"
  | "contacted"
  | "meeting_booked"
  | "qualified"
  | "quoted"
  | "won"
  | "lost"
  | "deferred"
  | "not_relevant";

export interface TransitionPayload {
  /** The claim being advanced */
  claimId: number;
  /** The user performing the transition */
  userId: number;
  /** Target status */
  toStatus: PipelineStatus;
  /** Optional human-readable note */
  note?: string;
  // ── Gate fields (required for specific target stages) ──
  contactName?: string;
  contactRole?: string;
  estimatedValueAud?: string;
  closeDate?: Date;
  nextAction?: string;
  nextActionDate?: Date;
  /** Structured event type for analytics */
  eventType?: string;
  /** Arbitrary JSON metadata */
  metadataJson?: Record<string, unknown>;
}

// ── Allowed-transition matrix ─────────────────────────────────────────────────
/**
 * Maps each source status to the set of valid target statuses.
 * Transitions not listed here are rejected with FORBIDDEN.
 */
const ALLOWED_TRANSITIONS: Record<PipelineStatus, PipelineStatus[]> = {
  identified:    ["contacted", "deferred", "not_relevant"],
  contacted:     ["meeting_booked", "qualified", "deferred", "not_relevant"],
  meeting_booked:["qualified", "deferred", "not_relevant"],
  qualified:     ["quoted", "lost", "deferred"],
  quoted:        ["won", "lost", "deferred"],
  // Terminal states — no forward transitions
  won:           [],
  lost:          [],
  deferred:      ["identified", "contacted"],  // allow re-engagement
  not_relevant:  [],
};

// ── Gate validation ───────────────────────────────────────────────────────────

function assertGates(
  to: PipelineStatus,
  payload: TransitionPayload,
  existing: PipelineClaim
): void {
  const missing = (field: string): never => {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Gate: ${field} required to advance to ${to}`,
    });
  };

  switch (to) {
    case "contacted":
      if (!payload.contactName && !existing.contactName) missing("contactName");
      break;

    case "meeting_booked":
      // Must have a named contact and a next-action date (meeting date)
      if (!payload.contactName && !existing.contactName) missing("contactName");
      if (!payload.nextActionDate && !existing.nextActionDate) missing("nextActionDate (meeting date)");
      break;

    case "qualified":
      if (!payload.estimatedValueAud && !existing.estimatedValueAud) missing("estimatedValueAud");
      if (Number(payload.estimatedValueAud ?? existing.estimatedValueAud ?? "0") <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Gate: estimatedValueAud must be a positive number to advance to qualified" });
      }
      if (!payload.nextAction && !existing.nextAction) missing("nextAction");
      break;

    case "quoted":
      if (!payload.closeDate && !existing.closeDate) missing("closeDate");
      break;

    case "won":
    case "lost":
    case "deferred":
    case "not_relevant":
      // Outcome reason is captured in the note field
      if (!payload.note) missing("note (outcome reason)");
      break;

    default:
      break;
  }
}

// ── Main transition function ──────────────────────────────────────────────────

/**
 * Advance a pipeline claim to a new status.
 *
 * Validates:
 *  1. Claim exists
 *  2. Caller owns the claim (or is admin — caller must pass ownership check before calling)
 *  3. Transition is in the allowed matrix
 *  4. All gate fields are present
 *
 * Then atomically:
 *  - Updates pipelineClaims
 *  - Inserts pipelineActivity row
 *  - Inserts userActivity row
 */
export async function advancePipelineStage(payload: TransitionPayload): Promise<void> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  // ── 1. Load claim ──
  const rows = await db
    .select()
    .from(pipelineClaims)
    .where(eq(pipelineClaims.id, payload.claimId))
    .limit(1);
  if (rows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
  }
  const claim = rows[0];

  // ── 2. Ownership check (caller must validate before calling, but we double-check) ──
  if (claim.userId !== payload.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not your claim" });
  }

  // ── 3. Allowed-transition check ──
  const fromStatus = claim.status as PipelineStatus;
  const allowed = ALLOWED_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(payload.toStatus)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Transition from '${fromStatus}' to '${payload.toStatus}' is not allowed`,
    });
  }

  // ── 4. Gate validation ──
  assertGates(payload.toStatus, payload, claim);

  // ── 5. Build patch ──
  const patch: Partial<InsertPipelineClaim> = { status: payload.toStatus };
  if (payload.contactName !== undefined) patch.contactName = payload.contactName;
  if (payload.contactRole !== undefined) patch.contactRole = payload.contactRole;
  if (payload.estimatedValueAud !== undefined) patch.estimatedValueAud = payload.estimatedValueAud;
  if (payload.closeDate !== undefined) patch.closeDate = payload.closeDate;
  if (payload.nextAction !== undefined) patch.nextAction = payload.nextAction;
  if (payload.nextActionDate !== undefined) patch.nextActionDate = payload.nextActionDate;
  if (payload.toStatus === "qualified") patch.qualifiedAt = new Date();

  // ── 6. Transactional update + audit ──
  await db.transaction(async (tx) => {
    // Update claim
    await tx.update(pipelineClaims).set(patch).where(eq(pipelineClaims.id, payload.claimId));

    // Insert pipeline activity row
    await tx.insert(pipelineActivity).values({
      claimId: payload.claimId,
      userId: payload.userId,
      fromStatus,
      toStatus: payload.toStatus,
      note: payload.note ?? `Advanced from ${fromStatus} to ${payload.toStatus}`,
      eventType: payload.eventType ?? "stage_advance",
      metadataJson: payload.metadataJson ?? null,
    });

    // Insert user activity row
    const actionType =
      payload.toStatus === "meeting_booked" ? "pipeline_meeting_logged" as const
      : payload.toStatus === "quoted"        ? "pipeline_quote_uploaded" as const
      : "pipeline_stage_advanced" as const;

    await tx.insert(userActivity).values({
      userId: payload.userId,
      actionType,
      claimId: payload.claimId,
      projectId: claim.projectId ?? null,
      metadata: {
        fromStatus,
        toStatus: payload.toStatus,
        sourceType: claim.sourceType,
        sourceAccountId: claim.sourceAccountId ?? null,
      },
    });
  });
}
