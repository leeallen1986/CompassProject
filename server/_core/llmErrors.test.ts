import { describe, expect, it } from "vitest";
import {
  LLMInvokeError,
  classifyLLMHttpFailure,
  isDeterministicFallbackEligible,
  parseLLMJson,
  parseRetryAfterMs,
} from "./llmErrors";

describe("LLM failure classification", () => {
  it("classifies the observed Manus 412/code=9 failure as quota exhaustion", () => {
    expect(classifyLLMHttpFailure(412, JSON.stringify({ code: 9, message: "account has hit usage exhausted" })))
      .toBe("quota_exhausted");
  });

  it("classifies nested string code=9 as quota exhaustion", () => {
    expect(classifyLLMHttpFailure(400, JSON.stringify({ error: { code: "9" } })))
      .toBe("quota_exhausted");
  });

  it.each([
    [429, "", "rate_limited"],
    [412, "precondition failed", "upstream_rejected"],
    [401, "", "authentication"],
    [503, "", "upstream_unavailable"],
    [400, "bad request", "upstream_rejected"],
  ] as const)("classifies HTTP %s", (status, body, expected) => {
    expect(classifyLLMHttpFailure(status, body)).toBe(expected);
  });

  it("parses delta-seconds Retry-After", () => {
    expect(parseRetryAfterMs("15", 0)).toBe(15_000);
  });

  it("permits deterministic fallback only for availability failures", () => {
    for (const kind of [
      "configuration",
      "quota_exhausted",
      "rate_limited",
      "timeout",
      "upstream_unavailable",
      "circuit_open",
    ] as const) {
      expect(isDeterministicFallbackEligible(new LLMInvokeError({ kind }))).toBe(true);
    }
    for (const kind of [
      "authentication",
      "upstream_rejected",
      "malformed_response",
    ] as const) {
      expect(isDeterministicFallbackEligible(new LLMInvokeError({ kind }))).toBe(false);
    }
    expect(isDeterministicFallbackEligible(new Error("bad JSON"))).toBe(false);
  });

  it("does not place an upstream response body in the safe error message", () => {
    const error = new LLMInvokeError({
      kind: "quota_exhausted",
      status: 412,
      requestId: "req-safe-id",
    });
    expect(error.message).toContain("req-safe-id");
    expect(error.message).not.toContain("usage exhausted");
  });

  it("redacts malformed model JSON instead of echoing its content", () => {
    expect(() => parseLLMJson("recipient-and-prompt-data is not JSON"))
      .toThrowError(expect.objectContaining({ kind: "malformed_response" }));
    try {
      parseLLMJson("recipient-and-prompt-data is not JSON");
    } catch (error) {
      expect(String(error)).not.toContain("recipient-and-prompt-data");
    }
  });
});
