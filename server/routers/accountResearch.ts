/**
 * Account Attack Phase 2 — AI Synthesis Router
 *
 * Bounded AI synthesis over Atlas internal context.
 * No web search. No external scraping. No model-memory-as-fact.
 * User-initiated only. Structured output only.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { getDb } from "../db";
import { getProfileByUserId } from "../db";
import { accountResearchRuns } from "../../drizzle/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";

// ══════════════════════════════════════════════════
// TTL by objective (days)
// ══════════════════════════════════════════════════
const OBJECTIVE_TTL_DAYS: Record<string, number> = {
  general_account_review: 30,
  new_logo: 14,
  grow_installed_base: 30,
  displace_competitor: 14,
  pursue_live_tender: 7,
  map_stakeholders: 30,
  prepare_account_review: 30,
};

// ══════════════════════════════════════════════════
// Token caps by depth
// ══════════════════════════════════════════════════
const DEPTH_TOKEN_CAPS: Record<string, number> = {
  quick: 4096,
  standard: 8192,
  deep: 16384,
};

// ══════════════════════════════════════════════════
// Zod schemas for input
// ══════════════════════════════════════════════════
const researchInputSchema = z.object({
  accountName: z.string().min(1),
  objective: z.string().min(1),
  lensMode: z.enum(["focused", "balanced", "open"]),
  ptLaneFocus: z.string().optional(),
  researchDepth: z.enum(["quick", "standard", "deep"]).default("quick"),
  knownProjectId: z.number().optional(),
  // The full account context from Phase 1 (passed from client)
  accountContext: z.object({
    account: z.any(),
    opportunities: z.array(z.any()),
    stakeholders: z.array(z.any()),
    contractors: z.array(z.any()),
    contractorPairings: z.array(z.any()),
    actionHistory: z.array(z.any()),
    collateral: z.array(z.any()),
  }),
});

// ══════════════════════════════════════════════════
// Research trigger evaluation
// ══════════════════════════════════════════════════
const evaluateTrigger = protectedProcedure
  .input(z.object({
    accountName: z.string().min(1),
    objective: z.string().min(1),
    lensMode: z.enum(["focused", "balanced", "open"]),
    ptLaneFocus: z.string().optional(),
    researchDepth: z.enum(["quick", "standard", "deep"]).default("quick"),
    knownProjectId: z.number().optional(),
    // Lightweight summary for trigger evaluation (no full context needed)
    stakeholderCount: z.number(),
    highRelevanceStakeholderCount: z.number(),
    opportunityCount: z.number(),
    hotOpportunityCount: z.number(),
    hasActionHistory: z.boolean(),
    hasCollateral: z.boolean(),
    accountType: z.string(),
    laneDistribution: z.record(z.string(), z.number()),
  }))
  .query(async ({ input, ctx }) => {
    const db = await getDb();
    const reasons: string[] = [];
    let recommended = false;

    // Check for fresh cached result
    if (db) {
      const cacheKey = buildCacheKey(input);
      const ttlDays = OBJECTIVE_TTL_DAYS[input.objective] || 30;
      const freshCutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

      const existing = await db
        .select({ id: accountResearchRuns.id, status: accountResearchRuns.status, createdAt: accountResearchRuns.createdAt })
        .from(accountResearchRuns)
        .where(and(
          eq(accountResearchRuns.accountName, cacheKey.accountName),
          eq(accountResearchRuns.objective, cacheKey.objective),
          eq(accountResearchRuns.lensMode, cacheKey.lensMode),
        sql`${accountResearchRuns.researchDepth} = ${cacheKey.researchDepth}`,
        gte(accountResearchRuns.createdAt, freshCutoff),
      ))
      .orderBy(desc(accountResearchRuns.createdAt))
      .limit(1);

      if (existing.length > 0 && existing[0].status === "complete") {
        return {
          recommended: false,
          reasons: ["Fresh research exists for this account + objective + lens combination."],
          hasFreshResult: true,
          freshResultId: existing[0].id,
        };
      }
    }

    // Trigger conditions
    if (input.highRelevanceStakeholderCount === 0) {
      recommended = true;
      reasons.push("No high-relevance stakeholders found — AI synthesis can map likely buying committee roles.");
    }

    if (input.hotOpportunityCount > 0 && input.stakeholderCount < 3) {
      recommended = true;
      reasons.push("Live HOT opportunity exists but route-to-buy visibility is weak (fewer than 3 stakeholders).");
    }

    if (input.objective === "displace_competitor") {
      recommended = true;
      reasons.push("Competitor displacement objective selected — AI can analyse contractor chain for displacement angles.");
    }

    if (input.objective === "map_stakeholders") {
      recommended = true;
      reasons.push("Stakeholder mapping objective selected.");
    }

    if (input.knownProjectId && input.stakeholderCount < 5) {
      recommended = true;
      reasons.push("Specific project/tender selected but account context is shallow.");
    }

    if (input.accountType === "Government / Public Body" && input.stakeholderCount < 3) {
      recommended = true;
      reasons.push("Government account with limited contact coverage — AI can suggest engagement pathways.");
    }

    // Do NOT recommend conditions
    if (input.opportunityCount <= 1 && input.stakeholderCount === 0 && !input.hasActionHistory) {
      if (input.researchDepth === "quick") {
        recommended = false;
        reasons.length = 0;
        reasons.push("Account activity is too weak to justify research at Quick depth. Consider Standard or Deep if you want to explore.");
      }
    }

    if (reasons.length === 0 && !recommended) {
      reasons.push("Internal data appears sufficient for this account. Research is available if you want deeper synthesis.");
    }

    return {
      recommended,
      reasons,
      hasFreshResult: false,
      freshResultId: null,
    };
  });

// ══════════════════════════════════════════════════
// Cache key builder
// ══════════════════════════════════════════════════
function buildCacheKey(input: {
  accountName: string;
  objective: string;
  lensMode: string;
  ptLaneFocus?: string;
  researchDepth: string;
  knownProjectId?: number;
}) {
  return {
    accountName: input.accountName,
    objective: input.objective,
    lensMode: input.lensMode,
    ptLaneFocus: input.ptLaneFocus || null,
    researchDepth: input.researchDepth,
    knownProjectId: input.knownProjectId || null,
  };
}

// ══════════════════════════════════════════════════
// Get cached research result
// ══════════════════════════════════════════════════
const getCachedResult = protectedProcedure
  .input(z.object({
    accountName: z.string().min(1),
    objective: z.string().min(1),
    lensMode: z.enum(["focused", "balanced", "open"]),
    ptLaneFocus: z.string().optional(),
    researchDepth: z.enum(["quick", "standard", "deep"]).default("quick"),
    knownProjectId: z.number().optional(),
  }))
  .query(async ({ input }) => {
    const db = await getDb();
    if (!db) return null;

    const cacheKey = buildCacheKey(input);
    const ttlDays = OBJECTIVE_TTL_DAYS[input.objective] || 30;
    const freshCutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

    const results = await db
      .select()
      .from(accountResearchRuns)
      .where(and(
        eq(accountResearchRuns.accountName, cacheKey.accountName),
        eq(accountResearchRuns.objective, cacheKey.objective),
        eq(accountResearchRuns.lensMode, cacheKey.lensMode),
        sql`${accountResearchRuns.researchDepth} = ${cacheKey.researchDepth}`,
      ))
      .orderBy(desc(accountResearchRuns.createdAt))
      .limit(1);

    if (results.length === 0) return null;

    const result = results[0];
    const isStale = new Date(result.expiresAt) < new Date();
    const isFresh = new Date(result.createdAt) >= freshCutoff;

    return {
      ...result,
      isStale,
      isFresh,
    };
  });

// ══════════════════════════════════════════════════
// LLM prompt construction
// ══════════════════════════════════════════════════
function buildSystemPrompt(depth: string): string {
  return `You are an AI sales intelligence analyst for Atlas Copco Portable Air division.
Your job is to synthesise ONLY the internal account data provided to you into structured sales intelligence.

CRITICAL RULES:
1. You may ONLY use facts from the provided Atlas internal context.
2. If you use general knowledge or typical-org inference, you MUST mark it:
   - source: "ai_inferred"
   - confidence: "low"
   - sourceNote: "Inferred from model knowledge — verify before use"
3. NEVER invent named people. If no named person exists, return role-level placeholders only.
4. NEVER present company facts from your training data as verified Atlas facts.
5. Every recommended action MUST reference a visible element (project, stakeholder, contractor, tender, collateral) via evidenceRef.
6. If an action cannot be tied to visible evidence, mark it as "Suggested (unverified)" with confidence "low".
7. Keep output concise and operator-usable. ${depth === "quick" ? "Be brief — 1-2 sentences per section." : depth === "standard" ? "Be thorough but concise." : "Be comprehensive but still bounded — no essays."}
8. All output must be valid JSON matching the required schema exactly.`;
}

function buildUserPrompt(input: {
  accountName: string;
  objective: string;
  lensMode: string;
  ptLaneFocus?: string;
  researchDepth: string;
  knownProjectId?: number;
  accountContext: any;
  sellerContext: {
    assignedBusinessLines?: string[];
    territories?: string[];
    buyerRoles?: string[];
    sectorFocus?: string[];
  };
}): string {
  const ctx = input.accountContext;
  const seller = input.sellerContext;

  // Build a compact text representation of the account context
  const sections: string[] = [];

  // Account header
  sections.push(`## Account: ${input.accountName}
Type: ${ctx.account?.accountType || "Unknown"}
Projects: ${ctx.account?.projectCount || 0} (HOT: ${ctx.account?.hotCount || 0}, WARM: ${ctx.account?.warmCount || 0}, COLD: ${ctx.account?.coldCount || 0})
Sectors: ${JSON.stringify(ctx.account?.sectorDistribution || {})}
States: ${JSON.stringify(ctx.account?.stateDistribution || {})}
PT Lane Distribution: ${JSON.stringify(ctx.account?.laneDistribution || {})}`);

  // Opportunities (cap at 15 for prompt size)
  const opps = (ctx.opportunities || []).slice(0, 15);
  if (opps.length > 0) {
    sections.push(`## Current Opportunities (${opps.length} shown of ${ctx.opportunities?.length || 0})
${opps.map((o: any) => `- [id:${o.id}] ${o.name} | Priority: ${o.priority} | Lane: ${o.productLane || "unclassified"} | Location: ${o.location || "?"} | Value: ${o.value || "?"} | Stage: ${o.stage || o.stageCode || "?"} | Lifecycle: ${o.lifecycleStatus || "active"}${o.tenderCloseDate ? ` | Tender closes: ${o.tenderCloseDate}` : ""}`).join("\n")}`);
  }

  // Stakeholders (cap at 20)
  const stakes = (ctx.stakeholders || []).slice(0, 20);
  if (stakes.length > 0) {
    sections.push(`## Known Stakeholders (${stakes.length} shown of ${ctx.stakeholders?.length || 0})
${stakes.map((s: any) => `- [id:${s.id}] ${s.name} | Title: ${s.title || "?"} | Company: ${s.company || "?"} | Relevance: ${s.roleRelevance || "?"} | Email: ${s.email ? "yes" : "no"} | LinkedIn: ${s.linkedin ? "yes" : "no"} | Source: ${s.enrichmentSource || "?"} | Projects: ${(s.linkedProjectNames || []).join(", ")}`).join("\n")}`);
  } else {
    sections.push(`## Known Stakeholders: NONE`);
  }

  // Contractors (cap at 10)
  const contractors = (ctx.contractors || []).slice(0, 10);
  if (contractors.length > 0) {
    sections.push(`## Contractor & Delivery Chain (${contractors.length} shown)
${contractors.map((c: any) => `- [id:${c.id}] ${c.name} | Role: ${c.primaryRole} | Projects: ${c.projectCount} | Score: ${c.compositeScore || "?"}`).join("\n")}`);
  }

  // Pairings (cap at 8)
  const pairings = (ctx.contractorPairings || []).slice(0, 8);
  if (pairings.length > 0) {
    sections.push(`## Known Pairings
${pairings.map((p: any) => `- ${p.companyAName} (${p.companyARoleInPairing}) + ${p.companyBName} (${p.companyBRoleInPairing}) | Type: ${p.pairingType} | Co-occurrences: ${p.coOccurrenceCount} | Score: ${p.strengthScore}`).join("\n")}`);
  }

  // Action history (cap at 10)
  const actions = (ctx.actionHistory || []).slice(0, 10);
  if (actions.length > 0) {
    sections.push(`## Action History (${actions.length} shown)
${actions.map((a: any) => `- ${a.contactName} | Project: ${a.projectName || "?"} | ${a.subject} | Status: ${a.status} | Date: ${a.createdAt}`).join("\n")}`);
  }

  // Collateral (cap at 5)
  const collateral = (ctx.collateral || []).slice(0, 5);
  if (collateral.length > 0) {
    sections.push(`## Matched Collateral (${collateral.length} shown)
${collateral.map((c: any) => `- [id:${c.id}] ${c.name} | Product: ${c.productLine} | Matched to: ${c.matchedProjectName} | Score: ${c.matchScore}`).join("\n")}`);
  }

  // Seller context
  sections.push(`## Seller Context
Business Lines: ${(seller.assignedBusinessLines || ["Portable Air"]).join(", ")}
Territories: ${(seller.territories || ["All"]).join(", ")}
Buyer Roles of Interest: ${(seller.buyerRoles || ["procurement", "project_manager", "engineering"]).join(", ")}
Sector Focus: ${(seller.sectorFocus || ["All"]).join(", ")}
Lens Mode: ${input.lensMode} (${input.lensMode === "focused" ? "primary lane only" : input.lensMode === "balanced" ? "primary lane boosted, adjacent visible" : "all lanes equal"})
PT Lane Focus: ${input.ptLaneFocus || "Portable Air (default)"}
Objective: ${input.objective.replace(/_/g, " ")}
Research Depth: ${input.researchDepth}`);

  if (input.knownProjectId) {
    const targetProject = opps.find((o: any) => o.id === input.knownProjectId);
    if (targetProject) {
      sections.push(`## Target Project/Tender
[id:${targetProject.id}] ${targetProject.name} | Priority: ${targetProject.priority} | Lane: ${targetProject.productLane || "?"} | Value: ${targetProject.value || "?"}`);
    }
  }

  return sections.join("\n\n");
}

// ══════════════════════════════════════════════════
// Structured output JSON schema for LLM
// ══════════════════════════════════════════════════
const RESEARCH_OUTPUT_SCHEMA = {
  name: "account_research_output",
  strict: true,
  schema: {
    type: "object",
    properties: {
      stakeholderMap: {
        type: "array",
        description: "Stakeholder map entries. Atlas-known contacts first, then AI-inferred role placeholders.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Person name or '[Role Placeholder]' if no named person" },
            title: { type: "string", description: "Job title or likely role" },
            company: { type: "string", description: "Company name" },
            likelyRole: { type: "string", description: "Likely buying committee role (e.g. Decision Maker, Technical Influencer, Procurement, End User, Gatekeeper)" },
            buyingCommitteeLane: { type: "string", description: "Which PT lane this person is relevant to (e.g. Portable Air, BESS, Nitrogen, Generators, Dewatering, Cross-sell, Unknown)" },
            source: { type: "string", description: "atlas_known | ai_inferred" },
            confidence: { type: "string", description: "high | medium | low" },
            sourceNote: { type: "string", description: "Explanation of where this data comes from" },
            laneRelevance: { type: "string", description: "primary | adjacent | cross_sell | unknown" },
            laneRelevanceNote: { type: "string", description: "Why this person matters for the seller's lane" },
            enrichmentStatus: { type: "string", description: "verified | unverified | needs_enrichment | role_placeholder" },
            hasEmail: { type: "boolean", description: "Whether Atlas has an email for this person" },
            hasLinkedin: { type: "boolean", description: "Whether Atlas has a LinkedIn URL" },
            contactStatus: { type: "string", description: "active | stale | unknown" },
            nextStep: { type: "string", description: "Recommended next step for this stakeholder" },
            evidenceRef: { type: "string", description: "Reference to Atlas data: stakeholder:{id} or project:{id} or 'ai_inferred'" },
            atlasContactId: { type: ["integer", "null"], description: "Atlas contact ID if known, null if AI-inferred" },
          },
          required: ["name", "title", "company", "likelyRole", "buyingCommitteeLane", "source", "confidence", "sourceNote", "laneRelevance", "laneRelevanceNote", "enrichmentStatus", "hasEmail", "hasLinkedin", "contactStatus", "nextStep", "evidenceRef", "atlasContactId"],
          additionalProperties: false,
        },
      },
      salesBrief: {
        type: "object",
        description: "Lane-aware sales brief with 11 sections",
        properties: {
          accountSummary: {
            type: "object",
            properties: {
              text: { type: "string" },
              sourceTag: { type: "string", description: "atlas_known | ai_inferred | mixed" },
              confidence: { type: "string" },
              sourceNote: { type: "string" },
            },
            required: ["text", "sourceTag", "confidence", "sourceNote"],
            additionalProperties: false,
          },
          whyThisAccountMatters: {
            type: "object",
            properties: {
              text: { type: "string" },
              sourceTag: { type: "string" },
              confidence: { type: "string" },
              sourceNote: { type: "string" },
            },
            required: ["text", "sourceTag", "confidence", "sourceNote"],
            additionalProperties: false,
          },
          currentOpportunities: {
            type: "object",
            properties: {
              text: { type: "string" },
              sourceTag: { type: "string" },
              confidence: { type: "string" },
              sourceNote: { type: "string" },
            },
            required: ["text", "sourceTag", "confidence", "sourceNote"],
            additionalProperties: false,
          },
          routeToBuy: {
            type: "object",
            properties: {
              text: { type: "string" },
              sourceTag: { type: "string" },
              confidence: { type: "string" },
              sourceNote: { type: "string" },
            },
            required: ["text", "sourceTag", "confidence", "sourceNote"],
            additionalProperties: false,
          },
          contractorPicture: {
            type: "object",
            properties: {
              text: { type: "string" },
              sourceTag: { type: "string" },
              confidence: { type: "string" },
              sourceNote: { type: "string" },
            },
            required: ["text", "sourceTag", "confidence", "sourceNote"],
            additionalProperties: false,
          },
          ptLaneFit: {
            type: "object",
            properties: {
              text: { type: "string" },
              sourceTag: { type: "string" },
              confidence: { type: "string" },
              sourceNote: { type: "string" },
            },
            required: ["text", "sourceTag", "confidence", "sourceNote"],
            additionalProperties: false,
          },
          secondaryPtLaneOpportunities: {
            type: "object",
            properties: {
              text: { type: "string" },
              sourceTag: { type: "string" },
              confidence: { type: "string" },
              sourceNote: { type: "string" },
            },
            required: ["text", "sourceTag", "confidence", "sourceNote"],
            additionalProperties: false,
          },
          crossSellAdjacentLane: {
            type: "object",
            properties: {
              text: { type: "string" },
              sourceTag: { type: "string" },
              confidence: { type: "string" },
              sourceNote: { type: "string" },
            },
            required: ["text", "sourceTag", "confidence", "sourceNote"],
            additionalProperties: false,
          },
          keyRisksBlockers: {
            type: "object",
            properties: {
              text: { type: "string" },
              sourceTag: { type: "string" },
              confidence: { type: "string" },
              sourceNote: { type: "string" },
            },
            required: ["text", "sourceTag", "confidence", "sourceNote"],
            additionalProperties: false,
          },
          recommendedNextActions: {
            type: "object",
            properties: {
              text: { type: "string" },
              sourceTag: { type: "string" },
              confidence: { type: "string" },
              sourceNote: { type: "string" },
            },
            required: ["text", "sourceTag", "confidence", "sourceNote"],
            additionalProperties: false,
          },
          suggestedCollateral: {
            type: "object",
            properties: {
              text: { type: "string" },
              sourceTag: { type: "string" },
              confidence: { type: "string" },
              sourceNote: { type: "string" },
            },
            required: ["text", "sourceTag", "confidence", "sourceNote"],
            additionalProperties: false,
          },
        },
        required: [
          "accountSummary", "whyThisAccountMatters", "currentOpportunities",
          "routeToBuy", "contractorPicture", "ptLaneFit",
          "secondaryPtLaneOpportunities", "crossSellAdjacentLane",
          "keyRisksBlockers", "recommendedNextActions", "suggestedCollateral",
        ],
        additionalProperties: false,
      },
      recommendedActions: {
        type: "array",
        description: "Prioritised recommended actions with evidence linking",
        items: {
          type: "object",
          properties: {
            action: { type: "string", description: "Clear, actionable text" },
            priority: { type: "string", description: "high | medium | low" },
            evidenceRef: { type: "string", description: "Reference: project:{id}, stakeholder:{id}, contractor:{id}, tender:{id}, collateral:{id}, or 'ai_inferred'" },
            source: { type: "string", description: "atlas_known | ai_inferred | mixed" },
            sourceNote: { type: "string", description: "Why this action is recommended" },
            confidence: { type: "string", description: "high | medium | low" },
            isVerified: { type: "boolean", description: "True if action is tied to visible Atlas evidence, false if inferred" },
          },
          required: ["action", "priority", "evidenceRef", "source", "sourceNote", "confidence", "isVerified"],
          additionalProperties: false,
        },
      },
    },
    required: ["stakeholderMap", "salesBrief", "recommendedActions"],
    additionalProperties: false,
  },
};

// ══════════════════════════════════════════════════
// Run Research mutation
// ══════════════════════════════════════════════════
const runResearch = protectedProcedure
  .input(researchInputSchema)
  .mutation(async ({ input, ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const userId = ctx.user?.id;
    if (!userId) throw new Error("User not authenticated");

    const cacheKey = buildCacheKey(input);
    const ttlDays = OBJECTIVE_TTL_DAYS[input.objective] || 30;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    // Rate limit: check for running or recent fresh result
    const freshCutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
    const existing = await db
      .select({ id: accountResearchRuns.id, status: accountResearchRuns.status })
      .from(accountResearchRuns)
      .where(and(
        eq(accountResearchRuns.accountName, cacheKey.accountName),
        eq(accountResearchRuns.objective, cacheKey.objective),
        eq(accountResearchRuns.lensMode, cacheKey.lensMode),
        sql`${accountResearchRuns.researchDepth} = ${cacheKey.researchDepth}`,
        gte(accountResearchRuns.createdAt, freshCutoff),
      ))
      .orderBy(desc(accountResearchRuns.createdAt))
      .limit(1);

    if (existing.length > 0 && existing[0].status === "running") {
      throw new Error("Research is already running for this account + objective combination. Please wait.");
    }

    // Fetch seller context from user profile
    const profile = await getProfileByUserId(userId);
    const sellerContext = {
      assignedBusinessLines: profile?.assignedBusinessLines || ["Portable Air"],
      territories: profile?.territories || [],
      buyerRoles: profile?.buyerRoles || [],
      sectorFocus: profile?.sectorFocus || [],
    };

    // Create the run record (status = running)
    const insertResult = await db.insert(accountResearchRuns).values({
      accountName: cacheKey.accountName,
      objective: cacheKey.objective,
      lensMode: cacheKey.lensMode,
      ptLaneFocus: cacheKey.ptLaneFocus,
      researchDepth: cacheKey.researchDepth as "quick" | "standard" | "deep",
      knownProjectId: cacheKey.knownProjectId,
      sellerLaneContext: JSON.stringify(sellerContext),
      userId,
      status: "running",
      inputContext: {
        accountSummary: input.accountContext.account,
        opportunityCount: input.accountContext.opportunities?.length || 0,
        stakeholderCount: input.accountContext.stakeholders?.length || 0,
        contractorCount: input.accountContext.contractors?.length || 0,
      },
      expiresAt,
    });

    const runId = insertResult[0].insertId;

    // Build LLM messages
    const systemPrompt = buildSystemPrompt(input.researchDepth);
    const userPrompt = buildUserPrompt({
      ...input,
      sellerContext,
    });

    const maxTokens = DEPTH_TOKEN_CAPS[input.researchDepth] || 4096;

    try {
      const llmResult = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: RESEARCH_OUTPUT_SCHEMA,
        },
        maxTokens,
      });

      const content = llmResult.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new Error("LLM returned empty or non-string content");
      }

      const parsed = JSON.parse(content);

      // Validate and sanitise: ensure no invented named stakeholders without evidence
      const sanitisedStakeholders = (parsed.stakeholderMap || []).map((s: any) => {
        if (s.source === "ai_inferred" && s.atlasContactId !== null) {
          // AI should not claim an Atlas ID — force to null
          s.atlasContactId = null;
        }
        if (s.source === "ai_inferred" && s.confidence !== "low") {
          s.confidence = "low";
        }
        if (s.source === "ai_inferred" && !s.sourceNote?.includes("verify")) {
          s.sourceNote = (s.sourceNote || "") + " — Inferred from model knowledge — verify before use";
        }
        return s;
      });

      // Validate recommended actions: demote unverified
      const sanitisedActions = (parsed.recommendedActions || []).map((a: any) => {
        if (!a.evidenceRef || a.evidenceRef === "ai_inferred") {
          a.isVerified = false;
          a.confidence = "low";
          if (!a.sourceNote?.includes("unverified")) {
            a.sourceNote = (a.sourceNote || "") + " [Suggested — unverified]";
          }
        }
        return a;
      });

      // Cap unverified actions
      const verifiedActions = sanitisedActions.filter((a: any) => a.isVerified);
      const unverifiedActions = sanitisedActions.filter((a: any) => !a.isVerified).slice(0, 2);
      const finalActions = [...verifiedActions, ...unverifiedActions];

      // Update run record with results
      await db.update(accountResearchRuns)
        .set({
          status: "complete",
          stakeholderMap: sanitisedStakeholders,
          salesBrief: parsed.salesBrief,
          recommendedActions: finalActions,
          promptTokens: llmResult.usage?.prompt_tokens || null,
          completionTokens: llmResult.usage?.completion_tokens || null,
          totalTokens: llmResult.usage?.total_tokens || null,
        })
        .where(eq(accountResearchRuns.id, runId));

      return {
        runId,
        status: "complete" as const,
        stakeholderMap: sanitisedStakeholders,
        salesBrief: parsed.salesBrief,
        recommendedActions: finalActions,
        tokenUsage: llmResult.usage || null,
      };

    } catch (error: any) {
      // Update run record with error
      await db.update(accountResearchRuns)
        .set({
          status: "failed",
          errorMessage: error.message || "Unknown error during research",
        })
        .where(eq(accountResearchRuns.id, runId));

      return {
        runId,
        status: "failed" as const,
        errorMessage: error.message || "Unknown error during research",
        stakeholderMap: null,
        salesBrief: null,
        recommendedActions: null,
        tokenUsage: null,
      };
    }
  });

// ══════════════════════════════════════════════════
// Get research by ID
// ══════════════════════════════════════════════════
const getResearchById = protectedProcedure
  .input(z.object({ runId: z.number() }))
  .query(async ({ input }) => {
    const db = await getDb();
    if (!db) return null;

    const results = await db
      .select()
      .from(accountResearchRuns)
      .where(eq(accountResearchRuns.id, input.runId))
      .limit(1);

    if (results.length === 0) return null;

    const result = results[0];
    const isStale = new Date(result.expiresAt) < new Date();

    return { ...result, isStale };
  });

// ══════════════════════════════════════════════════
// Export router
// ══════════════════════════════════════════════════
export const accountResearchRouter = router({
  evaluateTrigger,
  getCachedResult,
  runResearch,
  getResearchById,
});
