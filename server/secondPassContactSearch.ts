/**
 * Second-Pass Contact Search
 *
 * When a project has fewer than 2 high/medium-relevance contacts,
 * this service runs a targeted deeper search using specific role+company
 * and role+project combinations to fill the gap.
 *
 * Search patterns:
 *   - project name + construction manager
 *   - project name + procurement manager
 *   - company name + project engineer
 *   - contractor name + site manager
 *   - company name + maintenance manager
 *   - company name + operations manager
 *
 * The second pass is more aggressive than the initial discovery:
 * it searches for specific high-value roles rather than broad queries.
 * Results are scored for role relevance before being saved.
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "./db";
import { contacts, projects, contactProjects, type InsertContact } from "../drizzle/schema";
import { callDataApi } from "./_core/dataApi";
import { classifyRoleRelevance, getProjectsWithFewRelevantContacts } from "./roleRelevance";
import { computeVerificationScore, generateLinkedInSearchUrl } from "./verificationScoring";
import { isLinkedInResultAustralianRelevant } from "./geoFilter";
import { unverifiedContactEmail } from "./intelligenceTrustPolicy";

// ── Types ──

export interface SecondPassResult {
  projectId: number;
  projectName: string;
  contactsBefore: number;
  contactsAdded: number;
  searchesPerformed: number;
  newContacts: {
    name: string;
    title: string;
    company: string;
    roleRelevance: "high" | "medium" | "low";
  }[];
  errors: string[];
}

export interface SecondPassSummary {
  projectsProcessed: number;
  totalContactsAdded: number;
  projectsImproved: number;
  results: SecondPassResult[];
  errors: string[];
}

// ── Configuration ──

const MIN_RELEVANT_CONTACTS = 2;
const MAX_PROJECTS_PER_RUN = 30;
const DELAY_BETWEEN_SEARCHES_MS = 800;
const MIN_VERIFICATION_SCORE = 55;

/**
 * High-value roles to search for in the second pass.
 * These are the roles most likely to influence equipment procurement.
 * Ordered by priority — most valuable roles first.
 */
const TARGET_ROLES = [
  "Construction Manager",
  "Project Manager",
  "Procurement Manager",
  "Site Manager",
  "Engineering Manager",
  "Operations Manager",
  "Maintenance Manager",
  "Site Superintendent",
  "Fleet Manager",
  "Mining Manager",
];

// ── Helpers ──

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface LinkedInPerson {
  fullName?: string;
  headline?: string;
  location?: string;
  profileURL?: string;
  username?: string;
  profilePicture?: string;
}


function normalizeRoleBucket(role: string): string {
  const h = role.toLowerCase();
  if (h.includes("procurement") || h.includes("supply chain") || h.includes("purchasing"))
    return "procurement";
  if (h.includes("project manager") || h.includes("project director") || h.includes("project lead"))
    return "project_manager";
  if (h.includes("engineer") || h.includes("engineering"))
    return "engineering";
  if (h.includes("operations") || h.includes("ops"))
    return "operations";
  if (h.includes("maintenance") || h.includes("reliability"))
    return "maintenance";
  if (h.includes("site manager") || h.includes("site superintendent"))
    return "site_manager";
  if (h.includes("fleet") || h.includes("equipment"))
    return "fleet_manager";
  if (h.includes("general manager") || h.includes("managing director") || h.includes("ceo") || h.includes("director"))
    return "general_manager";
  if (h.includes("commercial") || h.includes("business development"))
    return "commercial";
  if (h.includes("construction"))
    return "construction_manager";
  if (h.includes("mining"))
    return "mining_manager";
  if (h.includes("plant"))
    return "plant_manager";
  return "other";
}

// ── Cross-Industry Mismatch Detection ──

/**
 * Detect when a LinkedIn contact's headline indicates they work in a completely
 * different industry from the project's sector. This prevents false positives
 * from company-name collisions (e.g., "Red Sky" insurance vs "Red Sky Energy" oil&gas).
 */
const NON_INDUSTRIAL_HEADLINE_SIGNALS = [
  "medicare", "medicaid", "healthcare", "health care", "hospital", "clinical",
  "pharmaceutical", "pharma", "biotech", "medical device",
  "insurance", "underwriting", "actuarial", "claims",
  "retail", "fashion", "apparel", "e-commerce", "ecommerce",
  "real estate agent", "property management", "mortgage",
  "education", "teacher", "professor", "academic", "university", "school",
  "restaurant", "hospitality", "hotel", "catering", "food service",
  "marketing agency", "digital marketing", "social media manager",
  "fitness", "personal trainer", "wellness", "yoga",
  "legal counsel", "attorney", "law firm", "barrister", "solicitor",
  "accounting firm", "tax advisor", "bookkeeper",
  "recruitment", "staffing agency", "talent acquisition",
  "church", "ministry", "pastor", "nonprofit", "charity",
];

function isCrossIndustryMismatch(headline: string, projectSector: string): boolean {
  const h = headline.toLowerCase();
  // If headline contains any non-industrial signal, it's a mismatch
  // UNLESS the project sector itself is in that industry (unlikely for Atlas Copco)
  for (const signal of NON_INDUSTRIAL_HEADLINE_SIGNALS) {
    if (h.includes(signal)) {
      return true;
    }
  }
  return false;
}

// ── LinkedIn Search ──

async function searchLinkedIn(
  company: string,
  roleTitle: string,
): Promise<LinkedInPerson[]> {
  try {
    const result = (await callDataApi("LinkedIn/search_people", {
      query: {
        keywords: `${roleTitle} ${company}`,
        company,
        keywordTitle: roleTitle,
      },
    })) as {
      success?: boolean;
      message?: string;
      data?: { items?: LinkedInPerson[]; total?: number };
    };

    const msg = result?.message || "";
    if (msg.toLowerCase().includes("exceeded") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("upgrade")) {
      throw new Error("QUOTA_EXHAUSTED");
    }

    if (!result?.success || !result?.data?.items?.length) {
      return [];
    }

    return result.data.items.slice(0, 2); // Top 2 per search
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg === "QUOTA_EXHAUSTED" || errMsg.includes("usage exhausted") || errMsg.includes("quota")) {
      throw new Error("QUOTA_EXHAUSTED");
    }
    console.error(`[SecondPass] LinkedIn search failed for "${roleTitle}" at "${company}":`, errMsg);
    return [];
  }
}

// ── Core Second-Pass Search ──

/**
 * Run a second-pass contact search for a single project.
 * Searches for specific high-value roles at the project's companies.
 */
export async function runSecondPassForProject(
  projectId: number,
  projectName: string,
  owner: string,
  contractors: { name: string; status: string }[] | null,
  sector: string,
  reportId: number,
): Promise<SecondPassResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const errors: string[] = [];
  const newContacts: SecondPassResult["newContacts"] = [];
  let searchesPerformed = 0;

  // Count existing relevant contacts
  const [existingCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contactProjects)
    .innerJoin(contacts, eq(contactProjects.contactId, contacts.id))
    .where(
      and(
        eq(contactProjects.projectId, projectId),
        sql`${contacts.roleRelevance} IN ('high', 'medium')`
      )
    );
  const contactsBefore = Number(existingCount.count);

  // If already has enough relevant contacts, skip
  if (contactsBefore >= MIN_RELEVANT_CONTACTS) {
    return {
      projectId,
      projectName,
      contactsBefore,
      contactsAdded: 0,
      searchesPerformed: 0,
      newContacts: [],
      errors: [],
    };
  }

  // Build company list: owner + contractors (confirmed, awarded, and predicted)
  const companies: string[] = [];
  if (owner && owner !== "Unknown") companies.push(owner);
  if (contractors) {
    for (const c of contractors) {
      const s = (c.status || "").toLowerCase();
      if (c.name && !companies.includes(c.name) && (s === "confirmed" || s === "awarded" || s === "predicted")) {
        companies.push(c.name);
      }
    }
  }

  if (companies.length === 0) {
    return {
      projectId,
      projectName,
      contactsBefore,
      contactsAdded: 0,
      searchesPerformed: 0,
      newContacts: [],
      errors: ["No companies to search"],
    };
  }

  // Determine which roles to search based on what's missing
  const existingRoles = await db
    .select({ roleBucket: contacts.roleBucket })
    .from(contactProjects)
    .innerJoin(contacts, eq(contactProjects.contactId, contacts.id))
    .where(
      and(
        eq(contactProjects.projectId, projectId),
        sql`${contacts.roleRelevance} IN ('high', 'medium')`
      )
    );

  const existingRoleBuckets = new Set(existingRoles.map(r => r.roleBucket.toLowerCase()));

  // Filter target roles to those not already covered
  const rolesToSearch = TARGET_ROLES.filter(role => {
    const bucket = normalizeRoleBucket(role);
    return !existingRoleBuckets.has(bucket);
  });

  // Search for each role at each company until we have enough contacts
  const needed = MIN_RELEVANT_CONTACTS - contactsBefore;
  let quotaExhausted = false;

  for (const company of companies) {
    if (newContacts.length >= needed + 2 || quotaExhausted) break; // +2 buffer for quality filtering

    for (const role of rolesToSearch) {
      if (newContacts.length >= needed + 2 || quotaExhausted) break;

      try {
        const people = await searchLinkedIn(company, role);
        searchesPerformed++;

        for (const person of people) {
          if (!person.fullName) continue;

          // Geographic filter: skip non-Australian contacts
          if (!isLinkedInResultAustralianRelevant(person)) {
            console.log(`[SecondPass] Skipping non-Australian contact "${person.fullName}" (headline: ${person.headline}, location: ${person.location})`);
            continue;
          }

          // Check for duplicates
          const nameKey = person.fullName.toLowerCase().trim();
          const [existing] = await db
            .select({ id: contacts.id })
            .from(contacts)
            .where(and(
              sql`LOWER(${contacts.name}) = LOWER(${nameKey})`,
              sql`LOWER(${contacts.company}) = LOWER(${company})`,
            ))
            .limit(1);

          if (existing) {
            const [existingLink] = await db
              .select({ id: contactProjects.id })
              .from(contactProjects)
              .where(and(
                eq(contactProjects.contactId, existing.id),
                eq(contactProjects.projectId, projectId),
              ))
              .limit(1);
            if (!existingLink) {
              await db.insert(contactProjects).values({
                contactId: existing.id,
                projectId,
                projectName,
                relevance: company === owner ? "primary" : "secondary",
              });
            }
            continue;
          }

          // Classify role relevance
          const titleToUse = person.headline || role;
          const roleRelevance = classifyRoleRelevance(titleToUse, normalizeRoleBucket(titleToUse));

          // Only save high/medium relevance contacts
          if (roleRelevance === "low") continue;

          // Sector-relevance validation: reject contacts whose headline indicates
          // a completely different industry from the project sector.
          // This prevents false positives like "Medicare Sales Ops" at "Red Sky" (insurance)
          // being matched to "Red Sky Energy" (oil & gas) projects.
          if (person.headline && isCrossIndustryMismatch(person.headline, sector)) {
            console.log(`[SecondPass] Skipping cross-industry mismatch: "${person.fullName}" (headline: "${person.headline}") for ${sector} project "${projectName}"`);
            continue;
          }

          const linkedinUrl = person.profileURL ||
            (person.username ? `https://www.linkedin.com/in/${person.username}` : null);
          const linkedinSearchUrl = linkedinUrl || generateLinkedInSearchUrl(person.fullName, company, titleToUse);

          const contactData: InsertContact = {
            reportId,
            name: person.fullName,
            title: titleToUse,
            company,
            project: projectName,
            priority: "warm",
            roleBucket: normalizeRoleBucket(titleToUse),
            email: unverifiedContactEmail(),
            linkedin: null,
            enrichmentStatus: "enriched",
            enrichmentSource: "web_search",
            sourceUrl: linkedinUrl || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(person.fullName + " " + company)}`,
            enrichedAt: new Date(),
            linkedinHeadline: person.headline,
            linkedinLocation: person.location,
            linkedinProfilePic: person.profilePicture,
            verificationStatus: person.headline ? "ai_suggested" : "unverified",
            confidenceScore: person.headline ? "high" : "medium",
            linkedinSearchUrl,
            linkedinProfileUrl: linkedinUrl || null,
            roleRelevance,
            emailVerified: false,
            contactTrustTier: "named_unverified",
          };

          // Compute verification score
          const scoreBreakdown = computeVerificationScore(contactData);
          if (scoreBreakdown.total < MIN_VERIFICATION_SCORE) continue;
          (contactData as any).verificationScore = scoreBreakdown.total;

          await db.transaction(async tx => {
            const [inserted] = await tx.insert(contacts).values(contactData);
            const contactId = Number((inserted as any).insertId);
            if (!contactId) throw new Error("Second-pass contact insert did not return an ID");
            await tx.insert(contactProjects).values({
              contactId,
              projectId,
              projectName,
              relevance: company === owner ? "primary" : "secondary",
            });
          });

          newContacts.push({
            name: person.fullName,
            title: titleToUse,
            company,
            roleRelevance,
          });
        }

        await sleep(DELAY_BETWEEN_SEARCHES_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "QUOTA_EXHAUSTED") {
          quotaExhausted = true;
          errors.push("LinkedIn API quota exhausted — stopped early");
          break;
        }
        errors.push(`Search "${role}" at "${company}": ${msg}`);
      }
    }
  }

  return {
    projectId,
    projectName,
    contactsBefore,
    contactsAdded: newContacts.length,
    searchesPerformed,
    newContacts,
    errors,
  };
}

// ── Bulk Second-Pass ──

/**
 * Run the second-pass contact search on all projects that have
 * fewer than 2 high/medium-relevance contacts.
 */
export async function runBulkSecondPass(
  maxProjects: number = MAX_PROJECTS_PER_RUN,
): Promise<SecondPassSummary> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Find projects needing more contacts
  const gapProjects = await getProjectsWithFewRelevantContacts(MIN_RELEVANT_CONTACTS);
  const toProcess = gapProjects.slice(0, maxProjects);

  console.log(`[SecondPass] Found ${gapProjects.length} projects with <${MIN_RELEVANT_CONTACTS} relevant contacts, processing ${toProcess.length}`);

  const results: SecondPassResult[] = [];
  let totalContactsAdded = 0;
  let projectsImproved = 0;
  const errors: string[] = [];
  let quotaExhausted = false;

  for (const project of toProcess) {
    if (quotaExhausted) break;

    try {
      // Get the project's contractors and reportId
      const [fullProject] = await db
        .select({
          reportId: projects.reportId,
          contractors: projects.contractors,
        })
        .from(projects)
        .where(eq(projects.id, project.projectId))
        .limit(1);

      if (!fullProject) continue;

      const contractorsList = Array.isArray(fullProject.contractors)
        ? (fullProject.contractors as { name: string; status: string }[])
        : null;

      const result = await runSecondPassForProject(
        project.projectId,
        project.projectName,
        project.owner,
        contractorsList,
        project.sector,
        fullProject.reportId,
      );

      results.push(result);
      totalContactsAdded += result.contactsAdded;
      if (result.contactsAdded > 0) projectsImproved++;

      // Check for quota exhaustion
      if (result.errors.some(e => e.includes("quota"))) {
        quotaExhausted = true;
        errors.push("LinkedIn API quota exhausted — stopped processing remaining projects");
        break;
      }

      // Delay between projects
      await sleep(1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("QUOTA_EXHAUSTED") || msg.includes("quota")) {
        quotaExhausted = true;
        errors.push("LinkedIn API quota exhausted — stopped processing remaining projects");
        break;
      }
      errors.push(`Project ${project.projectName}: ${msg}`);
    }
  }

  console.log(`[SecondPass] Complete: ${results.length} projects processed, ${totalContactsAdded} contacts added, ${projectsImproved} projects improved`);

  return {
    projectsProcessed: results.length,
    totalContactsAdded,
    projectsImproved,
    results,
    errors,
  };
}

/**
 * Get a count of projects that need the second pass.
 */
export async function getSecondPassGapCount(): Promise<{
  projectsNeedingContacts: number;
  totalGapContacts: number;
}> {
  const gapProjects = await getProjectsWithFewRelevantContacts(MIN_RELEVANT_CONTACTS);
  const totalGap = gapProjects.reduce((sum, p) => sum + (MIN_RELEVANT_CONTACTS - p.relevantContactCount), 0);

  return {
    projectsNeedingContacts: gapProjects.length,
    totalGapContacts: totalGap,
  };
}
