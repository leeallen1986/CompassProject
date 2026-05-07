/**
 * Contact Discovery Queue Engine
 *
 * Event-driven, priority-queued contact discovery that automatically triggers
 * discovery for in-scope important projects.
 *
 * Priority tiers:
 *   A — hot, live tender, manually actioned/claimed, digest/This Week candidates
 *   B — warm, strategic projects with strong contractor/work-package data
 *   C — backlog, cold, monitor-only
 *
 * Owner-type routing:
 *   private owner     → Apollo waterfall (search → enrich → save)
 *   government/public → government fallback discovery (web search for named contacts)
 *   unknown/dirty     → blocked + cleanup path
 *   contractor known  → dual enrich (owner + principal contractor)
 *
 * Discovery states (on projects table):
 *   no_contacts → discovery_queued → discovery_running → send_ready_contact
 *                                                      → named_contact_no_email
 *                                                      → role_only
 *                                                      → blocked_*
 */

import { eq, and, sql, isNull, or, inArray, desc, asc, lte } from "drizzle-orm";
import { getDb } from "./db";
import { projects, contacts, contactProjects } from "../drizzle/schema";
import { enrichProjectContacts } from "./apolloEnrichment";
import { enrichContactsForProject, generateAndEnrichContacts } from "./contactEnrichment";
import { generateAndSaveLLMContacts } from "./llmContactFallback";
import { verifyProjectContactsWithHunter } from "./hunterVerification";
import { ENV } from "./_core/env";

// ── Constants ──

/** Max projects to process per queue run (prevents runaway) */
const MAX_BATCH_SIZE = 50; // Fix 3: Raised from 20 to 50 to clear backlog faster

/** Cooldown: don't re-attempt discovery within this window (hours) */
const DISCOVERY_COOLDOWN_HOURS = 72;

/** Max attempts before giving up on a project */
const MAX_DISCOVERY_ATTEMPTS = 3;

// ── CRM junk exclusion (shared with db.ts) ──

const CRM_JUNK_WHERE = sql`(
  c.roleBucket IS NULL
  OR c.roleBucket NOT REGEXP '^[0-9+() -]+$'
)
AND (
  c.email IS NULL
  OR (
    c.email NOT LIKE '%portal.invoices%'
    AND c.email NOT LIKE '%atlascopco.com'
    AND c.email NOT LIKE '%noreply%'
    AND c.email NOT LIKE '%no-reply%'
  )
)
AND c.enrichmentSource != 'manual'`;

// ── Types ──

export type DiscoveryPriority = "A" | "B" | "C";
export type DiscoveryStatus =
  | "no_contacts"
  | "discovery_queued"
  | "discovery_running"
  | "role_only"
  | "named_contact_no_email"
  | "send_ready_contact"
  | "blocked_government_owner"
  | "blocked_dirty_owner"
  | "blocked_no_usable_domain";

export type OwnerType = "private" | "government" | "unknown" | "contractor_desc";

export interface DiscoveryResult {
  projectId: number;
  projectName: string;
  previousStatus: DiscoveryStatus | null;
  newStatus: DiscoveryStatus;
  priority: DiscoveryPriority;
  ownerType: OwnerType;
  contactsFound: number;
  sendReadyContacts: number;
  namedContacts: number;
  roleOnlyContacts: number;
  providersUsed: string[];
  durationMs: number;
  error?: string;
}

export interface QueueRunResult {
  processed: number;
  priorityA: number;
  priorityB: number;
  priorityC: number;
  newSendReady: number;
  newNamedNoEmail: number;
  newRoleOnly: number;
  blocked: number;
  failed: number;
  results: DiscoveryResult[];
}

// ── Owner Classification ──

const GOV_PATTERNS = [
  /\bgov(ernment)?\b/i, /\bcouncil\b/i, /\bshire\b/i, /\bauthority\b/i,
  /\bdepartment\b/i, /\bministry\b/i, /\bcommission\b/i, /\bcorporation\b.*\b(state|public|water|rail|road|port)\b/i,
  /\bdefence?\b/i, /\bnavy\b/i, /\barmy\b/i, /\bair force\b/i,
  /\bmain roads\b/i, /\bwater corp/i, /\btransport.*nsw\b/i,
  /\binfrastructure.*australia\b/i, /\bsnowy hydro\b/i,
  /\bqueensland rail\b/i, /\bsydney (metro|trains|water)\b/i,
  /\bmelbourne water\b/i, /\bsa water\b/i, /\bpower ?water\b/i,
  /\bcsiro\b/i, /\baciar\b/i, /\bgeoscience australia\b/i,
  /\buniversity\b/i, /\btafe\b/i,
];

const CONTRACTOR_DESC_PATTERNS = [
  /^(various|multiple|tbc|tba|unknown|n\/a|not specified|to be confirmed)/i,
  /\b(scope|works?|services?|construction of|supply of|installation of)\b/i,
];

export function classifyOwnerType(owner: string): OwnerType {
  if (!owner || owner.trim().length < 2) return "unknown";
  const trimmed = owner.trim();
  if (CONTRACTOR_DESC_PATTERNS.some(p => p.test(trimmed))) return "contractor_desc";
  if (GOV_PATTERNS.some(p => p.test(trimmed))) return "government";
  return "private";
}

// ── Priority Classification ──

export function classifyDiscoveryPriority(project: {
  priority: string | null;
  sourcePurpose?: string | null;
  actionTier?: string | null;
  tenderCloseDate?: Date | null;
}): DiscoveryPriority {
  // Priority A: hot, live tender, actioned, digest candidates
  if (project.priority === "hot") return "A";
  if (project.sourcePurpose === "live_tender") return "A";
  if (project.actionTier === "tier1_actionable") return "A";
  if (project.tenderCloseDate) {
    const daysUntilClose = (project.tenderCloseDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysUntilClose <= 14 && daysUntilClose > 0) return "A";
  }

  // Priority B: warm, strategic
  if (project.priority === "warm") return "B";
  if (project.actionTier === "tier2_warm") return "B";

  // Priority C: everything else
  return "C";
}

// ── Usable Contact Assessment ──

async function assessContactState(
  db: any,
  projectId: number
): Promise<{ total: number; sendReady: number; named: number; roleOnly: number }> {
  // Count usable contacts using contactTrustTier (three-tier trust model)
  // send_ready tier = verified email + project linked + non-LLM source
  // named_unverified tier = named person but email missing/unverified
  // llm_inferred tier = LLM-generated, never counts as sendReady
  const rawSql = `
    SELECT
      COUNT(DISTINCT c.id) as total,
      COUNT(DISTINCT CASE
        WHEN c.contactTrustTier = 'send_ready'
        THEN c.id END) as sendReady,
      COUNT(DISTINCT CASE
        WHEN c.contactTrustTier = 'named_unverified'
        THEN c.id END) as namedNoEmail,
      COUNT(DISTINCT CASE
        WHEN c.name IS NULL OR c.name = '' OR c.name LIKE '%Manager%' OR c.name LIKE '%Director%'
        THEN c.id END) as roleOnly
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    WHERE cp.projectId = ?
      AND (c.roleBucket IS NULL OR c.roleBucket NOT REGEXP '^[0-9+() -]+$')
      AND (c.email IS NULL OR (c.email NOT LIKE '%portal.invoices%' AND c.email NOT LIKE '%atlascopco.com' AND c.email NOT LIKE '%noreply%' AND c.email NOT LIKE '%no-reply%'))
      AND c.enrichmentSource != 'manual'
  `;
  const [rows] = await db.execute(sql.raw(rawSql.replace('?', String(projectId))));
  const result = Array.isArray(rows) ? rows[0] : rows;

  return {
    total: Number(result?.total || 0),
    sendReady: Number(result?.sendReady || 0),
    named: Number(result?.namedNoEmail || 0),
    roleOnly: Number(result?.roleOnly || 0),
  };
}

export function deriveDiscoveryStatus(
  ownerType: OwnerType,
  contactState: { sendReady: number; named: number; roleOnly: number }
): DiscoveryStatus {
  // Check blocked states first
  if (ownerType === "government" && contactState.sendReady === 0 && contactState.named === 0) {
    return "blocked_government_owner";
  }
  if (ownerType === "contractor_desc" && contactState.sendReady === 0) {
    return "blocked_dirty_owner";
  }
  if (ownerType === "unknown" && contactState.sendReady === 0) {
    return "blocked_no_usable_domain";
  }

  // Check contact quality
  if (contactState.sendReady > 0) return "send_ready_contact";
  if (contactState.named > 0) return "named_contact_no_email";
  if (contactState.roleOnly > 0) return "role_only";
  return "no_contacts";
}

// ── Trigger: Should Discovery Run? ──

export function shouldTriggerDiscovery(project: {
  discoveryStatus?: string | null;
  discoveryPriority?: string | null;
  lastDiscoveryAt?: Date | string | null;
  discoveryAttempts?: number | null;
  projectCountry?: string | null;
  geoBlockedReason?: string | null;
  suppressed?: boolean | null;
  projectType?: string | null;
  matchedBusinessLines?: any;
  priority?: string | null;
}): { trigger: boolean; reason: string } {
  // Must be Australian / in-scope
  if (project.geoBlockedReason) return { trigger: false, reason: "geo_blocked" };
  if (project.projectCountry && project.projectCountry !== "AU") return { trigger: false, reason: "non_australian" };
  if (project.suppressed) return { trigger: false, reason: "suppressed" };
  if (project.projectType && project.projectType !== "opportunity") return { trigger: false, reason: "not_opportunity" };

  // Must have BL match
  const bls = Array.isArray(project.matchedBusinessLines) ? project.matchedBusinessLines : [];
  if (bls.length === 0) return { trigger: false, reason: "no_bl_match" };

  // Already send-ready — no need
  if (project.discoveryStatus === "send_ready_contact") return { trigger: false, reason: "already_send_ready" };

  // Already running
  if (project.discoveryStatus === "discovery_running") return { trigger: false, reason: "already_running" };

  // Max attempts reached
  if ((project.discoveryAttempts || 0) >= MAX_DISCOVERY_ATTEMPTS) {
    return { trigger: false, reason: "max_attempts_reached" };
  }

  // Cooldown check
  // Fix 4: Handle lastDiscoveryAt as either Date object or string (raw SQL returns strings)
  if (project.lastDiscoveryAt) {
    const lastDiscoveryTime = project.lastDiscoveryAt instanceof Date
      ? project.lastDiscoveryAt.getTime()
      : new Date(project.lastDiscoveryAt).getTime();
    if (!isNaN(lastDiscoveryTime)) {
      const hoursSince = (Date.now() - lastDiscoveryTime) / (1000 * 60 * 60);
      if (hoursSince < DISCOVERY_COOLDOWN_HOURS) {
        return { trigger: false, reason: `cooldown_${Math.round(hoursSince)}h_of_${DISCOVERY_COOLDOWN_HOURS}h` };
      }
    }
  }

  return { trigger: true, reason: "eligible" };
}

// ── Core: Run Discovery for One Project ──

async function runDiscoveryForProject(
  db: any,
  project: any,
  reportId: number
): Promise<DiscoveryResult> {
  const startTime = Date.now();
  const ownerType = classifyOwnerType(project.owner || "");
  const priority = classifyDiscoveryPriority(project);
  const previousStatus = project.discoveryStatus || "no_contacts";
  const providersUsed: string[] = [];

  // Mark as running
  await db.update(projects).set({
    discoveryStatus: "discovery_running",
    discoveryPriority: priority,
    lastDiscoveryAt: new Date(),
    discoveryAttempts: (project.discoveryAttempts || 0) + 1,
  }).where(eq(projects.id, project.id));

  try {
    // ── Route by owner type ──

    if (ownerType === "private") {
      // Step 1: Apollo waterfall (search → enrich)
      try {
        const apolloResult = await enrichProjectContacts(project.id, reportId, {
          enrichEmails: true,
          maxPerCompany: 5,
        });
        if (apolloResult.people.length > 0) providersUsed.push("apollo");
      } catch (e: any) {
        console.warn(`[Discovery] Apollo failed for project ${project.id}: ${e.message}`);
      }

      // Step 2: LinkedIn people search (creates contacts AND links them to project)
      try {
        const contractors = Array.isArray(project.contractors) ? project.contractors : [];
        const webResults = await generateAndEnrichContacts(
          project.id,
          reportId,
          project.name,
          project.owner || "",
          contractors,
          project.sector || "",
          { skipCacheCheck: false }
        );
        if (webResults.length > 0) providersUsed.push("web_search");
      } catch (e: any) {
        console.warn(`[Discovery] Web search failed for project ${project.id}: ${e.message}`);
      }

      // Step 2b: Also enrich any existing pending contacts for this project
      try {
        await enrichContactsForProject(project.id);
      } catch (e: any) {
        // Non-critical — just enriches existing contacts
      }

      // Step 3: Hunter fallback — verify named_unverified contacts that Apollo couldn't verify
      // Only runs when Hunter API key is present and project has named_unverified contacts
      // Hunter is NOT a discovery engine — it only verifies already-named people
      // Guard: skip LLM-inferred contacts (they have fake names/emails)
      if (ENV.hunterApiKey) {
        try {
          const hunterResult = await verifyProjectContactsWithHunter(project.id, 8);
          if (hunterResult.promoted > 0 || hunterResult.emailsFound > 0) {
            providersUsed.push("hunter");
            console.log(`[Discovery] Hunter promoted ${hunterResult.promoted} contacts for project ${project.id}`);
          }
        } catch (e: any) {
          console.warn(`[Discovery] Hunter fallback failed for project ${project.id}: ${e.message}`);
        }
      }

    } else if (ownerType === "government") {
      // Government fallback: LinkedIn search + LLM
      try {
        const contractors = Array.isArray(project.contractors) ? project.contractors : [];
        const webResults = await generateAndEnrichContacts(
          project.id,
          reportId,
          project.name,
          project.owner || "",
          contractors,
          project.sector || "",
          { skipCacheCheck: false }
        );
        if (webResults.length > 0) providersUsed.push("web_search");
      } catch (e: any) {
        console.warn(`[Discovery] Gov web search failed for project ${project.id}: ${e.message}`);
      }

      // LLM fallback for government projects
      try {
        const llmResult = await generateAndSaveLLMContacts(
          project.id, reportId, project.name, project.owner || "",
          Array.isArray(project.contractors) ? project.contractors : [],
          project.sector || "", project.capexGrade || "", project.location || "",
          project.stage || undefined
        );
        if (llmResult && llmResult.contactsGenerated > 0) providersUsed.push("llm");
      } catch (e: any) {
        console.warn(`[Discovery] LLM fallback failed for project ${project.id}: ${e.message}`);
      }

    } else {
      // Unknown/dirty owner — still try LLM as last resort
      try {
        const llmResult = await generateAndSaveLLMContacts(
          project.id, reportId, project.name, project.owner || "",
          Array.isArray(project.contractors) ? project.contractors : [],
          project.sector || "", project.capexGrade || "", project.location || "",
          project.stage || undefined
        );
        if (llmResult && llmResult.contactsGenerated > 0) providersUsed.push("llm");
      } catch (e: any) {
        console.warn(`[Discovery] LLM fallback failed for project ${project.id}: ${e.message}`);
      }
    }

    // ── Also enrich principal contractor if known ──
    if (project.contractors && Array.isArray(project.contractors) && project.contractors.length > 0) {
      const principalContractor = project.contractors[0];
      if (principalContractor?.name && classifyOwnerType(principalContractor.name) === "private") {
        try {
          // Apollo search on contractor
          const contractorResult = await enrichProjectContacts(project.id, reportId, {
            enrichEmails: true,
            maxPerCompany: 3,
          });
          if (contractorResult.people.length > 0 && !providersUsed.includes("apollo")) {
            providersUsed.push("apollo_contractor");
          }
        } catch (e: any) {
          console.warn(`[Discovery] Contractor enrichment failed for project ${project.id}: ${e.message}`);
        }
      }
    }

    // ── Assess final contact state ──
    const contactState = await assessContactState(db, project.id);
    const newStatus = deriveDiscoveryStatus(ownerType, contactState);

    // Update project
    await db.update(projects).set({
      discoveryStatus: newStatus,
      discoveryPriority: priority,
    }).where(eq(projects.id, project.id));

    return {
      projectId: project.id,
      projectName: project.name,
      previousStatus,
      newStatus,
      priority,
      ownerType,
      contactsFound: contactState.total,
      sendReadyContacts: contactState.sendReady,
      namedContacts: contactState.named,
      roleOnlyContacts: contactState.roleOnly,
      providersUsed,
      durationMs: Date.now() - startTime,
    };

  } catch (error: any) {
    // On failure, revert to previous status
    await db.update(projects).set({
      discoveryStatus: previousStatus === "discovery_queued" ? "no_contacts" : previousStatus,
    }).where(eq(projects.id, project.id));

    return {
      projectId: project.id,
      projectName: project.name,
      previousStatus,
      newStatus: previousStatus as DiscoveryStatus,
      priority,
      ownerType,
      contactsFound: 0,
      sendReadyContacts: 0,
      namedContacts: 0,
      roleOnlyContacts: 0,
      providersUsed,
      durationMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

// ── Queue Runner: Process Discovery Queue ──

export async function processDiscoveryQueue(options?: {
  maxBatch?: number;
  priorityFilter?: DiscoveryPriority;
  projectIds?: number[];
}): Promise<QueueRunResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const maxBatch = options?.maxBatch ?? MAX_BATCH_SIZE;

  // Get latest report ID for Apollo enrichment
  const [reportRowsRaw] = (await db.execute(sql`
    SELECT id FROM reports ORDER BY id DESC LIMIT 1
  `)) as any[];
  const reportId = (reportRowsRaw as any[])?.[0]?.id || 1;

  // Build query for eligible projects
  let query = sql`
    SELECT p.*
    FROM projects p
    WHERE p.discoveryStatus IN ('no_contacts', 'discovery_queued', 'role_only', 'named_contact_no_email')
      AND (p.geoBlockedReason IS NULL)
      AND (p.projectCountry = 'AU' OR p.projectCountry IS NULL)
      AND (p.suppressed = false OR p.suppressed IS NULL)
      AND (p.projectType = 'opportunity' OR p.projectType IS NULL)
      AND p.matchedBusinessLines IS NOT NULL
      AND JSON_LENGTH(p.matchedBusinessLines) > 0
      AND (p.discoveryAttempts < ${MAX_DISCOVERY_ATTEMPTS} OR p.discoveryAttempts IS NULL)
      AND (
        p.lastDiscoveryAt IS NULL
        OR p.lastDiscoveryAt < DATE_SUB(NOW(), INTERVAL ${DISCOVERY_COOLDOWN_HOURS} HOUR)
      )
  `;

  if (options?.priorityFilter) {
    query = sql`${query} AND p.discoveryPriority = ${options.priorityFilter}`;
  }

  if (options?.projectIds && options.projectIds.length > 0) {
    const ids = options.projectIds.join(",");
    query = sql`${query} AND p.id IN (${sql.raw(ids)})`;
  }

  // Order by priority (A first), then by hot/warm/cold
  query = sql`${query}
    ORDER BY
      FIELD(p.discoveryPriority, 'A', 'B', 'C'),
      FIELD(p.priority, 'hot', 'warm', 'cold'),
      p.lastActivityAt DESC
    LIMIT ${maxBatch}
  `;

  const executeResult = await db.execute(query) as unknown as any[];
  const eligibleProjects = (Array.isArray(executeResult[0]) ? executeResult[0] : executeResult) as any[];

  const results: DiscoveryResult[] = [];
  let priorityA = 0, priorityB = 0, priorityC = 0;
  let newSendReady = 0, newNamedNoEmail = 0, newRoleOnly = 0, blocked = 0, failed = 0;

  const PROJECT_TIMEOUT_MS = 90_000; // 90s per project max — prevents hung API calls
  for (const project of eligibleProjects) {
    const result = await Promise.race([
      runDiscoveryForProject(db, project, reportId),
      new Promise<DiscoveryResult>((resolve) =>
        setTimeout(() => {
          console.warn(`[Discovery] Project ${project.id} timed out after ${PROJECT_TIMEOUT_MS}ms — resetting to discovery_queued`);
          // Reset the project status so it can be retried
          db.execute(`UPDATE projects SET discoveryStatus='discovery_queued', lastDiscoveryAt=NULL WHERE id=${project.id}`).catch(() => {});
          resolve({
            projectId: project.id,
            projectName: project.name || String(project.id),
            previousStatus: project.discoveryStatus,
            newStatus: 'discovery_queued',
            priority: classifyDiscoveryPriority(project),
            ownerType: classifyOwnerType(project.owner || ''),
            contactsFound: 0,
            sendReadyContacts: 0,
            namedContacts: 0,
            roleOnlyContacts: 0,
            providersUsed: [],
            durationMs: PROJECT_TIMEOUT_MS,
            error: 'timeout',
          });
        }, PROJECT_TIMEOUT_MS)
      ),
    ]);
    results.push(result);

    // Count by priority
    if (result.priority === "A") priorityA++;
    else if (result.priority === "B") priorityB++;
    else priorityC++;

    // Count by outcome
    if (result.error) failed++;
    else if (result.newStatus === "send_ready_contact") newSendReady++;
    else if (result.newStatus === "named_contact_no_email") newNamedNoEmail++;
    else if (result.newStatus === "role_only") newRoleOnly++;
    else if (result.newStatus.startsWith("blocked_")) blocked++;
  }

  console.log(`[DiscoveryQueue] Processed ${results.length} projects: ${newSendReady} send-ready, ${newNamedNoEmail} named-no-email, ${newRoleOnly} role-only, ${blocked} blocked, ${failed} failed`);

  return {
    processed: results.length,
    priorityA,
    priorityB,
    priorityC,
    newSendReady,
    newNamedNoEmail,
    newRoleOnly,
    blocked,
    failed,
    results,
  };
}

// ── Trigger: Queue Discovery for a Single Project ──

export async function queueDiscoveryForProject(projectId: number, reason: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return false;

  const { trigger, reason: checkReason } = shouldTriggerDiscovery(project);
  if (!trigger) {
    console.log(`[DiscoveryQueue] Skipping project ${projectId} (${project.name}): ${checkReason}`);
    return false;
  }

  const priority = classifyDiscoveryPriority(project);

  await db.update(projects).set({
    discoveryStatus: "discovery_queued",
    discoveryPriority: priority,
  }).where(eq(projects.id, projectId));

  console.log(`[DiscoveryQueue] Queued project ${projectId} (${project.name}) — priority ${priority}, reason: ${reason}`);
  return true;
}

// ── Trigger: Batch Queue for Hot/Actioned Projects (SLA enforcement) ──

export async function enforceHotProjectSLA(): Promise<{ queued: number; alreadyOk: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { queued: 0, alreadyOk: 0, skipped: 0 };

  // Bulk query: fetch all hot/actioned projects + their usable contact counts in ONE query
  // Same pattern as backfillDiscoveryStatus — no N+1 per-project DB calls
  const bulkResult = await db.execute(sql.raw(`
    SELECT p.id, p.name, p.discoveryStatus, p.discoveryPriority, p.lastDiscoveryAt,
           p.discoveryAttempts, p.projectCountry, p.geoBlockedReason, p.suppressed,
           p.projectType, p.matchedBusinessLines, p.priority, p.sourcePurpose,
           p.actionTier, p.tenderCloseDate,
           COALESCE(cs.sendReady, 0) as contactSendReady
    FROM projects p
    LEFT JOIN (
      SELECT cp.projectId, COUNT(DISTINCT c.id) as sendReady
      FROM contacts c JOIN contactProjects cp ON cp.contactId = c.id
      WHERE (c.roleBucket IS NULL OR c.roleBucket NOT REGEXP '^[0-9+() -]+$')
        AND (c.email IS NULL OR (c.email NOT LIKE '%portal.invoices%' AND c.email NOT LIKE '%atlascopco.com' AND c.email NOT LIKE '%noreply%' AND c.email NOT LIKE '%no-reply%'))
        AND c.enrichmentSource != 'manual'
        AND c.name IS NOT NULL AND c.name != '' AND c.name NOT LIKE '%Manager%' AND c.name NOT LIKE '%Director%'
        AND c.email IS NOT NULL AND c.email != '' AND c.email NOT LIKE '%@example%'
      GROUP BY cp.projectId
    ) cs ON cs.projectId = p.id
    WHERE (p.priority = 'hot' OR p.actionTier = 'tier1_actionable' OR p.sourcePurpose = 'live_tender')
      AND (p.geoBlockedReason IS NULL)
      AND (p.suppressed = false OR p.suppressed IS NULL)
  `)) as unknown as any[];
  const hotProjects = (Array.isArray(bulkResult[0]) ? bulkResult[0] : bulkResult) as any[];

  let queued = 0, alreadyOk = 0, skipped = 0;

  for (const project of hotProjects) {
    // Override discoveryStatus in-memory if the bulk query shows send-ready contacts
    // This avoids the stale-status problem where discoveryStatus hasn't been updated yet
    const effectiveStatus = Number(project.contactSendReady || 0) > 0
      ? "send_ready_contact"
      : project.discoveryStatus;

    // Use shouldTriggerDiscovery with the effective status (pure in-memory, no DB calls)
    const { trigger, reason } = shouldTriggerDiscovery({
      ...project,
      discoveryStatus: effectiveStatus,
    });

    if (trigger) {
      await db.update(projects).set({
        discoveryStatus: "discovery_queued",
        discoveryPriority: "A",
      }).where(eq(projects.id, project.id));
      queued++;
    } else if (reason === "already_send_ready") {
      alreadyOk++;
    } else {
      skipped++;
    }
  }

  console.log(`[DiscoveryQueue] Hot SLA enforcement: ${queued} queued, ${alreadyOk} already OK, ${skipped} skipped`);
  return { queued, alreadyOk, skipped };
}

// ── Backfill: Compute discoveryStatus for all existing projects ──

export async function backfillDiscoveryStatus(): Promise<{ updated: number; sendReady: number; namedNoEmail: number; roleOnly: number; noContacts: number; blocked: number }> {
  const db = await getDb();
  if (!db) return { updated: 0, sendReady: 0, namedNoEmail: 0, roleOnly: 0, noContacts: 0, blocked: 0 };

  // Step 1: Get all projects needing backfill + their contact stats in ONE bulk query
  const bulkResult = await db.execute(sql.raw(`
    SELECT
      p.id, p.name, p.owner, p.discoveryStatus,
      COALESCE(cs.total, 0) as contactTotal,
      COALESCE(cs.sendReady, 0) as contactSendReady,
      COALESCE(cs.namedNoEmail, 0) as contactNamedNoEmail,
      COALESCE(cs.roleOnly, 0) as contactRoleOnly
    FROM projects p
    LEFT JOIN (
      SELECT
        cp.projectId,
        COUNT(DISTINCT c.id) as total,
        COUNT(DISTINCT CASE
          WHEN c.name IS NOT NULL AND c.name != '' AND c.name NOT LIKE '%Manager%' AND c.name NOT LIKE '%Director%'
            AND c.email IS NOT NULL AND c.email != '' AND c.email NOT LIKE '%@example%'
          THEN c.id END) as sendReady,
        COUNT(DISTINCT CASE
          WHEN c.name IS NOT NULL AND c.name != '' AND c.name NOT LIKE '%Manager%' AND c.name NOT LIKE '%Director%'
            AND (c.email IS NULL OR c.email = '' OR c.email LIKE '%@example%')
          THEN c.id END) as namedNoEmail,
        COUNT(DISTINCT CASE
          WHEN c.name IS NULL OR c.name = '' OR c.name LIKE '%Manager%' OR c.name LIKE '%Director%'
          THEN c.id END) as roleOnly
      FROM contacts c
      JOIN contactProjects cp ON cp.contactId = c.id
      WHERE (c.roleBucket IS NULL OR c.roleBucket NOT REGEXP '^[0-9+() -]+$')
        AND (c.email IS NULL OR (c.email NOT LIKE '%portal.invoices%' AND c.email NOT LIKE '%atlascopco.com' AND c.email NOT LIKE '%noreply%' AND c.email NOT LIKE '%no-reply%'))
        AND c.enrichmentSource != 'manual'
      GROUP BY cp.projectId
    ) cs ON cs.projectId = p.id
    WHERE p.discoveryStatus IS NULL OR p.discoveryStatus = 'no_contacts'
    LIMIT 2000
  `)) as unknown as any[];
  const allProjects = (Array.isArray(bulkResult[0]) ? bulkResult[0] : bulkResult) as any[];

  let updated = 0, sendReady = 0, namedNoEmail = 0, roleOnly = 0, noContacts = 0, blocked = 0;

  // Step 2: Classify each project using in-memory owner-type + pre-fetched contact stats
  for (const project of allProjects) {
    const ownerType = classifyOwnerType(project.owner || "");
    const contactState = {
      sendReady: Number(project.contactSendReady || 0),
      named: Number(project.contactNamedNoEmail || 0),
      roleOnly: Number(project.contactRoleOnly || 0),
    };
    const newStatus = deriveDiscoveryStatus(ownerType, contactState);

    if (newStatus !== (project.discoveryStatus || "no_contacts")) {
      await db.update(projects).set({ discoveryStatus: newStatus }).where(eq(projects.id, project.id));
      updated++;
    }

    if (newStatus === "send_ready_contact") sendReady++;
    else if (newStatus === "named_contact_no_email") namedNoEmail++;
    else if (newStatus === "role_only") roleOnly++;
    else if (newStatus === "no_contacts") noContacts++;
    else if (newStatus.startsWith("blocked_")) blocked++;
  }

  console.log(`[DiscoveryQueue] Backfill: ${updated} updated of ${allProjects.length} — ${sendReady} send-ready, ${namedNoEmail} named-no-email, ${roleOnly} role-only, ${noContacts} no-contacts, ${blocked} blocked`);
  return { updated, sendReady, namedNoEmail, roleOnly, noContacts, blocked };
}
