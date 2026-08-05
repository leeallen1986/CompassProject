import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({
  ENV: {
    forgeApiKey: "test-key-never-sent",
    forgeApiUrl: "https://forge.invalid",
  },
}));

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
    expect(JSON.stringify(body)).not.toContain("test-key-never-sent");
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
    });
    await expect(invoke()).rejects.toMatchObject({ kind: "circuit_open" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
