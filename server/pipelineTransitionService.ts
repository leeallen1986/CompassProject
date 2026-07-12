/**
 * Single source of truth for pipeline stage transitions.
 *
 * Both the legacy project pipeline endpoint and the Full Potential endpoint
 * call this service. Stage updates, pipeline audit rows, and user activity rows
 * are committed atomically.
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  pipelineClaims,
  pipelineActivity,
  userActivity,
} from "../drizzle/schema";
import type {
  InsertPipelineClaim,
  PipelineClaim,
  User,
} from "../drizzle/schema";
import type { PipelineStatus } from "@shared/const";

export interface TransitionPayload {
  claimId: number;
  userId: number;
  callerRole?: User["role"];
  toStatus: PipelineStatus;
  note?: string;

  // Backward-compatible project-claim field.
  estimatedValue?: string;

  contactName?: string;
  contactRole?: string;
  estimatedValueAud?: string;
  quoteValueAud?: string;
  closeDate?: Date;
  nextAction?: string;
  nextActionDate?: Date;
  application?: string;
  commercialHypothesis?: string;
  meetingObjective?: string;
  customerNeed?: string;
  decisionTiming?: string;
  competitivePosition?: string;

  eventType?: string;
  metadataJson?: Record<string, unknown>;
}

/**
 * Strict attributed-opportunity flow used by Full Potential, signal, AI and
 * manual source-neutral opportunities.
 */
export const ALLOWED_TRANSITIONS: Record<
  PipelineStatus,
  readonly PipelineStatus[]
> = {
  identified: ["contacted", "deferred", "not_relevant"],
  contacted: ["meeting_booked", "qualified", "deferred", "not_relevant"],
  meeting_booked: ["qualified", "deferred", "not_relevant"],
  qualified: ["quoted", "lost", "deferred"],
  quoted: ["won", "lost", "deferred"],
  won: [],
  lost: [],
  deferred: ["identified", "contacted"],
  not_relevant: [],
};

/**
 * Compatibility flow for the existing project tracker. The current project UI
 * predates the `qualified` stage and the new qualification-specific fields, so
 * it must remain able to follow its established sequence until that UI is
 * deliberately upgraded.
 */
export const LEGACY_PROJECT_TRANSITIONS: Record<
  PipelineStatus,
  readonly PipelineStatus[]
> = {
  identified: ["contacted", "deferred", "not_relevant"],
  contacted: ["meeting_booked", "quoted", "deferred", "not_relevant"],
  meeting_booked: ["quoted", "deferred", "not_relevant"],
  qualified: ["quoted", "lost", "deferred"],
  quoted: ["won", "lost", "deferred"],
  won: [],
  lost: [],
  deferred: ["identified", "contacted"],
  not_relevant: [],
};

function isLegacyProjectClaim(claim: PipelineClaim): boolean {
  return claim.sourceType === "project" || claim.sourceType === "legacy";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolvedText(
  incoming: string | undefined,
  existing: unknown,
): string {
  return text(incoming !== undefined ? incoming : existing);
}

function requireText(
  value: string,
  field: string,
  status: PipelineStatus,
): void {
  if (!value) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Gate: ${field} required to advance to ${status}`,
    });
  }
}

export function normalizePositiveAud(
  raw: string,
  field: string,
): string {
  const cleaned = raw.trim().replace(/,/g, "");
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(cleaned)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        `Gate: ${field} must be a positive AUD amount ` +
        "with no currency symbols",
    });
  }
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Gate: ${field} must be greater than zero`,
    });
  }
  return numeric.toFixed(2);
}

function validateLegacyProjectGates(
  toStatus: PipelineStatus,
  payload: TransitionPayload,
  existing: PipelineClaim,
): {
  estimatedValueAud?: string;
  quoteValueAud?: string;
} {
  const contactName = resolvedText(
    payload.contactName,
    existing.contactName,
  );
  const contactRole = resolvedText(
    payload.contactRole,
    existing.contactRole,
  );
  const nextAction = resolvedText(
    payload.nextAction,
    existing.nextAction,
  );
  const activityEvidence = text(payload.note);

  let estimatedValueAud: string | undefined;

  switch (toStatus) {
    case "contacted":
      if (!contactName && !contactRole) {
        requireText("", "contactName or contactRole", toStatus);
      }
      requireText(
        activityEvidence,
        "note (activity evidence)",
        toStatus,
      );
      break;

    case "meeting_booked":
      if (!contactName && !contactRole) {
        requireText("", "contactName or contactRole", toStatus);
      }
      if (!payload.nextActionDate) {
        requireText(
          "",
          "nextActionDate (meeting date)",
          toStatus,
        );
      }
      requireText(
        activityEvidence,
        "note (meeting objective)",
        toStatus,
      );
      break;

    case "qualified": {
      const rawValue =
        payload.estimatedValueAud ??
        (
          existing.estimatedValueAud === null
            ? undefined
            : String(existing.estimatedValueAud)
        );
      if (!rawValue) {
        requireText("", "estimatedValueAud", toStatus);
      }
      estimatedValueAud = normalizePositiveAud(
        rawValue as string,
        "estimatedValueAud",
      );
      requireText(nextAction, "nextAction", toStatus);
      if (!payload.nextActionDate) {
        requireText("", "nextActionDate", toStatus);
      }
      break;
    }

    case "quoted": {
      const legacyValue = resolvedText(
        payload.estimatedValue,
        existing.estimatedValue,
      );
      const rawAud =
        payload.estimatedValueAud ??
        (
          existing.estimatedValueAud === null
            ? undefined
            : String(existing.estimatedValueAud)
        );

      if (!legacyValue && !rawAud) {
        requireText(
          "",
          "estimatedValue or estimatedValueAud",
          toStatus,
        );
      }
      if (rawAud) {
        estimatedValueAud = normalizePositiveAud(
          rawAud,
          "estimatedValueAud",
        );
      }

      requireText(nextAction, "nextAction", toStatus);
      if (
        !payload.nextActionDate &&
        !payload.closeDate &&
        !existing.closeDate
      ) {
        requireText(
          "",
          "nextActionDate or closeDate",
          toStatus,
        );
      }
      break;
    }

    case "deferred":
      requireText(
        activityEvidence,
        "note (defer reason)",
        toStatus,
      );
      if (!payload.nextActionDate) {
        requireText(
          "",
          "nextActionDate (re-engagement date)",
          toStatus,
        );
      }
      break;

    case "won":
    case "lost":
    case "not_relevant":
      requireText(
        activityEvidence,
        "note (outcome reason)",
        toStatus,
      );
      break;

    default:
      break;
  }

  return { estimatedValueAud };
}

function validateAttributedGates(
  toStatus: PipelineStatus,
  payload: TransitionPayload,
  existing: PipelineClaim,
): {
  estimatedValueAud?: string;
  quoteValueAud?: string;
} {
  const contactName = resolvedText(
    payload.contactName,
    existing.contactName,
  );
  const contactRole = resolvedText(
    payload.contactRole,
    existing.contactRole,
  );
  const application = resolvedText(
    payload.application,
    existing.application,
  );
  const commercialHypothesis = resolvedText(
    payload.commercialHypothesis,
    existing.commercialHypothesis,
  );
  const meetingObjective = resolvedText(
    payload.meetingObjective,
    existing.meetingObjective,
  );
  const customerNeed = resolvedText(
    payload.customerNeed,
    existing.customerNeed,
  );
  const decisionTiming = resolvedText(
    payload.decisionTiming,
    existing.decisionTiming,
  );
  const competitivePosition = resolvedText(
    payload.competitivePosition,
    existing.competitivePosition,
  );
  const activityEvidence = text(payload.note);

  let estimatedValueAud: string | undefined;
  let quoteValueAud: string | undefined;

  switch (toStatus) {
    case "identified":
      requireText(application, "application", toStatus);
      requireText(
        commercialHypothesis,
        "commercialHypothesis",
        toStatus,
      );
      requireText(
        resolvedText(payload.nextAction, existing.nextAction),
        "nextAction",
        toStatus,
      );
      if (!payload.nextActionDate && !existing.nextActionDate) {
        requireText("", "nextActionDate", toStatus);
      }
      break;

    case "contacted":
      if (!contactName && !contactRole) {
        requireText("", "contactName or contactRole", toStatus);
      }
      requireText(
        activityEvidence,
        "note (activity evidence)",
        toStatus,
      );
      break;

    case "meeting_booked":
      if (!contactName && !contactRole) {
        requireText("", "contactName or contactRole", toStatus);
      }
      if (!payload.nextActionDate) {
        requireText(
          "",
          "nextActionDate (meeting date)",
          toStatus,
        );
      }
      requireText(
        text(payload.meetingObjective) || meetingObjective,
        "meetingObjective",
        toStatus,
      );
      break;

    case "qualified": {
      const rawValue =
        payload.estimatedValueAud ??
        (
          existing.estimatedValueAud === null
            ? undefined
            : String(existing.estimatedValueAud)
        );
      if (!rawValue) {
        requireText("", "estimatedValueAud", toStatus);
      }
      estimatedValueAud = normalizePositiveAud(
        rawValue as string,
        "estimatedValueAud",
      );
      requireText(customerNeed, "customerNeed", toStatus);
      requireText(decisionTiming, "decisionTiming", toStatus);
      requireText(
        competitivePosition,
        "competitivePosition",
        toStatus,
      );
      requireText(
        text(payload.nextAction),
        "nextAction",
        toStatus,
      );
      if (!payload.nextActionDate) {
        requireText("", "nextActionDate", toStatus);
      }
      break;
    }

    case "quoted": {
      if (!payload.quoteValueAud) {
        requireText("", "quoteValueAud", toStatus);
      }
      quoteValueAud = normalizePositiveAud(
        payload.quoteValueAud as string,
        "quoteValueAud",
      );
      if (!payload.closeDate) {
        requireText("", "closeDate", toStatus);
      }
      requireText(
        text(payload.nextAction),
        "nextAction",
        toStatus,
      );
      if (!payload.nextActionDate) {
        requireText("", "nextActionDate", toStatus);
      }
      break;
    }

    case "deferred":
      requireText(
        activityEvidence,
        "note (defer reason)",
        toStatus,
      );
      if (!payload.nextActionDate) {
        requireText(
          "",
          "nextActionDate (re-engagement date)",
          toStatus,
        );
      }
      break;

    case "won":
    case "lost":
    case "not_relevant":
      requireText(
        activityEvidence,
        "note (outcome reason)",
        toStatus,
      );
      break;

    default:
      break;
  }

  return { estimatedValueAud, quoteValueAud };
}

export async function advancePipelineStage(
  payload: TransitionPayload,
): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable",
    });
  }

  await db.transaction(async tx => {
    const [claim] = await tx
      .select()
      .from(pipelineClaims)
      .where(eq(pipelineClaims.id, payload.claimId))
      .limit(1);

    if (!claim) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Claim not found",
      });
    }

    if (
      claim.sourceType === "full_potential" &&
      payload.callerRole === "distributor"
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Distributor accounts cannot access " +
          "Full Potential pipeline claims",
      });
    }

    if (
      claim.userId !== payload.userId &&
      payload.callerRole !== "admin"
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Not your claim",
      });
    }

    const fromStatus = claim.status as PipelineStatus;
    const transitionMatrix = isLegacyProjectClaim(claim)
      ? LEGACY_PROJECT_TRANSITIONS
      : ALLOWED_TRANSITIONS;
    const allowed = transitionMatrix[fromStatus] ?? [];

    if (!allowed.includes(payload.toStatus)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          `Transition from '${fromStatus}' ` +
          `to '${payload.toStatus}' is not allowed`,
      });
    }

    const normalized = isLegacyProjectClaim(claim)
      ? validateLegacyProjectGates(
          payload.toStatus,
          payload,
          claim,
        )
      : validateAttributedGates(
          payload.toStatus,
          payload,
          claim,
        );

    const patch: Partial<InsertPipelineClaim> = {
      status: payload.toStatus,
    };

    if (payload.note !== undefined) {
      patch.notes = payload.note.trim();
    }
    if (payload.estimatedValue !== undefined) {
      patch.estimatedValue = payload.estimatedValue.trim();
    }
    if (payload.contactName !== undefined) {
      patch.contactName = payload.contactName.trim();
    }
    if (payload.contactRole !== undefined) {
      patch.contactRole = payload.contactRole.trim();
    }
    if (payload.application !== undefined) {
      patch.application = payload.application.trim();
    }
    if (payload.commercialHypothesis !== undefined) {
      patch.commercialHypothesis =
        payload.commercialHypothesis.trim();
    }
    if (payload.meetingObjective !== undefined) {
      patch.meetingObjective = payload.meetingObjective.trim();
    }
    if (payload.customerNeed !== undefined) {
      patch.customerNeed = payload.customerNeed.trim();
    }
    if (payload.decisionTiming !== undefined) {
      patch.decisionTiming = payload.decisionTiming.trim();
    }
    if (payload.competitivePosition !== undefined) {
      patch.competitivePosition =
        payload.competitivePosition.trim();
    }
    if (normalized.estimatedValueAud !== undefined) {
      patch.estimatedValueAud =
        normalized.estimatedValueAud;
    }
    if (normalized.quoteValueAud !== undefined) {
      patch.quoteValueAud = normalized.quoteValueAud;
    }
    if (payload.closeDate !== undefined) {
      patch.closeDate = payload.closeDate;
    }
    if (payload.nextAction !== undefined) {
      patch.nextAction = payload.nextAction.trim();
    }
    if (payload.nextActionDate !== undefined) {
      patch.nextActionDate = payload.nextActionDate;
    }
    if (
      payload.toStatus === "qualified" &&
      !claim.qualifiedAt
    ) {
      patch.qualifiedAt = new Date();
    }
    if (
      payload.toStatus === "won" ||
      payload.toStatus === "lost" ||
      payload.toStatus === "not_relevant"
    ) {
      patch.openDedupeKey = null;
    }

    const updateResult = await tx
      .update(pipelineClaims)
      .set(patch)
      .where(
        and(
          eq(pipelineClaims.id, payload.claimId),
          eq(pipelineClaims.status, fromStatus),
        ),
      );

    const affectedRows = Number(
      (
        updateResult[0] as unknown as {
          affectedRows?: number;
        }
      ).affectedRows ?? 0,
    );
    if (affectedRows !== 1) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Claim changed during transition; reload and try again",
      });
    }

    const eventType = payload.eventType ?? "stage_advance";
    await tx.insert(pipelineActivity).values({
      claimId: payload.claimId,
      userId: payload.userId,
      fromStatus,
      toStatus: payload.toStatus,
      note:
        payload.note?.trim() ||
        `Advanced from ${fromStatus} ` +
          `to ${payload.toStatus}`,
      eventType,
      metadataJson: {
        sourceType: claim.sourceType,
        sourceAccountId: claim.sourceAccountId ?? null,
        ...(payload.metadataJson ?? {}),
      },
    });

    const actionType =
      payload.toStatus === "meeting_booked"
        ? "pipeline_meeting_logged"
        : payload.toStatus === "quoted"
          ? "pipeline_quote_uploaded"
          : "pipeline_stage_advanced";

    await tx.insert(userActivity).values({
      userId: payload.userId,
      actionType,
      claimId: payload.claimId,
      projectId: claim.projectId ?? null,
      metadata: {
        fromStatus,
        toStatus: payload.toStatus,
        sourceType: claim.sourceType,
        sourceAccountId:
          claim.sourceAccountId ?? null,
      },
    });
  });
}
