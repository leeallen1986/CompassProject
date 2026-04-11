/**
 * domainInference.ts — LLM-powered domain inference for company names
 *
 * Given a list of company names (e.g., "Ausdrill", "Boart Longyear"),
 * uses the LLM to infer the most likely website domain for each.
 *
 * Strategy:
 * - Batch companies in groups of 20 to minimize LLM calls
 * - Use structured JSON output for reliable parsing
 * - Return confidence level so downstream can decide whether to use Hunter or Apollo
 */

import { invokeLLM } from "./_core/llm";

export interface DomainInferenceResult {
  company: string;
  domain: string | null;
  confidence: "high" | "medium" | "low";
}

const BATCH_SIZE = 20;

/**
 * Infer domains for a batch of company names using the LLM.
 * Returns results in the same order as input.
 */
async function inferDomainsBatch(companies: string[]): Promise<DomainInferenceResult[]> {
  const numberedList = companies.map((c, i) => `${i + 1}. ${c}`).join("\n");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a business domain expert specializing in Australian mining, drilling, construction, and energy companies. Given a list of company names, infer the most likely primary website domain for each company.

Rules:
- Return the main corporate website domain (e.g., "ausdrill.com.au", "boartlongyear.com")
- For Australian companies, prefer .com.au domains when likely
- If you are confident about the domain, mark confidence as "high"
- If you think it's likely but not certain, mark as "medium"
- If you cannot determine the domain or the company is too generic/unknown, return null for domain and "low" for confidence
- Do NOT guess randomly — it's better to return null than an incorrect domain
- Do NOT include "www." prefix, just the bare domain
- Common patterns: company names often map to companyname.com.au or companyname.com`,
      },
      {
        role: "user",
        content: `Infer the website domain for each of these companies:\n\n${numberedList}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "domain_inference",
        strict: true,
        schema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer", description: "1-based index matching the input list" },
                  company: { type: "string", description: "The company name as provided" },
                  domain: {
                    type: ["string", "null"],
                    description: "Inferred domain or null if unknown",
                  },
                  confidence: {
                    type: "string",
                    enum: ["high", "medium", "low"],
                    description: "Confidence level in the domain inference",
                  },
                },
                required: ["index", "company", "domain", "confidence"],
                additionalProperties: false,
              },
            },
          },
          required: ["results"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    console.error("[DomainInference] No content in LLM response");
    return companies.map(c => ({ company: c, domain: null, confidence: "low" as const }));
  }

  try {
    const parsed = JSON.parse(content) as { results: Array<{ index: number; company: string; domain: string | null; confidence: "high" | "medium" | "low" }> };

    // Map results back to input order, handling any missing entries
    return companies.map((company, i) => {
      const match = parsed.results.find(r => r.index === i + 1);
      if (match) {
        return {
          company,
          domain: match.domain ? match.domain.replace(/^www\./, "").toLowerCase().trim() : null,
          confidence: match.confidence,
        };
      }
      return { company, domain: null, confidence: "low" as const };
    });
  } catch (err) {
    console.error("[DomainInference] Failed to parse LLM response:", err, content);
    return companies.map(c => ({ company: c, domain: null, confidence: "low" as const }));
  }
}

/**
 * Infer domains for a list of company names.
 * Batches requests to the LLM in groups of BATCH_SIZE.
 *
 * @param companies - Array of company names
 * @param onProgress - Optional callback for progress updates
 * @returns Array of DomainInferenceResult in the same order as input
 */
export async function inferCompanyDomains(
  companies: string[],
  onProgress?: (completed: number, total: number, currentBatch: string[]) => void,
): Promise<DomainInferenceResult[]> {
  if (companies.length === 0) return [];

  const results: DomainInferenceResult[] = [];
  const batches: string[][] = [];

  // Split into batches
  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    batches.push(companies.slice(i, i + BATCH_SIZE));
  }

  console.log(`[DomainInference] Processing ${companies.length} companies in ${batches.length} batches of ${BATCH_SIZE}`);

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];

    if (onProgress) {
      onProgress(batchIdx * BATCH_SIZE, companies.length, batch);
    }

    try {
      const batchResults = await inferDomainsBatch(batch);
      results.push(...batchResults);
    } catch (err) {
      console.error(`[DomainInference] Batch ${batchIdx + 1} failed:`, err);
      // Fill with nulls for failed batch
      results.push(...batch.map(c => ({ company: c, domain: null, confidence: "low" as const })));
    }

    // Small delay between batches to avoid rate limiting
    if (batchIdx < batches.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (onProgress) {
    onProgress(companies.length, companies.length, []);
  }

  const resolved = results.filter(r => r.domain !== null);
  const highConf = results.filter(r => r.confidence === "high");
  const medConf = results.filter(r => r.confidence === "medium");
  console.log(`[DomainInference] Resolved ${resolved.length}/${companies.length} domains (${highConf.length} high, ${medConf.length} medium confidence)`);

  return results;
}
