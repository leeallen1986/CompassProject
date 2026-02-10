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
} from "./db";

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
    /** Get the current user's profile */
    get: protectedProcedure.query(async ({ ctx }) => {
      return getProfileByUserId(ctx.user.id);
    }),

    /** Update profile (used by onboarding wizard, step by step) */
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

    /** Mark onboarding as completed */
    completeOnboarding: protectedProcedure.mutation(async ({ ctx }) => {
      await completeOnboarding(ctx.user.id);
      return { success: true };
    }),
  }),

  // ── Project Feedback endpoints ──
  feedback: router({
    /** Submit feedback (thumbs up/down) for a project */
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
        return { success: true };
      }),

    /** Get all feedback for the current user on a specific report */
    byReport: protectedProcedure
      .input(z.object({ reportId: z.number() }))
      .query(async ({ ctx, input }) => {
        return getFeedbackByUserAndReport(ctx.user.id, input.reportId);
      }),
  }),

  // ── Intelligence Report endpoints ──
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
      .query(async ({ input }) => {
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

        return {
          report,
          projects: projectsList,
          contacts: contactsList,
          drillingCampaigns: drillingList,
          awardedProjects: awardedList,
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
});

export type AppRouter = typeof appRouter;
