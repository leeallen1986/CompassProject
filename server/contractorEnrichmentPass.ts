/**
 * Contractor Hypothesis Pass
 * 
 * When a project lacks contractor information, this module generates contractor, EPC and delivery-chain hypotheses from project context.
 * It does not perform attributable web search and must never create confirmed facts.
 * 
 * Search patterns:
 *   - "{project name}" + contractor
 *   - "{project name}" + EPC
 *   - "{project name}" + construction partner
 * 
 * Uses an LLM to generate structured, explicitly unverified contractor hypotheses.
 * Only runs for projects that have been identified from other sources.
 */

import { getDb } from "./db";
import { projects, awardedProjects } from "../drizzle/schema";
import { eq, sql, and, or, isNull } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";
import { toPersistedContractorHypothesis } from "./intelligenceTrustPolicy";

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
    .orderBy(sql`FIELD(${projects.priority}, 'hot', 'warm', 'cold')`)
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

// ─── Awarded Project Cross-Reference ────────────────────────────

interface AwardedPattern {
  contractor: string;
  projects: string[];
  locations: string[];
}

/**
 * Build a contractor pattern map from awarded projects.
 * Groups by location region (state) to identify which contractors
 * typically win work in each area.
 */
async function getAwardedProjectPatterns(): Promise<{
  byLocation: Map<string, AwardedPattern[]>;
  allPatterns: AwardedPattern[];
}> {
  const db = await getDb();
  if (!db) return { byLocation: new Map(), allPatterns: [] };

  const awarded = await db.select({
    project: awardedProjects.project,
    winningContractor: awardedProjects.winningContractor,
    location: awardedProjects.location,
    value: awardedProjects.value,
  }).from(awardedProjects);

  // Group by contractor
  const contractorMap = new Map<string, { projects: string[]; locations: string[] }>();
  for (const a of awarded) {
    const name = a.winningContractor.trim();
    if (!contractorMap.has(name)) {
      contractorMap.set(name, { projects: [], locations: [] });
    }
    const entry = contractorMap.get(name)!;
    entry.projects.push(`${a.project} (${a.value})`);
    if (!entry.locations.includes(a.location)) {
      entry.locations.push(a.location);
    }
  }

  const allPatterns: AwardedPattern[] = [];
  for (const [contractor, data] of Array.from(contractorMap.entries())) {
    allPatterns.push({ contractor, projects: data.projects, locations: data.locations });
  }

  // Group by state extracted from location
  const byLocation = new Map<string, AwardedPattern[]>();
  const stateAbbrevs = ["WA", "QLD", "NSW", "VIC", "SA", "TAS", "NT", "ACT"];
  for (const pattern of allPatterns) {
    for (const loc of pattern.locations) {
      for (const state of stateAbbrevs) {
        if (loc.toUpperCase().includes(state)) {
          if (!byLocation.has(state)) byLocation.set(state, []);
          const stateList = byLocation.get(state)!;
          if (!stateList.find(p => p.contractor === pattern.contractor)) {
            stateList.push(pattern);
          }
        }
      }
    }
  }

  return { byLocation, allPatterns };
}

/**
 * Format awarded project patterns as context for the LLM prompt.
 */
function formatAwardedContext(project: { location: string; sector: string }, patterns: {
  byLocation: Map<string, AwardedPattern[]>;
  allPatterns: AwardedPattern[];
}): string {
  const stateAbbrevs = ["WA", "QLD", "NSW", "VIC", "SA", "TAS", "NT", "ACT"];
  const projectState = stateAbbrevs.find(s => project.location.toUpperCase().includes(s));

  const lines: string[] = [];
  lines.push("\n\nAWARDED PROJECT DATABASE (real contract wins in Australia):");

  // Show contractors active in the same state
  if (projectState && patterns.byLocation.has(projectState)) {
    const statePatterns = patterns.byLocation.get(projectState)!;
    lines.push(`\nContractors active in ${projectState}:`);
    for (const p of statePatterns.slice(0, 10)) {
      lines.push(`- ${p.contractor}: won ${p.projects.slice(0, 3).join("; ")}`);
    }
  }

  // Show top contractors overall
  const sorted = [...patterns.allPatterns].sort((a, b) => b.projects.length - a.projects.length);
  lines.push(`\nTop contractors by awarded project count:`);
  for (const p of sorted.slice(0, 8)) {
    lines.push(`- ${p.contractor} (${p.projects.length} wins): active in ${p.locations.join(", ")}`);
  }

  lines.push("\nUse this awarded project data to inform your predictions. If a contractor has won similar projects in the same region, they are more likely to be involved.");

  return lines.join("\n");
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
- Prioritise contractors that have won similar projects in the same region (see AWARDED PROJECT DATABASE below)
- For mining projects in WA, consider companies like Monadelphous, NRW, Macmahon, MACA, Byrnecut
- For infrastructure in NSW/VIC, consider CPB, John Holland, Acciona, Lendlease, Multiplex
- For energy projects, consider Clough, McDermott, Worley, Wood, Bechtel
- For defence, consider Lendlease, Hansen Yuncken, Built, Watpac

Return JSON array only. No markdown, no explanation outside the JSON.`;

/**
 * Use LLM to identify likely contractors for a project.
 */
// Cache awarded patterns so we don't re-query for every project
let _awardedPatternsCache: Awaited<ReturnType<typeof getAwardedProjectPatterns>> | null = null;
let _awardedPatternsCacheTime = 0;

async function getCachedAwardedPatterns() {
  const now = Date.now();
  if (!_awardedPatternsCache || now - _awardedPatternsCacheTime > 10 * 60 * 1000) {
    _awardedPatternsCache = await getAwardedProjectPatterns();
    _awardedPatternsCacheTime = now;
  }
  return _awardedPatternsCache;
}

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
    // Get awarded project patterns for cross-referencing
    const awardedPatterns = await getCachedAwardedPatterns();
    const awardedContext = formatAwardedContext(project, awardedPatterns);

    const response = await invokeLLM({
      messages: [
        { role: "system", content: CONTRACTOR_EXTRACTION_PROMPT + awardedContext },
        {
          role: "user",
          content: `Project: ${project.name}
Owner: ${project.owner}
Sector: ${project.sector}
Location: ${project.location}
Stage: ${project.stage || "Unknown"}

Identify the contractors, EPC firms, and construction partners most likely involved in this project.
Use the awarded project database above to inform your predictions where relevant.
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
        source: "llm_hypothesis",
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
      source: "llm_hypothesis",
    };
  } catch (error) {
    console.error(`[ContractorEnrichment] Error searching for ${project.name}:`, error);
    return {
      projectId: project.id,
      projectName: project.name,
      contractorsFound: [],
      searchQueries,
      source: "llm_hypothesis",
    };
  }
}

// ─── Update Project with Discovered Contractors ──────────────────

/**
 * Update a project's contractors field with new contractor hypotheses.
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
    ...toAdd.map(toPersistedContractorHypothesis),
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
