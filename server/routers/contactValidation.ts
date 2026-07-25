/**
 * Contact Validation Router
 *
 * Candidate-slate reads are side-effect free. Identity acceptance, mailbox
 * verification and hard rejection use an explicit state matrix, and all
 * contact/log/slate invalidation writes occur in one transaction.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  contacts,
  contactValidationActions,
  contactCandidateSlates,
  contactProjects,
  projects,
  type ContactCandidateSlate,
} from "../../drizzle/schema";
import { verifyContactWithHunter, verifyProjectContactsWithHunter } from "../hunterVerification";
import { generateCandidateSlate, saveCandidateSlate, generateSlatesForTopProjects } from "../contactWaterfall";
import {
  CONTACT_VALIDATION_ACTIONS,
  ContactValidationTransitionError,
  deriveContactValidationTransition,
} from "../contactValidationState";
import {
  sanitiseSlateForResponse,
  type SafeSlateResponse,
  type SlateValidationResult,
} from "../contactSlateTrustPolicy";
import {
  invalidateAffectedSlatesInTransaction,
  validateStoredSlatesReadOnly,
} from "../contactSlateTrustDb";

const ValidationActionSchema = z.enum(CONTACT_VALIDATION_ACTIONS);

interface SlateView {
  slate: SafeSlateResponse | null;
  status: "missing" | "current" | "stale" | "invalid";
  validationResult: SlateValidationResult | null;
  hasSlate: boolean;
  slateIsStale: boolean;
  slateIsInvalid: boolean;
  requiresRegeneration: boolean;
}

async function buildSlateViews(
  db: any,
  slates: ContactCandidateSlate[],
): Promise<Map<number, SlateView>> {
  const validated = await validateStoredSlatesReadOnly(db, slates);
  const views = new Map<number, SlateView>();

  for (const slate of slates) {
    const entry = validated.get(slate.id);
    if (!entry) continue;
    const validationResult = entry.validation;
    views.set(slate.projectId, {
      slate: sanitiseSlateForResponse(slate as any, validationResult),
      status: validationResult.status,
      validationResult,
      hasSlate: true,
      slateIsStale: validationResult.status === "stale",
      slateIsInvalid: validationResult.status === "invalid",
      requiresRegeneration: validationResult.status !== "current",
    });
  }
  return views;
}

const missingSlateView: SlateView = {
  slate: null,
  status: "missing",
  validationResult: null,
  hasSlate: false,
  slateIsStale: false,
  slateIsInvalid: false,
  requiresRegeneration: true,
};

export const contactValidationRouter = router({
  submitAction: protectedProcedure
    .input(z.object({
      contactId: z.number().int().positive(),
      projectId: z.number().int().positive().optional(),
      action: ValidationActionSchema,
      note: z.string().max(1024).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const now = new Date();

      try {
        return await db.transaction(async tx => {
          const [contact] = await tx
            .select({
              id: contacts.id,
              email: contacts.email,
              emailVerified: contacts.emailVerified,
              verificationStatus: contacts.verificationStatus,
              contactTrustTier: contacts.contactTrustTier,
              verifiedByUserId: contacts.verifiedByUserId,
              verifiedAt: contacts.verifiedAt,
              rejectionReason: contacts.rejectionReason,
              rejectedByUserId: contacts.rejectedByUserId,
              rejectedAt: contacts.rejectedAt,
            })
            .from(contacts)
            .where(eq(contacts.id, input.contactId))
            .limit(1);
          if (!contact) throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });

          const transition = deriveContactValidationTransition(input.action, contact, {
            userId: ctx.user.id,
            now,
            note: input.note,
          });

          await tx
            .update(contacts)
            .set(transition.update as any)
            .where(eq(contacts.id, input.contactId));

          await tx.insert(contactValidationActions).values({
            contactId: input.contactId,
            projectId: input.projectId || null,
            userId: ctx.user.id,
            userName: ctx.user.name || null,
            action: input.action,
            previousTier: transition.previousTier,
            newTier: transition.newTier,
            note: input.note || null,
            hunterVerified: false,
          });

          const invalidation = await invalidateAffectedSlatesInTransaction(
            tx,
            input.contactId,
            input.projectId,
            now,
          );

          return {
            success: true,
            contactId: input.contactId,
            previousTier: transition.previousTier,
            newTier: transition.newTier,
            promoted: transition.promoted,
            identityAccepted: transition.identityAccepted,
            emailVerifiedByAction: transition.emailVerifiedByAction,
            ...invalidation,
          };
        });
      } catch (error) {
        if (error instanceof ContactValidationTransitionError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        }
        throw error;
      }
    }),

  hunterVerifyContact: adminProcedure
    .input(z.object({
      contactId: z.number().int().positive(),
      projectId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input }) => verifyContactWithHunter(input.contactId, input.projectId)),

  hunterVerifyProject: adminProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      maxContacts: z.number().int().min(1).max(20).default(10),
    }))
    .mutation(async ({ input }) => verifyProjectContactsWithHunter(input.projectId, input.maxContacts)),

  /** Strictly read-only: never generates or persists a slate. */
  getSlate: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [slate] = await db
        .select()
        .from(contactCandidateSlates)
        .where(eq(contactCandidateSlates.projectId, input.projectId))
        .orderBy(desc(contactCandidateSlates.generatedAt))
        .limit(1);
      if (!slate) return missingSlateView;

      const views = await buildSlateViews(db, [slate]);
      return views.get(input.projectId) || missingSlateView;
    }),

  regenerateSlate: adminProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const slate = await generateCandidateSlate(input.projectId);
      await saveCandidateSlate(slate);
      return {
        success: true,
        totalSlotsFilled: slate.totalSlotsFilled,
        sendReadySlots: slate.sendReadySlots,
        namedUnverifiedSlots: slate.namedUnverifiedSlots,
        llmSlots: slate.llmSlots,
        eligibilityReport: slate.eligibilityReport,
      };
    }),

  getTop20HotSlates: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const hotProjects = await db
      .select({
        id: projects.id,
        name: projects.name,
        priority: projects.priority,
        sector: projects.sector,
        owner: projects.owner,
        location: projects.location,
        capexGrade: projects.capexGrade,
        discoveryStatus: projects.discoveryStatus,
      })
      .from(projects)
      .where(and(inArray(projects.priority, ["hot", "warm"]), eq(projects.suppressed, false)))
      .orderBy(desc(projects.priority))
      .limit(20);
    const projectIds = hotProjects.map(project => project.id);
    const slates = projectIds.length > 0
      ? await db.select().from(contactCandidateSlates).where(inArray(contactCandidateSlates.projectId, projectIds))
      : [];
    const views = await buildSlateViews(db, slates);

    return hotProjects.map(project => ({
      projectId: project.id,
      projectName: project.name,
      priority: project.priority,
      sector: project.sector,
      owner: project.owner,
      location: project.location,
      capexGrade: project.capexGrade,
      discoveryStatus: project.discoveryStatus,
      ...(views.get(project.id) || missingSlateView),
    }));
  }),

  getDemotedProjects: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const demotedProjects = await db
      .select({
        id: projects.id,
        name: projects.name,
        priority: projects.priority,
        sector: projects.sector,
        owner: projects.owner,
        location: projects.location,
        capexGrade: projects.capexGrade,
        discoveryStatus: projects.discoveryStatus,
      })
      .from(projects)
      .where(and(
        eq(projects.discoveryStatus, "named_contact_no_email"),
        inArray(projects.priority, ["hot", "warm"]),
        eq(projects.suppressed, false),
      ))
      .orderBy(desc(projects.priority))
      .limit(20);
    const projectIds = demotedProjects.map(project => project.id);
    const slates = projectIds.length > 0
      ? await db.select().from(contactCandidateSlates).where(inArray(contactCandidateSlates.projectId, projectIds))
      : [];
    const views = await buildSlateViews(db, slates);
    const [gateRows] = projectIds.length > 0
      ? await (db as any).execute(
          `SELECT projectId, primaryAcceptable, backupAcceptable, digestSafe, gateSetBy, gateSetAt, gateNote
           FROM projectValidationGates WHERE projectId IN (${projectIds.join(",")})`,
        )
      : [[], null];
    const gateMap = new Map(
      (Array.isArray(gateRows) ? gateRows : []).map((gate: any) => [gate.projectId, gate]),
    );

    return demotedProjects.map(project => {
      const gate: any = gateMap.get(project.id);
      return {
        projectId: project.id,
        projectName: project.name,
        priority: project.priority,
        sector: project.sector,
        owner: project.owner,
        location: project.location,
        capexGrade: project.capexGrade,
        discoveryStatus: project.discoveryStatus,
        isDemoted: true,
        ...(views.get(project.id) || missingSlateView),
        gate: gate ? {
          primaryAcceptable: Boolean(gate.primaryAcceptable),
          backupAcceptable: Boolean(gate.backupAcceptable),
          digestSafe: Boolean(gate.digestSafe),
          gateSetBy: gate.gateSetBy,
          gateSetAt: gate.gateSetAt,
          gateNote: gate.gateNote,
        } : null,
      };
    });
  }),

  // ── Set project-level validation gates ──

  setProjectValidationGates: adminProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      primaryAcceptable: z.boolean(),
      backupAcceptable: z.boolean(),
      digestSafe: z.boolean(),
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      if (input.digestSafe) {
        const [contactRows] = await (db as any).execute(
          `SELECT COUNT(DISTINCT c.id) AS cnt
           FROM contacts c
           INNER JOIN contactProjects cp ON cp.contactId = c.id
           WHERE cp.projectId = ?
             AND c.contactTrustTier = 'send_ready'
             AND c.email IS NOT NULL
             AND TRIM(c.email) <> ''
             AND c.emailVerified = 1
             AND c.verificationStatus = 'verified'
             AND c.rejectionReason IS NULL
             AND COALESCE(c.crmOrphan, 0) = 0`,
          [input.projectId],
        );
        const hasEffectiveSendReady =
          Array.isArray(contactRows) && contactRows[0] && Number(contactRows[0].cnt) > 0;
        if (!hasEffectiveSendReady) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Digest-safe requires at least one project-linked, effectively verified send-ready contact.",
          });
        }
      }

      await (db as any).execute(
        `INSERT INTO projectValidationGates
           (projectId, primaryAcceptable, backupAcceptable, digestSafe, gateSetBy, gateSetAt, gateNote)
         VALUES (?, ?, ?, ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE
           primaryAcceptable = VALUES(primaryAcceptable),
           backupAcceptable = VALUES(backupAcceptable),
           digestSafe = VALUES(digestSafe),
           gateSetBy = VALUES(gateSetBy),
           gateSetAt = VALUES(gateSetAt),
           gateNote = VALUES(gateNote)`,
        [
          input.projectId,
          input.primaryAcceptable ? 1 : 0,
          input.backupAcceptable ? 1 : 0,
          input.digestSafe ? 1 : 0,
          ctx.user.name || ctx.user.openId,
          input.note || null,
        ],
      );

      if (input.digestSafe) {
        await (db as any).execute(
          `UPDATE projects SET discoveryStatus = 'send_ready_contact' WHERE id = ?`,
          [input.projectId],
        );
      }

      return { success: true };
    }),

  // ── Get top-20 hot/warm for second-wave validation ──

  getTop20Scoped: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const scopedProjects = await db
      .select({
        id: projects.id,
        name: projects.name,
        priority: projects.priority,
        sector: projects.sector,
        owner: projects.owner,
        location: projects.location,
        capexGrade: projects.capexGrade,
        discoveryStatus: projects.discoveryStatus,
      })
      .from(projects)
      .where(and(inArray(projects.priority, ["hot", "warm"]), eq(projects.suppressed, false)))
      .orderBy(desc(projects.priority))
      .limit(20);
    const projectIds = scopedProjects.map(project => project.id);
    const slates = projectIds.length > 0
      ? await db.select().from(contactCandidateSlates).where(inArray(contactCandidateSlates.projectId, projectIds))
      : [];
    const views = await buildSlateViews(db, slates);
    const [gateRows] = projectIds.length > 0
      ? await (db as any).execute(
          `SELECT projectId, primaryAcceptable, backupAcceptable, digestSafe, gateSetBy, gateSetAt, gateNote
           FROM projectValidationGates WHERE projectId IN (${projectIds.join(",")})`,
        )
      : [[], null];
    const gateMap = new Map(
      (Array.isArray(gateRows) ? gateRows : []).map((gate: any) => [gate.projectId, gate]),
    );

    return scopedProjects.map(project => {
      const gate: any = gateMap.get(project.id);
      return {
        projectId: project.id,
        projectName: project.name,
        priority: project.priority,
        sector: project.sector,
        owner: project.owner,
        location: project.location,
        capexGrade: project.capexGrade,
        discoveryStatus: project.discoveryStatus,
        isDemoted: false,
        ...(views.get(project.id) || missingSlateView),
        gate: gate ? {
          primaryAcceptable: Boolean(gate.primaryAcceptable),
          backupAcceptable: Boolean(gate.backupAcceptable),
          digestSafe: Boolean(gate.digestSafe),
          gateSetBy: gate.gateSetBy,
          gateSetAt: gate.gateSetAt,
          gateNote: gate.gateNote,
        } : null,
      };
    });
  }),

  // ── Source-level reporting ──

  getSourceReport: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");

    const effectiveSendReadySql = `
      c.contactTrustTier = 'send_ready'
      AND c.email IS NOT NULL
      AND TRIM(c.email) <> ''
      AND c.emailVerified = 1
      AND c.verificationStatus = 'verified'
      AND c.rejectionReason IS NULL
      AND COALESCE(c.crmOrphan, 0) = 0`;

    const [candidateRows] = await (db as any).execute(
      `SELECT c.enrichmentSource AS source,
              COUNT(DISTINCT c.id) AS candidates,
              COUNT(DISTINCT CASE WHEN ${effectiveSendReadySql} THEN c.id END) AS sendReady,
              COUNT(DISTINCT CASE
                WHEN c.contactTrustTier <> 'llm_inferred' AND NOT (${effectiveSendReadySql})
                THEN c.id END) AS namedUnverified,
              COUNT(DISTINCT CASE WHEN c.contactTrustTier = 'llm_inferred' THEN c.id END) AS llmInferred,
              COUNT(DISTINCT CASE
                WHEN c.emailVerified = 1 AND c.verificationStatus = 'verified'
                THEN c.id END) AS emailVerified
       FROM contacts c
       INNER JOIN contactProjects cp ON cp.contactId = c.id
       INNER JOIN projects p ON p.id = cp.projectId
       WHERE p.priority IN ('hot','warm')
         AND p.lifecycleStatus = 'active'
       GROUP BY c.enrichmentSource
       ORDER BY candidates DESC`,
    );

    const [actionRows] = await (db as any).execute(
      `SELECT c.enrichmentSource AS source, va.action, COUNT(*) AS cnt
       FROM contactValidationActions va
       INNER JOIN contacts c ON va.contactId = c.id
       GROUP BY c.enrichmentSource, va.action
       ORDER BY c.enrichmentSource, va.action`,
    );

    const [hunterRows] = await (db as any).execute(
      `SELECT hvl.outcome, COUNT(*) AS cnt, SUM(hvl.tierPromoted) AS promoted
       FROM hunterVerificationLog hvl GROUP BY hvl.outcome`,
    );

    const sourceMap: Record<string, {
      source: string;
      candidates: number;
      sendReady: number;
      namedUnverified: number;
      llmInferred: number;
      emailVerified: number;
      accepted: number;
      rejected: number;
      wrongCompany: number;
      wrongRole: number;
      backupOnly: number;
      promotedToSendReady: number;
    }> = {};

    for (const row of (Array.isArray(candidateRows) ? candidateRows : [])) {
      const source = row.source || "unknown";
      sourceMap[source] = {
        source,
        candidates: Number(row.candidates),
        sendReady: Number(row.sendReady),
        namedUnverified: Number(row.namedUnverified),
        llmInferred: Number(row.llmInferred),
        emailVerified: Number(row.emailVerified),
        accepted: 0,
        rejected: 0,
        wrongCompany: 0,
        wrongRole: 0,
        backupOnly: 0,
        promotedToSendReady: 0,
      };
    }

    for (const row of (Array.isArray(actionRows) ? actionRows : [])) {
      const source = row.source || "unknown";
      if (!sourceMap[source]) continue;
      const count = Number(row.cnt);
      if (row.action === "accept") sourceMap[source].accepted += count;
      else if (row.action === "reject") sourceMap[source].rejected += count;
      else if (row.action === "wrong_company") sourceMap[source].wrongCompany += count;
      else if (row.action === "wrong_role") sourceMap[source].wrongRole += count;
      else if (row.action === "backup_only") sourceMap[source].backupOnly += count;
      else if (row.action === "verify_email") sourceMap[source].promotedToSendReady += count;
    }

    const hunterOutcomes = (Array.isArray(hunterRows) ? hunterRows : []).map((row: any) => ({
      outcome: row.outcome,
      count: Number(row.cnt),
      promoted: Number(row.promoted || 0),
    }));

    return {
      bySource: Object.values(sourceMap),
      hunterOutcomes,
      generatedAt: new Date(),
    };
  }),

  // ── Batch generate slates for scoped projects only (demoted first, then top-20) ──

  generateScopedSlates: adminProcedure
    .input(z.object({
      scope: z.enum(["demoted", "top20"]),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      let projectRows;
      if (input.scope === "demoted") {
        projectRows = await db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(
            and(
              eq(projects.discoveryStatus, "named_contact_no_email"),
              inArray(projects.priority, ["hot", "warm"]),
              eq(projects.suppressed, false)
            )
          )
          .limit(20);
      } else {
        projectRows = await db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(
            and(
              inArray(projects.priority, ["hot", "warm"]),
              eq(projects.suppressed, false)
            )
          )
          .orderBy(desc(projects.priority))
          .limit(20);
      }

      const projectIds = projectRows.map(p => p.id);
      const results = await generateSlatesForTopProjects(projectIds);

      const generated = results.filter(r => r.status === "generated").length;
      const failed = results.filter(r => r.status === "failed").length;

      return {
        success: true,
        scope: input.scope,
        total: results.length,
        generated,
        failed,
        results: results.map(r => ({
          projectId: r.projectId,
          projectName: r.projectName,
          status: r.status,
          totalSlotsFilled: r.slate.totalSlotsFilled,
          sendReadySlots: r.slate.sendReadySlots,
          error: r.error,
        })),
      };
    }),

  // ── Batch generate slates for all top-20 hot projects ──

  generateTop20Slates: adminProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const hotProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            inArray(projects.priority, ["hot", "warm"]),
            eq(projects.suppressed, false)
          )
        )
        .orderBy(desc(projects.priority))
        .limit(20);

      const projectIds = hotProjects.map(p => p.id);
      const results = await generateSlatesForTopProjects(projectIds);

      const generated = results.filter(r => r.status === "generated").length;
      const failed = results.filter(r => r.status === "failed").length;

      return {
        success: true,
        total: results.length,
        generated,
        failed,
        results: results.map(r => ({
          projectId: r.projectId,
          projectName: r.projectName,
          status: r.status,
          totalSlotsFilled: r.slate.totalSlotsFilled,
          sendReadySlots: r.slate.sendReadySlots,
          error: r.error,
        })),
      };
    }),

  // ── Get validation history for a contact ──

  getValidationHistory: protectedProcedure
    .input(z.object({ contactId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      return db
        .select()
        .from(contactValidationActions)
        .where(eq(contactValidationActions.contactId, input.contactId))
        .orderBy(desc(contactValidationActions.createdAt))
        .limit(20);
    }),

  // ── Effective contact and slate trust statistics ──

  getValidateFirstCount: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { count: 0 };
    const [rows] = await (db as any).execute(
      `SELECT COUNT(DISTINCT c.id) AS cnt
       FROM contacts c
       INNER JOIN contactProjects cp ON cp.contactId = c.id
       INNER JOIN projects p ON p.id = cp.projectId
       WHERE c.contactTrustTier <> 'llm_inferred'
         AND NOT (
           c.contactTrustTier = 'send_ready'
           AND c.email IS NOT NULL
           AND TRIM(c.email) <> ''
           AND c.emailVerified = 1
           AND c.verificationStatus = 'verified'
           AND c.rejectionReason IS NULL
         )
         AND c.rejectionReason IS NULL
         AND COALESCE(c.crmOrphan, 0) = 0
         AND p.priority IN ('hot', 'warm')
         AND p.lifecycleStatus = 'active'
         AND p.suppressed = 0`,
    );
    return {
      count: Array.isArray(rows) && rows[0] ? Number(rows[0].cnt || 0) : 0,
    };
  }),

  getValidationStats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");

    const [tierRows] = await (db as any).execute(
      `SELECT
         SUM(CASE WHEN
           contactTrustTier = 'send_ready'
           AND email IS NOT NULL
           AND TRIM(email) <> ''
           AND emailVerified = 1
           AND verificationStatus = 'verified'
           AND rejectionReason IS NULL
           AND COALESCE(crmOrphan, 0) = 0
         THEN 1 ELSE 0 END) AS sendReady,
         SUM(CASE WHEN contactTrustTier = 'llm_inferred' THEN 1 ELSE 0 END) AS llmInferred,
         SUM(CASE WHEN
           contactTrustTier <> 'llm_inferred'
           AND NOT (
             contactTrustTier = 'send_ready'
             AND email IS NOT NULL
             AND TRIM(email) <> ''
             AND emailVerified = 1
             AND verificationStatus = 'verified'
             AND rejectionReason IS NULL
           )
           AND rejectionReason IS NULL
           AND COALESCE(crmOrphan, 0) = 0
         THEN 1 ELSE 0 END) AS namedUnverified,
         SUM(CASE WHEN rejectionReason IS NOT NULL OR COALESCE(crmOrphan, 0) = 1 THEN 1 ELSE 0 END) AS blocked
       FROM contacts`,
    );
    const tierRow = Array.isArray(tierRows) && tierRows[0] ? tierRows[0] : {};
    const tierDistribution: Record<string, number> = {
      send_ready: Number(tierRow.sendReady || 0),
      named_unverified: Number(tierRow.namedUnverified || 0),
      llm_inferred: Number(tierRow.llmInferred || 0),
      blocked: Number(tierRow.blocked || 0),
    };

    const [actionRows] = await (db as any).execute(
      `SELECT action, COUNT(*) AS cnt FROM contactValidationActions
       WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY action`,
    );
    const validationActions30d: Record<string, number> = {};
    for (const row of (Array.isArray(actionRows) ? actionRows : [])) {
      validationActions30d[row.action] = Number(row.cnt);
    }

    const [hunterRows] = await (db as any).execute(
      `SELECT COUNT(*) AS total, SUM(tierPromoted) AS promoted, SUM(contactUpdated) AS updated
       FROM hunterVerificationLog`,
    );
    const hunterStats = Array.isArray(hunterRows) && hunterRows[0]
      ? {
          total: Number(hunterRows[0].total || 0),
          promoted: Number(hunterRows[0].promoted || 0),
          updated: Number(hunterRows[0].updated || 0),
        }
      : { total: 0, promoted: 0, updated: 0 };

    const slates = await db.select().from(contactCandidateSlates);
    const views = await buildSlateViews(db, slates);
    const currentSlates = [...views.values()].filter(view => view.status === "current");
    const slateStats = {
      totalSlates: slates.length,
      currentSlates: currentSlates.length,
      staleSlates: [...views.values()].filter(view => view.status === "stale").length,
      invalidSlates: [...views.values()].filter(view => view.status === "invalid").length,
      totalSendReady: currentSlates.reduce((sum, view) => sum + (view.slate?.sendReadySlots || 0), 0),
      totalNamedUnverified: currentSlates.reduce(
        (sum, view) => sum + (view.slate?.namedUnverifiedSlots || 0),
        0,
      ),
      totalLlm: 0,
    };

    return { tierDistribution, validationActions30d, hunterStats, slateStats };
  }),
  // ── Gate Summary: lightweight endpoint for the This Week banner ──
  // Returns demoted project count, how many are digest-safe, and territory threshold status.
  getGateSummary: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return { demotedTotal: 0, digestSafeCount: 0, remainingToGate: 0, thresholdMet: false, totalDigestSafe: 0, minThreshold: 3 };

      // Count demoted projects (named_contact_no_email, hot/warm)
      const [demotedRows] = await (db as any).execute(
        `SELECT COUNT(*) as cnt
         FROM projects
         WHERE discoveryStatus = 'named_contact_no_email'
           AND priority IN ('hot', 'warm')`
      );
      const demotedTotal = Array.isArray(demotedRows) && demotedRows[0] ? Number(demotedRows[0].cnt || 0) : 0;

      // Count how many of those have digestSafe = true in projectValidationGates
      const [gatedRows] = await (db as any).execute(
        `SELECT COUNT(*) as cnt
         FROM projectValidationGates pvg
         JOIN projects p ON p.id = pvg.projectId
         WHERE pvg.digestSafe = 1
           AND p.discoveryStatus = 'named_contact_no_email'
           AND p.priority IN ('hot', 'warm')`
      );
      const digestSafeCount = Array.isArray(gatedRows) && gatedRows[0] ? Number(gatedRows[0].cnt || 0) : 0;

      // Count total digest-safe projects across all hot/warm (for threshold check)
      const [allGatedRows] = await (db as any).execute(
        `SELECT COUNT(*) as cnt
         FROM projectValidationGates pvg
         JOIN projects p ON p.id = pvg.projectId
         WHERE pvg.digestSafe = 1
           AND p.priority IN ('hot', 'warm')`
      );
      const totalDigestSafe = Array.isArray(allGatedRows) && allGatedRows[0] ? Number(allGatedRows[0].cnt || 0) : 0;

      const MIN_THRESHOLD = 3;
      const thresholdMet = totalDigestSafe >= MIN_THRESHOLD;
      const remainingToGate = Math.max(0, demotedTotal - digestSafeCount);

      return {
        demotedTotal,
        digestSafeCount,
        remainingToGate,
        thresholdMet,
        totalDigestSafe,
        minThreshold: MIN_THRESHOLD,
      };
    }),
});

export type ContactValidationRouter = typeof contactValidationRouter;
