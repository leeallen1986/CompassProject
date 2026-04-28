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
import { classifyAndPersistProject } from "./geoClassifier";
import { matchCollateralAsync } from "./collateralService";
import { eq, and, inArray } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";
import { computeScoreModifiers, applyScoreAdjustments, type ActivityScoreModifiers } from "./activitySignalLayer";

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
}, activitySummary?: string): string {
  const activitySection = activitySummary
    ? `\n\nACTIVITY SIGNAL ANALYSIS (pre-computed from project text):\n${activitySummary}\n\nIMPORTANT: Use the activity signals above to guide your scoring. Score based on WHAT ACTIVITIES ARE HAPPENING ON SITE, not just the sector or project type. For example:\n- Drilling/tunnelling/blasting → Portable Air should be HIGH\n- Excavation/trenching/groundwater → Pump/Dewatering should be HIGH\n- Pipeline hydrotest/purge → Nitrogen and Booster should be HIGH\n- Remote construction without drilling → Portable Air should be MODERATE at most\n- Early-stage (exploration/feasibility) without confirmed activities → reduce all equipment scores`
    : "";

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
- Equipment Signals: ${projectData.equipmentSignals?.join(", ") || "None detected"}${activitySection}

Score this project from 0-100 for each of the following 9 business lines. Provide a 1-2 sentence explanation for each score.

CRITICAL SCORING PRINCIPLE — ACTIVITY-BASED SCORING:
Do NOT score based on sector alone. Score based on the SPECIFIC SITE ACTIVITIES that will occur.
Ask: "What activities are happening on this site?" then map activities to equipment:
- Drilling, tunnelling, blasting, shotcrete → Portable Air HIGH
- Excavation, trenching, groundwater, pit dewatering → Pump/Dewatering HIGH
- Pipeline hydrotest, purge, inerting → Nitrogen HIGH, Booster HIGH
- Remote construction, temporary camp → Generators HIGH, PAL HIGH
- Shutdown/turnaround → Rental Influence HIGH, Service Potential HIGH

If no clear compressed-air activity is present, Portable Air should NOT automatically score high.
If groundwater/excavation/drainage signals are present, Pump/Dewatering should score HIGH.

SCORING GUIDE:
- 80-100: Direct, strong relevance — confirmed site activities explicitly need this product/service
- 50-79: Moderate relevance — likely activities suggest this need, or clear indirect opportunity
- 20-49: Low relevance — possible but not primary need based on detected activities
- 0-19: Minimal or no relevance — no matching activities detected

BUSINESS LINES:
1. **Portable Air**: Portable compressors for drilling, blasting, tunnelling, shotcrete, sandblasting, underground mining. Key products: XAS/XATS/XAVS/XRHS series. Score HIGH only when drilling, blasting, tunnelling, or compressed-air activities are confirmed. Do NOT auto-score high just because it's a mining or construction project.

2. **PAL** (Power & Light): Power generators (QAS/QES series), lighting towers (HiLight series). Score high for remote sites needing temporary or permanent power, construction lighting, mine site power.

3. **BESS** (Battery Energy Storage): Battery energy storage systems, hybrid power solutions, solar hybrid, peak shaving, microgrids. ZenergiZe range. Score high for renewable energy projects, remote power with ESG goals, mine electrification, hybrid power needs.

4. **Pump/Dewatering**: Dewatering pumps, submersible pumps, wellpoint systems. PAS/WEDA series. Score HIGH for any project with water management needs — mine dewatering, construction site dewatering, excavation, trenching, tunnelling, groundwater, flood management, dam projects. Look for environmental signals: groundwater, water table, drainage, seepage, pit water.

5. **Generators**: Standalone generator sales opportunity (distinct from PAL rental). Score high when the project needs permanent or semi-permanent power generation equipment that would be purchased rather than rented.

6. **Nitrogen**: Nitrogen generation systems, N2 solutions for inerting, purging, blanketing, pipeline testing, well completions. Score high for pipeline construction, oil & gas projects, chemical plants, pipeline hydrotest/purge.

7. **Booster**: High-pressure boosters, HP compressors for pipeline testing, well services, pressure testing, gas boosting. Score high for pipeline projects, well testing, pressure testing applications, gas processing.

8. **Service Potential**: Aftermarket opportunity — service contracts, parts supply, maintenance agreements, fleet management, condition monitoring. Score based on the project's potential for ongoing service revenue after initial equipment sale. Large, long-duration projects score higher.

9. **Rental Influence**: Rental fleet opportunity — short-term hire, OPEX model rather than CAPEX purchase. Score high for short-duration projects, contractor-led work, shutdown/turnaround, projects where rental is more likely than purchase.`;
}

// ── Fire-and-forget scoring for newly inserted projects ──

/**
 * Non-blocking BL scoring for a newly inserted project.
 * Call this immediately after inserting a project in any ingest service.
 * Logs success/failure but never throws.
 */
export function scoreProjectAsync(projectId: number, source: string = "unknown"): void {
  scoreProject(projectId)
    .then(scores => {
      if (scores) {
        saveProjectScores(scores).then(() => {
          console.log(`[BL-Scoring] Scored project ${projectId} from ${source}: top=${scores.topDimensions.join(", ")}`);
        });
      }
    })
    .catch(err => {
      console.error(`[BL-Scoring] Failed to score project ${projectId} from ${source}:`, err instanceof Error ? err.message : String(err));
    });

  // Also run collateral matching for the new project (non-blocking)
  matchCollateralAsync(projectId, source);

  // Geo-classify the project immediately (AU-only gate)
  classifyAndPersistProject(projectId)
    .then(result => {
      if (result?.geoBlockedReason) {
        console.log(`[GeoClassifier] Project ${projectId} from ${source}: BLOCKED (${result.geoBlockedReason}, confidence=${result.locationConfidence})`);
      }
    })
    .catch(err => {
      console.error(`[GeoClassifier] Failed to classify project ${projectId}:`, err instanceof Error ? err.message : String(err));
    });
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
  // ── Activity Signal Layer: pre-compute activity signals ──
  const eqSignals = project.equipmentSignals as string[] | null;
  const modifiers = computeScoreModifiers(
    project.name,
    project.overview,
    eqSignals,
    project.stage,
    project.sector,
  );

  if (modifiers.activities.length > 0) {
    console.log(
      `[BL-Scoring] Project ${project.id}: detected activities: ${modifiers.activities.map(a => a.activity).join(", ")} | stage: ${modifiers.stageWeight} | env signals: ${modifiers.environmentalSignals.length}`
    );
  }

  const prompt = buildScoringPrompt(
    {
      name: project.name,
      overview: project.overview,
      sector: project.sector,
      equipmentSignals: eqSignals,
      owner: project.owner,
      value: project.value,
      stage: project.stage,
      opportunityRoute: project.opportunityRoute,
      location: project.location,
    },
    modifiers.promptSummary,
  );

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a business analyst specialising in site-activity-based equipment scoring. Score based on WHAT ACTIVITIES ARE HAPPENING ON SITE, not just the sector. Always respond with valid JSON matching the requested schema.",
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

    // Normalize and validate LLM scores
    const llmScores = SCORING_DIMENSIONS.map(dim => {
      const found = parsed.scores.find(s => s.dimension === dim);
      return {
        dimension: dim,
        score: found ? Math.max(0, Math.min(100, found.score)) : 0,
        explanation: found?.explanation || "Not scored",
      };
    });

    // ── Activity Signal Layer: apply deterministic post-LLM adjustments ──
    const adjustedScores: DimensionScore[] = applyScoreAdjustments(llmScores, modifiers);

    const topDimensions = adjustedScores
      .filter(s => s.score >= 50)
      .sort((a, b) => b.score - a.score)
      .map(s => s.dimension);

    return {
      projectId: project.id,
      scores: adjustedScores,
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
