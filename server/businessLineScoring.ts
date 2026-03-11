/**
 * Business Line Scoring Service
 * 
 * Scores each project across 9 Atlas Copco Power Technique dimensions using LLM analysis.
 * Each dimension gets a relevance score (0-100) and a short explanation.
 * 
 * Scoring Dimensions:
 * 1. Portable Air — portable compressors for mining, construction, drilling, blasting, tunnelling
 * 2. PAL — power generators (QAS/QES), lighting towers (HiLight)
 * 3. BESS — battery energy storage, hybrid power, solar hybrid, ZenergiZe
 * 4. Pump/Dewatering — dewatering pumps, submersible pumps, wellpoint systems (PAS/WEDA)
 * 5. Generators — standalone generator opportunity (subset of PAL but distinct sales channel)
 * 6. Nitrogen — nitrogen generation, N2 solutions, inerting, purging, blanketing
 * 7. Booster — high-pressure boosters, HP compressors, pipeline testing, well services
 * 8. Service Potential — aftermarket, service contracts, parts, maintenance, fleet management
 * 9. Rental Influence — rental fleet opportunity, short-term hire, OPEX model
 */

import { getDb } from "./db";
import { projectBusinessLineScores, projects } from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";

// ── Constants ──

export const SCORING_DIMENSIONS = [
  "Portable Air",
  "PAL",
  "BESS",
  "Pump/Dewatering",
  "Generators",
  "Nitrogen",
  "Booster",
  "Service Potential",
  "Rental Influence",
] as const;

export type ScoringDimension = typeof SCORING_DIMENSIONS[number];

export interface DimensionScore {
  dimension: ScoringDimension;
  score: number;       // 0-100
  explanation: string; // 1-2 sentence reason
}

export interface ProjectScores {
  projectId: number;
  scores: DimensionScore[];
  topDimensions: ScoringDimension[]; // dimensions with score >= 50
}

// ── LLM Scoring Prompt ──

function buildScoringPrompt(projectData: {
  name: string;
  overview: string | null;
  sector: string;
  equipmentSignals: string[] | null;
  owner: string;
  value: string;
  stage: string | null;
  opportunityRoute: string;
  location: string;
}): string {
  return `You are an Atlas Copco Power Technique (PT) business analyst. Score this project's relevance to each PT business line.

PROJECT:
- Name: ${projectData.name}
- Owner: ${projectData.owner}
- Location: ${projectData.location}
- Value: ${projectData.value}
- Sector: ${projectData.sector}
- Stage: ${projectData.stage || "Unknown"}
- Opportunity Route: ${projectData.opportunityRoute}
- Overview: ${projectData.overview || "No overview available"}
- Equipment Signals: ${projectData.equipmentSignals?.join(", ") || "None detected"}

Score this project from 0-100 for each of the following 9 business lines. Provide a 1-2 sentence explanation for each score.

SCORING GUIDE:
- 80-100: Direct, strong relevance — the project explicitly needs this product/service
- 50-79: Moderate relevance — the project likely needs this, or there's a clear indirect opportunity
- 20-49: Low relevance — possible but not primary need
- 0-19: Minimal or no relevance

BUSINESS LINES:
1. **Portable Air**: Portable compressors for mining, construction, drilling, blasting, tunnelling, shotcrete, sandblasting. Key products: XAS/XATS/XAVS/XRHS series. Score high for any project involving drilling, blasting, tunnelling, mining operations, or construction requiring compressed air on-site.

2. **PAL** (Power & Light): Power generators (QAS/QES series), lighting towers (HiLight series). Score high for remote sites needing temporary or permanent power, construction lighting, mine site power.

3. **BESS** (Battery Energy Storage): Battery energy storage systems, hybrid power solutions, solar hybrid, peak shaving, microgrids. ZenergiZe range. Score high for renewable energy projects, remote power with ESG goals, mine electrification, hybrid power needs.

4. **Pump/Dewatering**: Dewatering pumps, submersible pumps, wellpoint systems. PAS/WEDA series. Score high for any project with water management needs — mine dewatering, construction site dewatering, flood management, water treatment, dam projects.

5. **Generators**: Standalone generator sales opportunity (distinct from PAL rental). Score high when the project needs permanent or semi-permanent power generation equipment that would be purchased rather than rented.

6. **Nitrogen**: Nitrogen generation systems, N2 solutions for inerting, purging, blanketing, pipeline testing, well completions. Score high for oil & gas projects, pipeline construction, chemical plants, mining operations needing nitrogen.

7. **Booster**: High-pressure boosters, HP compressors for pipeline testing, well services, pressure testing, gas boosting. Score high for pipeline projects, well testing, pressure testing applications, gas processing.

8. **Service Potential**: Aftermarket opportunity — service contracts, parts supply, maintenance agreements, fleet management, condition monitoring. Score based on the project's potential for ongoing service revenue after initial equipment sale. Large, long-duration projects score higher.

9. **Rental Influence**: Rental fleet opportunity — short-term hire, OPEX model rather than CAPEX purchase. Score high for short-duration projects, contractor-led work, projects where rental is more likely than purchase.`;
}

// ── Score a single project ──

export async function scoreProject(projectId: number): Promise<ProjectScores | null> {
  const db = await getDb();
  if (!db) return null;

  // Fetch project data
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    console.log(`[BL-Scoring] Project ${projectId} not found`);
    return null;
  }

  return scoreProjectFromData(project);
}

export async function scoreProjectFromData(project: {
  id: number;
  name: string;
  overview: string | null;
  sector: string;
  equipmentSignals: unknown;
  owner: string;
  value: string;
  stage: string | null;
  opportunityRoute: string;
  location: string;
}): Promise<ProjectScores> {
  const prompt = buildScoringPrompt({
    name: project.name,
    overview: project.overview,
    sector: project.sector,
    equipmentSignals: project.equipmentSignals as string[] | null,
    owner: project.owner,
    value: project.value,
    stage: project.stage,
    opportunityRoute: project.opportunityRoute,
    location: project.location,
  });

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a business analyst. Always respond with valid JSON matching the requested schema.",
        },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "business_line_scores",
          strict: true,
          schema: {
            type: "object",
            properties: {
              scores: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    dimension: {
                      type: "string",
                      enum: [...SCORING_DIMENSIONS],
                    },
                    score: { type: "integer" },
                    explanation: { type: "string" },
                  },
                  required: ["dimension", "score", "explanation"],
                  additionalProperties: false,
                },
              },
            },
            required: ["scores"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error("Empty LLM response");
    }

    const parsed = JSON.parse(content) as {
      scores: Array<{ dimension: string; score: number; explanation: string }>;
    };

    // Normalize and validate scores
    const scores: DimensionScore[] = SCORING_DIMENSIONS.map(dim => {
      const found = parsed.scores.find(s => s.dimension === dim);
      return {
        dimension: dim,
        score: found ? Math.max(0, Math.min(100, found.score)) : 0,
        explanation: found?.explanation || "Not scored",
      };
    });

    const topDimensions = scores
      .filter(s => s.score >= 50)
      .sort((a, b) => b.score - a.score)
      .map(s => s.dimension);

    return {
      projectId: project.id,
      scores,
      topDimensions,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[BL-Scoring] Error scoring project ${project.id}: ${errMsg}`);

    // Return zero scores on error
    return {
      projectId: project.id,
      scores: SCORING_DIMENSIONS.map(dim => ({
        dimension: dim,
        score: 0,
        explanation: "Scoring failed — will retry on next pipeline run",
      })),
      topDimensions: [],
    };
  }
}

// ── Save scores to database ──

export async function saveProjectScores(projectScores: ProjectScores): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Delete existing scores for this project
  await db
    .delete(projectBusinessLineScores)
    .where(eq(projectBusinessLineScores.projectId, projectScores.projectId));

  // Insert new scores
  if (projectScores.scores.length > 0) {
    await db.insert(projectBusinessLineScores).values(
      projectScores.scores.map(s => ({
        projectId: projectScores.projectId,
        scoringDimension: s.dimension,
        score: s.score,
        explanation: s.explanation,
      }))
    );
  }

  // Update matchedBusinessLines on the project for backward compatibility
  // Map scoring dimensions back to business line IDs where score >= 50
  const blIdMap: Record<string, number> = {
    "Portable Air": 1,
    "PAL": 3,
    "Pump/Dewatering": 30001,
    "BESS": 30002,
  };

  const matchedIds = projectScores.scores
    .filter(s => s.score >= 50 && blIdMap[s.dimension])
    .map(s => blIdMap[s.dimension]!);

  if (matchedIds.length > 0) {
    const db2 = await getDb();
    if (!db2) return;
    await db2
      .update(projects)
      .set({ matchedBusinessLines: matchedIds })
      .where(eq(projects.id, projectScores.projectId));
  }
}

// ── Get scores for a project ──

export async function getProjectScores(projectId: number): Promise<DimensionScore[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(projectBusinessLineScores)
    .where(eq(projectBusinessLineScores.projectId, projectId));

  if (rows.length === 0) return [];

  return SCORING_DIMENSIONS.map(dim => {
    const row = rows.find((r: typeof rows[number]) => r.scoringDimension === dim);
    return {
      dimension: dim,
      score: row?.score ?? 0,
      explanation: row?.explanation ?? "Not scored",
    };
  });
}

// ── Get scores for multiple projects ──

export async function getProjectScoresBatch(projectIds: number[]): Promise<Map<number, DimensionScore[]>> {
  if (projectIds.length === 0) return new Map();

  const db = await getDb();
  if (!db) return new Map();
  const rows = await db
    .select()
    .from(projectBusinessLineScores)
    .where(inArray(projectBusinessLineScores.projectId, projectIds));

  const map = new Map<number, DimensionScore[]>();

  for (const pid of projectIds) {
    const projectRows = rows.filter((r: typeof rows[number]) => r.projectId === pid);
    if (projectRows.length === 0) {
      map.set(pid, []);
      continue;
    }

    map.set(pid, SCORING_DIMENSIONS.map(dim => {
      const row = projectRows.find((r: typeof rows[number]) => r.scoringDimension === dim);
      return {
        dimension: dim,
        score: row?.score ?? 0,
        explanation: row?.explanation ?? "Not scored",
      };
    }));
  }

  return map;
}

// ── Batch score multiple projects ──

export async function scoreAndSaveProjects(
  projectIds: number[],
  options?: { onProgress?: (done: number, total: number) => void }
): Promise<{ scored: number; failed: number; errors: string[] }> {
  const result = { scored: 0, failed: 0, errors: [] as string[] };

  for (let i = 0; i < projectIds.length; i++) {
    try {
      const scores = await scoreProject(projectIds[i]!);
      if (scores) {
        await saveProjectScores(scores);
        result.scored++;
      } else {
        result.failed++;
        result.errors.push(`Project ${projectIds[i]} not found`);
      }
    } catch (err: unknown) {
      result.failed++;
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Project ${projectIds[i]}: ${errMsg}`);
    }

    options?.onProgress?.(i + 1, projectIds.length);

    // Rate limit: 1 second between LLM calls
    if (i < projectIds.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return result;
}

// ── Get unscored projects ──

export async function getUnscoredProjectIds(limit = 50): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];

  // Find active projects that don't have any scores yet
  const allProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.lifecycleStatus, "active"));

  const scoredProjectIds = await db
    .select({ projectId: projectBusinessLineScores.projectId })
    .from(projectBusinessLineScores);

  const scoredSet = new Set(scoredProjectIds.map((r: { projectId: number }) => r.projectId));
  const unscored = allProjects
    .filter((p: { id: number }) => !scoredSet.has(p.id))
    .map((p: { id: number }) => p.id);

  return unscored.slice(0, limit);
}
