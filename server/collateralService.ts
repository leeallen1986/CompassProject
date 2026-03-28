/**
 * Collateral Library Service
 * 
 * Handles CRUD for product collateral (flyers, case studies, solution briefs),
 * S3 file storage, and automatic matching against projects for outreach.
 */
import { getDb } from "./db";
import {
  collateralItems, collateralProjectMatches,
  projects,
  type CollateralItem, type InsertCollateralItem,
} from "../drizzle/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { storagePut } from "./storage";

// ── Application tag presets ──
export const APPLICATION_TAGS = [
  { value: "rc_drilling", label: "RC Drilling" },
  { value: "waterwell_drilling", label: "Waterwell Drilling" },
  { value: "diamond_drilling", label: "Diamond Drilling" },
  { value: "exploration_drilling", label: "Exploration Drilling" },
  { value: "blast_hole_drilling", label: "Blast Hole Drilling" },
  { value: "tunnelling", label: "Tunnelling" },
  { value: "shotcrete", label: "Shotcrete" },
  { value: "sandblasting", label: "Sandblasting / Abrasive Blasting" },
  { value: "pipeline_testing", label: "Pipeline Testing" },
  { value: "pneumatic_tools", label: "Pneumatic Tools" },
  { value: "dewatering", label: "Dewatering" },
  { value: "earthworks", label: "Earthworks" },
  { value: "construction_general", label: "General Construction" },
  { value: "solar_farm", label: "Solar Farm" },
  { value: "wind_farm", label: "Wind Farm" },
  { value: "oil_gas_production", label: "Oil & Gas Production" },
  { value: "mining_production", label: "Mining Production" },
  { value: "nitrogen_generation", label: "Nitrogen Generation" },
  { value: "power_generation", label: "Power Generation" },
  { value: "lighting", label: "Lighting" },
] as const;

export const SECTOR_TAGS = [
  { value: "mining", label: "Mining" },
  { value: "oil_gas", label: "Oil & Gas" },
  { value: "infrastructure", label: "Infrastructure" },
  { value: "energy", label: "Energy" },
  { value: "defence", label: "Defence" },
  { value: "water", label: "Water" },
  { value: "construction", label: "Construction" },
] as const;

export const PRODUCT_LINES = [
  { value: "portable_air", label: "Portable Air" },
  { value: "dewatering", label: "Dewatering" },
  { value: "generators", label: "Generators" },
  { value: "bess", label: "BESS (Battery Energy Storage)" },
  { value: "nitrogen", label: "Nitrogen" },
  { value: "lighting", label: "Lighting" },
  { value: "other", label: "Other" },
] as const;

// ── CRUD Operations ──

export async function createCollateralItem(data: {
  name: string;
  description?: string;
  productLine: string;
  fileBuffer: Buffer;
  fileName: string;
  fileMimeType: string;
  fileSizeBytes: number;
  applicationTags: string[];
  sectorTags: string[];
  keywordTags: string[];
  uploadedBy: number;
  uploadedByName: string;
}): Promise<CollateralItem> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Generate a unique file key with random suffix to prevent enumeration
  const randomSuffix = Math.random().toString(36).substring(2, 10);
  const sanitizedName = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileKey = `collateral/${data.uploadedBy}/${randomSuffix}-${sanitizedName}`;

  // Upload to S3
  const { url: fileUrl } = await storagePut(fileKey, data.fileBuffer, data.fileMimeType);

  // Insert into database
  const [result] = await db.insert(collateralItems).values({
    name: data.name,
    description: data.description || null,
    productLine: data.productLine as any,
    fileKey,
    fileUrl,
    fileName: data.fileName,
    fileMimeType: data.fileMimeType,
    fileSizeBytes: data.fileSizeBytes,
    applicationTags: data.applicationTags,
    sectorTags: data.sectorTags,
    keywordTags: data.keywordTags,
    uploadedBy: data.uploadedBy,
    uploadedByName: data.uploadedByName,
  });

  const [item] = await db.select().from(collateralItems).where(eq(collateralItems.id, result.insertId));
  return item;
}

export async function listCollateralItems(filters?: {
  productLine?: string;
  activeOnly?: boolean;
}): Promise<CollateralItem[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [];

  if (filters?.productLine && filters.productLine !== "all") {
    conditions.push(eq(collateralItems.productLine, filters.productLine as any));
  }
  if (filters?.activeOnly !== false) {
    conditions.push(eq(collateralItems.isActive, true));
  }

  const query = conditions.length > 0
    ? db.select().from(collateralItems).where(and(...conditions)).orderBy(desc(collateralItems.createdAt))
    : db.select().from(collateralItems).orderBy(desc(collateralItems.createdAt));

  return query;
}

export async function getCollateralItemById(id: number): Promise<CollateralItem | null> {
  const db = await getDb();
  if (!db) return null;
  const [item] = await db.select().from(collateralItems).where(eq(collateralItems.id, id));
  return item || null;
}

export async function updateCollateralItem(id: number, data: {
  name?: string;
  description?: string;
  productLine?: string;
  applicationTags?: string[];
  sectorTags?: string[];
  keywordTags?: string[];
  isActive?: boolean;
}): Promise<CollateralItem | null> {
  const db = await getDb();
  if (!db) return null;
  const updateData: Record<string, any> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.productLine !== undefined) updateData.productLine = data.productLine;
  if (data.applicationTags !== undefined) updateData.applicationTags = data.applicationTags;
  if (data.sectorTags !== undefined) updateData.sectorTags = data.sectorTags;
  if (data.keywordTags !== undefined) updateData.keywordTags = data.keywordTags;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  await db.update(collateralItems).set(updateData).where(eq(collateralItems.id, id));
  return getCollateralItemById(id);
}

export async function deleteCollateralItem(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Soft delete — mark as inactive
  await db.update(collateralItems).set({ isActive: false }).where(eq(collateralItems.id, id));
}

// ── Matching Engine ──

/**
 * Match collateral items against a project based on sector, description keywords,
 * and application tags. Returns scored matches sorted by relevance.
 */
export async function matchCollateralToProject(projectId: number): Promise<{
  collateralId: number;
  name: string;
  fileUrl: string;
  productLine: string;
  matchScore: number;
  matchReason: string;
}[]> {
  const db = await getDb();
  if (!db) return [];

  // Get the project
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return [];

  // Get all active collateral
  const allCollateral = await db.select().from(collateralItems)
    .where(eq(collateralItems.isActive, true));

  if (allCollateral.length === 0) return [];

  // Build project context for matching
  const projectText = [
    project.name,
    project.overview,
    project.sector,
    project.location,
    project.stage,
    project.contractors ? JSON.stringify(project.contractors) : "",
  ].filter(Boolean).join(" ").toLowerCase();

  const projectSector = (project.sector || "").toLowerCase();

  // Score each collateral item
  const scored = allCollateral.map(item => {
    let score = 0;
    const reasons: string[] = [];

    // 1. Sector match (0-30 points)
    const sectorTags = (item.sectorTags || []).map(s => s.toLowerCase());
    if (sectorTags.includes(projectSector)) {
      score += 30;
      reasons.push(`Sector match: ${projectSector}`);
    } else if (sectorTags.length === 0) {
      // No sector restriction — give partial credit
      score += 10;
    }

    // 2. Application tag match against project description (0-40 points)
    const appTags = (item.applicationTags || []).map(t => t.toLowerCase().replace(/_/g, " "));
    let appMatchCount = 0;
    for (const tag of appTags) {
      // Check if the tag or its words appear in the project text
      const tagWords = tag.split(" ");
      const anyWordMatch = tagWords.some(w => w.length > 3 && projectText.includes(w));
      if (projectText.includes(tag) || anyWordMatch) {
        appMatchCount++;
      }
    }
    if (appMatchCount > 0) {
      const appScore = Math.min(40, appMatchCount * 20);
      score += appScore;
      reasons.push(`${appMatchCount} application tag(s) matched`);
    }

    // 3. Keyword match against project description (0-20 points)
    const keywords = (item.keywordTags || []).map(k => k.toLowerCase());
    let kwMatchCount = 0;
    for (const kw of keywords) {
      if (projectText.includes(kw)) {
        kwMatchCount++;
      }
    }
    if (kwMatchCount > 0) {
      const kwScore = Math.min(20, kwMatchCount * 10);
      score += kwScore;
      reasons.push(`${kwMatchCount} keyword(s) matched`);
    }

    // 4. Product line relevance bonus (0-10 points)
    // Portable air is relevant to drilling, mining, construction
    const drillingKeywords = ["drill", "drilling", "bore", "borehole", "compressor", "pneumatic", "blast"];
    if (item.productLine === "portable_air" && drillingKeywords.some(k => projectText.includes(k))) {
      score += 10;
      reasons.push("Portable air relevant to drilling/compressor context");
    }

    return {
      collateralId: item.id,
      name: item.name,
      fileUrl: item.fileUrl,
      productLine: item.productLine,
      matchScore: Math.min(100, score),
      matchReason: reasons.join("; ") || "No strong match signals",
    };
  });

  // Filter to items with score > 20 and sort by score descending
  return scored
    .filter(s => s.matchScore > 20)
    .sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Run matching for a batch of projects and save results.
 */
export async function runCollateralMatching(projectIds: number[]): Promise<{
  projectsProcessed: number;
  matchesCreated: number;
}> {
  const db = await getDb();
  if (!db) return { projectsProcessed: 0, matchesCreated: 0 };
  let matchesCreated = 0;

  for (const projectId of projectIds) {
    const matches = await matchCollateralToProject(projectId);

    for (const match of matches) {
      // Check if match already exists
      const [existing] = await db.select().from(collateralProjectMatches)
        .where(and(
          eq(collateralProjectMatches.collateralId, match.collateralId),
          eq(collateralProjectMatches.projectId, projectId),
        ));

      if (!existing) {
        await db.insert(collateralProjectMatches).values({
          collateralId: match.collateralId,
          projectId,
          matchScore: match.matchScore,
          matchReason: match.matchReason,
        });
        matchesCreated++;
      }

      // Increment match count on the collateral item
      await db.update(collateralItems)
        .set({ matchCount: sql`${collateralItems.matchCount} + 1` })
        .where(eq(collateralItems.id, match.collateralId));
    }
  }

  return { projectsProcessed: projectIds.length, matchesCreated };
}

/**
 * Get the best collateral matches for a project (for outreach email attachment suggestions).
 */
export async function getProjectCollateralSuggestions(projectId: number, limit = 3): Promise<{
  id: number;
  name: string;
  fileUrl: string;
  productLine: string;
  matchScore: number;
  matchReason: string;
}[]> {
  // First check cached matches
  const db = await getDb();
  if (!db) return [];
  const cached = await db.select({
    id: collateralItems.id,
    name: collateralItems.name,
    fileUrl: collateralItems.fileUrl,
    productLine: collateralItems.productLine,
    matchScore: collateralProjectMatches.matchScore,
    matchReason: collateralProjectMatches.matchReason,
  })
    .from(collateralProjectMatches)
    .innerJoin(collateralItems, eq(collateralProjectMatches.collateralId, collateralItems.id))
    .where(and(
      eq(collateralProjectMatches.projectId, projectId),
      eq(collateralItems.isActive, true),
    ))
    .orderBy(desc(collateralProjectMatches.matchScore))
    .limit(limit);

  if (cached.length > 0) return cached.map(c => ({ ...c, matchReason: c.matchReason || "" }));

  // No cached matches — run live matching
  const matches = await matchCollateralToProject(projectId);
  return matches.slice(0, limit).map(m => ({
    id: m.collateralId,
    name: m.name,
    fileUrl: m.fileUrl,
    productLine: m.productLine,
    matchScore: m.matchScore,
    matchReason: m.matchReason || "",
  }));
}

/**
 * Get collateral library stats.
 */
export async function getCollateralStats(): Promise<{
  totalItems: number;
  activeItems: number;
  totalMatches: number;
  byProductLine: Record<string, number>;
}> {
  const db = await getDb();
  if (!db) return { totalItems: 0, activeItems: 0, totalMatches: 0, byProductLine: {} };

  const [totalResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(collateralItems);
  const [activeResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(collateralItems).where(eq(collateralItems.isActive, true));
  const [matchResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(collateralProjectMatches);

  const plCounts = await db.select({
    productLine: collateralItems.productLine,
    count: sql<number>`COUNT(*)`,
  })
    .from(collateralItems)
    .where(eq(collateralItems.isActive, true))
    .groupBy(collateralItems.productLine);

  const byProductLine: Record<string, number> = {};
  for (const row of plCounts) {
    byProductLine[row.productLine] = Number(row.count);
  }

  return {
    totalItems: Number(totalResult.count),
    activeItems: Number(activeResult.count),
    totalMatches: Number(matchResult.count),
    byProductLine,
  };
}
