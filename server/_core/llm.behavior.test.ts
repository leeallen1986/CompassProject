import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    forgeApiKey: "test-key-never-sent",
    forgeApiUrl: "https://forge.invalid",
    aiExtractionProvider: "",
    aiExtractionApiKey: "",
    aiExtractionBaseUrl: "",
    aiExtractionModel: "",
  },
}));

vi.mock("./env", () => ({ ENV: mockEnv }));

import { invokeLLM, resetLLMCircuitForTests } from "./llm";
import { LLMInvokeError } from "./llmErrors";

const successResult = {
  id: "result-1",
  created: 1,
  model: "test",
  choices: [],
};

describe("invokeLLM availability controls", () => {
  beforeEach(() => {
    resetLLMCircuitForTests();
    vi.unstubAllGlobals();
    Object.assign(mockEnv, {
      forgeApiKey: "test-key-never-sent",
      forgeApiUrl: "https://forge.invalid",
      aiExtractionProvider: "",
      aiExtractionApiKey: "",
      aiExtractionBaseUrl: "",
      aiExtractionModel: "",
    });
  });

  it("honours a caller maxTokens limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successResult),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await invokeLLM({
      feature: "test_feature",
      messages: [{ role: "user", content: "test" }],
      maxTokens: 777,
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.max_tokens).toBe(777);
    expect(body.model).toBe("gemini-2.5-flash");
    expect(body.thinking).toEqual({ budget_tokens: 128 });
    expect(JSON.stringify(body)).not.toContain("test-key-never-sent");
  });

  it("routes only AI extraction to the configured OpenAI-compatible provider", async () => {
    Object.assign(mockEnv, {
      aiExtractionProvider: "openai_compatible",
      aiExtractionApiKey: "external-key-never-in-body",
      aiExtractionBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      aiExtractionModel: "gemini-3.6-flash",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successResult),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeLLM({
      feature: "ai_extraction",
      messages: [{ role: "user", content: "test" }],
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("authorization"))
      .toBe("Bearer external-key-never-in-body");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gemini-3.6-flash");
    expect(body.reasoning_effort).toBe("low");
    expect(body.thinking).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("external-key-never-in-body");
    expect(result.providerTelemetry).toEqual({
      provider: "openai_compatible",
      model: "gemini-3.6-flash",
    });
  });

  it("does not silently fall back to Forge when extraction configuration is missing", async () => {
    Object.assign(mockEnv, {
      aiExtractionProvider: "openai_compatible",
      aiExtractionApiKey: "",
      aiExtractionBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      aiExtractionModel: "gemini-3.6-flash",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(invokeLLM({
      feature: "ai_extraction",
      messages: [{ role: "user", content: "test" }],
    })).rejects.toMatchObject({
      kind: "configuration",
      provider: "openai_compatible",
      model: "gemini-3.6-flash",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens the circuit after quota exhaustion and makes no second request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: 9, message: "account has hit usage exhausted" }),
      {
        status: 412,
        headers: { "x-request-id": "req-123", "retry-after": "60" },
      },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const invoke = () => invokeLLM({
      feature: "test_feature",
      messages: [{ role: "user", content: "test" }],
    });

    await expect(invoke()).rejects.toMatchObject({
      kind: "quota_exhausted",
      status: 412,
      requestId: "req-123",
      provider: "manus_forge",
    });
    await expect(invoke()).rejects.toMatchObject({
      kind: "circuit_open",
      provider: "manus_forge",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("isolates the extraction-provider circuit from unrelated Forge features", async () => {
    Object.assign(mockEnv, {
      aiExtractionProvider: "openai_compatible",
      aiExtractionApiKey: "external-key",
      aiExtractionBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      aiExtractionModel: "gemini-3.6-flash",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ code: 9, message: "quota exhausted" }),
        { status: 429 },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify(successResult),
        { status: 200 },
      ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(invokeLLM({
      feature: "ai_extraction",
      messages: [{ role: "user", content: "test" }],
    })).rejects.toMatchObject({
      kind: "quota_exhausted",
      provider: "openai_compatible",
    });

    await expect(invokeLLM({
      feature: "outreach_draft",
      messages: [{ role: "user", content: "test" }],
    })).resolves.toMatchObject({
      providerTelemetry: {
        provider: "manus_forge",
        model: "gemini-2.5-flash",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://forge.invalid/v1/chat/completions",
    );
  });

  it("never exposes an upstream response body in the thrown error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: 9, secretEcho: "recipient-and-prompt-data" }),
      { status: 412 },
    )));

    try {
      await invokeLLM({
        messages: [{ role: "user", content: "test" }],
      });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(LLMInvokeError);
      expect(String(error)).not.toContain("recipient-and-prompt-data");
    }
  });

  it("drops unsafe or oversized upstream request IDs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      "provider unavailable",
      {
        status: 503,
        headers: { "x-request-id": "unsafe recipient data" },
      },
    )));

    await expect(invokeLLM({
      feature: "test_feature",
      messages: [{ role: "user", content: "test" }],
    })).rejects.toMatchObject({
      kind: "upstream_unavailable",
      requestId: undefined,
    });
  });

  it("redacts malformed successful response JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      "recipient-and-prompt-data is not JSON",
      { status: 200 },
    )));

    try {
      await invokeLLM({ messages: [{ role: "user", content: "test" }] });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toMatchObject({ kind: "malformed_response", status: 200 });
      expect(String(error)).not.toContain("recipient-and-prompt-data");
    }
  });

  it("keeps the timeout armed while reading the response body", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":'));
        // Deliberately never close: the timeout must end the operation.
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
    })));

    await expect(invokeLLM({
      messages: [{ role: "user", content: "test" }],
      timeoutMs: 10,
    })).rejects.toMatchObject({ kind: "timeout" });
  });
});
