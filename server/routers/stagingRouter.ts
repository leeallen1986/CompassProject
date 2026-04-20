/**
 * stagingRouter.ts
 *
 * tRPC procedures for the Stage 1 pre-waterfall ingestion layer.
 *
 * Procedures:
 *   campaign.stageUpload       — run ingestion pipeline on an uploaded file, persist to staging table
 *   campaign.getStagingBatch   — fetch all rows for a batchId (with review flags)
 *   campaign.updateStagedRow   — update reviewStatus / reviewComment on a single staged row
 *   campaign.commitStagingBatch — promote all approved/clean rows to campaignContacts
 *   campaign.discardStagingBatch — delete all rows for a batchId
 */

import { z } from "zod";
import { campaignProcedure, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  campaignStagedContacts,
  campaignContacts as campaignContactsTable,
} from "../../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  runIngestionPipeline,
  stagedToRawContact,
  type StagedContact,
} from "../ingestionService";
import { importCampaignContacts } from "../campaignService";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getExistingCampaignKeys(campaignId: number): Promise<{
  emails: Set<string>;
  nameCoKeys: Set<string>;
}> {
  const db = await getDb();
  if (!db) return { emails: new Set(), nameCoKeys: new Set() };

  const existing = await db
    .select({
      email: campaignContactsTable.email,
      firstName: campaignContactsTable.firstName,
      lastName: campaignContactsTable.lastName,
      reviewedCompanyName: campaignContactsTable.reviewedCompanyName,
      company: campaignContactsTable.company,
    })
    .from(campaignContactsTable)
    .where(eq(campaignContactsTable.campaignId, campaignId));

  const emails = new Set<string>();
  const nameCoKeys = new Set<string>();

  for (const row of existing) {
    if (row.email) emails.add(row.email.toLowerCase());
    const name = [row.firstName, row.lastName].filter(Boolean).join(" ").toLowerCase().trim();
    const co = (row.reviewedCompanyName || row.company || "").toLowerCase().trim();
    if (name && co) nameCoKeys.add(`name+co:${name}|${co}`);
  }

  return { emails, nameCoKeys };
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export const stagingRouter = {
  /**
   * Run the ingestion pipeline on an uploaded file URL and persist all rows
   * (clean + review_needed) to the campaignStagedContacts staging table.
   * Returns the batchId and a summary.
   */
  stageUpload: campaignProcedure
    .input(
      z.object({
        campaignId: z.number(),
        fileUrl: z.string().url(),
        sheetName: z.string().optional(),
        columnMapping: z
          .object({
            firstName: z.number().optional(),
            lastName: z.number().optional(),
            fullName: z.number().optional(),
            title: z.number().optional(),
            company: z.number().optional(),
            email: z.number().optional(),
            phone: z.number().optional(),
            mobile: z.number().optional(),
            linkedin: z.number().optional(),
            domain: z.number().optional(),
            notes: z.number().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Fetch file
      const response = await fetch(input.fileUrl);
      if (!response.ok) throw new Error("Failed to fetch uploaded file");
      const buffer = Buffer.from(await response.arrayBuffer());

      // Load existing campaign contacts for dedup
      const { emails: existingEmails, nameCoKeys: existingNameCoKeys } =
        await getExistingCampaignKeys(input.campaignId);

      // Run ingestion pipeline
      const result = runIngestionPipeline(buffer, {
        sheetName: input.sheetName,
        columnMapping: input.columnMapping,
        existingEmails,
        existingNameCoKeys,
      });

      if (result.staged.length === 0) {
        return {
          batchId: null,
          fileType: result.fileType,
          totalRows: result.totalRows,
          verifiedContacts: 0,
          enrichableContacts: 0,
          companyTargets: 0,
          reviewRows: 0,
          rejectedRows: result.rejectedRows,
          errors: result.errors,
        };
      }

      const batchId = randomUUID();
      const userId = ctx.user.id;

      // Persist staged rows
      const insertRows = result.staged.map((s: StagedContact) => ({
        campaignId: input.campaignId,
        batchId,
        uploadFileType: s.uploadFileType,
        batchStatus: "pending" as const,
        firstName: s.firstName ?? undefined,
        lastName: s.lastName ?? undefined,
        fullNameRaw: s.fullNameRaw ?? undefined,
        title: s.title ?? undefined,
        titleRaw: s.titleRaw ?? undefined,
        company: s.company ?? undefined,
        companyRaw: s.companyRaw ?? undefined,
        companyCanonical: s.companyCanonical ?? undefined,
        domain: s.domain ?? undefined,
        email: s.email ?? undefined,
        phone: s.phone ?? undefined,
        mobile: s.mobile ?? undefined,
        linkedin: s.linkedin ?? undefined,
        notes: s.notes ?? undefined,
        recordType: s.recordType,
        classification: s.classification,
        reviewFlags: s.reviewFlags,
        rejectionReason: s.rejectionReason ?? undefined,
        duplicateOf: s.duplicateOf ?? undefined,
        jointVentureLabel: s.jointVentureLabel ?? undefined,
        reviewStatus: s.classification === "verified_contact" ? "approved" : "pending",
        sourceRow: s.sourceRow,
        uploadedBy: userId,
      }));

      // Insert in batches of 200 to avoid oversized queries
      const BATCH_SIZE = 200;
      for (let i = 0; i < insertRows.length; i += BATCH_SIZE) {
        await db
          .insert(campaignStagedContacts)
          .values(insertRows.slice(i, i + BATCH_SIZE));
      }

      return {
        batchId,
        fileType: result.fileType,
        totalRows: result.totalRows,
        verifiedContacts: result.verifiedContacts,
        enrichableContacts: result.enrichableContacts,
        companyTargets: result.companyTargets,
        reviewRows: result.reviewRows,
        rejectedRows: result.rejectedRows,
        errors: result.errors,
      };
    }),

  /**
   * Fetch all staged rows for a given batchId.
   */
  getStagingBatch: campaignProcedure
    .input(
      z.object({
        batchId: z.string(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const rows = await db
        .select()
        .from(campaignStagedContacts)
        .where(eq(campaignStagedContacts.batchId, input.batchId))
        .orderBy(campaignStagedContacts.sourceRow);

      return rows;
    }),

  /**
   * Update the reviewStatus and/or reviewComment on a single staged row.
   * Allowed transitions: pending → approved | rejected
   */
  updateStagedRow: campaignProcedure
    .input(
      z.object({
        stagedId: z.number(),
        reviewStatus: z.enum(["approved", "rejected", "pending"]),
        reviewComment: z.string().optional(),
        // Allow overriding normalized fields during review
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        title: z.string().optional(),
        company: z.string().optional(),
        email: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(campaignStagedContacts)
        .set({
          reviewStatus: input.reviewStatus,
          reviewComment: input.reviewComment ?? undefined,
          reviewedBy: ctx.user.id,
          reviewedAt: new Date(),
          ...(input.firstName !== undefined && { firstName: input.firstName }),
          ...(input.lastName !== undefined && { lastName: input.lastName }),
          ...(input.title !== undefined && { title: input.title }),
          ...(input.company !== undefined && { company: input.company }),
          ...(input.email !== undefined && { email: input.email }),
        })
        .where(eq(campaignStagedContacts.id, input.stagedId));

      return { ok: true };
    }),

  /**
   * Commit all approved rows in a batch to campaignContacts.
   * Marks the batch as "committed" and returns the import result.
   */
  commitStagingBatch: campaignProcedure
    .input(
      z.object({
        campaignId: z.number(),
        batchId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Fetch all approved rows
      const approvedRows = await db
        .select()
        .from(campaignStagedContacts)
        .where(
          and(
            eq(campaignStagedContacts.batchId, input.batchId),
            eq(campaignStagedContacts.reviewStatus, "approved")
          )
        );

      if (approvedRows.length === 0) {
        return { imported: 0, excluded: 0, tierBreakdown: {}, errors: [] };
      }

      // Only convert person rows — company_target rows must NOT go to person scoring
      const personRows = approvedRows.filter(row => row.recordType !== "company_target");

      if (personRows.length === 0) {
        return { imported: 0, excluded: 0, tierBreakdown: {}, errors: ["No person rows to commit — all approved rows are company_target"] };
      }

      // Convert to RawContactRow format
      const rawContacts = personRows.map((row) =>
        stagedToRawContact({
          firstName: row.firstName ?? null,
          lastName: row.lastName ?? null,
          fullNameRaw: row.fullNameRaw ?? null,
          title: row.title ?? null,
          titleRaw: row.titleRaw ?? null,
          company: row.company ?? null,
          companyRaw: row.companyRaw ?? null,
          companyCanonical: row.companyCanonical ?? null,
          domain: row.domain ?? null,
          email: row.email ?? null,
          phone: row.phone ?? null,
          mobile: row.mobile ?? null,
          linkedin: row.linkedin ?? null,
          notes: row.notes ?? null,
          recordType: (row.recordType as any) ?? "person",
          classification: (row.classification as any) ?? "verified_contact",
          reviewFlags: (row.reviewFlags as import('../ingestionService').ReviewFlag[]) ?? [],
          rejectionReason: row.rejectionReason ?? null,
          duplicateOf: row.duplicateOf ?? null,
          jointVentureLabel: row.jointVentureLabel ?? null,
          sourceRow: row.sourceRow ?? 0,
          uploadFileType: (row.uploadFileType as any) ?? "unknown",
        })
      );

      // Import into campaignContacts
      const importResult = await importCampaignContacts(
        input.campaignId,
        rawContacts
      );

      // Mark batch as committed
      await db
        .update(campaignStagedContacts)
        .set({ batchStatus: "committed" })
        .where(eq(campaignStagedContacts.batchId, input.batchId));

      return {
        ...importResult,
        errors: [],
      };
    }),

  /**
   * Discard all rows in a batch (soft delete by marking batchStatus = "discarded").
   */
  discardStagingBatch: campaignProcedure
    .input(
      z.object({
        batchId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(campaignStagedContacts)
        .set({ batchStatus: "discarded" })
        .where(eq(campaignStagedContacts.batchId, input.batchId));

      return { ok: true };
    }),
};
