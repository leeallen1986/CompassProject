import { LLMInvokeError } from "./llmErrors";

export const AI_EXTRACTION_FEATURE = "ai_extraction";

export type LLMProviderName = "manus_forge" | "openai_compatible";

export interface LLMProviderEnvironment {
  forgeApiUrl?: string;
  forgeApiKey?: string;
  aiExtractionProvider?: string;
  aiExtractionApiKey?: string;
  aiExtractionBaseUrl?: string;
  aiExtractionModel?: string;
}

export interface ResolvedLLMProvider {
  name: LLMProviderName;
  endpoint: string;
  apiKey: string;
  model: string;
  circuitKey: string;
  payloadMode: "manus_forge" | "openai_compatible";
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  thinkingBudgetTokens?: number;
  telemetry: {
    provider: LLMProviderName;
    model: string;
  };
}

const DEFAULT_FORGE_ROOT = "https://forge.manus.im";
const DEFAULT_FORGE_MODEL = "gemini-2.5-flash";
const MAX_MODEL_ID_LENGTH = 128;

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

function configurationError(
  provider?: string,
  model?: string,
): LLMInvokeError {
  return new LLMInvokeError({
    kind: "configuration",
    provider,
    model,
  });
}

function assertSafeModel(model: string, provider: LLMProviderName): string {
  if (
    !model ||
    model.length > MAX_MODEL_ID_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model)
  ) {
    throw configurationError(provider);
  }
  return model;
}

function normalizeHttpsUrl(value: string, provider: LLMProviderName): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationError(provider);
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw configurationError(provider);
  }

  return parsed;
}

function normalizeForgeEndpoint(value: string | undefined): string {
  const root = clean(value) || DEFAULT_FORGE_ROOT;
  const parsed = normalizeHttpsUrl(root, "manus_forge");
  const normalized = parsed.toString().replace(/\/+$/, "");

  if (normalized.endsWith("/v1/chat/completions")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

export function normalizeOpenAICompatibleEndpoint(baseUrl: string): string {
  const parsed = normalizeHttpsUrl(clean(baseUrl), "openai_compatible");
  const normalized = parsed.toString().replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) return normalized;
  return `${normalized}/chat/completions`;
}

function resolveForgeProvider(
  env: LLMProviderEnvironment,
): ResolvedLLMProvider {
  const apiKey = clean(env.forgeApiKey);
  if (!apiKey) throw configurationError("manus_forge", DEFAULT_FORGE_MODEL);

  const endpoint = normalizeForgeEndpoint(env.forgeApiUrl);
  const model = DEFAULT_FORGE_MODEL;
  return {
    name: "manus_forge",
    endpoint,
    apiKey,
    model,
    circuitKey: `manus_forge:${model}:${endpoint}`,
    payloadMode: "manus_forge",
    thinkingBudgetTokens: 128,
    telemetry: {
      provider: "manus_forge",
      model,
    },
  };
}

function resolveOpenAICompatibleProvider(
  env: LLMProviderEnvironment,
): ResolvedLLMProvider {
  const apiKey = clean(env.aiExtractionApiKey);
  const baseUrl = clean(env.aiExtractionBaseUrl);
  const model = assertSafeModel(
    clean(env.aiExtractionModel),
    "openai_compatible",
  );

  if (!apiKey || !baseUrl) {
    throw configurationError("openai_compatible", model);
  }

  const endpoint = normalizeOpenAICompatibleEndpoint(baseUrl);
  return {
    name: "openai_compatible",
    endpoint,
    apiKey,
    model,
    circuitKey: `openai_compatible:${model}:${endpoint}`,
    payloadMode: "openai_compatible",
    reasoningEffort: "low",
    telemetry: {
      provider: "openai_compatible",
      model,
    },
  };
}

function configuredAIExtractionProvider(
  env: LLMProviderEnvironment,
): LLMProviderName {
  const configured = clean(env.aiExtractionProvider);
  if (!configured || configured === "manus_forge") return "manus_forge";
  if (configured === "openai_compatible") return "openai_compatible";
  throw configurationError("unresolved");
}

/**
 * Resolve one provider for one feature. AI extraction is the only feature that
 * may opt into an externally managed OpenAI-compatible endpoint. All other
 * features remain on Manus Forge until separately reviewed.
 *
 * There is deliberately no automatic cross-provider fallback: one request is
 * attributable to exactly one configured provider.
 */
export function resolveLLMProvider(
  feature: string | undefined,
  env: LLMProviderEnvironment,
): ResolvedLLMProvider {
  if (feature !== AI_EXTRACTION_FEATURE) {
    return resolveForgeProvider(env);
  }

  return configuredAIExtractionProvider(env) === "openai_compatible"
    ? resolveOpenAICompatibleProvider(env)
    : resolveForgeProvider(env);
}
