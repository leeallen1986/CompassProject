/**
 * Role Relevance Scoring Module
 *
 * Classifies contacts into high/medium/low relevance for Atlas Copco
 * Power Technique equipment procurement decisions.
 *
 * High relevance: People who directly influence temporary equipment
 *   decisions (construction managers, project managers, procurement
 *   managers, site managers, maintenance managers, engineering managers,
 *   operations managers, fleet managers).
 *
 * Medium relevance: People who indirectly influence or approve equipment
 *   decisions (project directors, commercial managers, contracts managers,
 *   plant managers, HSE managers).
 *
 * Low relevance: Corporate executives and roles that rarely influence
 *   temporary equipment decisions (CEO, director, CFO, corporate
 *   leadership, HR, marketing, legal).
 *
 * The scoring uses both the roleBucket field and the raw title/headline
 * for maximum accuracy.
 */

import { eq, sql, or, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { contacts } from "../drizzle/schema";

// ── Role Relevance Classification ──

export type RoleRelevance = "high" | "medium" | "low";

/**
 * High-relevance title keywords — these people directly influence
 * equipment procurement or rental decisions on site.
 */
const HIGH_RELEVANCE_KEYWORDS = [
  // Construction & site roles
  "construction manager",
  "construction superintendent",
  "construction director",
  "site manager",
  "site superintendent",
  "site supervisor",
  "site engineer",
  // Project delivery roles
  "project manager",
  "project engineer",
  "project superintendent",
  "project coordinator",
  // Procurement & supply chain
  "procurement manager",
  "procurement officer",
  "procurement lead",
  "supply chain manager",
  "purchasing manager",
  "buying manager",
  "contracts manager",
  "contracts administrator",
  // Engineering & technical
  "engineering manager",
  "chief engineer",
  "mechanical engineer",
  "electrical engineer",
  "civil engineer",
  "design engineer",
  // Operations & maintenance
  "operations manager",
  "operations superintendent",
  "maintenance manager",
  "maintenance superintendent",
  "maintenance planner",
  "reliability manager",
  "reliability engineer",
  // Fleet & equipment
  "fleet manager",
  "equipment manager",
  "plant manager",
  "plant superintendent",
  // Mining-specific
  "mining manager",
  "mine manager",
  "mining engineer",
  "drill and blast",
  "open cut manager",
  "underground manager",
];

/**
 * Medium-relevance title keywords — these people have indirect influence
 * or approval authority over equipment decisions.
 */
const MEDIUM_RELEVANCE_KEYWORDS = [
  "project director",
  "commercial manager",
  "commercial director",
  "business development manager",
  "estimating manager",
  "estimator",
  "quantity surveyor",
  "cost manager",
  "planning manager",
  "scheduling manager",
  "hse manager",
  "safety manager",
  "environment manager",
  "commissioning manager",
  "commissioning engineer",
  "technical director",
  "technical manager",
  "general manager operations",
  "gm operations",
  "head of operations",
  "head of projects",
  "head of engineering",
  "head of procurement",
  "head of construction",
  "vp operations",
  "vp engineering",
  "vp construction",
  "facilities manager",
  "logistics manager",
  "warehouse manager",
  "shutdown manager",
  "turnaround manager",
  "outage manager",
];

/**
 * Low-relevance title keywords — corporate executives and roles that
 * rarely influence temporary equipment decisions.
 */
const LOW_RELEVANCE_KEYWORDS = [
  "chief executive",
  "ceo",
  "managing director",
  "chairman",
  "board member",
  "non-executive director",
  "chief financial officer",
  "cfo",
  "chief operating officer",
  "coo",
  "chief technology officer",
  "cto",
  "chief information officer",
  "chief people officer",
  "chief marketing officer",
  "chief legal officer",
  "general counsel",
  "company secretary",
  "director of finance",
  "finance director",
  "finance manager",
  "financial controller",
  "head of finance",
  "head of hr",
  "head of legal",
  "head of marketing",
  "head of communications",
  "head of investor relations",
  "investor relations",
  "human resources",
  "hr manager",
  "hr director",
  "marketing manager",
  "marketing director",
  "communications manager",
  "media manager",
  "public relations",
  "legal counsel",
  "legal manager",
  "compliance manager",
  "audit manager",
  "tax manager",
  "treasury manager",
  "corporate affairs",
  "government relations",
  "sustainability manager",
  "esg manager",
  "community relations",
  "stakeholder engagement",
];

/**
 * Role bucket to relevance mapping — used as a fallback when title
 * keywords don't produce a clear match.
 */
const ROLE_BUCKET_RELEVANCE: Record<string, RoleRelevance> = {
  procurement: "high",
  project_manager: "high",
  engineering: "high",
  operations: "high",
  maintenance: "high",
  site_manager: "high",
  fleet_manager: "high",
  construction_manager: "high",
  mining_manager: "high",
  plant_manager: "medium",
  commercial: "medium",
  general_manager: "low",
  other: "low",
};

// ── Word-boundary matching ──

/**
 * Short abbreviations like "ceo", "cfo", "cto", "coo" can produce false
 * positives with simple `includes()` (e.g. "dire**cto**r" matches "cto",
 * "c**oo**rdinator" matches "coo"). We use word-boundary regex for
 * keywords ≤ 4 characters and plain `includes()` for longer keywords.
 */
const SHORT_KEYWORD_THRESHOLD = 4;

const keywordRegexCache = new Map<string, RegExp>();

function matchesKeyword(text: string, keyword: string): boolean {
  if (keyword.length <= SHORT_KEYWORD_THRESHOLD) {
    let re = keywordRegexCache.get(keyword);
    if (!re) {
      re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      keywordRegexCache.set(keyword, re);
    }
    return re.test(text);
  }
  return text.includes(keyword);
}

// ── Scoring Function ──

/**
 * Classify a contact's role relevance based on their title and roleBucket.
 *
 * Priority order:
 * 1. Check title/headline against HIGH keywords → "high"
 * 2. Check title/headline against LOW keywords → "low"
 * 3. Check title/headline against MEDIUM keywords → "medium"
 * 4. Fall back to roleBucket mapping
 * 5. Default to "medium" if nothing matches
 *
 * We check LOW before MEDIUM because some titles like "General Manager"
 * could match medium keywords but should be low (corporate exec).
 * However, "General Manager Operations" should be medium, so we check
 * HIGH first to catch the specific operational roles.
 */
export function classifyRoleRelevance(
  title: string | null | undefined,
  roleBucket: string | null | undefined,
): RoleRelevance {
  const titleLower = (title || "").toLowerCase().trim();
  const bucketLower = (roleBucket || "").toLowerCase().trim();

  // Step 1: Check HIGH keywords first (most specific operational roles)
  if (titleLower) {
    for (const keyword of HIGH_RELEVANCE_KEYWORDS) {
      if (matchesKeyword(titleLower, keyword)) return "high";
    }
  }

  // Step 2: Check LOW keywords (corporate executives)
  if (titleLower) {
    for (const keyword of LOW_RELEVANCE_KEYWORDS) {
      if (matchesKeyword(titleLower, keyword)) return "low";
    }
  }

  // Step 3: Check MEDIUM keywords
  if (titleLower) {
    for (const keyword of MEDIUM_RELEVANCE_KEYWORDS) {
      if (matchesKeyword(titleLower, keyword)) return "medium";
    }
  }

  // Step 4: Fallback to roleBucket mapping
  if (bucketLower && ROLE_BUCKET_RELEVANCE[bucketLower]) {
    return ROLE_BUCKET_RELEVANCE[bucketLower];
  }

  // Step 5: Default — if we have a title with "manager" or "engineer" it's likely medium+
  if (titleLower.includes("manager") || titleLower.includes("engineer") || titleLower.includes("superintendent")) {
    return "medium";
  }

  // If title contains "director" without operational context, it's likely low
  if (titleLower.includes("director")) {
    return "low";
  }

  return "medium";
}

// ── Bulk Classification ──

/**
 * Classify all contacts that don't have a roleRelevance value yet.
 * Uses both the title and roleBucket fields.
 */
const ROLE_RELEVANCE_BATCH_SIZE = 5000; // Max contacts to classify per pipeline run

export async function classifyAllContactRelevance(
  batchSize: number = ROLE_RELEVANCE_BATCH_SIZE
): Promise<{
  total: number;
  classified: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Only fetch unclassified contacts (or re-classify all if batchSize is large)
  // Fetch in batches to avoid loading 26k+ rows into memory
  const unclassifiedContacts = await db
    .select({
      id: contacts.id,
      title: contacts.title,
      roleBucket: contacts.roleBucket,
      linkedinHeadline: contacts.linkedinHeadline,
    })
    .from(contacts)
    .where(isNull(contacts.roleRelevance))
    .limit(batchSize);

  if (unclassifiedContacts.length === 0) {
    // All contacts already classified — get current distribution
    const dist = await getRoleRelevanceDistribution();
    return {
      total: dist.total,
      classified: dist.total - dist.unclassified,
      highCount: dist.high,
      mediumCount: dist.medium,
      lowCount: dist.low,
    };
  }

  // Classify all fetched contacts in memory (fast — pure JS, no DB round-trips)
  const highIds: number[] = [];
  const mediumIds: number[] = [];
  const lowIds: number[] = [];

  for (const contact of unclassifiedContacts) {
    const titleToUse = contact.linkedinHeadline || contact.title;
    const relevance = classifyRoleRelevance(titleToUse, contact.roleBucket);
    if (relevance === "high") highIds.push(contact.id);
    else if (relevance === "medium") mediumIds.push(contact.id);
    else lowIds.push(contact.id);
  }

  // Bulk UPDATE — 3 queries instead of N queries
  const CHUNK = 1000; // MySQL IN clause limit safety
  const dbConn = db; // Capture non-null reference for use in closure
  async function bulkUpdate(ids: number[], relevance: "high" | "medium" | "low") {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      if (chunk.length === 0) continue;
      await dbConn
        .update(contacts)
        .set({ roleRelevance: relevance })
        .where(sql`${contacts.id} IN (${sql.join(chunk.map(id => sql`${id}`), sql`, `)})`);
    }
  }

  await Promise.all([
    bulkUpdate(highIds, "high"),
    bulkUpdate(mediumIds, "medium"),
    bulkUpdate(lowIds, "low"),
  ]);

  console.log(`[RoleRelevance] Classified ${unclassifiedContacts.length} contacts: ${highIds.length} high, ${mediumIds.length} medium, ${lowIds.length} low`);

  return {
    total: unclassifiedContacts.length,
    classified: unclassifiedContacts.length,
    highCount: highIds.length,
    mediumCount: mediumIds.length,
    lowCount: lowIds.length,
  };
}

/**
 * Get the role relevance distribution across all contacts.
 */
export async function getRoleRelevanceDistribution(): Promise<{
  high: number;
  medium: number;
  low: number;
  unclassified: number;
  total: number;
}> {
  const db = await getDb();
  if (!db) return { high: 0, medium: 0, low: 0, unclassified: 0, total: 0 };

  const [highResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contacts)
    .where(eq(contacts.roleRelevance, "high"));

  const [mediumResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contacts)
    .where(eq(contacts.roleRelevance, "medium"));

  const [lowResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contacts)
    .where(eq(contacts.roleRelevance, "low"));

  const [unclassifiedResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contacts)
    .where(isNull(contacts.roleRelevance));

  const [totalResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contacts);

  return {
    high: Number(highResult.count),
    medium: Number(mediumResult.count),
    low: Number(lowResult.count),
    unclassified: Number(unclassifiedResult.count),
    total: Number(totalResult.count),
  };
}

/**
 * Classify a single contact's role relevance and update the database.
 */
export async function classifySingleContactRelevance(contactId: number): Promise<RoleRelevance> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [contact] = await db
    .select({
      title: contacts.title,
      roleBucket: contacts.roleBucket,
      linkedinHeadline: contacts.linkedinHeadline,
    })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!contact) throw new Error(`Contact ${contactId} not found`);

  const titleToUse = contact.linkedinHeadline || contact.title;
  const relevance = classifyRoleRelevance(titleToUse, contact.roleBucket);

  await db
    .update(contacts)
    .set({ roleRelevance: relevance })
    .where(eq(contacts.id, contactId));

  return relevance;
}

/**
 * Get projects with fewer than N high/medium-relevance contacts.
 * Used by the second-pass search to identify gaps.
 */
export async function getProjectsWithFewRelevantContacts(
  minRelevantContacts: number = 2,
): Promise<{
  projectId: number;
  projectName: string;
  owner: string;
  sector: string;
  location: string;
  stage: string | null;
  relevantContactCount: number;
  totalContactCount: number;
}[]> {
  const db = await getDb();
  if (!db) return [];

  // Get all active projects with their relevant contact counts
  const projectsWithCounts = await db.execute(sql`
    SELECT 
      p.id as projectId,
      p.name as projectName,
      p.owner,
      p.sector,
      p.location,
      p.stage,
      COUNT(c.id) as totalContactCount,
      SUM(CASE WHEN c.roleRelevance IN ('high', 'medium') THEN 1 ELSE 0 END) as relevantContactCount
    FROM projects p
    LEFT JOIN contacts c ON c.project = p.name
    WHERE p.lifecycleStatus = 'active'
    GROUP BY p.id, p.name, p.owner, p.sector, p.location, p.stage
    HAVING relevantContactCount < ${minRelevantContacts}
    ORDER BY relevantContactCount ASC, p.id ASC
  `);

  return (projectsWithCounts as any[]).map((row: any) => ({
    projectId: row.projectId,
    projectName: row.projectName,
    owner: row.owner || "Unknown",
    sector: row.sector || "infrastructure",
    location: row.location || "Australia",
    stage: row.stage || null,
    relevantContactCount: Number(row.relevantContactCount),
    totalContactCount: Number(row.totalContactCount),
  }));
}

// ── Exports for testing ──

export {
  HIGH_RELEVANCE_KEYWORDS,
  MEDIUM_RELEVANCE_KEYWORDS,
  LOW_RELEVANCE_KEYWORDS,
  ROLE_BUCKET_RELEVANCE,
};
