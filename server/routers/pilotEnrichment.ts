/**
 * Pilot Enrichment Router
 *
 * Admin-only tRPC procedures for the controlled pilot-week enrichment workflow.
 * All procedures are gated behind adminProcedure.
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  buildPilotEnrichmentPlan,
  pilotEnrichmentRun,
  PilotEnrichmentPlan,
  PilotEnrichmentRunResult,
} from "../pilotEnrichment";
import { getPilotShortlist, getPilotShortlistCount } from "../db";

export const pilotEnrichmentRouter = router({
  /**
   * Get the current pilot shortlist (same filter as Monday digest).
   * Returns all projects that would be included in the next Monday email.
   */
  getShortlist: adminProcedure
    .input(
      z.object({
        reportId: z.number().int().positive().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const items = await getPilotShortlist(input?.reportId);
      return {
        items,
        total: items.length,
        hotCount: items.filter(i => i.priority === "hot").length,
        warmCount: items.filter(i => i.priority === "warm").length,
        noContactCount: items.filter(i => i.hasNoContacts).length,
        noEmailCount: items.filter(i => !i.hasNoContacts && i.contactsWithEmail === 0).length,
      };
    }),

  /**
   * Get the shortlist count for parity checks.
   */
  getShortlistCount: adminProcedure
    .input(
      z.object({
        reportId: z.number().int().positive().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const count = await getPilotShortlistCount(input?.reportId);
      return { count };
    }),

  /**
   * Build the enrichment plan (dry-run evaluation).
   * Returns which projects are eligible, hard-blocked, soft-skipped,
   * estimated credit usage, and the stop condition result.
   * Does NOT call Apollo or write any data.
   */
  buildPlan: adminProcedure
    .input(
      z.object({
        reportId: z.number().int().positive().optional(),
        creditCap: z.number().int().min(1).max(500).optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const plan = await buildPilotEnrichmentPlan({
        reportId: input?.reportId,
        creditCap: input?.creditCap,
      });
      return plan;
    }),

  /**
   * Run the pilot enrichment in dry-run mode (default).
   * Returns the full run result including per-project outcomes.
   * Set dryRun=false to execute live enrichment (admin confirmation required).
   */
  runEnrichment: adminProcedure
    .input(
      z.object({
        dryRun: z.boolean().default(true),
        reportId: z.number().int().positive().optional(),
        creditCap: z.number().int().min(1).max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await pilotEnrichmentRun({
        dryRun: input.dryRun,
        reportId: input.reportId,
        creditCap: input.creditCap,
        userId: ctx.user.id,
      });
      return result;
    }),
});
