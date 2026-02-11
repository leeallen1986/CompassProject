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
import { runExtractionPipeline } from "./aiExtractor";
import { rankProjectsForUser, updateWeightsFromFeedback, recomputeAllWeights } from "./mlRanker";
import { seedDefaultPipelineData } from "./seedPipeline";
import { runEnrichmentPipeline, getEnrichmentStats } from "./contactEnrichment";
import { runDailyPipeline } from "./dailyPipeline";
import { runProjectoryScraper, setProjectoryCookies, getProjectoryCookies } from "./projectoryScraper";
import { ingestProjectoryArticles, proxyFetchUrl } from "./projectoryIngest";
import { runDmirsScraper } from "./dmirsScraper";
import {
  createInvite, completeRegistration, loginWithEmail,
  generatePasswordReset, resetPassword, getEmailUsers, deleteEmailUser,
  validatePassword,
} from "./emailAuth";
import { notifyOwner } from "./_core/notification";
import { generateOutreachEmail, saveOutreachEmail, getOutreachHistory, getUserOutreachHistory } from "./outreachEmail";
import { sendWeeklyDigests } from "./emailDigest";
import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { eq } from "drizzle-orm";

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

  // ── Email Digest Preferences endpoints ──
  emailDigest: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      return getEmailDigestPrefs(ctx.user.id);
    }),

    update: protectedProcedure
      .input(z.object({
        enabled: z.boolean().optional(),
        frequency: z.enum(["weekly", "daily", "none"]).optional(),
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
    sendNow: adminProcedure.mutation(async () => {
      const results = await sendWeeklyDigests();
      return results;
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
      .input(z.object({ reportId: z.number().optional() }))
      .query(async ({ ctx, input }) => {
        // Always fetch ALL projects across all reports for the unified dashboard
        const [projectsList, contactsList, drillingList, awardedList] = await Promise.all([
          getAllProjects(),
          getAllContacts(),
          getAllDrillingCampaigns(),
          getAllAwardedProjects(),
        ]);

        // Get the latest report for metadata (executive summary, etc.)
        const report = input.reportId
          ? await getReportById(input.reportId)
          : await getLatestReport();

        // Build aggregate stats from actual data
        const hot = projectsList.filter(p => p.priority === "hot").length;
        const warm = projectsList.filter(p => p.priority === "warm").length;
        const cold = projectsList.filter(p => p.priority === "cold").length;

        const aggregateReport = report ? {
          ...report,
          totalProjects: projectsList.length,
          hotProjects: hot,
          warmProjects: warm,
          coldProjects: cold,
          totalContacts: contactsList.length,
        } : {
          id: 0,
          weekEnding: new Date().toISOString().slice(0, 10),
          generatedTime: new Date().toISOString(),
          totalProjects: projectsList.length,
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
        let rankedProjects = projectsList;
        let rankings: Awaited<ReturnType<typeof rankProjectsForUser>> | null = null;
        if (ctx.user) {
          rankings = await rankProjectsForUser(ctx.user.id, projectsList);
          rankedProjects = rankings.map(r => r.project);
        }

        return {
          report: aggregateReport,
          projects: rankedProjects,
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
      await notifyOwner({
        title: "RSS Harvest Complete",
        content: `Fetched ${result.totalFetched} articles from ${result.totalSources} sources. ${result.totalNew} new, ${result.totalDuplicates} duplicates, ${result.totalErrors} errors.`,
      });
      return result;
    }),

    /** Trigger AI extraction (admin only) */
    extract: adminProcedure
      .input(z.object({ maxArticles: z.number().optional() }).optional())
      .mutation(async ({ input }) => {
        const result = await runExtractionPipeline(input?.maxArticles);
        if (result.extracted > 0) {
          await notifyOwner({
            title: "AI Extraction Complete",
            content: `Extracted ${result.extracted} projects from ${result.processed} articles. ${result.duplicates} duplicates, ${result.failed} failed. Credits used today: ${result.creditsUsed}.`,
          });
        }
        return result;
      }),

    /** Trigger contact enrichment (admin only) */
    enrich: adminProcedure
      .input(z.object({ maxContacts: z.number().optional() }).optional())
      .mutation(async ({ input }) => {
        const result = await runEnrichmentPipeline(input?.maxContacts);
        if (result.enriched > 0) {
          await notifyOwner({
            title: "Contact Enrichment Complete",
            content: `Enriched ${result.enriched} contacts. ${result.notFound} not found, ${result.failed} failed. Daily usage: ${result.dailyUsed}/30.`,
          });
        }
        return result;
      }),

    /** Get enrichment stats */
    enrichmentStats: protectedProcedure.query(async () => {
      return getEnrichmentStats();
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
        if (result.totalNewProjects > 0) {
          await notifyOwner({
            title: "Projectory Scrape Complete",
            content: `Scraped ${result.totalScraped} articles from ${result.totalCategories} categories. ${result.totalNewProjects} new projects, ${result.totalNewContacts} new contacts, ${result.totalDuplicates} duplicates. Duration: ${result.duration}s.`,
          });
        }
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
        if (result.totalNewProjects > 0) {
          await notifyOwner({
            title: "Projectory Ingest Complete",
            content: `Ingested ${result.totalReceived} articles. ${result.totalNewProjects} new projects, ${result.totalNewContacts} new contacts, ${result.totalDuplicates} duplicates.`,
          });
        }
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
        if (result.totalNewProjects > 0) {
          await notifyOwner({
            title: "DMIRS Scrape Complete",
            content: `Scraped ${result.totalFetched} registrations from DMIRS MINEDEX. ${result.totalNewProjects} new projects, ${result.totalDuplicates} duplicates, ${result.totalSkipped} skipped. Duration: ${result.duration}s.`,
          });
        }
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
