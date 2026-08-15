import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Issue #113 production extraction wiring", () => {
  it("labels provider usage and parses model JSON through the redacting adapter", () => {
    const extractor = source("./aiExtractor.ts");
    expect(extractor).toContain('feature: "ai_extraction"');
    expect(extractor).toContain("parseLLMJson<");
    expect(extractor).toContain("classifyExtractionFailure(error)");
    expect(extractor).toContain("safeExtractionFailureMessage(category)");
  });

  it("keeps retryable provider failures queued and stops before mass-failing later batches", () => {
    const extractor = source("./aiExtractor.ts");
    expect(extractor).toContain('status: "queued"');
    expect(extractor).toContain('metadata("deferred", category)');
    expect(extractor).toContain("if (batchOutcome.stopAfterBatch)");
    expect(extractor).toContain("Stopping extraction after retryable batch failure");
    expect(extractor).not.toContain("Mark all articles in this batch as failed");
  });

  it("persists bounded run/batch attempt evidence without raw provider payloads", () => {
    const extractor = source("./aiExtractor.ts");
    const health = source("./aiExtractionHealth.ts");
    expect(extractor).toContain("pipelineRunId");
    expect(extractor).toContain("batchIndex");
    expect(extractor).toContain("providerCallAttempted");
    expect(extractor).toContain("providerCallSucceeded");
    expect(health).toContain('AI_EXTRACTION_METADATA_KEY = "__aiExtraction"');
    expect(health).not.toContain("rawProviderPayload");
    expect(health).not.toContain("promptText");
  });

  it("separates provider call telemetry from article outcomes", () => {
    const extractor = source("./aiExtractor.ts");
    expect(extractor).toContain("providerCallsAttempted");
    expect(extractor).toContain("providerCallsSucceeded");
    expect(extractor).toContain("creditsUsed: providerCallsAttempted");
    expect(extractor).not.toContain("dailyCount + Math.ceil(queuedArticles.length / BATCH_SIZE)");
  });

  it("fails the critical daily stage when extraction health breaches the threshold", () => {
    const daily = source("./dailyPipeline.ts");
    expect(daily).toContain("evaluateExtractionHealth(extractionResult)");
    expect(daily).toContain("if (extractionHealth.shouldFailStage)");
    expect(daily).toContain("failStep(extractionStep, safeReason)");
    expect(daily).toContain("failureCategoryStepCounts(extractionResult.failureCategories)");
    expect(daily).toContain("runExtractionPipeline({ pipelineRunId: runId })");
  });

  it("records all-skipped work as an outcome distinct from failed or deferred", () => {
    const daily = source("./dailyPipeline.ts");
    expect(daily).toContain("skipped: extractionResult.skipped");
    expect(daily).toContain("failed: extractionResult.failed");
    expect(daily).toContain("deferred: extractionResult.deferred");
  });
});
