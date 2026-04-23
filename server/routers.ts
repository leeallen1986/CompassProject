import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, campaignProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getLatestReport, getAllReports, getReportById, createReport,
  getProjectsByReportId, createProjects, getAllProjects,
  getContactsByReportId, createContacts, getAllContacts,
  getDrillingCampaignsByReportId, createDrillingCampaigns, getAllDrillingCampaigns,
  getAwardedProjectsByReportId, createAwardedProjects, getAllAwardedProjects,
  getProfileByUserId, upsertProfile, completeOnboarding,
  upsertFeedback, getFeedbackByUserAndReport,
  createPipelineClaim, getPipelineClaimById, getPipelineClaimsByUser,
  getPipelineClaimsByProject, getAllPipelineClaims,
  updatePipelineClaim, deletePipelineClaim,
  createPipelineActivityEntry, getActivityByClaimId,
  getEmailDigestPrefs, upsertEmailDigestPrefs,
  updateProjectLifecycle, bulkUpdateProjectLifecycle, markStaleProjects, touchProjectActivity,
  setProjectKeepFlag,
  getActiveProjects,
  verifyContactByUser, rejectContactByUser, getVerificationStats,
  getAllUsers, updateUserCampaignAccess,
  findDuplicateClusters, dismissDuplicateCluster, mergeProjectIntoCanonical, runDuplicateDetectionSweep,
  classifyProject as classifyProjectType, classifyAllProjects as classifyAllProjectTypes, getSuppressionStats,
} from "./db";
import {
  getAllBusinessLines, getActiveBusinessLines, getBusinessLineById,
  createBusinessLine, updateBusinessLine, deleteBusinessLine,
  getAllRssSources, getActiveRssSources,
  createRssSource, updateRssSource, deleteRssSource,
  quarantineRssSource, unquarantineRssSource,
  getRecentArticles, getArticlesByStatus, getArticleStats, getDailyExtractionStats,
  getFeedbackWeightsByUser,
} from "./pipelineDb";
import { harvestAllFeeds, getPipelineStats } from "./rssHarvester";
import { callDataApi } from "./_core/dataApi";
import { runExtractionPipeline } from "./aiExtractor";
import { rankProjectsForUser, updateWeightsFromFeedback, recomputeAllWeights } from "./mlRanker";
import { seedDefaultPipelineData } from "./seedPipeline";
import { runEnrichmentPipeline, getEnrichmentStats, generateAndEnrichContacts, getProjectEnrichmentCache, getUserPreferredRoles } from "./contactEnrichment";
import { runDailyPipeline } from "./dailyPipeline";
import { runWeeklyPipeline } from "./weeklyPipeline";
import { runProjectoryScraper, setProjectoryCookies, getProjectoryCookies } from "./projectoryScraper";
import { ingestProjectoryArticles, proxyFetchUrl } from "./projectoryIngest";
import { runDmirsScraper } from "./dmirsScraper";
import { runAemoScraper } from "./aemoScraper";
import { runGovScraper } from "./govScraper";
import { runAusTenderScraper } from "./austenderScraper";
import { runIcnScraper } from "./icnScraper";
import {
  createInvite, completeRegistration, loginWithEmail,
  generatePasswordReset, resetPassword, getEmailUsers, deleteEmailUser,
  validatePassword,
} from "./emailAuth";
import { notifyOwner } from "./_core/notification";
import { generateOutreachEmail, saveOutreachEmail, getOutreachHistory, getUserOutreachHistory, getContactedContactList, getOutreachLeaderboard } from "./outreachEmail";
import {
  createTemplate, listTemplates, getTemplateById, updateTemplate,
  deleteTemplate, incrementTemplateUsage, personaliseTemplate, getTemplateStats,
} from "./outreachTemplates";
import { sendWeeklyDigests, sendThursdayReminders, sendManagerRollupEmail } from "./emailDigest";
import { generateAndSaveLLMContacts, runLLMFallbackBulk } from "./llmContactFallback";
import { discoverAndSaveStakeholders, runBulkWebDiscovery } from "./webStakeholderDiscovery";
import { searchProjects } from "./aiProjectMatcher";
import { projectActionsRouter } from "./routers/projectActions";
import { accountAttackRouter } from "./routers/accountAttack";
import { accountResearchRouter } from "./routers/accountResearch";
import { pilotEnrichmentRouter } from "./routers/pilotEnrichment";
import {
  apolloPeopleSearch, enrichSingleContact, enrichProjectContacts,
  revealContactEmail, validateApolloApiKey, inferDomain,
  getCreditUsageSummary, logCreditUsage,
  type ApolloEnrichmentResult, type ApolloSearchResult,
} from "./apolloEnrichment";
import {
  checkApolloEligibility, analyzeContactGaps, getBudgetStatus,
  buildGapFillPlan, findEligibleProjects,
} from "./apolloEligibility";
import {
  scoreProject, saveProjectScores, getProjectScores, getProjectScoresBatch,
  scoreAndSaveProjects, getUnscoredProjectIds, SCORING_DIMENSIONS,
  type DimensionScore, type ProjectScores,
} from "./businessLineScoring";
import { getDb } from "./db";
import { projects, contacts, pipelineRuns as pipelineRunsTable, campaignContacts as campaignContactsTable, campaigns as campaignsTable, collateralItems as collateralItemsTable } from "../drizzle/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { enrichProject, enrichUnenrichedProjects, getContractorFrequency, getEnrichmentStats as getProjectoryEnrichmentStats, getSessionStatus as getProjectorySessionStatus } from "./projectoryEnrichment";
import { validateProject as icnValidateProject, validateAllProjects as icnValidateAllProjects } from "./icnEnrichment";
import { scanTargetCompanies, getAsxWatchlist, addToWatchlist, removeFromWatchlist, getRecentAsxFindings } from "./asxMonitor";
import { getSourceMonitoringSummary } from "./sourceMonitoring";
import { getSourceSummary, ALL_SOURCES } from "./sourceConfig";
import {
  runContractorEngine, buildContractorRegistry, detectPairings,
  scoreContractors, detectEmergingPatterns, generateEmergingPatternsSection,
  getContractorLeaderboard, getContractorProfile, getActivePatterns,
} from "./contractorEngine";
import {
  classifyAllProjects, classifyProject, getTierDistribution,
  classifyStage, shouldIncludeInBrief, getTierLabel,
} from "./tierClassification";
import {
  runContractorEnrichmentPass, getEnrichmentPassStats,
  getProjectsMissingContractors, getMissingContractorCount,
} from "./contractorEnrichmentPass";
import {
  classifyAllContactRelevance, getRoleRelevanceDistribution,
  classifySingleContactRelevance, classifyRoleRelevance,
} from "./roleRelevance";
import {
  runBulkSecondPass, getSecondPassGapCount,
  runSecondPassForProject,
} from "./secondPassContactSearch";
import { getThisWeekSummary } from "./thisWeekService";
import {
  trackActivity, getUserActivitySummary, getUserRecentActivity,
  getTeamActivitySummary, getUserEngagementScore,
} from "./userActivityService";
import { generateNBA, generateNBABatch } from "./nextBestAction";
import { getWeeklyCoaching } from "./weeklyCoaching";
import { getWorkingStyleProfile } from "./behaviourAnalysis";
import {
  getPreCallCoaching, getSegmentPainLibrary, getAllSegmentPainLibraries,
  getRolePersona, getAllRolePersonas,
} from "./personaCoaching";
import {
  createCollateralItem, listCollateralItems, getCollateralItemById,
  updateCollateralItem, deleteCollateralItem, matchCollateralToProject,
  getProjectCollateralSuggestions, getCollateralStats, getMatchedProjectIds,
  APPLICATION_TAGS, SECTOR_TAGS, PRODUCT_LINES,
} from "./collateralService";
import {
  createCampaign, getCampaign, listCampaigns, updateCampaign, updateCampaignStatus, deleteCampaign,
  getCampaignContacts, getCampaignContact, getCampaignStats,
  importCampaignContacts, matchContactsToProjects,
  generateCampaignEmail, approveEmail, rejectEmail, updateDraft, sendApprovedEmail, markEmailAsSent,
  enrichCampaignContacts, updateCampaignStats,
} from "./campaignService";
import { parseBlastContactList } from "./campaignImport";
import { previewImportFile, parseImportFile, analyseImportFile, parseCompanyList, type ColumnMapping } from "./campaignCsvImport";
import { stagingRouter } from "./routers/stagingRouter";
import { searchContactsByDomain, searchContactsByCompanyName, getAvailableRoles } from "./hunterContactSearch";
import { startCompanySearch, getCompanySearchProgress } from "./companySearchJob";
import { startEnrichmentJob, getEnrichmentJobProgress } from "./enrichmentJob";
import {
  getCampaignTemplate, upsertCampaignTemplate, deleteCampaignTemplate,
  generateFromTemplate, bulkGenerateFromTemplate, previewTemplateForContact,
  getDefaultTemplate, getSampleContext, renderFullEmail, MERGE_FIELDS,
} from "./templateService";
import { storagePut } from "./storage";
import { buildEmlFile, fetchFileAsBase64, detectBrand } from "./emlGenerator";
import {
  previewEmarsysExport,
  generateEmarsysExport,
  getExportLogs,
  toggleEmarsysApproval,
  type ExportMode,
  type ExportDefaults,
} from "./emarsysExport";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),

    // ── Email/Password Auth ──
    loginWithEmail: publicProcedure
      .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const { user, sessionToken } = await loginWithEmail(input);
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
      }),

    register: publicProcedure
      .input(z.object({ inviteToken: z.string().min(1), password: z.string().min(8) }))
      .mutation(async ({ input, ctx }) => {
        const { user, sessionToken } = await completeRegistration(input);
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
      }),

    resetPassword: publicProcedure
      .input(z.object({ resetToken: z.string().min(1), newPassword: z.string().min(8) }))
      .mutation(async ({ input }) => {
        return resetPassword(input);
      }),

    validateInviteToken: publicProcedure
      .input(z.object({ token: z.string().min(1) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const { users: usersTable } = await import("../drizzle/schema");
        const result = await db.select().from(usersTable)
          .where(eq(usersTable.inviteToken, input.token)).limit(1);
        if (result.length === 0) return { valid: false, email: null, name: null };
        const user = result[0];
        if (user.inviteExpiresAt && new Date() > user.inviteExpiresAt) return { valid: false, email: null, name: null };
        return { valid: true, email: user.email, name: user.name };
      }),
  }),

  // ── Admin User Management ──
  userManagement: router({
    invite: adminProcedure
      .input(z.object({
        email: z.string().email(),
        name: z.string().min(1),
        role: z.enum(["user", "admin", "distributor"]),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createInvite({ ...input, invitedByUserId: ctx.user.id });
        // Build the registration URL
        const origin = ctx.req.headers.origin || ctx.req.headers.referer?.replace(/\/$/, "") || "";
        const registrationUrl = `${origin}/register?token=${result.inviteToken}`;
        return { ...result, registrationUrl };
      }),

    resetPassword: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const result = await generatePasswordReset(input.userId);
        const origin = ctx.req.headers.origin || ctx.req.headers.referer?.replace(/\/$/, "") || "";
        const resetUrl = `${origin}/reset-password?token=${result.resetToken}`;
        return { ...result, resetUrl };
      }),

    listEmailUsers: adminProcedure.query(async () => {
      const emailUsers = await getEmailUsers();
      return emailUsers.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        authMethod: u.authMethod,
        lastSignedIn: u.lastSignedIn,
        createdAt: u.createdAt,
        hasPendingInvite: !!u.inviteToken,
      }));
    }),

    deleteUser: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input }) => {
        await deleteEmailUser(input.userId);
        return { success: true };
      }),

    // ── Campaign Access Management (all users, not just email-auth) ──
    listAllUsers: adminProcedure.query(async () => {
      return getAllUsers();
    }),

    toggleCampaignAccess: adminProcedure
      .input(z.object({ userId: z.number(), campaignAccess: z.boolean() }))
      .mutation(async ({ input }) => {
        return updateUserCampaignAccess(input.userId, input.campaignAccess);
      }),
  }),

  // ── User Profile / Onboarding endpoints ──
  profile: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      return getProfileByUserId(ctx.user.id);
    }),

    update: protectedProcedure
      .input(z.object({
        companyName: z.string().optional(),
        companyWebsite: z.string().optional(),
        territories: z.array(z.string()).optional(),
        remoteMetroOnly: z.string().optional(),
        industries: z.array(z.string()).optional(),
        offerCategories: z.array(z.string()).optional(),
        customerTypes: z.array(z.string()).optional(),
        dealSizeMin: z.string().optional(),
        dealSizeMax: z.string().optional(),
        stageTiming: z.array(z.string()).optional(),
        buyerRoles: z.array(z.string()).optional(),
        keyAccounts: z.array(z.string()).optional(),
        excludeAccounts: z.array(z.string()).optional(),
        assignedBusinessLines: z.array(z.string()).optional(),
        sectorFocus: z.array(z.string()).optional(),
        aiSegments: z.array(z.object({
          name: z.string(),
          description: z.string(),
          expectedLeads: z.number(),
        })).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await upsertProfile(ctx.user.id, input);
        return { success: true };
      }),

    completeOnboarding: protectedProcedure.mutation(async ({ ctx }) => {
      await completeOnboarding(ctx.user.id);
      return { success: true };
    }),
  }),

  // ── Project Feedback endpoints (with ML weight updates) ──
  feedback: router({
    submit: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        reportId: z.number(),
        vote: z.enum(["up", "down"]),
        reason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await upsertFeedback({
          userId: ctx.user.id,
          projectId: input.projectId,
          reportId: input.reportId,
          vote: input.vote,
          reason: input.reason ?? null,
        });

        // Update ML weights from this feedback
        const db = await getDb();
        if (db) {
          const [project] = await db.select().from(projects)
            .where(eq(projects.id, input.projectId)).limit(1);
          if (project) {
            await updateWeightsFromFeedback(ctx.user.id, project, input.vote);
          }
        }

        return { success: true };
      }),

    byReport: protectedProcedure
      .input(z.object({ reportId: z.number() }))
      .query(async ({ ctx, input }) => {
        return getFeedbackByUserAndReport(ctx.user.id, input.reportId);
      }),
  }),

  // ── Pipeline Tracker endpoints ──
  pipeline: router({
    claim: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        reportId: z.number(),
        notes: z.string().optional(),
        estimatedValue: z.string().optional(),
        nextAction: z.string().optional(),
        nextActionDate: z.date().optional(),
        contactName: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const existing = await getPipelineClaimsByProject(input.projectId);
        const userClaim = existing.find(c => c.userId === ctx.user.id);
        if (userClaim) {
          return { claimId: userClaim.id, alreadyClaimed: true };
        }

        const claimId = await createPipelineClaim({
          userId: ctx.user.id,
          projectId: input.projectId,
          reportId: input.reportId,
          status: "identified",
          notes: input.notes ?? null,
          estimatedValue: input.estimatedValue ?? null,
          nextAction: input.nextAction ?? null,
          nextActionDate: input.nextActionDate ?? null,
          contactName: input.contactName ?? null,
        });

        await createPipelineActivityEntry({
          claimId,
          userId: ctx.user.id,
          fromStatus: null,
          toStatus: "identified",
          note: input.notes ?? "Project claimed",
        });

        // Track activity
        await trackActivity(ctx.user.id, "pipeline_claimed", { projectId: input.projectId, claimId, metadata: { reportId: input.reportId } });
        return { claimId, alreadyClaimed: false };
      }),
    updateStatus: protectedProcedure
      .input(z.object({
        claimId: z.number(),
        status: z.enum(["identified", "contacted", "meeting_booked", "quoted", "won", "lost"]),
        notes: z.string().optional(),
        estimatedValue: z.string().optional(),
        nextAction: z.string().optional(),
        nextActionDate: z.date().optional(),
        contactName: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const claim = await getPipelineClaimById(input.claimId);
        if (!claim) throw new Error("Claim not found");
        if (claim.userId !== ctx.user.id) throw new Error("Not your claim");

        const fromStatus = claim.status;

        await updatePipelineClaim(input.claimId, {
          status: input.status,
          notes: input.notes ?? claim.notes,
          estimatedValue: input.estimatedValue ?? claim.estimatedValue,
          nextAction: input.nextAction ?? claim.nextAction,
          nextActionDate: input.nextActionDate ?? claim.nextActionDate,
          contactName: input.contactName ?? claim.contactName,
        });

        await createPipelineActivityEntry({
          claimId: input.claimId,
          userId: ctx.user.id,
          fromStatus,
          toStatus: input.status,
          note: input.notes ?? `Status changed from ${fromStatus} to ${input.status}`,
        });

          if (input.status === "won" || input.status === "lost") {
          await notifyOwner({
            title: `Pipeline: Project ${input.status === "won" ? "Won" : "Lost"}`,
            content: `Claim #${input.claimId} status changed to ${input.status}. ${input.notes || ""}`,
          });
        }
        // Track pipeline status change
        const actionType = input.status === "meeting_booked" ? "pipeline_meeting_logged" as const
          : input.status === "quoted" ? "pipeline_quote_uploaded" as const
          : "pipeline_status_changed" as const;
        await trackActivity(ctx.user.id, actionType, {
          claimId: input.claimId,
          projectId: claim.projectId,
          metadata: { fromStatus, toStatus: input.status },
        });
        return { success: true };
      }),
    release: protectedProcedure
      .input(z.object({ claimId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const claim = await getPipelineClaimById(input.claimId);
        if (!claim) throw new Error("Claim not found");
        if (claim.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new Error("Not authorized to release this claim");
        }

        await deletePipelineClaim(input.claimId);
        return { success: true };
      }),

    mine: protectedProcedure.query(async ({ ctx }) => {
      return getPipelineClaimsByUser(ctx.user.id);
    }),

    byProject: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return getPipelineClaimsByProject(input.projectId);
      }),

    team: protectedProcedure.query(async () => {
      return getAllPipelineClaims();
    }),

    activity: protectedProcedure
      .input(z.object({ claimId: z.number() }))
      .query(async ({ input }) => {
        return getActivityByClaimId(input.claimId);
      }),
  }),

  // ── Project Lifecycle endpoints ──
  projectLifecycle: router({
    /** Update a single project's lifecycle status */
    update: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        status: z.enum(["active", "stale", "archived", "awarded", "completed"]),
      }))
      .mutation(async ({ ctx, input }) => {
        await updateProjectLifecycle(input.projectId, input.status, ctx.user.id);
        return { success: true };
      }),

    /** Bulk update lifecycle status for multiple projects */
    bulkUpdate: protectedProcedure
      .input(z.object({
        projectIds: z.array(z.number()).min(1).max(500),
        status: z.enum(["active", "stale", "archived", "awarded", "completed"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const count = await bulkUpdateProjectLifecycle(input.projectIds, input.status, ctx.user.id);
        return { success: true, count };
      }),

    /** Run staleness check (admin only) — marks old untouched projects as stale */
    markStale: adminProcedure.mutation(async () => {
      const result = await markStaleProjects();
      return { success: true, staleCount: result.staled, archived: result.archived };
    }),

    /** Touch a project to keep it active (called on view/interact) */
    touch: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .mutation(async ({ input }) => {
        await touchProjectActivity(input.projectId);
        return { success: true };
      }),

    /** Stage 5A: Set or clear the keepFlag for a project (any authenticated user can pin their own projects) */
    setKeepFlag: protectedProcedure
      .input(z.object({ projectId: z.number(), keep: z.boolean() }))
      .mutation(async ({ input }) => {
        await setProjectKeepFlag(input.projectId, input.keep);
        return { success: true };
      }),

    /** Get lifecycle summary counts */
    summary: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { active: 0, stale: 0, archived: 0, awarded: 0, completed: 0 };

      const result = await db.select({
        status: projects.lifecycleStatus,
        count: sql<number>`COUNT(*)`,
      }).from(projects).groupBy(projects.lifecycleStatus);

      const counts: Record<string, number> = { active: 0, stale: 0, archived: 0, awarded: 0, completed: 0 };
      for (const row of result) {
        const key = row.status ?? "active";
        counts[key] = Number(row.count);
      }
      return counts;
    }),
  }),

  // ── Crowdsourced Contact Verification endpoints ──
  contactVerification: router({
    /** Sales rep confirms a contact is correct (one-click verify) */
    verify: protectedProcedure
      .input(z.object({
        contactId: z.number(),
        linkedinUrl: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await verifyContactByUser(input.contactId, ctx.user.id, input.linkedinUrl);
        return { success: true, message: "Contact verified. Thank you for helping improve data quality!" };
      }),

    /** Sales rep marks a contact as incorrect/outdated */
    reject: protectedProcedure
      .input(z.object({
        contactId: z.number(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await rejectContactByUser(input.contactId, ctx.user.id, input.reason);
        return { success: true, message: "Contact flagged as incorrect. It will be deprioritized in results." };
      }),

    /** Get verification stats for admin dashboard */
    stats: protectedProcedure.query(async () => {
      return getVerificationStats();
    }),
  }),

  // ── Email Digest Preferences endpoints ──
  emailDigest: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      return getEmailDigestPrefs(ctx.user.id);
    }),

    update: protectedProcedure
      .input(z.object({
        enabled: z.boolean().optional(),
        frequency: z.enum(["weekly", "fortnightly", "daily", "none"]).optional(),
        includeHotOnly: z.boolean().optional(),
        includeContacts: z.boolean().optional(),
        includePipelineUpdates: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await upsertEmailDigestPrefs(ctx.user.id, input);
        return { success: true };
      }),
  }),

  // ── Admin Digest Trigger ──
  digest: router({
    /** Send Monday digest now — respects per-user weekly dedup guard */
    sendNow: adminProcedure.mutation(async () => {
      const results = await sendWeeklyDigests(false);
      return results;
    }),

    /** Force-send Monday digest — bypasses dedup (use with caution, e.g. after content fix) */
    forceSendNow: adminProcedure.mutation(async () => {
      const results = await sendWeeklyDigests(true);
      return results;
    }),

    /** Send Thursday reminder now — respects per-user weekly dedup guard */
    sendThursdayNow: adminProcedure.mutation(async () => {
      return sendThursdayReminders(false);
    }),

    /** Send manager rollup now — respects per-user weekly dedup guard */
    sendManagerRollupNow: adminProcedure.mutation(async () => {
      return sendManagerRollupEmail(false);
    }),

    /** Preview Monday digest for a specific user (dry-run, no send) */
    previewMonday: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input }) => {
        // Run a targeted dry-run for the specific user only
        const { sendWeeklyDigestsForUser } = await import("./emailDigest");
        return sendWeeklyDigestsForUser(input.userId);
      }),

    /** Preview Thursday reminder for a specific user (dry-run, no send) */
    previewThursday: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input }) => {
        const { sendThursdayReminderForUser } = await import("./emailDigest");
        return sendThursdayReminderForUser(input.userId);
      }),

    /** Preview manager rollup (dry-run, no send) */
    previewManagerRollup: adminProcedure
      .mutation(async () => {
        return sendManagerRollupEmail(false, true);
      }),

    /** List all configured manager rollup recipients */
    listRollupRecipients: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const { managerRollupRecipients, users: usersTable } = await import("../drizzle/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      const rows = await db.select().from(managerRollupRecipients);
      // Enrich with user info
      const enriched = await Promise.all(rows.map(async (row) => {
        const [user] = await db.select().from(usersTable).where(eqOp(usersTable.id, row.userId));
        return { ...row, userName: user?.name ?? null, userEmail: user?.email ?? null };
      }));
      return enriched;
    }),

    /** Add a user to the manager rollup recipient list */
    addRollupRecipient: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        const { managerRollupRecipients } = await import("../drizzle/schema");
        await db.insert(managerRollupRecipients).values({ userId: input.userId, addedBy: ctx.user.id });
        return { success: true };
      }),

    /** Remove a user from the manager rollup recipient list */
    removeRollupRecipient: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        const { managerRollupRecipients } = await import("../drizzle/schema");
        const { eq: eqOp } = await import("drizzle-orm");
        await db.delete(managerRollupRecipients).where(eqOp(managerRollupRecipients.userId, input.userId));
        return { success: true };
      }),

    /** List all users (for recipient picker) */
    listAllUsers: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const { users: usersTable } = await import("../drizzle/schema");
      return db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role }).from(usersTable);
    }),
  }),

  // ── AI Project Search / Matching ──
  search: router({
    projects: protectedProcedure
      .input(z.object({ query: z.string().min(2).max(200) }))
      .mutation(async ({ ctx, input }) => {
        // Track search activity
        await trackActivity(ctx.user.id, "search_performed", { metadata: { query: input.query } });
        return searchProjects(input.query, ctx.user.id);
      }),
  }),

  // ── ML-Ranked Intelligence Report endpoints ──
  report: router({
    latest: protectedProcedure.query(async () => {
      return getLatestReport();
    }),

    list: protectedProcedure.query(async () => {
      return getAllReports();
    }),

    byId: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getReportById(input.id);
      }),

    full: protectedProcedure
      .input(z.object({
        reportId: z.number().optional(),
        // Stage 5A: default to 'active' — stale projects are hidden from the default view
        lifecycleFilter: z.enum(["all", "active", "stale", "archived", "awarded", "completed"]).optional().default("active"),
        // Stage 5D: default false — suppressed projects (macro items, background accounts, completed) are hidden
        includeSuppressed: z.boolean().optional().default(false),
      }))
      .query(async ({ ctx, input }) => {
        // Always fetch ALL projects across all reports for the unified dashboard
        const [projectsList, contactsList, drillingList, awardedList] = await Promise.all([
          getAllProjects(),
          getAllContacts(),
          getAllDrillingCampaigns(),
          getAllAwardedProjects(),
        ]);

        // Compute lifecycle counts from full list (before filtering)
        const lifecycleCounts: Record<string, number> = { active: 0, stale: 0, archived: 0, awarded: 0, completed: 0 };
        for (const p of projectsList) {
          const status = p.lifecycleStatus ?? "active";
          lifecycleCounts[status] = (lifecycleCounts[status] || 0) + 1;
        }

        // Apply lifecycle filter
        const filteredByLifecycle = input.lifecycleFilter === "all"
          ? projectsList
          : projectsList.filter(p => (p.lifecycleStatus ?? "active") === input.lifecycleFilter);

        // Stage 5D: Apply suppression filter — hide macro items, background accounts, and completed projects
        // from the default rep view unless admin explicitly requests them
        const filteredProjects = input.includeSuppressed
          ? filteredByLifecycle
          : filteredByLifecycle.filter(p => !p.suppressed);

        // Get the latest report for metadata (executive summary, etc.)
        const report = input.reportId
          ? await getReportById(input.reportId)
          : await getLatestReport();

        // Build aggregate stats from filtered data (after suppression)
        const hot = filteredProjects.filter(p => p.priority === "hot").length;
        const warm = filteredProjects.filter(p => p.priority === "warm").length;
        const cold = filteredProjects.filter(p => p.priority === "cold").length;

        const aggregateReport = report ? {
          ...report,
          totalProjects: filteredProjects.length,
          hotProjects: hot,
          warmProjects: warm,
          coldProjects: cold,
          totalContacts: contactsList.length,
        } : {
          id: 0,
          weekEnding: new Date().toISOString().slice(0, 10),
          generatedTime: new Date().toISOString(),
          totalProjects: filteredProjects.length,
          hotProjects: hot,
          warmProjects: warm,
          coldProjects: cold,
          confirmedContractors: 0,
          predictedContractors: 0,
          capexOpportunities: 0,
          totalContacts: contactsList.length,
          sourcesSearched: "Multi-Source Pipeline",
          newProjectsCount: 0,
          executiveSummaryMain: "Unified dashboard showing all projects from RSS feeds, Projectory, and DMIRS sources.",
          executiveSummaryChanges: null,
          actionItems: null,
          researchPasses: null,
          sourceCategories: null,
        };

        // Apply ML ranking if user is authenticated
        let rankedProjects = filteredProjects;
        let rankings: Awaited<ReturnType<typeof rankProjectsForUser>> | null = null;
        if (ctx.user) {
          rankings = await rankProjectsForUser(ctx.user.id, filteredProjects);
          rankedProjects = rankings.map(r => r.project);
        }

        return {
          report: aggregateReport,
          projects: rankedProjects,
          lifecycleCounts,
          contacts: contactsList,
          drillingCampaigns: drillingList,
          awardedProjects: awardedList,
          rankings: rankings ? rankings.map(r => ({
            projectId: r.project.id,
            relevanceScore: r.relevanceScore,
            profileMatch: r.profileMatch,
            feedbackBoost: r.feedbackBoost,
            matchDetails: r.matchDetails,
          })) : null,
        };
      }),

    create: adminProcedure
      .input(z.object({
        report: z.object({
          weekEnding: z.string(),
          generatedTime: z.string(),
          totalProjects: z.number(),
          hotProjects: z.number(),
          warmProjects: z.number(),
          coldProjects: z.number(),
          confirmedContractors: z.number(),
          predictedContractors: z.number(),
          capexOpportunities: z.number(),
          totalContacts: z.number(),
          sourcesSearched: z.string(),
          newProjectsCount: z.number(),
          executiveSummaryMain: z.string().optional(),
          executiveSummaryChanges: z.string().optional(),
          actionItems: z.array(z.string()).optional(),
          researchPasses: z.array(z.object({
            pass: z.string(),
            focus: z.string(),
            rawProjects: z.number(),
            keySources: z.string(),
          })).optional(),
          sourceCategories: z.array(z.object({
            name: z.string(),
            type: z.string(),
          })).optional(),
        }),
        projects: z.array(z.object({
          projectKey: z.string(),
          name: z.string(),
          location: z.string(),
          value: z.string(),
          owner: z.string(),
          priority: z.enum(["hot", "warm", "cold"]),
          capexGrade: z.enum(["A", "B", "Unknown"]),
          opportunityRoute: z.enum(["Direct CAPEX", "Fleet CAPEX", "OPEX/Monitor"]),
          sector: z.enum(["mining", "oil_gas", "infrastructure", "energy", "defence"]),
          isNew: z.boolean(),
          stage: z.string().optional(),
          overview: z.string().optional(),
          equipmentSignals: z.array(z.string()).optional(),
          contractors: z.array(z.object({
            name: z.string(),
            status: z.string(),
            confidence: z.number().optional(),
            detail: z.string().optional(),
          })).optional(),
          opportunityNote: z.string().optional(),
          sources: z.array(z.object({
            label: z.string(),
            url: z.string(),
            date: z.string().optional(),
          })).optional(),
          timeline: z.string().optional(),
          completion: z.string().optional(),
        })),
        contacts: z.array(z.object({
          name: z.string(),
          title: z.string(),
          company: z.string(),
          project: z.string(),
          priority: z.enum(["hot", "warm", "cold"]),
          roleBucket: z.string(),
          email: z.string().optional(),
          linkedin: z.string().optional(),
          phone: z.string().optional(),
        })),
        drillingCampaigns: z.array(z.object({
          campaign: z.string(),
          operator: z.string(),
          location: z.string(),
          drillType: z.string(),
          timing: z.string(),
          airRequirement: z.string(),
          sourceLabel: z.string().optional(),
          sourceUrl: z.string().optional(),
        })),
        awardedProjects: z.array(z.object({
          project: z.string(),
          value: z.string(),
          winningContractor: z.string(),
          location: z.string(),
          stage: z.string(),
          opportunity: z.enum(["Direct", "Fleet", "Monitor"]),
          sourceLabel: z.string().optional(),
          sourceUrl: z.string().optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const reportId = await createReport(input.report);

        await Promise.all([
          createProjects(input.projects.map(p => ({ ...p, reportId }))),
          createContacts(input.contacts.map(c => ({ ...c, reportId }))),
          createDrillingCampaigns(input.drillingCampaigns.map(d => ({ ...d, reportId }))),
          createAwardedProjects(input.awardedProjects.map(a => ({ ...a, reportId }))),
        ]);

        return { reportId };
      }),

    /** All live tenders sorted by close date — for the operator view */
    liveTenders: protectedProcedure
      .input(z.object({
        limit: z.number().optional().default(100),
        sector: z.string().optional(),
        priority: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { projects: projectsTable } = await import("../drizzle/schema");
        const { and, eq, isNotNull, gte, or, isNull } = await import("drizzle-orm");
        const now = new Date();
        const conditions: any[] = [
          eq(projectsTable.sourcePurpose, "live_tender"),
          eq(projectsTable.lifecycleStatus, "active"),
          // Only show tenders that haven't closed yet (or have no close date)
          or(
            isNull(projectsTable.tenderCloseDate),
            gte(projectsTable.tenderCloseDate, now)
          ),
        ];
        if (input.sector) conditions.push(eq(projectsTable.sector, input.sector as any));
        if (input.priority) conditions.push(eq(projectsTable.priority, input.priority as any));
        const rows = await db
          .select()
          .from(projectsTable)
          .where(and(...conditions))
          .orderBy(projectsTable.tenderCloseDate)
          .limit(input.limit);
        return rows;
      }),

    /** Live tenders closing within N days — surfaces urgency in This Week page */
    closingSoon: protectedProcedure
      .input(z.object({ daysAhead: z.number().optional().default(14) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { projects: projectsTable } = await import("../drizzle/schema");
        const { and, eq, isNotNull, lte, gte, sql: drizzleSql } = await import("drizzle-orm");
        const cutoff = new Date(Date.now() + input.daysAhead * 24 * 60 * 60 * 1000);
        const now = new Date();
        const rows = await db
          .select()
          .from(projectsTable)
          .where(
            and(
              eq(projectsTable.sourcePurpose, "live_tender"),
              isNotNull(projectsTable.tenderCloseDate),
              lte(projectsTable.tenderCloseDate, cutoff),
              gte(projectsTable.tenderCloseDate, now),
              eq(projectsTable.lifecycleStatus, "active")
            )
          )
          .orderBy(projectsTable.tenderCloseDate)
          .limit(20);
        return rows;
      }),
  }),

  // ── Admin: Business Line Management ──
  businessLines: router({
    list: protectedProcedure.query(async () => {
      return getAllBusinessLines();
    }),

    active: protectedProcedure.query(async () => {
      return getActiveBusinessLines();
    }),

    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        keywords: z.array(z.string()),
        sectors: z.array(z.string()),
        equipmentTypes: z.array(z.string()).optional(),
        defaultTerritories: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await createBusinessLine({
          name: input.name,
          description: input.description ?? null,
          keywords: input.keywords,
          sectors: input.sectors,
          equipmentTypes: input.equipmentTypes ?? null,
          defaultTerritories: input.defaultTerritories ?? null,
        });
        return { id };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        sectors: z.array(z.string()).optional(),
        equipmentTypes: z.array(z.string()).optional(),
        defaultTerritories: z.array(z.string()).optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateBusinessLine(id, data);
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteBusinessLine(input.id);
        return { success: true };
      }),
  }),

  // ── Admin: RSS Source Management ──
  rssSources: router({
    list: protectedProcedure.query(async () => {
      return getAllRssSources();
    }),

    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        feedUrl: z.string().url(),
        category: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const id = await createRssSource({
          name: input.name,
          feedUrl: input.feedUrl,
          category: input.category,
        });
        return { id };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        feedUrl: z.string().url().optional(),
        category: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateRssSource(id, data);
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteRssSource(input.id);
        return { success: true };
      }),

    /** Stage 5A: Quarantine a source (admin only) — skips it in harvester without deleting */
    quarantine: adminProcedure
      .input(z.object({ id: z.number(), reason: z.string().min(1) }))
      .mutation(async ({ input }) => {
        await quarantineRssSource(input.id, input.reason);
        return { success: true };
      }),

    /** Stage 5A: Remove quarantine from a source (admin only) */
    unquarantine: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await unquarantineRssSource(input.id);
        return { success: true };
      }),
  }),

  // ── Admin: Data Pipeline Operations ──
  dataPipeline: router({
    /** Get pipeline statistics */
    stats: protectedProcedure.query(async () => {
      const [pipelineStats, articleStats, dailyStats] = await Promise.all([
        getPipelineStats(),
        getArticleStats(),
        getDailyExtractionStats(7),
      ]);
      return { pipeline: pipelineStats, articles: articleStats, dailyExtractions: dailyStats };
    }),

    /** Trigger RSS harvest (admin only) */
    harvest: adminProcedure.mutation(async () => {
      const result = await harvestAllFeeds();
      return result;
    }),

    /** Trigger AI extraction (admin only) */
    extract: adminProcedure
      .input(z.object({ maxArticles: z.number().optional() }).optional())
      .mutation(async ({ input }) => {
        const result = await runExtractionPipeline(input?.maxArticles);
        return result;
      }),

    /** Trigger contact enrichment (admin only) */
    enrich: adminProcedure
      .input(z.object({ maxContacts: z.number().optional() }).optional())
      .mutation(async ({ input }) => {
        const result = await runEnrichmentPipeline(input?.maxContacts);
        return result;
      }),

    /** Trigger LLM fallback bulk enrichment for projects without contacts (admin only) */
    llmFallbackBulk: adminProcedure
      .input(z.object({ maxProjects: z.number().optional() }).optional())
      .mutation(async ({ input }) => {
        const result = await runLLMFallbackBulk(input?.maxProjects || 50);
        return result;
      }),

    /** Open-web stakeholder discovery for a single project */
    discoverStakeholders: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        forceRefresh: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [project] = await db
          .select()
          .from(projects)
          .where(eq(projects.id, input.projectId))
          .limit(1);

        if (!project) throw new Error("Project not found");

        // If force refresh, we skip the existing-check inside discoverAndSaveStakeholders
        // by deleting existing web_search contacts first
        if (input.forceRefresh) {
          await db.delete(contacts).where(
            and(
              sql`${contacts.project} = ${project.name}`,
              eq(contacts.enrichmentSource, "web_search")
            )
          );
        }

        const contractorsList = Array.isArray(project.contractors)
          ? (project.contractors as { name: string; status: string }[])
          : [];

        const result = await discoverAndSaveStakeholders({
          id: project.id,
          reportId: project.reportId,
          name: project.name,
          owner: project.owner || "Unknown",
          contractors: contractorsList,
          sector: project.sector || "infrastructure",
          location: project.location || "Australia",
          value: project.value || undefined,
          stage: project.stage || undefined,
        });

        return result;
      }),

    /** Bulk web stakeholder discovery for projects without contacts (admin only) */
    bulkWebDiscovery: adminProcedure
      .input(z.object({ maxProjects: z.number().optional() }).optional())
      .mutation(async ({ input }) => {
        const result = await runBulkWebDiscovery(input?.maxProjects || 50);
        return result;
      }),

    /** Get web discovery stats */
    webDiscoveryStats: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { totalWebContacts: 0, projectsWithWebContacts: 0, avgPerProject: 0 };

      const [stats] = await db
        .select({
          total: sql<number>`COUNT(*)`,
          projects: sql<number>`COUNT(DISTINCT ${contacts.project})`,
        })
        .from(contacts)
        .where(eq(contacts.enrichmentSource, "web_search"));

      return {
        totalWebContacts: Number(stats?.total || 0),
        projectsWithWebContacts: Number(stats?.projects || 0),
        avgPerProject: stats?.projects ? Math.round(Number(stats.total) / Number(stats.projects) * 10) / 10 : 0,
      };
    }),

    /** Get enrichment stats */
    enrichmentStats: protectedProcedure.query(async () => {
      return getEnrichmentStats();
    }),

    /** Check enrichment cache status for a project */
    enrichmentCacheStatus: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return getProjectEnrichmentCache(input.projectId);
      }),

    /** On-demand per-project enrichment (profile-aware, cached) */
    enrichProject: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        forceRefresh: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        // Check cache first (unless force refresh)
        if (!input.forceRefresh) {
          const cache = await getProjectEnrichmentCache(input.projectId);
          if (cache.cached) {
            const existingContacts = await db
              .select()
              .from(contacts)
              .where(sql`${contacts.project} IN (SELECT name FROM projects WHERE id = ${input.projectId})`)
              .limit(20);

            return {
              projectId: input.projectId,
              projectName: "",
              contactsFound: existingContacts.length,
              fromCache: true,
              cachedAt: cache.enrichedAt,
              apiCallsSaved: cache.apiCallsMade ?? 0,
              source: "cache" as const,
              contacts: existingContacts.map(c => ({
                name: c.name,
                status: c.enrichmentStatus || "enriched",
                headline: c.linkedinHeadline || c.title,
                linkedinUrl: c.linkedin ?? undefined,
                email: c.email ?? undefined,
                enrichmentSource: c.enrichmentSource ?? undefined,
              })),
            };
          }
        }

        // Fetch the project
        const [project] = await db
          .select()
          .from(projects)
          .where(eq(projects.id, input.projectId))
          .limit(1);

        if (!project) throw new Error("Project not found");

        // Get user's preferred buyer roles from their onboarding profile
        const preferredRoles = ctx.user ? await getUserPreferredRoles(ctx.user.id) : null;

        // Extract contractors from JSON
        const contractorsList = Array.isArray(project.contractors)
          ? (project.contractors as { name: string; status: string }[])
          : [];

        // ── Strategy: Web Search primary → LLM fallback ──
        // Apollo is reserved for manual high-priority projects only (use apolloEnrichProject)

        // Step 1: Try open-web stakeholder discovery (primary source)
        let webResults: { name: string; status: string; headline?: string; linkedinUrl?: string; email?: string; enrichmentSource?: string }[] = [];

        try {
          const webResult = await discoverAndSaveStakeholders({
            id: project.id,
            reportId: project.reportId,
            name: project.name,
            owner: project.owner || "Unknown",
            contractors: contractorsList,
            sector: project.sector || "infrastructure",
            location: project.location || "Australia",
            value: project.value || undefined,
            stage: project.stage || undefined,
          });

          webResults = webResult.contacts.map(c => ({
            name: c.name,
            status: "enriched",
            headline: c.title,
            linkedinUrl: c.linkedinUrl ?? undefined,
            email: c.email ?? undefined,
            enrichmentSource: "web_search",
          }));

          console.log(`[enrichProject] Web discovery found ${webResults.length} contacts for project ${project.id}`);
        } catch (webErr: unknown) {
          const msg = webErr instanceof Error ? webErr.message : String(webErr);
          console.error(`[enrichProject] Web discovery failed for project ${project.id}: ${msg}`);
        }

        // If web search returned contacts, return them
        if (webResults.length > 0) {
          return {
            projectId: project.id,
            projectName: project.name,
            contactsFound: webResults.length,
            fromCache: false,
            quotaExhausted: false,
            llmFallback: false,
            source: "web_search" as const,
            contacts: webResults,
          };
        }

        // Step 2: Web search returned 0 — try LLM fallback
        try {
          const llmResult = await generateAndSaveLLMContacts(
            project.id,
            project.reportId,
            project.name,
            project.owner || "Unknown",
            contractorsList,
            project.sector || "infrastructure",
            project.value || "Unknown",
            project.location || "Australia",
            project.stage || undefined,
            preferredRoles,
          );

          if (llmResult.contactsGenerated > 0) {
            return {
              projectId: project.id,
              projectName: project.name,
              contactsFound: llmResult.contactsGenerated,
              fromCache: false,
              quotaExhausted: false,
              llmFallback: true,
              llmNote: llmResult.note,
              source: "llm" as const,
              contacts: llmResult.contacts.map(c => ({
                name: c.name,
                status: "enriched" as const,
                headline: c.title,
                linkedinUrl: undefined,
                source: "llm" as const,
                confidence: c.confidence,
              })),
            };
          }
        } catch (llmErr) {
          console.error(`[enrichProject] LLM fallback also failed:`, llmErr instanceof Error ? llmErr.message : String(llmErr));
        }

        // Both web search and LLM failed — return existing contacts if any
        const existingContacts = await db
          .select()
          .from(contacts)
          .where(sql`${contacts.project} IN (SELECT name FROM projects WHERE id = ${input.projectId})`)
          .limit(20);

        return {
          projectId: project.id,
          projectName: project.name,
          contactsFound: existingContacts.length,
          fromCache: false,
          quotaExhausted: false,
          llmFallback: false,
          source: "existing" as const,
          contacts: existingContacts.map(c => ({
            name: c.name,
            status: c.enrichmentStatus || "enriched",
            headline: c.linkedinHeadline || c.title,
            linkedinUrl: c.linkedin ?? undefined,
            email: c.email ?? undefined,
            enrichmentSource: c.enrichmentSource ?? undefined,
          })),
        };
      }),

    /** Verify a single contact via LinkedIn API (on-demand) */
    verifyContact: protectedProcedure
      .input(z.object({ contactId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        // Fetch the contact
        const [contact] = await db
          .select()
          .from(contacts)
          .where(eq(contacts.id, input.contactId))
          .limit(1);

        if (!contact) throw new Error("Contact not found");

        // Search LinkedIn for this person
        try {
          const queryParts = [contact.name];
          if (contact.company) queryParts.push(contact.company);

          const searchResult = (await callDataApi("LinkedIn/search_people", {
            query: {
              keywords: queryParts.join(" "),
              ...(contact.company ? { company: contact.company } : {}),
              ...(contact.title ? { keywordTitle: contact.title } : {}),
            },
          })) as {
            success?: boolean;
            data?: { items?: Array<{
              fullName?: string;
              headline?: string;
              location?: string;
              profileURL?: string;
              username?: string;
              profilePicture?: string;
            }>; total?: number };
          };

          if (!searchResult?.success || !searchResult?.data?.items?.length) {
            // No LinkedIn match found — mark as unverified
            await db.update(contacts).set({
              verificationStatus: "unverified",
              confidenceScore: "low",
              enrichedAt: new Date(),
            }).where(eq(contacts.id, input.contactId));

            return {
              contactId: input.contactId,
              verified: false,
              message: "No LinkedIn profile found matching this contact. The contact may not exist or uses a different name on LinkedIn.",
            };
          }

          // Find best match by name
          const nameLower = contact.name.toLowerCase().trim();
          let bestMatch = searchResult.data.items[0];
          for (const person of searchResult.data.items) {
            const fullName = (person.fullName || "").toLowerCase().trim();
            if (fullName === nameLower) {
              bestMatch = person;
              break;
            }
            const nameParts = nameLower.split(/\s+/);
            if (nameParts.length >= 2) {
              const firstName = nameParts[0];
              const lastName = nameParts[nameParts.length - 1];
              if (fullName.includes(firstName) && fullName.includes(lastName)) {
                bestMatch = person;
                break;
              }
            }
          }

          const linkedinUrl = bestMatch.profileURL || (bestMatch.username ? `https://www.linkedin.com/in/${bestMatch.username}` : null);

          // Update the contact with verified LinkedIn data
          await db.update(contacts).set({
            verificationStatus: "verified",
            confidenceScore: "high",
            enrichmentSource: "linkedin",
            enrichmentStatus: "enriched",
            enrichedAt: new Date(),
            linkedin: linkedinUrl,
            linkedinHeadline: bestMatch.headline || contact.linkedinHeadline,
            linkedinLocation: bestMatch.location || contact.linkedinLocation,
            linkedinProfilePic: bestMatch.profilePicture || contact.linkedinProfilePic,
            linkedinSearchUrl: linkedinUrl || contact.linkedinSearchUrl,
            emailVerified: false, // Email still needs separate verification
            // Update name if LinkedIn has a better match
            name: bestMatch.fullName || contact.name,
            title: bestMatch.headline || contact.title,
          }).where(eq(contacts.id, input.contactId));

          return {
            contactId: input.contactId,
            verified: true,
            linkedinUrl,
            headline: bestMatch.headline,
            location: bestMatch.location,
            profilePic: bestMatch.profilePicture,
            message: `Contact verified via LinkedIn. Profile: ${bestMatch.fullName || contact.name} — ${bestMatch.headline || ""}.`,
          };
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg.includes('usage exhausted') || errMsg.includes('quota')) {
            return {
              contactId: input.contactId,
              verified: false,
              quotaExhausted: true,
              message: "LinkedIn API quota exhausted. Please try again later or verify manually via the LinkedIn search link.",
            };
          }
          throw err;
        }
      }),

    /** Apollo People Search — FREE, no credits. Returns obfuscated contacts. */
    apolloSearch: protectedProcedure
      .input(z.object({
        companyDomain: z.string().optional(),
        companyName: z.string().optional(),
        personTitles: z.array(z.string()).optional(),
        organizationLocations: z.array(z.string()).optional(),
        keywords: z.string().optional(),
        page: z.number().optional(),
        perPage: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        // Infer domain from company name if not provided
        let domain = input.companyDomain;
        if (!domain && input.companyName) {
          domain = inferDomain(input.companyName) ?? undefined;
        }

        const result = await apolloPeopleSearch({
          organizationDomains: domain ? [domain] : undefined,
          personTitles: input.personTitles,
          organizationLocations: input.organizationLocations ?? ["australia"],
          keywords: input.keywords,
          page: input.page ?? 1,
          perPage: input.perPage ?? 25,
        });

        return {
          people: result.people.map(p => ({
            apolloId: p.id,
            firstName: p.first_name,
            lastNameObfuscated: p.last_name_obfuscated,
            title: p.title,
            company: p.organization?.name || input.companyName || "Unknown",
            hasEmail: p.has_email,
            hasCity: p.has_city,
            hasState: p.has_state,
            hasCountry: p.has_country,
          })),
          totalFound: result.total_entries,
          creditsUsed: 0, // People Search is free
        };
      }),

    /** Apollo Reveal Contact — costs 1 Apollo credit. Returns full name, email, LinkedIn. */
    apolloReveal: protectedProcedure
      .input(z.object({
        apolloId: z.string(),
        firstName: z.string(),
        lastNameObfuscated: z.string().optional(),
        title: z.string(),
        company: z.string(),
        projectId: z.number().optional(), // Link to a project if applicable
        reportId: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const person: ApolloEnrichmentResult = {
          contactId: 0,
          apolloId: input.apolloId,
          name: `${input.firstName} ${input.lastNameObfuscated || ""}`.trim(),
          firstName: input.firstName,
          lastNameObfuscated: input.lastNameObfuscated,
          title: input.title,
          company: input.company,
          email: null,
          emailStatus: null,
          linkedinUrl: null,
          photoUrl: null,
          city: null,
          state: null,
          country: null,
          seniority: null,
          hasEmail: true,
          status: "found",
        };

        const enriched = await enrichSingleContact(person, {
          userId: ctx.user.id,
          userName: ctx.user.name ?? "Unknown",
          projectId: input.projectId,
          projectName: undefined,
        });

        // If enrichment succeeded and we have a project, save to DB
        if (enriched.status === "enriched" && input.projectId) {
          const db = await getDb();
          if (db) {
            // Check for duplicates
            const existing = await db
              .select({ id: contacts.id })
              .from(contacts)
              .where(
                sql`LOWER(${contacts.name}) = LOWER(${enriched.name}) AND LOWER(${contacts.company}) = LOWER(${input.company})`
              )
              .limit(1);

            if (existing.length === 0) {
              // Get project name
              const [project] = await db
                .select({ name: projects.name })
                .from(projects)
                .where(eq(projects.id, input.projectId))
                .limit(1);

              await db.insert(contacts).values({
                reportId: input.reportId ?? 0,
                name: enriched.name,
                title: enriched.title,
                company: input.company,
                project: project?.name || "Unknown",
                priority: "warm",
                roleBucket: "other",
                email: enriched.email,
                linkedin: enriched.linkedinUrl,
                enrichmentStatus: "enriched",
                enrichmentSource: "apollo",
                enrichedAt: new Date(),
                linkedinHeadline: enriched.title,
                linkedinLocation: [enriched.city, enriched.state, enriched.country].filter(Boolean).join(", ") || null,
                linkedinProfilePic: enriched.photoUrl,
                verificationStatus: enriched.emailStatus === "verified" ? "verified" : "unverified",
                verificationScore: enriched.emailStatus === "verified" ? 95 : 50,
                emailVerified: enriched.emailStatus === "verified",
              });
            }
          }
        }

        return {
          apolloId: enriched.apolloId,
          name: enriched.name,
          title: enriched.title,
          company: enriched.company,
          email: enriched.email,
          emailStatus: enriched.emailStatus,
          linkedinUrl: enriched.linkedinUrl,
          photoUrl: enriched.photoUrl,
          city: enriched.city,
          state: enriched.state,
          country: enriched.country,
          seniority: enriched.seniority,
          status: enriched.status,
          creditsUsed: enriched.status === "enriched" ? 1 : 0,
        };
      }),

    /** Apollo Enrich Project — search + reveal all contacts for a project */
    apolloEnrichProject: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        reportId: z.number().optional(),
        targetTitles: z.array(z.string()).optional(),
        maxPerCompany: z.number().optional(),
        enrichEmails: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const result = await enrichProjectContacts(
          input.projectId,
          input.reportId ?? 0,
          {
            targetTitles: input.targetTitles,
            maxPerCompany: input.maxPerCompany,
            enrichEmails: input.enrichEmails,
          }
        );
        return result;
      }),

    /** Apollo Reveal Email for existing contact — costs 1 Apollo credit */
    apolloRevealEmail: protectedProcedure
      .input(z.object({ contactId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const result = await revealContactEmail(input.contactId);
        // Log credit usage for email reveal
        if (result && (result as any).status === "enriched") {
          await logCreditUsage({
            userId: ctx.user.id,
            userName: ctx.user.name ?? "Unknown",
            action: "verify_email",
            creditsUsed: 1,
            contactId: input.contactId,
            contactName: (result as any).name ?? null,
          });
        }
        return result;
      }),

    /** Apollo Credit Usage Dashboard — admin only */
    apolloCreditUsage: adminProcedure
      .input(z.object({
        period: z.enum(["this_month", "last_month", "last_7_days", "last_30_days", "all_time"]).optional(),
      }).optional())
      .query(async ({ input }) => {
        const period = input?.period ?? "this_month";
        const now = new Date();
        let since: Date;

        switch (period) {
          case "last_month": {
            since = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            break;
          }
          case "last_7_days":
            since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case "last_30_days":
            since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          case "all_time":
            since = new Date(2020, 0, 1);
            break;
          default: // this_month
            since = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        return getCreditUsageSummary({ since });
      }),

    /** Validate Apollo API key status */
    apolloStatus: adminProcedure.query(async () => {
      const result = await validateApolloApiKey();
      return result;
    }),

    /** Check Apollo eligibility for a specific project */
    apolloEligibility: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return checkApolloEligibility(input.projectId);
      }),

    /** Check Apollo eligibility with explicit request override */
    apolloEnrichExplicit: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        reportId: z.number().optional(),
        targetTitles: z.array(z.string()).optional(),
        maxPerCompany: z.number().optional(),
        enrichEmails: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Explicit request always allowed — user clicked "Enrich with Apollo"
        const eligibility = await checkApolloEligibility(input.projectId, { explicitRequest: true });
        console.log(`[Apollo] Explicit enrichment requested by ${ctx.user.name} for project ${input.projectId} — ${eligibility.details}`);

        const result = await enrichProjectContacts(
          input.projectId,
          input.reportId ?? 0,
          {
            targetTitles: input.targetTitles,
            maxPerCompany: input.maxPerCompany ?? 5,
            enrichEmails: input.enrichEmails ?? true,
          }
        );
        return {
          ...result,
          eligibility,
        };
      }),

    /** Get Apollo budget status */
    apolloBudget: protectedProcedure.query(async () => {
      return getBudgetStatus();
    }),

    /** Get contact gap analysis for a project */
    contactGaps: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return analyzeContactGaps(input.projectId);
      }),

    /** Find all projects eligible for auto Apollo enrichment (admin) */
    apolloEligibleProjects: adminProcedure
      .input(z.object({ maxProjects: z.number().optional() }).optional())
      .query(async ({ input }) => {
        return findEligibleProjects(input?.maxProjects ?? 20);
      }),

    // ── Business Line Scoring ──

    /** Get business line scores for a single project */
    projectScores: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return getProjectScores(input.projectId);
      }),

    /** Get business line scores for multiple projects */
    projectScoresBatch: protectedProcedure
      .input(z.object({ projectIds: z.array(z.number()) }))
      .query(async ({ input }) => {
        const map = await getProjectScoresBatch(input.projectIds);
        // Convert Map to plain object for serialization
        const result: Record<number, DimensionScore[]> = {};
        Array.from(map.entries()).forEach(([key, value]) => {
          result[key] = value;
        });
        return result;
      }),

    /** Score a single project (admin) */
    scoreProject: adminProcedure
      .input(z.object({ projectId: z.number() }))
      .mutation(async ({ input }) => {
        const scores = await scoreProject(input.projectId);
        if (!scores) throw new Error("Project not found");
        await saveProjectScores(scores);
        return scores;
      }),

    /** Bulk score unscored projects (admin) */
    bulkScoreProjects: adminProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .mutation(async ({ input }) => {
        const unscoredIds = await getUnscoredProjectIds(input?.limit ?? 20);
        if (unscoredIds.length === 0) return { scored: 0, failed: 0, total: 0, errors: [] };
        console.log(`[BL-Scoring] Bulk scoring ${unscoredIds.length} unscored projects`);
        const result = await scoreAndSaveProjects(unscoredIds);
        console.log(`[BL-Scoring] Bulk complete: ${result.scored} scored, ${result.failed} failed`);
        return { ...result, total: unscoredIds.length };
      }),

    /** Get scoring dimensions list */
    scoringDimensions: publicProcedure.query(() => {
      return [...SCORING_DIMENSIONS];
    }),

    /** Get count of unscored projects */
    unscoredCount: protectedProcedure.query(async () => {
      const ids = await getUnscoredProjectIds(1000);
      return { count: ids.length };
    }),

    /** Get recent articles */
    recentArticles: protectedProcedure
      .input(z.object({
        status: z.enum(["pending", "queued", "extracted", "skipped", "failed"]).optional(),
        limit: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        if (input?.status) {
          return getArticlesByStatus(input.status, input.limit || 50);
        }
        return getRecentArticles(input?.limit || 50);
      }),
  }),

  // ── Admin: Seed default data ──
  seed: router({
    defaults: adminProcedure.mutation(async () => {
      const result = await seedDefaultPipelineData();
      return result;
    }),
  }),

  // ── Full daily pipeline (admin only) ──
  dailyPipeline: router({
    run: adminProcedure.mutation(async ({ ctx }) => {
      const result = await runDailyPipeline(ctx.user.name || "admin");
      return result;
    }),
    history: adminProcedure
      .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const limit = input?.limit ?? 20;
        const rows = await db.select().from(pipelineRunsTable).orderBy(desc(pipelineRunsTable.startedAt)).limit(limit);
        return rows;
      }),
  }),

  // ── Weekly mega-scrape pipeline (admin only) ──
  weeklyPipeline: router({
    run: adminProcedure.mutation(async () => {
      const result = await runWeeklyPipeline();
      return result;
    }),
  }),

  // ── Projectory Scraper (admin only) ──
  projectory: router({
    /** Legacy server-side scraper (requires cookies) */
    scrape: adminProcedure
      .input(z.object({
        maxPages: z.number().optional(),
        categories: z.array(z.string()).optional(),
      }).optional())
      .mutation(async ({ input }) => {
        const result = await runProjectoryScraper(input ?? undefined);
        return result;
      }),

    /** Proxy fetch — fetches a Projectory URL server-side for the client scraper */
    proxyFetch: adminProcedure
      .input(z.object({ url: z.string().url() }))
      .mutation(async ({ input }) => {
        const html = await proxyFetchUrl(input.url);
        return { html };
      }),

    /** Ingest pre-parsed articles from the client-side scraper */
    ingest: adminProcedure
      .input(z.object({
        articles: z.array(z.object({
          article: z.object({
            title: z.string(),
            url: z.string(),
            date: z.string(),
            categories: z.array(z.string()),
            regions: z.array(z.string()),
          }),
          project: z.object({
            name: z.string(),
            projectUrl: z.string(),
            status: z.string(),
            site: z.string(),
            capex: z.string(),
            proponent: z.string(),
          }).nullable(),
          contacts: z.array(z.object({
            name: z.string(),
            position: z.string(),
            organisation: z.string(),
            telephone: z.string(),
            email: z.string(),
            website: z.string(),
          })),
          bodyText: z.string(),
        })),
      }))
      .mutation(async ({ input }) => {
        const result = await ingestProjectoryArticles(input.articles);
        return result;
      }),

    /** Set session cookies for Projectory access */
    setCookies: adminProcedure
      .input(z.object({ cookies: z.string() }))
      .mutation(async ({ input }) => {
        setProjectoryCookies(input.cookies);
        return { success: true };
      }),

    /** Check if cookies are configured */
    status: protectedProcedure.query(async () => {
      const cookies = getProjectoryCookies();
      return {
        hasCookies: cookies.length > 0,
        cookieLength: cookies.length,
      };
    }),
  }),

  // ── DMIRS Scraper (admin only) ──
  dmirs: router({
    /** Run the DMIRS MINEDEX scraper */
    scrape: adminProcedure
      .input(z.object({
        maxRegistrations: z.number().optional(),
        lookbackDays: z.number().optional(),
      }).optional())
      .mutation(async ({ input }) => {
        const result = await runDmirsScraper(input ?? undefined);
        return result;
      }),
  }),

  // ── AEMO Generation Scraper (admin only) ──
  aemo: router({
    /** Run the AEMO generation projects scraper */
    scrape: adminProcedure
      .mutation(async () => {
        const result = await runAemoScraper();
        return result;
      }),
  }),

  // ── Government Major Projects Scraper (admin only) ──
  gov: router({
    /** Run the government major projects scraper */
    scrape: adminProcedure
      .mutation(async () => {
        const result = await runGovScraper();
        return result;
      }),
  }),

  // ── AusTender Scraper ──
  austender: router({
    scrape: adminProcedure
      .mutation(async () => {
        const result = await runAusTenderScraper();
        return result;
      }),
  }),

  // ── ICN Gateway Scraper ──
  icn: router({
    scrape: adminProcedure
      .mutation(async () => {
        const result = await runIcnScraper();
        return result;
      }),
  }),

  // ── Outreach Email Generator ──
  outreach: router({
    /** Generate a personalised outreach email for a contact on a project */
    generate: protectedProcedure
      .input(z.object({
        contactName: z.string(),
        contactTitle: z.string(),
        contactCompany: z.string(),
        contactEmail: z.string(),
        contactRoleBucket: z.string(),
        projectName: z.string(),
        projectLocation: z.string(),
        projectValue: z.string(),
        projectSector: z.string(),
        projectStage: z.string().nullable(),
        projectOverview: z.string().nullable(),
        equipmentSignals: z.array(z.string()).nullable(),
        opportunityRoute: z.string(),
        matchedBusinessLines: z.array(z.string()),
        tone: z.enum(["professional", "consultative", "direct", "contractor_focused", "owner_epc_focused", "procurement_led", "engineering_led", "first_touch"]),
        style: z.enum(["standard", "contractor_focused", "owner_epc_focused", "procurement_led", "engineering_led", "first_touch"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Load user's assigned BLs to personalise the outreach
        const profile = await getProfileByUserId(ctx.user.id);
        const userBLs = (profile?.assignedBusinessLines as string[]) || [];
        const result = await generateOutreachEmail({
          ...input,
          senderName: ctx.user.name || "Team",
          senderBusinessLines: userBLs.length > 0 ? userBLs : undefined,
        });
        // Track outreach drafted
        await trackActivity(ctx.user.id, "outreach_drafted", {
          metadata: { contactName: input.contactName, projectName: input.projectName, tone: input.tone },
        });
        return result;
      }),
    /** Save an outreach email to the database */
    save: protectedProcedure
      .input(z.object({
        contactId: z.number().optional(),
        contactName: z.string(),
        contactEmail: z.string().optional(),
        projectId: z.number().optional(),
        projectName: z.string().optional(),
        subject: z.string(),
        body: z.string(),
        tone: z.enum(["professional", "consultative", "direct", "contractor_focused", "owner_epc_focused", "procurement_led", "engineering_led", "first_touch"]),
        status: z.enum(["drafted", "opened_in_email", "sent"]),
      }))
      .mutation(async ({ ctx, input }) => {
        return saveOutreachEmail({
          userId: ctx.user.id,
          ...input,
        });
      }),

    /** Get outreach history for a specific contact */
    contactHistory: protectedProcedure
      .input(z.object({ contactId: z.number() }))
      .query(async ({ input }) => {
        return getOutreachHistory(input.contactId);
      }),

    /** Get all outreach history for the current user */
    myHistory: protectedProcedure.query(async ({ ctx }) => {
      return getUserOutreachHistory(ctx.user.id);
    }),

    /** Get list of all contacted contacts (for badges) */
    contactedList: protectedProcedure.query(async () => {
      return getContactedContactList();
    }),

    /** Generate a downloadable .eml file for a project-based outreach email */
    downloadEml: protectedProcedure
      .input(z.object({
        contactName: z.string(),
        contactEmail: z.string(),
        subject: z.string(),
        body: z.string(),
        contactId: z.number().optional(),
        projectId: z.number().optional(),
        projectName: z.string().optional(),
        tone: z.enum(["professional", "consultative", "direct", "contractor_focused", "owner_epc_focused", "procurement_led", "engineering_led", "first_touch"]),
        collateralName: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const senderName = ctx.user?.name || "Team";
        const senderEmail = ctx.user?.email || "";
        const brand = detectBrand(input.collateralName);

        // Strip any existing signature from the body
        let cleanBody = input.body;
        const sigRegex = /\n\n\s*(Best regards|Kind regards|Regards|Warm regards|Cheers)[\s\S]*$/i;
        cleanBody = cleanBody.replace(sigRegex, "");
        cleanBody = cleanBody.replace(/\n---\nReminder:[\s\S]*$/, "");
        cleanBody = cleanBody.replace(/\n\nReminder: Please attach[\s\S]*$/, "");

        const emlContent = buildEmlFile({
          fromName: senderName,
          fromEmail: senderEmail,
          toName: input.contactName,
          toEmail: input.contactEmail,
          subject: input.subject,
          bodyText: cleanBody.trim(),
          brand,
        });

        // Track outreach
        await saveOutreachEmail({
          userId: ctx.user.id,
          contactId: input.contactId,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          projectId: input.projectId,
          projectName: input.projectName,
          subject: input.subject,
          body: input.body,
          tone: input.tone,
          status: "opened_in_email",
        });

        return {
          emlBase64: Buffer.from(emlContent).toString("base64"),
          filename: `outreach-${input.contactName.replace(/\s+/g, "-").toLowerCase()}.eml`,
        };
      }),

    /** Get outreach leaderboard — email count per user */
    leaderboard: protectedProcedure
      .input(z.object({
        period: z.enum(["week", "month", "all"]).default("week"),
      }).optional())
      .query(async ({ input }) => {
        const period = input?.period ?? "week";
        let sinceDate: Date | undefined;
        if (period === "week") {
          sinceDate = new Date();
          sinceDate.setDate(sinceDate.getDate() - 7);
        } else if (period === "month") {
          sinceDate = new Date();
          sinceDate.setMonth(sinceDate.getMonth() - 1);
        }
        return getOutreachLeaderboard(sinceDate);
      }),
  }),

  // ── ML Ranking endpoints ──
  mlRanking: router({
    /** Get the user's learned weights */
    weights: protectedProcedure.query(async ({ ctx }) => {
      return getFeedbackWeightsByUser(ctx.user.id);
    }),

    /** Recompute weights from all historical feedback */
    recompute: protectedProcedure.mutation(async ({ ctx }) => {
      return recomputeAllWeights(ctx.user.id);
    }),
  }),

  // ── Outreach Template Library ──
  templates: router({
    /** Create a new outreach template */
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(256),
        description: z.string().max(512).optional(),
        subject: z.string().min(1).max(512),
        body: z.string().min(1),
        tone: z.enum(["professional", "consultative", "direct", "contractor_focused", "owner_epc_focused", "procurement_led", "engineering_led", "first_touch"]),
        roleBucket: z.string().max(128).optional(),
        sector: z.string().max(128).optional(),
        tags: z.array(z.string()).optional(),
        isShared: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return createTemplate({
          ...input,
          createdBy: ctx.user.id,
          createdByName: ctx.user.name || undefined,
        });
      }),

    /** List templates with optional filters */
    list: protectedProcedure
      .input(z.object({
        roleBucket: z.string().optional(),
        sector: z.string().optional(),
        tone: z.string().optional(),
        search: z.string().optional(),
        myOnly: z.boolean().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        return listTemplates({
          roleBucket: input?.roleBucket,
          sector: input?.sector,
          tone: input?.tone,
          search: input?.search,
          createdBy: input?.myOnly ? ctx.user.id : undefined,
          sharedOnly: !input?.myOnly,
        });
      }),

    /** Get a single template by ID */
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getTemplateById(input.id);
      }),

    /** Update a template (only creator can update) */
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(256).optional(),
        description: z.string().max(512).optional(),
        subject: z.string().min(1).max(512).optional(),
        body: z.string().min(1).optional(),
        tone: z.enum(["professional", "consultative", "direct", "contractor_focused", "owner_epc_focused", "procurement_led", "engineering_led", "first_touch"]).optional(),
        roleBucket: z.string().max(128).optional(),
        sector: z.string().max(128).optional(),
        tags: z.array(z.string()).optional(),
        isShared: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const template = await getTemplateById(input.id);
        if (!template) throw new Error("Template not found");
        if (template.createdBy !== ctx.user.id) throw new Error("Only the template creator can edit it");
        return updateTemplate(input);
      }),

    /** Delete a template (only creator can delete) */
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        return deleteTemplate(input.id, ctx.user.id);
      }),

    /** Apply a template to a new contact with AI personalisation */
    personalise: protectedProcedure
      .input(z.object({
        templateId: z.number(),
        contactName: z.string(),
        contactTitle: z.string(),
        contactCompany: z.string(),
        contactEmail: z.string(),
        contactRoleBucket: z.string(),
        projectName: z.string(),
        projectLocation: z.string(),
        projectValue: z.string(),
        projectSector: z.string(),
        projectStage: z.string().nullable(),
        projectOverview: z.string().nullable(),
        equipmentSignals: z.array(z.string()).nullable(),
        matchedBusinessLines: z.array(z.string()),
      }))
      .mutation(async ({ ctx, input }) => {
        return personaliseTemplate({
          ...input,
          senderName: ctx.user.name || "Team",
        });
      }),

     /** Get template library stats */
    stats: protectedProcedure.query(async () => {
      return getTemplateStats();
    }),
  }),

  // ═══════════════════════════════════════════════════════════════
  // SOURCE ARCHITECTURE — Categorisation, Monitoring, Enrichment
  // ═══════════════════════════════════════════════════════════════

  sources: router({
    /** Get all source configurations with role categorisation */
    config: protectedProcedure.query(async () => {
      return {
        sources: ALL_SOURCES,
        summary: getSourceSummary(),
      };
    }),

    /** Get source monitoring metrics */
    monitoring: protectedProcedure.query(async () => {
      return getSourceMonitoringSummary();
    }),
  }),

  // ── Projectory Enrichment ──
  projectoryEnrichment: router({
    /** Get Projectory session status */
    sessionStatus: protectedProcedure.query(async () => {
      return getProjectorySessionStatus();
    }),

    /** Get enrichment statistics */
    stats: protectedProcedure.query(async () => {
      return getProjectoryEnrichmentStats();
    }),

    /** Enrich a single project via Projectory */
    enrichOne: adminProcedure
      .input(z.object({ projectId: z.number() }))
      .mutation(async ({ input }) => {
        return enrichProject(input.projectId);
      }),

    /** Bulk enrich unenriched projects (hot/warm first) */
    enrichBulk: adminProcedure
      .input(z.object({ limit: z.number().min(1).max(50).default(20) }))
      .mutation(async ({ input }) => {
        return enrichUnenrichedProjects(input.limit);
      }),

    /** Get contractor frequency analysis */
    contractorFrequency: protectedProcedure.query(async () => {
      return getContractorFrequency();
    }),
  }),

  // ── ICN Validation ──
  icnValidation: router({
    /** Validate a single project against ICN Gateway */
    validateOne: adminProcedure
      .input(z.object({ projectId: z.number() }))
      .mutation(async ({ input }) => {
        return icnValidateProject(input.projectId);
      }),

    /** Validate all active projects against ICN Gateway */
    validateAll: adminProcedure.mutation(async () => {
      return icnValidateAllProjects();
    }),
  }),

  // ── ASX Monitoring ──
  asxMonitor: router({
    /** Get the current ASX watchlist */
    watchlist: protectedProcedure.query(async () => {
      return getAsxWatchlist();
    }),

    /** Add a company to the ASX watchlist */
    addToWatchlist: adminProcedure
      .input(z.object({
        ticker: z.string().min(1).max(10),
        name: z.string().min(1),
        sector: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        addToWatchlist(input.ticker, input.name, input.sector);
        return { success: true };
      }),

    /** Remove a company from the ASX watchlist */
    removeFromWatchlist: adminProcedure
      .input(z.object({ ticker: z.string().min(1) }))
      .mutation(async ({ input }) => {
        removeFromWatchlist(input.ticker);
        return { success: true };
      }),

    /** Run ASX scan for all watchlist companies */
    scan: adminProcedure.mutation(async () => {
      return scanTargetCompanies();
    }),

    /** Get recent ASX findings */
    recentFindings: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
      .query(async ({ input }) => {
        return getRecentAsxFindings(input.limit);
      }),
  }),

  // ── Contractor & Delivery Pattern Engine ──
  contractorEngine: router({
    /** Run the full contractor engine: registry, pairings, scoring, patterns */
    runFull: adminProcedure.mutation(async () => {
      return runContractorEngine();
    }),
    /** Build/update the contractor registry from project data */
    buildRegistry: adminProcedure.mutation(async () => {
      return buildContractorRegistry();
    }),
    /** Detect recurring pairings between companies */
    detectPairings: adminProcedure.mutation(async () => {
      return detectPairings();
    }),
    /** Score all contractors for momentum, recurrence, relevance, early-signal */
    scoreContractors: adminProcedure.mutation(async () => {
      return scoreContractors();
    }),
    /** Detect emerging patterns from contractor activity */
    detectPatterns: adminProcedure.mutation(async () => {
      return detectEmergingPatterns();
    }),
    /** Get the contractor leaderboard */
    leaderboard: protectedProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).default(20),
        role: z.string().optional(),
        sector: z.string().optional(),
      }))
      .query(async ({ input }) => {
        return getContractorLeaderboard(input.limit, input.role, input.sector);
      }),
    /** Get a contractor's full profile with project links and pairings */
    profile: protectedProcedure
      .input(z.object({ contractorId: z.number() }))
      .query(async ({ input }) => {
        return getContractorProfile(input.contractorId);
      }),
    /** Get active emerging patterns */
    activePatterns: protectedProcedure.query(async () => {
      return getActivePatterns();
    }),
    /** Generate the Emerging Patterns section for the weekly brief */
    emergingPatternsSection: protectedProcedure.query(async () => {
      return generateEmergingPatternsSection();
    }),
  }),
  // ── Tier Classification ──
  tierClassification: router({
    /** Classify all projects into action tiers */
    classifyAll: adminProcedure.mutation(async () => {
      return classifyAllProjects();
    }),
    /** Classify a single project */
    classifyOne: adminProcedure
      .input(z.object({ projectId: z.number() }))
      .mutation(async ({ input }) => {
        const tier = await classifyProject(input.projectId);
        return { projectId: input.projectId, tier, label: getTierLabel(tier) };
      }),
    /** Get tier distribution stats */
    distribution: protectedProcedure.query(async () => {
      return getTierDistribution();
    }),
    /** Preview classification for a stage string (no DB write) */
    preview: protectedProcedure
      .input(z.object({ stage: z.string() }))
      .query(({ input }) => {
        const tier = classifyStage(input.stage);
        return { stage: input.stage, tier, label: getTierLabel(tier) };
      }),
  }),
  // ── Contractor Enrichment Pass ──
  contractorEnrichment: router({
    /** Run the contractor enrichment pass on projects missing contractors */
    runPass: adminProcedure
      .input(z.object({ limit: z.number().min(1).max(500).default(20) }).optional())
      .mutation(async ({ input }) => {
        return runContractorEnrichmentPass(input?.limit ?? 20);
      }),
    /** Get enrichment pass statistics */
    stats: protectedProcedure.query(async () => {
      return getEnrichmentPassStats();
    }),
    /** Get count of projects missing contractor info */
    missingCount: protectedProcedure.query(async () => {
      return getMissingContractorCount();
    }),
    /** Get projects missing contractor information */
    missingProjects: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
      .query(async ({ input }) => {
        return getProjectsMissingContractors(input?.limit ?? 20);
      }),
  }),

  // ── Role Relevance Classification ──
  roleRelevance: router({
    /** Classify all contacts by role relevance (admin only) */
    classifyAll: adminProcedure.mutation(async () => {
      return classifyAllContactRelevance();
    }),
    /** Get role relevance distribution */
    distribution: protectedProcedure.query(async () => {
      return getRoleRelevanceDistribution();
    }),
    /** Classify a single contact's role relevance */
    classifySingle: adminProcedure
      .input(z.object({ contactId: z.number() }))
      .mutation(async ({ input }) => {
        return classifySingleContactRelevance(input.contactId);
      }),
  }),

  // ── Second-Pass Contact Search ──
  secondPassSearch: router({
    /** Run the second-pass search on projects with few relevant contacts (admin only) */
    runBulk: adminProcedure
      .input(z.object({ limit: z.number().min(1).max(100).default(30) }).optional())
      .mutation(async ({ input }) => {
        return runBulkSecondPass(input?.limit ?? 30);
      }),
    /** Get count of projects needing more relevant contacts */
    gapCount: protectedProcedure.query(async () => {
      return getSecondPassGapCount();
    }),
  }),
  // ── This Week Summary ──
  thisWeek: router({
    /** Get the This Week summary for the landing page */
    summary: protectedProcedure.query(async ({ ctx }) => {
      return getThisWeekSummary(ctx.user.id);
    }),
    /** Dismiss a suggested action so it doesn't reappear */
    dismissAction: protectedProcedure
      .input(z.object({
        actionKey: z.string().min(1),
        reason: z.enum(["dismissed", "completed", "not_relevant"]).default("dismissed"),
      }))
      .mutation(async ({ ctx, input }) => {
        const { dismissedActions } = await import("../drizzle/schema");
        const db = await (await import("./db")).getDb();
        if (!db) throw new Error("Database not available");
        // Compute current week label
        const now = new Date();
        const dayOfWeek = now.getUTCDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(now);
        monday.setUTCDate(now.getUTCDate() + mondayOffset);
        const weekLabel = `${monday.getFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
        await db.insert(dismissedActions).values({
          userId: ctx.user.id,
          actionKey: input.actionKey,
          reason: input.reason,
          weekLabel,
        });
        return { success: true };
      }),
  }),
  // ── User Activity Tracking ──
  activity: router({
    /** Track a user action (project view, contact view, etc.) */
    track: protectedProcedure
      .input(z.object({
        actionType: z.enum([
          "project_viewed", "contact_viewed", "contact_enriched",
          "outreach_drafted", "outreach_sent", "pipeline_claimed",
          "pipeline_status_changed", "pipeline_meeting_logged",
          "pipeline_quote_uploaded", "search_performed", "project_exported",
        ]),
        projectId: z.number().optional(),
        contactId: z.number().optional(),
        claimId: z.number().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await trackActivity(ctx.user.id, input.actionType, {
          projectId: input.projectId,
          contactId: input.contactId,
          claimId: input.claimId,
          metadata: input.metadata,
        });
        return { success: true };
      }),
    /** Get the current user's activity summary for the last N days */
    mySummary: protectedProcedure
      .input(z.object({ days: z.number().min(1).max(90).default(7) }).optional())
      .query(async ({ ctx, input }) => {
        return getUserActivitySummary(ctx.user.id, input?.days ?? 7);
      }),
    /** Get the current user's recent activity feed */
    myRecent: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(50).default(20) }).optional())
      .query(async ({ ctx, input }) => {
        return getUserRecentActivity(ctx.user.id, input?.limit ?? 20);
      }),
    /** Get the current user's engagement score */
    myScore: protectedProcedure
      .input(z.object({ days: z.number().min(1).max(90).default(7) }).optional())
      .query(async ({ ctx, input }) => {
        return getUserEngagementScore(ctx.user.id, input?.days ?? 7);
      }),
    /** Admin: Get team-wide activity summary */
    teamSummary: adminProcedure
      .input(z.object({ days: z.number().min(1).max(90).default(7) }).optional())
      .query(async ({ input }) => {
        return getTeamActivitySummary(input?.days ?? 7);
      }),
  }),
  // ── Next Best Action ──
  nba: router({
    /** Get NBA for a single project (tailored to user's BLs) */
    forProject: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ ctx, input }) => {
        const profile = await getProfileByUserId(ctx.user.id);
        const userBLs = (profile?.assignedBusinessLines as string[]) || [];
        return generateNBA(input.projectId, userBLs.length > 0 ? userBLs : undefined);
      }),
    /** Get NBA for multiple projects (batch, tailored to user's BLs) */
    forProjects: protectedProcedure
      .input(z.object({ projectIds: z.array(z.number()).max(20) }))
      .query(async ({ ctx, input }) => {
        const profile = await getProfileByUserId(ctx.user.id);
        const userBLs = (profile?.assignedBusinessLines as string[]) || [];
        return generateNBABatch(input.projectIds, userBLs.length > 0 ? userBLs : undefined);
      }),
  }),
  // ── Weekly Coaching ──
  coaching: router({
    /** Get personalised weekly coaching for the authenticated user */
    weekly: protectedProcedure.query(async ({ ctx }) => {
      return getWeeklyCoaching(ctx.user.id);
    }),
  }),
  // ── Behaviour Analysis ──
  behaviour: router({
    /** Get the current user's working style profile */
    myProfile: protectedProcedure
      .input(z.object({ days: z.number().min(7).max(90).default(30) }).optional())
      .query(async ({ ctx, input }) => {
        return getWorkingStyleProfile(ctx.user.id, input?.days ?? 30);
      }),
  }),
  // ── Persona Coaching ──
  persona: router({
    /** Get pre-call coaching for a project + optional contact */
    preCallCoaching: protectedProcedure
      .input(z.object({ projectId: z.number(), contactId: z.number().optional() }))
      .query(async ({ input }) => {
        return getPreCallCoaching(input.projectId, input.contactId);
      }),
    /** Get pain-point library for a segment */
    segmentPainPoints: protectedProcedure
      .input(z.object({ segment: z.string() }))
      .query(async ({ input }) => {
        return getSegmentPainLibrary(input.segment);
      }),
    /** Get all segment pain-point libraries */
    allSegmentPainPoints: protectedProcedure.query(async () => {
      return getAllSegmentPainLibraries();
    }),
    /** Get a role persona by key */
    rolePersona: protectedProcedure
      .input(z.object({ role: z.string() }))
      .query(async ({ input }) => {
        return getRolePersona(input.role);
      }),
    /** Get all role personas */
    allRolePersonas: protectedProcedure.query(async () => {
      return getAllRolePersonas();
    }),
  }),

  // ── Collateral Library ──
  collateral: router({
    /** List all active collateral items, optionally filtered by product line */
    list: protectedProcedure
      .input(z.object({ productLine: z.string().optional() }).optional())
      .query(async ({ input }) => {
        return listCollateralItems({ productLine: input?.productLine, activeOnly: true });
      }),

    /** Get a single collateral item by ID */
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getCollateralItemById(input.id);
      }),

    /** Upload a new collateral item (file as base64) */
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(256),
        description: z.string().max(2000).optional(),
        productLine: z.string(),
        fileBase64: z.string(),
        fileName: z.string(),
        fileMimeType: z.string(),
        fileSizeBytes: z.number(),
        applicationTags: z.array(z.string()),
        sectorTags: z.array(z.string()),
        keywordTags: z.array(z.string()),
        minProjectSize: z.enum(["any", "large", "mega"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const fileBuffer = Buffer.from(input.fileBase64, "base64");
        return createCollateralItem({
          name: input.name,
          description: input.description,
          productLine: input.productLine,
          fileBuffer,
          fileName: input.fileName,
          fileMimeType: input.fileMimeType,
          fileSizeBytes: input.fileSizeBytes,
          applicationTags: input.applicationTags,
          sectorTags: input.sectorTags,
          keywordTags: input.keywordTags,
          minProjectSize: input.minProjectSize || "any",
          uploadedBy: ctx.user!.id,
          uploadedByName: ctx.user!.name || ctx.user!.email || "Unknown",
        });
      }),

    /** Update collateral item metadata and tags */
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(256).optional(),
        description: z.string().max(2000).optional(),
        productLine: z.string().optional(),
        applicationTags: z.array(z.string()).optional(),
        sectorTags: z.array(z.string()).optional(),
        keywordTags: z.array(z.string()).optional(),
        minProjectSize: z.enum(["any", "large", "mega"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateCollateralItem(id, data);
      }),

    /** Soft-delete a collateral item */
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteCollateralItem(input.id);
        return { success: true };
      }),

    /** Match collateral against a specific project */
    matchToProject: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return matchCollateralToProject(input.projectId);
      }),

    /** Get collateral suggestions for a project (for outreach) */
    suggestionsForProject: protectedProcedure
      .input(z.object({ projectId: z.number(), limit: z.number().optional() }))
      .query(async ({ input }) => {
        return getProjectCollateralSuggestions(input.projectId, input.limit);
      }),

    /** Get collateral library stats */
    stats: protectedProcedure.query(async () => {
      return getCollateralStats();
    }),

    /** Get available tag options for the UI */
    tagOptions: protectedProcedure.query(() => {
      return {
        applicationTags: APPLICATION_TAGS,
        sectorTags: SECTOR_TAGS,
        productLines: PRODUCT_LINES,
      };
    }),

    /** Get matched project IDs for a collateral item (used by dashboard filter) */
    matchedProjectIds: protectedProcedure
      .input(z.object({ collateralId: z.number() }))
      .query(async ({ input }) => {
        return getMatchedProjectIds(input.collateralId);
      }),
  }),

  // ── Campaigns ──
  campaign: router({
    /** List all campaigns */
    list: campaignProcedure.query(async () => {
      return listCampaigns();
    }),

    /** Get a single campaign by ID */
    get: campaignProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getCampaign(input.id);
      }),

    /** Get campaign stats (tier breakdown, outreach status, etc.) */
    stats: campaignProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        return getCampaignStats(input.campaignId);
      }),

    /** Create a new campaign */
    create: campaignProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        collateralId: z.number().optional(),
        collateralName: z.string().optional(),
        senderName: z.string().min(1),
        senderEmail: z.string().email(),
        senderTitle: z.string().optional(),
        targetSegment: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return createCampaign({ ...input, createdBy: ctx.user!.id });
      }),

    /** Update campaign details */
    update: campaignProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        collateralName: z.string().optional(),
        senderName: z.string().min(1).optional(),
        senderEmail: z.string().email().optional(),
        senderTitle: z.string().optional(),
        targetSegment: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateCampaign(id, data);
        return { success: true };
      }),

    /** Update campaign status */
    updateStatus: campaignProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["draft", "active", "paused", "completed"]),
      }))
      .mutation(async ({ input }) => {
        await updateCampaignStatus(input.id, input.status);
        return { success: true };
      }),

    /** Delete a campaign and all its contacts */
    delete: campaignProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteCampaign(input.id);
        return { success: true };
      }),

    /** Import contacts from uploaded spreadsheet */
    importContacts: protectedProcedure
      .input(z.object({
        campaignId: z.number(),
        fileUrl: z.string(),
      }))
      .mutation(async ({ input }) => {
        // Fetch the file from S3
        const response = await fetch(input.fileUrl);
        if (!response.ok) throw new Error("Failed to fetch uploaded file");
        const buffer = Buffer.from(await response.arrayBuffer());
        const rawContacts = parseBlastContactList(buffer);
        return importCampaignContacts(input.campaignId, rawContacts);
      }),

    /** Import contacts directly from server-side file path (for initial setup) */
    importFromPath: adminProcedure
      .input(z.object({
        campaignId: z.number(),
        filePath: z.string(),
      }))
      .mutation(async ({ input }) => {
        const fs = await import("fs");
        const buffer = fs.readFileSync(input.filePath);
        const rawContacts = parseBlastContactList(buffer);
        return importCampaignContacts(input.campaignId, rawContacts);
      }),

    /** Get campaign contacts with filtering and pagination */
    contacts: campaignProcedure
      .input(z.object({
        campaignId: z.number(),
        tier: z.string().optional(),
        outreachStatus: z.string().optional(),
        enrichmentStatus: z.string().optional(),
        roleBucket: z.string().optional(),
        sendReadiness: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(200).optional(),
        offset: z.number().min(0).optional(),
        sortBy: z.enum(["score", "company", "tier", "outreachStatus"]).optional(),
        sortDir: z.enum(["asc", "desc"]).optional(),
      }))
      .query(async ({ input }) => {
        return getCampaignContacts(input.campaignId, input);
      }),

    /** Get a single campaign contact */
    getContact: campaignProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getCampaignContact(input.id);
      }),

    /** Match campaign contacts to collateral-matched projects */
    matchToProjects: campaignProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ input }) => {
        return matchContactsToProjects(input.campaignId);
      }),

    /** Start enrichment as a background job (returns jobId for polling) */
    enrichContacts: adminProcedure
      .input(z.object({
        campaignId: z.number(),
        maxContacts: z.number().min(1).max(500).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const jobId = startEnrichmentJob(input.campaignId, {
          maxContacts: input.maxContacts ?? 50,
          userId: ctx.user!.id,
          userName: ctx.user!.name ?? undefined,
        });
        return { jobId };
      }),

    /** Poll enrichment job progress */
    enrichmentProgress: campaignProcedure
      .input(z.object({ jobId: z.string() }))
      .query(async ({ input }) => {
        const progress = getEnrichmentJobProgress(input.jobId);
        if (!progress) {
          return {
            status: "not_found" as const,
            result: null,
            error: "Job not found — it may have expired",
            elapsedSeconds: 0,
          };
        }
        return {
          status: progress.status,
          result: progress.result,
          error: progress.error,
          elapsedSeconds: progress.elapsedSeconds,
        };
      }),

    /** Generate a personalised outreach email for a contact */
    generateEmail: campaignProcedure
      .input(z.object({
        contactId: z.number(),
        tone: z.enum(["first_touch", "professional", "consultative", "direct", "contractor_focused", "owner_epc_focused", "procurement_led", "engineering_led"]).optional(),
      }))
      .mutation(async ({ input }) => {
        return generateCampaignEmail(input.contactId, { tone: input.tone });
      }),

    /** Update email draft (subject and/or body) */
    updateDraft: campaignProcedure
      .input(z.object({
        contactId: z.number(),
        subject: z.string().optional(),
        body: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await updateDraft(input.contactId, { subject: input.subject, body: input.body });
        return { success: true };
      }),

    /** Approve an email draft for sending */
    approveEmail: campaignProcedure
      .input(z.object({ contactId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await approveEmail(input.contactId, ctx.user!.id);
        return { success: true };
      }),

    /** Reject an email draft — pushes it back for regeneration */
    rejectEmail: campaignProcedure
      .input(z.object({
        contactId: z.number(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        await rejectEmail(input.contactId, ctx.user!.id, input.reason);
        return { success: true };
      }),

    /** Send an approved email via Resend (legacy) */
    sendEmail: campaignProcedure
      .input(z.object({ contactId: z.number() }))
      .mutation(async ({ input }) => {
        return sendApprovedEmail(input.contactId);
      }),

    /** Mark an approved email as sent (for Outlook/external mail client flow) */
    markAsSent: campaignProcedure
      .input(z.object({ contactId: z.number() }))
      .mutation(async ({ input }) => {
        return markEmailAsSent(input.contactId);
      }),

    /** Generate a downloadable .eml file for a campaign contact */
    downloadEml: campaignProcedure
      .input(z.object({ contactId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [contact] = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, input.contactId));
        if (!contact) throw new Error("Contact not found");
        if (!contact.draftSubject || !contact.draftBody) throw new Error("No draft email found — generate one first");

        const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, contact.campaignId));
        if (!campaign) throw new Error("Campaign not found");

        const recipientEmail = contact.enrichedEmail || contact.email || "";
        const recipientName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Contact";
        const senderName = campaign.senderName || ctx.user?.name || "Team";
        const senderEmail = campaign.senderEmail || ctx.user?.email || "";
        const brand = detectBrand(campaign.collateralName || undefined);

        // Fetch collateral PDF if available
        let attachment: { filename: string; contentBase64: string; mimeType: string } | undefined;
        try {
          if (campaign.collateralId) {
            const [collateral] = await db.select().from(collateralItemsTable)
              .where(eq(collateralItemsTable.id, campaign.collateralId));
            if (collateral?.fileUrl) {
              const file = await fetchFileAsBase64(collateral.fileUrl);
              attachment = {
                filename: collateral.fileName || file.filename,
                contentBase64: file.base64,
                mimeType: collateral.fileMimeType || file.mimeType,
              };
            }
          }
        } catch (err) {
          console.warn("[EML] Failed to fetch collateral for attachment:", err);
        }

        // Detect if this is an HTML template email
        const isHtmlTemplate = contact.draftTone === "html-template";

        // For HTML templates, the draftBody IS the rendered HTML — pass it directly
        // For plain text, strip signatures and clean up as before
        let cleanBody = contact.draftBody;
        let htmlBody: string | undefined;

        if (isHtmlTemplate) {
          htmlBody = contact.draftBody;
          // Create a plain text fallback by stripping HTML tags
          cleanBody = contact.draftBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        } else {
          const sigRegex = /\n\n\s*(Best regards|Kind regards|Regards|Warm regards|Cheers)[\s\S]*$/i;
          cleanBody = cleanBody.replace(sigRegex, "");
          cleanBody = cleanBody.replace(/\n---\nReminder:[\s\S]*$/, "");
          cleanBody = cleanBody.replace(/\n\nReminder: Please attach[\s\S]*$/, "");
        }

        const emlContent = buildEmlFile({
          fromName: senderName,
          fromEmail: senderEmail,
          toName: recipientName,
          toEmail: recipientEmail,
          subject: contact.draftSubject,
          bodyText: cleanBody.trim(),
          brand,
          attachment,
          htmlBody,
        });

        // Save to outreach tracking
        await db.update(campaignContactsTable).set({
          outreachStatus: "approved",
          approvedAt: new Date(),
          approvedBy: ctx.user!.id,
        }).where(eq(campaignContactsTable.id, input.contactId));

        // Return the .eml content as base64 for frontend download
        return {
          emlBase64: Buffer.from(emlContent).toString("base64"),
          filename: `outreach-${recipientName.replace(/\s+/g, "-").toLowerCase()}.eml`,
          recipientName,
          recipientEmail,
        };
      }),

    /** Download ALL approved .eml files as a ZIP archive */
    downloadAllEmls: campaignProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        // Get campaign details
        const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, input.campaignId));
        if (!campaign) throw new Error("Campaign not found");

        // Get all approved contacts with drafts
        const approvedContacts = await db.select().from(campaignContactsTable)
          .where(and(
            eq(campaignContactsTable.campaignId, input.campaignId),
            eq(campaignContactsTable.outreachStatus, "approved"),
          ));

        if (approvedContacts.length === 0) {
          throw new Error("No approved emails to download. Approve some emails first.");
        }

        const senderName = campaign.senderName || ctx.user?.name || "Team";
        const senderEmail = campaign.senderEmail || ctx.user?.email || "";
        const brand = detectBrand(campaign.collateralName || undefined);

        // Fetch collateral PDF once (shared across all emails)
        let attachment: { filename: string; contentBase64: string; mimeType: string } | undefined;
        try {
          if (campaign.collateralId) {
            const [collateral] = await db.select().from(collateralItemsTable)
              .where(eq(collateralItemsTable.id, campaign.collateralId));
            if (collateral?.fileUrl) {
              const file = await fetchFileAsBase64(collateral.fileUrl);
              attachment = {
                filename: collateral.fileName || file.filename,
                contentBase64: file.base64,
                mimeType: collateral.fileMimeType || file.mimeType,
              };
            }
          }
        } catch (err) {
          console.warn("[EML-ZIP] Failed to fetch collateral for attachment:", err);
        }

        // Build each .eml file
        const emlFiles: { filename: string; content: string }[] = [];
        for (const contact of approvedContacts) {
          if (!contact.draftSubject || !contact.draftBody) continue;

          const recipientEmail = contact.enrichedEmail || contact.email || "";
          const recipientName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Contact";

          // Detect HTML template mode
          const isHtmlTemplate = contact.draftTone === "html-template";
          let cleanBody = contact.draftBody;
          let htmlBody: string | undefined;

          if (isHtmlTemplate) {
            htmlBody = contact.draftBody;
            cleanBody = contact.draftBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          } else {
            const sigRegex = /\n\n\s*(Best regards|Kind regards|Regards|Warm regards|Cheers)[\s\S]*$/i;
            cleanBody = cleanBody.replace(sigRegex, "");
            cleanBody = cleanBody.replace(/\n---\nReminder:[\s\S]*$/, "");
            cleanBody = cleanBody.replace(/\n\nReminder: Please attach[\s\S]*$/, "");
          }

          const emlContent = buildEmlFile({
            fromName: senderName,
            fromEmail: senderEmail,
            toName: recipientName,
            toEmail: recipientEmail,
            subject: contact.draftSubject,
            bodyText: cleanBody.trim(),
            brand,
            attachment,
            htmlBody,
          });

          // Sanitise filename: company-name.eml
          const safeName = (contact.reviewedCompanyName || contact.company || "contact")
            .replace(/[^a-zA-Z0-9\s-]/g, "")
            .replace(/\s+/g, "-")
            .toLowerCase();
          const safeRecipient = recipientName
            .replace(/[^a-zA-Z0-9\s-]/g, "")
            .replace(/\s+/g, "-")
            .toLowerCase();
          emlFiles.push({
            filename: `${safeName}--${safeRecipient}.eml`,
            content: emlContent,
          });
        }

        if (emlFiles.length === 0) {
          throw new Error("No contacts with complete drafts found among approved emails.");
        }

        // Build ZIP using archiver
        const archiver = (await import("archiver")).default;
        const { PassThrough } = await import("stream");

        const chunks: Buffer[] = [];
        const passthrough = new PassThrough();
        passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));

        const archive = archiver("zip", { zlib: { level: 5 } });
        archive.pipe(passthrough);

        for (const eml of emlFiles) {
          archive.append(Buffer.from(eml.content, "utf-8"), { name: eml.filename });
        }

        await archive.finalize();

        // Wait for passthrough to finish collecting
        await new Promise<void>((resolve) => passthrough.on("end", resolve));

        const zipBuffer = Buffer.concat(chunks);

        const campaignSlug = (campaign.name || "campaign")
          .replace(/[^a-zA-Z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .toLowerCase();

        const filename = `${campaignSlug}-emails-${emlFiles.length}.zip`;

        // Upload ZIP to S3 instead of returning base64 through tRPC JSON
        // This avoids payload size limits that cause "Unexpected token" errors
        const randomSuffix = Math.random().toString(36).substring(2, 10);
        const s3Key = `campaign-exports/${campaignSlug}-${randomSuffix}.zip`;
        const { url: zipUrl } = await storagePut(s3Key, zipBuffer, "application/zip");

        return {
          zipUrl,
          filename,
          count: emlFiles.length,
          contacts: emlFiles.map(e => e.filename.replace(".eml", "")),
        };
      }),

    // ── Campaign Builder endpoints ──

    /** Preview an uploaded CSV/Excel file — returns headers, sample rows, and auto-detected column mapping */
    previewFile: campaignProcedure
      .input(z.object({
        fileUrl: z.string(),
        sheetName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const response = await fetch(input.fileUrl);
        if (!response.ok) throw new Error("Failed to fetch uploaded file");
        const buffer = Buffer.from(await response.arrayBuffer());
        return previewImportFile(buffer, { sheetName: input.sheetName });
      }),

    /** Import contacts from CSV/Excel with user-confirmed column mapping */
    importWithMapping: campaignProcedure
      .input(z.object({
        campaignId: z.number(),
        fileUrl: z.string(),
        mapping: z.object({
          firstName: z.number().optional(),
          lastName: z.number().optional(),
          fullName: z.number().optional(),
          title: z.number().optional(),
          company: z.number().optional(),
          email: z.number().optional(),
          phone: z.number().optional(),
          mobile: z.number().optional(),
          linkedin: z.number().optional(),
          website: z.number().optional(),
        }),
        sheetName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const response = await fetch(input.fileUrl);
        if (!response.ok) throw new Error("Failed to fetch uploaded file");
        const buffer = Buffer.from(await response.arrayBuffer());
        const parsed = parseImportFile(buffer, input.mapping as ColumnMapping, { sheetName: input.sheetName });
        if (parsed.contacts.length === 0) {
          return { imported: 0, excluded: parsed.skipped, tierBreakdown: {}, errors: parsed.errors };
        }
        const result = await importCampaignContacts(input.campaignId, parsed.contacts);
        return { ...result, errors: parsed.errors };
      }),

    /** Search for contacts at company domains using Hunter.io */
    searchContacts: campaignProcedure
      .input(z.object({
        domains: z.array(z.string()).min(1).max(50),
        targetRoles: z.array(z.string()),
        customRolePatterns: z.array(z.string()).optional(),
        includeNoTitle: z.boolean().optional(),
        maxPerDomain: z.number().min(1).max(100).optional(),
      }))
      .mutation(async ({ input }) => {
        return searchContactsByDomain(input);
      }),

    /** Import contacts from a Hunter.io search result into a campaign */
    importSearchResults: campaignProcedure
      .input(z.object({
        campaignId: z.number(),
        contacts: z.array(z.object({
          firstName: z.string().nullable(),
          lastName: z.string().nullable(),
          title: z.string().nullable(),
          company: z.string(),
          email: z.string().nullable(),
          phone: z.string().nullable(),
          mobile: z.string().nullable(),
          reviewedCompanyName: z.string().nullable(),
          nameCheckStatus: z.string().nullable(),
          reviewNotes: z.string().nullable(),
          sourceRow: z.number(),
        })),
      }))
      .mutation(async ({ input }) => {
        return importCampaignContacts(input.campaignId, input.contacts);
      }),

    /** Analyse an uploaded file to determine if it's contacts or company-only */
    analyseFile: campaignProcedure
      .input(z.object({
        fileUrl: z.string(),
        mapping: z.object({
          firstName: z.number().optional(),
          lastName: z.number().optional(),
          fullName: z.number().optional(),
          title: z.number().optional(),
          company: z.number().optional(),
          email: z.number().optional(),
          phone: z.number().optional(),
          mobile: z.number().optional(),
          linkedin: z.number().optional(),
          website: z.number().optional(),
        }),
        sheetName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const response = await fetch(input.fileUrl);
        if (!response.ok) throw new Error("Failed to fetch uploaded file");
        const buffer = Buffer.from(await response.arrayBuffer());
        return analyseImportFile(buffer, input.mapping as ColumnMapping, { sheetName: input.sheetName });
      }),

    /** Start a background company contact search job (returns jobId for polling) */
    searchCompanyContacts: campaignProcedure
      .input(z.object({
        fileUrl: z.string(),
        mapping: z.object({
          firstName: z.number().optional(),
          lastName: z.number().optional(),
          fullName: z.number().optional(),
          title: z.number().optional(),
          company: z.number().optional(),
          email: z.number().optional(),
          phone: z.number().optional(),
          mobile: z.number().optional(),
          linkedin: z.number().optional(),
          website: z.number().optional(),
        }),
        targetRoles: z.array(z.string()),
        customRolePatterns: z.array(z.string()).optional(),
        maxPerDomain: z.number().min(1).max(100).optional(),
        maxTotal: z.number().min(1).max(5000).optional(),
        sheetName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const response = await fetch(input.fileUrl);
        if (!response.ok) throw new Error("Failed to fetch uploaded file");
        const buffer = Buffer.from(await response.arrayBuffer());
        console.log(`[searchCompanyContacts] File fetched: ${buffer.length} bytes, mapping:`, JSON.stringify(input.mapping));
        const parsed = parseCompanyList(buffer, input.mapping as ColumnMapping, { sheetName: input.sheetName });
        console.log(`[searchCompanyContacts] Parsed: ${parsed.companies.length} companies, ${parsed.skipped} skipped, errors: ${parsed.errors.length}`);
        if (parsed.errors.length > 0) console.log(`[searchCompanyContacts] Parse errors:`, parsed.errors.slice(0, 5));

        if (parsed.companies.length === 0) {
          return { jobId: null, totalCompanies: 0 };
        }

        // Separate companies with and without domains
        const withDomain = parsed.companies.filter(c => c.domain).map(c => ({ company: c.company, domain: c.domain! }));
        const withoutDomain = parsed.companies.filter(c => !c.domain).map(c => ({ company: c.company }));

        // Start background job
        const jobId = startCompanySearch({
          withDomain,
          withoutDomain,
          targetRoles: input.targetRoles,
          customRolePatterns: input.customRolePatterns,
          maxPerCompany: input.maxPerDomain ?? 25,
          maxTotal: input.maxTotal ?? 2000,
        });

        return { jobId, totalCompanies: parsed.companies.length };
      }),

    /** Poll progress of a background company search job */
    companySearchProgress: campaignProcedure
      .input(z.object({ jobId: z.string() }))
      .query(async ({ input }) => {
        const progress = getCompanySearchProgress(input.jobId);
        if (!progress) {
          return {
            status: "not_found" as const,
            phase: "done" as const,
            totalCompanies: 0,
            companiesSearched: 0,
            totalFound: 0,
            totalFiltered: 0,
            companiesWithResults: 0,
            currentCompany: null,
            error: "Job not found — it may have expired",
            elapsedSeconds: 0,
            domainBreakdown: [] as { domain: string; organization: string; found: number; filtered: number }[],
            contacts: [] as any[],
            domainInference: { total: 0, completed: 0, resolved: 0, highConfidence: 0, mediumConfidence: 0 },
          };
        }
        return {
          status: progress.status,
          phase: progress.phase,
          totalCompanies: progress.totalCompanies,
          companiesSearched: progress.companiesSearched,
          totalFound: progress.totalFound,
          totalFiltered: progress.totalFiltered,
          companiesWithResults: progress.companiesWithResults,
          currentCompany: progress.currentCompany,
          error: progress.error,
          elapsedSeconds: progress.elapsedSeconds,
          domainInference: progress.domainInference,
          // Only return full data when completed (saves bandwidth during polling)
          domainBreakdown: progress.status === "completed" ? progress.domainBreakdown : [],
          contacts: progress.status === "completed" ? progress.contacts : [],
        };
      }),

    /** Save the search roles/keywords used in a campaign */
    saveSearchRoles: campaignProcedure
      .input(z.object({
        campaignId: z.number(),
        targetRoles: z.array(z.string()),
        customRoleKeywords: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input }) => {
        await updateCampaign(input.campaignId, {
          targetRoles: input.targetRoles,
          customRoleKeywords: input.customRoleKeywords?.filter(k => k.trim()) || [],
        });
        return { success: true };
      }),

    /** Get available predefined role categories for contact search */
    availableRoles: campaignProcedure
      .query(async () => {
        return getAvailableRoles();
      }),

    // ── Email Template Procedures ──

    /** Get the active template for a campaign (or null) */
    getTemplate: campaignProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        const template = await getCampaignTemplate(input.campaignId);
        return { template, mergeFields: MERGE_FIELDS };
      }),

    /** Save (create or update) a campaign email template */
    saveTemplate: campaignProcedure
      .input(z.object({
        campaignId: z.number(),
        subjectTemplate: z.string().min(1),
        bodyTemplate: z.string().min(1),
        greetingStyle: z.string().min(1),
        signOffStyle: z.string().min(1),
        senderSignature: z.string().optional(),
        name: z.string().optional(),
        templateMode: z.enum(["plaintext", "html"]).optional(),
        htmlTemplate: z.string().nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await upsertCampaignTemplate(input.campaignId, {
          subjectTemplate: input.subjectTemplate,
          bodyTemplate: input.bodyTemplate,
          greetingStyle: input.greetingStyle,
          signOffStyle: input.signOffStyle,
          senderSignature: input.senderSignature,
          name: input.name,
          templateMode: input.templateMode,
          htmlTemplate: input.htmlTemplate,
        }, ctx.user!.id);
        return { success: true, template: result };
      }),

    /** Delete (deactivate) a campaign template */
    deleteTemplate: campaignProcedure
      .input(z.object({ templateId: z.number() }))
      .mutation(async ({ input }) => {
        await deleteCampaignTemplate(input.templateId);
        return { success: true };
      }),

    /** Get the default template (pre-filled for new campaigns) */
    getDefaultTemplate: campaignProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, input.campaignId));
        const defaultTpl = getDefaultTemplate(campaign?.collateralName || undefined);
        const sampleCtx = getSampleContext(campaign || undefined);
        const preview = renderFullEmail(defaultTpl, sampleCtx);
        return { ...defaultTpl, preview, mergeFields: MERGE_FIELDS };
      }),

    /** Preview a template rendered for a specific contact (without saving) */
    previewTemplate: campaignProcedure
      .input(z.object({
        contactId: z.number(),
        subjectTemplate: z.string(),
        bodyTemplate: z.string(),
        greetingStyle: z.string(),
        signOffStyle: z.string(),
        senderSignature: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return previewTemplateForContact(input.contactId, {
          subjectTemplate: input.subjectTemplate,
          bodyTemplate: input.bodyTemplate,
          greetingStyle: input.greetingStyle,
          signOffStyle: input.signOffStyle,
          senderSignature: input.senderSignature,
        });
      }),

    /** Generate email draft from template for a single contact */
    generateFromTemplate: campaignProcedure
      .input(z.object({ contactId: z.number() }))
      .mutation(async ({ input }) => {
        return generateFromTemplate(input.contactId);
      }),

    /** Bulk generate email drafts from template for all contacts in a campaign */
    bulkGenerateFromTemplate: campaignProcedure
      .input(z.object({
        campaignId: z.number(),
        overwriteExisting: z.boolean().optional(),
        onlyWithEmail: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        return bulkGenerateFromTemplate(input.campaignId, {
          overwriteExisting: input.overwriteExisting,
          onlyWithEmail: input.onlyWithEmail,
        });
      }),

    // ── Bulk Actions ──
    /** Approve all send_ready contacts in a campaign that have pending_approval status */
    bulkApproveEmails: adminProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const result = await db.update(campaignContactsTable).set({
          outreachStatus: "approved",
          approvedAt: new Date(),
          approvedBy: ctx.user.id,
        }).where(
          and(
            eq(campaignContactsTable.campaignId, input.campaignId),
            eq(campaignContactsTable.outreachStatus, "pending_approval"),
            eq(campaignContactsTable.sendReadiness, "send_ready"),
          )
        );
        return { approved: result[0]?.affectedRows ?? 0 };
      }),
    /** Bulk reject a list of contacts by ID */
    bulkRejectEmails: adminProcedure
      .input(z.object({ contactIds: z.array(z.number()).min(1) }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const result = await db.update(campaignContactsTable).set({
          outreachStatus: "rejected",
          draftSubject: null,
          draftBody: null,
          draftKeyPoints: null,
          draftTone: null,
          draftGeneratedAt: null,
          approvedAt: null,
          approvedBy: null,
        }).where(inArray(campaignContactsTable.id, input.contactIds));
        return { rejected: result[0]?.affectedRows ?? input.contactIds.length };
      }),
    /** Export blocked/low-confidence contacts as CSV rows */
    exportBlockedContacts: campaignProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return { rows: [], count: 0 };
        const contacts = await db.select().from(campaignContactsTable)
          .where(
            and(
              eq(campaignContactsTable.campaignId, input.campaignId),
              inArray(campaignContactsTable.sendReadiness as any, ["blocked", "low_confidence", "domain_mismatch"]),
            )
          )
          .orderBy(desc(campaignContactsTable.score));
        const rows = contacts.map(c => ({
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(" "),
          title: c.enrichedTitle || c.title || "",
          company: c.reviewedCompanyName || c.company || "",
          email: c.enrichedEmail || c.email || "",
          sendReadiness: c.sendReadiness || "",
          enrichmentSource: c.enrichmentSource || "",
          blockReason: (() => {
            try {
              const qa = c.enrichmentQA as any;
              return qa?.blockingFlags?.join("; ") || qa?.reasoningSummary || "";
            } catch { return ""; }
          })(),
          tier: c.tier || "",
          score: c.score ?? 0,
        }));
        return { rows, count: rows.length };
      }),

    // ── Domain Override Management ──
    /** List all domain overrides for a campaign */
    listDomainOverrides: campaignProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { campaignDomainOverrides } = await import("../drizzle/schema");
        return db.select().from(campaignDomainOverrides)
          .where(eq(campaignDomainOverrides.campaignId, input.campaignId))
          .orderBy(desc(campaignDomainOverrides.createdAt));
      }),
    /** Create a domain override for a company in a campaign */
    createDomainOverride: adminProcedure
      .input(z.object({
        campaignId: z.number(),
        companyNameNormalised: z.string().min(1).max(256),
        approvedDomain: z.string().min(1).max(256),
        subsidiaryName: z.string().max(256).optional(),
        reason: z.string().max(1000).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const { campaignDomainOverrides } = await import("../drizzle/schema");
        await db.insert(campaignDomainOverrides).values({
          campaignId: input.campaignId,
          companyNameNormalised: input.companyNameNormalised.toLowerCase().trim(),
          approvedDomain: input.approvedDomain.toLowerCase().trim(),
          subsidiaryName: input.subsidiaryName || null,
          reason: input.reason || null,
          approvedBy: ctx.user.id,
        });
        return { success: true };
      }),
    /** Delete a domain override */
    deleteDomainOverride: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const { campaignDomainOverrides } = await import("../drizzle/schema");
        await db.delete(campaignDomainOverrides).where(eq(campaignDomainOverrides.id, input.id));
        return { success: true };
      }),

    // ── Stage 1: Pre-waterfall ingestion procedures ──
    ...stagingRouter,
  }),

  // ── Stage 5C: Duplicate detection & merge ──
  duplicates: router({
    /** List all detected duplicate clusters (admin only) */
    listClusters: adminProcedure.query(async () => {
      return findDuplicateClusters();
    }),

    /** Merge a duplicate project into a canonical project (admin only) */
    mergeProject: adminProcedure
      .input(z.object({
        duplicateId: z.number().int().positive(),
        canonicalId: z.number().int().positive(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (input.duplicateId === input.canonicalId) {
          throw new Error("duplicateId and canonicalId must be different");
        }
        await mergeProjectIntoCanonical(input.duplicateId, input.canonicalId, ctx.user.id);
        return { success: true };
      }),

    /** Dismiss a cluster — mark all its projects as not real duplicates (admin only) */
    dismissCluster: adminProcedure
      .input(z.object({
        projectIds: z.array(z.number().int().positive()).min(2),
      }))
      .mutation(async ({ input }) => {
        await dismissDuplicateCluster(input.projectIds);
        return { success: true, dismissed: input.projectIds.length };
      }),

    /** Run the full duplicate detection sweep and persist new cluster IDs (admin only) */
    runSweep: adminProcedure.mutation(async () => {
      const result = await runDuplicateDetectionSweep();
      return { success: true, ...result };
    }),
  }),

  // ── Stage 5D: Project Classification ──────────────────────────────────────
  classification: router({
    /** Classify a single project inline (no DB write) — useful for preview before saving */
    classifyOne: adminProcedure
      .input(z.object({
        name: z.string(),
        stage: z.string().nullable().optional(),
        owner: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        priority: z.string().nullable().optional(),
      }))
      .query(({ input }) => {
        return classifyProjectType({
          name: input.name,
          stage: input.stage,
          owner: input.owner,
          location: input.location,
          priority: input.priority,
        });
      }),

    /** Re-classify all projects in the database and write results back (admin only) */
    bulkClassify: adminProcedure.mutation(async () => {
      const result = await classifyAllProjectTypes();
      return { success: true, ...result };
    }),

    /** Get suppression statistics for the admin panel */
    getStats: adminProcedure.query(async () => {
      return getSuppressionStats();
    }),

    /** Override the suppression flag for a specific project (admin only) */
    setSuppressed: adminProcedure
      .input(z.object({
        projectId: z.number().int().positive(),
        suppressed: z.boolean(),
        suppressionReason: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { projects } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        await db.update(projects)
          .set({
            suppressed: input.suppressed,
            suppressionReason: input.suppressionReason ?? null,
          })
          .where(eq(projects.id, input.projectId));
        return { success: true };
      }),
  }),

  // ─────────────────────────────────────────────────────────────────────────
  // Stage 6A: Emarsys Export
  // ─────────────────────────────────────────────────────────────────────────
  emarsys: router({
    /** Dry-run: returns eligibility counts and exclusion breakdown without writing anything */
    preview: adminProcedure
      .input(z.object({
        campaignId: z.number().int().positive(),
        exportMode: z.enum(["curated_marketing_export", "sales_direct_export"]),
        adminOverrideOpportunityGate: z.boolean().optional().default(false),
        contactIdFilter: z.array(z.number().int().positive()).optional(),
        defaults: z.object({
          divisionLabel: z.string().default("Atlas Copco"),
          salesOrg: z.string().default("AU30"),
          languageTag: z.string().default("en"),
          countryRegion: z.string().default("Australia"),
          collateralName: z.string().optional(),
        }),
      }))
      .query(async ({ input }) => {
        return previewEmarsysExport({
          campaignId: input.campaignId,
          exportMode: input.exportMode as ExportMode,
          defaults: input.defaults as ExportDefaults,
          adminOverrideOpportunityGate: input.adminOverrideOpportunityGate,
          contactIdFilter: input.contactIdFilter,
        });
      }),

    /** Full export: evaluates eligibility, builds CSV, uploads to S3, writes export log, stamps contacts */
    generate: adminProcedure
      .input(z.object({
        campaignId: z.number().int().positive(),
        exportMode: z.enum(["curated_marketing_export", "sales_direct_export"]),
        adminOverrideOpportunityGate: z.boolean().optional().default(false),
        contactIdFilter: z.array(z.number().int().positive()).optional(),
        defaults: z.object({
          divisionLabel: z.string().default("Atlas Copco"),
          salesOrg: z.string().default("AU30"),
          languageTag: z.string().default("en"),
          countryRegion: z.string().default("Australia"),
          collateralName: z.string().optional(),
        }),
      }))
      .mutation(async ({ ctx, input }) => {
        return generateEmarsysExport({
          campaignId: input.campaignId,
          exportMode: input.exportMode as ExportMode,
          exportedByUserId: ctx.user.id,
          exportedByName: ctx.user.name || ctx.user.email || "Admin",
          defaults: input.defaults as ExportDefaults,
          adminOverrideOpportunityGate: input.adminOverrideOpportunityGate,
          contactIdFilter: input.contactIdFilter,
        });
      }),

    /** Get the export history for a campaign */
    getLogs: adminProcedure
      .input(z.object({ campaignId: z.number().int().positive() }))
      .query(async ({ input }) => {
        return getExportLogs(input.campaignId);
      }),

    /** Toggle the emarsysApproved flag on a single contact (admin only) */
    toggleApproval: adminProcedure
      .input(z.object({
        contactId: z.number().int().positive(),
        approved: z.boolean(),
      }))
      .mutation(async ({ ctx, input }) => {
        await toggleEmarsysApproval(input.contactId, input.approved, ctx.user.id);
        return { success: true };
      }),
  }),
  projectActions: projectActionsRouter,
  pilotEnrichment: pilotEnrichmentRouter,
  accountAttack: accountAttackRouter,
  accountResearch: accountResearchRouter,
});
export type AppRouter = typeof appRouter;
