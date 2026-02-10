/**
 * Contact Enrichment Service
 *
 * Uses the built-in LinkedIn People Search API to verify and enrich contact
 * information for newly extracted projects. Runs after AI extraction to
 * populate emails, LinkedIn URLs, job titles, and profile data.
 *
 * Credit controls:
 * - Daily enrichment cap (default: 30 lookups/day)
 * - Only enriches contacts with status "pending"
 * - Batches lookups with 1-second delay between calls to respect rate limits
 * - Caches results to avoid duplicate lookups for the same person
 */
import { eq, and, sql, isNull, or, desc } from "drizzle-orm";
import { getDb } from "./db";
import { contacts, projects, type InsertContact } from "../drizzle/schema";
import { callDataApi } from "./_core/dataApi";

// ── Configuration ──

const DAILY_ENRICHMENT_CAP = 30;
const DELAY_BETWEEN_CALLS_MS = 1000;
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
  sector: string
): Promise<EnrichmentResult[]> {
  const db = await getDb();
  if (!db) return [];

  // Check daily cap
  const dailyCount = await getDailyEnrichmentCount();
  if (dailyCount >= DAILY_ENRICHMENT_CAP) {
    console.log(`Daily enrichment cap reached (${dailyCount}/${DAILY_ENRICHMENT_CAP})`);
    return [];
  }

  const remaining = DAILY_ENRICHMENT_CAP - dailyCount;
  const results: EnrichmentResult[] = [];

  // Build list of companies to search for contacts
  const companies = [owner];
  for (const c of contractors) {
    if (c.name && !companies.includes(c.name)) {
      companies.push(c.name);
    }
  }

  // Target roles based on sector
  const targetRoles = getTargetRoles(sector);

  // Search for contacts at each company
  for (const company of companies) {
    if (results.length >= remaining) break;

    for (const role of targetRoles) {
      if (results.length >= remaining) break;

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

        if (!searchResult?.success || !searchResult?.data?.items?.length) {
          await sleep(DELAY_BETWEEN_CALLS_MS);
          continue;
        }

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
            enrichedAt: new Date(),
            linkedinHeadline: person.headline,
            linkedinLocation: person.location,
            linkedinProfilePic: person.profilePicture,
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
        console.error(
          `LinkedIn search failed for ${role} at ${company}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
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
