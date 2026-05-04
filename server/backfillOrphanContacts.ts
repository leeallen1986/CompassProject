/**
 * Fix 5: Backfill Orphan Enriched Contacts
 *
 * Links enriched contacts (with emails) that have no project link back to
 * likely projects by matching the contact's company field to project
 * owner/contractor names.
 *
 * Confidence rules:
 * - HIGH: exact match of contact.company to project.owner (case-insensitive)
 * - MEDIUM: exact match of contact.company to a contractor name in project.contractors JSON
 * - LOW: partial/fuzzy match (substring) — skipped by default for safety
 *
 * This is designed to run once as a data repair, then optionally as a nightly
 * maintenance step to catch new orphans.
 */
import { getDb } from "./db";
import { contacts, projects, contactProjects } from "../drizzle/schema";
import { eq, sql, and, isNull, isNotNull } from "drizzle-orm";

export interface BackfillResult {
  totalOrphans: number;
  matchedHigh: number;
  matchedMedium: number;
  unmatched: number;
  linksCreated: number;
  errors: string[];
}

export async function backfillOrphanContacts(dryRun: boolean = false): Promise<BackfillResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result: BackfillResult = {
    totalOrphans: 0,
    matchedHigh: 0,
    matchedMedium: 0,
    unmatched: 0,
    linksCreated: 0,
    errors: [],
  };

  // Step 1: Find enriched contacts with emails that have NO project link
  const [orphanRows] = await db.execute(sql`
    SELECT c.id, c.name, c.company, c.email
    FROM contacts c
    LEFT JOIN contactProjects cp ON cp.contactId = c.id
    WHERE cp.id IS NULL
      AND c.email IS NOT NULL
      AND c.email != ''
      AND c.enrichmentStatus = 'enriched'
    LIMIT 2000
  `) as any;

  const orphans = Array.isArray(orphanRows) ? orphanRows : [];
  result.totalOrphans = orphans.length;

  if (orphans.length === 0) {
    console.log("[BackfillOrphans] No orphan enriched contacts found.");
    return result;
  }

  console.log(`[BackfillOrphans] Found ${orphans.length} orphan enriched contacts to process`);

  // Step 2: Build a lookup of all active projects by owner (lowercase)
  const [projectRows] = await db.execute(sql`
    SELECT id, name, owner, contractors
    FROM projects
    WHERE (lifecycleStatus = 'active' OR lifecycleStatus = 'awarded' OR lifecycleStatus IS NULL)
      AND (suppressed = false OR suppressed IS NULL)
  `) as any;

  const activeProjects = Array.isArray(projectRows) ? projectRows : [];

  // Build owner → projects map
  const ownerMap = new Map<string, Array<{ id: number; name: string }>>();
  const contractorMap = new Map<string, Array<{ id: number; name: string }>>();

  for (const p of activeProjects) {
    const ownerKey = (p.owner || "").toLowerCase().trim();
    if (ownerKey) {
      if (!ownerMap.has(ownerKey)) ownerMap.set(ownerKey, []);
      ownerMap.get(ownerKey)!.push({ id: p.id, name: p.name });
    }

    // Parse contractors JSON
    let contractors: any[] = [];
    try {
      contractors = typeof p.contractors === "string" ? JSON.parse(p.contractors) : (p.contractors || []);
    } catch { /* ignore parse errors */ }

    for (const c of contractors) {
      const cName = (c.name || c.company || "").toLowerCase().trim();
      if (cName && cName !== "unknown") {
        if (!contractorMap.has(cName)) contractorMap.set(cName, []);
        contractorMap.get(cName)!.push({ id: p.id, name: p.name });
      }
    }
  }

  console.log(`[BackfillOrphans] Built lookup: ${ownerMap.size} owners, ${contractorMap.size} contractors across ${activeProjects.length} active projects`);

  // Step 3: Match each orphan contact to projects
  for (const orphan of orphans) {
    const company = (orphan.company || "").toLowerCase().trim();
    if (!company) {
      result.unmatched++;
      continue;
    }

    // HIGH confidence: exact owner match
    const ownerMatches = ownerMap.get(company);
    if (ownerMatches && ownerMatches.length > 0) {
      for (const proj of ownerMatches.slice(0, 5)) { // cap at 5 links per contact
        try {
          if (!dryRun) {
            // Check if link already exists
            const [existing] = await db
              .select({ id: contactProjects.id })
              .from(contactProjects)
              .where(
                and(
                  eq(contactProjects.contactId, orphan.id),
                  eq(contactProjects.projectId, proj.id)
                )
              )
              .limit(1);

            if (!existing) {
              await db.insert(contactProjects).values({
                contactId: orphan.id,
                projectId: proj.id,
                projectName: proj.name,
                relevance: "primary",
              });
              result.linksCreated++;
            }
          } else {
            result.linksCreated++; // count what would be created
          }
        } catch (err) {
          result.errors.push(`Link ${orphan.id}→${proj.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      result.matchedHigh++;
      continue;
    }

    // MEDIUM confidence: contractor match
    const contractorMatches = contractorMap.get(company);
    if (contractorMatches && contractorMatches.length > 0) {
      for (const proj of contractorMatches.slice(0, 5)) {
        try {
          if (!dryRun) {
            const [existing] = await db
              .select({ id: contactProjects.id })
              .from(contactProjects)
              .where(
                and(
                  eq(contactProjects.contactId, orphan.id),
                  eq(contactProjects.projectId, proj.id)
                )
              )
              .limit(1);

            if (!existing) {
              await db.insert(contactProjects).values({
                contactId: orphan.id,
                projectId: proj.id,
                projectName: proj.name,
                relevance: "secondary",
              });
              result.linksCreated++;
            }
          } else {
            result.linksCreated++;
          }
        } catch (err) {
          result.errors.push(`Link ${orphan.id}→${proj.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      result.matchedMedium++;
      continue;
    }

    result.unmatched++;
  }

  console.log(`[BackfillOrphans] Complete: ${result.matchedHigh} high-confidence, ${result.matchedMedium} medium-confidence, ${result.unmatched} unmatched, ${result.linksCreated} links created, ${result.errors.length} errors`);
  return result;
}
