import { describe, expect, it } from "vitest";
import { LLMInvokeError } from "./_core/llmErrors";
import {
  AI_EXTRACTION_METADATA_KEY,
  classifyExtractionFailure,
  didAttemptExtractionProviderCall,
  evaluateExtractionHealth,
  extractionProviderTelemetryFrom,
  failureCategoryStepCounts,
  incrementFailureCategory,
  previousExtractionAttemptCount,
  safeExtractionFailureMessage,
  shouldDeferExtractionFailure,
  sortedFailureCategoryCounts,
  withExtractionAttemptMetadata,
} from "./aiExtractionHealth";

describe("Issue #113 extraction failure classification", () => {
  it("maps bounded LLM failure kinds without provider payloads", () => {
    expect(classifyExtractionFailure(new LLMInvokeError({ kind: "quota_exhausted", status: 412 })))
      .toBe("quota_or_usage_exhausted");
    expect(classifyExtractionFailure(new LLMInvokeError({ kind: "circuit_open" })))
      .toBe("circuit_open");
    expect(classifyExtractionFailure(new LLMInvokeError({ kind: "malformed_response" })))
      .toBe("schema_or_json_parse");
  });

  it("extracts only bounded provider/model attribution", () => {
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

  it("classifies empty, JSON and insert failures safely", () => {
    expect(classifyExtractionFailure(new Error("Empty LLM response"))).toBe("empty_response");
    expect(classifyExtractionFailure(new SyntaxError("Unexpected token"))).toBe("schema_or_json_parse");
    expect(classifyExtractionFailure(new Error("Database insert failed"))).toBe("database_insert_error");
  });

  it("defers provider/batch outages but not a proven database insert failure", () => {
    expect(shouldDeferExtractionFailure("quota_or_usage_exhausted")).toBe(true);
    expect(shouldDeferExtractionFailure("circuit_open")).toBe(true);
    expect(shouldDeferExtractionFailure("schema_or_json_parse")).toBe(true);
    expect(shouldDeferExtractionFailure("database_insert_error")).toBe(false);
  });

  it("does not claim an upstream provider call for configuration or circuit-open failures", () => {
    expect(didAttemptExtractionProviderCall("configuration")).toBe(false);
    expect(didAttemptExtractionProviderCall("circuit_open")).toBe(false);
    expect(didAttemptExtractionProviderCall("quota_or_usage_exhausted")).toBe(true);
    expect(didAttemptExtractionProviderCall("timeout")).toBe(true);
  });

  it("emits a bounded safe error message", () => {
    const message = safeExtractionFailureMessage("provider_rejected");
    expect(message).toBe("AI extraction unavailable (provider_rejected)");
    expect(message).not.toContain("prompt");
    expect(message).not.toContain("response");
  });

  it("aggregates and sorts bounded category counts for persisted step telemetry", () => {
    let counts = incrementFailureCategory({}, "timeout", 2);
    counts = incrementFailureCategory(counts, "timeout");
    counts = incrementFailureCategory(counts, "authentication");
    expect(sortedFailureCategoryCounts(counts)).toEqual({
      authentication: 1,
      timeout: 3,
    });
    expect(failureCategoryStepCounts(counts)).toEqual({
      failure_authentication: 1,
      failure_timeout: 3,
    });
  });
});

describe("Issue #113 bounded attempt metadata", () => {
  it("adds a reconstructable run/batch ledger without raw provider content", () => {
    const value = withExtractionAttemptMetadata(null, {
      pipelineRunId: 3900001,
      batchIndex: 0,
      attemptedAt: "2026-08-14T20:02:01.686Z",
      outcome: "deferred",
      failureCategory: "quota_or_usage_exhausted",
      providerCallAttempted: true,
      providerCallSucceeded: false,
      provider: "openai_compatible",
      model: "gemini-3.6-flash",
    });

    expect(value[AI_EXTRACTION_METADATA_KEY]).toEqual({
      version: 1,
      pipelineRunId: 3900001,
      batchIndex: 0,
      attemptedAt: "2026-08-14T20:02:01.686Z",
      outcome: "deferred",
      failureCategory: "quota_or_usage_exhausted",
      providerCallAttempted: true,
      providerCallSucceeded: false,
      provider: "openai_compatible",
      model: "gemini-3.6-flash",
      attemptCount: 1,
    });
    expect(JSON.stringify(value)).not.toContain("article text");
    expect(JSON.stringify(value)).not.toContain("provider payload");
    expect(JSON.stringify(value)).not.toContain("apiKey");
    expect(JSON.stringify(value)).not.toContain("generativelanguage.googleapis.com");
  });

  it("preserves existing extracted project fields and increments attempt count", () => {
    const first = withExtractionAttemptMetadata({ name: "Existing project" }, {
      pipelineRunId: 1,
      batchIndex: 0,
      attemptedAt: "2026-08-14T20:00:00Z",
      outcome: "deferred",
      failureCategory: "timeout",
      providerCallAttempted: true,
      providerCallSucceeded: false,
    });
    const second = withExtractionAttemptMetadata({ name: "Extracted project" }, {
      pipelineRunId: 2,
      batchIndex: 0,
      attemptedAt: "2026-08-15T20:00:00Z",
      outcome: "extracted",
      failureCategory: null,
      providerCallAttempted: true,
      providerCallSucceeded: true,
    }, first);

    expect(second.name).toBe("Extracted project");
    expect(previousExtractionAttemptCount(second)).toBe(2);
  });
});

describe("Issue #113 extraction health", () => {
  it("treats no queued work as healthy no-work", () => {
    expect(evaluateExtractionHealth({
      processed: 0,
      extracted: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
    })).toMatchObject({ state: "no_work", shouldFailStage: false });
  });

  it("treats all articles irrelevant as healthy skipped work", () => {
    expect(evaluateExtractionHealth({
      processed: 76,
      extracted: 0,
      duplicates: 0,
      skipped: 76,
      failed: 0,
    })).toMatchObject({
      state: "healthy",
      effectiveFailures: 0,
      shouldFailStage: false,
    });
  });

  it("fails the stage when every attempted item genuinely fails", () => {
    const decision = evaluateExtractionHealth({
      processed: 76,
      extracted: 0,
      duplicates: 0,
      skipped: 0,
      failed: 76,
    });
    expect(decision).toMatchObject({
      state: "failed",
      failureRatio: 1,
      shouldFailStage: true,
    });
    expect(decision.safeReason).toContain("76/76");
    expect(decision.safeReason).not.toContain("provider payload");
  });

  it("fails a total deferred provider batch without converting it to article failure", () => {
    expect(evaluateExtractionHealth({
      processed: 5,
      extracted: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      deferred: 5,
    })).toMatchObject({
      state: "failed",
      effectiveFailures: 5,
      failureRatio: 1,
      shouldFailStage: true,
    });
  });

  it("fails a material partial outage at or above the controller threshold", () => {
    expect(evaluateExtractionHealth({
      processed: 20,
      extracted: 3,
      duplicates: 1,
      skipped: 6,
      failed: 5,
      deferred: 5,
    })).toMatchObject({
      state: "failed",
      failureRatio: 0.5,
      shouldFailStage: true,
    });
  });

  it("records a small partial failure as degraded without failing the whole stage", () => {
    expect(evaluateExtractionHealth({
      processed: 20,
      extracted: 4,
      duplicates: 2,
      skipped: 13,
      failed: 1,
    })).toMatchObject({
      state: "degraded",
      failureRatio: 0.05,
      shouldFailStage: false,
    });
  });

  it("treats omitted provider results as unaccounted failures", () => {
    expect(evaluateExtractionHealth({
      processed: 10,
      extracted: 1,
      duplicates: 0,
      skipped: 4,
      failed: 0,
    })).toMatchObject({
      unaccounted: 5,
      effectiveFailures: 5,
      state: "failed",
      shouldFailStage: true,
    });
  });

  it("does not fail merely because zero projects were extracted", () => {
    expect(evaluateExtractionHealth({
      processed: 12,
      extracted: 0,
      duplicates: 2,
      skipped: 10,
      failed: 0,
    })).toMatchObject({ state: "healthy", shouldFailStage: false });
  });

  it("records secondary insert failures as degradation without double-counting articles", () => {
    expect(evaluateExtractionHealth({
      processed: 10,
      extracted: 2,
      duplicates: 2,
      skipped: 6,
      failed: 0,
      sideEffectFailures: 1,
    })).toMatchObject({
      state: "degraded",
      effectiveFailures: 0,
      sideEffectFailures: 1,
      shouldFailStage: false,
    });
  });
});
