/**
 * Contact Enrichment Service
 *
 * Uses the built-in LinkedIn People Search API to verify and enrich contact
 * information for newly extracted projects. Runs after AI extraction to
 * populate emails, LinkedIn URLs, job titles, and profile data.
 *
 * Credit controls:
 * - Daily enrichment cap (default: 500 lookups/day)
 * - Only enriches contacts with status "pending"
 * - Batches lookups with 1-second delay between calls to respect rate limits
 * - Caches results to avoid duplicate lookups for the same person
 */
import { eq, and, sql, isNull, or, desc, gte } from "drizzle-orm";
import { getDb } from "./db";
import { contacts, projects, userProfiles, projectEnrichmentCache, type InsertContact } from "../drizzle/schema";
import { classifyRoleRelevance } from "./roleRelevance";
import { callDataApi } from "./_core/dataApi";

// ── Configuration ──

const DAILY_ENRICHMENT_CAP = 500;
const DELAY_BETWEEN_CALLS_MS = 500;
const CACHE_TTL_DAYS = 30; // Re-enrichment allowed after 30 days
const BUYER_ROLES = [
  "procurement",
  "project_manager",
  "engineering",
  "operations",
  "maintenance",
  "site_manager",
  "fleet_manager",
  "general_manager",
];

// ── Types ──

interface LinkedInPerson {
  fullName?: string;
  headline?: string;
  location?: string;
  profileURL?: string;
  username?: string;
  profilePicture?: string;
  summary?: string;
}

interface EnrichmentResult {
  contactId: number;
  name: string;
  status: "enriched" | "not_found" | "failed";
  linkedinUrl?: string;
  headline?: string;
  location?: string;
  profilePic?: string;
  error?: string;
}

interface EnrichmentSummary {
  processed: number;
  enriched: number;
  notFound: number;
  failed: number;
  dailyUsed: number;
  dailyCap: number;
  results: EnrichmentResult[];
}

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Infer a corporate email pattern from name and company */
function inferEmail(name: string, company: string): string | null {
  if (!name || !company) return null;
  const parts = name.toLowerCase().trim().split(/\s+/);
  if (parts.length < 2) return null;
  const first = parts[0].replace(/[^a-z]/g, "");
  const last = parts[parts.length - 1].replace(/[^a-z]/g, "");
  if (!first || !last) return null;

  // Clean company domain
  const domain = company
    .toLowerCase()
    .replace(/\s*(pty|ltd|limited|inc|corp|group|australia|holdings)\s*/gi, "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (!domain) return null;
  return `${first}.${last}@${domain}.com.au`;
}

/** Map a LinkedIn headline to a role bucket */
function inferRoleBucket(headline: string): string {
  const h = headline.toLowerCase();
  if (h.includes("procurement") || h.includes("supply chain") || h.includes("purchasing"))
    return "procurement";
  if (h.includes("project manager") || h.includes("project director"))
    return "project_manager";
  if (h.includes("engineer") || h.includes("engineering"))
    return "engineering";
  if (h.includes("operations") || h.includes("ops manager"))
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
  return "other";
}

// ── Get daily enrichment count ──

async function getDailyEnrichmentCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contacts)
    .where(
      and(
        or(
          eq(contacts.enrichmentStatus, "enriched"),
          eq(contacts.enrichmentStatus, "not_found")
        ),
        sql`${contacts.enrichedAt} >= ${today}`
      )
    );

  return Number(result.count);
}

// ── Search LinkedIn for a person ──

async function searchLinkedIn(
  name: string,
  company: string,
  title?: string
): Promise<LinkedInPerson | null> {
  try {
    const queryParts = [name];
    if (company) queryParts.push(company);

    const result = (await callDataApi("LinkedIn/search_people", {
      query: {
        keywords: queryParts.join(" "),
        ...(company ? { company } : {}),
        ...(title ? { keywordTitle: title } : {}),
      },
    })) as {
      success?: boolean;
      data?: { items?: LinkedInPerson[]; total?: number };
    };

    if (!result?.success || !result?.data?.items?.length) {
      return null;
    }

    // Find best match by name similarity
    const nameLower = name.toLowerCase().trim();
    const items = result.data.items;

    // Try exact name match first
    for (const person of items) {
      const fullName = (person.fullName || "").toLowerCase().trim();
      if (fullName === nameLower) return person;
    }

    // Try partial match (first + last name)
    const nameParts = nameLower.split(/\s+/);
    if (nameParts.length >= 2) {
      const firstName = nameParts[0];
      const lastName = nameParts[nameParts.length - 1];
      for (const person of items) {
        const fullName = (person.fullName || "").toLowerCase().trim();
        if (fullName.includes(firstName) && fullName.includes(lastName)) {
          return person;
        }
      }
    }

    // Return first result if no name match (LinkedIn search is already filtered)
    return items[0] || null;
  } catch (err: unknown) {
    console.error(
      `LinkedIn search failed for ${name}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

// ── Enrich a single contact ──

async function enrichContact(
  contactId: number,
  name: string,
  company: string,
  title: string
): Promise<EnrichmentResult> {
  try {
    const person = await searchLinkedIn(name, company, title);

    if (!person) {
      return {
        contactId,
        name,
        status: "not_found",
      };
    }

    const linkedinUrl = person.profileURL || (person.username ? `https://www.linkedin.com/in/${person.username}` : undefined);

    return {
      contactId,
      name,
      status: "enriched",
      linkedinUrl,
      headline: person.headline,
      location: person.location,
      profilePic: person.profilePicture,
    };
  } catch (err: unknown) {
    return {
      contactId,
      name,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Enrich contacts for a specific project ──

export async function enrichContactsForProject(projectId: number): Promise<EnrichmentResult[]> {
  const db = await getDb();
  if (!db) return [];

  const projectContacts = await db
    .select()
    .from(contacts)
    .where(
      and(
        sql`${contacts.project} IN (SELECT name FROM projects WHERE id = ${projectId})`,
        or(
          eq(contacts.enrichmentStatus, "pending"),
          isNull(contacts.enrichmentStatus)
        )
      )
    );

  const results: EnrichmentResult[] = [];

  for (const contact of projectContacts) {
    const result = await enrichContact(
      contact.id,
      contact.name,
      contact.company,
      contact.title
    );

    // Update contact record
    await db
      .update(contacts)
      .set({
        enrichmentStatus: result.status,
        enrichedAt: new Date(),
        linkedin: result.linkedinUrl || contact.linkedin,
        linkedinHeadline: result.headline,
        linkedinLocation: result.location,
        linkedinProfilePic: result.profilePic,
        // Infer email if not already set
        email: contact.email || inferEmail(contact.name, contact.company),
        // Update role bucket if we got a better one from LinkedIn
        roleBucket: result.headline
          ? inferRoleBucket(result.headline)
          : contact.roleBucket,
      })
      .where(eq(contacts.id, contact.id));

    results.push(result);
    await sleep(DELAY_BETWEEN_CALLS_MS);
  }

  return results;
}

// ── Generate contacts for a newly extracted project using LLM + LinkedIn ──

export async function generateAndEnrichContacts(
  projectId: number,
  reportId: number,
  projectName: string,
  owner: string,
  contractors: { name: string; status: string }[],
  sector: string,
  options?: {
    userId?: number | null;           // User requesting enrichment (null = auto/scraper)
    preferredRoles?: string[] | null; // User's preferred buyer roles from profile
    skipCacheCheck?: boolean;         // Force re-enrichment even if cached
  }
): Promise<EnrichmentResult[]> {
  const db = await getDb();
  if (!db) return [];

  const userId = options?.userId ?? null;

  // Check cache first (unless explicitly skipped)
  if (!options?.skipCacheCheck) {
    const cache = await getProjectEnrichmentCache(projectId);
    if (cache.cached) {
      console.log(`[Enrichment] Cache hit for project ${projectId} (enriched ${cache.enrichedAt?.toISOString()}, ${cache.contactsFound} contacts found)`);
      return []; // Return empty — contacts are already in DB
    }
  }

  // Check daily cap
  const dailyCount = await getDailyEnrichmentCount();
  if (dailyCount >= DAILY_ENRICHMENT_CAP) {
    console.log(`Daily enrichment cap reached (${dailyCount}/${DAILY_ENRICHMENT_CAP})`);
    return [];
  }

  const remaining = DAILY_ENRICHMENT_CAP - dailyCount;
  const results: EnrichmentResult[] = [];
  let apiCallsMade = 0;

  // Build list of companies to search for contacts
  const companies = [owner];
  for (const c of contractors) {
    if (c.name && !companies.includes(c.name)) {
      companies.push(c.name);
    }
  }

  // Target roles: prefer user's profile roles, fall back to sector-based defaults
  const targetRoles = (options?.preferredRoles && options.preferredRoles.length > 0)
    ? mapBuyerRolesToSearchTitles(options.preferredRoles)
    : getTargetRoles(sector);

  // Search for contacts at each company
  let quotaExhausted = false;
  for (const company of companies) {
    if (results.length >= remaining || quotaExhausted) break;

    for (const role of targetRoles) {
      if (results.length >= remaining || quotaExhausted) break;

      try {
        const searchResult = (await callDataApi("LinkedIn/search_people", {
          query: {
            keywords: `${role} ${company}`,
            company,
            keywordTitle: role,
          },
        })) as {
          success?: boolean;
          data?: { items?: LinkedInPerson[]; total?: number };
        };

        apiCallsMade++;

        if (!searchResult?.success || !searchResult?.data?.items?.length) {
          console.log(`[Enrichment] No results for "${role}" at "${company}" (success: ${searchResult?.success}, items: ${searchResult?.data?.items?.length ?? 0})`);
          await sleep(DELAY_BETWEEN_CALLS_MS);
          continue;
        }

        console.log(`[Enrichment] Found ${searchResult.data.items.length} results for "${role}" at "${company}"`);

        // Take up to 2 people per role per company
        const people = searchResult.data.items.slice(0, 2);

        for (const person of people) {
          if (results.length >= remaining) break;
          if (!person.fullName) continue;

          // Check if contact already exists
          const existing = await db
            .select({ id: contacts.id })
            .from(contacts)
            .where(
              and(
                sql`LOWER(${contacts.name}) = LOWER(${person.fullName})`,
                sql`LOWER(${contacts.company}) = LOWER(${company})`
              )
            )
            .limit(1);

          if (existing.length > 0) continue;

          const linkedinUrl =
            person.profileURL ||
            (person.username
              ? `https://www.linkedin.com/in/${person.username}`
              : null);

          const roleBucket = person.headline
            ? inferRoleBucket(person.headline)
            : "other";

          // Insert the contact
          const roleRelevance = classifyRoleRelevance(person.headline || role, roleBucket);

          const contactData: InsertContact = {
            reportId,
            name: person.fullName,
            title: person.headline || role,
            company,
            project: projectName,
            priority: company === owner ? "hot" : "warm",
            roleBucket,
            email: inferEmail(person.fullName, company),
            linkedin: linkedinUrl,
            enrichmentStatus: "enriched",
            enrichmentSource: "linkedin",
            enrichedAt: new Date(),
            linkedinHeadline: person.headline,
            linkedinLocation: person.location,
            linkedinProfilePic: person.profilePicture,
            roleRelevance,
          };

          await db.insert(contacts).values(contactData);

          results.push({
            contactId: 0, // Will be auto-assigned
            name: person.fullName,
            status: "enriched",
            linkedinUrl: linkedinUrl || undefined,
            headline: person.headline,
            location: person.location,
            profilePic: person.profilePicture,
          });
        }

        await sleep(DELAY_BETWEEN_CALLS_MS);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`LinkedIn search failed for ${role} at ${company}: ${errMsg}`);

        // Detect quota exhaustion and stop immediately — don't waste time on more calls
        if (errMsg.includes('usage exhausted') || errMsg.includes('quota') || errMsg.includes('rate limit')) {
          console.warn(`[Enrichment] LinkedIn API quota exhausted — stopping enrichment for project ${projectId}`);
          quotaExhausted = true;
          break;
        }
      }
    }
  }

  // Only cache if we actually made API calls (don't cache cap-blocked attempts)
  // Also don't cache 0-contact results from genuine searches — allow retry
  if (apiCallsMade > 0 && results.length > 0) {
    await writeEnrichmentCache(
      projectId,
      userId,
      targetRoles,
      companies,
      results.length,
      results.length, // all are new (duplicates were skipped)
      apiCallsMade
    );
  } else if (apiCallsMade > 0 && results.length === 0) {
    // Cache 0-result searches for only 1 day (not full TTL) to allow retry soon
    await writeEnrichmentCache(
      projectId,
      userId,
      targetRoles,
      companies,
      0,
      0,
      apiCallsMade
    );
  }
  // If apiCallsMade === 0, we were blocked by daily cap — don't cache at all
  // If quota was exhausted, don't cache — allow immediate retry when quota resets
  if (quotaExhausted) {
    console.log(`[Enrichment] Project ${projectId}: quota exhausted, ${results.length} contacts found before quota hit — NOT caching`);
    // Throw a specific error so the caller can detect quota exhaustion and fallback to LLM
    if (results.length === 0) {
      throw new Error(`LinkedIn API usage exhausted — quota depleted for project ${projectId}`);
    }
  } else {
    console.log(`[Enrichment] Project ${projectId}: ${results.length} contacts found, ${apiCallsMade} API calls`);
  }

  return results;
}

// ── Run enrichment on all pending contacts ──

export async function runEnrichmentPipeline(
  maxContacts?: number
): Promise<EnrichmentSummary> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check daily cap
  const dailyCount = await getDailyEnrichmentCount();
  const remaining = Math.max(0, DAILY_ENRICHMENT_CAP - dailyCount);
  const limit = maxContacts ? Math.min(maxContacts, remaining) : remaining;

  if (limit === 0) {
    return {
      processed: 0,
      enriched: 0,
      notFound: 0,
      failed: 0,
      dailyUsed: dailyCount,
      dailyCap: DAILY_ENRICHMENT_CAP,
      results: [],
    };
  }

  // Get pending contacts
  const pendingContacts = await db
    .select()
    .from(contacts)
    .where(
      or(
        eq(contacts.enrichmentStatus, "pending"),
        isNull(contacts.enrichmentStatus)
      )
    )
    .orderBy(desc(contacts.createdAt))
    .limit(limit);

  if (pendingContacts.length === 0) {
    return {
      processed: 0,
      enriched: 0,
      notFound: 0,
      failed: 0,
      dailyUsed: dailyCount,
      dailyCap: DAILY_ENRICHMENT_CAP,
      results: [],
    };
  }

  const allResults: EnrichmentResult[] = [];
  let enriched = 0;
  let notFound = 0;
  let failed = 0;

  for (const contact of pendingContacts) {
    const result = await enrichContact(
      contact.id,
      contact.name,
      contact.company,
      contact.title
    );

    // Update contact record
    const updateData: Record<string, unknown> = {
      enrichmentStatus: result.status,
      enrichedAt: new Date(),
    };

    if (result.status === "enriched") {
      if (result.linkedinUrl) updateData.linkedin = result.linkedinUrl;
      if (result.headline) updateData.linkedinHeadline = result.headline;
      if (result.location) updateData.linkedinLocation = result.location;
      if (result.profilePic) updateData.linkedinProfilePic = result.profilePic;
      if (!contact.email) {
        const inferred = inferEmail(contact.name, contact.company);
        if (inferred) updateData.email = inferred;
      }
      if (result.headline) {
        updateData.roleBucket = inferRoleBucket(result.headline);
      }
      enriched++;
    } else if (result.status === "not_found") {
      // Still infer email even if LinkedIn not found
      if (!contact.email) {
        const inferred = inferEmail(contact.name, contact.company);
        if (inferred) updateData.email = inferred;
      }
      notFound++;
    } else {
      failed++;
    }

    await db.update(contacts).set(updateData).where(eq(contacts.id, contact.id));
    allResults.push(result);
    await sleep(DELAY_BETWEEN_CALLS_MS);
  }

  return {
    processed: pendingContacts.length,
    enriched,
    notFound,
    failed,
    dailyUsed: dailyCount + pendingContacts.length,
    dailyCap: DAILY_ENRICHMENT_CAP,
    results: allResults,
  };
}

// ── Target roles by sector ──

function getTargetRoles(sector: string): string[] {
  const baseRoles = [
    "Project Manager",
    "Procurement Manager",
    "Operations Manager",
  ];

  const sectorRoles: Record<string, string[]> = {
    mining: [
      "Mining Manager",
      "Site Manager",
      "Fleet Manager",
      "Maintenance Superintendent",
      "Chief Operating Officer",
    ],
    oil_gas: [
      "Facilities Manager",
      "Construction Manager",
      "Commissioning Manager",
      "HSE Manager",
    ],
    infrastructure: [
      "Construction Manager",
      "Site Superintendent",
      "Plant Manager",
      "Engineering Manager",
    ],
    energy: [
      "Plant Manager",
      "Engineering Manager",
      "Maintenance Manager",
      "Technical Director",
    ],
    defence: [
      "Program Manager",
      "Technical Director",
      "Logistics Manager",
      "Engineering Director",
    ],
  };

  return [...baseRoles, ...(sectorRoles[sector] || [])];
}

// ── Cache helpers ──

/** Check if a project was recently enriched (within CACHE_TTL_DAYS) */
export async function getProjectEnrichmentCache(
  projectId: number
): Promise<{ cached: boolean; enrichedAt?: Date; contactsFound?: number; rolesSearched?: string[]; apiCallsMade?: number }> {
  const db = await getDb();
  if (!db) return { cached: false };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CACHE_TTL_DAYS);

  const [entry] = await db
    .select()
    .from(projectEnrichmentCache)
    .where(
      and(
        eq(projectEnrichmentCache.projectId, projectId),
        gte(projectEnrichmentCache.enrichedAt, cutoff)
      )
    )
    .orderBy(desc(projectEnrichmentCache.enrichedAt))
    .limit(1);

  if (!entry) return { cached: false };

  // If 0 contacts were found, only cache for 1 day (allow retry sooner)
  if (entry.contactsFound === 0) {
    const shortCutoff = new Date();
    shortCutoff.setDate(shortCutoff.getDate() - 1);
    if (entry.enrichedAt < shortCutoff) {
      return { cached: false };
    }
  }

  return {
    cached: true,
    enrichedAt: entry.enrichedAt,
    contactsFound: entry.contactsFound,
    rolesSearched: entry.rolesSearched ?? [],
    apiCallsMade: entry.apiCallsMade,
  };
}

/** Write an enrichment cache entry after a successful enrichment */
async function writeEnrichmentCache(
  projectId: number,
  userId: number | null,
  rolesSearched: string[],
  companiesSearched: string[],
  contactsFound: number,
  contactsNew: number,
  apiCallsMade: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.insert(projectEnrichmentCache).values({
    projectId,
    userId,
    rolesSearched,
    companiesSearched,
    contactsFound,
    contactsNew,
    apiCallsMade,
    enrichedAt: new Date(),
  });
}

/** Get user's preferred buyer roles from their onboarding profile */
export async function getUserPreferredRoles(userId: number): Promise<string[] | null> {
  const db = await getDb();
  if (!db) return null;

  const [profile] = await db
    .select({ buyerRoles: userProfiles.buyerRoles })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  if (!profile?.buyerRoles || profile.buyerRoles.length === 0) return null;
  return profile.buyerRoles;
}

/** Map user's buyer role preferences to LinkedIn search titles */
export function mapBuyerRolesToSearchTitles(buyerRoles: string[]): string[] {
  const roleMapping: Record<string, string[]> = {
    procurement: ["Procurement Manager", "Supply Chain Manager", "Purchasing Manager"],
    project_manager: ["Project Manager", "Project Director"],
    engineering: ["Engineering Manager", "Chief Engineer", "Technical Director"],
    operations: ["Operations Manager", "Chief Operating Officer"],
    maintenance: ["Maintenance Manager", "Maintenance Superintendent", "Reliability Manager"],
    site_manager: ["Site Manager", "Site Superintendent"],
    fleet_manager: ["Fleet Manager", "Equipment Manager"],
    general_manager: ["General Manager", "Managing Director", "CEO"],
    commercial: ["Commercial Manager", "Business Development Manager"],
    mining_manager: ["Mining Manager", "Mine Manager"],
    construction_manager: ["Construction Manager", "Construction Director"],
    plant_manager: ["Plant Manager"],
  };

  const titles: string[] = [];
  for (const role of buyerRoles) {
    const mapped = roleMapping[role];
    if (mapped) {
      titles.push(...mapped);
    } else {
      // Use the role as-is if no mapping exists (e.g., custom roles)
      titles.push(role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
    }
  }

  // Deduplicate
  return Array.from(new Set(titles));
}

// ── Get enrichment stats ──

export async function getEnrichmentStats(): Promise<{
  total: number;
  enriched: number;
  pending: number;
  notFound: number;
  failed: number;
  dailyUsed: number;
  dailyCap: number;
}> {
  const db = await getDb();
  if (!db) return { total: 0, enriched: 0, pending: 0, notFound: 0, failed: 0, dailyUsed: 0, dailyCap: DAILY_ENRICHMENT_CAP };

  const [total] = await db.select({ count: sql<number>`count(*)` }).from(contacts);
  const [enrichedCount] = await db.select({ count: sql<number>`count(*)` }).from(contacts).where(eq(contacts.enrichmentStatus, "enriched"));
  const [pendingCount] = await db.select({ count: sql<number>`count(*)` }).from(contacts).where(or(eq(contacts.enrichmentStatus, "pending"), isNull(contacts.enrichmentStatus)));
  const [notFoundCount] = await db.select({ count: sql<number>`count(*)` }).from(contacts).where(eq(contacts.enrichmentStatus, "not_found"));
  const [failedCount] = await db.select({ count: sql<number>`count(*)` }).from(contacts).where(eq(contacts.enrichmentStatus, "failed"));

  const dailyUsed = await getDailyEnrichmentCount();

  return {
    total: Number(total.count),
    enriched: Number(enrichedCount.count),
    pending: Number(pendingCount.count),
    notFound: Number(notFoundCount.count),
    failed: Number(failedCount.count),
    dailyUsed,
    dailyCap: DAILY_ENRICHMENT_CAP,
  };
}
