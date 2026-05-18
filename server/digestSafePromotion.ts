/**
 * Digest-Safe Auto-Promotion Job
 *
 * Nightly job that automatically promotes projects to digestSafe=true when they
 * meet all quality criteria. This replaces the manual gate-setting workflow for
 * projects that have sufficient verified contacts and commercial relevance.
 *
 * Promotion criteria (all must pass):
 *  1. Project is active, not suppressed, not geo-blocked
 *  2. Has ≥ MIN_SEND_READY_CONTACTS send_ready contacts linked via contactProjects
 *  3. Has at least one BL dimension score ≥ MIN_BL_SCORE (commercially relevant)
 *  4. Does NOT match any junk suppression pattern
 *  5. Not already digestSafe=true (idempotent)
 *
 * Runs nightly at 02:00 UTC (after Sunday 22:00 preview, before Monday 06:00 AWST send).
 * Also runs on server startup as a catch-up pass.
 *
 * Results are logged to systemKv under "digestSafePromotion.lastRunAt" and
 * "digestSafePromotion.lastRunSummary" for operator visibility.
 */

import { eq, and, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb, getSystemKv, setSystemKv } from "./db";
import {
  projects,
  contacts,
  contactProjects,
  projectBusinessLineScores,
  projectValidationGates,
} from "../drizzle/schema";
import { checkJunkSuppression } from "./digestHardeningGates";

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Minimum number of send_ready contacts a project must have to be promoted */
export const MIN_SEND_READY_CONTACTS = 3;

/**
 * Minimum BL dimension score (0–100) required in at least one dimension.
 * A score ≥ 40 means the project is commercially relevant to at least one PT lane.
 */
export const MIN_BL_SCORE = 40;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PromotionResult {
  promoted: number;
  skipped: number;
  alreadySafe: number;
  errors: number;
  promotedProjects: Array<{
    projectId: number;
    projectName: string;
    sendReadyCount: number;
    topBLScore: number;
    topBLDimension: string;
  }>;
  skippedReasons: Record<string, number>;
  ranAt: string;
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Run the digestSafe auto-promotion pass.
 *
 * Idempotent — safe to run multiple times. Already-promoted projects are
 * counted in `alreadySafe` and not re-processed.
 */
export async function runDigestSafePromotion(): Promise<PromotionResult> {
  const db = await getDb();
  const result: PromotionResult = {
    promoted: 0,
    skipped: 0,
    alreadySafe: 0,
    errors: 0,
    promotedProjects: [],
    skippedReasons: {},
    ranAt: new Date().toISOString(),
  };

  if (!db) {
    console.error("[DigestSafePromotion] Database not available — skipping");
    return result;
  }

  // ── Step 1: Load all active, non-suppressed, non-geo-blocked projects ──
  const activeProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      overview: projects.overview,
      sector: projects.sector,
      owner: projects.owner,
      priority: projects.priority,
      lifecycleStatus: projects.lifecycleStatus,
      suppressed: projects.suppressed,
      geoBlockedReason: projects.geoBlockedReason,
    })
    .from(projects)
    .where(
      and(
        or(eq(projects.lifecycleStatus, "active"), isNull(projects.lifecycleStatus)),
        or(eq(projects.suppressed, false), isNull(projects.suppressed)),
        isNull(projects.geoBlockedReason),
      )
    );

  if (activeProjects.length === 0) {
    console.log("[DigestSafePromotion] No active projects found — nothing to promote");
    return result;
  }

  const projectIds = activeProjects.map(p => p.id);

  // ── Step 2: Load existing digestSafe gates (to skip already-promoted) ──
  const existingGates = await db
    .select({ projectId: projectValidationGates.projectId })
    .from(projectValidationGates)
    .where(
      and(
        inArray(projectValidationGates.projectId, projectIds),
        eq(projectValidationGates.digestSafe, true),
      )
    );
  const alreadySafeIds = new Set(existingGates.map(g => g.projectId));

  // ── Step 3: Count send_ready contacts per project ──
  // Join contactProjects → contacts where contactTrustTier = 'send_ready'
  // and rejectionReason IS NULL (not quarantined)
  const sendReadyCounts = await db
    .select({
      projectId: contactProjects.projectId,
      count: sql<number>`COUNT(DISTINCT ${contactProjects.contactId})`,
    })
    .from(contactProjects)
    .innerJoin(contacts, eq(contactProjects.contactId, contacts.id))
    .where(
      and(
        inArray(contactProjects.projectId, projectIds),
        eq(contacts.contactTrustTier, "send_ready"),
        isNull(contacts.rejectionReason),
      )
    )
    .groupBy(contactProjects.projectId);

  const sendReadyMap = new Map<number, number>();
  for (const row of sendReadyCounts) {
    sendReadyMap.set(row.projectId, Number(row.count));
  }

  // ── Step 4: Load BL scores for all projects ──
  const blScoreRows = await db
    .select({
      projectId: projectBusinessLineScores.projectId,
      scoringDimension: projectBusinessLineScores.scoringDimension,
      score: projectBusinessLineScores.score,
    })
    .from(projectBusinessLineScores)
    .where(inArray(projectBusinessLineScores.projectId, projectIds));

  // Build map: projectId → { dimension: score }
  const blScoreMap = new Map<number, Map<string, number>>();
  for (const row of blScoreRows) {
    if (!blScoreMap.has(row.projectId)) {
      blScoreMap.set(row.projectId, new Map());
    }
    blScoreMap.get(row.projectId)!.set(row.scoringDimension, row.score);
  }

  // ── Step 5: Evaluate each project and collect candidates ──
  const toPromote: Array<{
    projectId: number;
    projectName: string;
    sendReadyCount: number;
    topBLScore: number;
    topBLDimension: string;
  }> = [];

  function bumpSkipReason(reason: string) {
    result.skippedReasons[reason] = (result.skippedReasons[reason] ?? 0) + 1;
    result.skipped++;
  }

  for (const project of activeProjects) {
    // Already promoted — count and skip
    if (alreadySafeIds.has(project.id)) {
      result.alreadySafe++;
      continue;
    }

    // Check send_ready contact count
    const sendReadyCount = sendReadyMap.get(project.id) ?? 0;
    if (sendReadyCount < MIN_SEND_READY_CONTACTS) {
      bumpSkipReason(`insufficient_send_ready_contacts (${sendReadyCount} < ${MIN_SEND_READY_CONTACTS})`);
      continue;
    }

    // Check BL score — find the highest scoring dimension
    const dimScores = blScoreMap.get(project.id);
    let topBLScore = 0;
    let topBLDimension = "none";
    if (dimScores) {
      for (const [dim, score] of Array.from(dimScores.entries())) {
        if (score > topBLScore) {
          topBLScore = score;
          topBLDimension = dim;
        }
      }
    }
    if (topBLScore < MIN_BL_SCORE) {
      bumpSkipReason(`low_bl_score (top=${topBLScore} < ${MIN_BL_SCORE})`);
      continue;
    }

    // Junk suppression check — use the top BL dimension as the lane
    const junkCheck = checkJunkSuppression(
      { name: project.name, overview: project.overview ?? undefined, sector: project.sector ?? undefined, owner: project.owner ?? undefined },
      topBLDimension,
    );
    if (junkCheck.isJunk) {
      bumpSkipReason(`junk_pattern:${junkCheck.pattern}`);
      continue;
    }

    // Passed all gates — add to promotion list
    toPromote.push({
      projectId: project.id,
      projectName: project.name,
      sendReadyCount,
      topBLScore,
      topBLDimension,
    });
  }

  // ── Step 6: Upsert digestSafe=true for all qualifying projects ──
  for (const candidate of toPromote) {
    try {
      const note = `Auto-promoted: ${candidate.sendReadyCount} send_ready contacts, top BL score ${candidate.topBLScore} (${candidate.topBLDimension})`;
      await db
        .insert(projectValidationGates)
        .values({
          projectId: candidate.projectId,
          primaryAcceptable: true,
          backupAcceptable: true,
          digestSafe: true,
          gateSetBy: "auto_promotion",
          gateSetAt: new Date(),
          gateNote: note,
        })
        .onDuplicateKeyUpdate({
          set: {
            digestSafe: true,
            gateSetBy: "auto_promotion",
            gateSetAt: new Date(),
            gateNote: note,
            updatedAt: new Date(),
          },
        });

      result.promoted++;
      result.promotedProjects.push(candidate);
    } catch (err) {
      result.errors++;
      console.error(`[DigestSafePromotion] Failed to promote project ${candidate.projectId} (${candidate.projectName}):`, err);
    }
  }

  return result;
}

/**
 * Run the promotion job and persist results to systemKv for operator visibility.
 * Safe to call from the scheduler — catches all errors internally.
 */
export async function runDigestSafePromotionSafe(): Promise<void> {
  console.log("[DigestSafePromotion] Starting nightly digestSafe auto-promotion pass...");
  try {
    const result = await runDigestSafePromotion();

    const summary = [
      `promoted=${result.promoted}`,
      `alreadySafe=${result.alreadySafe}`,
      `skipped=${result.skipped}`,
      `errors=${result.errors}`,
    ].join(" | ");

    console.log(`[DigestSafePromotion] ✓ Complete: ${summary}`);

    if (result.promoted > 0) {
      const names = result.promotedProjects.map(p => `${p.projectName} (${p.sendReadyCount} contacts, BL:${p.topBLDimension}@${p.topBLScore})`).join("; ");
      console.log(`[DigestSafePromotion] Promoted projects: ${names}`);
    }

    if (Object.keys(result.skippedReasons).length > 0) {
      const reasons = Object.entries(result.skippedReasons)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      console.log(`[DigestSafePromotion] Skip reasons: ${reasons}`);
    }

    // Persist to systemKv for admin dashboard visibility
    await setSystemKv("digestSafePromotion.lastRunAt", result.ranAt);
    await setSystemKv("digestSafePromotion.lastRunSummary", JSON.stringify({
      promoted: result.promoted,
      alreadySafe: result.alreadySafe,
      skipped: result.skipped,
      errors: result.errors,
      promotedProjects: result.promotedProjects,
      skippedReasons: result.skippedReasons,
      ranAt: result.ranAt,
    }));
  } catch (err) {
    console.error("[DigestSafePromotion] Unexpected error in promotion job:", err);
  }
}
