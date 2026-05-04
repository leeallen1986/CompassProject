/**
 * Fix 6: Clean URL-as-Contractor-Name Data
 *
 * Identifies projects where the contractor name is actually a URL string
 * (e.g., "https://www.example.com/...") and nullifies those entries.
 * Then requeues the affected projects for contractor enrichment / discovery.
 *
 * URL detection: any contractor name starting with "http://" or "https://" or
 * containing ".com" with no spaces (likely a domain, not a company name).
 */
import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";

export interface CleanResult {
  totalProjectsScanned: number;
  projectsWithUrlContractors: number;
  contractorsRemoved: number;
  projectsRequeued: number;
  errors: string[];
}

function isUrlLike(name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return true;
  if (trimmed.startsWith("www.")) return true;
  // Domain-like with no spaces: "example.com.au" but not "BHP Group Ltd"
  if (!trimmed.includes(" ") && /\.[a-z]{2,}/.test(trimmed) && trimmed.includes(".")) return true;
  return false;
}

export async function cleanContractorUrls(dryRun: boolean = false): Promise<CleanResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result: CleanResult = {
    totalProjectsScanned: 0,
    projectsWithUrlContractors: 0,
    contractorsRemoved: 0,
    projectsRequeued: 0,
    errors: [],
  };

  // Get all projects with non-null contractors
  const [rows] = await db.execute(sql`
    SELECT id, name, contractors, discoveryStatus
    FROM projects
    WHERE contractors IS NOT NULL
      AND JSON_LENGTH(contractors) > 0
      AND (lifecycleStatus = 'active' OR lifecycleStatus = 'awarded' OR lifecycleStatus IS NULL)
  `) as any;

  const allProjects = Array.isArray(rows) ? rows : [];
  result.totalProjectsScanned = allProjects.length;

  for (const project of allProjects) {
    let contractors: any[] = [];
    try {
      contractors = typeof project.contractors === "string"
        ? JSON.parse(project.contractors)
        : (project.contractors || []);
    } catch { continue; }

    const urlContractors = contractors.filter(c => {
      const name = c.name || c.company || "";
      return isUrlLike(name);
    });

    if (urlContractors.length === 0) continue;

    result.projectsWithUrlContractors++;
    result.contractorsRemoved += urlContractors.length;

    // Remove URL contractors, keep valid ones
    const cleanedContractors = contractors.filter(c => {
      const name = c.name || c.company || "";
      return !isUrlLike(name);
    });

    if (!dryRun) {
      try {
        // Update contractors field
        await db.execute(sql`
          UPDATE projects
          SET contractors = ${cleanedContractors.length > 0 ? JSON.stringify(cleanedContractors) : null}
          WHERE id = ${project.id}
        `);

        // Requeue for discovery if not already send_ready
        if (project.discoveryStatus !== "send_ready_contact") {
          await db.execute(sql`
            UPDATE projects
            SET discoveryStatus = 'queued',
                discoveryPriority = 'A'
            WHERE id = ${project.id}
              AND (discoveryStatus != 'send_ready_contact' OR discoveryStatus IS NULL)
          `);
          result.projectsRequeued++;
        }

        console.log(`[CleanContractorUrls] Project ${project.id} (${project.name}): removed ${urlContractors.length} URL contractor(s), requeued`);
      } catch (err) {
        result.errors.push(`Project ${project.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      result.projectsRequeued++;
      console.log(`[CleanContractorUrls] DRY RUN: Would clean project ${project.id} (${project.name}): ${urlContractors.map(c => c.name || c.company).join(", ")}`);
    }
  }

  console.log(`[CleanContractorUrls] Complete: ${result.projectsWithUrlContractors} projects had URL contractors, ${result.contractorsRemoved} removed, ${result.projectsRequeued} requeued`);
  return result;
}
