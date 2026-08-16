from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# ── aiExtractor.ts ────────────────────────────────────────────────────────────
path = Path("server/aiExtractor.ts")
text = path.read_text()

text = replace_once(
    text,
    '''  didAttemptExtractionProviderCall,
  incrementFailureCategory,''',
    '''  didAttemptExtractionProviderCall,
  extractionProviderTelemetryFrom,
  incrementFailureCategory,''',
    "extractor telemetry helper import",
)
text = replace_once(
    text,
    '''  type ExtractionFailureCategory,
  type ExtractionFailureCategoryCounts,
} from "./aiExtractionHealth";''',
    '''  type ExtractionFailureCategory,
  type ExtractionFailureCategoryCounts,
  type ExtractionProviderName,
} from "./aiExtractionHealth";''',
    "extractor provider type import",
)

text = replace_once(
    text,
    '''interface ExtractionResult {
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
}''',
    '''interface ExtractionResult {
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
  provider?: ExtractionProviderName;
  model?: string;
}

interface ExtractionBatchResult {
  results: ExtractionResult[];
  providerCallAttempted: boolean;
  providerCallSucceeded: boolean;
  provider: ExtractionProviderName | null;
  model: string | null;
  stopAfterBatch: boolean;
}''',
    "extractor result interfaces",
)
text = replace_once(
    text,
    '''  providerCallsAttempted: number;
  providerCallsSucceeded: number;
  creditsUsed: number;''',
    '''  providerCallsAttempted: number;
  providerCallsSucceeded: number;
  provider: ExtractionProviderName | null;
  model: string | null;
  creditsUsed: number;''',
    "extraction summary provider fields",
)

text = replace_once(
    text,
    '''  const results: ExtractionResult[] = [];

  try {''',
    '''  const results: ExtractionResult[] = [];
  let providerTelemetry: {
    provider: ExtractionProviderName | null;
    model: string | null;
  } = { provider: null, model: null };

  try {''',
    "extract batch telemetry state",
)
text = replace_once(
    text,
    '''      },
    });

    const content = response.choices[0]?.message?.content;''',
    '''      },
    });
    providerTelemetry = extractionProviderTelemetryFrom(response);

    const content = response.choices[0]?.message?.content;''',
    "capture success provider telemetry",
)

# Add provider/model to every successful result object in extractBatch.
start = text.index("async function extractBatch(")
end = text.index("// ── Check if a project already exists", start)
section = text[start:end]
pattern = re.compile(r"(?P<property>\s*)providerCallSucceeded: true,\n(?P<close>\s*)\}\);")

def add_success_telemetry(match: re.Match[str]) -> str:
    prop = match.group("property")
    close = match.group("close")
    return (
        f"{prop}providerCallSucceeded: true,\n"
        f"{prop}provider: providerTelemetry.provider ?? undefined,\n"
        f"{prop}model: providerTelemetry.model ?? undefined,\n"
        f"{close}}});"
    )

section, success_count = pattern.subn(add_success_telemetry, section)
if success_count != 3:
    raise SystemExit(f"success result telemetry: expected 3 matches, found {success_count}")
text = text[:start] + section + text[end:]

text = replace_once(
    text,
    '''      providerCallAttempted: true,
      providerCallSucceeded: true,
      stopAfterBatch: results.some(result => result.deferred === true),''',
    '''      providerCallAttempted: true,
      providerCallSucceeded: true,
      provider: providerTelemetry.provider,
      model: providerTelemetry.model,
      stopAfterBatch: results.some(result => result.deferred === true),''',
    "success batch telemetry",
)
text = replace_once(
    text,
    '''  } catch (error: unknown) {
    const category = classifyExtractionFailure(error);
    const deferred = shouldDeferExtractionFailure(category);
    const providerCallAttempted = didAttemptExtractionProviderCall(category);''',
    '''  } catch (error: unknown) {
    const category = classifyExtractionFailure(error);
    const errorTelemetry = extractionProviderTelemetryFrom(error);
    if (errorTelemetry.provider || errorTelemetry.model) {
      providerTelemetry = errorTelemetry;
    }
    const deferred = shouldDeferExtractionFailure(category);
    const providerCallAttempted = didAttemptExtractionProviderCall(category);''',
    "catch provider telemetry",
)
text = replace_once(
    text,
    '''      category,
      articleCount: articles.length,
    });''',
    '''      category,
      provider: providerTelemetry.provider,
      model: providerTelemetry.model,
      articleCount: articles.length,
    });''',
    "batch failure structured log",
)
text = replace_once(
    text,
    '''        providerCallAttempted,
        providerCallSucceeded: false,
      });''',
    '''        providerCallAttempted,
        providerCallSucceeded: false,
        provider: providerTelemetry.provider ?? undefined,
        model: providerTelemetry.model ?? undefined,
      });''',
    "failed result provider telemetry",
)
text = replace_once(
    text,
    '''      providerCallAttempted,
      providerCallSucceeded: false,
      stopAfterBatch: deferred,''',
    '''      providerCallAttempted,
      providerCallSucceeded: false,
      provider: providerTelemetry.provider,
      model: providerTelemetry.model,
      stopAfterBatch: deferred,''',
    "failed batch provider telemetry",
)

# Two no-work return objects.
old = '''      providerCallsAttempted: 0,
      providerCallsSucceeded: 0,
      creditsUsed: 0,'''
new = '''      providerCallsAttempted: 0,
      providerCallsSucceeded: 0,
      provider: null,
      model: null,
      creditsUsed: 0,'''
count = text.count(old)
if count != 2:
    raise SystemExit(f"no-work provider fields: expected 2 matches, found {count}")
text = text.replace(old, new)

text = replace_once(
    text,
    '''  let providerCallsAttempted = 0;
  let providerCallsSucceeded = 0;
  let failureCategories: ExtractionFailureCategoryCounts = {};''',
    '''  let providerCallsAttempted = 0;
  let providerCallsSucceeded = 0;
  let provider: ExtractionProviderName | null = null;
  let model: string | null = null;
  let failureCategories: ExtractionFailureCategoryCounts = {};''',
    "run provider state",
)
text = replace_once(
    text,
    '''    providerCallsAttempted += batchOutcome.providerCallAttempted ? 1 : 0;
    providerCallsSucceeded += batchOutcome.providerCallSucceeded ? 1 : 0;
    processed += batchOutcome.results.length;''',
    '''    providerCallsAttempted += batchOutcome.providerCallAttempted ? 1 : 0;
    providerCallsSucceeded += batchOutcome.providerCallSucceeded ? 1 : 0;
    provider ??= batchOutcome.provider;
    model ??= batchOutcome.model;
    processed += batchOutcome.results.length;''',
    "accumulate provider telemetry",
)
text = replace_once(
    text,
    '''          providerCallAttempted: result.providerCallAttempted,
          providerCallSucceeded: result.providerCallSucceeded,
        },''',
    '''          providerCallAttempted: result.providerCallAttempted,
          providerCallSucceeded: result.providerCallSucceeded,
          provider: result.provider,
          model: result.model,
        },''',
    "attempt ledger provider telemetry",
)
text = replace_once(
    text,
    '''        attemptedArticles: processed,
      });''',
    '''        attemptedArticles: processed,
        provider,
        model,
      });''',
    "stop log provider telemetry",
)
text = replace_once(
    text,
    '''    providerCallsAttempted,
    providerCallsSucceeded,
    creditsUsed: providerCallsAttempted,''',
    '''    providerCallsAttempted,
    providerCallsSucceeded,
    provider,
    model,
    creditsUsed: providerCallsAttempted,''',
    "summary provider telemetry",
)
path.write_text(text)


# ── dailyPipeline.ts ──────────────────────────────────────────────────────────
path = Path("server/dailyPipeline.ts")
text = path.read_text()
text = replace_once(
    text,
    '''    providerCallsAttempted: number;
    providerCallsSucceeded: number;
    creditsUsed: number;''',
    '''    providerCallsAttempted: number;
    providerCallsSucceeded: number;
    provider: string | null;
    model: string | null;
    creditsUsed: number;''',
    "daily result provider fields",
)
text = replace_once(
    text,
    '''        failureRatio: extractionHealth.failureRatio,
        failureCategories: extractionResult.failureCategories,''',
    '''        failureRatio: extractionHealth.failureRatio,
        provider: extractionResult.provider,
        model: extractionResult.model,
        failureCategories: extractionResult.failureCategories,''',
    "daily failure log provider telemetry",
)
text = replace_once(
    text,
    '''      `[DailyPipeline] Extraction outcome: ${extractionResult.extracted} projects, ` +
      `${extractionResult.skipped} skipped, ${extractionResult.failed} failed, ` +''',
    '''      `[DailyPipeline] Extraction outcome (${extractionResult.provider ?? "unknown"}/${extractionResult.model ?? "unknown"}): ` +
      `${extractionResult.extracted} projects, ${extractionResult.skipped} skipped, ${extractionResult.failed} failed, ` +''',
    "daily outcome provider log",
)
text = replace_once(
    text,
    '''      providerCallsAttempted: 0,
      providerCallsSucceeded: 0,
      creditsUsed: 0,''',
    '''      providerCallsAttempted: 0,
      providerCallsSucceeded: 0,
      provider: null,
      model: null,
      creditsUsed: 0,''',
    "daily catch provider fallback",
)
text = replace_once(
    text,
    '''    lastActivityNote: `Harvest: ${harvestResult.totalNew} new articles from ${harvestResult.totalSources} sources. Extraction: ${extractionResult.extracted} projects, ${extractionResult.skipped} skipped, ${extractionResult.failed} failed, ${extractionResult.deferred} deferred from ${extractionResult.processed} attempted articles.`,''',
    '''    lastActivityNote: `Harvest: ${harvestResult.totalNew} new articles from ${harvestResult.totalSources} sources. Extraction (${extractionResult.provider ?? "unknown"}/${extractionResult.model ?? "unknown"}): ${extractionResult.extracted} projects, ${extractionResult.skipped} skipped, ${extractionResult.failed} failed, ${extractionResult.deferred} deferred from ${extractionResult.processed} attempted articles.`,''',
    "progress note provider telemetry",
)
text = replace_once(
    text,
    '''        lastActivityNote: `Pipeline ${coreStatus}: ${extractionResult.extracted} projects extracted, ${enrichmentResult.enriched} contacts enriched in ${Math.round((Date.now() - startTime) / 60000)} min.`,''',
    '''        lastActivityNote: `Pipeline ${coreStatus}: ${extractionResult.extracted} projects extracted via ${extractionResult.provider ?? "unknown"}/${extractionResult.model ?? "unknown"}, ${enrichmentResult.enriched} contacts enriched in ${Math.round((Date.now() - startTime) / 60000)} min.`,''',
    "completion note provider telemetry",
)
text = replace_once(
    text,
    '''      providerCallsAttempted: extractionResult.providerCallsAttempted,
      providerCallsSucceeded: extractionResult.providerCallsSucceeded,
      creditsUsed: extractionResult.creditsUsed,''',
    '''      providerCallsAttempted: extractionResult.providerCallsAttempted,
      providerCallsSucceeded: extractionResult.providerCallsSucceeded,
      provider: extractionResult.provider,
      model: extractionResult.model,
      creditsUsed: extractionResult.creditsUsed,''',
    "daily result provider values",
)
path.write_text(text)


# ── aiExtractionHealth.test.ts ────────────────────────────────────────────────
path = Path("server/aiExtractionHealth.test.ts")
text = path.read_text()
text = replace_once(
    text,
    '''  didAttemptExtractionProviderCall,
  evaluateExtractionHealth,''',
    '''  didAttemptExtractionProviderCall,
  evaluateExtractionHealth,
  extractionProviderTelemetryFrom,''',
    "health test telemetry import",
)
text = replace_once(
    text,
    '''  it("classifies empty, JSON and insert failures safely", () => {''',
    '''  it("extracts only bounded provider/model attribution", () => {
    expect(extractionProviderTelemetryFrom(new LLMInvokeError({
      kind: "quota_exhausted",
      provider: "openai_compatible",
      model: "gemini-3.6-flash",
    }))).toEqual({
      provider: "openai_compatible",
      model: "gemini-3.6-flash",
    });
    expect(extractionProviderTelemetryFrom({
      providerTelemetry: {
        provider: "manus_forge",
        model: "gemini-2.5-flash",
        apiKey: "must-not-survive",
      },
    })).toEqual({
      provider: "manus_forge",
      model: "gemini-2.5-flash",
    });
    expect(extractionProviderTelemetryFrom({
      providerTelemetry: {
        provider: "secret-provider",
        model: "model with spaces",
      },
    })).toEqual({ provider: null, model: null });
  });

  it("classifies empty, JSON and insert failures safely", () => {''',
    "health provider telemetry test",
)
text = replace_once(
    text,
    '''      providerCallAttempted: true,
      providerCallSucceeded: false,
    });

    expect(value[AI_EXTRACTION_METADATA_KEY]).toEqual({''',
    '''      providerCallAttempted: true,
      providerCallSucceeded: false,
      provider: "openai_compatible",
      model: "gemini-3.6-flash",
    });

    expect(value[AI_EXTRACTION_METADATA_KEY]).toEqual({''',
    "metadata provider input",
)
text = replace_once(
    text,
    '''      providerCallAttempted: true,
      providerCallSucceeded: false,
      attemptCount: 1,''',
    '''      providerCallAttempted: true,
      providerCallSucceeded: false,
      provider: "openai_compatible",
      model: "gemini-3.6-flash",
      attemptCount: 1,''',
    "metadata provider expectation",
)
text = replace_once(
    text,
    '''    expect(JSON.stringify(value)).not.toContain("provider payload");''',
    '''    expect(JSON.stringify(value)).not.toContain("provider payload");
    expect(JSON.stringify(value)).not.toContain("apiKey");
    expect(JSON.stringify(value)).not.toContain("generativelanguage.googleapis.com");''',
    "metadata redaction expectation",
)
path.write_text(text)


# ── aiExtractionPipelineIntegration.test.ts ─────────────────────────────────
path = Path("server/aiExtractionPipelineIntegration.test.ts")
text = path.read_text()
text = replace_once(
    text,
    '''    expect(extractor).toContain("providerCallSucceeded");
    expect(health).toContain('AI_EXTRACTION_METADATA_KEY = "__aiExtraction"');''',
    '''    expect(extractor).toContain("providerCallSucceeded");
    expect(extractor).toContain("provider: result.provider");
    expect(extractor).toContain("model: result.model");
    expect(health).toContain('AI_EXTRACTION_METADATA_KEY = "__aiExtraction"');''',
    "integration provider ledger wiring",
)
text = replace_once(
    text,
    '''    expect(extractor).not.toContain("dailyCount + Math.ceil(queuedArticles.length / BATCH_SIZE)");''',
    '''    expect(extractor).not.toContain("dailyCount + Math.ceil(queuedArticles.length / BATCH_SIZE)");
    expect(extractor).toContain("extractionProviderTelemetryFrom(response)");
    expect(extractor).toContain("extractionProviderTelemetryFrom(error)");''',
    "integration provider attribution",
)
text = replace_once(
    text,
    '''    expect(daily).toContain("deferred: extractionResult.deferred");''',
    '''    expect(daily).toContain("deferred: extractionResult.deferred");
    expect(daily).toContain("provider: extractionResult.provider");
    expect(daily).toContain("model: extractionResult.model");''',
    "integration daily provider result",
)
path.write_text(text)
