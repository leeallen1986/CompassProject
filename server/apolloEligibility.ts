/**
 * Apollo Eligibility Rule Engine
 *
 * Controls when Apollo credits are spent on contact enrichment.
 * Apollo is expensive (1 credit per contact reveal), so we only use it for:
 *
 * 1. Hot priority projects (priority = "hot")
 * 2. Pipeline-claimed projects (user has actively selected for sales pursuit)
 * 3. Explicit user request (manual "Enrich with Apollo" button)
 *
 * Apollo fills gaps rather than doing full enrichment:
 * - Contacts missing verified email
 * - Projects with fewer than MIN_CONTACTS_THRESHOLD contacts
 * - Contacts from web_search or llm sources that need email verification
 *
 * Budget controls:
 * - Daily credit cap (configurable)
 * - Per-project credit cap
 * - Monthly budget tracking
 */

import { eq, and, sql, gte, desc, count } from "drizzle-orm";
import { getDb } from "./db";
import {
  projects,
  contacts,
  pipelineClaims,
  apolloCreditLog,
} from "../drizzle/schema";

// ── Configuration ──

const DAILY_CREDIT_CAP = 500;          // Raised from 300→500 to clear hot-project backlog faster (Jul 2026)
const PER_PROJECT_CREDIT_CAP = 10;     // Max credits per project per auto-enrichment run
const MIN_CONTACTS_THRESHOLD = 3;      // Projects with fewer contacts are eligible for gap-fill
const MONTHLY_BUDGET_CAP = 3500;       // Monthly budget limit raised (= ~160 × 22 working days; Apollo plan: 5000/mo, keep 1500 buffer)

// ── Types ──

export type ApolloEligibilityReason =
  | "hot_priority"
  | "pipeline_claimed"
  | "explicit_request"
  | "gap_fill_needed"
  | "not_eligible";

export interface ApolloEligibilityResult {
  eligible: boolean;
  reason: ApolloEligibilityReason;
  details: string;
  gapAnalysis: {
    totalContacts: number;
    contactsWithEmail: number;
    contactsWithVerifiedEmail: number;
    contactsFromApollo: number;
    contactsFromWebSearch: number;
    contactsFromLLM: number;
    needsMoreContacts: boolean;
    needsEmailVerification: boolean;
  };
  budgetStatus: {
    dailyUsed: number;
    dailyRemaining: number;
    monthlyUsed: number;
    monthlyRemaining: number;
    withinBudget: boolean;
  };
  maxCreditsAllowed: number;
}

export interface ApolloGapFillPlan {
  projectId: number;
  projectName: string;
  actions: ApolloGapAction[];
  estimatedCredits: number;
}

export interface ApolloGapAction {
  type: "verify_email" | "find_additional" | "enrich_contact";
  contactId?: number;
  contactName?: string;
  reason: string;
  estimatedCredits: number;
}

// ── Budget Tracking ──

/**
 * Get the number of Apollo credits used today (auto-enrichment only).
 */
export async function getDailyCreditsUsed(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${apolloCreditLog.creditsUsed}), 0)` })
    .from(apolloCreditLog)
    .where(gte(apolloCreditLog.createdAt, today));

  return Number(row?.total ?? 0);
}

/**
 * Get the number of Apollo credits used this month.
 */
export async function getMonthlyCreditsUsed(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${apolloCreditLog.creditsUsed}), 0)` })
    .from(apolloCreditLog)
    .where(gte(apolloCreditLog.createdAt, monthStart));

  return Number(row?.total ?? 0);
}

/**
 * Get budget status for Apollo credits.
 */
export async function getBudgetStatus(): Promise<{
  dailyUsed: number;
  dailyRemaining: number;
  dailyCap: number;
  monthlyUsed: number;
  monthlyRemaining: number;
  monthlyCap: number;
  withinBudget: boolean;
}> {
  const [dailyUsed, monthlyUsed] = await Promise.all([
    getDailyCreditsUsed(),
    getMonthlyCreditsUsed(),
  ]);

  return {
    dailyUsed,
    dailyRemaining: Math.max(0, DAILY_CREDIT_CAP - dailyUsed),
    dailyCap: DAILY_CREDIT_CAP,
    monthlyUsed,
    monthlyRemaining: Math.max(0, MONTHLY_BUDGET_CAP - monthlyUsed),
    monthlyCap: MONTHLY_BUDGET_CAP,
    withinBudget: dailyUsed < DAILY_CREDIT_CAP && monthlyUsed < MONTHLY_BUDGET_CAP,
  };
}

// ── Gap Analysis ──

/**
 * Analyze the contact gaps for a project.
 * Returns what's missing and what Apollo could fill.
 */
export async function analyzeContactGaps(projectId: number): Promise<{
  totalContacts: number;
  contactsWithEmail: number;
  contactsWithVerifiedEmail: number;
  contactsFromApollo: number;
  contactsFromWebSearch: number;
  contactsFromLLM: number;
  needsMoreContacts: boolean;
  needsEmailVerification: boolean;
  contactsMissingEmail: { id: number; name: string; company: string; source: string }[];
}> {
  const db = await getDb();
  if (!db) {
    return {
      totalContacts: 0,
      contactsWithEmail: 0,
      contactsWithVerifiedEmail: 0,
      contactsFromApollo: 0,
      contactsFromWebSearch: 0,
      contactsFromLLM: 0,
      needsMoreContacts: true,
      needsEmailVerification: false,
      contactsMissingEmail: [],
    };
  }

  // Get project name
  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return {
      totalContacts: 0,
      contactsWithEmail: 0,
      contactsWithVerifiedEmail: 0,
      contactsFromApollo: 0,
      contactsFromWebSearch: 0,
      contactsFromLLM: 0,
      needsMoreContacts: true,
      needsEmailVerification: false,
      contactsMissingEmail: [],
    };
  }

  // Get all contacts for this project
  const projectContacts = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      company: contacts.company,
      email: contacts.email,
      emailVerified: contacts.emailVerified,
      enrichmentSource: contacts.enrichmentSource,
    })
    .from(contacts)
    .where(sql`${contacts.project} = ${project.name}`);

  const totalContacts = projectContacts.length;
  const contactsWithEmail = projectContacts.filter(c => c.email).length;
  const contactsWithVerifiedEmail = projectContacts.filter(c => c.emailVerified).length;
  const contactsFromApollo = projectContacts.filter(c => c.enrichmentSource === "apollo").length;
  const contactsFromWebSearch = projectContacts.filter(c => c.enrichmentSource === "web_search").length;
  const contactsFromLLM = projectContacts.filter(c => c.enrichmentSource === "llm").length;

  const contactsMissingEmail = projectContacts
    .filter(c => !c.email || !c.emailVerified)
    .map(c => ({
      id: c.id,
      name: c.name,
      company: c.company,
      source: c.enrichmentSource || "unknown",
    }));

  return {
    totalContacts,
    contactsWithEmail,
    contactsWithVerifiedEmail,
    contactsFromApollo,
    contactsFromWebSearch,
    contactsFromLLM,
    needsMoreContacts: totalContacts < MIN_CONTACTS_THRESHOLD,
    needsEmailVerification: contactsMissingEmail.length > 0,
    contactsMissingEmail,
  };
}

// ── Eligibility Check ──

/**
 * Check if a project is eligible for automatic Apollo enrichment.
 * This is the core rule engine.
 */
export async function checkApolloEligibility(
  projectId: number,
  options?: { explicitRequest?: boolean }
): Promise<ApolloEligibilityResult> {
  const db = await getDb();
  if (!db) {
    return makeIneligible("Database not available", emptyGapAnalysis(), emptyBudget());
  }

  // Get project details
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      priority: projects.priority,
      lifecycleStatus: projects.lifecycleStatus,
      suppressed: projects.suppressed,
      projectType: projects.projectType,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return makeIneligible("Project not found", emptyGapAnalysis(), emptyBudget());
  }

  // Skip archived/completed projects
  if (project.lifecycleStatus === "archived" || project.lifecycleStatus === "completed") {
    return makeIneligible(
      `Project is ${project.lifecycleStatus} — no enrichment needed`,
      emptyGapAnalysis(),
      emptyBudget()
    );
  }

  // Stage 5D gate: never spend Apollo credits on suppressed projects
  // (macro items, background accounts, program wrappers, completed/cancelled)
  if (project.suppressed) {
    return makeIneligible(
      `Project "${project.name}" is suppressed (projectType: ${project.projectType || 'unknown'}) — Apollo enrichment blocked to conserve credits`,
      emptyGapAnalysis(),
      emptyBudget()
    );
  }

  // Get gap analysis and budget status
  const [gapAnalysis, budgetStatus] = await Promise.all([
    analyzeContactGaps(projectId),
    getBudgetStatus(),
  ]);

  const gapResult = {
    totalContacts: gapAnalysis.totalContacts,
    contactsWithEmail: gapAnalysis.contactsWithEmail,
    contactsWithVerifiedEmail: gapAnalysis.contactsWithVerifiedEmail,
    contactsFromApollo: gapAnalysis.contactsFromApollo,
    contactsFromWebSearch: gapAnalysis.contactsFromWebSearch,
    contactsFromLLM: gapAnalysis.contactsFromLLM,
    needsMoreContacts: gapAnalysis.needsMoreContacts,
    needsEmailVerification: gapAnalysis.needsEmailVerification,
  };

  const budgetResult = {
    dailyUsed: budgetStatus.dailyUsed,
    dailyRemaining: budgetStatus.dailyRemaining,
    monthlyUsed: budgetStatus.monthlyUsed,
    monthlyRemaining: budgetStatus.monthlyRemaining,
    withinBudget: budgetStatus.withinBudget,
  };

  // Rule 0: Explicit user request always allowed (bypasses budget for manual use)
  if (options?.explicitRequest) {
    return {
      eligible: true,
      reason: "explicit_request",
      details: `User explicitly requested Apollo enrichment for "${project.name}"`,
      gapAnalysis: gapResult,
      budgetStatus: budgetResult,
      maxCreditsAllowed: PER_PROJECT_CREDIT_CAP,
    };
  }

  // Budget check for auto-enrichment
  if (!budgetStatus.withinBudget) {
    return makeIneligible(
      `Budget exhausted — daily: ${budgetStatus.dailyUsed}/${DAILY_CREDIT_CAP}, monthly: ${budgetStatus.monthlyUsed}/${MONTHLY_BUDGET_CAP}`,
      gapResult,
      budgetResult
    );
  }

  // No gaps to fill? Skip.
  if (!gapAnalysis.needsMoreContacts && !gapAnalysis.needsEmailVerification) {
    return makeIneligible(
      `Project "${project.name}" has ${gapAnalysis.totalContacts} contacts with ${gapAnalysis.contactsWithVerifiedEmail} verified emails — no gaps to fill`,
      gapResult,
      budgetResult
    );
  }

  // Rule 1: Hot priority projects
  if (project.priority === "hot") {
    return {
      eligible: true,
      reason: "hot_priority",
      details: `Hot priority project "${project.name}" — eligible for Apollo gap-fill`,
      gapAnalysis: gapResult,
      budgetStatus: budgetResult,
      maxCreditsAllowed: Math.min(PER_PROJECT_CREDIT_CAP, budgetStatus.dailyRemaining),
    };
  }

  // Rule 2: Pipeline-claimed projects (user has actively selected for sales pursuit)
  const [claim] = await db
    .select({ id: pipelineClaims.id, status: pipelineClaims.status })
    .from(pipelineClaims)
    .where(eq(pipelineClaims.projectId, projectId))
    .limit(1);

  if (claim) {
    return {
      eligible: true,
      reason: "pipeline_claimed",
      details: `Project "${project.name}" is in sales pipeline (status: ${claim.status}) — eligible for Apollo gap-fill`,
      gapAnalysis: gapResult,
      budgetStatus: budgetResult,
      maxCreditsAllowed: Math.min(PER_PROJECT_CREDIT_CAP, budgetStatus.dailyRemaining),
    };
  }

  // Rule 3: Gap-fill for warm projects with very few contacts
  if (project.priority === "warm" && gapAnalysis.totalContacts === 0) {
    return {
      eligible: true,
      reason: "gap_fill_needed",
      details: `Warm project "${project.name}" has zero contacts — eligible for minimal Apollo gap-fill`,
      gapAnalysis: gapResult,
      budgetStatus: budgetResult,
      maxCreditsAllowed: Math.min(3, budgetStatus.dailyRemaining), // Limited to 3 credits for warm/zero-contact
    };
  }

  // Not eligible for auto-enrichment
  return makeIneligible(
    `Project "${project.name}" (priority: ${project.priority}) does not meet auto-enrichment criteria. Use "Enrich with Apollo" button for manual enrichment.`,
    gapResult,
    budgetResult
  );
}

// ── Gap-Fill Plan ──

/**
 * Build a plan for what Apollo should do for an eligible project.
 * Returns specific actions (verify email, find additional contacts).
 */
export async function buildGapFillPlan(
  projectId: number,
  maxCredits: number = PER_PROJECT_CREDIT_CAP
): Promise<ApolloGapFillPlan> {
  const db = await getDb();
  if (!db) {
    return { projectId, projectName: "Unknown", actions: [], estimatedCredits: 0 };
  }

  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const projectName = project?.name || "Unknown";
  const gapAnalysis = await analyzeContactGaps(projectId);
  const actions: ApolloGapAction[] = [];
  let estimatedCredits = 0;

  // Action 1: Verify emails for existing contacts (1 credit each)
  // Prioritize web_search and llm contacts that don't have verified emails
  const contactsToVerify = gapAnalysis.contactsMissingEmail
    .filter(c => c.source === "web_search" || c.source === "llm" || c.source === "linkedin")
    .slice(0, Math.min(5, maxCredits)); // Max 5 email verifications per run

  for (const contact of contactsToVerify) {
    if (estimatedCredits >= maxCredits) break;
    actions.push({
      type: "verify_email",
      contactId: contact.id,
      contactName: contact.name,
      reason: `Verify email for ${contact.name} (source: ${contact.source})`,
      estimatedCredits: 1,
    });
    estimatedCredits++;
  }

  // Action 2: Find additional contacts if below threshold
  if (gapAnalysis.needsMoreContacts && estimatedCredits < maxCredits) {
    const additionalNeeded = MIN_CONTACTS_THRESHOLD - gapAnalysis.totalContacts;
    const creditsForNew = Math.min(additionalNeeded * 2, maxCredits - estimatedCredits); // 2 credits per new contact (search + reveal)
    actions.push({
      type: "find_additional",
      reason: `Find ${additionalNeeded} more contacts (currently ${gapAnalysis.totalContacts}, target ${MIN_CONTACTS_THRESHOLD})`,
      estimatedCredits: creditsForNew,
    });
    estimatedCredits += creditsForNew;
  }

  return {
    projectId,
    projectName,
    actions,
    estimatedCredits,
  };
}

// ── Batch Eligibility ──

/**
 * Find all projects eligible for automatic Apollo enrichment.
 * Used by the daily pipeline to batch-process eligible projects.
 */
export async function findEligibleProjects(
  maxProjects: number = 20
): Promise<{
  eligible: { projectId: number; projectName: string; reason: ApolloEligibilityReason; maxCredits: number }[];
  totalEligible: number;
  budgetStatus: Awaited<ReturnType<typeof getBudgetStatus>>;
}> {
  const db = await getDb();
  if (!db) {
    return {
      eligible: [],
      totalEligible: 0,
      budgetStatus: {
        dailyUsed: 0, dailyRemaining: 0, dailyCap: DAILY_CREDIT_CAP,
        monthlyUsed: 0, monthlyRemaining: 0, monthlyCap: MONTHLY_BUDGET_CAP,
        withinBudget: false,
      },
    };
  }

  const budget = await getBudgetStatus();
  if (!budget.withinBudget) {
    return {
      eligible: [],
      totalEligible: 0,
      budgetStatus: budget,
    };
  }

  // Get hot priority active non-suppressed opportunity projects
  // Stage 5D gate: exclude suppressed projects (macro items, background accounts, etc.)
  const hotProjects = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(
      and(
        eq(projects.priority, "hot"),
        eq(projects.lifecycleStatus, "active"),
        sql`(${projects.suppressed} IS NULL OR ${projects.suppressed} = 0)`
      )
    );

  // Get pipeline-claimed projects (also excluding suppressed)
  const claimedProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
    })
    .from(projects)
    .innerJoin(pipelineClaims, eq(pipelineClaims.projectId, projects.id))
    .where(
      and(
        eq(projects.lifecycleStatus, "active"),
        sql`(${projects.suppressed} IS NULL OR ${projects.suppressed} = 0)`
      )
    );

  // Merge and deduplicate
  const eligibleMap = new Map<number, { projectId: number; projectName: string; reason: ApolloEligibilityReason }>();

  for (const p of hotProjects) {
    eligibleMap.set(p.id, { projectId: p.id, projectName: p.name, reason: "hot_priority" });
  }
  for (const p of claimedProjects) {
    if (!eligibleMap.has(p.id)) {
      eligibleMap.set(p.id, { projectId: p.id, projectName: p.name, reason: "pipeline_claimed" });
    }
  }

  // Check each for actual gaps
  const eligible: { projectId: number; projectName: string; reason: ApolloEligibilityReason; maxCredits: number }[] = [];
  let creditsAllocated = 0;

  for (const [, entry] of Array.from(eligibleMap)) {
    if (eligible.length >= maxProjects) break;
    if (creditsAllocated >= budget.dailyRemaining) break;

    const gaps = await analyzeContactGaps(entry.projectId);
    if (!gaps.needsMoreContacts && !gaps.needsEmailVerification) continue;

    const maxCredits = Math.min(PER_PROJECT_CREDIT_CAP, budget.dailyRemaining - creditsAllocated);
    eligible.push({ ...entry, maxCredits });
    creditsAllocated += maxCredits;
  }

  return {
    eligible,
    totalEligible: eligible.length,
    budgetStatus: budget,
  };
}

// ── Helpers ──

function emptyGapAnalysis() {
  return {
    totalContacts: 0,
    contactsWithEmail: 0,
    contactsWithVerifiedEmail: 0,
    contactsFromApollo: 0,
    contactsFromWebSearch: 0,
    contactsFromLLM: 0,
    needsMoreContacts: true,
    needsEmailVerification: false,
  };
}

function emptyBudget() {
  return {
    dailyUsed: 0,
    dailyRemaining: 0,
    monthlyUsed: 0,
    monthlyRemaining: 0,
    withinBudget: false,
  };
}

function makeIneligible(
  details: string,
  gapAnalysis: ApolloEligibilityResult["gapAnalysis"],
  budgetStatus: ApolloEligibilityResult["budgetStatus"]
): ApolloEligibilityResult {
  return {
    eligible: false,
    reason: "not_eligible",
    details,
    gapAnalysis,
    budgetStatus,
    maxCreditsAllowed: 0,
  };
}

// ── Exports for testing ──

export const _config = {
  DAILY_CREDIT_CAP,
  PER_PROJECT_CREDIT_CAP,
  MIN_CONTACTS_THRESHOLD,
  MONTHLY_BUDGET_CAP,
};
