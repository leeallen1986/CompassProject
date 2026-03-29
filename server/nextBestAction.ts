/**
 * Next Best Action (NBA) Service
 *
 * For each priority project, generates:
 * - Why this project matters NOW
 * - Best stakeholder to contact first + why
 * - Likely customer pain points
 * - Recommended first action
 * - Simple call angle
 *
 * Uses LLM with structured JSON output, cached per project to avoid
 * redundant calls. Cache refreshes on stage change or weekly.
 */
import { invokeLLM } from "./_core/llm";
import { getDb, getAllContacts } from "./db";
import { projects, contacts, projectBusinessLineScores } from "../drizzle/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { detectActivities } from "./activitySignalLayer";
import { classifyRoleRelevance } from "./roleRelevance";
import { isAustralianRelevant } from "./geoFilter";

// ── Types ──

export interface NBAOutput {
  projectId: number;
  projectName: string;
  whyItMattersNow: string;
  bestStakeholder: {
    name: string;
    title: string;
    company: string;
    whyThisContact: string;
  } | null;
  likelyPainPoints: string[];
  recommendedAction: string;
  callAngle: string;
  relevantBusinessLines: string[];
  urgencyLevel: "urgent" | "high" | "moderate" | "low";
  generatedAt: number; // UTC timestamp
}

// ── In-memory cache (projectId → NBA) ──
// TTL: 24 hours or until stage changes
const nbaCache = new Map<number, { data: NBAOutput; stage: string | null; expiresAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCached(projectId: number, currentStage: string | null): NBAOutput | null {
  const entry = nbaCache.get(projectId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    nbaCache.delete(projectId);
    return null;
  }
  // Invalidate if stage changed
  if (entry.stage !== currentStage) {
    nbaCache.delete(projectId);
    return null;
  }
  return entry.data;
}

function setCache(projectId: number, stage: string | null, data: NBAOutput): void {
  nbaCache.set(projectId, {
    data,
    stage,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/** Clear the entire NBA cache (useful for testing or forced refresh) */
export function clearNBACache(): void {
  nbaCache.clear();
}

// ── Segment Pain-Point Libraries ──

export const SEGMENT_PAIN_POINTS: Record<string, string[]> = {
  mining: [
    "Equipment uptime in remote locations",
    "Mobilisation speed to site",
    "Service coverage in remote areas",
    "Fuel efficiency under heavy load",
    "Water handling and dewatering challenges",
    "Dust suppression and air quality",
    "Drill rig air supply reliability",
  ],
  oil_gas: [
    "Nitrogen supply reliability for purging/testing",
    "Time pressure during shutdown windows",
    "Compliance with safety and emission standards",
    "Turnaround speed for equipment deployment",
    "Remote site logistics and service support",
  ],
  infrastructure: [
    "Temporary air and power during construction",
    "Noise and emission restrictions in urban areas",
    "Groundwater management and dewatering",
    "Site logistics and equipment coordination",
    "Rental flexibility as project phases change",
  ],
  energy: [
    "Battery storage and temporary power reliability",
    "Grid connection timing and backup power",
    "Emission reduction targets",
    "Construction-phase power and air needs",
    "Remote site energy independence",
  ],
  defence: [
    "Security clearance and compliance requirements",
    "Equipment reliability in harsh conditions",
    "Rapid deployment capability",
    "Noise reduction for operational security",
    "Long-term service and maintenance agreements",
  ],
};

// ── Core NBA Generation ──

export async function generateNBA(projectId: number, userBLs?: string[]): Promise<NBAOutput> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Fetch project
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw new Error(`Project ${projectId} not found`);

  // Check cache
  const cached = getCached(projectId, project.stage);
  if (cached) return cached;

  // Fetch contacts for this project
  const projectContacts = await db
    .select()
    .from(contacts)
    .where(eq(contacts.project, project.name))
    .orderBy(desc(contacts.id))
    .limit(20);

  // Fetch BL scores
  const blScores = await db
    .select()
    .from(projectBusinessLineScores)
    .where(eq(projectBusinessLineScores.projectId, projectId));

  // Detect site activities
  const activities = detectActivities(
    project.name,
    project.overview,
    project.equipmentSignals,
    project.sector
  );

  // Classify contact relevance and filter to Australian-relevant contacts
  const rankedContacts = projectContacts
    .filter(c => isAustralianRelevant({
      title: c.title,
      linkedinHeadline: c.linkedinHeadline,
      linkedinLocation: c.linkedinLocation,
    }))
    .map(c => ({
      ...c,
      relevance: classifyRoleRelevance(c.title, c.roleBucket),
    }));
  const highContacts = rankedContacts.filter(c => c.relevance === "high");
  const bestContact = highContacts[0] || rankedContacts[0] || null;

  // Top business lines
  const topBLs = blScores
    .filter(s => s.score >= 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(s => s.scoringDimension);

  // Segment pain points
  const segmentPains = SEGMENT_PAIN_POINTS[project.sector] || SEGMENT_PAIN_POINTS.infrastructure;

  // Build LLM prompt
  const prompt = buildNBAPrompt(project, bestContact, topBLs, activities, segmentPains, userBLs);

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: NBA_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "next_best_action",
          strict: true,
          schema: {
            type: "object",
            properties: {
              whyItMattersNow: { type: "string", description: "2-3 sentences on why this project needs attention right now" },
              likelyPainPoints: {
                type: "array",
                items: { type: "string" },
                description: "3-5 likely customer pain points relevant to this project",
              },
              recommendedAction: { type: "string", description: "Specific recommended first action for the sales rep" },
              callAngle: { type: "string", description: "Simple 1-2 sentence call angle the rep can use" },
              urgencyLevel: {
                type: "string",
                enum: ["urgent", "high", "moderate", "low"],
                description: "How urgently the rep should act",
              },
              whyThisContact: { type: "string", description: "Why the suggested stakeholder is the best first contact" },
            },
            required: ["whyItMattersNow", "likelyPainPoints", "recommendedAction", "callAngle", "urgencyLevel", "whyThisContact"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("LLM returned empty response");
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

    const parsed = JSON.parse(content);

    const nba: NBAOutput = {
      projectId,
      projectName: project.name,
      whyItMattersNow: parsed.whyItMattersNow,
      bestStakeholder: bestContact
        ? {
            name: bestContact.name,
            title: bestContact.title,
            company: bestContact.company,
            whyThisContact: parsed.whyThisContact,
          }
        : null,
      likelyPainPoints: parsed.likelyPainPoints,
      recommendedAction: parsed.recommendedAction,
      callAngle: parsed.callAngle,
      relevantBusinessLines: topBLs,
      urgencyLevel: parsed.urgencyLevel,
      generatedAt: Date.now(),
    };

    setCache(projectId, project.stage, nba);
    return nba;
  } catch (err) {
    // Fallback: generate deterministic NBA without LLM
    return generateFallbackNBA(project, bestContact, topBLs, segmentPains, activities);
  }
}

/** Generate NBA for multiple projects in batch (for This Week page) */
export async function generateNBABatch(projectIds: number[], userBLs?: string[]): Promise<NBAOutput[]> {
  const results: NBAOutput[] = [];
  // Process in parallel batches of 5 to avoid overwhelming the LLM
  const batchSize = 5;
  for (let i = 0; i < projectIds.length; i += batchSize) {
    const batch = projectIds.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(id => generateNBA(id, userBLs))
    );
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      }
    }
  }
  return results;
}

// ── Fallback (no LLM) ──

function generateFallbackNBA(
  project: any,
  bestContact: any,
  topBLs: string[],
  segmentPains: string[],
  activities: { activity: string }[]
): NBAOutput {
  const activityNames = activities.map(a => a.activity);
  const isExecution = /execut|construct|mobilis|commenc|award/i.test(project.stage || "");
  const isEarly = /plan|explor|feasib|study|tender/i.test(project.stage || "");

  let whyItMattersNow = `${project.name} in ${project.location} is a ${project.sector} project`;
  if (isExecution) {
    whyItMattersNow += " currently in execution phase — equipment decisions are being made now.";
  } else if (isEarly) {
    whyItMattersNow += " in early stages — building relationships now positions Atlas Copco ahead of competitors.";
  } else {
    whyItMattersNow += ` at stage: ${project.stage || "unknown"}.`;
  }

  if (activityNames.length > 0) {
    whyItMattersNow += ` Site activities include ${activityNames.slice(0, 3).join(", ")}.`;
  }

  const urgencyLevel = project.actionTier === "tier1_actionable" ? "urgent" :
    project.priority === "hot" ? "high" :
    project.priority === "warm" ? "moderate" : "low";

  const recommendedAction = bestContact
    ? `Reach out to ${bestContact.name} (${bestContact.title} at ${bestContact.company}) to discuss ${topBLs[0] || "equipment"} needs.`
    : "Run stakeholder discovery to identify key decision-makers before competitors establish relationships.";

  const callAngle = topBLs.length > 0
    ? `Discuss how Atlas Copco's ${topBLs.slice(0, 2).join(" and ")} solutions can support their ${project.stage || "project"} requirements.`
    : `Introduce Atlas Copco's portable equipment range and explore their site requirements.`;

  return {
    projectId: project.id,
    projectName: project.name,
    whyItMattersNow,
    bestStakeholder: bestContact
      ? {
          name: bestContact.name,
          title: bestContact.title,
          company: bestContact.company,
          whyThisContact: `${bestContact.title} at ${bestContact.company} is the most relevant contact based on role and project involvement.`,
        }
      : null,
    likelyPainPoints: segmentPains.slice(0, 4),
    recommendedAction,
    callAngle,
    relevantBusinessLines: topBLs,
    urgencyLevel,
    generatedAt: Date.now(),
  };
}

// ── Prompts ──

const NBA_SYSTEM_PROMPT = `You are an expert sales intelligence assistant for Atlas Copco Power Technique Australia.
Your job is to help sales representatives decide what to do next for each priority project.

Atlas Copco Power Technique sells:
- Portable air compressors (XATS, DrillAir series)
- Portable Air Lubricant (PAL) systems
- Battery Energy Storage Systems (BESS / ZenergiZe)
- Generators and temporary power
- Dewatering and process pumps
- Nitrogen generators
- Booster compressors
- Service, parts, and rental solutions

You must be practical, specific, and actionable. Avoid generic advice.
Focus on what the rep should DO, not what the product CAN do.
Write as a sharp sales coordinator, not a marketing brochure.`;

function buildNBAPrompt(
  project: any,
  bestContact: any,
  topBLs: string[],
  activities: { activity: string }[],
  segmentPains: string[],
  userBLs?: string[]
): string {
  const activityNames = activities.map(a => a.activity);
  const contactInfo = bestContact
    ? `Best available contact: ${bestContact.name}, ${bestContact.title} at ${bestContact.company} (role: ${bestContact.roleBucket})`
    : "No contacts found yet — stakeholder discovery needed.";

  return `Generate a Next Best Action for this project:

PROJECT: ${project.name}
LOCATION: ${project.location}
VALUE: ${project.value}
OWNER: ${project.owner}
SECTOR: ${project.sector}
STAGE: ${project.stage || "Unknown"}
OVERVIEW: ${project.overview || "No overview available"}
ACTION TIER: ${project.actionTier || "unclassified"}
PRIORITY: ${project.priority}

EQUIPMENT SIGNALS: ${(project.equipmentSignals || []).join(", ") || "None detected"}
SITE ACTIVITIES: ${activityNames.join(", ") || "None detected"}
CONTRACTORS: ${(project.contractors || []).map((c: any) => c.name).join(", ") || "None identified"}

TOP BUSINESS LINES: ${topBLs.join(", ") || "None scored yet"}
SEGMENT PAIN POINTS: ${segmentPains.join("; ")}

${contactInfo}

${userBLs && userBLs.length > 0 ? `\nREP'S ASSIGNED BUSINESS LINES: ${userBLs.join(", ")}\nIMPORTANT: Tailor recommendations to the rep's assigned BLs. Highlight how their specific products (${userBLs.join(", ")}) apply to this project. If the project is more relevant to other BLs, mention that but focus the call angle on the rep's products.\n` : ""}
Generate:
1. whyItMattersNow — 2-3 sentences on why this project needs attention RIGHT NOW (be specific about timing, stage, or signals)
2. likelyPainPoints — 3-5 pain points most relevant to THIS specific project (not generic)
3. recommendedAction — The specific first thing the rep should do (be concrete)
4. callAngle — A simple 1-2 sentence opening angle the rep can use on a call
5. urgencyLevel — How urgently should the rep act (urgent/high/moderate/low)
6. whyThisContact — Why the suggested stakeholder is the best first contact for this project`;
}
