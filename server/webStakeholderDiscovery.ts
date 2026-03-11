/**
 * Open-Web Stakeholder Discovery Service
 *
 * Uses LinkedIn People Search (via Data API) + LLM role targeting to find
 * real stakeholders for each project. Searches for people at the project
 * owner and contractor companies with relevant job titles.
 *
 * This is the PRIMARY enrichment path — Apollo is reserved for manual
 * high-priority projects only.
 *
 * Flow:
 * 1. Use LLM to determine the best companies and role titles to search
 * 2. Search LinkedIn for real people at those companies with those titles
 * 3. Deduplicate, score, and save contacts with enrichmentSource = "web_search"
 */

import { invokeLLM } from "./_core/llm";
import { callDataApi } from "./_core/dataApi";
import { getDb } from "./db";
import { contacts, projects, type InsertContact } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { computeVerificationScore, generateLinkedInSearchUrl } from "./verificationScoring";

// ── Types ──

export interface WebDiscoveredContact {
  name: string;
  title: string;
  company: string;
  roleBucket: string;
  email: string | null;
  linkedinUrl: string | null;
  sourceUrl: string;
  sourceSnippet: string;
  confidence: "high" | "medium" | "low";
}

export interface WebDiscoveryResult {
  projectId: number;
  projectName: string;
  contactsFound: number;
  contacts: WebDiscoveredContact[];
  searchQueries: string[];
  sourcesSearched: number;
  source: "web_search";
  durationMs: number;
  errors: string[];
}

// ── Configuration ──

const MAX_CONTACTS_PER_PROJECT = 7;
const MAX_SEARCH_QUERIES = 3;
const MIN_VERIFICATION_SCORE = 55;
const DELAY_BETWEEN_CALLS_MS = 500;

// ── Role bucket normalisation ──

function normalizeRoleBucket(role: string): string {
  const h = role.toLowerCase();
  if (h.includes("procurement") || h.includes("supply chain") || h.includes("purchasing") || h.includes("contracts"))
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

/** Infer a corporate email pattern from name and company */
function inferEmail(name: string, company: string): string | null {
  if (!name || !company) return null;
  const parts = name.toLowerCase().trim().split(/\s+/);
  if (parts.length < 2) return null;
  const first = parts[0].replace(/[^a-z]/g, "");
  const last = parts[parts.length - 1].replace(/[^a-z]/g, "");
  if (!first || !last) return null;

  const domain = company
    .toLowerCase()
    .replace(/\s*(pty|ltd|limited|inc|corp|group|australia|holdings)\s*/gi, "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (!domain) return null;
  return `${first}.${last}@${domain}.com.au`;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── LinkedIn Person type ──

interface LinkedInPerson {
  fullName?: string;
  headline?: string;
  location?: string;
  profileURL?: string;
  username?: string;
  profilePicture?: string;
}

// ── Search Query Builder ──

/**
 * Build targeted search queries to find stakeholders for a project.
 * Returns company + role pairs for LinkedIn search.
 */
export function buildSearchQueries(project: {
  name: string;
  owner: string;
  contractors?: { name: string; status: string }[] | null;
  sector: string;
  location: string;
}): string[] {
  const queries: string[] = [];

  // Query 1: Owner company + project-related roles
  if (project.owner && project.owner !== "Unknown") {
    queries.push(
      `${project.owner} project manager procurement`
    );
  }

  // Query 2: Owner + different roles
  if (project.owner && project.owner !== "Unknown") {
    queries.push(
      `${project.owner} operations director engineering`
    );
  }

  // Query 3: Contractor-focused
  const confirmedContractors = (project.contractors || [])
    .filter(c => c.status === "confirmed" || c.status === "awarded")
    .map(c => c.name)
    .slice(0, 2);

  if (confirmedContractors.length > 0) {
    queries.push(
      `${confirmedContractors[0]} project manager site manager`
    );
  } else {
    queries.push(
      `${project.owner || project.name} site manager maintenance`
    );
  }

  return queries.slice(0, MAX_SEARCH_QUERIES);
}

// ── LinkedIn Search via Data API ──

/**
 * Search LinkedIn for people at a company with a specific role.
 * Uses the working LinkedIn/search_people Data API endpoint.
 */
async function searchLinkedInPeople(
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

    // Detect quota exhaustion from response body
    const msg = result?.message || "";
    if (msg.toLowerCase().includes("exceeded") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("upgrade")) {
      console.warn(`[WebDiscovery] LinkedIn API quota exhausted: ${msg}`);
      throw new Error("QUOTA_EXHAUSTED");
    }

    if (!result?.success || !result?.data?.items?.length) {
      console.log(`[WebDiscovery] No LinkedIn results for "${roleTitle}" at "${company}" (success: ${result?.success}, items: ${result?.data?.items?.length ?? 0})`);
      return [];
    }

    console.log(`[WebDiscovery] Found ${result.data.items.length} LinkedIn results for "${roleTitle}" at "${company}"`);
    return result.data.items.slice(0, 3); // Top 3 per search
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    
    // Re-throw quota exhaustion
    if (errMsg === "QUOTA_EXHAUSTED") throw err;
    
    console.error(`[WebDiscovery] LinkedIn search failed for "${roleTitle}" at "${company}":`, errMsg);

    // Detect quota exhaustion from error message
    if (errMsg.includes("usage exhausted") || errMsg.includes("quota") || errMsg.includes("rate limit") || errMsg.includes("exceeded")) {
      throw new Error("QUOTA_EXHAUSTED");
    }
    return [];
  }
}

// ── LLM-Powered Role Targeting ──

/**
 * Use LLM to determine the best role titles and companies to search
 * for a given project. Returns structured search plan.
 */
async function getSearchPlan(project: {
  name: string;
  owner: string;
  contractors?: { name: string; status: string }[] | null;
  sector: string;
  location: string;
  value?: string;
  stage?: string;
}): Promise<{ company: string; roles: string[] }[]> {
  const contractorsList = (project.contractors || [])
    .filter(c => c.name)
    .map(c => `${c.name} (${c.status})`)
    .join(", ");

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are an Australian industrial market intelligence analyst specialising in mining, energy, and infrastructure projects. You help identify which companies and roles to search for to find project stakeholders who would be decision-makers for compressed air and power equipment purchases.",
        },
        {
          role: "user",
          content: `For the project "${project.name}" (sector: ${project.sector}, owner: ${project.owner}, location: ${project.location}, value: ${project.value || "unknown"}, stage: ${project.stage || "unknown"}, contractors: ${contractorsList || "none identified"}):

Determine the top 2-3 companies and 2-3 role titles per company to search on LinkedIn. Focus on:
- People who make purchasing decisions for equipment (compressors, generators, lighting towers)
- Project managers, procurement managers, site managers, operations managers
- Engineering managers, maintenance managers, fleet managers
- General managers and directors at the owner and key contractors

Return a JSON object with a "searches" array of { company, roles } objects.`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "search_plan",
          strict: true,
          schema: {
            type: "object",
            properties: {
              searches: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    company: { type: "string", description: "Company name to search" },
                    roles: {
                      type: "array",
                      items: { type: "string" },
                      description: "Role titles to search for at this company",
                    },
                  },
                  required: ["company", "roles"],
                  additionalProperties: false,
                },
              },
            },
            required: ["searches"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return [];

    const parsed = JSON.parse(content) as { searches: { company: string; roles: string[] }[] };
    return (parsed.searches || []).slice(0, 3);
  } catch (err) {
    console.error("[WebDiscovery] LLM search plan failed:", err instanceof Error ? err.message : String(err));

    // Fallback: use owner + basic roles
    const fallback: { company: string; roles: string[] }[] = [];
    if (project.owner && project.owner !== "Unknown") {
      fallback.push({
        company: project.owner,
        roles: ["Project Manager", "Procurement Manager", "Operations Manager"],
      });
    }
    const contractors = (project.contractors || []).filter(c => c.status === "confirmed" || c.status === "awarded");
    if (contractors.length > 0) {
      fallback.push({
        company: contractors[0].name,
        roles: ["Project Manager", "Site Manager"],
      });
    }
    return fallback;
  }
}

// ── Core Discovery Function ──

/**
 * Discover stakeholders for a single project using LinkedIn search.
 * Uses LLM to plan searches, then executes LinkedIn queries.
 */
export async function discoverStakeholders(project: {
  id: number;
  reportId: number;
  name: string;
  owner: string;
  contractors?: { name: string; status: string }[] | null;
  sector: string;
  location: string;
  value?: string;
  stage?: string;
}): Promise<WebDiscoveryResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const searchQueries: string[] = [];
  let sourcesSearched = 0;

  // Step 1: Get LLM-powered search plan
  console.log(`[WebDiscovery] Planning stakeholder search for "${project.name}"`);
  const searchPlan = await getSearchPlan(project);

  if (searchPlan.length === 0) {
    return {
      projectId: project.id,
      projectName: project.name,
      contactsFound: 0,
      contacts: [],
      searchQueries: [],
      sourcesSearched: 0,
      source: "web_search",
      durationMs: Date.now() - startTime,
      errors: ["Could not determine search plan"],
    };
  }

  // Step 2: Execute LinkedIn searches
  const allContacts: WebDiscoveredContact[] = [];
  const seenNames = new Set<string>();
  let quotaExhausted = false;

  for (const search of searchPlan) {
    if (allContacts.length >= MAX_CONTACTS_PER_PROJECT || quotaExhausted) break;

    for (const role of search.roles) {
      if (allContacts.length >= MAX_CONTACTS_PER_PROJECT || quotaExhausted) break;

      const queryStr = `${role} at ${search.company}`;
      searchQueries.push(queryStr);

      try {
        const people = await searchLinkedInPeople(search.company, role);
        sourcesSearched++;

        for (const person of people) {
          if (allContacts.length >= MAX_CONTACTS_PER_PROJECT) break;
          if (!person.fullName) continue;

          const nameKey = person.fullName.toLowerCase().trim();
          if (seenNames.has(nameKey)) continue;
          seenNames.add(nameKey);

          const linkedinUrl = person.profileURL ||
            (person.username ? `https://www.linkedin.com/in/${person.username}` : null);

          allContacts.push({
            name: person.fullName,
            title: person.headline || role,
            company: search.company,
            roleBucket: normalizeRoleBucket(person.headline || role),
            email: inferEmail(person.fullName, search.company),
            linkedinUrl,
            sourceUrl: linkedinUrl || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(person.fullName + " " + search.company)}`,
            sourceSnippet: person.headline || `${role} at ${search.company}`,
            confidence: person.headline ? "high" : "medium",
          });
        }

        await sleep(DELAY_BETWEEN_CALLS_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "QUOTA_EXHAUSTED") {
          quotaExhausted = true;
          errors.push("LinkedIn API quota exhausted — stopped early");
          break;
        }
        errors.push(`Search "${queryStr}": ${msg}`);
      }
    }
  }

  console.log(`[WebDiscovery] Found ${allContacts.length} stakeholders for "${project.name}" from ${sourcesSearched} searches`);

  return {
    projectId: project.id,
    projectName: project.name,
    contactsFound: allContacts.length,
    contacts: allContacts,
    searchQueries,
    sourcesSearched,
    source: "web_search",
    durationMs: Date.now() - startTime,
    errors,
  };
}

// ── Save to Database ──

/**
 * Discover stakeholders and save them to the database.
 * Checks for existing contacts to avoid duplicates.
 */
export async function discoverAndSaveStakeholders(project: {
  id: number;
  reportId: number;
  name: string;
  owner: string;
  contractors?: { name: string; status: string }[] | null;
  sector: string;
  location: string;
  value?: string;
  stage?: string;
}): Promise<WebDiscoveryResult> {
  const db = await getDb();
  if (!db) {
    return {
      projectId: project.id,
      projectName: project.name,
      contactsFound: 0,
      contacts: [],
      searchQueries: [],
      sourcesSearched: 0,
      source: "web_search",
      durationMs: 0,
      errors: ["Database not available"],
    };
  }

  // Check if project already has web_search contacts
  const existingWebContacts = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        sql`${contacts.project} = ${project.name}`,
        eq(contacts.enrichmentSource, "web_search")
      )
    )
    .limit(1);

  if (existingWebContacts.length > 0) {
    console.log(`[WebDiscovery] Project "${project.name}" already has web-discovered contacts — skipping`);
    return {
      projectId: project.id,
      projectName: project.name,
      contactsFound: 0,
      contacts: [],
      searchQueries: [],
      sourcesSearched: 0,
      source: "web_search",
      durationMs: 0,
      errors: [],
    };
  }

  // Run discovery
  const result = await discoverStakeholders(project);

  if (result.contacts.length === 0) {
    return result;
  }

  // Save contacts to database
  const priority = project.sector === "mining" || project.sector === "energy" ? "hot" : "warm";
  const savedContacts: WebDiscoveredContact[] = [];

  for (const contact of result.contacts) {
    try {
      // Check for duplicate by name across all projects
      const existing = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(sql`LOWER(${contacts.name}) = LOWER(${contact.name})`)
        .limit(1);

      if (existing.length > 0) {
        console.log(`[WebDiscovery] Skipping duplicate name "${contact.name}" — already exists`);
        continue;
      }

      // Build LinkedIn search URL if no direct URL was found
      const linkedinSearchUrl = contact.linkedinUrl || generateLinkedInSearchUrl(contact.name, contact.company, contact.title);

      const contactData: InsertContact = {
        reportId: project.reportId,
        name: contact.name,
        title: contact.title,
        company: contact.company,
        project: project.name,
        priority,
        roleBucket: contact.roleBucket,
        email: contact.email,
        linkedin: null,
        enrichmentStatus: "enriched",
        enrichmentSource: "web_search",
        sourceUrl: contact.sourceUrl,
        enrichedAt: new Date(),
        linkedinHeadline: contact.title,
        linkedinLocation: null,
        linkedinProfilePic: null,
        verificationStatus: contact.confidence === "high" ? "verified" : "ai_suggested",
        confidenceScore: contact.confidence,
        linkedinSearchUrl,
        linkedinProfileUrl: contact.linkedinUrl || null,
        emailVerified: false,
      };

      // Compute verification score
      const scoreBreakdown = computeVerificationScore(contactData);
      (contactData as any).verificationScore = scoreBreakdown.total;

      // Quality gate
      if (scoreBreakdown.total < MIN_VERIFICATION_SCORE) {
        console.log(`[WebDiscovery] Rejecting "${contact.name}" — score ${scoreBreakdown.total} < ${MIN_VERIFICATION_SCORE}`);
        continue;
      }

      await db.insert(contacts).values(contactData);
      savedContacts.push(contact);
    } catch (err) {
      console.error(`[WebDiscovery] Failed to save "${contact.name}":`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[WebDiscovery] Saved ${savedContacts.length} web-discovered contacts for "${project.name}"`);

  return {
    ...result,
    contactsFound: savedContacts.length,
    contacts: savedContacts,
  };
}

// ── Bulk Discovery ──

/**
 * Run web stakeholder discovery on projects that have no contacts yet.
 * Processes projects in batches with delays to avoid rate limiting.
 */
export async function runBulkWebDiscovery(
  maxProjects: number = 50,
): Promise<{
  processed: number;
  contactsFound: number;
  results: WebDiscoveryResult[];
  errors: string[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Find active projects with NO contacts at all
  const projectsWithoutContacts = await db
    .select({
      id: projects.id,
      reportId: projects.reportId,
      name: projects.name,
      owner: projects.owner,
      contractors: projects.contractors,
      sector: projects.sector,
      location: projects.location,
      value: projects.value,
      stage: projects.stage,
    })
    .from(projects)
    .where(
      and(
        eq(projects.lifecycleStatus, "active"),
        sql`${projects.id} NOT IN (
          SELECT DISTINCT cp.projectId FROM contactProjects cp
          UNION
          SELECT DISTINCT p2.id FROM projects p2 INNER JOIN contacts c ON c.project = p2.name
        )`
      )
    )
    .limit(maxProjects);

  console.log(`[WebDiscovery Bulk] Found ${projectsWithoutContacts.length} projects without contacts`);

  const results: WebDiscoveryResult[] = [];
  let totalContacts = 0;
  const errors: string[] = [];

  let quotaExhausted = false;

  for (const project of projectsWithoutContacts) {
    if (quotaExhausted) break;

    try {
      const contractorsList = Array.isArray(project.contractors)
        ? (project.contractors as { name: string; status: string }[])
        : [];

      const result = await discoverAndSaveStakeholders({
        ...project,
        owner: project.owner || "Unknown",
        contractors: contractorsList,
        sector: project.sector || "infrastructure",
        location: project.location || "Australia",
        value: project.value || undefined,
        stage: project.stage || undefined,
      });

      results.push(result);
      totalContacts += result.contactsFound;

      // Check if quota was exhausted during this project's discovery
      if (result.errors.some(e => e.includes("quota"))) {
        quotaExhausted = true;
        errors.push("LinkedIn API monthly quota exhausted — stopped processing remaining projects");
        console.warn(`[WebDiscovery Bulk] Quota exhausted after processing ${results.length} projects`);
        break;
      }

      // Delay between projects to avoid rate limiting (1.5s)
      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("QUOTA_EXHAUSTED") || msg.includes("quota")) {
        quotaExhausted = true;
        errors.push("LinkedIn API monthly quota exhausted — stopped processing remaining projects");
        console.warn(`[WebDiscovery Bulk] Quota exhausted after processing ${results.length} projects`);
        break;
      }
      errors.push(`Project ${project.name}: ${msg}`);
      console.error(`[WebDiscovery Bulk] Error on "${project.name}":`, msg);
    }
  }

  return {
    processed: projectsWithoutContacts.length,
    contactsFound: totalContacts,
    results,
    errors,
  };
}

// ── Exports for testing ──

export {
  normalizeRoleBucket as _normalizeRoleBucket,
  inferEmail as _inferEmail,
  searchLinkedInPeople as _searchLinkedInPeople,
  getSearchPlan as _getSearchPlan,
};
