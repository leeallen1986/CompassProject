import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
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
  getActiveProjects,
  verifyContactByUser, rejectContactByUser, getVerificationStats,
} from "./db";
import {
  getAllBusinessLines, getActiveBusinessLines, getBusinessLineById,
  createBusinessLine, updateBusinessLine, deleteBusinessLine,
  getAllRssSources, getActiveRssSources,
  createRssSource, updateRssSource, deleteRssSource,
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
import { sendWeeklyDigests } from "./emailDigest";
import { generateAndSaveLLMContacts, runLLMFallbackBulk } from "./llmContactFallback";
import { searchProjects } from "./aiProjectMatcher";
import {
  apolloPeopleSearch, enrichSingleContact, enrichProjectContacts,
  revealContactEmail, validateApolloApiKey, inferDomain,
  type ApolloEnrichmentResult, type ApolloSearchResult,
} from "./apolloEnrichment";
import { getDb } from "./db";
import { projects, contacts } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";

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
      const count = await markStaleProjects();
      return { success: true, staleCount: count };
    }),

    /** Touch a project to keep it active (called on view/interact) */
    touch: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .mutation(async ({ input }) => {
        await touchProjectActivity(input.projectId);
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
    /** Send digest now — uses force=true to bypass deduplication guard */
    sendNow: adminProcedure.mutation(async () => {
      const results = await sendWeeklyDigests(true);
      return results;
    }),
  }),

  // ── AI Project Search / Matching ──
  search: router({
    projects: protectedProcedure
      .input(z.object({ query: z.string().min(2).max(200) }))
      .mutation(async ({ input }) => {
        return searchProjects(input.query);
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
        lifecycleFilter: z.enum(["all", "active", "stale", "archived", "awarded", "completed"]).optional().default("all"),
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

        // Get the latest report for metadata (executive summary, etc.)
        const report = input.reportId
          ? await getReportById(input.reportId)
          : await getLatestReport();

        // Build aggregate stats from filtered data
        const hot = filteredByLifecycle.filter(p => p.priority === "hot").length;
        const warm = filteredByLifecycle.filter(p => p.priority === "warm").length;
        const cold = filteredByLifecycle.filter(p => p.priority === "cold").length;

        const aggregateReport = report ? {
          ...report,
          totalProjects: filteredByLifecycle.length,
          hotProjects: hot,
          warmProjects: warm,
          coldProjects: cold,
          totalContacts: contactsList.length,
        } : {
          id: 0,
          weekEnding: new Date().toISOString().slice(0, 10),
          generatedTime: new Date().toISOString(),
          totalProjects: filteredByLifecycle.length,
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
        let rankedProjects = filteredByLifecycle;
        let rankings: Awaited<ReturnType<typeof rankProjectsForUser>> | null = null;
        if (ctx.user) {
          rankings = await rankProjectsForUser(ctx.user.id, filteredByLifecycle);
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

        // ── Strategy: Apollo first → LinkedIn fallback → LLM fallback ──

        // Step 1: Try Apollo (primary source)
        let apolloResults: { name: string; status: string; headline?: string; linkedinUrl?: string; email?: string; enrichmentSource?: string }[] = [];
        let apolloFailed = false;

        try {
          const apolloResult = await enrichProjectContacts(
            project.id,
            project.reportId,
            {
              targetTitles: preferredRoles && preferredRoles.length > 0
                ? preferredRoles.map(r => r.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()))
                : undefined,
              maxPerCompany: 5,
              enrichEmails: true,
            }
          );

          apolloResults = apolloResult.people
            .filter(p => p.status === "enriched" || p.status === "found")
            .map(p => ({
              name: p.name,
              status: p.status,
              headline: p.title,
              linkedinUrl: p.linkedinUrl ?? undefined,
              email: p.email ?? undefined,
              enrichmentSource: "apollo",
            }));

          console.log(`[enrichProject] Apollo found ${apolloResults.length} contacts for project ${project.id}`);
        } catch (apolloErr: unknown) {
          apolloFailed = true;
          const msg = apolloErr instanceof Error ? apolloErr.message : String(apolloErr);
          console.error(`[enrichProject] Apollo failed for project ${project.id}: ${msg}`);
        }

        // If Apollo returned contacts, return them
        if (apolloResults.length > 0) {
          return {
            projectId: project.id,
            projectName: project.name,
            contactsFound: apolloResults.length,
            fromCache: false,
            quotaExhausted: false,
            llmFallback: false,
            source: "apollo" as const,
            contacts: apolloResults,
          };
        }

        // Step 2: Apollo returned 0 or failed — try LinkedIn fallback
        let linkedInResults: { name: string; status: string; headline?: string; linkedinUrl?: string; email?: string; enrichmentSource?: string }[] = [];
        let linkedInQuotaExhausted = false;

        try {
          const results = await generateAndEnrichContacts(
            project.id,
            project.reportId,
            project.name,
            project.owner || "Unknown",
            contractorsList,
            project.sector || "infrastructure",
            {
              userId: ctx.user?.id ?? null,
              preferredRoles,
              skipCacheCheck: input.forceRefresh,
            }
          );

          linkedInResults = results.map(r => ({
            name: r.name,
            status: r.status,
            headline: r.headline,
            linkedinUrl: r.linkedinUrl,
            enrichmentSource: "linkedin",
          }));

          console.log(`[enrichProject] LinkedIn found ${linkedInResults.length} contacts for project ${project.id}`);
        } catch (enrichErr: unknown) {
          const msg = enrichErr instanceof Error ? enrichErr.message : String(enrichErr);
          if (msg.includes('usage exhausted') || msg.includes('quota')) {
            linkedInQuotaExhausted = true;
            console.log(`[enrichProject] LinkedIn quota exhausted for project ${project.id}`);
          } else {
            console.error(`[enrichProject] LinkedIn failed: ${msg}`);
          }
        }

        if (linkedInResults.length > 0) {
          return {
            projectId: project.id,
            projectName: project.name,
            contactsFound: linkedInResults.length,
            fromCache: false,
            quotaExhausted: false,
            llmFallback: false,
            source: "linkedin" as const,
            contacts: linkedInResults,
          };
        }

        // Step 3: Both Apollo and LinkedIn failed — try LLM fallback
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
              quotaExhausted: linkedInQuotaExhausted,
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

        // All three sources failed — return existing contacts if any
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
          quotaExhausted: linkedInQuotaExhausted,
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

        const enriched = await enrichSingleContact(person);

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
      .mutation(async ({ input }) => {
        const result = await revealContactEmail(input.contactId);
        return result;
      }),

    /** Validate Apollo API key status */
    apolloStatus: adminProcedure.query(async () => {
      const result = await validateApolloApiKey();
      return result;
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
    run: adminProcedure.mutation(async () => {
      const result = await runDailyPipeline();
      return result;
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
        tone: z.enum(["professional", "consultative", "direct"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await generateOutreachEmail({
          ...input,
          senderName: ctx.user.name || "Team",
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
        tone: z.enum(["professional", "consultative", "direct"]),
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
});

export type AppRouter = typeof appRouter;
