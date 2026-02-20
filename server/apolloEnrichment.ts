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
  type InsertContact,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

// ── Configuration ──

const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";
const DELAY_BETWEEN_CALLS_MS = 500;
const DAILY_ENRICHMENT_CAP = 200; // Apollo credits per day
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

// ── Apollo API Calls ──

/**
 * People API Search — FREE, no credits consumed.
 * Finds people by company domain, job titles, seniority, location.
 * Returns: first_name, last_name_obfuscated, title, id, has_email flags.
 * Does NOT return email addresses, full last names, or LinkedIn URLs.
 */
export async function apolloPeopleSearch(params: {
  organizationDomains?: string[];
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

  const res = await fetch(`${APOLLO_BASE_URL}/mixed_people/api_search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
  });

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

  const res = await fetch(
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
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    throw new Error(`Apollo People Enrichment failed (${res.status}): ${errText}`);
  }

  return res.json();
}

// ── High-Level Enrichment Functions ──

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
 */
export async function enrichSingleContact(
  person: ApolloEnrichmentResult
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
    return {
      ...person,
      name: p.name || `${p.first_name} ${p.last_name}`.trim() || person.name,
      firstName: p.first_name || person.firstName,
      lastNameObfuscated: undefined, // We now have the full name
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

  // Add owner
  const ownerDomain = inferDomain(project.owner);
  if (ownerDomain) {
    companies.push({ name: project.owner, domain: ownerDomain });
  }

  // Add contractors
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
        console.log(`[Apollo] Skipping duplicate: ${enrichedPerson.name} at ${company.name}`);
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
      };

      const [inserted] = await db.insert(contacts).values(contactData);
      enrichedPerson.contactId = inserted.insertId;
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
  contactId: number
): Promise<ApolloEnrichmentResult | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (!contact) throw new Error(`Contact ${contactId} not found`);

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
  try {
    const enrichResult = await apolloPeopleEnrich({
      firstName: contact.name.split(" ")[0],
      lastName: contact.name.split(" ").slice(1).join(" "),
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

    // Update the contact in DB
    await db
      .update(contacts)
      .set({
        email: p.email || contact.email,
        emailVerified: p.email_status === "verified",
        enrichmentStatus: "enriched",
        enrichmentSource: "apollo",
        enrichedAt: new Date(),
        linkedin: p.linkedin_url || contact.linkedin,
        linkedinHeadline: p.headline || contact.linkedinHeadline,
        linkedinProfilePic: p.photo_url || contact.linkedinProfilePic,
        linkedinLocation:
          [p.city, p.state, p.country].filter(Boolean).join(", ") ||
          contact.linkedinLocation,
        verificationStatus:
          p.email_status === "verified" ? "verified" : "unverified",
        verificationScore:
          p.email_status === "verified"
            ? 95
            : p.email_status === "likely_to_engage"
              ? 80
              : 50,
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
export function inferDomain(companyName: string): string | null {
  if (!companyName) return null;

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
  };

  const normalised = companyName.toLowerCase().trim();
  if (knownDomains[normalised]) return knownDomains[normalised];

  // Try to build a domain from the company name
  const cleaned = normalised
    .replace(/\s*(pty|ltd|limited|inc|corp|corporation|group|australia|holdings|resources|mining|energy)\s*/gi, " ")
    .trim()
    .replace(/\s+/g, "");

  if (!cleaned || cleaned.length < 2) return null;

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
