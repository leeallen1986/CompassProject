import { describe, expect, it } from "vitest";
import { LLMInvokeError } from "./_core/llmErrors";
import {
  classifyExtractionFailure,
  evaluateExtractionHealth,
  incrementFailureCategory,
  sortedFailureCategoryCounts,
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

  it("classifies empty, JSON and insert failures safely", () => {
    expect(classifyExtractionFailure(new Error("Empty LLM response"))).toBe("empty_response");
    expect(classifyExtractionFailure(new SyntaxError("Unexpected token"))).toBe("schema_or_json_parse");
    expect(classifyExtractionFailure(new Error("Database insert failed"))).toBe("database_insert_error");
  });

  it("aggregates and sorts bounded category counts", () => {
    let counts = incrementFailureCategory({}, "timeout", 2);
    counts = incrementFailureCategory(counts, "timeout");
    counts = incrementFailureCategory(counts, "authentication");
    expect(sortedFailureCategoryCounts(counts)).toEqual({
      authentication: 1,
      timeout: 3,
    });
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

  it("fails the stage when every processed item genuinely fails", () => {
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
    expect(decision.safeReason).not.toContain("provider");
  });

  it("fails a material partial outage at or above the controller threshold", () => {
    expect(evaluateExtractionHealth({
      processed: 20,
      extracted: 3,
      duplicates: 1,
      skipped: 6,
      failed: 10,
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
});
