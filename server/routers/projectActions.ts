/**
 * Part D — Action Tracking
 * tRPC router for projectActions: upsert, update outcome, list, manager rollup.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  generateActionId,
  upsertProjectAction,
  updateActionOutcome,
  getActionsForProject,
  getActionsForUser,
  getManagerRollup,
  getLatestActionForProject,
  getAlreadyActiveCooldownProjects,
} from "../db";

// ── Outcome code enum (mirrors schema) ────────────────────────────────────────
const OutcomeCodeEnum = z.enum([
  "not_started",
  "contacted",
  "meeting_booked",
  "proposal_sent",
  "won",
  "lost",
  "deferred",
  "not_relevant",
  "already_active",
  "contact_discovery_needed",
]);

// ── Source context enum (mirrors schema) ──────────────────────────────────────
const SourceContextEnum = z.enum([
  "weekly_email",
  "dashboard",
  "campaign",
  "emarsys_followup",
  "manual",
]);

// ── Product lane enum (mirrors schema) ────────────────────────────────────────
const ProductLaneEnum = z.enum([
  "portable_air",
  "pumps",
  "pal",
  "bess",
  "multi_lane_pt",
]);

export const projectActionsRouter = router({
  /**
   * Upsert an action for the current user + project + current week.
   * Idempotent: calling again in the same week updates the existing record.
   */
  upsertAction: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        contactId: z.number().int().positive().optional(),
        campaignId: z.number().int().positive().optional(),
        sourceContext: SourceContextEnum.optional().default("dashboard"),
        productLane: ProductLaneEnum.optional(),
        recommendedAction: z.string().max(256).optional(),
        outcomeCode: OutcomeCodeEnum.optional().default("not_started"),
        outcomeNotes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const action = await upsertProjectAction({
        userId,
        projectId: input.projectId,
        contactId: input.contactId,
        campaignId: input.campaignId,
        sourceContext: input.sourceContext ?? "dashboard",
        productLane: input.productLane,
        recommendedAction: input.recommendedAction,
        outcomeCode: input.outcomeCode ?? "not_started",
        outcomeNotes: input.outcomeNotes,
      });
      return action;
    }),

  /**
   * Update the outcome of an existing action by actionId.
   * Enforces lifecycle rules (won/lost/not_relevant close the action).
   */
  updateOutcome: protectedProcedure
    .input(
      z.object({
        actionId: z.string().max(64),
        outcomeCode: OutcomeCodeEnum,
        outcomeNotes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateActionOutcome({
        actionId: input.actionId,
        userId: ctx.user.id,
        outcomeCode: input.outcomeCode,
        outcomeNotes: input.outcomeNotes,
      });
      return result;
    }),

  /**
   * One-click outcome update by projectId (upserts if no action exists yet).
   * This is the primary rep-facing mutation — single call from the UI button.
   */
  oneClickUpdate: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        outcomeCode: OutcomeCodeEnum,
        outcomeNotes: z.string().max(2000).optional(),
        contactId: z.number().int().positive().optional(),
        productLane: ProductLaneEnum.optional(),
        sourceContext: SourceContextEnum.optional().default("dashboard"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      // Upsert ensures the action exists, then update outcome
      const action = await upsertProjectAction({
        userId,
        projectId: input.projectId,
        contactId: input.contactId,
        sourceContext: input.sourceContext ?? "dashboard",
        productLane: input.productLane,
        outcomeCode: input.outcomeCode,
        outcomeNotes: input.outcomeNotes,
      });
      return action;
    }),

  /**
   * List all actions for a specific project (visible to all team members).
   */
  getByProject: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return getActionsForProject(input.projectId);
    }),

  /**
   * Get the latest action for a specific project by the current user.
   */
  getLatestForProject: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      return getLatestActionForProject(ctx.user.id, input.projectId);
    }),

  /**
   * List all actions for the current user (their personal action history).
   */
  getMyActions: protectedProcedure
    .input(
      z.object({
        weekKey: z.string().max(8).optional(),
        outcomeCode: OutcomeCodeEnum.optional(),
        limit: z.number().int().min(1).max(200).optional().default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      return getActionsForUser({
        userId: ctx.user.id,
        weekKey: input.weekKey,
        outcomeCode: input.outcomeCode,
        limit: input.limit ?? 50,
      });
    }),

  /**
   * Manager rollup — aggregated action counts for the current week.
   * Visible to admin and manager roles.
   */
  getManagerRollup: protectedProcedure
    .input(
      z.object({
        weekKey: z.string().max(8).optional(), // defaults to current ISO week
      })
    )
    .query(async ({ input }) => {
      return getManagerRollup(input.weekKey);
    }),

  /**
   * Returns projectIds where already_active cooling period is still active.
   * Used by the UI to suppress repeated prompts.
   */
  getAlreadyActiveCooldowns: protectedProcedure
    .input(z.object({ projectIds: z.array(z.number().int().positive()) }))
    .query(async ({ ctx, input }) => {
      return getAlreadyActiveCooldownProjects(ctx.user.id, input.projectIds);
    }),
});
