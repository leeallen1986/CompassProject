/**
 * AI Extractor — Takes queued raw articles and extracts structured project data
 * using the built-in LLM. Includes daily credit cap, batch processing, and
 * deduplication against existing projects.
 *
 * Cost controls:
 * - Daily extraction cap (default: 50 articles/day)
 * - Batch processing (5 articles per LLM call)
 * - Only processes articles with status "queued"
 * - Skips articles older than 30 days
 */
import { eq, and, sql, gte, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  rawArticles, projects, reports,
  type RawArticle, type InsertProject,
} from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { generateAndEnrichContacts } from "./contactEnrichment";

// ── Configuration ──

const DAILY_EXTRACTION_CAP = 50;
const BATCH_SIZE = 5;
const MAX_ARTICLE_AGE_DAYS = 30;

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

interface ExtractionResult {
  articleId: number;
  articleTitle: string;
  extracted: boolean;
  project: ExtractedProject | null;
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

For each article that contains a real project or opportunity, extract the following fields. If an article is not relevant (e.g., opinion piece, unrelated industry), mark it as not relevant.

${articleList}

For each article, respond with a JSON object. If the article contains a relevant project, include all fields. If not relevant, set "relevant" to false.

Important scoring rules:
- "hot" = Active project with confirmed funding, named contractors, or imminent mobilisation
- "warm" = Project announced but still in planning/approval stage
- "cold" = Early-stage or speculative, worth monitoring
- capexGrade "A" = Source explicitly states CAPEX value with citation
- capexGrade "B" = CAPEX estimated from project scope
- capexGrade "Unknown" = No CAPEX information available
- opportunityRoute: "Direct CAPEX" = sell equipment directly to project owner; "Fleet CAPEX" = sell to contractor fleet; "OPEX/Monitor" = rental or monitoring opportunity`;
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
                  },
                  required: ["articleId", "relevant"],
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
        isDuplicate: false,
        error: errMsg,
      });
    }
  }

  return results;
}

// ── Check if a project already exists (deduplication) ──

async function isProjectDuplicate(projectName: string, owner: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Simple name-based dedup — check if a project with similar name exists
  const normalizedName = projectName.toLowerCase().trim().replace(/\s+/g, " ");
  const existing = await db.select({ id: projects.id, name: projects.name })
    .from(projects)
    .orderBy(desc(projects.id))
    .limit(200);

  for (const p of existing) {
    const existingNorm = p.name.toLowerCase().trim().replace(/\s+/g, " ");
    // Exact match or high similarity
    if (existingNorm === normalizedName) return true;
    // Check if one contains the other (handles "BHP Olympic Dam Expansion" vs "Olympic Dam Expansion")
    if (existingNorm.includes(normalizedName) || normalizedName.includes(existingNorm)) {
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
      if (result.error) {
        // Mark as failed
        await db.update(rawArticles)
          .set({ status: "failed" })
          .where(eq(rawArticles.id, result.articleId));
        failed++;
        allResults.push(result);
        continue;
      }

      if (!result.extracted || !result.project) {
        // Not relevant — mark as skipped
        await db.update(rawArticles)
          .set({ status: "skipped" })
          .where(eq(rawArticles.id, result.articleId));
        skipped++;
        allResults.push(result);
        continue;
      }

      // Check for duplicate project
      const isDup = await isProjectDuplicate(result.project.name, result.project.owner);
      if (isDup) {
        result.isDuplicate = true;
        await db.update(rawArticles)
          .set({ status: "extracted", extractedAt: new Date(), extractedData: result.project as unknown as Record<string, unknown> })
          .where(eq(rawArticles.id, result.articleId));
        duplicates++;
        allResults.push(result);
        continue;
      }

      // Insert new project
      const article = batch.find(a => a.id === result.articleId);
      const projectKey = `rss-${result.articleId}-${Date.now()}`;

      const projectData: InsertProject = {
        reportId,
        projectKey,
        name: result.project.name,
        location: result.project.location,
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
      };

      const [insertResult] = await db.insert(projects).values(projectData);
      const newProjectId = Number(insertResult.insertId);

      // Mark article as extracted
      await db.update(rawArticles)
        .set({ status: "extracted", extractedAt: new Date(), extractedData: result.project as unknown as Record<string, unknown> })
        .where(eq(rawArticles.id, result.articleId));

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
  if (extracted > 0) {
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
    results: allResults,
  };
}
