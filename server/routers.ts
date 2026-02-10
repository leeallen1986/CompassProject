import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getLatestReport, getAllReports, getReportById, createReport,
  getProjectsByReportId, createProjects,
  getContactsByReportId, createContacts,
  getDrillingCampaignsByReportId, createDrillingCampaigns,
  getAwardedProjectsByReportId, createAwardedProjects,
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
import { notifyOwner } from "./_core/notification";
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
        let report;
        if (input.reportId) {
          report = await getReportById(input.reportId);
        } else {
          report = await getLatestReport();
        }
        if (!report) return null;

        const [projectsList, contactsList, drillingList, awardedList] = await Promise.all([
          getProjectsByReportId(report.id),
          getContactsByReportId(report.id),
          getDrillingCampaignsByReportId(report.id),
          getAwardedProjectsByReportId(report.id),
        ]);

        // Apply ML ranking if user is authenticated
        let rankedProjects = projectsList;
        let rankings: Awaited<ReturnType<typeof rankProjectsForUser>> | null = null;
        if (ctx.user) {
          rankings = await rankProjectsForUser(ctx.user.id, projectsList);
          rankedProjects = rankings.map(r => r.project);
        }

        return {
          report,
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
