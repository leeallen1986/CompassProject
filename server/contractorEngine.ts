/**
 * Contractor & Delivery-Pattern Engine
 * 
 * Classifies companies by role, tracks frequency by sector/state/stage/period,
 * detects recurring pairings, and scores for momentum/recurrence/Atlas relevance/early-signal.
 * 
 * This module processes existing project data to build a contractor registry,
 * detect delivery-chain patterns, and generate opportunity signals.
 */

import { getDb } from "./db";
import {
  projects,
  awardedProjects,
  contractorRegistry,
  contractorProjectLinks,
  contractorPairings,
  emergingPatterns,
  projectBusinessLineScores,
  type ContractorRegistryRow,
} from "../drizzle/schema";
import { eq, desc, sql, and, gte, inArray } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";

// ── Role Classification ──

const ROLE_KEYWORDS: Record<string, string[]> = {
  owner: [
    "owner", "proponent", "developer", "principal", "client",
    "government", "department", "authority", "council", "state government",
    "federal government", "operator"
  ],
  epc: [
    "epc", "epcm", "engineering procurement construction",
    "turnkey", "design and construct", "d&c"
  ],
  contractor: [
    "contractor", "mining services", "civil works", "construction",
    "earthworks", "bulk earthworks", "haulage", "mining contractor",
    "building contractor", "main contractor", "head contractor",
    "prime contractor", "tier 1"
  ],
  subcontractor: [
    "subcontractor", "sub-contractor", "specialist", "package",
    "drilling", "blasting", "piling", "concrete", "electrical",
    "mechanical", "piping", "scaffolding"
  ],
  consultant: [
    "consultant", "design", "engineering consultant", "advisory",
    "feasibility", "study", "assessment", "planning", "architect",
    "project management", "quantity surveyor"
  ],
  supplier: [
    "supplier", "supply", "equipment", "manufacturer", "turbine",
    "panel", "module", "fabrication", "material"
  ],
  rental: [
    "rental", "hire", "fleet", "lease", "temporary", "mobilisation"
  ],
};

/**
 * Classify a company's role based on its name, detail text, and status.
 */
export function classifyRole(
  companyName: string,
  detail?: string | null,
  status?: string | null,
  projectOwner?: string | null,
): string {
  const text = `${companyName} ${detail || ""} ${status || ""}`.toLowerCase();
  const ownerLower = (projectOwner || "").toLowerCase();

  // If company name matches the project owner, it's the owner
  if (ownerLower && companyName.toLowerCase().includes(ownerLower.split("/")[0].trim())) {
    return "owner";
  }

  // Score each role
  const scores: Record<string, number> = {};
  for (const [role, keywords] of Object.entries(ROLE_KEYWORDS)) {
    scores[role] = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) scores[role] += 2;
    }
  }

  // EPC-specific patterns
  if (/\bepc\b|\bepcm\b/i.test(text)) scores.epc += 5;
  if (/design\s*(and|&)\s*construct/i.test(text)) scores.epc += 4;

  // Contractor-specific patterns
  if (/mining\s*services/i.test(text)) scores.contractor += 4;
  if (/civil\s*(and|&)\s*mining/i.test(text)) scores.contractor += 3;
  if (/\$\d+[MBmb]/i.test(detail || "")) scores.contractor += 2;

  // Subcontractor patterns
  if (/drill(ing)?\s*(and|&)\s*blast/i.test(text)) scores.subcontractor += 4;

  // Consultant patterns
  if (/feasibility|study|assessment|design\s*consult/i.test(text)) scores.consultant += 3;

  // Supplier patterns
  if (/turbine\s*supplier|panel\s*supplier|equipment\s*supply/i.test(text)) scores.supplier += 4;

  // Find highest scoring role
  let bestRole = "unknown";
  let bestScore = 0;
  for (const [role, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestRole = role;
    }
  }

  return bestRole;
}

// ── Name Normalization ──

const COMPANY_ALIASES: Record<string, string> = {
  "nrw civil & mining": "NRW Holdings",
  "nrw civil and mining": "NRW Holdings",
  "nrw holdings": "NRW Holdings",
  "golding contractors (nrw holdings)": "Golding Contractors",
  "golding contractors": "Golding Contractors",
  "action drill & blast (nrw)": "Action Drill & Blast",
  "action drill & blast": "Action Drill & Blast",
  "thiess (cimic group)": "Thiess",
  "thiess": "Thiess",
  "cimic group": "CIMIC Group",
  "decmil (macmahon)": "Decmil Group",
  "decmil group": "Decmil Group",
  "monadelphous group": "Monadelphous",
  "monadelphous": "Monadelphous",
  "bw offshore australia": "BW Offshore",
  "bw offshore": "BW Offshore",
  "newcrest mining (newmont)": "Newmont",
  "oz minerals (bhp)": "BHP",
  "gr engineering services (gres)": "GR Engineering Services",
  "gr engineering services": "GR Engineering Services",
};

/**
 * Normalize a company name to its canonical form.
 */
export function normalizeCompanyName(name: string): string {
  // ── Step 1: Sanitize HTML and malformed fragments ──
  // Strip HTML tags, anchor fragments, URLs, hex colors, and other invalid patterns
  let sanitized = name.trim();

  // Hard length cap: anything over 150 chars is a description/paragraph, not a company name
  if (sanitized.length > 150) return "";

  // Reject multi-sentence strings (contains a full stop followed by a capital letter)
  if (/\.[A-Z]/.test(sanitized) || sanitized.split(".").length > 3) return "";
  
  // Reject if contains HTML tags, href patterns, URLs, or other malformed content
  if (
    sanitized.includes("<") ||
    sanitized.includes(">") ||
    sanitized.includes("href") ||
    sanitized.includes("//www.") ||
    sanitized.includes("http") ||
    /^#[0-9a-fA-F]{3,6}$/.test(sanitized) ||
    sanitized.startsWith('"')
  ) {
    // If the name contains HTML/URL fragments, try to extract just the text content
    // by removing everything between < and > and stripping URL-like patterns
    sanitized = sanitized
      .replace(/<[^>]*>/g, "") // Remove HTML tags
      .replace(/href\s*=\s*["']?[^"'\s>]*["']?/gi, "") // Remove href attributes
      .replace(/https?:\/\/[^\s"'<>]*/g, "") // Remove URLs
      .replace(/\/\/www\.[^\s"'<>]*/g, "") // Remove //www. patterns
      .trim();
    
    // If after stripping we still have invalid content, return empty to skip this contractor
    if (!sanitized || sanitized.length < 3 || sanitized.length > 200) {
      return ""; // Return empty string to signal invalid contractor name
    }
  }
  
  const lower = sanitized.toLowerCase();
  if (COMPANY_ALIASES[lower]) return COMPANY_ALIASES[lower];

  // Remove common suffixes
  let clean = sanitized
    .replace(/\s*(pty\.?\s*ltd\.?|ltd\.?|limited|inc\.?|corp\.?|group)\s*$/i, "")
    .replace(/\s*(australia|aust\.?)\s*$/i, "")
    .trim();

  // Title case
  if (clean === clean.toLowerCase() || clean === clean.toUpperCase()) {
    clean = clean.replace(/\b\w/g, c => c.toUpperCase());
  }

  return clean || sanitized;
}

// ── Placeholder Filtering ──

const PLACEHOLDER_NAMES = new Set([
  "not yet awarded", "various", "unknown", "tbd", "to be appointed",
  "various consultants", "various contractors", "various local contractors",
  "various local and national contractors", "various specialist underground contractors",
  "n/a", "none", "pending", "to be confirmed", "not applicable",
]);

export function isPlaceholder(name: string): boolean {
  return PLACEHOLDER_NAMES.has(name.toLowerCase().trim());
}

// ── State Extraction ──

export function extractState(location: string): string {
  const match = location.match(/\b(WA|NSW|QLD|VIC|SA|NT|TAS|ACT)\b/);
  return match ? match[1] : "Other";
}

// ── Stage Normalization ──

export function normalizeStage(stage: string | null): string {
  if (!stage) return "unknown";
  const s = stage.toLowerCase();
  if (/awarded|commenced|mobilis/i.test(s)) return "awarded";
  if (/tender|tendering|procurement|rfp|rft|eoi/i.test(s)) return "tendering";
  if (/construct|build|underway|progress/i.test(s)) return "construction";
  if (/feasibility|study|assessment|scoping|pre-feasibility|dfs|pfs/i.test(s)) return "feasibility";
  if (/plan|propos|approv|permit|concept|early/i.test(s)) return "planning";
  if (/commission|complete|operational/i.test(s)) return "commissioning";
  return "other";
}

// ── Core Engine: Build Registry from Project Data ──

export interface RegistryBuildResult {
  totalCompanies: number;
  totalLinks: number;
  newCompanies: number;
  updatedCompanies: number;
  skippedPlaceholders: number;
}

/**
 * Scan all projects and build/update the contractor registry and project links.
 * This is the main ingestion function — call it after new projects are added.
 */
export async function buildContractorRegistry(): Promise<RegistryBuildResult> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result: RegistryBuildResult = {
    totalCompanies: 0,
    totalLinks: 0,
    newCompanies: 0,
    updatedCompanies: 0,
    skippedPlaceholders: 0,
  };

  // 1. Load all projects with contractor data
  const allProjects = await db.select().from(projects);
  
  // 2. Build a map of canonical name → aggregated data
  const companyMap = new Map<string, {
    canonical: string;
    aliases: Set<string>;
    roles: Map<string, number>;
    projectLinks: Array<{
      projectId: number;
      role: string;
      status: string;
      detail: string | null;
      confidence: number;
      sector: string;
      state: string;
      stage: string;
      createdAt: Date | null;
    }>;
  }>();

  for (const project of allProjects) {
    const contractors = project.contractors as Array<{
      name: string;
      status: string;
      confidence?: number;
      detail?: string;
    }> | null;

    // Also include the owner as a company
    const ownerName = normalizeCompanyName(project.owner);
    if (ownerName && !isPlaceholder(ownerName)) {
      const key = ownerName.toLowerCase();
      if (!companyMap.has(key)) {
        companyMap.set(key, { canonical: ownerName, aliases: new Set(), roles: new Map(), projectLinks: [] });
      }
      const entry = companyMap.get(key)!;
      entry.aliases.add(project.owner);
      entry.roles.set("owner", (entry.roles.get("owner") || 0) + 1);
      entry.projectLinks.push({
        projectId: project.id,
        role: "owner",
        status: "confirmed",
        detail: null,
        confidence: 100,
        sector: project.sector,
        state: extractState(project.location),
        stage: normalizeStage(project.stage),
        createdAt: project.createdAt,
      });
    }

    if (!contractors || !Array.isArray(contractors)) continue;

    for (const c of contractors) {
      if (!c.name || isPlaceholder(c.name)) {
        result.skippedPlaceholders++;
        continue;
      }

      const canonical = normalizeCompanyName(c.name);
      // Skip if sanitization returned empty (HTML/malformed content)
      if (!canonical) {
        result.skippedPlaceholders++;
        continue;
      }
      const key = canonical.toLowerCase();
      const role = classifyRole(c.name, c.detail, c.status, project.owner);
      const confidence = c.status === "confirmed" ? 90 : (c.confidence ? Math.round(c.confidence * 100) : 50);

      if (!companyMap.has(key)) {
        companyMap.set(key, { canonical, aliases: new Set(), roles: new Map(), projectLinks: [] });
      }
      const entry = companyMap.get(key)!;
      entry.aliases.add(c.name);
      entry.roles.set(role, (entry.roles.get(role) || 0) + 1);
      entry.projectLinks.push({
        projectId: project.id,
        role,
        status: c.status === "confirmed" ? "confirmed" : "predicted",
        detail: c.detail || null,
        confidence,
        sector: project.sector,
        state: extractState(project.location),
        stage: normalizeStage(project.stage),
        createdAt: project.createdAt,
      });
    }
  }

  // 3. Also ingest awarded projects
  const allAwarded = await db.select().from(awardedProjects);
  for (const ap of allAwarded) {
    if (!ap.winningContractor || isPlaceholder(ap.winningContractor)) continue;
    const canonical = normalizeCompanyName(ap.winningContractor);
    const key = canonical.toLowerCase();
    if (!companyMap.has(key)) {
      companyMap.set(key, { canonical, aliases: new Set(), roles: new Map(), projectLinks: [] });
    }
    const entry = companyMap.get(key)!;
    entry.aliases.add(ap.winningContractor);
    entry.roles.set("contractor", (entry.roles.get("contractor") || 0) + 1);
  }

  // 4. Persist to database — upsert each company
  for (const [, data] of Array.from(companyMap)) {
    // Determine primary role (most frequent)
    let primaryRole = "unknown";
    let maxCount = 0;
    for (const [role, count] of Array.from(data.roles)) {
      if (count > maxCount) { maxCount = count; primaryRole = role; }
    }
    const additionalRoles = Array.from(data.roles.keys()).filter(r => r !== primaryRole);

    // Build frequency breakdowns
    const sectorBreakdown: Record<string, number> = {};
    const stateBreakdown: Record<string, number> = {};
    const stageBreakdown: Record<string, number> = {};
    let confirmedCount = 0;
    let predictedCount = 0;
    const projectIdSet = new Set<number>();
    let firstSeen: Date | null = null;
    let lastSeen: Date | null = null;

    for (const link of data.projectLinks) {
      sectorBreakdown[link.sector] = (sectorBreakdown[link.sector] || 0) + 1;
      stateBreakdown[link.state] = (stateBreakdown[link.state] || 0) + 1;
      stageBreakdown[link.stage] = (stageBreakdown[link.stage] || 0) + 1;
      if (link.status === "confirmed") confirmedCount++;
      else predictedCount++;
      projectIdSet.add(link.projectId);
      if (link.createdAt) {
        if (!firstSeen || link.createdAt < firstSeen) firstSeen = link.createdAt;
        if (!lastSeen || link.createdAt > lastSeen) lastSeen = link.createdAt;
      }
    }

    const recentProjectIds = Array.from(projectIdSet).slice(-50); // Keep last 50

    // Check if company already exists
    const existing = await db.select().from(contractorRegistry)
      .where(eq(contractorRegistry.canonicalName, data.canonical))
      .limit(1);

    const validRole = (r: string) => {
      const valid = ["owner", "epc", "contractor", "subcontractor", "consultant", "supplier", "rental", "government", "unknown"];
      return valid.includes(r) ? r as any : "unknown";
    };

    if (existing.length > 0) {
      await db.update(contractorRegistry)
        .set({
          aliases: Array.from(data.aliases),
          primaryRole: validRole(primaryRole),
          additionalRoles,
          projectCount: projectIdSet.size,
          confirmedCount,
          predictedCount,
          sectorBreakdown,
          stateBreakdown,
          stageBreakdown,
          recentProjectIds,
          firstSeenAt: firstSeen,
          lastSeenAt: lastSeen,
        })
        .where(eq(contractorRegistry.id, existing[0].id));
      result.updatedCompanies++;
    } else {
      await db.insert(contractorRegistry).values({
        canonicalName: data.canonical,
        aliases: Array.from(data.aliases),
        primaryRole: validRole(primaryRole),
        additionalRoles,
        projectCount: projectIdSet.size,
        confirmedCount,
        predictedCount,
        sectorBreakdown,
        stateBreakdown,
        stageBreakdown,
        recentProjectIds,
        firstSeenAt: firstSeen,
        lastSeenAt: lastSeen,
      });
      result.newCompanies++;
    }

    // 5. Insert project links
    // First get the contractor ID
    const [contractor] = await db.select({ id: contractorRegistry.id })
      .from(contractorRegistry)
      .where(eq(contractorRegistry.canonicalName, data.canonical))
      .limit(1);

    if (contractor) {
      // Delete old links for this contractor and re-insert
      await db.delete(contractorProjectLinks)
        .where(eq(contractorProjectLinks.contractorId, contractor.id));

      for (const link of data.projectLinks) {
        await db.insert(contractorProjectLinks).values({
          contractorId: contractor.id,
          projectId: link.projectId,
          role: validRole(link.role),
          status: link.status === "confirmed" ? "confirmed" : "predicted",
          detail: link.detail,
          confidence: link.confidence,
          source: "seed_data",
        });
        result.totalLinks++;
      }
    }

    result.totalCompanies++;
  }

  return result;
}

// ── Pairing Detection ──

export interface PairingDetectionResult {
  totalPairings: number;
  newPairings: number;
  updatedPairings: number;
  topPairings: Array<{
    companyA: string;
    roleA: string;
    companyB: string;
    roleB: string;
    count: number;
    type: string;
  }>;
}

/**
 * Detect recurring pairings between companies that appear on the same projects.
 */
export async function detectPairings(): Promise<PairingDetectionResult> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result: PairingDetectionResult = {
    totalPairings: 0,
    newPairings: 0,
    updatedPairings: 0,
    topPairings: [],
  };

  // Load all project links grouped by project
  const allLinks = await db.select().from(contractorProjectLinks);
  const allContractors = await db.select().from(contractorRegistry);
  const contractorMap = new Map(allContractors.map(c => [c.id, c]));

  // Group links by project
  const projectGroups = new Map<number, typeof allLinks>();
  for (const link of allLinks) {
    if (!projectGroups.has(link.projectId)) projectGroups.set(link.projectId, []);
    projectGroups.get(link.projectId)!.push(link);
  }

  // Detect pairs
  const pairMap = new Map<string, {
    companyAId: number;
    companyAName: string;
    companyARoleInPairing: string;
    companyBId: number;
    companyBName: string;
    companyBRoleInPairing: string;
    pairingType: string;
    projectIds: Set<number>;
    sectors: Set<string>;
    states: Set<string>;
    lastSeen: Date | null;
  }>();

  for (const [projectId, links] of Array.from(projectGroups)) {
    if (links.length < 2) continue;

    // Get project info for sector/state
    const project = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    const sector = project[0]?.sector || "unknown";
    const state = extractState(project[0]?.location || "");

    // Generate all pairs
    for (let i = 0; i < links.length; i++) {
      for (let j = i + 1; j < links.length; j++) {
        const a = links[i];
        const b = links[j];
        if (a.contractorId === b.contractorId) continue;

        // Ensure consistent ordering (lower ID first)
        const [first, second] = a.contractorId < b.contractorId ? [a, b] : [b, a];
        const key = `${first.contractorId}-${second.contractorId}`;

        const firstCompany = contractorMap.get(first.contractorId);
        const secondCompany = contractorMap.get(second.contractorId);
        if (!firstCompany || !secondCompany) continue;

        // Determine pairing type
        const pairingType = determinePairingType(first.role, second.role);

        if (!pairMap.has(key)) {
          pairMap.set(key, {
            companyAId: first.contractorId,
            companyAName: firstCompany.canonicalName,
            companyARoleInPairing: first.role,
            companyBId: second.contractorId,
            companyBName: secondCompany.canonicalName,
            companyBRoleInPairing: second.role,
            pairingType,
            projectIds: new Set(),
            sectors: new Set(),
            states: new Set(),
            lastSeen: null,
          });
        }
        const pair = pairMap.get(key)!;
        pair.projectIds.add(projectId);
        pair.sectors.add(sector);
        if (state !== "Other") pair.states.add(state);
      }
    }
  }

  // Filter to meaningful pairings (co-occur on 2+ projects)
  const meaningfulPairs = Array.from(pairMap.values()).filter(p => p.projectIds.size >= 2);

  // Clear old pairings and insert new ones
  await db.delete(contractorPairings);

  for (const pair of meaningfulPairs) {
    const strength = Math.min(100, pair.projectIds.size * 15 + (pair.sectors.size > 1 ? 10 : 0));

    const validPairingType = (t: string) => {
      const valid = ["owner_epc", "owner_contractor", "contractor_consultant", "contractor_subcontractor", "contractor_region", "epc_subcontractor", "other"];
      return valid.includes(t) ? t as any : "other";
    };

    await db.insert(contractorPairings).values({
      companyAId: pair.companyAId,
      companyAName: pair.companyAName,
      companyARoleInPairing: pair.companyARoleInPairing,
      companyBId: pair.companyBId,
      companyBName: pair.companyBName,
      companyBRoleInPairing: pair.companyBRoleInPairing,
      pairingType: validPairingType(pair.pairingType),
      coOccurrenceCount: pair.projectIds.size,
      projectIds: Array.from(pair.projectIds),
      sectors: Array.from(pair.sectors),
      states: Array.from(pair.states),
      strengthScore: strength,
      lastSeenAt: new Date(),
    });
    result.totalPairings++;
    result.newPairings++;
  }

  // Build top pairings for the result
  result.topPairings = meaningfulPairs
    .sort((a, b) => b.projectIds.size - a.projectIds.size)
    .slice(0, 20)
    .map(p => ({
      companyA: p.companyAName,
      roleA: p.companyARoleInPairing,
      companyB: p.companyBName,
      roleB: p.companyBRoleInPairing,
      count: p.projectIds.size,
      type: p.pairingType,
    }));

  return result;
}

function determinePairingType(roleA: string, roleB: string): string {
  const roles = new Set([roleA, roleB]);
  if (roles.has("owner") && roles.has("epc")) return "owner_epc";
  if (roles.has("owner") && roles.has("contractor")) return "owner_contractor";
  if (roles.has("contractor") && roles.has("consultant")) return "contractor_consultant";
  if (roles.has("contractor") && roles.has("subcontractor")) return "contractor_subcontractor";
  if (roles.has("epc") && roles.has("subcontractor")) return "epc_subcontractor";
  return "other";
}

// ── Scoring Engine ──

export interface ScoringResult {
  totalScored: number;
  topMomentum: Array<{ name: string; score: number }>;
  topRelevance: Array<{ name: string; score: number }>;
  topEarlySignal: Array<{ name: string; score: number }>;
}

/**
 * Score all contractors for momentum, recurrence, Atlas relevance, and early-signal value.
 */
export async function scoreContractors(): Promise<ScoringResult> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const allContractors = await db.select().from(contractorRegistry);
  const result: ScoringResult = {
    totalScored: 0,
    topMomentum: [],
    topRelevance: [],
    topEarlySignal: [],
  };

  // Load project business line scores for Atlas relevance
  const allBLScores = await db.select().from(projectBusinessLineScores);
  const projectBLMap = new Map<number, number>(); // projectId → avg score
  const grouped = new Map<number, number[]>();
  for (const s of allBLScores) {
    if (!grouped.has(s.projectId)) grouped.set(s.projectId, []);
    grouped.get(s.projectId)!.push(s.score);
  }
  for (const [pid, scores] of Array.from(grouped)) {
    projectBLMap.set(pid, scores.reduce((a: number, b: number) => a + b, 0) / scores.length);
  }

  const now = Date.now();
  const threeMonthsAgo = now - (90 * 24 * 60 * 60 * 1000);
  const sixMonthsAgo = now - (180 * 24 * 60 * 60 * 1000);

  for (const contractor of allContractors) {
    if (contractor.projectCount < 1) continue;

    // ── Momentum Score (0-100) ──
    // Based on recent activity concentration
    const recentIds = contractor.recentProjectIds || [];
    const links = await db.select().from(contractorProjectLinks)
      .where(eq(contractorProjectLinks.contractorId, contractor.id));

    let recentCount = 0;
    let mediumCount = 0;
    for (const link of links) {
      const ts = link.createdAt?.getTime() || 0;
      if (ts > threeMonthsAgo) recentCount++;
      else if (ts > sixMonthsAgo) mediumCount++;
    }

    const totalLinks = links.length || 1;
    const recentRatio = recentCount / totalLinks;
    const momentum = Math.min(100, Math.round(
      recentRatio * 50 +                    // Recent activity weight
      Math.min(recentCount, 10) * 3 +       // Absolute recent count
      Math.min(mediumCount, 5) * 1 +         // Medium-term activity
      (contractor.confirmedCount > 0 ? 10 : 0) // Confirmed bonus
    ));

    // ── Recurrence Score (0-100) ──
    // Based on how often they appear across different projects
    const recurrence = Math.min(100, Math.round(
      Math.min(contractor.projectCount, 20) * 4 +    // Project count (capped at 20)
      (Object.keys(contractor.sectorBreakdown || {}).length) * 5 + // Sector diversity
      (Object.keys(contractor.stateBreakdown || {}).length) * 3 +  // State diversity
      (contractor.confirmedCount > contractor.predictedCount ? 10 : 0) // Confirmation ratio
    ));

    // ── Atlas Relevance Score (0-100) ──
    // Based on business line scores of their projects
    let atlasTotal = 0;
    let atlasCount = 0;
    for (const pid of recentIds) {
      const blScore = projectBLMap.get(pid);
      if (blScore !== undefined) {
        atlasTotal += blScore;
        atlasCount++;
      }
    }
    const avgAtlasScore = atlasCount > 0 ? atlasTotal / atlasCount : 0;

    // Boost for roles that typically need Atlas equipment
    const roleBoost =
      contractor.primaryRole === "contractor" ? 15 :
      contractor.primaryRole === "epc" ? 12 :
      contractor.primaryRole === "subcontractor" ? 10 :
      contractor.primaryRole === "rental" ? 20 :
      contractor.primaryRole === "owner" ? 5 : 0;

    // Sector boost for mining/energy
    const sectorBreakdown = contractor.sectorBreakdown || {};
    const miningEnergy = (sectorBreakdown["mining"] || 0) + (sectorBreakdown["energy"] || 0);
    const sectorBoost = Math.min(15, miningEnergy * 3);

    const atlasRelevance = Math.min(100, Math.round(avgAtlasScore + roleBoost + sectorBoost));

    // ── Early Signal Score (0-100) ──
    // Based on how often they appear in early-stage projects
    const stageBreakdown = contractor.stageBreakdown || {};
    const earlyStages = (stageBreakdown["planning"] || 0) + (stageBreakdown["feasibility"] || 0) + (stageBreakdown["tendering"] || 0);
    const lateStages = (stageBreakdown["awarded"] || 0) + (stageBreakdown["construction"] || 0) + (stageBreakdown["commissioning"] || 0);
    const totalStages = earlyStages + lateStages || 1;
    const earlyRatio = earlyStages / totalStages;

    const earlySignal = Math.min(100, Math.round(
      earlyRatio * 40 +                     // Early stage ratio
      Math.min(earlyStages, 10) * 4 +       // Absolute early count
      (recentCount > 0 ? 15 : 0) +          // Recent activity bonus
      (contractor.predictedCount > contractor.confirmedCount ? 10 : 0) // More predicted = more early
    ));

    // ── Composite Score ──
    const composite = Math.round(
      momentum * 0.30 +
      recurrence * 0.20 +
      atlasRelevance * 0.30 +
      earlySignal * 0.20
    );

    // Update the contractor record
    await db.update(contractorRegistry)
      .set({
        momentumScore: momentum,
        recurrenceScore: recurrence,
        atlasRelevanceScore: atlasRelevance,
        earlySignalScore: earlySignal,
        compositeScore: composite,
      })
      .where(eq(contractorRegistry.id, contractor.id));

    result.totalScored++;
  }

  // Build top lists
  const scored = await db.select().from(contractorRegistry)
    .orderBy(desc(contractorRegistry.compositeScore))
    .limit(100);

  result.topMomentum = scored
    .sort((a, b) => (b.momentumScore || 0) - (a.momentumScore || 0))
    .slice(0, 10)
    .map(c => ({ name: c.canonicalName, score: c.momentumScore || 0 }));

  result.topRelevance = scored
    .sort((a, b) => (b.atlasRelevanceScore || 0) - (a.atlasRelevanceScore || 0))
    .slice(0, 10)
    .map(c => ({ name: c.canonicalName, score: c.atlasRelevanceScore || 0 }));

  result.topEarlySignal = scored
    .sort((a, b) => (b.earlySignalScore || 0) - (a.earlySignalScore || 0))
    .slice(0, 10)
    .map(c => ({ name: c.canonicalName, score: c.earlySignalScore || 0 }));

  return result;
}

// ── Emerging Pattern Detection ──

export interface PatternDetectionResult {
  totalPatterns: number;
  patterns: Array<{
    type: string;
    title: string;
    strength: string;
    description: string;
  }>;
}

/**
 * Detect emerging patterns from contractor activity and pairings.
 */
export async function detectEmergingPatterns(): Promise<PatternDetectionResult> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result: PatternDetectionResult = { totalPatterns: 0, patterns: [] };

  const allContractors = await db.select().from(contractorRegistry)
    .orderBy(desc(contractorRegistry.compositeScore));
  const allPairings = await db.select().from(contractorPairings)
    .orderBy(desc(contractorPairings.coOccurrenceCount));

  // Expire old patterns
  await db.update(emergingPatterns)
    .set({ isActive: false })
    .where(sql`${emergingPatterns.detectedAt} < DATE_SUB(NOW(), INTERVAL 30 DAY)`);

  // ── Pattern 1: Contractor Surge ──
  // Companies with high momentum and multiple recent projects
  const surgeContractors = allContractors.filter(c =>
    (c.momentumScore || 0) >= 60 && c.projectCount >= 3 && c.primaryRole !== "owner" && c.primaryRole !== "government"
  );

  for (const c of surgeContractors.slice(0, 5)) {
    const sectors = Object.keys(c.sectorBreakdown || {}).join(", ");
    const states = Object.keys(c.stateBreakdown || {}).join(", ");
    await insertPattern(db, {
      patternType: "contractor_surge",
      title: `${c.canonicalName} showing increased project activity`,
      description: `${c.canonicalName} (${c.primaryRole}) has appeared on ${c.projectCount} projects across ${sectors}. Active in ${states}. ${c.confirmedCount} confirmed, ${c.predictedCount} predicted roles.`,
      signalStrength: (c.momentumScore || 0) >= 80 ? "strong" : "moderate",
      contractorIds: [c.id],
      projectIds: c.recentProjectIds || [],
      sectors: Object.keys(c.sectorBreakdown || {}),
      states: Object.keys(c.stateBreakdown || {}),
      atlasRelevance: `Atlas relevance score: ${c.atlasRelevanceScore}/100. ${c.primaryRole === "contractor" || c.primaryRole === "epc" ? "Direct equipment buyer potential." : "Indirect influence on equipment decisions."}`,
      suggestedAction: `Review ${c.canonicalName}'s recent project wins. Consider proactive outreach to their procurement/project teams for equipment rental or supply discussions.`,
    });
    result.totalPatterns++;
    result.patterns.push({
      type: "contractor_surge",
      title: `${c.canonicalName} showing increased activity`,
      strength: (c.momentumScore || 0) >= 80 ? "strong" : "moderate",
      description: `${c.projectCount} projects, momentum ${c.momentumScore}/100`,
    });
  }

  // ── Pattern 2: Pairing Activation ──
  // Strong pairings that keep appearing together
  const strongPairings = allPairings.filter(p => p.coOccurrenceCount >= 3 && (p.strengthScore || 0) >= 40);
  for (const p of strongPairings.slice(0, 5)) {
    await insertPattern(db, {
      patternType: "pairing_activation",
      title: `Recurring partnership: ${p.companyAName} + ${p.companyBName}`,
      description: `${p.companyAName} (${p.companyARoleInPairing}) and ${p.companyBName} (${p.companyBRoleInPairing}) have appeared together on ${p.coOccurrenceCount} projects. Sectors: ${(p.sectors || []).join(", ")}. States: ${(p.states || []).join(", ")}.`,
      signalStrength: p.coOccurrenceCount >= 5 ? "strong" : "moderate",
      contractorIds: [p.companyAId, p.companyBId],
      projectIds: p.projectIds || [],
      pairingIds: [p.id],
      sectors: p.sectors || [],
      states: p.states || [],
      atlasRelevance: `When ${p.companyAName} wins a project, ${p.companyBName} is likely to follow. Both represent potential equipment demand.`,
      suggestedAction: `Monitor both companies. When one wins a new contract, proactively approach the other for equipment needs.`,
    });
    result.totalPatterns++;
    result.patterns.push({
      type: "pairing_activation",
      title: `${p.companyAName} + ${p.companyBName}`,
      strength: p.coOccurrenceCount >= 5 ? "strong" : "moderate",
      description: `${p.coOccurrenceCount} co-occurrences`,
    });
  }

  // ── Pattern 3: Regional Momentum ──
  // States with high concentration of recent activity
  const stateCounts: Record<string, { count: number; contractors: string[]; sectors: Set<string> }> = {};
  for (const c of allContractors) {
    if ((c.momentumScore || 0) < 40) continue;
    for (const [state, count] of Object.entries(c.stateBreakdown || {})) {
      if (state === "Other") continue;
      if (!stateCounts[state]) stateCounts[state] = { count: 0, contractors: [], sectors: new Set() };
      stateCounts[state].count += count;
      stateCounts[state].contractors.push(c.canonicalName);
      Object.keys(c.sectorBreakdown || {}).forEach(s => stateCounts[state].sectors.add(s));
    }
  }

  const hotStates = Object.entries(stateCounts)
    .filter(([, v]) => v.count >= 10)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3);

  for (const [state, data] of hotStates) {
    const topContractors = data.contractors.slice(0, 5).join(", ");
    await insertPattern(db, {
      patternType: "regional_momentum",
      title: `High project activity in ${state}`,
      description: `${data.count} contractor-project links in ${state} across ${Array.from(data.sectors).join(", ")}. Key players: ${topContractors}.`,
      signalStrength: data.count >= 20 ? "strong" : "moderate",
      contractorIds: [],
      projectIds: [],
      sectors: Array.from(data.sectors),
      states: [state],
      atlasRelevance: `Regional clustering suggests sustained equipment demand in ${state}. Consider territory-specific sales campaigns.`,
      suggestedAction: `Brief ${state} sales team on active contractors and upcoming project stages. Prioritize relationship building with top contractors in the region.`,
    });
    result.totalPatterns++;
    result.patterns.push({
      type: "regional_momentum",
      title: `High activity in ${state}`,
      strength: data.count >= 20 ? "strong" : "moderate",
      description: `${data.count} links, ${Array.from(data.sectors).join("/")}`,
    });
  }

  // ── Pattern 4: Supply Chain Signal ──
  // Contractors with high Atlas relevance and recent activity
  const supplySignals = allContractors.filter(c =>
    (c.atlasRelevanceScore || 0) >= 60 &&
    (c.momentumScore || 0) >= 50 &&
    c.primaryRole !== "owner" && c.primaryRole !== "government"
  );

  for (const c of supplySignals.slice(0, 3)) {
    await insertPattern(db, {
      patternType: "supply_chain_signal",
      title: `Equipment demand signal: ${c.canonicalName}`,
      description: `${c.canonicalName} (${c.primaryRole}) has Atlas relevance score ${c.atlasRelevanceScore}/100 and momentum ${c.momentumScore}/100. Active across ${Object.keys(c.sectorBreakdown || {}).join(", ")} in ${Object.keys(c.stateBreakdown || {}).join(", ")}.`,
      signalStrength: (c.atlasRelevanceScore || 0) >= 80 ? "strong" : "moderate",
      contractorIds: [c.id],
      projectIds: c.recentProjectIds || [],
      sectors: Object.keys(c.sectorBreakdown || {}),
      states: Object.keys(c.stateBreakdown || {}),
      atlasRelevance: `High probability of portable air, power, or pump equipment needs based on project types and contractor role.`,
      suggestedAction: `Prioritize outreach to ${c.canonicalName}'s procurement team. Prepare equipment proposals aligned with their active project sectors.`,
    });
    result.totalPatterns++;
    result.patterns.push({
      type: "supply_chain_signal",
      title: `Equipment demand: ${c.canonicalName}`,
      strength: (c.atlasRelevanceScore || 0) >= 80 ? "strong" : "moderate",
      description: `Atlas relevance ${c.atlasRelevanceScore}/100`,
    });
  }

  return result;
}

async function insertPattern(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, data: {
  patternType: any;
  title: string;
  description: string;
  signalStrength: any;
  contractorIds?: number[];
  projectIds?: number[];
  pairingIds?: number[];
  sectors?: string[];
  states?: string[];
  atlasRelevance?: string;
  suggestedAction?: string;
}) {
  // Check for duplicate active pattern with same title
  const existing = await db.select().from(emergingPatterns)
    .where(and(
      eq(emergingPatterns.title, data.title),
      eq(emergingPatterns.isActive, true),
    ))
    .limit(1);

  if (existing.length > 0) return; // Skip duplicate

  await db.insert(emergingPatterns).values({
    patternType: data.patternType,
    title: data.title,
    description: data.description,
    signalStrength: data.signalStrength,
    contractorIds: data.contractorIds || [],
    projectIds: data.projectIds || [],
    pairingIds: data.pairingIds || [],
    sectors: data.sectors || [],
    states: data.states || [],
    atlasRelevance: data.atlasRelevance || null,
    suggestedAction: data.suggestedAction || null,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  });
}

// ── Weekly Brief: Emerging Patterns Section ──

export interface EmergingPatternsSection {
  title: string;
  generatedAt: string;
  patterns: Array<{
    type: string;
    title: string;
    strength: string;
    description: string;
    atlasRelevance: string;
    suggestedAction: string;
    relatedCompanies: string[];
    sectors: string[];
    states: string[];
  }>;
  contractorLeaderboard: Array<{
    rank: number;
    name: string;
    role: string;
    projectCount: number;
    compositeScore: number;
    momentum: number;
    atlasRelevance: number;
    topSectors: string[];
    topStates: string[];
  }>;
  topPairings: Array<{
    companyA: string;
    companyB: string;
    type: string;
    count: number;
    strength: number;
  }>;
}

/**
 * Generate the "Emerging Patterns" section for the weekly brief.
 */
export async function generateEmergingPatternsSection(): Promise<EmergingPatternsSection> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Get active patterns
  const activePatterns = await db.select().from(emergingPatterns)
    .where(eq(emergingPatterns.isActive, true))
    .orderBy(desc(emergingPatterns.detectedAt))
    .limit(15);

  // Get contractor leaderboard
  const topContractors = await db.select().from(contractorRegistry)
    .orderBy(desc(contractorRegistry.compositeScore))
    .limit(15);

  // Get top pairings
  const topPairings = await db.select().from(contractorPairings)
    .orderBy(desc(contractorPairings.coOccurrenceCount))
    .limit(10);

  // Build contractor name map for pattern enrichment
  const contractorMap = new Map(topContractors.map(c => [c.id, c.canonicalName]));

  return {
    title: "Emerging Patterns — Contractor & Delivery Chain Signals",
    generatedAt: new Date().toISOString(),
    patterns: activePatterns.map(p => ({
      type: p.patternType,
      title: p.title,
      strength: p.signalStrength,
      description: p.description,
      atlasRelevance: p.atlasRelevance || "",
      suggestedAction: p.suggestedAction || "",
      relatedCompanies: (p.contractorIds || []).map(id => contractorMap.get(id) || `ID:${id}`),
      sectors: p.sectors || [],
      states: p.states || [],
    })),
    contractorLeaderboard: topContractors
      .filter(c => c.primaryRole !== "owner" && c.primaryRole !== "government" && c.primaryRole !== "unknown")
      .slice(0, 10)
      .map((c, i) => ({
        rank: i + 1,
        name: c.canonicalName,
        role: c.primaryRole,
        projectCount: c.projectCount,
        compositeScore: c.compositeScore || 0,
        momentum: c.momentumScore || 0,
        atlasRelevance: c.atlasRelevanceScore || 0,
        topSectors: Object.entries(c.sectorBreakdown || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([s]) => s),
        topStates: Object.entries(c.stateBreakdown || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([s]) => s),
      })),
    topPairings: topPairings.map(p => ({
      companyA: p.companyAName,
      companyB: p.companyBName,
      type: p.pairingType,
      count: p.coOccurrenceCount,
      strength: p.strengthScore || 0,
    })),
  };
}

// ── Full Engine Run ──

export interface EngineRunResult {
  registry: RegistryBuildResult;
  pairings: PairingDetectionResult;
  scoring: ScoringResult;
  patterns: PatternDetectionResult;
  durationMs: number;
}

/**
 * Run the full contractor engine: build registry, detect pairings, score, detect patterns.
 */
export async function runContractorEngine(): Promise<EngineRunResult> {
  const start = Date.now();
  console.log("[ContractorEngine] Starting full engine run...");

  console.log("[ContractorEngine] Step 1/4: Building contractor registry...");
  const registry = await buildContractorRegistry();
  console.log(`[ContractorEngine] Registry: ${registry.totalCompanies} companies, ${registry.totalLinks} links`);

  console.log("[ContractorEngine] Step 2/4: Detecting pairings...");
  const pairings = await detectPairings();
  console.log(`[ContractorEngine] Pairings: ${pairings.totalPairings} detected`);

  console.log("[ContractorEngine] Step 3/4: Scoring contractors...");
  const scoring = await scoreContractors();
  console.log(`[ContractorEngine] Scored: ${scoring.totalScored} contractors`);

  console.log("[ContractorEngine] Step 4/4: Detecting emerging patterns...");
  const patterns = await detectEmergingPatterns();
  console.log(`[ContractorEngine] Patterns: ${patterns.totalPatterns} detected`);

  const durationMs = Date.now() - start;
  console.log(`[ContractorEngine] Complete in ${(durationMs / 1000).toFixed(1)}s`);

  return { registry, pairings, scoring, patterns, durationMs };
}

// ── Query Helpers ──

export async function getContractorLeaderboard(limit = 20, role?: string, sector?: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  let query = db.select().from(contractorRegistry)
    .orderBy(desc(contractorRegistry.compositeScore))
    .limit(limit);

  // Note: filtering by role/sector is done in-memory since JSON columns can't be easily filtered
  const results = await query;

  return results.filter(c => {
    if (role && c.primaryRole !== role) return false;
    if (sector && !(c.sectorBreakdown as Record<string, number> || {})[sector]) return false;
    return true;
  }).slice(0, limit);
}

export async function getContractorProfile(contractorId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const [contractor] = await db.select().from(contractorRegistry)
    .where(eq(contractorRegistry.id, contractorId))
    .limit(1);

  if (!contractor) return null;

  const links = await db.select().from(contractorProjectLinks)
    .where(eq(contractorProjectLinks.contractorId, contractorId));

  const projectIdSet = new Set(links.map(l => l.projectId));
  const projectIds = Array.from(projectIdSet);
  const relatedProjects = projectIds.length > 0
    ? await db.select().from(projects).where(inArray(projects.id, projectIds.slice(0, 20)))
    : [];

  const pairingsA = await db.select().from(contractorPairings)
    .where(eq(contractorPairings.companyAId, contractorId));
  const pairingsB = await db.select().from(contractorPairings)
    .where(eq(contractorPairings.companyBId, contractorId));

  return {
    ...contractor,
    projectLinks: links,
    relatedProjects: relatedProjects.map(p => ({
      id: p.id,
      name: p.name,
      sector: p.sector,
      location: p.location,
      priority: p.priority,
      stage: p.stage,
    })),
    pairings: [...pairingsA, ...pairingsB].sort((a, b) => b.coOccurrenceCount - a.coOccurrenceCount),
  };
}

export async function getActivePatterns() {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  return db.select().from(emergingPatterns)
    .where(eq(emergingPatterns.isActive, true))
    .orderBy(desc(emergingPatterns.detectedAt))
    .limit(20);
}
