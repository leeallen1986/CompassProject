from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 regex match, found {count}")
    return updated


ai_path = Path("server/aiExtractor.ts")
ai = ai_path.read_text()

ai = replace_once(
    ai,
    'import { invokeLLM } from "./_core/llm";',
    'import { invokeLLM } from "./_core/llm";\n'
    'import { parseLLMJson } from "./_core/llmErrors";\n'
    'import {\n'
    '  classifyExtractionFailure,\n'
    '  incrementFailureCategory,\n'
    '  safeExtractionFailureMessage,\n'
    '  shouldDeferExtractionFailure,\n'
    '  sortedFailureCategoryCounts,\n'
    '  withExtractionAttemptMetadata,\n'
    '  type ExtractionFailureCategory,\n'
    '  type ExtractionFailureCategoryCounts,\n'
    '} from "./aiExtractionHealth";',
    "aiExtractor imports",
)

new_interfaces = r'''interface ExtractionResult {
  articleId: number;
  articleTitle: string;
  extracted: boolean;
  project: ExtractedProject | null;
  awardedProjects: ExtractedAwardedProject[];
  drillingCampaigns: ExtractedDrillingCampaign[];
  isDuplicate: boolean;
  error?: string;
  failureCategory?: ExtractionFailureCategory;
  deferred?: boolean;
  attemptedAt: string;
  providerCallAttempted: boolean;
  providerCallSucceeded: boolean;
}

interface ExtractionBatchResult {
  results: ExtractionResult[];
  providerCallAttempted: boolean;
  providerCallSucceeded: boolean;
  stopAfterBatch: boolean;
}

export interface ExtractionSummary {
  selected: number;
  processed: number;
  extracted: number;
  duplicates: number;
  skipped: number;
  failed: number;
  deferred: number;
  sideEffectFailures: number;
  providerCallsAttempted: number;
  providerCallsSucceeded: number;
  creditsUsed: number;
  failureCategories: ExtractionFailureCategoryCounts;
  awardedProjectsInserted: number;
  drillingCampaignsInserted: number;
  results: ExtractionResult[];
}

export interface ExtractionRunOptions {
  maxArticles?: number;
  pipelineRunId?: number | null;
}

function normalizeExtractionOptions(
  value?: number | ExtractionRunOptions,
): Required<ExtractionRunOptions> {
  if (typeof value === "number") {
    return { maxArticles: value, pipelineRunId: null };
  }
  return {
    maxArticles: value?.maxArticles ?? Number.POSITIVE_INFINITY,
    pipelineRunId: value?.pipelineRunId ?? null,
  };
}'''

ai = regex_once(
    ai,
    r'interface ExtractionResult \{.*?interface ExtractionSummary \{.*?\n\}',
    new_interfaces,
    "aiExtractor interfaces",
)

new_extract_batch = r'''async function extractBatch(
  articles: { id: number; title: string; summary: string; url: string }[],
  attemptedAt: string,
): Promise<ExtractionBatchResult> {
  const results: ExtractionResult[] = [];

  try {
    const response = await invokeLLM({
      feature: "ai_extraction",
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

    const parsed = parseLLMJson<{
      articles: Array<{
        articleId: number;
        relevant: boolean;
        project?: ExtractedProject;
        awardedProjects?: ExtractedAwardedProject[];
        drillingCampaigns?: ExtractedDrillingCampaign[];
      }>;
    }>(content);

    if (!Array.isArray(parsed.articles)) {
      throw new SyntaxError("Schema response did not contain an articles array");
    }

    const seenArticleIds = new Set<number>();
    for (const extraction of parsed.articles) {
      const article = articles.find(a => a.id === extraction.articleId);
      if (!article || seenArticleIds.has(extraction.articleId)) continue;
      seenArticleIds.add(extraction.articleId);

      if (extraction.relevant && !extraction.project) {
        const category: ExtractionFailureCategory = "schema_or_json_parse";
        results.push({
          articleId: extraction.articleId,
          articleTitle: article.title,
          extracted: false,
          project: null,
          awardedProjects: extraction.awardedProjects || [],
          drillingCampaigns: extraction.drillingCampaigns || [],
          isDuplicate: false,
          error: safeExtractionFailureMessage(category),
          failureCategory: category,
          deferred: true,
          attemptedAt,
          providerCallAttempted: true,
          providerCallSucceeded: true,
        });
        continue;
      }

      results.push({
        articleId: extraction.articleId,
        articleTitle: article.title,
        extracted: extraction.relevant && !!extraction.project,
        project: extraction.project || null,
        awardedProjects: extraction.awardedProjects || [],
        drillingCampaigns: extraction.drillingCampaigns || [],
        isDuplicate: false,
        attemptedAt,
        providerCallAttempted: true,
        providerCallSucceeded: true,
      });
    }

    for (const article of articles) {
      if (seenArticleIds.has(article.id)) continue;
      const category: ExtractionFailureCategory = "missing_article_result";
      results.push({
        articleId: article.id,
        articleTitle: article.title,
        extracted: false,
        project: null,
        awardedProjects: [],
        drillingCampaigns: [],
        isDuplicate: false,
        error: safeExtractionFailureMessage(category),
        failureCategory: category,
        deferred: true,
        attemptedAt,
        providerCallAttempted: true,
        providerCallSucceeded: true,
      });
    }

    return {
      results,
      providerCallAttempted: true,
      providerCallSucceeded: true,
      stopAfterBatch: results.some(result => result.deferred === true),
    };
  } catch (error: unknown) {
    const category = classifyExtractionFailure(error);
    const deferred = shouldDeferExtractionFailure(category);
    const safeMessage = safeExtractionFailureMessage(category);
    console.warn("[AI Extractor] Batch extraction failed", {
      category,
      articleCount: articles.length,
    });

    for (const article of articles) {
      results.push({
        articleId: article.id,
        articleTitle: article.title,
        extracted: false,
        project: null,
        awardedProjects: [],
        drillingCampaigns: [],
        isDuplicate: false,
        error: safeMessage,
        failureCategory: category,
        deferred,
        attemptedAt,
        providerCallAttempted: true,
        providerCallSucceeded: false,
      });
    }

    return {
      results,
      providerCallAttempted: true,
      providerCallSucceeded: false,
      stopAfterBatch: deferred,
    };
  }
}'''

ai = regex_once(
    ai,
    r'async function extractBatch\(.*?\n\}\n\n// ── Check if a project already exists',
    new_extract_batch + '\n\n// ── Check if a project already exists',
    "extractBatch",
)

ai = replace_once(
    ai,
    'export async function runExtractionPipeline(maxArticles?: number): Promise<ExtractionSummary> {\n'
    '  const db = await getDb();',
    'export async function runExtractionPipeline(\n'
    '  optionsOrMaxArticles?: number | ExtractionRunOptions,\n'
    '): Promise<ExtractionSummary> {\n'
    '  const options = normalizeExtractionOptions(optionsOrMaxArticles);\n'
    '  const maxArticles = Number.isFinite(options.maxArticles) ? options.maxArticles : undefined;\n'
    '  const pipelineRunId = options.pipelineRunId;\n'
    '  const db = await getDb();',
    "runExtractionPipeline signature",
)

old_empty = '''    return {
      processed: 0,
      extracted: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      creditsUsed: dailyCount,
      awardedProjectsInserted: 0,
      drillingCampaignsInserted: 0,
      results: [],
    };'''
new_empty = '''    return {
      selected: 0,
      processed: 0,
      extracted: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
      sideEffectFailures: 0,
      providerCallsAttempted: 0,
      providerCallsSucceeded: 0,
      creditsUsed: 0,
      failureCategories: {},
      awardedProjectsInserted: 0,
      drillingCampaignsInserted: 0,
      results: [],
    };'''
count = ai.count(old_empty)
if count != 2:
    raise SystemExit(f"empty summaries: expected 2 matches, found {count}")
ai = ai.replace(old_empty, new_empty)

ai = replace_once(
    ai,
    '''  const allResults: ExtractionResult[] = [];
  let extracted = 0;
  let duplicates = 0;
  let skipped = 0;
  let failed = 0;
  let awardedProjectsInserted = 0;
  let drillingCampaignsInserted = 0;''',
    '''  const allResults: ExtractionResult[] = [];
  let processed = 0;
  let extracted = 0;
  let duplicates = 0;
  let skipped = 0;
  let failed = 0;
  let deferred = 0;
  let sideEffectFailures = 0;
  let providerCallsAttempted = 0;
  let providerCallsSucceeded = 0;
  let failureCategories: ExtractionFailureCategoryCounts = {};
  let awardedProjectsInserted = 0;
  let drillingCampaignsInserted = 0;''',
    "extraction counters",
)

ai = replace_once(
    ai,
    '''  for (let i = 0; i < queuedArticles.length; i += BATCH_SIZE) {
    const batch = queuedArticles.slice(i, i + BATCH_SIZE);
    const batchInput = batch.map(a => ({
      id: a.id,
      title: a.title,
      summary: a.summary || "",
      url: a.url,
    }));

    const batchResults = await extractBatch(batchInput);

    for (const result of batchResults) {
      const article = batch.find(a => a.id === result.articleId);''',
    '''  for (let i = 0; i < queuedArticles.length; i += BATCH_SIZE) {
    const batchIndex = Math.floor(i / BATCH_SIZE);
    const batch = queuedArticles.slice(i, i + BATCH_SIZE);
    const batchInput = batch.map(a => ({
      id: a.id,
      title: a.title,
      summary: a.summary || "",
      url: a.url,
    }));
    const batchAttemptedAt = new Date().toISOString();
    const batchOutcome = await extractBatch(batchInput, batchAttemptedAt);
    providerCallsAttempted += batchOutcome.providerCallAttempted ? 1 : 0;
    providerCallsSucceeded += batchOutcome.providerCallSucceeded ? 1 : 0;
    processed += batchOutcome.results.length;

    for (const result of batchOutcome.results) {
      const article = batch.find(a => a.id === result.articleId);
      const metadata = (
        outcome: "extracted" | "duplicate" | "skipped" | "deferred" | "failed",
        failureCategory: ExtractionFailureCategory | null,
        existing: unknown = article?.extractedData,
      ) => withExtractionAttemptMetadata(existing, {
        pipelineRunId,
        batchIndex,
        attemptedAt: result.attemptedAt,
        outcome,
        failureCategory,
        providerCallAttempted: result.providerCallAttempted,
        providerCallSucceeded: result.providerCallSucceeded,
      });''',
    "batch loop start",
)

ai = replace_once(
    ai,
    '''      if (result.error) {
        // Mark as failed
        await db.update(rawArticles)
          .set({ status: "failed" })
          .where(eq(rawArticles.id, result.articleId));
        failed++;
        allResults.push(result);
        continue;
      }''',
    '''      if (result.error) {
        const category = result.failureCategory ?? "unknown";
        failureCategories = incrementFailureCategory(failureCategories, category);
        if (result.deferred) {
          await db.update(rawArticles)
            .set({
              status: "queued",
              extractedData: metadata("deferred", category) as any,
            })
            .where(eq(rawArticles.id, result.articleId));
          deferred++;
        } else {
          await db.update(rawArticles)
            .set({
              status: "failed",
              extractedData: metadata("failed", category) as any,
            })
            .where(eq(rawArticles.id, result.articleId));
          failed++;
        }
        allResults.push(result);
        continue;
      }''',
    "error handling",
)

ai = replace_once(
    ai,
    '''        } catch (err) {
          console.error(`[AI Extractor] Failed to insert awarded project:`, err instanceof Error ? err.message : String(err));
        }''',
    '''        } catch {
          sideEffectFailures++;
          failureCategories = incrementFailureCategory(failureCategories, "database_insert_error");
          console.error("[AI Extractor] Awarded-project insert failed", {
            category: "database_insert_error",
          });
        }''',
    "awarded insert failure",
)
ai = replace_once(
    ai,
    '''        } catch (err) {
          console.error(`[AI Extractor] Failed to insert drilling campaign:`, err instanceof Error ? err.message : String(err));
        }''',
    '''        } catch {
          sideEffectFailures++;
          failureCategories = incrementFailureCategory(failureCategories, "database_insert_error");
          console.error("[AI Extractor] Drilling-campaign insert failed", {
            category: "database_insert_error",
          });
        }''',
    "drilling insert failure",
)

ai = replace_once(
    ai,
    '''        await db.update(rawArticles)
          .set({ status: "skipped" })
          .where(eq(rawArticles.id, result.articleId));''',
    '''        await db.update(rawArticles)
          .set({
            status: "skipped",
            extractedData: metadata("skipped", null) as any,
          })
          .where(eq(rawArticles.id, result.articleId));''',
    "skipped metadata",
)

ai = replace_once(
    ai,
    '''        await db.update(rawArticles)
          .set({ status: "extracted", extractedAt: new Date(), extractedData: result.project as unknown as Record<string, unknown> })
          .where(eq(rawArticles.id, result.articleId));''',
    '''        await db.update(rawArticles)
          .set({
            status: "extracted",
            extractedAt: new Date(),
            extractedData: metadata(
              "duplicate",
              null,
              result.project as unknown as Record<string, unknown>,
            ) as any,
          })
          .where(eq(rawArticles.id, result.articleId));''',
    "duplicate metadata",
)

ai = replace_once(
    ai,
    '''      } catch (insertErr) {
        const insertErrMsg = insertErr instanceof Error ? insertErr.message : String(insertErr);
        console.error(`[AI Extractor] ❌ Failed to insert project "${result.project.name}" (article ${result.articleId}): ${insertErrMsg}`);
        // Mark article as failed so it can be retried — but continue processing the rest of the batch
        await db.update(rawArticles)
          .set({ status: "failed" })
          .where(eq(rawArticles.id, result.articleId));
        failed++;
        allResults.push(result);
        continue;
      }''',
    '''      } catch {
        const category: ExtractionFailureCategory = "database_insert_error";
        failureCategories = incrementFailureCategory(failureCategories, category);
        console.error("[AI Extractor] Project insert failed", {
          category,
          articleId: result.articleId,
        });
        await db.update(rawArticles)
          .set({
            status: "failed",
            extractedData: metadata("failed", category) as any,
          })
          .where(eq(rawArticles.id, result.articleId));
        failed++;
        allResults.push({
          ...result,
          error: safeExtractionFailureMessage(category),
          failureCategory: category,
          deferred: false,
        });
        continue;
      }''',
    "project insert failure",
)

ai = replace_once(
    ai,
    '''      await db.update(rawArticles)
        .set({ status: "extracted", extractedAt: new Date(), extractedData: result.project as unknown as Record<string, unknown> })
        .where(eq(rawArticles.id, result.articleId));''',
    '''      await db.update(rawArticles)
        .set({
          status: "extracted",
          extractedAt: new Date(),
          extractedData: metadata(
            "extracted",
            null,
            result.project as unknown as Record<string, unknown>,
          ) as any,
        })
        .where(eq(rawArticles.id, result.articleId));''',
    "extracted metadata",
)

ai = replace_once(
    ai,
    '''      extracted++;
      allResults.push(result);
    }
  }''',
    '''      extracted++;
      allResults.push(result);
    }

    if (batchOutcome.stopAfterBatch) {
      console.warn("[AI Extractor] Stopping extraction after retryable batch failure", {
        batchIndex,
        selectedArticles: queuedArticles.length,
        attemptedArticles: processed,
      });
      break;
    }
  }''',
    "stop after retryable batch",
)

ai = replace_once(
    ai,
    '''  return {
    processed: queuedArticles.length,
    extracted,
    duplicates,
    skipped,
    failed,
    creditsUsed: dailyCount + Math.ceil(queuedArticles.length / BATCH_SIZE),
    awardedProjectsInserted,
    drillingCampaignsInserted,
    results: allResults,
  };''',
    '''  return {
    selected: queuedArticles.length,
    processed,
    extracted,
    duplicates,
    skipped,
    failed,
    deferred,
    sideEffectFailures,
    providerCallsAttempted,
    providerCallsSucceeded,
    creditsUsed: providerCallsAttempted,
    failureCategories: sortedFailureCategoryCounts(failureCategories),
    awardedProjectsInserted,
    drillingCampaignsInserted,
    results: allResults,
  };''',
    "extraction summary",
)

ai_path.write_text(ai)

daily_path = Path("server/dailyPipeline.ts")
daily = daily_path.read_text()

daily = replace_once(
    daily,
    'import { runExtractionPipeline } from "./aiExtractor";',
    'import { runExtractionPipeline } from "./aiExtractor";\n'
    'import {\n'
    '  evaluateExtractionHealth,\n'
    '  failureCategoryStepCounts,\n'
    '} from "./aiExtractionHealth";',
    "daily imports",
)

daily = replace_once(
    daily,
    '''  extraction: {
    processed: number;
    extracted: number;
    duplicates: number;
    failed: number;
    creditsUsed: number;
  };''',
    '''  extraction: {
    selected: number;
    processed: number;
    extracted: number;
    duplicates: number;
    skipped: number;
    failed: number;
    deferred: number;
    sideEffectFailures: number;
    providerCallsAttempted: number;
    providerCallsSucceeded: number;
    creditsUsed: number;
    failureCategories: Record<string, number>;
  };''',
    "daily result interface",
)

old_stage = '''  // ── Step 2: AI Extraction (daily) ──
  markStepStarted("AI Extraction");
  const extractionStep = startStep("AI Extraction");
  console.log("[DailyPipeline] Step 2: Running AI extraction...");
  let extractionResult;
  try {
    extractionResult = await withTimeout(runExtractionPipeline(), STEP_TIMEOUT_MS, "AI Extraction");
    completeStep(extractionStep, {
      processed: extractionResult.processed,
      extracted: extractionResult.extracted,
      duplicates: extractionResult.duplicates,
      failed: extractionResult.failed,
      creditsUsed: extractionResult.creditsUsed,
    });
    console.log(
      `[DailyPipeline] Extraction complete: ${extractionResult.extracted} projects from ${extractionResult.processed} articles`
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Extraction failed:", errMsg);
    errors.push(`Extraction: ${errMsg}`);
    failStep(extractionStep, errMsg);
    extractionResult = { processed: 0, extracted: 0, duplicates: 0, skipped: 0, failed: 0, creditsUsed: 0, results: [] };
  }
  steps.push(extractionStep);'''

new_stage = '''  // ── Step 2: AI Extraction (daily) ──
  markStepStarted("AI Extraction");
  const extractionStep = startStep("AI Extraction");
  console.log("[DailyPipeline] Step 2: Running AI extraction...");
  let extractionResult;
  try {
    extractionResult = await withTimeout(
      runExtractionPipeline({ pipelineRunId: runId }),
      STEP_TIMEOUT_MS,
      "AI Extraction",
    );
    const extractionHealth = evaluateExtractionHealth(extractionResult);
    const extractionCounts = {
      selected: extractionResult.selected,
      processed: extractionResult.processed,
      extracted: extractionResult.extracted,
      duplicates: extractionResult.duplicates,
      skipped: extractionResult.skipped,
      failed: extractionResult.failed,
      deferred: extractionResult.deferred,
      sideEffectFailures: extractionResult.sideEffectFailures,
      providerCallsAttempted: extractionResult.providerCallsAttempted,
      providerCallsSucceeded: extractionResult.providerCallsSucceeded,
      creditsUsed: extractionResult.creditsUsed,
      degraded: extractionHealth.state === "degraded" ? 1 : 0,
      ...failureCategoryStepCounts(extractionResult.failureCategories),
    };

    if (extractionHealth.shouldFailStage) {
      const safeReason = extractionHealth.safeReason || "AI extraction quality threshold failed";
      failStep(extractionStep, safeReason);
      extractionStep.counts = extractionCounts;
      errors.push(`Extraction: ${safeReason}`);
      console.error("[DailyPipeline] Extraction quality failed", {
        processed: extractionResult.processed,
        failed: extractionResult.failed,
        deferred: extractionResult.deferred,
        failureRatio: extractionHealth.failureRatio,
        failureCategories: extractionResult.failureCategories,
      });
    } else {
      completeStep(extractionStep, extractionCounts);
      if (extractionHealth.state === "degraded") {
        console.warn("[DailyPipeline] Extraction completed with bounded degradation", {
          processed: extractionResult.processed,
          failed: extractionResult.failed,
          deferred: extractionResult.deferred,
          sideEffectFailures: extractionResult.sideEffectFailures,
          failureCategories: extractionResult.failureCategories,
        });
      }
    }

    console.log(
      `[DailyPipeline] Extraction outcome: ${extractionResult.extracted} projects, ` +
      `${extractionResult.skipped} skipped, ${extractionResult.failed} failed, ` +
      `${extractionResult.deferred} deferred from ${extractionResult.processed} attempted articles`
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Extraction failed:", errMsg);
    errors.push(`Extraction: ${errMsg}`);
    failStep(extractionStep, errMsg);
    extractionResult = {
      selected: 0,
      processed: 0,
      extracted: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
      sideEffectFailures: 0,
      providerCallsAttempted: 0,
      providerCallsSucceeded: 0,
      creditsUsed: 0,
      failureCategories: {},
      awardedProjectsInserted: 0,
      drillingCampaignsInserted: 0,
      results: [],
    };
  }
  steps.push(extractionStep);'''

daily = replace_once(daily, old_stage, new_stage, "daily extraction stage")

daily = replace_once(
    daily,
    '''    lastActivityNote: `Harvest: ${harvestResult.totalNew} new articles from ${harvestResult.totalSources} sources. Extraction: ${extractionResult.extracted} projects from ${extractionResult.processed} articles.`,''',
    '''    lastActivityNote: `Harvest: ${harvestResult.totalNew} new articles from ${harvestResult.totalSources} sources. Extraction: ${extractionResult.extracted} projects, ${extractionResult.skipped} skipped, ${extractionResult.failed} failed, ${extractionResult.deferred} deferred from ${extractionResult.processed} attempted articles.`,''',
    "daily progress note",
)

daily = replace_once(
    daily,
    '''    extraction: {
      processed: extractionResult.processed,
      extracted: extractionResult.extracted,
      duplicates: extractionResult.duplicates,
      failed: extractionResult.failed,
      creditsUsed: extractionResult.creditsUsed,
    },''',
    '''    extraction: {
      selected: extractionResult.selected,
      processed: extractionResult.processed,
      extracted: extractionResult.extracted,
      duplicates: extractionResult.duplicates,
      skipped: extractionResult.skipped,
      failed: extractionResult.failed,
      deferred: extractionResult.deferred,
      sideEffectFailures: extractionResult.sideEffectFailures,
      providerCallsAttempted: extractionResult.providerCallsAttempted,
      providerCallsSucceeded: extractionResult.providerCallsSucceeded,
      creditsUsed: extractionResult.creditsUsed,
      failureCategories: extractionResult.failureCategories,
    },''',
    "daily result extraction",
)

daily_path.write_text(daily)
