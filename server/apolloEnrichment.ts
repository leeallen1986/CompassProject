/**
 * Apollo.io Contact Enrichment Service
 *
 * Two-step enrichment flow:
 * 1. People API Search (free, no credits) — find contacts by company domain + job titles
 *    Returns: first_name, last_name_obfuscated, title, id, has_email flags
 * 2. People Enrichment (1 credit each) — get full name, verified email, LinkedIn URL
 *
 * Design decisions:
 * - No phone numbers pulled (per user request)
 * - Emails only via People Enrichment (People Search doesn't return them)
 * - Contacts stored with enrichmentSource = "apollo"
 * - Deduplication by name + company before inserting
 */

import { eq, and, sql, or, isNull, desc, gte } from "drizzle-orm";
import { getDb } from "./db";
import {
  contacts,
  projects,
  projectEnrichmentCache,
  apolloCreditLog,
  contactProjects,
  type InsertContact,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { cleanContactName } from "./nameUtils";

// ── Configuration ──

const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";
const DELAY_BETWEEN_CALLS_MS = 500;
const SEARCH_RESULTS_PER_PAGE = 25;
const MAX_CONTACTS_PER_COMPANY = 5;

// ── Types ──

/** People API Search response — obfuscated, no emails, no full last name */
interface ApolloPersonSearch {
  id: string;
  first_name: string;
  last_name_obfuscated: string; // e.g. "Co***s"
  title: string;
  last_refreshed_at: string | null;
  has_email: boolean;
  has_city: boolean;
  has_state: boolean;
  has_country: boolean;
  has_direct_phone: string | null; // "Yes" or null
  organization?: {
    name: string;
    has_industry: boolean;
    has_phone: boolean;
    has_city: boolean;
    has_state: boolean;
    has_country: boolean;
    has_zip_code: boolean;
    has_revenue: boolean;
    has_employee_count: boolean;
  };
}

/** People Enrichment response — full details, costs 1 credit */
interface ApolloPersonEnriched {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  email: string | null;
  email_status: string | null;
  linkedin_url: string | null;
  photo_url: string | null;
  headline: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  organization_id: string | null;
  organization?: {
    name: string;
    website_url: string | null;
    primary_domain: string | null;
  };
  seniority: string | null;
  departments: string[];
  employment_history?: {
    organization_name: string;
    title: string;
    current: boolean;
    start_date: string | null;
  }[];
}

interface ApolloSearchResponse {
  people: ApolloPersonSearch[];
  total_entries: number;
}

interface ApolloEnrichResponse {
  person: ApolloPersonEnriched | null;
}

export interface ApolloEnrichmentResult {
  contactId: number;
  apolloId: string;
  name: string;           // "Franchesca Co***s" from search, full name after enrichment
  firstName: string;
  lastNameObfuscated?: string;
  title: string;
  company: string;
  email: string | null;
  emailStatus: string | null;
  linkedinUrl: string | null;
  photoUrl: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  seniority: string | null;
  hasEmail: boolean;
  status: "found" | "enriched" | "not_found" | "failed";
  error?: string;
}

export interface ApolloSearchResult {
  people: ApolloEnrichmentResult[];
  totalFound: number;
  searchCreditsUsed: number; // Always 0 — People Search is free
  enrichCreditsUsed: number;
}

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getApiKey(): string {
  const key = ENV.apolloApiKey;
  if (!key) {
    throw new Error("APOLLO_API_KEY is not configured. Set it in your environment variables.");
  }
  return key;
}

/** Map a title to a role bucket for our system */
function inferRoleBucket(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("procurement") || t.includes("supply chain") || t.includes("purchasing"))
    return "procurement";
  if (t.includes("project manager") || t.includes("project director"))
    return "project_manager";
  if (t.includes("engineer") || t.includes("engineering"))
    return "engineering";
  if (t.includes("operations") || t.includes("ops manager"))
    return "operations";
  if (t.includes("maintenance") || t.includes("reliability"))
    return "maintenance";
  if (t.includes("site manager") || t.includes("site superintendent"))
    return "site_manager";
  if (t.includes("fleet") || t.includes("equipment"))
    return "fleet_manager";
  if (
    t.includes("general manager") ||
    t.includes("managing director") ||
    t.includes("ceo") ||
    t.includes("director")
  )
    return "general_manager";
  if (t.includes("commercial") || t.includes("business development"))
    return "commercial";
  return "other";
}

// ── Credit Logging ──

/** Log an Apollo credit usage event to the database */
export async function logCreditUsage(params: {
  userId: number;
  userName: string;
  action: "reveal" | "enrich_project" | "verify_email";
  creditsUsed: number;
  contactId?: number | null;
  contactName?: string | null;
  projectId?: number | null;
  projectName?: string | null;
  apolloPersonId?: string | null;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(apolloCreditLog).values({
      userId: params.userId,
      userName: params.userName,
      action: params.action,
      creditsUsed: params.creditsUsed,
      contactId: params.contactId ?? null,
      contactName: params.contactName ?? null,
      projectId: params.projectId ?? null,
      projectName: params.projectName ?? null,
      apolloPersonId: params.apolloPersonId ?? null,
    });
  } catch (err) {
    console.error("[Apollo] Failed to log credit usage:", err instanceof Error ? err.message : String(err));
  }
}

/** Get credit usage summary for a given period */
export async function getCreditUsageSummary(options?: {
  since?: Date;
  userId?: number;
}): Promise<{
  totalCredits: number;
  byUser: { userId: number; userName: string; credits: number }[];
  byAction: { action: string; credits: number; count: number }[];
  recentActivity: {
    id: number;
    userId: number;
    userName: string | null;
    action: string;
    creditsUsed: number;
    contactName: string | null;
    projectName: string | null;
    createdAt: Date | null;
  }[];
}> {
  const db = await getDb();
  if (!db) return { totalCredits: 0, byUser: [], byAction: [], recentActivity: [] };

  const since = options?.since ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1); // Default: start of current month

  // Total credits this period
  const [totalRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${apolloCreditLog.creditsUsed}), 0)` })
    .from(apolloCreditLog)
    .where(gte(apolloCreditLog.createdAt, since));

  // By user
  const byUser = await db
    .select({
      userId: apolloCreditLog.userId,
      userName: apolloCreditLog.userName,
      credits: sql<number>`SUM(${apolloCreditLog.creditsUsed})`,
    })
    .from(apolloCreditLog)
    .where(gte(apolloCreditLog.createdAt, since))
    .groupBy(apolloCreditLog.userId, apolloCreditLog.userName)
    .orderBy(sql`SUM(${apolloCreditLog.creditsUsed}) DESC`);

  // By action type
  const byAction = await db
    .select({
      action: apolloCreditLog.action,
      credits: sql<number>`SUM(${apolloCreditLog.creditsUsed})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(apolloCreditLog)
    .where(gte(apolloCreditLog.createdAt, since))
    .groupBy(apolloCreditLog.action);

  // Recent activity (last 50)
  const recentActivity = await db
    .select({
      id: apolloCreditLog.id,
      userId: apolloCreditLog.userId,
      userName: apolloCreditLog.userName,
      action: apolloCreditLog.action,
      creditsUsed: apolloCreditLog.creditsUsed,
      contactName: apolloCreditLog.contactName,
      projectName: apolloCreditLog.projectName,
      createdAt: apolloCreditLog.createdAt,
    })
    .from(apolloCreditLog)
    .where(gte(apolloCreditLog.createdAt, since))
    .orderBy(desc(apolloCreditLog.createdAt))
    .limit(50);

  return {
    totalCredits: Number(totalRow?.total ?? 0),
    byUser: byUser.map(r => ({ userId: r.userId, userName: r.userName ?? "Unknown", credits: Number(r.credits) })),
    byAction: byAction.map(r => ({ action: r.action, credits: Number(r.credits), count: Number(r.count) })),
    recentActivity,
  };
}

// ── Apollo API Calls ──

/**
 * People API Search — FREE, no credits consumed.
 * Finds people by company domain, job titles, seniority, location.
 * Returns: first_name, last_name_obfuscated, title, id, has_email flags.
 * Does NOT return email addresses, full last names, or LinkedIn URLs.
 */
export async function apolloPeopleSearch(params: {
  organizationDomains?: string[];
  organizationName?: string;
  personTitles?: string[];
  personSeniorities?: string[];
  personLocations?: string[];
  organizationLocations?: string[];
  keywords?: string;
  page?: number;
  perPage?: number;
}): Promise<ApolloSearchResponse> {
  const apiKey = getApiKey();

  const body: Record<string, unknown> = {
    page: params.page ?? 1,
    per_page: params.perPage ?? SEARCH_RESULTS_PER_PAGE,
  };

  if (params.organizationDomains?.length) {
    body.q_organization_domains_list = params.organizationDomains;
  }
  if (params.organizationName) {
    body.q_organization_name = params.organizationName;
  }
  if (params.personTitles?.length) {
    body.person_titles = params.personTitles;
  }
  if (params.personSeniorities?.length) {
    body.person_seniorities = params.personSeniorities;
  }
  if (params.personLocations?.length) {
    body.person_locations = params.personLocations;
  }
  if (params.organizationLocations?.length) {
    body.organization_locations = params.organizationLocations;
  }
  if (params.keywords) {
    body.q_keywords = params.keywords;
  }

  const searchAbort = new AbortController();
  const searchTimer = setTimeout(() => searchAbort.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(`${APOLLO_BASE_URL}/mixed_people/api_search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify(body),
      signal: searchAbort.signal,
    });
  } finally {
    clearTimeout(searchTimer);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    throw new Error(`Apollo People Search failed (${res.status}): ${errText}`);
  }

  return res.json();
}

/**
 * People Enrichment — consumes 1 credit per person.
 * Returns full data including verified email address, full name, LinkedIn URL.
 * No phone numbers (per user request).
 */
export async function apolloPeopleEnrich(params: {
  id?: string;
  firstName?: string;
  lastName?: string;
  organizationName?: string;
  domain?: string;
  linkedinUrl?: string;
}): Promise<ApolloEnrichResponse> {
  const apiKey = getApiKey();

  const body: Record<string, unknown> = {
    reveal_phone_number: false,
    reveal_personal_emails: false,
  };

  if (params.id) body.id = params.id;
  if (params.firstName) body.first_name = params.firstName;
  if (params.lastName) body.last_name = params.lastName;
  if (params.organizationName) body.organization_name = params.organizationName;
  if (params.domain) body.domain = params.domain;
  if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl;

  const enrichAbort = new AbortController();
  const enrichTimer = setTimeout(() => enrichAbort.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(
      `${APOLLO_BASE_URL}/people/match`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Api-Key": apiKey,
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: enrichAbort.signal,
      }
    );
  } finally {
    clearTimeout(enrichTimer);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    throw new Error(`Apollo People Enrichment failed (${res.status}): ${errText}`);
  }

  return res.json();
}

// ── High-Level Enrichment Functions ──

/**
 * Check if an Apollo person ID was already revealed recently (dedup guard).
 * Prevents the same person from being re-revealed in a loop when the contact
 * record fails to save (e.g., enrichment returns "not_found" or errors).
 */
async function wasRecentlyRevealed(apolloPersonId: string, windowHours: number = 168): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(apolloCreditLog)
    .where(
      and(
        eq(apolloCreditLog.apolloPersonId, apolloPersonId),
        eq(apolloCreditLog.action, "reveal"),
        sql`${apolloCreditLog.createdAt} > DATE_SUB(NOW(), INTERVAL ${windowHours} HOUR)`
      )
    );
  return Number(row?.cnt || 0) > 0;
}

/**
 * Search for contacts at a company using Apollo People Search (free).
 * Returns a list of people found — obfuscated names, no emails yet.
 * Users can then choose which contacts to "reveal" (enrich) for 1 credit each.
 */
export async function searchContactsForCompany(
  companyDomain: string,
  companyName: string,
  targetTitles: string[],
  options?: {
    locations?: string[];
    seniorities?: string[];
    maxResults?: number;
  }
): Promise<ApolloEnrichmentResult[]> {
  const results: ApolloEnrichmentResult[] = [];
  const maxResults = options?.maxResults ?? MAX_CONTACTS_PER_COMPANY;

  try {
    const searchResponse = await apolloPeopleSearch({
      organizationDomains: [companyDomain],
      personTitles: targetTitles,
      personSeniorities: options?.seniorities ?? [
        "director",
        "vp",
        "head",
        "manager",
        "c_suite",
      ],
      organizationLocations: options?.locations ?? ["australia"],
    });

    if (!searchResponse.people?.length) {
      console.log(
        `[Apollo] No results for "${companyName}" (${companyDomain}) with titles: ${targetTitles.join(", ")}`
      );
      return [];
    }

    console.log(
      `[Apollo] Found ${searchResponse.total_entries} people at "${companyName}" (showing ${searchResponse.people.length})`
    );

    for (const person of searchResponse.people.slice(0, maxResults)) {
      const displayName = `${person.first_name} ${person.last_name_obfuscated || ""}`.trim();
      results.push({
        contactId: 0,
        apolloId: person.id,
        name: displayName,
        firstName: person.first_name,
        lastNameObfuscated: person.last_name_obfuscated,
        title: person.title,
        company: person.organization?.name || companyName,
        email: null, // People Search doesn't return emails
        emailStatus: null,
        linkedinUrl: null, // People Search doesn't return LinkedIn URLs
        photoUrl: null,
        city: null,   // Only has_city boolean returned
        state: null,
        country: null,
        seniority: null,
        hasEmail: person.has_email,
        status: "found",
      });
    }
  } catch (err: unknown) {
    console.error(
      `[Apollo] Search failed for "${companyName}":`,
      err instanceof Error ? err.message : String(err)
    );
  }

  return results;
}

/**
 * Enrich a single contact via Apollo People Enrichment (1 credit).
 * Returns the contact with full name, verified email, LinkedIn URL.
 * Logs credit usage to apolloCreditLog.
 */
export async function enrichSingleContact(
  person: ApolloEnrichmentResult,
  meta?: { userId?: number; userName?: string; projectId?: number; projectName?: string }
): Promise<ApolloEnrichmentResult> {
  try {
    const enrichResult = await apolloPeopleEnrich({
      id: person.apolloId,
      firstName: person.firstName,
      organizationName: person.company,
    });

    if (!enrichResult.person) {
      return { ...person, status: "not_found" };
    }

    const p = enrichResult.person;
    const enrichedName = p.name || `${p.first_name} ${p.last_name}`.trim() || person.name;

    // Log credit usage
    await logCreditUsage({
      userId: meta?.userId ?? 0,
      userName: meta?.userName ?? "system",
      action: "reveal",
      creditsUsed: 1,
      contactName: enrichedName,
      projectId: meta?.projectId ?? null,
      projectName: meta?.projectName ?? null,
      apolloPersonId: person.apolloId,
    });

    return {
      ...person,
      name: enrichedName,
      firstName: p.first_name || person.firstName,
      lastNameObfuscated: undefined,
      title: p.title || person.title,
      email: p.email || null,
      emailStatus: p.email_status,
      linkedinUrl: p.linkedin_url || null,
      photoUrl: p.photo_url || null,
      city: p.city,
      state: p.state,
      country: p.country,
      seniority: p.seniority,
      hasEmail: !!p.email,
      status: "enriched",
    };
  } catch (err: unknown) {
    return {
      ...person,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Full enrichment flow for a project:
 * 1. Get project's owner + contractors
 * 2. Search Apollo for contacts at each company (free)
 * 3. Enrich selected contacts to get emails (1 credit each)
 * 4. Store in database
 */
export async function enrichProjectContacts(
  projectId: number,
  reportId: number,
  options?: {
    targetTitles?: string[];
    maxPerCompany?: number;
    enrichEmails?: boolean; // If false, only search (no credits used)
  }
): Promise<ApolloSearchResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get the project
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw new Error(`Project ${projectId} not found`);

  const enrichEmails = options?.enrichEmails ?? true;
  const maxPerCompany = options?.maxPerCompany ?? MAX_CONTACTS_PER_COMPANY;

  // Build list of companies to search
  const companies: { name: string; domain: string }[] = [];

  // Add owner — with owner-type routing and blocked-reason recording
  // Split comma-separated owners (e.g., "Foresight, Banpu") into individual companies
  const ownerParts = (project.owner || "").split(/[,&\/]+/).map((s: string) => s.trim()).filter(Boolean);
  let ownerBlocked = true;
  for (const ownerPart of ownerParts) {
    const ownerType = classifyOwnerType(ownerPart);
    const ownerDomain = inferDomain(ownerPart);
    if (ownerType === "government") {
      console.log(`[Apollo] Project "${project.name}": owner part "${ownerPart}" blocked — government`);
    } else if (ownerType === "unknown") {
      console.log(`[Apollo] Project "${project.name}": owner part "${ownerPart}" blocked — unknown`);
    } else if (ownerType === "contractor_desc") {
      console.log(`[Apollo] Project "${project.name}": owner part "${ownerPart}" blocked — dirty string`);
    } else if (!ownerDomain) {
      console.log(`[Apollo] Project "${project.name}": owner part "${ownerPart}" — no usable domain`);
    } else {
      // Private owner with usable domain — proceed
      if (!companies.find((co) => co.domain === ownerDomain)) {
        companies.push({ name: ownerPart, domain: ownerDomain });
      }
      ownerBlocked = false;
    }
  }
  // Only record blocked reason if ALL owner parts were blocked
  if (ownerBlocked && ownerParts.length > 0) {
    const firstType = classifyOwnerType(ownerParts[0]);
    const reason = firstType === "government" ? "blocked_government_owner_manual_discovery"
      : firstType === "unknown" ? "blocked_unknown_owner"
      : firstType === "contractor_desc" ? "blocked_dirty_owner_string"
      : "blocked_no_usable_domain";
    await db.update(projects)
      .set({ enrichmentBlockedReason: reason })
      .where(eq(projects.id, projectId));
    console.log(`[Apollo] Project "${project.name}": blocked — ${reason}`);
  }

  // Add contractors (always attempted regardless of owner type)
  if (project.contractors) {
    for (const c of project.contractors) {
      if (c.name && !companies.find((co) => co.name === c.name)) {
        const domain = inferDomain(c.name);
        if (domain) {
          companies.push({ name: c.name, domain });
        }
      }
    }
  }

  // If no companies to search at all, return early with zero results
  if (companies.length === 0) {
    console.log(`[Apollo] Project "${project.name}": no companies to search, skipping`);
    return { people: [], totalFound: 0, searchCreditsUsed: 0, enrichCreditsUsed: 0 };
  }

  // Default target titles for portable air / heavy industry
  const targetTitles = options?.targetTitles ?? [
    "Project Manager",
    "Procurement Manager",
    "Operations Manager",
    "Site Manager",
    "Fleet Manager",
    "Maintenance Manager",
    "Engineering Manager",
    "General Manager",
    "Construction Manager",
    "Mining Manager",
  ];

  const allResults: ApolloEnrichmentResult[] = [];
  let enrichCreditsUsed = 0;

  for (const company of companies) {
    // Step 1: Search (free)
    const searchResults = await searchContactsForCompany(
      company.domain,
      company.name,
      targetTitles,
      { maxResults: maxPerCompany }
    );

    for (const person of searchResults) {
      let enrichedPerson = person;

      // Step 2: Enrich for email (1 credit) — only if requested
      if (enrichEmails && person.apolloId) {
        // ── Fix 1: Dedup guard — skip if this Apollo person was already revealed recently ──
        const alreadyRevealed = await wasRecentlyRevealed(person.apolloId, 168); // 7-day window
        if (alreadyRevealed) {
          console.log(`[Apollo] DEDUP SKIP: ${person.name} (${person.apolloId}) was already revealed within 7 days — skipping to prevent credit waste`);
          allResults.push({ ...person, status: "failed", error: "dedup_recently_revealed" } as any);
          continue;
        }
        enrichedPerson = await enrichSingleContact(person);
        if (enrichedPerson.status === "enriched") {
          enrichCreditsUsed++;
        }
        await sleep(DELAY_BETWEEN_CALLS_MS);
      }

      // Only store contacts that were enriched (have full names)
      if (enrichedPerson.status !== "enriched" && enrichEmails) {
        allResults.push(enrichedPerson);
        continue;
      }

      // Check if contact already exists in DB (use full name after enrichment)
      const existing = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            sql`LOWER(${contacts.name}) = LOWER(${enrichedPerson.name})`,
            sql`LOWER(${contacts.company}) = LOWER(${company.name})`
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // Contact already exists — ensure it is linked to this project
        const existingContactId = existing[0].id;
        const existingLink = await db
          .select({ id: contactProjects.id })
          .from(contactProjects)
          .where(
            and(
              eq(contactProjects.contactId, existingContactId),
              eq(contactProjects.projectId, projectId)
            )
          )
          .limit(1);
        if (existingLink.length === 0) {
          await db.insert(contactProjects).values({
            contactId: existingContactId,
            projectId,
            projectName: project.name,
            relevance: company.name === project.owner ? "primary" : "secondary",
          });
          console.log(`[Apollo] Linked existing contact ${enrichedPerson.name} to project ${project.name}`);
        } else {
          console.log(`[Apollo] Skipping duplicate: ${enrichedPerson.name} at ${company.name}`);
        }
        allResults.push(enrichedPerson);
        continue;
      }

      // Step 3: Store in database
      const contactData: InsertContact = {
        reportId,
        name: enrichedPerson.name,
        title: enrichedPerson.title || "Unknown",
        company: company.name,
        project: project.name,
        priority: company.name === project.owner ? "hot" : "warm",
        roleBucket: inferRoleBucket(enrichedPerson.title || ""),
        email: enrichedPerson.email || null,
        linkedin: enrichedPerson.linkedinUrl || null,
        enrichmentStatus: enrichedPerson.email ? "enriched" : "pending",
        enrichmentSource: "apollo",
        enrichedAt: new Date(),
        linkedinHeadline: enrichedPerson.title,
        linkedinLocation: [enrichedPerson.city, enrichedPerson.state, enrichedPerson.country]
          .filter(Boolean)
          .join(", ") || null,
        linkedinProfilePic: enrichedPerson.photoUrl || null,
        verificationStatus:
          enrichedPerson.emailStatus === "verified" ? "verified" : "unverified",
        verificationScore:
          enrichedPerson.emailStatus === "verified"
            ? 95
            : enrichedPerson.emailStatus === "likely_to_engage"
              ? 80
              : 50,
        emailVerified: enrichedPerson.emailStatus === "verified",
        // Trust tier: Apollo contacts with verified email are send_ready;
        // others start as named_unverified until email is verified
        contactTrustTier: enrichedPerson.emailStatus === "verified" ? "send_ready" : "named_unverified",
      };

      const [inserted] = await db.insert(contacts).values(contactData);
      const newContactId = inserted.insertId;
      enrichedPerson.contactId = newContactId;

      // ── Fix: link contact to project via contactProjects junction ──
      // Without this row, readiness checks cannot see this contact for the project.
      await db.insert(contactProjects).values({
        contactId: newContactId,
        projectId,
        projectName: project.name,
        relevance: company.name === project.owner ? "primary" : "secondary",
      });

      allResults.push(enrichedPerson);
    }

    await sleep(DELAY_BETWEEN_CALLS_MS);
  }

  // Cache the enrichment
  if (allResults.length > 0) {
    await db.insert(projectEnrichmentCache).values({
      projectId,
      userId: null,
      rolesSearched: targetTitles,
      companiesSearched: companies.map((c) => c.name),
      contactsFound: allResults.length,
      contactsNew: allResults.filter((r) => r.contactId > 0).length,
      apiCallsMade: enrichCreditsUsed,
      enrichedAt: new Date(),
    });
  }

  console.log(
    `[Apollo] Project "${project.name}": ${allResults.length} contacts found, ${enrichCreditsUsed} credits used`
  );

  return {
    people: allResults,
    totalFound: allResults.length,
    searchCreditsUsed: 0, // People Search is always free
    enrichCreditsUsed,
  };
}

/**
 * Enrich a single contact by Apollo ID — used when user clicks "Reveal Email"
 * on a contact that was found via search but not yet enriched.
 * Costs 1 Apollo credit.
 */
export async function revealContactEmail(
  contactId: number,
  meta?: { userId?: number; userName?: string }
): Promise<ApolloEnrichmentResult | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!contact) throw new Error(`Contact ${contactId} not found`);

  // ── Fix 1: Dedup guard — skip if this contact was already enriched/revealed recently ──
  if (contact.enrichmentStatus === "enriched" && contact.enrichedAt) {
    const hoursSinceEnrich = (Date.now() - new Date(contact.enrichedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceEnrich < 168) { // 7 days
      console.log(`[Apollo] DEDUP SKIP revealContactEmail: contact ${contactId} (${contact.name}) was enriched ${Math.round(hoursSinceEnrich)}h ago — skipping`);
      return null;
    }
  }
  if (contact.enrichmentStatus === "not_found" && contact.enrichedAt) {
    const hoursSinceAttempt = (Date.now() - new Date(contact.enrichedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceAttempt < 168) { // 7 days
      console.log(`[Apollo] DEDUP SKIP revealContactEmail: contact ${contactId} (${contact.name}) was already attempted ${Math.round(hoursSinceAttempt)}h ago (not_found) — skipping`);
      return null;
    }
  }

  // Already has a verified email? Return it
  if (contact.email && contact.emailVerified) {
    return {
      contactId: contact.id,
      apolloId: "",
      name: contact.name,
      firstName: contact.name.split(" ")[0],
      title: contact.title,
      company: contact.company,
      email: contact.email,
      emailStatus: "verified",
      linkedinUrl: contact.linkedin,
      photoUrl: contact.linkedinProfilePic,
      city: null,
      state: null,
      country: null,
      seniority: null,
      hasEmail: true,
      status: "enriched",
    };
  }

  // Enrich via Apollo
  // Clean the name before validation: strip credentials, parenthetical nicknames, emoji
  const cleanedName = cleanContactName(contact.name);
  // Guard: Apollo rejects single-letter first names or malformed last names
  const enrichFirstName = cleanedName ? cleanedName.split(" ")[0] : contact.name.split(" ")[0];
  const nameParts = (cleanedName ?? contact.name).trim().split(/\s+/);
  const enrichLastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
  const hasInvalidName =
    !cleanedName ||
    enrichFirstName.length <= 1 ||
    (enrichLastName.length > 0 && !/^[a-zA-Z\-'\u00C0-\u024F\s]+$/.test(enrichLastName));
  if (hasInvalidName) {
    console.log(`[Apollo] Skipping enrichment for "${contact.name}" — invalid name format after cleaning (firstName: "${enrichFirstName}", lastName: "${enrichLastName}")`);
    return {
      contactId: contact.id,
      apolloId: "",
      name: contact.name,
      firstName: enrichFirstName,
      title: contact.title,
      company: contact.company,
      email: null,
      emailStatus: null,
      linkedinUrl: contact.linkedin,
      photoUrl: null,
      city: null,
      state: null,
      country: null,
      seniority: null,
      hasEmail: false,
      status: "not_found",
    };
  }
  try {
    const enrichResult = await apolloPeopleEnrich({
      firstName: enrichFirstName,
      lastName: enrichLastName,
      organizationName: contact.company,
      linkedinUrl: contact.linkedin ?? undefined,
    });

    if (!enrichResult.person) {
      await db
        .update(contacts)
        .set({
          enrichmentStatus: "not_found",
          enrichedAt: new Date(),
        })
        .where(eq(contacts.id, contactId));

      return null;
    }

    const p = enrichResult.person;

    // Log credit usage
    await logCreditUsage({
      userId: meta?.userId ?? 0,
      userName: meta?.userName ?? "system",
      action: "verify_email",
      creditsUsed: 1,
      contactId,
      contactName: p.name || contact.name,
      apolloPersonId: p.id,
    });

    // Update the contact in DB
    // IMPORTANT: also promote contactTrustTier when email is verified
    const isVerified = p.email_status === "verified";
    await db
      .update(contacts)
      .set({
        email: p.email || contact.email,
        emailVerified: isVerified,
        enrichmentStatus: "enriched",
        enrichmentSource: "apollo",
        enrichedAt: new Date(),
        linkedin: p.linkedin_url || contact.linkedin,
        linkedinHeadline: p.headline || contact.linkedinHeadline,
        linkedinProfilePic: p.photo_url || contact.linkedinProfilePic,
        linkedinLocation:
          [p.city, p.state, p.country].filter(Boolean).join(", ") ||
          contact.linkedinLocation,
        verificationStatus: isVerified ? "verified" : "unverified",
        verificationScore:
          isVerified
            ? 95
            : p.email_status === "likely_to_engage"
              ? 80
              : 50,
        // Promote trust tier: verified email → send_ready
        contactTrustTier: isVerified ? "send_ready" : contact.contactTrustTier,
      })
      .where(eq(contacts.id, contactId));

    return {
      contactId: contact.id,
      apolloId: p.id,
      name: p.name || contact.name,
      firstName: p.first_name || contact.name.split(" ")[0],
      title: p.title || contact.title,
      company: contact.company,
      email: p.email || null,
      emailStatus: p.email_status,
      linkedinUrl: p.linkedin_url || contact.linkedin,
      photoUrl: p.photo_url,
      city: p.city,
      state: p.state,
      country: p.country,
      seniority: p.seniority,
      hasEmail: !!p.email,
      status: "enriched",
    };
  } catch (err: unknown) {
    console.error(
      `[Apollo] Enrichment failed for contact ${contactId}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

// ── Domain Inference ──

/** Try to infer a company's domain from its name */
// ── Owner-type routing ──

/**
 * Classify an owner string into a routing category before Apollo search.
 *
 * Returns:
 *  "private"     → has a usable company identity; proceed with Apollo
 *  "government"  → public authority / government body; Apollo unlikely to help, flag for fallback
 *  "unknown"     → missing, generic, or dirty owner; block Apollo call entirely
 *  "contractor_desc" → owner field contains a contractor description/scope text, not a company name
 */
export type OwnerType = "private" | "government" | "unknown" | "contractor_desc";

const GOVERNMENT_PATTERNS = [
  /\bdepartment\b/i, /\bministry\b/i, /\bauthority\b/i,
  /\bcouncil\b/i, /\bgovernment\b/i, /\bstate\s+government\b/i,
  /\bfederal\b/i, /\bcommonwealth\b/i, /\bmunicip/i,
  /\bwater\s+corporation\b/i, /\bpower\s+and\s+water\b/i,
  /\baustralian\s+government\b/i, /\bntg\b/i, /\bqld\s+gov/i,
  /\bnsw\s+gov/i, /\bvic\s+gov/i, /\bsa\s+gov/i, /\bwa\s+gov/i,
  /\btas\s+gov/i, /\bact\s+gov/i, /\.gov\.au/i,
  /\bmain\s+roads\b/i, /\btransport\s+for\b/i,
  /\binfrastructure\s+nsw\b/i, /\binfrastructure\s+victoria\b/i,
  /\bnetwork\s+rail\b/i, /\bausnet\b/i, /\baustender\b/i,
  /\bhydro\s+tasmania\b/i, /\baemo\b/i, /\baer\b/i,
];

const DIRTY_OWNER_PATTERNS = [
  /^unknown$/i,
  /^n\/a$/i,
  /^tbc$/i,
  /^tbd$/i,
  /^various$/i,
  /^multiple$/i,
  /^consortium$/i,
  /^[^a-z]{0,3}$/i,                // too short / all symbols
  /^[•\-*#]/,                       // starts with bullet/list character
  /design.*certif/i,                // contractor scope descriptions
  /removal.*replacement/i,
  /installation.*cabinet/i,
  /electrical.*upgrade/i,
  /hydraulic.*upgrade/i,
  /construction.*shall/i,
  /replacement.*flooring/i,
  /water.*drainage.*service/i,
];

export function classifyOwnerType(ownerName: string): OwnerType {
  if (!ownerName || ownerName.trim().length === 0) return "unknown";
  const trimmed = ownerName.trim();

  // Block dirty / garbage strings
  for (const pattern of DIRTY_OWNER_PATTERNS) {
    if (pattern.test(trimmed)) return "unknown";
  }

  // Block strings that are clearly contractor scope descriptions (> 80 chars with no company-like structure)
  if (trimmed.length > 80 && /[.•\-]{2,}/.test(trimmed)) return "contractor_desc";
  if (trimmed.length > 120) return "contractor_desc";

  // Detect government bodies
  for (const pattern of GOVERNMENT_PATTERNS) {
    if (pattern.test(trimmed)) return "government";
  }

  return "private";
}

export function inferDomain(companyName: string): string | null {
  if (!companyName) return null;
  // Strip parenthetical qualifiers like "(advocating)", "(operator)", "(implied)"
  const stripped = companyName.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  if (!stripped) return null;
  // Pre-flight: block non-private owners
  const ownerType = classifyOwnerType(stripped);
  if (ownerType === "unknown" || ownerType === "contractor_desc") {
    console.log(`[Apollo] Blocked domain inference for "${stripped.slice(0, 60)}" (type=${ownerType})`);
    return null;
  }
  // Government bodies: block naive domain inference (they have unusual domains)
  // Return null so Apollo is skipped; caller should route to fallback
  if (ownerType === "government") {
    // Only allow if we have an explicit known-domain mapping below
    // (fall through to knownDomains check, then return null if not found)
  }

  // Known Australian company domain mappings
  const knownDomains: Record<string, string> = {
    "bhp": "bhp.com",
    "bhp group": "bhp.com",
    "rio tinto": "riotinto.com",
    "fortescue": "fortescue.com",
    "fortescue metals": "fortescue.com",
    "fortescue metals group": "fortescue.com",
    "fmg": "fortescue.com",
    "newmont": "newmont.com",
    "south32": "south32.net",
    "mineral resources": "mineralresources.com.au",
    "minres": "mineralresources.com.au",
    "pilbara minerals": "pilbaraminerals.com.au",
    "northern star": "nsrltd.com",
    "northern star resources": "nsrltd.com",
    "gold fields": "goldfields.com",
    "evolution mining": "evolutionmining.com.au",
    "santos": "santos.com",
    "woodside": "woodside.com",
    "woodside energy": "woodside.com",
    "chevron": "chevron.com",
    "inpex": "inpex.com.au",
    "shell": "shell.com",
    "nrw holdings": "nrw.com.au",
    "nrw": "nrw.com.au",
    "cimic": "cimic.com.au",
    "cimic group": "cimic.com.au",
    "thiess": "thiess.com",
    "downer": "downergroup.com",
    "downer group": "downergroup.com",
    "monadelphous": "monadelphous.com.au",
    "perenti": "perenti.com",
    "macmahon": "macmahon.com.au",
    "decmil": "decmil.com.au",
    "bechtel": "bechtel.com",
    "cpb contractors": "cpbcon.com.au",
    "john holland": "johnholland.com.au",
    "georgiou": "georgiou.com.au",
    "laing o'rourke": "laingorourke.com",
    "multiplex": "multiplex.global",
    "lendlease": "lendlease.com",
    "lynas": "lynasrareearths.com",
    "lynas rare earths": "lynasrareearths.com",
    "iluka": "iluka.com",
    "iluka resources": "iluka.com",
    "alcoa": "alcoa.com",
    "newcrest": "newcrest.com",
    "regis resources": "regisresources.com.au",
    "gold road resources": "goldroad.com.au",
    "de grey mining": "degreymining.com.au",
    "chalice mining": "chalicemining.com",
    "atlas copco": "atlascopco.com",
    "epiroc": "epiroc.com",
    "caterpillar": "cat.com",
    "komatsu": "komatsu.com.au",
    "sandvik": "sandvik.com",
    "weir minerals": "weirminerals.com",
    "metso": "metso.com",
    "abb": "abb.com",
    "siemens": "siemens.com",
    "schneider electric": "se.com",
    "main roads wa": "mainroads.wa.gov.au",
    "main roads western australia": "mainroads.wa.gov.au",
    "water corporation": "watercorporation.com.au",
    "western power": "westernpower.com.au",
    "synergy": "synergy.net.au",
    "horizon power": "horizonpower.com.au",
    "development wa": "developmentwa.com.au",
    // Energy companies
    "alinta energy": "alintaenergy.com.au",
    "alinta": "alintaenergy.com.au",
    "suncable": "suncable.energy",
    "sun cable": "suncable.energy",
    "neoen": "neoen.com",
    "genex power": "genexpower.com.au",
    "genex": "genexpower.com.au",
    "foresight": "foresight-group.com",
    "foresight group": "foresight-group.com",
    "banpu": "banpu.com",
    "eora energy": "eoraenergy.com.au",
    "cleanpeak energy": "cleanpeakenergy.com.au",
    "ark energy": "arkenergy.com.au",
    "ark energy corporation": "arkenergy.com.au",
    "frv australia": "frv.com",
    "frv": "frv.com",
    "fotowatio renewable ventures": "frv.com",
    "edify energy": "edifyenergy.com",
    "edify": "edifyenergy.com",
    "vicgrid": "energy.vic.gov.au",
    "north east link program": "northeastlink.vic.gov.au",
    "quinbrook": "quinbrook.com",
    "quinbrook infrastructure partners": "quinbrook.com",
    "european energy": "europeanenergy.com",
    "iberdrola": "iberdrola.com",
    "agl": "agl.com.au",
    "agl energy": "agl.com.au",
    "origin energy": "originenergy.com.au",
    "strike energy": "strikeenergy.com.au",
    "strike energy (operator)": "strikeenergy.com.au",
    "beach energy": "beachenergy.com.au",
    "karoon energy": "karoonenergy.com",
    "ampol": "ampol.com.au",
    "viva energy": "vivaenergy.com.au",
    "snowy hydro": "snowyhydro.com.au",
    // Mining companies
    "pantoro": "pantoro.com.au",
    "pantoro gold": "pantoro.com.au",
    "meeka metals": "meekametals.com.au",
    "meeka gold": "meekametals.com.au",
    "ramelius resources": "rameliusresources.com.au",
    "westgold resources": "westgold.com.au",
    "silverlake resources": "silverlakeresources.com.au",
    "dacian gold": "daciangold.com.au",
    "capricorn metals": "capricornmetals.com.au",
    "black cat syndicate": "blackcatsyndicate.com.au",
    "rox resources": "roxresources.com.au",
    "great boulder resources": "greatboulder.com.au",
    "great boulder": "greatboulder.com.au",
    "tungsten mining": "tungstenmining.com",
    "ark mines": "arkmines.com.au",
    // Contractors
    "dt infrastructure": "dtinfrastructure.com.au",
    "byrnecut": "byrnecut.com",
    "byrnecut offshore": "byrnecut.com",
    "maca": "maca.com.au",
    "maca limited": "maca.com.au",
    "perenti global": "perenti.com",
    "nrw civil": "nrw.com.au",
    "thiess australia": "thiess.com",
    "ghd": "ghd.com",
    "worley": "worley.com",
    "worleyparsons": "worley.com",
    "clough": "clough.com.au",
    "veolia": "veolia.com",
    "suez": "suez.com",
    "acciona": "acciona.com",
    "ventia": "ventia.com.au",
    "broadspectrum": "broadspectrum.com",
    "bgc contracting": "bgccontracting.com.au",
    "bgc": "bgccontracting.com.au",
  };

  const normalised = stripped.toLowerCase().trim();
  if (knownDomains[normalised]) return knownDomains[normalised];

  // Government bodies not in knownDomains: block naive inference
  // (government domains are too varied to guess reliably)
  if (ownerType === "government") {
    console.log(`[Apollo] Blocked domain inference for government body: "${companyName.slice(0, 60)}"`);
    return null;
  }

  // Try to build a domain from the company name
  // Strip common suffixes but preserve the core company identity
  const cleaned = normalised
    .replace(/\s*(pty\.?\s*ltd\.?|ltd\.?|limited|inc\.?|corp\.?|corporation|group|australia|holdings|resources|mining|energy)\s*/gi, " ")
    .trim()
    .replace(/[^a-z0-9\s]/g, "") // Remove non-alphanumeric except spaces
    .replace(/\s+/g, "") // Then collapse spaces
    .trim();

  // Require at least 3 chars to avoid single-letter or empty domains
  if (!cleaned || cleaned.length < 3) return null;

  // Cap domain length to prevent absurdly long strings from long company names
  if (cleaned.length > 30) {
    console.log(`[Apollo] Domain too long after cleaning (${cleaned.length} chars), skipping: "${companyName.slice(0, 60)}"`);
    return null;
  }

  // Try .com.au first (Australian companies), then .com
  return `${cleaned}.com.au`;
}

/**
 * Validate the Apollo API key by making a lightweight search call.
 */
export async function validateApolloApiKey(): Promise<{
  valid: boolean;
  error?: string;
}> {
  try {
    const result = await apolloPeopleSearch({
      organizationDomains: ["apollo.io"],
      personTitles: ["CEO"],
      perPage: 1,
    });
    return { valid: true };
  } catch (err: unknown) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Manual Contact Apollo Pass ──

/**
 * manualContactApolloPass
 *
 * Targets the large backlog of manually-imported contacts (enrichmentSource = 'manual')
 * on hot/warm active projects that have no email yet. These contacts are intentionally
 * excluded from the LinkedIn enrichment step (which only handles non-manual sources),
 * so they never get emails unless Apollo is explicitly called for them.
 *
 * Strategy:
 * 1. Query manual pending contacts on hot/warm active projects, no email, not recently attempted
 * 2. Call revealContactEmail() for each — handles dedup, credit logging, and send_ready promotion
 * 3. Respect the daily budget cap (maxCredits param)
 * 4. Hot projects are processed first; within a project, contacts with a LinkedIn URL are prioritised
 *
 * This function is designed to be called as a daily pipeline step (Step 12d).
 */
export async function manualContactApolloPass(options: {
  maxCredits?: number;
  dryRun?: boolean;
} = {}): Promise<{
  processed: number;
  revealed: number;
  skipped: number;
  failed: number;
  creditsUsed: number;
  projectsTargeted: number;
}> {
  const { maxCredits = 150, dryRun = false } = options;

  const db = await getDb();
  if (!db) {
    console.warn("[ManualApolloPass] Database not available — skipping");
    return { processed: 0, revealed: 0, skipped: 0, failed: 0, creditsUsed: 0, projectsTargeted: 0 };
  }

  // Check remaining daily budget
  const budgetRows = await db.execute(
    sql`SELECT COALESCE(SUM(creditsUsed), 0) AS used
        FROM apolloCreditLog
        WHERE DATE(createdAt) = CURDATE()`
  ) as any;
  const dailyUsed = Number((budgetRows as any)?.[0]?.[0]?.used ?? 0);
  // Use the shared daily cap from apolloEligibility (300) — respect it here too
  const SHARED_DAILY_CAP = 300;
  const remainingBudget = Math.max(0, SHARED_DAILY_CAP - dailyUsed);
  const effectiveMax = Math.min(maxCredits, remainingBudget);

  if (effectiveMax < 5) {
    console.log(`[ManualApolloPass] Skipping — only ${remainingBudget} credits remaining today (daily cap: ${SHARED_DAILY_CAP}, used: ${dailyUsed})`);
    return { processed: 0, revealed: 0, skipped: 0, failed: 0, creditsUsed: 0, projectsTargeted: 0 };
  }

  console.log(`[ManualApolloPass] Starting — budget: ${effectiveMax} credits (daily remaining: ${remainingBudget}, cap: ${maxCredits})`);

  // Query: manual pending contacts on hot/warm active projects with no email
  // Ordered by project priority (hot first), then by whether they have a LinkedIn URL (easier match)
  // Exclude contacts attempted in the last 7 days to avoid re-burning credits
  const targetRows = await db.execute(
    sql`SELECT c.id, c.name, c.company, c.title, c.linkedin, p.priority, p.id AS projectId, p.name AS projectName
        FROM contacts c
        JOIN contactProjects cp ON cp.contactId = c.id
        JOIN projects p ON p.id = cp.projectId
        WHERE c.enrichmentSource = 'manual'
          AND c.enrichmentStatus = 'pending'
          AND (c.email IS NULL OR c.email = '')
          AND c.rejectionReason IS NULL
          AND (c.crmOrphan IS NULL OR c.crmOrphan = 0)
          AND p.priority IN ('hot', 'warm')
          AND p.lifecycleStatus = 'active'
          AND (p.suppressed IS NULL OR p.suppressed = 0)
          AND (c.enrichedAt IS NULL OR c.enrichedAt < DATE_SUB(NOW(), INTERVAL 7 DAY))
          AND c.title NOT IN (
            'Finance', 'CRM Contact', 'Invoice via Email', 'Collections Contact',
            'IT', 'Administration', 'Logistics', 'Development',
            'Service Operations', 'Service Purchase',
            'Sales & Marketing', 'HR', 'Legal', 'Department', 'Health & Safety'
          )
        ORDER BY
          FIELD(p.priority, 'hot', 'warm') ASC,
          (c.linkedin IS NOT NULL AND c.linkedin != '') DESC,
          c.createdAt DESC
        LIMIT ${effectiveMax * 3}`
  ) as any;

  const rows: any[] = (targetRows as any)?.[0] ?? [];
  const projectIds = new Set(rows.map((r: any) => r.projectId));

  console.log(`[ManualApolloPass] Found ${rows.length} manual contacts across ${projectIds.size} projects`);

  if (rows.length === 0) {
    return { processed: 0, revealed: 0, skipped: 0, failed: 0, creditsUsed: 0, projectsTargeted: 0 };
  }

  let processed = 0;
  let revealed = 0;
  let skipped = 0;
  let failed = 0;
  let creditsUsed = 0;

  for (const row of rows) {
    if (creditsUsed >= effectiveMax) break;

    processed++;

    if (dryRun) {
      console.log(`[ManualApolloPass] DRY RUN: would reveal contact ${row.id} (${row.name} @ ${row.company}) for project ${row.projectId} (${row.priority})`);
      skipped++;
      continue;
    }

    try {
      const result = await revealContactEmail(row.id, { userId: 0, userName: "pipeline-manual-apollo-pass" });
      if (result) {
        revealed++;
        creditsUsed++;
        console.log(`[ManualApolloPass] Revealed contact ${row.id} (${row.name} @ ${row.company}) — email: ${result.email ? "found" : "not found"}, project: ${row.projectName} (${row.priority})`);
      } else {
        skipped++;
        console.log(`[ManualApolloPass] Skipped contact ${row.id} (${row.name}) — dedup guard or no result`);
      }
    } catch (err: unknown) {
      failed++;
      console.error(`[ManualApolloPass] Failed for contact ${row.id} (${row.name}):`, err instanceof Error ? err.message : String(err));
    }

    // Rate limit: 500ms between calls (same as DELAY_BETWEEN_CALLS_MS)
    await sleep(DELAY_BETWEEN_CALLS_MS);
  }

  console.log(`[ManualApolloPass] Complete — processed: ${processed}, revealed: ${revealed}, skipped: ${skipped}, failed: ${failed}, credits used: ${creditsUsed}/${effectiveMax}`);

  return { processed, revealed, skipped, failed, creditsUsed, projectsTargeted: projectIds.size };
}
