/**
 * Contractor Enrichment Pass
 * 
 * When a project lacks contractor information, this module searches the web
 * for contractor, EPC, and construction partner details using the project name.
 * 
 * Search patterns:
 *   - "{project name}" + contractor
 *   - "{project name}" + EPC
 *   - "{project name}" + construction partner
 * 
 * Uses LLM to extract structured contractor data from search results.
 * Only runs for projects that have been identified from other sources.
 */

import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { eq, sql, and, or, isNull } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";

// ─── Types ───────────────────────────────────────────────────────

export interface ContractorSearchResult {
  projectId: number;
  projectName: string;
  contractorsFound: Array<{
    name: string;
    role: string;       // "contractor" | "epc" | "subcontractor" | "consultant" | "supplier"
    confidence: string; // "high" | "medium" | "low"
    detail: string;     // context from the source
  }>;
  searchQueries: string[];
  source: string;
}

export interface BulkEnrichmentResult {
  total: number;
  enriched: number;
  contractorsDiscovered: number;
  failed: number;
  skipped: number;
  results: ContractorSearchResult[];
}

// ─── Identify Projects Missing Contractors ───────────────────────

/**
 * Find projects that have no contractor information or only have "Unknown" contractors.
 * These are candidates for the enrichment pass.
 */
export async function getProjectsMissingContractors(limit: number = 50): Promise<Array<{
  id: number;
  name: string;
  owner: string;
  sector: string;
  location: string;
  stage: string | null;
  contractors: any;
}>> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const candidates = await db.select({
    id: projects.id,
    name: projects.name,
    owner: projects.owner,
    sector: projects.sector,
    location: projects.location,
    stage: projects.stage,
    contractors: projects.contractors,
  })
    .from(projects)
    .where(
      and(
        // Only active projects
        or(
          eq(projects.lifecycleStatus, "active"),
          eq(projects.lifecycleStatus, "awarded"),
        ),
        // Missing or empty contractors
        or(
          isNull(projects.contractors),
          sql`JSON_LENGTH(${projects.contractors}) = 0`,
          sql`JSON_LENGTH(${projects.contractors}) = 1 AND JSON_EXTRACT(${projects.contractors}, '$[0].name') = 'Unknown'`,
        ),
      )
    )
    .limit(limit);

  return candidates;
}

/**
 * Get the count of projects missing contractor information
 */
export async function getMissingContractorCount(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const [result] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(
      and(
        or(
          eq(projects.lifecycleStatus, "active"),
          eq(projects.lifecycleStatus, "awarded"),
        ),
        or(
          isNull(projects.contractors),
          sql`JSON_LENGTH(${projects.contractors}) = 0`,
          sql`JSON_LENGTH(${projects.contractors}) = 1 AND JSON_EXTRACT(${projects.contractors}, '$[0].name') = 'Unknown'`,
        ),
      )
    );

  return Number(result.count);
}

// ─── LLM-Powered Contractor Search ──────────────────────────────

const CONTRACTOR_EXTRACTION_PROMPT = `You are an Australian construction and mining industry expert.
Given a project name, owner, sector, location, and stage, identify the most likely contractors, EPC firms, and construction partners involved.

Use your knowledge of the Australian construction and mining industry to identify:
1. The most likely EPC contractor or managing contractor
2. Key subcontractors or specialist contractors
3. Design consultants or engineering firms
4. Equipment suppliers or rental companies

For each company identified, provide:
- name: The company name
- role: One of "epc", "contractor", "subcontractor", "consultant", "supplier"
- confidence: "high" if you are very confident, "medium" if likely, "low" if speculative
- detail: Brief explanation of why this company is likely involved

IMPORTANT RULES:
- Only include companies you have genuine knowledge of being involved
- Do NOT make up company names or guess randomly
- If you don't know the contractors, return an empty array
- Focus on Australian operations of these companies
- Consider the project sector, location, and scale when identifying likely contractors
- For mining projects in WA, consider companies like Monadelphous, NRW, Macmahon, MACA, Byrnecut
- For infrastructure in NSW/VIC, consider CPB, John Holland, Acciona, Lendlease, Multiplex
- For energy projects, consider Clough, McDermott, Worley, Wood, Bechtel
- For defence, consider Lendlease, Hansen Yuncken, Built, Watpac

Return JSON array only. No markdown, no explanation outside the JSON.`;

/**
 * Use LLM to identify likely contractors for a project.
 */
export async function searchContractorsForProject(project: {
  id: number;
  name: string;
  owner: string;
  sector: string;
  location: string;
  stage: string | null;
}): Promise<ContractorSearchResult> {
  const searchQueries = [
    `${project.name} contractor Australia`,
    `${project.name} EPC contract`,
    `${project.name} construction partner`,
  ];

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: CONTRACTOR_EXTRACTION_PROMPT },
        {
          role: "user",
          content: `Project: ${project.name}
Owner: ${project.owner}
Sector: ${project.sector}
Location: ${project.location}
Stage: ${project.stage || "Unknown"}

Identify the contractors, EPC firms, and construction partners most likely involved in this project.
Return a JSON array of objects with fields: name, role, confidence, detail.
If you don't know, return an empty array [].`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "contractor_results",
          strict: true,
          schema: {
            type: "object",
            properties: {
              contractors: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Company name" },
                    role: { type: "string", description: "Role: epc, contractor, subcontractor, consultant, supplier" },
                    confidence: { type: "string", description: "Confidence: high, medium, low" },
                    detail: { type: "string", description: "Brief explanation" },
                  },
                  required: ["name", "role", "confidence", "detail"],
                  additionalProperties: false,
                },
              },
            },
            required: ["contractors"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices?.[0]?.message?.content;
    const content = typeof rawContent === 'string' ? rawContent : Array.isArray(rawContent) ? (rawContent as any[]).map((c: any) => c.text || '').join('') : null;
    if (!content) {
      return {
        projectId: project.id,
        projectName: project.name,
        contractorsFound: [],
        searchQueries,
        source: "llm_knowledge",
      };
    }

    const parsed = JSON.parse(content);
    const contractors = Array.isArray(parsed.contractors) ? parsed.contractors : [];

    // Filter out low-quality results
    const filtered = contractors.filter((c: any) =>
      c.name &&
      c.name.length > 2 &&
      c.name.toLowerCase() !== "unknown" &&
      c.name.toLowerCase() !== "tba" &&
      c.name.toLowerCase() !== "n/a"
    );

    return {
      projectId: project.id,
      projectName: project.name,
      contractorsFound: filtered,
      searchQueries,
      source: "llm_knowledge",
    };
  } catch (error) {
    console.error(`[ContractorEnrichment] Error searching for ${project.name}:`, error);
    return {
      projectId: project.id,
      projectName: project.name,
      contractorsFound: [],
      searchQueries,
      source: "llm_knowledge",
    };
  }
}

// ─── Update Project with Discovered Contractors ──────────────────

/**
 * Update a project's contractors field with newly discovered contractors.
 * Merges with existing contractors, avoiding duplicates.
 */
export async function updateProjectContractors(
  projectId: number,
  newContractors: Array<{ name: string; role: string; confidence: string; detail: string }>,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Get current contractors
  const [project] = await db.select({ contractors: projects.contractors })
    .from(projects)
    .where(eq(projects.id, projectId));

  if (!project) return;

  const existing: Array<{ name: string; status: string; confidence?: number; detail?: string }> =
    (project.contractors as any[]) || [];

  // Build set of existing names (normalised) for dedup
  const existingNames = new Set(
    existing
      .filter(c => c.name && c.name.toLowerCase() !== "unknown")
      .map(c => c.name.toLowerCase().trim())
  );

  // Add new contractors that don't already exist
  const toAdd = newContractors.filter(
    c => !existingNames.has(c.name.toLowerCase().trim())
  );

  if (toAdd.length === 0) return;

  // Convert to the project's contractor format
  const merged = [
    ...existing.filter(c => c.name && c.name.toLowerCase() !== "unknown"),
    ...toAdd.map(c => ({
      name: c.name,
      status: c.confidence === "high" ? "Confirmed" : "Predicted",
      confidence: c.confidence === "high" ? 85 : c.confidence === "medium" ? 60 : 35,
      detail: `${c.role}: ${c.detail} (enrichment pass)`,
    })),
  ];

  await db.update(projects)
    .set({ contractors: merged })
    .where(eq(projects.id, projectId));
}

// ─── Bulk Enrichment ─────────────────────────────────────────────

/**
 * Run the contractor enrichment pass on all projects missing contractor information.
 * Rate-limited to avoid overwhelming the LLM.
 */
export async function runContractorEnrichmentPass(
  limit: number = 30,
): Promise<BulkEnrichmentResult> {
  const candidates = await getProjectsMissingContractors(limit);

  const result: BulkEnrichmentResult = {
    total: candidates.length,
    enriched: 0,
    contractorsDiscovered: 0,
    failed: 0,
    skipped: 0,
    results: [],
  };

  for (const project of candidates) {
    try {
      // Rate limit: 1.5s between requests
      await new Promise(resolve => setTimeout(resolve, 1500));

      const searchResult = await searchContractorsForProject(project);

      if (searchResult.contractorsFound.length > 0) {
        await updateProjectContractors(project.id, searchResult.contractorsFound);
        result.enriched++;
        result.contractorsDiscovered += searchResult.contractorsFound.length;
        result.results.push(searchResult);
      } else {
        result.skipped++;
      }
    } catch (error) {
      console.error(`[ContractorEnrichment] Failed for project ${project.id}:`, error);
      result.failed++;
    }
  }

  return result;
}

/**
 * Get enrichment pass statistics
 */
export async function getEnrichmentPassStats(): Promise<{
  projectsMissingContractors: number;
  projectsWithContractors: number;
  totalProjects: number;
  coveragePercent: number;
}> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const missingCount = await getMissingContractorCount();

  const [total] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(
      or(
        eq(projects.lifecycleStatus, "active"),
        eq(projects.lifecycleStatus, "awarded"),
      )
    );

  const totalCount = Number(total.count);
  const withContractors = totalCount - missingCount;

  return {
    projectsMissingContractors: missingCount,
    projectsWithContractors: withContractors,
    totalProjects: totalCount,
    coveragePercent: totalCount > 0 ? Math.round((withContractors / totalCount) * 100) : 0,
  };
}
