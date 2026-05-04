/**
 * Contact Waterfall Engine
 *
 * Implements the verified contact recovery waterfall for hot and warm projects.
 *
 * Source priority (highest → lowest):
 *   1. Apollo (verified email, project-linked)
 *   2. Web search / LinkedIn public match (named, email may be missing)
 *   3. Projectory stakeholders (named, often has email)
 *   4. Hunter fallback (email finder/verifier for already-named contacts)
 *   5. LLM inference (suggested stakeholders only — never primary)
 *
 * Role lanes relevant to Atlas Copco PT Capital Sales:
 *   - primary:    Project Manager, Project Director, Site Manager, Construction Manager
 *   - commercial: Procurement Manager, Commercial Manager, Contracts Manager, Purchasing
 *   - technical:  Operations Manager, Maintenance Manager, Project Engineer, Site Engineer,
 *                 Rental/Hire Manager, Equipment Manager, Plant Manager
 *   - backup:     Any other named contact linked to the project
 *
 * Candidate slate per project:
 *   slot 1: primary  — highest confidence, send_ready preferred
 *   slot 2: backup_1 — second-best overall
 *   slot 3: backup_2 — third-best overall
 *   slot 4: commercial — best procurement/commercial contact
 *   slot 5: technical  — best operations/maintenance/engineering contact
 */

import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  contacts,
  contactProjects,
  contactCandidateSlates,
  type SlotSnapshot,
} from "../drizzle/schema";

// ── Role Lane Classification ──

const PRIMARY_ROLE_KEYWORDS = [
  "project manager", "project director", "site manager", "construction manager",
  "project superintendent", "site superintendent", "project lead", "project head",
  "general manager", "operations director", "country manager", "regional manager",
  "managing director", "executive", "vp ", "vice president", "director",
];

const COMMERCIAL_ROLE_KEYWORDS = [
  "procurement", "commercial", "contracts manager", "contract manager",
  "purchasing", "supply chain", "category manager", "sourcing",
  "tendering", "bid manager", "estimator", "cost manager",
];

const TECHNICAL_ROLE_KEYWORDS = [
  "operations manager", "operations", "maintenance manager", "maintenance",
  "project engineer", "site engineer", "engineering manager", "plant manager",
  "equipment manager", "fleet manager", "hire manager", "rental manager",
  "mechanical engineer", "electrical engineer", "process engineer",
  "technical manager", "asset manager", "facilities manager",
];

export type RoleLane = "primary" | "commercial" | "technical" | "backup";

export function classifyRoleLane(title: string): RoleLane {
  const t = title.toLowerCase();

  // Check commercial first (procurement often has "manager" which would match primary)
  for (const kw of COMMERCIAL_ROLE_KEYWORDS) {
    if (t.includes(kw)) return "commercial";
  }
  for (const kw of PRIMARY_ROLE_KEYWORDS) {
    if (t.includes(kw)) return "primary";
  }
  for (const kw of TECHNICAL_ROLE_KEYWORDS) {
    if (t.includes(kw)) return "technical";
  }
  return "backup";
}

// ── Contact Scoring ──

interface ScoredContact {
  id: number;
  name: string;
  title: string;
  company: string;
  email: string | null;
  linkedin: string | null;
  enrichmentSource: string | null;
  contactTrustTier: "send_ready" | "named_unverified" | "llm_inferred";
  confidenceScore: string | null;
  roleRelevance: string | null;
  roleLane: RoleLane;
  compositeScore: number;
}

function scoreContact(c: {
  id: number;
  name: string;
  title: string;
  company: string;
  email: string | null;
  linkedin: string | null;
  enrichmentSource: string | null;
  contactTrustTier: "send_ready" | "named_unverified" | "llm_inferred" | null;
  confidenceScore: "high" | "medium" | "low" | null;
  roleRelevance: "high" | "medium" | "low" | null;
}): ScoredContact {
  let score = 0;

  // Trust tier (0-40 points)
  if (c.contactTrustTier === "send_ready") score += 40;
  else if (c.contactTrustTier === "named_unverified") score += 20;
  else score += 0; // llm_inferred

  // Email present (0-20 points)
  if (c.email) score += 20;

  // LinkedIn present (0-10 points)
  if (c.linkedin) score += 10;

  // Confidence score (0-15 points)
  if (c.confidenceScore === "high") score += 15;
  else if (c.confidenceScore === "medium") score += 8;
  else score += 2;

  // Role relevance (0-15 points)
  if (c.roleRelevance === "high") score += 15;
  else if (c.roleRelevance === "medium") score += 8;
  else score += 2;

  const roleLane = classifyRoleLane(c.title || "");

  return {
    id: c.id,
    name: c.name,
    title: c.title,
    company: c.company,
    email: c.email,
    linkedin: c.linkedin,
    enrichmentSource: c.enrichmentSource,
    contactTrustTier: (c.contactTrustTier || "named_unverified") as "send_ready" | "named_unverified" | "llm_inferred",
    confidenceScore: c.confidenceScore,
    roleRelevance: c.roleRelevance,
    roleLane,
    compositeScore: score,
  };
}

function toSnapshot(c: ScoredContact, lane: RoleLane): SlotSnapshot {
  return {
    contactId: c.id,
    name: c.name,
    title: c.title,
    company: c.company,
    email: c.email,
    linkedin: c.linkedin,
    enrichmentSource: c.enrichmentSource || "unknown",
    contactTrustTier: c.contactTrustTier,
    confidenceScore: c.confidenceScore || "medium",
    roleRelevance: c.roleRelevance || "medium",
    roleLane: lane,
  };
}

// ── Slate Generation ──

export interface CandidateSlate {
  projectId: number;
  primary: ScoredContact | null;
  backup1: ScoredContact | null;
  backup2: ScoredContact | null;
  commercial: ScoredContact | null;
  technical: ScoredContact | null;
  totalSlotsFilled: number;
  sendReadySlots: number;
  namedUnverifiedSlots: number;
  llmSlots: number;
  sourcesUsed: string[];
}

export async function generateCandidateSlate(
  projectId: number
): Promise<CandidateSlate> {
  const db = await getDb();
  if (!db) {
    return {
      projectId,
      primary: null, backup1: null, backup2: null,
      commercial: null, technical: null,
      totalSlotsFilled: 0, sendReadySlots: 0,
      namedUnverifiedSlots: 0, llmSlots: 0,
      sourcesUsed: [],
    };
  }

  // Fetch all contacts linked to this project
  const rows = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      title: contacts.title,
      company: contacts.company,
      email: contacts.email,
      linkedin: contacts.linkedin,
      enrichmentSource: contacts.enrichmentSource,
      contactTrustTier: contacts.contactTrustTier,
      confidenceScore: contacts.confidenceScore,
      roleRelevance: contacts.roleRelevance,
    })
    .from(contacts)
    .innerJoin(contactProjects, eq(contactProjects.contactId, contacts.id))
    .where(eq(contactProjects.projectId, projectId));

  if (rows.length === 0) {
    return {
      projectId,
      primary: null, backup1: null, backup2: null,
      commercial: null, technical: null,
      totalSlotsFilled: 0, sendReadySlots: 0,
      namedUnverifiedSlots: 0, llmSlots: 0,
      sourcesUsed: [],
    };
  }

  // Score all contacts
  const scored = rows.map(r => scoreContact(r as any));

  // Separate by lane
  const primaryLane = scored.filter(c => c.roleLane === "primary");
  const commercialLane = scored.filter(c => c.roleLane === "commercial");
  const technicalLane = scored.filter(c => c.roleLane === "technical");
  const allSorted = [...scored].sort((a, b) => b.compositeScore - a.compositeScore);

  // Sort each lane by composite score
  const sortByScore = (arr: ScoredContact[]) =>
    [...arr].sort((a, b) => b.compositeScore - a.compositeScore);

  const sortedPrimary = sortByScore(primaryLane);
  const sortedCommercial = sortByScore(commercialLane);
  const sortedTechnical = sortByScore(technicalLane);

  // Assign slots
  // Primary: best primary-lane contact, fallback to best overall
  const primaryContact = sortedPrimary[0] || allSorted[0] || null;
  const usedIds = new Set<number>(primaryContact ? [primaryContact.id] : []);

  // Commercial: best commercial-lane contact not already used
  const commercialContact = sortedCommercial.find(c => !usedIds.has(c.id)) || null;
  if (commercialContact) usedIds.add(commercialContact.id);

  // Technical: best technical-lane contact not already used
  const technicalContact = sortedTechnical.find(c => !usedIds.has(c.id)) || null;
  if (technicalContact) usedIds.add(technicalContact.id);

  // Backup slots: next two best overall contacts not already used
  const backupPool = allSorted.filter(c => !usedIds.has(c.id));
  const backup1 = backupPool[0] || null;
  if (backup1) usedIds.add(backup1.id);
  const backup2 = backupPool[1] || null;

  // Collect sources used
  const sourceSet = new Set(
    scored
      .filter(c => [primaryContact, backup1, backup2, commercialContact, technicalContact]
        .some(s => s?.id === c.id))
      .map(c => c.enrichmentSource || "unknown")
  );
  const sourcesUsed = Array.from(sourceSet);

  // Count tiers across filled slots
  const filledSlots = [primaryContact, backup1, backup2, commercialContact, technicalContact]
    .filter(Boolean) as ScoredContact[];

  const sendReadySlots = filledSlots.filter(c => c.contactTrustTier === "send_ready").length;
  const namedUnverifiedSlots = filledSlots.filter(c => c.contactTrustTier === "named_unverified").length;
  const llmSlots = filledSlots.filter(c => c.contactTrustTier === "llm_inferred").length;

  return {
    projectId,
    primary: primaryContact,
    backup1,
    backup2,
    commercial: commercialContact,
    technical: technicalContact,
    totalSlotsFilled: filledSlots.length,
    sendReadySlots,
    namedUnverifiedSlots,
    llmSlots,
    sourcesUsed,
  };
}

// ── Persist Slate to DB ──

export async function saveCandidateSlate(slate: CandidateSlate): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const values = {
    projectId: slate.projectId,
    primaryContactId: slate.primary?.id || null,
    backup1ContactId: slate.backup1?.id || null,
    backup2ContactId: slate.backup2?.id || null,
    commercialContactId: slate.commercial?.id || null,
    technicalContactId: slate.technical?.id || null,
    primarySnapshot: slate.primary ? toSnapshot(slate.primary, "primary") : null,
    backup1Snapshot: slate.backup1 ? toSnapshot(slate.backup1, "backup") : null,
    backup2Snapshot: slate.backup2 ? toSnapshot(slate.backup2, "backup") : null,
    commercialSnapshot: slate.commercial ? toSnapshot(slate.commercial, "commercial") : null,
    technicalSnapshot: slate.technical ? toSnapshot(slate.technical, "technical") : null,
    totalSlotsFilled: slate.totalSlotsFilled,
    sendReadySlots: slate.sendReadySlots,
    namedUnverifiedSlots: slate.namedUnverifiedSlots,
    llmSlots: slate.llmSlots,
    sourcesUsed: slate.sourcesUsed,
    generatedAt: new Date(),
    generatedBy: "waterfall_engine" as const,
    isStale: false,
    staleSince: null,
  };

  // Upsert: delete existing slate for this project, then insert fresh
  await db
    .delete(contactCandidateSlates)
    .where(eq(contactCandidateSlates.projectId, slate.projectId));

  await db.insert(contactCandidateSlates).values(values);
}

// ── Batch: Generate slates for top-N hot/warm projects ──

export interface BatchSlateResult {
  projectId: number;
  projectName: string;
  slate: CandidateSlate;
  status: "generated" | "failed";
  error?: string;
}

export async function generateSlatesForTopProjects(
  projectIds: number[]
): Promise<BatchSlateResult[]> {
  const db = await getDb();
  if (!db) return [];

  // Fetch project names
  const { projects } = await import("../drizzle/schema");
  const projectRows = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(inArray(projects.id, projectIds));

  const nameMap = new Map(projectRows.map(p => [p.id, p.name || `Project ${p.id}`]));

  const results: BatchSlateResult[] = [];

  for (const projectId of projectIds) {
    try {
      const slate = await generateCandidateSlate(projectId);
      await saveCandidateSlate(slate);
      results.push({
        projectId,
        projectName: nameMap.get(projectId) || `Project ${projectId}`,
        slate,
        status: "generated",
      });
    } catch (err: any) {
      results.push({
        projectId,
        projectName: nameMap.get(projectId) || `Project ${projectId}`,
        slate: {
          projectId,
          primary: null, backup1: null, backup2: null,
          commercial: null, technical: null,
          totalSlotsFilled: 0, sendReadySlots: 0,
          namedUnverifiedSlots: 0, llmSlots: 0,
          sourcesUsed: [],
        },
        status: "failed",
        error: err.message,
      });
    }
  }

  return results;
}
