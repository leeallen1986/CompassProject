/**
 * Contact Validation Router
 *
 * Procedures for the rep/admin validation workflow:
 *   - Accept / Reject / Wrong company / Wrong role / Backup only
 *   - Trust tier promotion (named_unverified → send_ready)
 *   - Hunter fallback verification trigger
 *   - Candidate slate retrieval and generation
 *   - Top-20 hot project slate overview
 */

import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  contacts,
  contactValidationActions,
  contactCandidateSlates,
  contactProjects,
  projects,
} from "../../drizzle/schema";
import { verifyContactWithHunter, verifyProjectContactsWithHunter } from "../hunterVerification";
import { generateCandidateSlate, saveCandidateSlate, generateSlatesForTopProjects } from "../contactWaterfall";

// ── Validation action schema ──

const ValidationActionSchema = z.enum([
  "accept",
  "reject",
  "wrong_company",
  "wrong_role",
  "backup_only",
  "verify_email",
]);

// ── Trust tier promotion rules ──

function deriveTierFromAction(
  action: z.infer<typeof ValidationActionSchema>,
  currentTier: "send_ready" | "named_unverified" | "llm_inferred",
  hasEmail: boolean
): "send_ready" | "named_unverified" | "llm_inferred" {
  // LLM contacts can never be promoted by rep action alone
  if (currentTier === "llm_inferred") return "llm_inferred";

  switch (action) {
    case "accept":
      // Accept promotes to send_ready only if email is present
      return hasEmail ? "send_ready" : "named_unverified";
    case "verify_email":
      return "send_ready";
    case "reject":
    case "wrong_company":
      return "named_unverified"; // keep in DB but demote from primary
    case "wrong_role":
    case "backup_only":
      return "named_unverified";
    default:
      return currentTier;
  }
}

export const contactValidationRouter = router({

  // ── Submit a validation action ──

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

      // Load the contact
      const [contact] = await db
        .select({
          id: contacts.id,
          name: contacts.name,
          email: contacts.email,
          contactTrustTier: contacts.contactTrustTier,
          rejectedByUserId: contacts.rejectedByUserId,
        })
        .from(contacts)
        .where(eq(contacts.id, input.contactId))
        .limit(1);

      if (!contact) throw new Error("Contact not found");

      const previousTier = (contact.contactTrustTier || "named_unverified") as
        "send_ready" | "named_unverified" | "llm_inferred";
      const newTier = deriveTierFromAction(input.action, previousTier, !!contact.email);

      // Apply the tier change to the contact
      const contactUpdate: Record<string, unknown> = {
        contactTrustTier: newTier,
      };

      if (input.action === "accept" || input.action === "verify_email") {
        contactUpdate.verifiedByUserId = ctx.user.id;
        contactUpdate.verifiedAt = new Date();
        if (input.action === "verify_email") {
          contactUpdate.emailVerified = true;
        }
      }

      if (input.action === "reject" || input.action === "wrong_company") {
        contactUpdate.rejectedByUserId = ctx.user.id;
        contactUpdate.rejectedAt = new Date();
        contactUpdate.rejectionReason = input.action === "wrong_company"
          ? "wrong_company"
          : (input.note || "rejected_by_rep");
      }

      await db.update(contacts)
        .set(contactUpdate as any)
        .where(eq(contacts.id, input.contactId));

      // Log the validation action
      await db.insert(contactValidationActions).values({
        contactId: input.contactId,
        projectId: input.projectId || null,
        userId: ctx.user.id,
        userName: ctx.user.name || null,
        action: input.action,
        previousTier,
        newTier,
        note: input.note || null,
        hunterVerified: false,
      });

      // Mark the project's slate as stale if a project is provided
      if (input.projectId) {
        await db.update(contactCandidateSlates)
          .set({ isStale: true, staleSince: new Date() })
          .where(eq(contactCandidateSlates.projectId, input.projectId));
      }

      return {
        success: true,
        contactId: input.contactId,
        previousTier,
        newTier,
        promoted: newTier === "send_ready" && previousTier !== "send_ready",
      };
    }),

  // ── Trigger Hunter verification for a single contact ──

  hunterVerifyContact: adminProcedure
    .input(z.object({
      contactId: z.number().int().positive(),
      projectId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await verifyContactWithHunter(input.contactId, input.projectId);
      return result;
    }),

  // ── Trigger Hunter batch verification for all named_unverified contacts on a project ──

  hunterVerifyProject: adminProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      maxContacts: z.number().int().min(1).max(20).default(10),
    }))
    .mutation(async ({ input }) => {
      const result = await verifyProjectContactsWithHunter(input.projectId, input.maxContacts);
      return result;
    }),

  // ── Get or generate the candidate slate for a project ──

  getSlate: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // Check for existing non-stale slate
      const [existing] = await db
        .select()
        .from(contactCandidateSlates)
        .where(
          and(
            eq(contactCandidateSlates.projectId, input.projectId),
            eq(contactCandidateSlates.isStale, false)
          )
        )
        .limit(1);

      if (existing) return existing;

      // Generate fresh slate
      const slate = await generateCandidateSlate(input.projectId);
      await saveCandidateSlate(slate);

      const [fresh] = await db
        .select()
        .from(contactCandidateSlates)
        .where(eq(contactCandidateSlates.projectId, input.projectId))
        .limit(1);

      return fresh || null;
    }),

  // ── Force regenerate the slate for a project ──

  regenerateSlate: protectedProcedure
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
      };
    }),

  // ── Get top-20 hot/warm projects with slate coverage summary ──

  getTop20HotSlates: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // Get top-20 hot projects ordered by priority, then warm
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
        .where(
          and(
            inArray(projects.priority, ["hot", "warm"]),
            eq(projects.suppressed, false)
          )
        )
        .orderBy(desc(projects.priority))
        .limit(20);

      const projectIds = hotProjects.map(p => p.id);

      // Load existing slates for these projects
      const slates = await db
        .select()
        .from(contactCandidateSlates)
        .where(inArray(contactCandidateSlates.projectId, projectIds));

      const slateMap = new Map(slates.map(s => [s.projectId, s]));

      // Build summary
      return hotProjects.map(p => {
        const slate = slateMap.get(p.id);
        return {
          projectId: p.id,
          projectName: p.name,
          priority: p.priority,
          sector: p.sector,
          owner: p.owner,
          location: p.location,
          capexGrade: p.capexGrade,
          discoveryStatus: p.discoveryStatus,
          slate: slate ? {
            totalSlotsFilled: slate.totalSlotsFilled,
            sendReadySlots: slate.sendReadySlots,
            namedUnverifiedSlots: slate.namedUnverifiedSlots,
            llmSlots: slate.llmSlots,
            sourcesUsed: slate.sourcesUsed,
            isStale: slate.isStale,
            generatedAt: slate.generatedAt,
            primarySnapshot: slate.primarySnapshot,
            commercialSnapshot: slate.commercialSnapshot,
            technicalSnapshot: slate.technicalSnapshot,
          } : null,
          hasSlate: !!slate,
          slateIsStale: slate?.isStale || false,
        };
      });
    }),

  // ── Get the 13 demoted projects (named_contact_no_email, hot/warm) ──

  getDemotedProjects: adminProcedure
    .query(async () => {
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
        .where(
          and(
            eq(projects.discoveryStatus, "named_contact_no_email"),
            inArray(projects.priority, ["hot", "warm"]),
            eq(projects.suppressed, false)
          )
        )
        .orderBy(desc(projects.priority))
        .limit(20);

      const projectIds = demotedProjects.map(p => p.id);
      const slates = projectIds.length > 0
        ? await db.select().from(contactCandidateSlates).where(inArray(contactCandidateSlates.projectId, projectIds))
        : [];
      const slateMap = new Map(slates.map(s => [s.projectId, s]));

      // Also load project-level validation gates
      const [gateRows] = projectIds.length > 0
        ? await (db as any).execute(
            `SELECT projectId, primaryAcceptable, backupAcceptable, digestSafe, gateSetBy, gateSetAt, gateNote
             FROM projectValidationGates
             WHERE projectId IN (${projectIds.join(",")})`
          )
        : [[], null];
      const gateMap = new Map(
        (Array.isArray(gateRows) ? gateRows : []).map((g: any) => [g.projectId, g])
      );

      return demotedProjects.map(p => {
        const slate = slateMap.get(p.id);
        const gate = gateMap.get(p.id);
        return {
          projectId: p.id,
          projectName: p.name,
          priority: p.priority,
          sector: p.sector,
          owner: p.owner,
          location: p.location,
          capexGrade: p.capexGrade,
          discoveryStatus: p.discoveryStatus,
          isDemoted: true,
          slate: slate ? {
            totalSlotsFilled: slate.totalSlotsFilled,
            sendReadySlots: slate.sendReadySlots,
            namedUnverifiedSlots: slate.namedUnverifiedSlots,
            llmSlots: slate.llmSlots,
            sourcesUsed: slate.sourcesUsed,
            isStale: slate.isStale,
            generatedAt: slate.generatedAt,
            primarySnapshot: slate.primarySnapshot,
            commercialSnapshot: slate.commercialSnapshot,
            technicalSnapshot: slate.technicalSnapshot,
          } : null,
          hasSlate: !!slate,
          slateIsStale: slate?.isStale || false,
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
        ]
      );

      // If digestSafe is true, ensure the project's discoveryStatus can be promoted
      // (only if it has at least one send_ready contact)
      if (input.digestSafe) {
        const [contactRows] = await (db as any).execute(
          `SELECT COUNT(*) as cnt FROM contacts
           WHERE projectId = ? AND contactTrustTier = 'send_ready'`,
          [input.projectId]
        );
        const hasVerified = Array.isArray(contactRows) && contactRows[0] && Number(contactRows[0].cnt) > 0;
        if (hasVerified) {
          await (db as any).execute(
            `UPDATE projects SET discoveryStatus = 'send_ready_contact' WHERE id = ?`,
            [input.projectId]
          );
        }
      }

      return { success: true };
    }),

  // ── Get top-20 hot/warm (excluding demoted) for second wave ──

  getTop20Scoped: adminProcedure
    .query(async () => {
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
        .where(
          and(
            inArray(projects.priority, ["hot", "warm"]),
            eq(projects.suppressed, false)
            // Excludes demoted — they appear in the Demoted tab
          )
        )
        .orderBy(desc(projects.priority))
        .limit(20);

      const projectIds = scopedProjects.map(p => p.id);
      const slates = projectIds.length > 0
        ? await db.select().from(contactCandidateSlates).where(inArray(contactCandidateSlates.projectId, projectIds))
        : [];
      const slateMap = new Map(slates.map(s => [s.projectId, s]));

      const [gateRows] = projectIds.length > 0
        ? await (db as any).execute(
            `SELECT projectId, primaryAcceptable, backupAcceptable, digestSafe, gateSetBy, gateSetAt, gateNote
             FROM projectValidationGates
             WHERE projectId IN (${projectIds.join(",")})`
          )
        : [[], null];
      const gateMap = new Map(
        (Array.isArray(gateRows) ? gateRows : []).map((g: any) => [g.projectId, g])
      );

      return scopedProjects.map(p => {
        const slate = slateMap.get(p.id);
        const gate = gateMap.get(p.id);
        return {
          projectId: p.id,
          projectName: p.name,
          priority: p.priority,
          sector: p.sector,
          owner: p.owner,
          location: p.location,
          capexGrade: p.capexGrade,
          discoveryStatus: p.discoveryStatus,
          isDemoted: false,
          slate: slate ? {
            totalSlotsFilled: slate.totalSlotsFilled,
            sendReadySlots: slate.sendReadySlots,
            namedUnverifiedSlots: slate.namedUnverifiedSlots,
            llmSlots: slate.llmSlots,
            sourcesUsed: slate.sourcesUsed,
            isStale: slate.isStale,
            generatedAt: slate.generatedAt,
            primarySnapshot: slate.primarySnapshot,
            commercialSnapshot: slate.commercialSnapshot,
            technicalSnapshot: slate.technicalSnapshot,
          } : null,
          hasSlate: !!slate,
          slateIsStale: slate?.isStale || false,
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

  getSourceReport: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // Candidates by source (all contacts on hot/warm projects)
      const [candidateRows] = await (db as any).execute(
        `SELECT c.enrichmentSource as source,
                COUNT(*) as candidates,
                SUM(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) as sendReady,
                SUM(CASE WHEN c.contactTrustTier = 'named_unverified' THEN 1 ELSE 0 END) as namedUnverified,
                SUM(CASE WHEN c.contactTrustTier = 'llm_inferred' THEN 1 ELSE 0 END) as llmInferred,
                SUM(CASE WHEN c.emailVerified = 1 THEN 1 ELSE 0 END) as emailVerified
         FROM contacts c
         INNER JOIN projects p ON c.projectId = p.id
         WHERE p.priority IN ('hot','warm')
         GROUP BY c.enrichmentSource
         ORDER BY candidates DESC`
      );

      // Accepted / rejected by source from validation actions
      const [actionRows] = await (db as any).execute(
        `SELECT c.enrichmentSource as source,
                va.action,
                COUNT(*) as cnt
         FROM contactValidationActions va
         INNER JOIN contacts c ON va.contactId = c.id
         GROUP BY c.enrichmentSource, va.action
         ORDER BY c.enrichmentSource, va.action`
      );

      // Hunter verification outcomes by source
      const [hunterRows] = await (db as any).execute(
        `SELECT hvl.outcome,
                COUNT(*) as cnt,
                SUM(hvl.tierPromoted) as promoted
         FROM hunterVerificationLog hvl
         GROUP BY hvl.outcome`
      );

      // Build source map
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
        const src = row.source || "unknown";
        sourceMap[src] = {
          source: src,
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
        const src = row.source || "unknown";
        if (!sourceMap[src]) continue;
        const cnt = Number(row.cnt);
        if (row.action === "accept") sourceMap[src].accepted += cnt;
        else if (row.action === "reject") sourceMap[src].rejected += cnt;
        else if (row.action === "wrong_company") sourceMap[src].wrongCompany += cnt;
        else if (row.action === "wrong_role") sourceMap[src].wrongRole += cnt;
        else if (row.action === "backup_only") sourceMap[src].backupOnly += cnt;
      }

      // Promoted = contacts that were accepted and now have send_ready tier
      const [promotedRows] = await (db as any).execute(
        `SELECT c.enrichmentSource as source, COUNT(*) as cnt
         FROM contactValidationActions va
         INNER JOIN contacts c ON va.contactId = c.id
         WHERE va.action = 'accept' AND c.contactTrustTier = 'send_ready'
         GROUP BY c.enrichmentSource`
      );
      for (const row of (Array.isArray(promotedRows) ? promotedRows : [])) {
        const src = row.source || "unknown";
        if (sourceMap[src]) sourceMap[src].promotedToSendReady = Number(row.cnt);
      }

      const hunterOutcomes = (Array.isArray(hunterRows) ? hunterRows : []).map((r: any) => ({
        outcome: r.outcome,
        count: Number(r.cnt),
        promoted: Number(r.promoted || 0),
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

  // ── Get validation stats for admin dashboard ──

  // ── Lightweight count of named_unverified contacts on hot/warm projects (rep-facing) ──
  getValidateFirstCount: protectedProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return { count: 0 };

      const [rows] = await (db as any).execute(
        `SELECT COUNT(DISTINCT c.id) as cnt
         FROM contacts c
         INNER JOIN projects p ON c.projectId = p.id
         WHERE c.contactTrustTier = 'named_unverified'
           AND p.priority IN ('hot', 'warm')
           AND c.linkedToProject = 1`
      );

      const count = Array.isArray(rows) && rows[0] ? Number(rows[0].cnt || 0) : 0;
      return { count };
    }),

  getValidationStats: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // Trust tier distribution
      const [tierRows] = await (db as any).execute(
        `SELECT contactTrustTier, COUNT(*) as cnt
         FROM contacts
         GROUP BY contactTrustTier`
      );

      const tierDist: Record<string, number> = {};
      for (const row of (Array.isArray(tierRows) ? tierRows : [])) {
        tierDist[row.contactTrustTier || "unknown"] = Number(row.cnt);
      }

      // Validation actions in last 30 days
      const [actionRows] = await (db as any).execute(
        `SELECT action, COUNT(*) as cnt
         FROM contactValidationActions
         WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         GROUP BY action`
      );

      const actionDist: Record<string, number> = {};
      for (const row of (Array.isArray(actionRows) ? actionRows : [])) {
        actionDist[row.action] = Number(row.cnt);
      }

      // Hunter verification stats
      const [hunterRows] = await (db as any).execute(
        `SELECT
           COUNT(*) as total,
           SUM(tierPromoted) as promoted,
           SUM(contactUpdated) as updated
         FROM hunterVerificationLog`
      );

      const hunterStats = Array.isArray(hunterRows) && hunterRows[0] ? {
        total: Number(hunterRows[0].total || 0),
        promoted: Number(hunterRows[0].promoted || 0),
        updated: Number(hunterRows[0].updated || 0),
      } : { total: 0, promoted: 0, updated: 0 };

      // Slate coverage
      const [slateRows] = await (db as any).execute(
        `SELECT
           COUNT(*) as totalSlates,
           SUM(sendReadySlots) as totalSendReady,
           SUM(namedUnverifiedSlots) as totalNamedUnverified,
           SUM(llmSlots) as totalLlm,
           SUM(isStale) as staleSlates
         FROM contactCandidateSlates`
      );

      const slateStats = Array.isArray(slateRows) && slateRows[0] ? {
        totalSlates: Number(slateRows[0].totalSlates || 0),
        totalSendReady: Number(slateRows[0].totalSendReady || 0),
        totalNamedUnverified: Number(slateRows[0].totalNamedUnverified || 0),
        totalLlm: Number(slateRows[0].totalLlm || 0),
        staleSlates: Number(slateRows[0].staleSlates || 0),
      } : { totalSlates: 0, totalSendReady: 0, totalNamedUnverified: 0, totalLlm: 0, staleSlates: 0 };

      return {
        tierDistribution: tierDist,
        validationActions30d: actionDist,
        hunterStats,
        slateStats,
      };
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
