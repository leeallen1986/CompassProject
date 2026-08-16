import { describe, expect, it } from "vitest";
import { LLMInvokeError } from "./llmErrors";
import {
  AI_EXTRACTION_FEATURE,
  normalizeOpenAICompatibleEndpoint,
  resolveLLMProvider,
  type LLMProviderEnvironment,
} from "./llmProvider";

const forgeEnv: LLMProviderEnvironment = {
  forgeApiKey: "forge-secret",
  forgeApiUrl: "https://forge.example",
};

const externalEnv: LLMProviderEnvironment = {
  ...forgeEnv,
  aiExtractionProvider: "openai_compatible",
  aiExtractionApiKey: "gemini-secret",
  aiExtractionBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
  aiExtractionModel: "gemini-3.6-flash",
};

describe("Issue #117 feature-scoped provider resolution", () => {
  it("keeps non-extraction features on Manus Forge", () => {
    const provider = resolveLLMProvider("outreach_draft", externalEnv);
    expect(provider).toMatchObject({
      name: "manus_forge",
      endpoint: "https://forge.example/v1/chat/completions",
      model: "gemini-2.5-flash",
      payloadMode: "manus_forge",
    });
  });

  it("defaults AI extraction to Manus Forge until explicitly switched", () => {
    const provider = resolveLLMProvider(AI_EXTRACTION_FEATURE, forgeEnv);
    expect(provider.name).toBe("manus_forge");
  });

  it("resolves an explicit OpenAI-compatible extraction provider", () => {
    const provider = resolveLLMProvider(AI_EXTRACTION_FEATURE, externalEnv);
    expect(provider).toMatchObject({
      name: "openai_compatible",
      endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      model: "gemini-3.6-flash",
      payloadMode: "openai_compatible",
      reasoningEffort: "low",
      telemetry: {
        provider: "openai_compatible",
        model: "gemini-3.6-flash",
      },
    });
  });

  it("does not duplicate a full chat-completions path", () => {
    expect(normalizeOpenAICompatibleEndpoint(
      "https://example.invalid/v1/chat/completions/",
    )).toBe("https://example.invalid/v1/chat/completions");
  });

  it("does not fall back to Forge when external extraction configuration is incomplete", () => {
    expect(() => resolveLLMProvider(AI_EXTRACTION_FEATURE, {
      ...externalEnv,
      aiExtractionApiKey: "",
    })).toThrowError(LLMInvokeError);

    try {
      resolveLLMProvider(AI_EXTRACTION_FEATURE, {
        ...externalEnv,
        aiExtractionApiKey: "",
      });
      throw new Error("expected configuration failure");
    } catch (error) {
      expect(error).toMatchObject({
        kind: "configuration",
        provider: "openai_compatible",
        model: "gemini-3.6-flash",
      });
    }
  });

  it("rejects an unknown provider mode without echoing it", () => {
    try {
      resolveLLMProvider(AI_EXTRACTION_FEATURE, {
        ...externalEnv,
        aiExtractionProvider: "secret-provider-value",
      });
      throw new Error("expected configuration failure");
    } catch (error) {
      expect(error).toMatchObject({ kind: "configuration" });
      expect(String(error)).not.toContain("secret-provider-value");
    }
  });

  it("requires a secure endpoint without embedded credentials, query or fragment", () => {
    const invalid = [
      "http://example.invalid/v1",
      "https://user:pass@example.invalid/v1",
      "https://example.invalid/v1?key=secret",
      "https://example.invalid/v1#secret",
    ];
    for (const baseUrl of invalid) {
      expect(() => resolveLLMProvider(AI_EXTRACTION_FEATURE, {
        ...externalEnv,
        aiExtractionBaseUrl: baseUrl,
      })).toThrowError(LLMInvokeError);
    }
  });

  it("rejects unsafe model identifiers", () => {
    expect(() => resolveLLMProvider(AI_EXTRACTION_FEATURE, {
      ...externalEnv,
      aiExtractionModel: "gemini model with spaces",
    })).toThrowError(LLMInvokeError);
  });

  it("keeps secrets and endpoints out of bounded telemetry", () => {
    const provider = resolveLLMProvider(AI_EXTRACTION_FEATURE, externalEnv);
    const telemetry = JSON.stringify(provider.telemetry);
    expect(telemetry).toContain("openai_compatible");
    expect(telemetry).toContain("gemini-3.6-flash");
    expect(telemetry).not.toContain("gemini-secret");
    expect(telemetry).not.toContain("generativelanguage.googleapis.com");
  });
});
