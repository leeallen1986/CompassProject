from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

health_path = Path("server/aiExtractionHealth.ts")
health = health_path.read_text()
health = replace_once(
    health,
    '''export function shouldDeferExtractionFailure(
  category: ExtractionFailureCategory,
): boolean {
  return category !== "database_insert_error";
}

export function safeExtractionFailureMessage(''',
    '''export function shouldDeferExtractionFailure(
  category: ExtractionFailureCategory,
): boolean {
  return category !== "database_insert_error";
}

/** True only when the adapter got as far as attempting an upstream request. */
export function didAttemptExtractionProviderCall(
  category: ExtractionFailureCategory,
): boolean {
  return category !== "configuration" && category !== "circuit_open";
}

export function safeExtractionFailureMessage(''',
    "provider-attempt helper",
)
health = replace_once(
    health,
    '''export function withExtractionAttemptMetadata(
  existing: unknown,
  input: Omit<ExtractionAttemptMetadata, "version" | "attemptCount">,
): Record<string, unknown> {
  const base = isRecord(existing) ? { ...existing } : {};
  const metadata: ExtractionAttemptMetadata = {
    version: 1,
    ...input,
    attemptCount: previousExtractionAttemptCount(existing) + 1,
  };''',
    '''export function withExtractionAttemptMetadata(
  existing: unknown,
  input: Omit<ExtractionAttemptMetadata, "version" | "attemptCount">,
  historySource: unknown = existing,
): Record<string, unknown> {
  const base = isRecord(existing) ? { ...existing } : {};
  const metadata: ExtractionAttemptMetadata = {
    version: 1,
    ...input,
    attemptCount: previousExtractionAttemptCount(historySource) + 1,
  };''',
    "attempt history source",
)
health_path.write_text(health)

extractor_path = Path("server/aiExtractor.ts")
extractor = extractor_path.read_text()
extractor = replace_once(
    extractor,
    '''  classifyExtractionFailure,
  incrementFailureCategory,''',
    '''  classifyExtractionFailure,
  didAttemptExtractionProviderCall,
  incrementFailureCategory,''',
    "extractor helper import",
)
extractor = replace_once(
    extractor,
    '''  } catch (error: unknown) {
    const category = classifyExtractionFailure(error);
    const deferred = shouldDeferExtractionFailure(category);
    const safeMessage = safeExtractionFailureMessage(category);''',
    '''  } catch (error: unknown) {
    const category = classifyExtractionFailure(error);
    const deferred = shouldDeferExtractionFailure(category);
    const providerCallAttempted = didAttemptExtractionProviderCall(category);
    const safeMessage = safeExtractionFailureMessage(category);''',
    "catch provider-attempt derivation",
)
# Replace only the two catch-path literals by operating inside the catch suffix.
marker = '  } catch (error: unknown) {'
prefix, suffix = extractor.split(marker, 1)
suffix = suffix.replace('providerCallAttempted: true,', 'providerCallAttempted,', 2)
extractor = prefix + marker + suffix
extractor = replace_once(
    extractor,
    '''      ) => withExtractionAttemptMetadata(existing, {
        pipelineRunId,
        batchIndex,
        attemptedAt: result.attemptedAt,
        outcome,
        failureCategory,
        providerCallAttempted: result.providerCallAttempted,
        providerCallSucceeded: result.providerCallSucceeded,
      });''',
    '''      ) => withExtractionAttemptMetadata(
        existing,
        {
          pipelineRunId,
          batchIndex,
          attemptedAt: result.attemptedAt,
          outcome,
          failureCategory,
          providerCallAttempted: result.providerCallAttempted,
          providerCallSucceeded: result.providerCallSucceeded,
        },
        article?.extractedData,
      );''',
    "attempt history wiring",
)
extractor_path.write_text(extractor)

test_path = Path("server/aiExtractionHealth.test.ts")
test = test_path.read_text()
test = replace_once(
    test,
    '''  classifyExtractionFailure,
  evaluateExtractionHealth,''',
    '''  classifyExtractionFailure,
  didAttemptExtractionProviderCall,
  evaluateExtractionHealth,''',
    "test helper import",
)
test = replace_once(
    test,
    '''  it("defers provider/batch outages but not a proven database insert failure", () => {
    expect(shouldDeferExtractionFailure("quota_or_usage_exhausted")).toBe(true);
    expect(shouldDeferExtractionFailure("circuit_open")).toBe(true);
    expect(shouldDeferExtractionFailure("schema_or_json_parse")).toBe(true);
    expect(shouldDeferExtractionFailure("database_insert_error")).toBe(false);
  });''',
    '''  it("defers provider/batch outages but not a proven database insert failure", () => {
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
  });''',
    "provider-attempt test",
)
test = replace_once(
    test,
    '''    const second = withExtractionAttemptMetadata(first, {
      pipelineRunId: 2,
      batchIndex: 0,
      attemptedAt: "2026-08-15T20:00:00Z",
      outcome: "extracted",
      failureCategory: null,
      providerCallAttempted: true,
      providerCallSucceeded: true,
    });

    expect(second.name).toBe("Existing project");''',
    '''    const second = withExtractionAttemptMetadata({ name: "Extracted project" }, {
      pipelineRunId: 2,
      batchIndex: 0,
      attemptedAt: "2026-08-15T20:00:00Z",
      outcome: "extracted",
      failureCategory: null,
      providerCallAttempted: true,
      providerCallSucceeded: true,
    }, first);

    expect(second.name).toBe("Extracted project");''',
    "attempt history test",
)
test_path.write_text(test)
