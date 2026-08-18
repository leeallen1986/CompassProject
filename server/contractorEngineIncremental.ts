import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import {
  awardedProjects,
  contractorPairings,
  contractorProjectLinks,
  contractorRegistry,
  projectBusinessLineScores,
  projects,
  type ContractorRegistryRow,
  type Project,
} from "../drizzle/schema";
import { getDb, getSystemKv, setSystemKv } from "./db";
import {
  classifyRole,
  detectEmergingPatterns,
  extractState,
  isPlaceholder,
  normalizeCompanyName,
  normalizeStage,
  type PairingDetectionResult,
  type PatternDetectionResult,
  type RegistryBuildResult,
  type ScoringResult,
} from "./contractorEngine";
import {
  CONTRACTOR_ENGINE_CURSOR_KEY,
  CONTRACTOR_ENGINE_PROGRESS_KEY,
  DEFAULT_AWARD_BATCH_SIZE,
  DEFAULT_PROJECT_BATCH_SIZE,
  DEFAULT_SCORING_BATCH_SIZE,
  EMPTY_PROGRESS_COUNTS,
  MAX_AWARD_BATCH_SIZE,
  MAX_PERSISTED_PAIRINGS,
  MAX_PROJECT_BATCH_SIZE,
  MAX_SCORING_BATCH_SIZE,
  PROJECT_CHUNK_SIZE,
  SCORING_CHUNK_SIZE,
  boundedBatchSize,
  dedupeLinkKeys,
  nextCursorAfterChunk,
  parseContractorEngineCursor,
  serializeContractorEngineCursor,
  shouldStartPhase,
  type ContractorEngineCursorState,
  type ContractorEngineProgressCounts,
  type ContractorEngineProgressSnapshot,
} from "./contractorEngineIncrementalPolicy";

type ContractorRole =
  | "owner"
  | "epc"
  | "contractor"
  | "subcontractor"
  | "consultant"
  | "supplier"
  | "rental"
  | "government"
  | "unknown";

type PairingType =
  | "owner_epc"
  | "owner_contractor"
  | "contractor_consultant"
  | "contractor_subcontractor"
  | "contractor_region"
  | "epc_subcontractor"
  | "other";

interface DesiredProjectLink {
  canonicalName: string;
  alias: string;
  projectId: number;
  role: ContractorRole;
  status: "confirmed" | "predicted";
  detail: string | null;
  confidence: number;
}

interface ProjectBatchResult {
  rows: Project[];
  wrapped: boolean;
}

interface AwardBatchResult {
  rows: Array<typeof awardedProjects.$inferSelect>;
  wrapped: boolean;
}

interface ScoringBatchResult {
  rows: ContractorRegistryRow[];
  wrapped: boolean;
}

export interface IncrementalContractorEngineResult {
  registry: RegistryBuildResult;
  pairings: PairingDetectionResult;
  scoring: ScoringResult;
  patterns: PatternDetectionResult;
  durationMs: number;
  progress: ContractorEngineProgressSnapshot;
}

export interface IncrementalContractorEngineOptions {
  onProgress?: (snapshot: ContractorEngineProgressSnapshot) => void | Promise<void>;
}

function asRole(value: string): ContractorRole {
  const valid: ContractorRole[] = [
    "owner",
    "epc",
    "contractor",
    "subcontractor",
    "consultant",
    "supplier",
    "rental",
    "government",
    "unknown",
  ];
  return valid.includes(value as ContractorRole) ? (value as ContractorRole) : "unknown";
}

function pairingTypeFor(roleA: string, roleB: string): PairingType {
  const roles = new Set([roleA, roleB]);
  if (roles.has("owner") && roles.has("epc")) return "owner_epc";
  if (roles.has("owner") && roles.has("contractor")) return "owner_contractor";
  if (roles.has("contractor") && roles.has("consultant")) return "contractor_consultant";
  if (roles.has("contractor") && roles.has("subcontractor")) return "contractor_subcontractor";
  if (roles.has("epc") && roles.has("subcontractor")) return "epc_subcontractor";
  return "other";
}

function boundedConfidence(status: string, confidence?: number): number {
  if (status === "confirmed") return 90;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return 50;
  const normalized = confidence <= 1 ? confidence * 100 : confidence;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function mergeAliases(existing: string[] | null, additions: string[]): string[] {
  return Array.from(new Set([...(existing || []), ...additions].map(value => value.trim()).filter(Boolean)));
}

function chunksOf<T>(rows: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    output.push(rows.slice(index, index + size));
  }
  return output;
}

function desiredLinksForProject(project: Project): DesiredProjectLink[] {
  const desired: DesiredProjectLink[] = [];
  const ownerAlias = project.owner?.trim() || "";
  const ownerCanonical = ownerAlias ? normalizeCompanyName(ownerAlias) : "";
  if (ownerCanonical && !isPlaceholder(ownerCanonical)) {
    desired.push({
      canonicalName: ownerCanonical,
      alias: ownerAlias,
      projectId: project.id,
      role: "owner",
      status: "confirmed",
      detail: null,
      confidence: 100,
    });
  }

  const contractors = project.contractors as Array<{
    name?: string;
    status?: string;
    confidence?: number;
    detail?: string;
  }> | null;

  if (Array.isArray(contractors)) {
    for (const item of contractors) {
      const alias = item.name?.trim() || "";
      if (!alias || isPlaceholder(alias)) continue;
      const canonicalName = normalizeCompanyName(alias);
      if (!canonicalName || isPlaceholder(canonicalName)) continue;
      const sourceStatus = item.status || "predicted";
      desired.push({
        canonicalName,
        alias,
        projectId: project.id,
        role: asRole(classifyRole(alias, item.detail, sourceStatus, project.owner)),
        status: sourceStatus === "confirmed" ? "confirmed" : "predicted",
        detail: item.detail || null,
        confidence: boundedConfidence(sourceStatus, item.confidence),
      });
    }
  }

  const seen = new Set<string>();
  return desired.filter(item => {
    const key = `${item.canonicalName.toLowerCase()}:${item.projectId}:${item.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadNextProjectBatch(cursor: number, limit: number): Promise<ProjectBatchResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const after = await db.select().from(projects)
    .where(gt(projects.id, cursor))
    .orderBy(asc(projects.id))
    .limit(limit);
  if (after.length > 0 || cursor === 0) return { rows: after, wrapped: false };
  const wrapped = await db.select().from(projects)
    .orderBy(asc(projects.id))
    .limit(limit);
  return { rows: wrapped, wrapped: wrapped.length > 0 };
}

async function loadNextAwardBatch(cursor: number, limit: number): Promise<AwardBatchResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const after = await db.select().from(awardedProjects)
    .where(gt(awardedProjects.id, cursor))
    .orderBy(asc(awardedProjects.id))
    .limit(limit);
  if (after.length > 0 || cursor === 0) return { rows: after, wrapped: false };
  const wrapped = await db.select().from(awardedProjects)
    .orderBy(asc(awardedProjects.id))
    .limit(limit);
  return { rows: wrapped, wrapped: wrapped.length > 0 };
}

async function loadNextScoringBatch(cursor: number, limit: number): Promise<ScoringBatchResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const after = await db.select().from(contractorRegistry)
    .where(gt(contractorRegistry.id, cursor))
    .orderBy(asc(contractorRegistry.id))
    .limit(limit);
  if (after.length > 0 || cursor === 0) return { rows: after, wrapped: false };
  const wrapped = await db.select().from(contractorRegistry)
    .orderBy(asc(contractorRegistry.id))
    .limit(limit);
  return { rows: wrapped, wrapped: wrapped.length > 0 };
}

async function ensureRegistryRows(desired: DesiredProjectLink[]): Promise<{
  byCanonical: Map<string, ContractorRegistryRow>;
  newCompanies: number;
  updatedCompanies: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const aliasMap = new Map<string, Set<string>>();
  for (const item of desired) {
    const key = item.canonicalName.toLowerCase();
    if (!aliasMap.has(key)) aliasMap.set(key, new Set());
    aliasMap.get(key)!.add(item.alias);
  }
  const canonicalNames = Array.from(new Set(desired.map(item => item.canonicalName)));
  if (canonicalNames.length === 0) return { byCanonical: new Map(), newCompanies: 0, updatedCompanies: 0 };

  const existing = await db.select().from(contractorRegistry)
    .where(inArray(contractorRegistry.canonicalName, canonicalNames));
  const existingMap = new Map(existing.map(row => [row.canonicalName.toLowerCase(), row]));
  let newCompanies = 0;
  let updatedCompanies = 0;

  for (const canonicalName of canonicalNames) {
    const key = canonicalName.toLowerCase();
    const aliases = Array.from(aliasMap.get(key) || []);
    const row = existingMap.get(key);
    if (!row) {
      await db.insert(contractorRegistry).values({
        canonicalName,
        aliases,
        primaryRole: "unknown",
        additionalRoles: [],
        projectCount: 0,
        confirmedCount: 0,
        predictedCount: 0,
        sectorBreakdown: {},
        stateBreakdown: {},
        stageBreakdown: {},
        recentProjectIds: [],
      });
      newCompanies++;
      continue;
    }
    const merged = mergeAliases(row.aliases, aliases);
    if (JSON.stringify(merged) !== JSON.stringify(row.aliases || [])) {
      await db.update(contractorRegistry)
        .set({ aliases: merged })
        .where(eq(contractorRegistry.id, row.id));
      updatedCompanies++;
    }
  }

  const refreshed = await db.select().from(contractorRegistry)
    .where(inArray(contractorRegistry.canonicalName, canonicalNames));
  return {
    byCanonical: new Map(refreshed.map(row => [row.canonicalName.toLowerCase(), row])),
    newCompanies,
    updatedCompanies,
  };
}

async function recomputeRegistryAggregates(contractorIds: number[]): Promise<void> {
  if (contractorIds.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const ids = Array.from(new Set(contractorIds));
  const [links, registryRows] = await Promise.all([
    db.select().from(contractorProjectLinks).where(inArray(contractorProjectLinks.contractorId, ids)),
    db.select().from(contractorRegistry).where(inArray(contractorRegistry.id, ids)),
  ]);
  const projectIds = Array.from(new Set(links.map(link => link.projectId)));
  const projectRows = projectIds.length > 0
    ? await db.select({
        id: projects.id,
        sector: projects.sector,
        location: projects.location,
        stage: projects.stage,
        createdAt: projects.createdAt,
      }).from(projects).where(inArray(projects.id, projectIds))
    : [];
  const projectMap = new Map(projectRows.map(row => [row.id, row]));
  const rowMap = new Map(registryRows.map(row => [row.id, row]));
  const linksByContractor = new Map<number, typeof links>();
  for (const link of links) {
    if (!linksByContractor.has(link.contractorId)) linksByContractor.set(link.contractorId, []);
    linksByContractor.get(link.contractorId)!.push(link);
  }

  for (const contractorId of ids) {
    const contractor = rowMap.get(contractorId);
    if (!contractor) continue;
    const contractorLinks = linksByContractor.get(contractorId) || [];
    const roleCounts = new Map<string, number>();
    const sectorBreakdown: Record<string, number> = {};
    const stateBreakdown: Record<string, number> = {};
    const stageBreakdown: Record<string, number> = {};
    const uniqueProjectIds = new Set<number>();
    let confirmedCount = 0;
    let predictedCount = 0;
    let firstSeenAt: Date | null = null;
    let lastSeenAt: Date | null = null;
    const datedProjects: Array<{ id: number; at: number }> = [];

    for (const link of contractorLinks) {
      roleCounts.set(link.role, (roleCounts.get(link.role) || 0) + 1);
      if (link.status === "confirmed") confirmedCount++;
      else predictedCount++;
      uniqueProjectIds.add(link.projectId);
      const project = projectMap.get(link.projectId);
      if (!project) continue;
      sectorBreakdown[project.sector] = (sectorBreakdown[project.sector] || 0) + 1;
      const state = extractState(project.location || "");
      stateBreakdown[state] = (stateBreakdown[state] || 0) + 1;
      const stage = normalizeStage(project.stage);
      stageBreakdown[stage] = (stageBreakdown[stage] || 0) + 1;
      const at = project.createdAt?.getTime() || 0;
      if (at > 0) {
        const date = new Date(at);
        if (!firstSeenAt || date < firstSeenAt) firstSeenAt = date;
        if (!lastSeenAt || date > lastSeenAt) lastSeenAt = date;
        datedProjects.push({ id: project.id, at });
      }
    }

    let primaryRole: ContractorRole = "unknown";
    let primaryCount = 0;
    for (const [role, count] of roleCounts) {
      if (count > primaryCount) {
        primaryRole = asRole(role);
        primaryCount = count;
      }
    }
    const additionalRoles = Array.from(roleCounts.keys())
      .map(asRole)
      .filter(role => role !== primaryRole);
    const recentProjectIds = datedProjects
      .sort((a, b) => a.at - b.at)
      .slice(-50)
      .map(row => row.id);

    await db.update(contractorRegistry)
      .set({
        primaryRole,
        additionalRoles,
        projectCount: uniqueProjectIds.size,
        confirmedCount,
        predictedCount,
        sectorBreakdown,
        stateBreakdown,
        stageBreakdown,
        recentProjectIds,
        firstSeenAt,
        lastSeenAt,
      })
      .where(eq(contractorRegistry.id, contractorId));
  }
}

async function syncProjectChunk(projectRows: Project[]): Promise<{
  contractorsTouched: number[];
  linksWritten: number;
  newCompanies: number;
  updatedCompanies: number;
}> {
  if (projectRows.length === 0) {
    return { contractorsTouched: [], linksWritten: 0, newCompanies: 0, updatedCompanies: 0 };
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const projectIds = projectRows.map(project => project.id);
  const existingSeedLinks = await db.select().from(contractorProjectLinks)
    .where(and(
      inArray(contractorProjectLinks.projectId, projectIds),
      eq(contractorProjectLinks.source, "seed_data"),
    ));
  const affected = new Set(existingSeedLinks.map(link => link.contractorId));
  const desired = projectRows.flatMap(desiredLinksForProject);
  const ensured = await ensureRegistryRows(desired);

  await db.delete(contractorProjectLinks)
    .where(and(
      inArray(contractorProjectLinks.projectId, projectIds),
      eq(contractorProjectLinks.source, "seed_data"),
    ));

  const insertRows = dedupeLinkKeys(desired.flatMap(item => {
    const contractor = ensured.byCanonical.get(item.canonicalName.toLowerCase());
    if (!contractor) return [];
    affected.add(contractor.id);
    return [{
      contractorId: contractor.id,
      projectId: item.projectId,
      role: item.role,
      status: item.status,
      detail: item.detail,
      confidence: item.confidence,
      source: "seed_data",
    }];
  }));
  if (insertRows.length > 0) {
    await db.insert(contractorProjectLinks).values(insertRows);
  }

  const affectedIds = Array.from(affected);
  await recomputeRegistryAggregates(affectedIds);
  return {
    contractorsTouched: affectedIds,
    linksWritten: insertRows.length,
    newCompanies: ensured.newCompanies,
    updatedCompanies: ensured.updatedCompanies,
  };
}

async function syncAwardBatch(rows: AwardBatchResult["rows"]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  let processed = 0;
  for (const award of rows) {
    const alias = award.winningContractor?.trim() || "";
    if (!alias || isPlaceholder(alias)) continue;
    const canonicalName = normalizeCompanyName(alias);
    if (!canonicalName || isPlaceholder(canonicalName)) continue;
    const [existing] = await db.select().from(contractorRegistry)
      .where(eq(contractorRegistry.canonicalName, canonicalName))
      .limit(1);
    if (!existing) {
      await db.insert(contractorRegistry).values({
        canonicalName,
        aliases: [alias],
        primaryRole: "contractor",
        additionalRoles: [],
        projectCount: 0,
        confirmedCount: 0,
        predictedCount: 0,
        sectorBreakdown: {},
        stateBreakdown: {},
        stageBreakdown: {},
        recentProjectIds: [],
      });
    } else {
      const aliases = mergeAliases(existing.aliases, [alias]);
      const additionalRoles = new Set(existing.additionalRoles || []);
      if (existing.primaryRole !== "contractor") additionalRoles.add("contractor");
      await db.update(contractorRegistry)
        .set({ aliases, additionalRoles: Array.from(additionalRoles) })
        .where(eq(contractorRegistry.id, existing.id));
    }
    processed++;
  }
  return processed;
}

async function rebuildPairingsOptimized(): Promise<PairingDetectionResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [allLinks, allContractors, projectRows, existingPairings] = await Promise.all([
    db.select().from(contractorProjectLinks),
    db.select().from(contractorRegistry),
    db.select({ id: projects.id, sector: projects.sector, location: projects.location }).from(projects),
    db.select().from(contractorPairings),
  ]);
  const contractorMap = new Map(allContractors.map(row => [row.id, row]));
  const projectMap = new Map(projectRows.map(row => [row.id, row]));
  const projectGroups = new Map<number, typeof allLinks>();
  for (const link of allLinks) {
    if (!projectGroups.has(link.projectId)) projectGroups.set(link.projectId, []);
    projectGroups.get(link.projectId)!.push(link);
  }

  const pairMap = new Map<string, {
    companyAId: number;
    companyAName: string;
    companyARoleInPairing: string;
    companyBId: number;
    companyBName: string;
    companyBRoleInPairing: string;
    pairingType: PairingType;
    projectIds: Set<number>;
    sectors: Set<string>;
    states: Set<string>;
  }>();

  for (const [projectId, links] of projectGroups) {
    if (links.length < 2) continue;
    const project = projectMap.get(projectId);
    const sector = project?.sector || "unknown";
    const state = extractState(project?.location || "");
    for (let i = 0; i < links.length; i++) {
      for (let j = i + 1; j < links.length; j++) {
        const a = links[i];
        const b = links[j];
        if (a.contractorId === b.contractorId) continue;
        const [first, second] = a.contractorId < b.contractorId ? [a, b] : [b, a];
        const firstCompany = contractorMap.get(first.contractorId);
        const secondCompany = contractorMap.get(second.contractorId);
        if (!firstCompany || !secondCompany) continue;
        const key = `${first.contractorId}-${second.contractorId}`;
        if (!pairMap.has(key)) {
          pairMap.set(key, {
            companyAId: first.contractorId,
            companyAName: firstCompany.canonicalName,
            companyARoleInPairing: first.role,
            companyBId: second.contractorId,
            companyBName: secondCompany.canonicalName,
            companyBRoleInPairing: second.role,
            pairingType: pairingTypeFor(first.role, second.role),
            projectIds: new Set(),
            sectors: new Set(),
            states: new Set(),
          });
        }
        const pair = pairMap.get(key)!;
        pair.projectIds.add(projectId);
        pair.sectors.add(sector);
        if (state !== "Other") pair.states.add(state);
      }
    }
  }

  const meaningful = Array.from(pairMap.values())
    .filter(pair => pair.projectIds.size >= 2)
    .sort((a, b) => b.projectIds.size - a.projectIds.size)
    .slice(0, MAX_PERSISTED_PAIRINGS);
  const maxCount = Math.max(...meaningful.map(pair => pair.projectIds.size), 1);
  const existingByKey = new Map<string, typeof existingPairings[number]>();
  const duplicateIds: number[] = [];
  for (const row of existingPairings) {
    const key = `${Math.min(row.companyAId, row.companyBId)}-${Math.max(row.companyAId, row.companyBId)}`;
    if (existingByKey.has(key)) duplicateIds.push(row.id);
    else existingByKey.set(key, row);
  }

  const seen = new Set<string>();
  let newPairings = 0;
  let updatedPairings = 0;
  for (const pair of meaningful) {
    const key = `${pair.companyAId}-${pair.companyBId}`;
    seen.add(key);
    const logScore = Math.log(pair.projectIds.size + 1) / Math.log(maxCount + 1) * 80;
    const sectorBonus = Math.min(10, (pair.sectors.size - 1) * 5);
    const stateBonus = Math.min(10, pair.states.size * 2);
    const strengthScore = Math.min(100, Math.round(logScore + sectorBonus + stateBonus));
    const values = {
      companyAId: pair.companyAId,
      companyAName: pair.companyAName,
      companyARoleInPairing: pair.companyARoleInPairing,
      companyBId: pair.companyBId,
      companyBName: pair.companyBName,
      companyBRoleInPairing: pair.companyBRoleInPairing,
      pairingType: pair.pairingType,
      coOccurrenceCount: pair.projectIds.size,
      projectIds: Array.from(pair.projectIds),
      sectors: Array.from(pair.sectors),
      states: Array.from(pair.states),
      strengthScore,
      lastSeenAt: new Date(),
    };
    const existing = existingByKey.get(key);
    if (existing) {
      await db.update(contractorPairings).set(values).where(eq(contractorPairings.id, existing.id));
      updatedPairings++;
    } else {
      await db.insert(contractorPairings).values(values);
      newPairings++;
    }
  }

  const staleIds = [
    ...duplicateIds,
    ...Array.from(existingByKey.entries())
      .filter(([key]) => !seen.has(key))
      .map(([, row]) => row.id),
  ];
  if (staleIds.length > 0) {
    await db.delete(contractorPairings).where(inArray(contractorPairings.id, staleIds));
  }

  return {
    totalPairings: meaningful.length,
    newPairings,
    updatedPairings,
    topPairings: meaningful.slice(0, 20).map(pair => ({
      companyA: pair.companyAName,
      roleA: pair.companyARoleInPairing,
      companyB: pair.companyBName,
      roleB: pair.companyBRoleInPairing,
      count: pair.projectIds.size,
      type: pair.pairingType,
    })),
  };
}

async function scoreContractorRows(rows: ContractorRegistryRow[]): Promise<ScoringResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (rows.length === 0) {
    return { totalScored: 0, topMomentum: [], topRelevance: [], topEarlySignal: [] };
  }
  const ids = rows.map(row => row.id);
  const links = await db.select().from(contractorProjectLinks)
    .where(inArray(contractorProjectLinks.contractorId, ids));
  const linksByContractor = new Map<number, typeof links>();
  for (const link of links) {
    if (!linksByContractor.has(link.contractorId)) linksByContractor.set(link.contractorId, []);
    linksByContractor.get(link.contractorId)!.push(link);
  }
  const recentProjectIds = Array.from(new Set(rows.flatMap(row => row.recentProjectIds || [])));
  const blRows = recentProjectIds.length > 0
    ? await db.select().from(projectBusinessLineScores)
        .where(inArray(projectBusinessLineScores.projectId, recentProjectIds))
    : [];
  const groupedScores = new Map<number, number[]>();
  for (const score of blRows) {
    if (!groupedScores.has(score.projectId)) groupedScores.set(score.projectId, []);
    groupedScores.get(score.projectId)!.push(score.score);
  }
  const projectScore = new Map<number, number>();
  for (const [projectId, scores] of groupedScores) {
    projectScore.set(projectId, scores.reduce((sum, value) => sum + value, 0) / scores.length);
  }

  const now = Date.now();
  const threeMonthsAgo = now - 90 * 24 * 60 * 60 * 1000;
  const sixMonthsAgo = now - 180 * 24 * 60 * 60 * 1000;
  let totalScored = 0;

  for (const contractor of rows) {
    if (contractor.projectCount < 1) continue;
    const contractorLinks = linksByContractor.get(contractor.id) || [];
    let recentCount = 0;
    let mediumCount = 0;
    for (const link of contractorLinks) {
      const timestamp = link.createdAt?.getTime() || 0;
      if (timestamp > threeMonthsAgo) recentCount++;
      else if (timestamp > sixMonthsAgo) mediumCount++;
    }
    const totalLinks = contractorLinks.length || 1;
    const recentRatio = recentCount / totalLinks;
    const momentumScore = Math.min(100, Math.round(
      recentRatio * 50 +
      Math.min(recentCount, 10) * 3 +
      Math.min(mediumCount, 5) +
      (contractor.confirmedCount > 0 ? 10 : 0),
    ));
    const recurrenceScore = Math.min(100, Math.round(
      Math.min(contractor.projectCount, 20) * 4 +
      Object.keys(contractor.sectorBreakdown || {}).length * 5 +
      Object.keys(contractor.stateBreakdown || {}).length * 3 +
      (contractor.confirmedCount > contractor.predictedCount ? 10 : 0),
    ));
    let atlasTotal = 0;
    let atlasCount = 0;
    for (const projectId of contractor.recentProjectIds || []) {
      const score = projectScore.get(projectId);
      if (score === undefined) continue;
      atlasTotal += score;
      atlasCount++;
    }
    const averageAtlas = atlasCount > 0 ? atlasTotal / atlasCount : 0;
    const roleBoost = contractor.primaryRole === "contractor" ? 15
      : contractor.primaryRole === "epc" ? 12
        : contractor.primaryRole === "subcontractor" ? 10
          : contractor.primaryRole === "rental" ? 20
            : contractor.primaryRole === "owner" ? 5
              : 0;
    const sectorBreakdown = contractor.sectorBreakdown || {};
    const miningEnergy = (sectorBreakdown.mining || 0) + (sectorBreakdown.energy || 0);
    const atlasRelevanceScore = Math.min(100, Math.round(averageAtlas + roleBoost + Math.min(15, miningEnergy * 3)));
    const stageBreakdown = contractor.stageBreakdown || {};
    const earlyStages = (stageBreakdown.planning || 0) + (stageBreakdown.feasibility || 0) + (stageBreakdown.tendering || 0);
    const lateStages = (stageBreakdown.awarded || 0) + (stageBreakdown.construction || 0) + (stageBreakdown.commissioning || 0);
    const totalStages = earlyStages + lateStages || 1;
    const earlySignalScore = Math.min(100, Math.round(
      (earlyStages / totalStages) * 40 +
      Math.min(earlyStages, 10) * 4 +
      (recentCount > 0 ? 15 : 0) +
      (contractor.predictedCount > contractor.confirmedCount ? 10 : 0),
    ));
    const compositeScore = Math.round(
      momentumScore * 0.30 + recurrenceScore * 0.20 + atlasRelevanceScore * 0.30 + earlySignalScore * 0.20,
    );
    await db.update(contractorRegistry)
      .set({ momentumScore, recurrenceScore, atlasRelevanceScore, earlySignalScore, compositeScore })
      .where(eq(contractorRegistry.id, contractor.id));
    totalScored++;
  }

  const top = await db.select().from(contractorRegistry)
    .orderBy(desc(contractorRegistry.compositeScore))
    .limit(100);
  return {
    totalScored,
    topMomentum: [...top]
      .sort((a, b) => (b.momentumScore || 0) - (a.momentumScore || 0))
      .slice(0, 10)
      .map(row => ({ name: row.canonicalName, score: row.momentumScore || 0 })),
    topRelevance: [...top]
      .sort((a, b) => (b.atlasRelevanceScore || 0) - (a.atlasRelevanceScore || 0))
      .slice(0, 10)
      .map(row => ({ name: row.canonicalName, score: row.atlasRelevanceScore || 0 })),
    topEarlySignal: [...top]
      .sort((a, b) => (b.earlySignalScore || 0) - (a.earlySignalScore || 0))
      .slice(0, 10)
      .map(row => ({ name: row.canonicalName, score: row.earlySignalScore || 0 })),
  };
}

async function persistCursor(state: ContractorEngineCursorState): Promise<void> {
  await setSystemKv(CONTRACTOR_ENGINE_CURSOR_KEY, serializeContractorEngineCursor(state));
}

export async function runIncrementalContractorEngine(
  options: IncrementalContractorEngineOptions = {},
): Promise<IncrementalContractorEngineResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const startedAtMs = Date.now();
  const cursor = parseContractorEngineCursor(await getSystemKv(CONTRACTOR_ENGINE_CURSOR_KEY));
  const progress: ContractorEngineProgressCounts = {
    ...EMPTY_PROGRESS_COUNTS,
    projectCursor: cursor.projectCursor,
    awardedCursor: cursor.awardedCursor,
    scoringCursor: cursor.scoringCursor,
    projectCycles: cursor.projectCycles,
    awardedCycles: cursor.awardedCycles,
    scoringCycles: cursor.scoringCycles,
  };
  let lastSnapshot: ContractorEngineProgressSnapshot = { phase: "starting", counts: { ...progress } };

  const publish = async (phase: string): Promise<void> => {
    progress.projectCursor = cursor.projectCursor;
    progress.awardedCursor = cursor.awardedCursor;
    progress.scoringCursor = cursor.scoringCursor;
    progress.projectCycles = cursor.projectCycles;
    progress.awardedCycles = cursor.awardedCycles;
    progress.scoringCycles = cursor.scoringCycles;
    progress.totalMs = Date.now() - startedAtMs;
    lastSnapshot = { phase, counts: { ...progress } };
    await setSystemKv(CONTRACTOR_ENGINE_PROGRESS_KEY, JSON.stringify({
      version: 1,
      phase,
      counts: lastSnapshot.counts,
      updatedAt: new Date().toISOString(),
    }));
    if (options.onProgress) {
      try {
        await options.onProgress(lastSnapshot);
      } catch {
        // IPC/reporting failure must not create a second engine path.
      }
    }
  };

  await publish("starting");

  const projectBatchSize = boundedBatchSize(
    process.env.CONTRACTOR_ENGINE_PROJECT_BATCH_SIZE,
    DEFAULT_PROJECT_BATCH_SIZE,
    MAX_PROJECT_BATCH_SIZE,
  );
  const projectPhaseStarted = Date.now();
  const projectBatch = await loadNextProjectBatch(cursor.projectCursor, projectBatchSize);
  const touchedContractors = new Set<number>();
  let newCompanies = 0;
  let updatedCompanies = 0;
  let wrapCredited = false;
  for (const chunk of chunksOf(projectBatch.rows, PROJECT_CHUNK_SIZE)) {
    if (!shouldStartPhase(startedAtMs, Date.now(), 5 * 60 * 1000)) {
      progress.softBudgetExhausted = 1;
      break;
    }
    const result = await syncProjectChunk(chunk);
    for (const id of result.contractorsTouched) touchedContractors.add(id);
    progress.projectsProcessed += chunk.length;
    progress.projectChunksCompleted++;
    progress.linksWritten += result.linksWritten;
    progress.contractorsTouched = touchedContractors.size;
    newCompanies += result.newCompanies;
    updatedCompanies += result.updatedCompanies;
    const advance = nextCursorAfterChunk(cursor.projectCursor, chunk.map(row => row.id), projectBatch.wrapped && !wrapCredited);
    cursor.projectCursor = advance.cursor;
    cursor.projectCycles += advance.cycleIncrement;
    if (advance.cycleIncrement > 0) wrapCredited = true;
    await persistCursor(cursor);
    await publish("registry_batch");
  }
  progress.registryMs = Date.now() - projectPhaseStarted;

  const awardPhaseStarted = Date.now();
  if (shouldStartPhase(startedAtMs, Date.now(), 4 * 60 * 1000)) {
    const awardBatchSize = boundedBatchSize(
      process.env.CONTRACTOR_ENGINE_AWARD_BATCH_SIZE,
      DEFAULT_AWARD_BATCH_SIZE,
      MAX_AWARD_BATCH_SIZE,
    );
    const awardBatch = await loadNextAwardBatch(cursor.awardedCursor, awardBatchSize);
    progress.awardsProcessed += await syncAwardBatch(awardBatch.rows);
    if (awardBatch.rows.length > 0) {
      const advance = nextCursorAfterChunk(cursor.awardedCursor, awardBatch.rows.map(row => row.id), awardBatch.wrapped);
      cursor.awardedCursor = advance.cursor;
      cursor.awardedCycles += advance.cycleIncrement;
      await persistCursor(cursor);
    }
    await publish("awarded_batch");
  } else {
    progress.softBudgetExhausted = 1;
  }
  progress.awardsMs = Date.now() - awardPhaseStarted;

  let pairings: PairingDetectionResult = {
    totalPairings: 0,
    newPairings: 0,
    updatedPairings: 0,
    topPairings: [],
  };
  const pairingPhaseStarted = Date.now();
  if (shouldStartPhase(startedAtMs, Date.now(), 8 * 60 * 1000)) {
    pairings = await rebuildPairingsOptimized();
    progress.pairingsRebuilt = pairings.totalPairings;
    await publish("pairings_rebuilt");
  } else {
    progress.softBudgetExhausted = 1;
  }
  progress.pairingsMs = Date.now() - pairingPhaseStarted;

  let scoring: ScoringResult = { totalScored: 0, topMomentum: [], topRelevance: [], topEarlySignal: [] };
  const scoringPhaseStarted = Date.now();
  if (shouldStartPhase(startedAtMs, Date.now(), 4 * 60 * 1000)) {
    const scoringBatchSize = boundedBatchSize(
      process.env.CONTRACTOR_ENGINE_SCORING_BATCH_SIZE,
      DEFAULT_SCORING_BATCH_SIZE,
      MAX_SCORING_BATCH_SIZE,
    );
    const scoringBatch = await loadNextScoringBatch(cursor.scoringCursor, scoringBatchSize);
    let scoringWrapCredited = false;
    const aggregate: ScoringResult = { totalScored: 0, topMomentum: [], topRelevance: [], topEarlySignal: [] };
    for (const chunk of chunksOf(scoringBatch.rows, SCORING_CHUNK_SIZE)) {
      if (!shouldStartPhase(startedAtMs, Date.now(), 2 * 60 * 1000)) {
        progress.softBudgetExhausted = 1;
        break;
      }
      const partial = await scoreContractorRows(chunk);
      aggregate.totalScored += partial.totalScored;
      aggregate.topMomentum = partial.topMomentum;
      aggregate.topRelevance = partial.topRelevance;
      aggregate.topEarlySignal = partial.topEarlySignal;
      progress.contractorsScored += partial.totalScored;
      const advance = nextCursorAfterChunk(cursor.scoringCursor, chunk.map(row => row.id), scoringBatch.wrapped && !scoringWrapCredited);
      cursor.scoringCursor = advance.cursor;
      cursor.scoringCycles += advance.cycleIncrement;
      if (advance.cycleIncrement > 0) scoringWrapCredited = true;
      await persistCursor(cursor);
      await publish("scoring_batch");
    }
    scoring = aggregate;
  } else {
    progress.softBudgetExhausted = 1;
  }
  progress.scoringMs = Date.now() - scoringPhaseStarted;

  let patterns: PatternDetectionResult = { totalPatterns: 0, patterns: [] };
  const patternsPhaseStarted = Date.now();
  if (shouldStartPhase(startedAtMs, Date.now(), 60_000)) {
    patterns = await detectEmergingPatterns();
    progress.patternsDetected = patterns.totalPatterns;
    await publish("patterns_detected");
  } else {
    progress.softBudgetExhausted = 1;
  }
  progress.patternsMs = Date.now() - patternsPhaseStarted;
  progress.totalMs = Date.now() - startedAtMs;
  await persistCursor(cursor);
  await publish("completed");

  return {
    registry: {
      totalCompanies: touchedContractors.size,
      totalLinks: progress.linksWritten,
      newCompanies,
      updatedCompanies,
      skippedPlaceholders: 0,
    },
    pairings,
    scoring,
    patterns,
    durationMs: progress.totalMs,
    progress: lastSnapshot,
  };
}
