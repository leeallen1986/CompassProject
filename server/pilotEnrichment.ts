/**
 * Pilot-Week Enrichment Workflow
 *
 * Implements a controlled, gated enrichment pass over the current pilot shortlist.
 * This module is the single source of truth for:
 *
 *   Part B — Priority ordering & hard-block rules
 *   Part C — Credit estimation & stop condition
 *   Part D — Orchestration (pilotEnrichmentRun)
 *   Part E — Post-batch QA / sendReadiness refresh
 *
 * Design decisions:
 *   - Enrichment is ONLY triggered for projects on the pilot shortlist
 *     (same filter as scoreAndFilterProjects in emailDigest.ts).
 *   - Hard blocks (suppressed, archived, macro_item, background_account,
 *     program_wrapper) are enforced by checkApolloEligibility() — we do NOT
 *     duplicate that logic here.
 *   - Priority order: hot > warm, then by contactCount ASC (fewest contacts first).
 *   - Stop condition: stop when estimated remaining credits < CREDIT_STOP_BUFFER
 *     OR when the per-run credit cap is reached.
 *   - Dry-run mode: evaluates eligibility and estimates credits but does NOT call
 *     the Apollo API or write any contacts to the database.
 *   - Post-batch QA: after each project enrichment, evaluateEnrichmentQABatch()
 *     is called on the newly created contacts to refresh sendReadiness.
 */

import {
  getPilotShortlist,
  PilotShortlistItem,
  getLatestReport,
} from "./db";
import {
  checkApolloEligibility,
  getBudgetStatus,
  analyzeContactGaps,
} from "./apolloEligibility";
import { enrichProjectContacts } from "./apolloEnrichment";
import {
  evaluateEnrichmentQABatch,
  determineSendReadiness,
  EnrichmentQAInput,
  SendReadiness,
} from "./enrichmentQA";
import { getDb } from "./db";
import { eq, inArray, sql } from "drizzle-orm";
import { contacts, contactProjects } from "../drizzle/schema";

// ── Constants ──

/** Credits to keep in reserve — stop enrichment when remaining < this value */
const CREDIT_STOP_BUFFER = 5;

/**
 * Default per-run credit cap (overridable via options).
 * Set to match DAILY_CREDIT_CAP (50) in apolloEligibility.ts so that
 * buildPilotEnrichmentPlan never requests more credits than the daily budget
 * allows.  The effectiveCap = min(creditCap, dailyHeadroom, monthlyHeadroom)
 * clamp in buildPilotEnrichmentPlan would catch an over-large value anyway,
 * but keeping the constants aligned avoids misleading log output.
 */
const DEFAULT_CREDIT_CAP = 50; // Must equal DAILY_CREDIT_CAP in apolloEligibility.ts

/** Estimated credits per project (conservative: 3 contacts × 1 credit each) */
const CREDITS_PER_PROJECT_ESTIMATE = 3;

// ── Types ──

export interface EnrichmentGatingDecision {
  projectId: number;
  projectName: string;
  priority: "hot" | "warm" | "cold";
  productLane: string | null;
  contactCount: number;
  contactsWithEmail: number;
  hasNoContacts: boolean;
  /** True = eligible for enrichment in this run */
  eligible: boolean;
  /** Human-readable reason for block or approval */
  reason: string;
  /** Estimated Apollo credits this project will consume */
  estimatedCredits: number;
  /** Hard block from checkApolloEligibility (suppressed, archived, etc.) */
  hardBlocked: boolean;
  /** Soft skip: already has sufficient contacts with emails */
  softSkipped: boolean;
}

export interface PilotEnrichmentPlan {
  reportId: number;
  weekKey: string;
  totalShortlisted: number;
  eligible: number;
  hardBlocked: number;
  softSkipped: number;
  estimatedTotalCredits: number;
  creditBudget: {
    dailyRemaining: number;
    monthlyRemaining: number;
    withinBudget: boolean;
  };
  decisions: EnrichmentGatingDecision[];
  /** Projects that would be enriched (eligible=true, within credit cap) */
  toEnrich: EnrichmentGatingDecision[];
  /** True when budget is insufficient for any enrichment */
  budgetInsufficient: boolean;
}

export interface ProjectEnrichmentResult {
  projectId: number;
  projectName: string;
  status: "enriched" | "skipped" | "failed" | "dry_run";
  contactsAdded: number;
  creditsUsed: number;
  qaPassCount: number;
  qaFailCount: number;
  sendReadyCount: number;
  error?: string;
}

export interface PilotEnrichmentRunResult {
  runId: string;
  dryRun: boolean;
  reportId: number;
  weekKey: string;
  startedAt: Date;
  completedAt: Date;
  elapsedMs: number;
  plan: PilotEnrichmentPlan;
  results: ProjectEnrichmentResult[];
  summary: {
    projectsAttempted: number;
    projectsEnriched: number;
    projectsFailed: number;
    projectsSkipped: number;
    totalContactsAdded: number;
    totalCreditsUsed: number;
    totalSendReady: number;
    noContactProjects: number;
  };
}

// ── Part B: Priority ordering ──

/**
 * Sort shortlist items into enrichment priority order:
 *   1. hot projects with hasNoContacts=true (most urgent)
 *   2. hot projects with contactsWithEmail=0 (have contacts but no email)
 *   3. hot projects with any contacts (need verification/top-up)
 *   4. warm projects with hasNoContacts=true
 *   5. warm projects with contactsWithEmail=0
 *   6. warm projects with any contacts
 *
 * Within each tier, sort by contactCount ASC (fewest contacts first).
 */
export function sortByEnrichmentPriority(
  items: PilotShortlistItem[]
): PilotShortlistItem[] {
  const tier = (item: PilotShortlistItem): number => {
    if (item.priority === "hot" && item.hasNoContacts) return 1;
    if (item.priority === "hot" && item.contactsWithEmail === 0) return 2;
    if (item.priority === "hot") return 3;
    if (item.priority === "warm" && item.hasNoContacts) return 4;
    if (item.priority === "warm" && item.contactsWithEmail === 0) return 5;
    return 6;
  };
  return [...items].sort((a, b) => {
    const td = tier(a) - tier(b);
    if (td !== 0) return td;
    return a.contactCount - b.contactCount;
  });
}

// ── Part B: Hard-block rules ──

/**
 * SUFFICIENT_CONTACTS_THRESHOLD — if a project already has this many contacts
 * with verified emails, skip it (soft skip) to conserve credits.
 */
const SUFFICIENT_CONTACTS_THRESHOLD = 3;

/**
 * Evaluate enrichment gating for a single shortlist item.
 * Calls checkApolloEligibility() for hard blocks.
 */
export async function evaluateEnrichmentGating(
  item: PilotShortlistItem
): Promise<EnrichmentGatingDecision> {
  const base: Omit<EnrichmentGatingDecision, "eligible" | "reason" | "estimatedCredits" | "hardBlocked" | "softSkipped"> = {
    projectId: item.id,
    projectName: item.name,
    priority: item.priority,
    productLane: item.productLane,
    contactCount: item.contactCount,
    contactsWithEmail: item.contactsWithEmail,
    hasNoContacts: item.hasNoContacts,
  };

  // Soft skip: already has sufficient verified contacts
  if (item.contactsWithEmail >= SUFFICIENT_CONTACTS_THRESHOLD) {
    return {
      ...base,
      eligible: false,
      hardBlocked: false,
      softSkipped: true,
      reason: `Already has ${item.contactsWithEmail} contacts with email — no enrichment needed`,
      estimatedCredits: 0,
    };
  }

  // Hard-block check via Apollo eligibility service
  const eligibility = await checkApolloEligibility(item.id);
  if (!eligibility.eligible) {
    return {
      ...base,
      eligible: false,
      hardBlocked: true,
      softSkipped: false,
      reason: eligibility.details,
      estimatedCredits: 0,
    };
  }

  // Estimate credits: (target contacts - existing) × 1 credit each
  const target = Math.max(SUFFICIENT_CONTACTS_THRESHOLD, item.contactCount + 2);
  const needed = Math.max(0, target - item.contactsWithEmail);
  const estimatedCredits = Math.min(needed, CREDITS_PER_PROJECT_ESTIMATE);

  return {
    ...base,
    eligible: true,
    hardBlocked: false,
    softSkipped: false,
    reason: `Eligible — ${item.hasNoContacts ? "no contacts yet" : `${item.contactsWithEmail} contacts with email`}`,
    estimatedCredits,
  };
}

// ── Part C: Credit estimation & stop condition ──

/**
 * Build the full enrichment plan for the pilot shortlist.
 * Applies the stop condition: once cumulative estimated credits reach
 * (dailyRemaining - CREDIT_STOP_BUFFER), remaining eligible projects are
 * excluded from toEnrich.
 */
export async function buildPilotEnrichmentPlan(opts?: {
  reportId?: number;
  creditCap?: number;
}): Promise<PilotEnrichmentPlan> {
  const creditCap = opts?.creditCap ?? DEFAULT_CREDIT_CAP;

  // Resolve report
  const report = await getLatestReport();
  const reportId = opts?.reportId ?? report?.id ?? 0;
  const weekKey = getCurrentWeekKeyLocal();

  // Get shortlist
  const shortlist = await getPilotShortlist(reportId);

  // Get budget
  const budget = await getBudgetStatus();
  // Clamp each budget term independently so a small daily remaining doesn't
  // produce a large negative effectiveCap when CREDIT_STOP_BUFFER > dailyRemaining.
  const dailyHeadroom    = Math.max(0, budget.dailyRemaining - CREDIT_STOP_BUFFER);
  const monthlyHeadroom  = Math.max(0, budget.monthlyRemaining - CREDIT_STOP_BUFFER);
  const effectiveCap = Math.min(creditCap, dailyHeadroom, monthlyHeadroom);
  const budgetInsufficient = effectiveCap <= 0;

  // Sort by priority
  const sorted = sortByEnrichmentPriority(shortlist);

  // Evaluate gating for each project
  const decisions: EnrichmentGatingDecision[] = [];
  for (const item of sorted) {
    const decision = await evaluateEnrichmentGating(item);
    decisions.push(decision);
  }

  // Apply stop condition: accumulate credits until cap
  let cumulativeCredits = 0;
  const toEnrich: EnrichmentGatingDecision[] = [];
  for (const d of decisions) {
    if (!d.eligible) continue;
    if (budgetInsufficient) break;
    if (cumulativeCredits + d.estimatedCredits > effectiveCap) break;
    cumulativeCredits += d.estimatedCredits;
    toEnrich.push(d);
  }

  const hardBlocked = decisions.filter(d => d.hardBlocked).length;
  const softSkipped = decisions.filter(d => d.softSkipped).length;
  const eligible = decisions.filter(d => d.eligible).length;
  const estimatedTotalCredits = toEnrich.reduce((s, d) => s + d.estimatedCredits, 0);

  return {
    reportId,
    weekKey,
    totalShortlisted: shortlist.length,
    eligible,
    hardBlocked,
    softSkipped,
    estimatedTotalCredits,
    creditBudget: {
      dailyRemaining: budget.dailyRemaining,
      monthlyRemaining: budget.monthlyRemaining,
      withinBudget: budget.withinBudget,
    },
    decisions,
    toEnrich,
    budgetInsufficient,
  };
}

// ── Part D: Orchestration ──

/**
 * Run the pilot enrichment pass.
 *
 * @param opts.dryRun  - If true, evaluate eligibility and estimate credits but
 *                       do NOT call Apollo or write contacts to DB.
 * @param opts.reportId - Override report ID (defaults to latest).
 * @param opts.creditCap - Override per-run credit cap.
 * @param opts.userId   - User ID for audit logging.
 */
export async function pilotEnrichmentRun(opts?: {
  dryRun?: boolean;
  reportId?: number;
  creditCap?: number;
  userId?: number;
}): Promise<PilotEnrichmentRunResult> {
  const dryRun = opts?.dryRun ?? true; // Default to dry-run for safety
  const startedAt = new Date();
  const runId = `pilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const plan = await buildPilotEnrichmentPlan({
    reportId: opts?.reportId,
    creditCap: opts?.creditCap,
  });

  const results: ProjectEnrichmentResult[] = [];

  if (dryRun) {
    // Dry-run: return plan with dry_run status for each toEnrich project
    for (const d of plan.toEnrich) {
      results.push({
        projectId: d.projectId,
        projectName: d.projectName,
        status: "dry_run",
        contactsAdded: 0,
        creditsUsed: 0,
        qaPassCount: 0,
        qaFailCount: 0,
        sendReadyCount: 0,
      });
    }
    // Also record skipped/blocked projects
    for (const d of plan.decisions.filter(d => !d.eligible)) {
      results.push({
        projectId: d.projectId,
        projectName: d.projectName,
        status: "skipped",
        contactsAdded: 0,
        creditsUsed: 0,
        qaPassCount: 0,
        qaFailCount: 0,
        sendReadyCount: 0,
        error: d.reason,
      });
    }
  } else {
    // Live run: enrich each project in toEnrich order
    for (const d of plan.toEnrich) {
      try {
        const enrichResult = await enrichProjectContacts(
          d.projectId,
          plan.reportId,
          { maxPerCompany: SUFFICIENT_CONTACTS_THRESHOLD + 2 }
        );

        // Part E: post-batch QA — refresh sendReadiness for newly added contacts
        const qaResult = await runPostBatchQA(d.projectId);

        results.push({
          projectId: d.projectId,
          projectName: d.projectName,
          status: "enriched",
          contactsAdded: enrichResult.people.filter(p => p.status === "enriched").length,
          creditsUsed: enrichResult.enrichCreditsUsed,
          qaPassCount: qaResult.passCount,
          qaFailCount: qaResult.failCount,
          sendReadyCount: qaResult.sendReadyCount,
        });
      } catch (err) {
        results.push({
          projectId: d.projectId,
          projectName: d.projectName,
          status: "failed",
          contactsAdded: 0,
          creditsUsed: 0,
          qaPassCount: 0,
          qaFailCount: 0,
          sendReadyCount: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Record skipped/blocked
    for (const d of plan.decisions.filter(d => !d.eligible)) {
      results.push({
        projectId: d.projectId,
        projectName: d.projectName,
        status: "skipped",
        contactsAdded: 0,
        creditsUsed: 0,
        qaPassCount: 0,
        qaFailCount: 0,
        sendReadyCount: 0,
        error: d.reason,
      });
    }
  }

  const completedAt = new Date();
  const enrichedResults = results.filter(r => r.status === "enriched");
  const failedResults = results.filter(r => r.status === "failed");
  const skippedResults = results.filter(r => r.status === "skipped" || r.status === "dry_run");

  return {
    runId,
    dryRun,
    reportId: plan.reportId,
    weekKey: plan.weekKey,
    startedAt,
    completedAt,
    elapsedMs: completedAt.getTime() - startedAt.getTime(),
    plan,
    results,
    summary: {
      projectsAttempted: plan.toEnrich.length,
      projectsEnriched: enrichedResults.length,
      projectsFailed: failedResults.length,
      projectsSkipped: skippedResults.length,
      totalContactsAdded: enrichedResults.reduce((s, r) => s + r.contactsAdded, 0),
      totalCreditsUsed: enrichedResults.reduce((s, r) => s + r.creditsUsed, 0),
      totalSendReady: enrichedResults.reduce((s, r) => s + r.sendReadyCount, 0),
      noContactProjects: plan.decisions.filter(d => d.hasNoContacts).length,
    },
  };
}

// ── Part E: Post-batch QA ──

interface PostBatchQAResult {
  passCount: number;
  failCount: number;
  sendReadyCount: number;
}

/**
 * Run enrichment QA on all contacts for a project and refresh sendReadiness.
 * Called after each project's enrichment pass in pilotEnrichmentRun().
 */
export async function runPostBatchQA(projectId: number): Promise<PostBatchQAResult> {
  const db = await getDb();
  if (!db) return { passCount: 0, failCount: 0, sendReadyCount: 0 };

  // Get project name
  const { projects: projectsTable } = await import("../drizzle/schema");
  const [project] = await db
    .select({ name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) return { passCount: 0, failCount: 0, sendReadyCount: 0 };

  // Get all contacts for this project
  const projectContacts = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      enrichmentSource: contacts.enrichmentSource,
      enrichmentStatus: contacts.enrichmentStatus,
      verificationStatus: contacts.verificationStatus,
      verificationScore: contacts.verificationScore,
      emailVerified: contacts.emailVerified,
      linkedinProfileUrl: contacts.linkedinProfileUrl,
      company: contacts.company,
      title: contacts.title,
    })
    .from(contacts)
    .where(sql`${contacts.project} = ${project.name}`);

  if (projectContacts.length === 0) return { passCount: 0, failCount: 0, sendReadyCount: 0 };

  // Build QA inputs — map to EnrichmentQAInput shape
  const qaInputs: EnrichmentQAInput[] = projectContacts.map(c => {
    const nameParts = (c.name ?? "").trim().split(/\s+/);
    const firstName = nameParts[0] ?? null;
    const lastName = nameParts.slice(1).join(" ") || null;
    // Map enrichmentSource to QA-compatible values
    const srcMap: Record<string, "apollo" | "hunter" | "import" | "manual"> = {
      apollo: "apollo",
      linkedin: "manual",
      manual: "manual",
      web_search: "manual",
      llm: "manual",
    };
    const enrichmentSource = srcMap[c.enrichmentSource ?? "manual"] ?? "manual";
    // Map verificationStatus to QA-compatible values
    const vsMap: Record<string, "valid" | "accept_all" | "unknown" | "invalid"> = {
      verified: "valid",
      ai_suggested: "unknown",
      unverified: "unknown",
    };
    const verificationStatus = vsMap[c.verificationStatus ?? "unverified"] ?? "unknown";
    return {
      firstName,
      lastName,
      title: c.title ?? null,
      company: c.company,
      originalEmail: null,
      enrichedEmail: c.email ?? null,
      enrichmentSource,
      verificationStatus,
      hunterConfidence: null,
      enrichedLinkedin: c.linkedinProfileUrl ?? null,
      enrichedTitle: c.title ?? null,
      finalScore: c.verificationScore ?? 0,
      finalTier: "tier2_warm",
    };
  });

  // Run QA batch
  const qaResults = evaluateEnrichmentQABatch(qaInputs);

  let passCount = 0;
  let failCount = 0;
  let sendReadyCount = 0;

  for (const result of qaResults) {
    const isSendReady = result.sendReadiness === "send_ready";
    if (isSendReady) {
      passCount++;
      sendReadyCount++;
    } else if (result.sendReadiness === "review_before_send") {
      passCount++; // passes QA but needs review
    } else {
      failCount++;
    }
  }

  return { passCount, failCount, sendReadyCount };
}

// ── Utility ──

function getCurrentWeekKeyLocal(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}W${String(weekNo).padStart(2, "0")}`;
}
