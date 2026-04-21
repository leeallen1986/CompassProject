/**
 * AI Extractor — Takes queued raw articles and extracts structured project data
 * using the built-in LLM. Includes daily credit cap, batch processing, and
 * deduplication against existing projects.
 *
 * Now also extracts:
 * - Awarded projects (contracts awarded to specific contractors)
 * - Drilling campaigns (exploration/production drilling activity)
 *
 * Cost controls:
 * - Daily extraction cap (default: 100 articles/day)
 * - Batch processing (5 articles per LLM call)
 * - Only processes articles with status "queued"
 * - Skips articles older than 30 days
 */
import { eq, and, sql, gte, desc } from "drizzle-orm";
import { getDb, touchProjectSourceSeen } from "./db";
import {
  rawArticles, projects, reports, awardedProjects, drillingCampaigns,
  type RawArticle, type InsertProject, type InsertAwardedProject, type InsertDrillingCampaign,
} from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { generateAndEnrichContacts } from "./contactEnrichment";
import { classifyStage } from "./tierClassification";
import { scoreProjectAsync } from "./businessLineScoring";

// ── Configuration ──

const DAILY_EXTRACTION_CAP = 300;
const BATCH_SIZE = 5;
const MAX_ARTICLE_AGE_DAYS = 30;

// ── Location normalisation ──

const VALID_AU_STATES = ["WA", "NSW", "QLD", "VIC", "SA", "TAS", "NT", "ACT"] as const;

const STATE_FULL_TO_ABBREV: Record<string, string> = {
  "western australia": "WA",
  "new south wales": "NSW",
  "queensland": "QLD",
  "victoria": "VIC",
  "south australia": "SA",
  "tasmania": "TAS",
  "northern territory": "NT",
  "australian capital territory": "ACT",
};

const CITY_TO_STATE: Record<string, string> = {
  "perth": "WA", "karratha": "WA", "port hedland": "WA", "kalgoorlie": "WA",
  "newman": "WA", "geraldton": "WA", "bunbury": "WA", "collie": "WA", "kwinana": "WA",
  "sydney": "NSW", "newcastle": "NSW", "wollongong": "NSW", "broken hill": "NSW",
  "dubbo": "NSW", "muswellbrook": "NSW",
  "brisbane": "QLD", "townsville": "QLD", "cairns": "QLD", "gladstone": "QLD",
  "mackay": "QLD", "rockhampton": "QLD", "mount isa": "QLD", "moranbah": "QLD",
  "toowoomba": "QLD", "gold coast": "QLD",
  "melbourne": "VIC", "geelong": "VIC", "ballarat": "VIC", "bendigo": "VIC",
  "adelaide": "SA", "port augusta": "SA", "whyalla": "SA", "roxby downs": "SA",
  "hobart": "TAS", "launceston": "TAS", "burnie": "TAS", "devonport": "TAS",
  "darwin": "NT", "alice springs": "NT", "katherine": "NT", "tennant creek": "NT",
  "canberra": "ACT",
};

const REGION_TO_STATE: Record<string, string> = {
  "pilbara": "WA", "kimberley": "WA", "goldfields": "WA", "goldfields-esperance": "WA",
  "mid west": "WA", "gascoyne": "WA", "wheatbelt": "WA",
  "hunter valley": "NSW", "hunter region": "NSW", "central coast": "NSW",
  "western sydney": "NSW", "illawarra": "NSW",
  "bowen basin": "QLD", "surat basin": "QLD", "galilee basin": "QLD",
  "gippsland": "VIC", "latrobe valley": "VIC",
  "eyre peninsula": "SA", "cooper basin": "SA", "flinders ranges": "SA",
  "olympic dam": "SA",
};

/**
 * Normalise a location string to "Region/City, STATE" format.
 * Returns null if the location is clearly overseas (triggers geo-filter rejection).
 */
export function normaliseLocation(raw: string): string | null {
  let loc = raw.trim();
  if (!loc || loc === "Unknown") return "National";

  // Reject obvious overseas locations
  const overseasPatterns = [
    /\busa\b/i, /\bunited states\b/i, /\bcanada\b/i, /\buk\b/i, /\bunited kingdom\b/i,
    /\bbrazil\b/i, /\bargentina\b/i, /\bchile\b/i, /\bperu\b/i, /\bmexico\b/i,
    /\bindia\b/i, /\bchina\b/i, /\bindonesia\b/i, /\bvietnam\b/i, /\bjapan\b/i,
    /\bsouth africa\b/i, /\bzambia\b/i, /\btanzania\b/i, /\bmali\b/i, /\bethiopia\b/i,
    /\bsaudi arabia\b/i, /\brussia\b/i, /\bukraine\b/i, /\bgermany\b/i, /\bfrance\b/i,
    /\bsweden\b/i, /\bnorway\b/i, /\bnetherlands\b/i, /\bnew zealand\b/i,
    /\bpapua new guinea\b/i, /\bgreenland\b/i, /\btunisia\b/i, /\begypt\b/i,
  ];
  if (overseasPatterns.some(p => p.test(loc))) return null;

  // Step 1: Replace full state names with abbreviations BEFORE stripping "Australia"
  // (otherwise "Western Australia" → strip "Australia" → leaves orphan "Western")
  for (const [full, abbrev] of Object.entries(STATE_FULL_TO_ABBREV)) {
    const regex = new RegExp(full.replace(/\s+/g, "\\s+"), "gi");
    if (regex.test(loc)) {
      loc = loc.replace(regex, abbrev);
    }
  }

  // Step 2: Remove trailing ", Australia" or "Australia" suffixes
  loc = loc.replace(/,?\s*Australia\s*$/i, "").trim();
  // Also remove embedded "Australia" like ", Australia," mid-string
  loc = loc.replace(/,\s*Australia\s*,/gi, ",").trim();

  // Step 3: Clean up any resulting double commas or trailing commas
  loc = loc.replace(/,\s*,/g, ",").replace(/^,\s*/, "").replace(/,\s*$/, "").trim();

  // If empty after cleanup, it was just "Australia"
  if (!loc) return "National";

  // Step 4: Check if it already ends with a valid state abbreviation
  const parts = loc.split(",").map(s => s.trim()).filter(Boolean);
  const lastPart = parts[parts.length - 1];
  if (VALID_AU_STATES.includes(lastPart as any)) {
    return parts.join(", ");
  }

  // Check if the whole string is a state abbreviation
  if (VALID_AU_STATES.includes(loc as any)) return loc;
  if (loc.toLowerCase() === "national" || loc.toLowerCase() === "nationwide" || loc.toLowerCase() === "australia-wide") return "National";

  const lower = loc.toLowerCase();

  // Step 5: Try to infer state from city names and append
  for (const [city, state] of Object.entries(CITY_TO_STATE)) {
    if (lower.includes(city)) {
      // Check if state abbreviation already present
      if (VALID_AU_STATES.some(s => new RegExp(`\\b${s}\\b`).test(loc))) {
        return parts.join(", ");
      }
      if (lower === city) return `${loc}, ${state}`;
      return `${parts.join(", ")}, ${state}`;
    }
  }

  // Step 6: Try to infer state from region names
  for (const [region, state] of Object.entries(REGION_TO_STATE)) {
    if (lower.includes(region)) {
      if (VALID_AU_STATES.some(s => new RegExp(`\\b${s}\\b`).test(loc))) {
        return parts.join(", ");
      }
      return `${parts.join(", ")}, ${state}`;
    }
  }

  // Step 7: Check for state abbreviation anywhere in the string
  for (const state of VALID_AU_STATES) {
    if (new RegExp(`\\b${state}\\b`).test(loc)) return parts.join(", ");
  }

  // Step 8: Deduplicate any state abbreviation that appears more than once
  for (const st of VALID_AU_STATES) {
    const dupeEnd = new RegExp(`,\\s*${st},\\s*${st}$`);
    if (dupeEnd.test(loc)) {
      loc = loc.replace(dupeEnd, `, ${st}`);
    }
  }

  // Step 9: If "Australia" still appears (e.g. in parens), treat as National
  if (/australia/i.test(loc)) return "National";

  // Can't determine — default to National rather than rejecting
  return "National";
}

// ── Types ──

interface ExtractedProject {
  name: string;
  location: string;
  value: string;
  owner: string;
  priority: "hot" | "warm" | "cold";
  capexGrade: "A" | "B" | "Unknown";
  opportunityRoute: "Direct CAPEX" | "Fleet CAPEX" | "OPEX/Monitor";
  sector: "mining" | "oil_gas" | "infrastructure" | "energy" | "defence";
  stage: string;
  overview: string;
  equipmentSignals: string[];
  contractors: { name: string; status: string; confidence?: number; detail?: string }[];
  opportunityNote: string;
  timeline: string;
  completion: string;
}

interface ExtractedAwardedProject {
  project: string;
  value: string;
  winningContractor: string;
  location: string;
  stage: string;
  opportunity: "Direct" | "Fleet" | "Monitor";
  sourceLabel: string;
}

interface ExtractedDrillingCampaign {
  campaign: string;
  operator: string;
  location: string;
  drillType: string;
  timing: string;
  airRequirement: string;
  sourceLabel: string;
}

interface ExtractionResult {
  articleId: number;
  articleTitle: string;
  extracted: boolean;
  project: ExtractedProject | null;
  awardedProjects: ExtractedAwardedProject[];
  drillingCampaigns: ExtractedDrillingCampaign[];
  isDuplicate: boolean;
  error?: string;
}

interface ExtractionSummary {
  processed: number;
  extracted: number;
  duplicates: number;
  skipped: number;
  failed: number;
  creditsUsed: number;
  awardedProjectsInserted: number;
  drillingCampaignsInserted: number;
  results: ExtractionResult[];
}

// ── Check daily credit usage ──

async function getDailyExtractionCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [result] = await db.select({ count: sql<number>`count(*)` })
    .from(rawArticles)
    .where(and(
      eq(rawArticles.status, "extracted"),
      gte(rawArticles.extractedAt, today)
    ));

  return Number(result.count);
}

// ── LLM extraction prompt ──

function buildExtractionPrompt(articles: { id: number; title: string; summary: string; url: string }[]): string {
  const articleList = articles.map((a, i) =>
    `Article ${i + 1} (ID: ${a.id}):\nTitle: ${a.title}\nSummary: ${a.summary}\nURL: ${a.url}`
  ).join("\n\n---\n\n");

  return `You are an Australian market intelligence analyst for Atlas Copco, a global industrial equipment manufacturer.

Analyze the following articles and extract structured project intelligence relevant to Atlas Copco's Power Technique (PT) division. PT has four business lines:
- Portable Air (portable compressors for mining, construction, drilling, blasting, tunnelling, shotcrete)
- PAL (power generators, lighting towers — QAS/QES generators, HiLight towers)
- Pump / Flow (dewatering pumps, submersible pumps, wellpoint systems — PAS/WEDA series)
- BESS (battery energy storage systems, hybrid power, solar hybrid, peak shaving, microgrids — ZenergiZe range)

CRITICAL GEO-FILTER: Only extract projects, awarded contracts, and drilling campaigns that are located in AUSTRALIA (any Australian state/territory: NSW, QLD, VIC, WA, SA, TAS, NT, ACT). Reject any project located overseas (USA, Canada, UK, Europe, Asia, Africa, South America, New Zealand, etc.) even if an Australian company is involved. If an Australian company (e.g. BHP, Rio Tinto) has a project overseas, mark it as NOT relevant. The location must be within Australia.

LOCATION FORMAT: Always output location in the format "Region/City, STATE" where STATE is the two-letter abbreviation (WA, NSW, QLD, VIC, SA, TAS, NT, ACT). Examples: "Pilbara, WA", "Hunter Valley, NSW", "Bowen Basin, QLD", "Gippsland, VIC". For projects spanning multiple states or Australia-wide, use "National". Never include "Australia" in the location — the state abbreviation is sufficient.

For each article, extract THREE types of intelligence:

1. **Project** — The main project or opportunity described in the article. Must be located in Australia.
2. **Awarded Projects** — Any contracts that have been awarded to specific contractors. Look for phrases like "awarded to", "contract won by", "selected as preferred contractor", "appointed", "engaged to deliver", "contract signed". These are high-value because sales teams need to sell to the winning contractor. Must be in Australia.
3. **Drilling Campaigns** — Any drilling or exploration activity. Look for: drill programs, exploration campaigns, RC drilling, diamond drilling, blast hole drilling, production drilling, water bore drilling. Include the operator, drill type, location, timing, and estimated compressed air requirement. Must be in Australia.

${articleList}

For each article, respond with a JSON object containing:
- "articleId": the article ID
- "relevant": true/false
- "project": the main project (if relevant)
- "awardedProjects": array of awarded contracts found (can be empty)
- "drillingCampaigns": array of drilling campaigns found (can be empty)

An article can have a project AND awarded projects AND drilling campaigns simultaneously.
Even if the main project is not relevant, there might still be awarded contracts or drilling campaigns mentioned.

Important scoring rules:
- "hot" = Active project with confirmed funding, named contractors, or imminent mobilisation
- "warm" = Project announced but still in planning/approval stage
- "cold" = Early-stage or speculative, worth monitoring
- capexGrade "A" = Source explicitly states CAPEX value with citation
- capexGrade "B" = CAPEX estimated from project scope
- capexGrade "Unknown" = No CAPEX information available
- opportunityRoute: "Direct CAPEX" = sell equipment directly to project owner; "Fleet CAPEX" = sell to contractor fleet; "OPEX/Monitor" = rental or monitoring opportunity

For awarded projects:
- opportunity: "Direct" = sell directly to the winning contractor; "Fleet" = sell to their fleet; "Monitor" = watch for subcontractor opportunities

For drilling campaigns:
- airRequirement: estimate compressed air needs based on drill type (e.g., "900 cfm" for RC drilling, "1600 cfm" for large blast hole, "350 cfm" for diamond core)
- drillType: one of "RC", "Diamond Core", "Blast Hole", "Production", "Water Bore", "Geotechnical", "Directional", "Other"`;
}

// ── Extract projects from a batch of articles ──

async function extractBatch(
  articles: { id: number; title: string; summary: string; url: string }[]
): Promise<ExtractionResult[]> {
  const results: ExtractionResult[] = [];

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a market intelligence extraction system. Always respond with valid JSON.",
        },
        {
          role: "user",
          content: buildExtractionPrompt(articles),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extraction_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              articles: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    articleId: { type: "integer" },
                    relevant: { type: "boolean" },
                    project: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        location: { type: "string" },
                        value: { type: "string" },
                        owner: { type: "string" },
                        priority: { type: "string", enum: ["hot", "warm", "cold"] },
                        capexGrade: { type: "string", enum: ["A", "B", "Unknown"] },
                        opportunityRoute: { type: "string", enum: ["Direct CAPEX", "Fleet CAPEX", "OPEX/Monitor"] },
                        sector: { type: "string", enum: ["mining", "oil_gas", "infrastructure", "energy", "defence"] },
                        stage: { type: "string" },
                        overview: { type: "string" },
                        equipmentSignals: { type: "array", items: { type: "string" } },
                        contractors: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              name: { type: "string" },
                              status: { type: "string" },
                              confidence: { type: "number" },
                              detail: { type: "string" },
                            },
                            required: ["name", "status"],
                            additionalProperties: false,
                          },
                        },
                        opportunityNote: { type: "string" },
                        timeline: { type: "string" },
                        completion: { type: "string" },
                      },
                      required: ["name", "location", "value", "owner", "priority", "capexGrade", "opportunityRoute", "sector", "stage", "overview", "equipmentSignals", "contractors", "opportunityNote", "timeline", "completion"],
                      additionalProperties: false,
                    },
                    awardedProjects: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          project: { type: "string" },
                          value: { type: "string" },
                          winningContractor: { type: "string" },
                          location: { type: "string" },
                          stage: { type: "string" },
                          opportunity: { type: "string", enum: ["Direct", "Fleet", "Monitor"] },
                          sourceLabel: { type: "string" },
                        },
                        required: ["project", "value", "winningContractor", "location", "stage", "opportunity", "sourceLabel"],
                        additionalProperties: false,
                      },
                    },
                    drillingCampaigns: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          campaign: { type: "string" },
                          operator: { type: "string" },
                          location: { type: "string" },
                          drillType: { type: "string" },
                          timing: { type: "string" },
                          airRequirement: { type: "string" },
                          sourceLabel: { type: "string" },
                        },
                        required: ["campaign", "operator", "location", "drillType", "timing", "airRequirement", "sourceLabel"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["articleId", "relevant", "awardedProjects", "drillingCampaigns"],
                  additionalProperties: false,
                },
              },
            },
            required: ["articles"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error("Empty LLM response");
    }

    const parsed = JSON.parse(content) as {
      articles: Array<{
        articleId: number;
        relevant: boolean;
        project?: ExtractedProject;
        awardedProjects?: ExtractedAwardedProject[];
        drillingCampaigns?: ExtractedDrillingCampaign[];
      }>;
    };

    for (const extraction of parsed.articles) {
      const article = articles.find(a => a.id === extraction.articleId);
      if (!article) continue;

      results.push({
        articleId: extraction.articleId,
        articleTitle: article.title,
        extracted: extraction.relevant && !!extraction.project,
        project: extraction.project || null,
        awardedProjects: extraction.awardedProjects || [],
        drillingCampaigns: extraction.drillingCampaigns || [],
        isDuplicate: false,
      });
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Mark all articles in this batch as failed
    for (const article of articles) {
      results.push({
        articleId: article.id,
        articleTitle: article.title,
        extracted: false,
        project: null,
        awardedProjects: [],
        drillingCampaigns: [],
        isDuplicate: false,
        error: errMsg,
      });
    }
  }

  return results;
}

// ── Check if a project already exists (deduplication) ──

/**
 * Stage 5A: Returns the matched project ID if a duplicate exists, or null if not..
 * This allows the caller to call touchProjectSourceSeen on the matched project.
 */
async function isProjectDuplicate(projectName: string, _owner: string): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  // Simple name-based dedup — check if a project with similar name exists
  const normalizedName = projectName.toLowerCase().trim().replace(/\s+/g, " ");
  const existing = await db.select({ id: projects.id, name: projects.name })
    .from(projects)
    .orderBy(desc(projects.id))
    .limit(200);
  for (const p of existing) {
    const existingNorm = p.name.toLowerCase().trim().replace(/\s+/g, " ");
    // Exact match or high similarity
    if (existingNorm === normalizedName) return p.id;
    // Check if one contains the other (handles "BHP Olympic Dam Expansion" vs "Olympic Dam Expansion")
    if (existingNorm.includes(normalizedName) || normalizedName.includes(existingNorm)) {
      return p.id;
    }
  }
  return null;
}

// ── Check if an awarded project already exists ──

async function isAwardedDuplicate(projectName: string, contractor: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const normName = projectName.toLowerCase().trim();
  const normContractor = contractor.toLowerCase().trim();

  const existing = await db.select({ project: awardedProjects.project, winningContractor: awardedProjects.winningContractor })
    .from(awardedProjects)
    .orderBy(desc(awardedProjects.id))
    .limit(100);

  for (const a of existing) {
    const existingProject = a.project.toLowerCase().trim();
    const existingContractor = a.winningContractor.toLowerCase().trim();
    if (
      (existingProject === normName || existingProject.includes(normName) || normName.includes(existingProject)) &&
      (existingContractor === normContractor || existingContractor.includes(normContractor) || normContractor.includes(existingContractor))
    ) {
      return true;
    }
  }
  return false;
}

// ── Check if a drilling campaign already exists ──

async function isDrillingDuplicate(campaignName: string, operator: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const normCampaign = campaignName.toLowerCase().trim();
  const normOperator = operator.toLowerCase().trim();

  const existing = await db.select({ campaign: drillingCampaigns.campaign, operator: drillingCampaigns.operator })
    .from(drillingCampaigns)
    .orderBy(desc(drillingCampaigns.id))
    .limit(100);

  for (const d of existing) {
    const existingCampaign = d.campaign.toLowerCase().trim();
    const existingOperator = d.operator.toLowerCase().trim();
    if (
      (existingCampaign === normCampaign || existingCampaign.includes(normCampaign) || normCampaign.includes(existingCampaign)) &&
      (existingOperator === normOperator || existingOperator.includes(normOperator) || normOperator.includes(existingOperator))
    ) {
      return true;
    }
  }
  return false;
}

// ── Main extraction pipeline ──

export async function runExtractionPipeline(maxArticles?: number): Promise<ExtractionSummary> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check daily cap
  const dailyCount = await getDailyExtractionCount();
  const remaining = Math.max(0, DAILY_EXTRACTION_CAP - dailyCount);
  const limit = maxArticles ? Math.min(maxArticles, remaining) : remaining;

  if (limit === 0) {
    return {
      processed: 0,
      extracted: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      creditsUsed: dailyCount,
      awardedProjectsInserted: 0,
      drillingCampaignsInserted: 0,
      results: [],
    };
  }

  // Get queued articles (keyword-matched, not yet extracted)
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - MAX_ARTICLE_AGE_DAYS);

  const queuedArticles = await db.select()
    .from(rawArticles)
    .where(and(
      eq(rawArticles.status, "queued"),
      gte(rawArticles.createdAt, cutoffDate)
    ))
    .orderBy(desc(rawArticles.createdAt))
    .limit(limit);

  if (queuedArticles.length === 0) {
    return {
      processed: 0,
      extracted: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      creditsUsed: dailyCount,
      awardedProjectsInserted: 0,
      drillingCampaignsInserted: 0,
      results: [],
    };
  }

  // Get or create a report for today's extractions
  const today = new Date();
  const weekEnding = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  let reportId: number;
  const existingReport = await db.select()
    .from(reports)
    .where(eq(reports.weekEnding, weekEnding))
    .limit(1);

  if (existingReport.length > 0) {
    reportId = existingReport[0].id;
  } else {
    const [result] = await db.insert(reports).values({
      weekEnding,
      generatedTime: today.toISOString(),
      totalProjects: 0,
      hotProjects: 0,
      warmProjects: 0,
      coldProjects: 0,
      confirmedContractors: 0,
      predictedContractors: 0,
      capexOpportunities: 0,
      totalContacts: 0,
      sourcesSearched: "RSS Pipeline",
      newProjectsCount: 0,
      executiveSummaryMain: "Auto-generated from RSS pipeline extraction.",
    });
    reportId = Number(result.insertId);
  }

  const allResults: ExtractionResult[] = [];
  let extracted = 0;
  let duplicates = 0;
  let skipped = 0;
  let failed = 0;
  let awardedProjectsInserted = 0;
  let drillingCampaignsInserted = 0;

  // Process in batches
  for (let i = 0; i < queuedArticles.length; i += BATCH_SIZE) {
    const batch = queuedArticles.slice(i, i + BATCH_SIZE);
    const batchInput = batch.map(a => ({
      id: a.id,
      title: a.title,
      summary: a.summary || "",
      url: a.url,
    }));

    const batchResults = await extractBatch(batchInput);

    for (const result of batchResults) {
      const article = batch.find(a => a.id === result.articleId);

      if (result.error) {
        // Mark as failed
        await db.update(rawArticles)
          .set({ status: "failed" })
          .where(eq(rawArticles.id, result.articleId));
        failed++;
        allResults.push(result);
        continue;
      }

      // ── Insert awarded projects (even if main project is not relevant) ──
      for (const ap of result.awardedProjects) {
        if (!ap.project || !ap.winningContractor) continue;
        const isDup = await isAwardedDuplicate(ap.project, ap.winningContractor);
        if (isDup) continue;

        try {
          await db.insert(awardedProjects).values({
            reportId,
            project: ap.project.slice(0, 256),
            value: ap.value.slice(0, 64),
            winningContractor: ap.winningContractor.slice(0, 256),
            location: (normaliseLocation(ap.location) || ap.location).slice(0, 256),
            stage: ap.stage.slice(0, 128),
            opportunity: ap.opportunity,
            sourceLabel: ap.sourceLabel?.slice(0, 256) || article?.title?.slice(0, 256) || "RSS Feed",
            sourceUrl: article?.url?.slice(0, 512) || null,
          });
          awardedProjectsInserted++;
          console.log(`[AI Extractor] Awarded project: "${ap.project}" → ${ap.winningContractor}`);
        } catch (err) {
          console.error(`[AI Extractor] Failed to insert awarded project:`, err instanceof Error ? err.message : String(err));
        }
      }

      // ── Insert drilling campaigns (even if main project is not relevant) ──
      for (const dc of result.drillingCampaigns) {
        if (!dc.campaign || !dc.operator) continue;
        const isDup = await isDrillingDuplicate(dc.campaign, dc.operator);
        if (isDup) continue;

        try {
          await db.insert(drillingCampaigns).values({
            reportId,
            campaign: dc.campaign.slice(0, 256),
            operator: dc.operator.slice(0, 256),
            location: (normaliseLocation(dc.location) || dc.location).slice(0, 256),
            drillType: dc.drillType.slice(0, 128),
            timing: dc.timing.slice(0, 128),
            airRequirement: dc.airRequirement.slice(0, 128),
            sourceLabel: dc.sourceLabel?.slice(0, 256) || article?.title?.slice(0, 256) || "RSS Feed",
            sourceUrl: article?.url?.slice(0, 512) || null,
          });
          drillingCampaignsInserted++;
          console.log(`[AI Extractor] Drilling campaign: "${dc.campaign}" by ${dc.operator}`);
        } catch (err) {
          console.error(`[AI Extractor] Failed to insert drilling campaign:`, err instanceof Error ? err.message : String(err));
        }
      }

      if (!result.extracted || !result.project) {
        // Not relevant as a main project — mark as skipped (but awarded/drilling may have been inserted above)
        await db.update(rawArticles)
          .set({ status: "skipped" })
          .where(eq(rawArticles.id, result.articleId));
        skipped++;
        allResults.push(result);
        continue;
      }

      // Check for duplicate project
      const dupProjectId = await isProjectDuplicate(result.project.name, result.project.owner);
      if (dupProjectId !== null) {
        result.isDuplicate = true;
        await db.update(rawArticles)
          .set({ status: "extracted", extractedAt: new Date(), extractedData: result.project as unknown as Record<string, unknown> })
          .where(eq(rawArticles.id, result.articleId));
        // Stage 5A: corroborate the existing project — update sourceLastSeenAt and re-activate if stale
        await touchProjectSourceSeen(dupProjectId, true);
        duplicates++;
        allResults.push(result);
        continue;
      }

      // Insert new project
      const projectKey = `rss-${result.articleId}-${Date.now()}`;

      const projectData: InsertProject = {
        reportId,
        projectKey,
        name: result.project.name,
        location: (normaliseLocation(result.project.location) || result.project.location).slice(0, 256),
        value: result.project.value,
        owner: result.project.owner,
        priority: result.project.priority,
        capexGrade: result.project.capexGrade,
        opportunityRoute: result.project.opportunityRoute,
        sector: result.project.sector,
        isNew: true,
        stage: result.project.stage,
        overview: result.project.overview,
        equipmentSignals: result.project.equipmentSignals,
        contractors: result.project.contractors,
        opportunityNote: result.project.opportunityNote,
        sources: article ? [{ label: "RSS Feed", url: article.url }] : [],
        timeline: result.project.timeline,
        completion: result.project.completion,
        matchedBusinessLines: article?.matchedBusinessLines as number[] ?? null,
        actionTier: classifyStage(result.project.stage),
      };

      const [insertResult] = await db.insert(projects).values(projectData);
      const newProjectId = Number(insertResult.insertId);

      // Mark article as extracted
      await db.update(rawArticles)
        .set({ status: "extracted", extractedAt: new Date(), extractedData: result.project as unknown as Record<string, unknown> })
        .where(eq(rawArticles.id, result.articleId));

      // Auto-score business lines for the new project (non-blocking)
      scoreProjectAsync(newProjectId, "AIExtractor");

      // Auto-enrich contacts for the new project (non-blocking)
      generateAndEnrichContacts(
        newProjectId,
        reportId,
        result.project.name,
        result.project.owner,
        result.project.contractors || [],
        result.project.sector
      ).catch(err => {
        console.error(`Contact enrichment failed for project ${newProjectId}:`, err instanceof Error ? err.message : String(err));
      });

      extracted++;
      allResults.push(result);
    }
  }

  // Update report stats
  if (extracted > 0 || awardedProjectsInserted > 0 || drillingCampaignsInserted > 0) {
    const allProjects = await db.select().from(projects).where(eq(projects.reportId, reportId));
    const hot = allProjects.filter(p => p.priority === "hot").length;
    const warm = allProjects.filter(p => p.priority === "warm").length;
    const cold = allProjects.filter(p => p.priority === "cold").length;

    await db.update(reports).set({
      totalProjects: allProjects.length,
      hotProjects: hot,
      warmProjects: warm,
      coldProjects: cold,
      newProjectsCount: extracted,
    }).where(eq(reports.id, reportId));
  }

  return {
    processed: queuedArticles.length,
    extracted,
    duplicates,
    skipped,
    failed,
    creditsUsed: dailyCount + Math.ceil(queuedArticles.length / BATCH_SIZE),
    awardedProjectsInserted,
    drillingCampaignsInserted,
    results: allResults,
  };
}
