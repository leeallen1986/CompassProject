/**
 * companySearchJob.ts — Background job manager for large company contact searches
 *
 * Problem: Searching 378+ companies via Apollo People Search takes 3-5 minutes,
 * which exceeds HTTP request timeouts. This module runs the search in the background
 * and provides progress polling.
 *
 * Flow:
 * 1. Client calls startCompanySearch → returns jobId immediately
 * 2. Client polls getCompanySearchProgress(jobId) every 2s
 * 3. When status="completed", client gets the full results
 */

import { searchContactsByDomain, searchContactsByCompanyName, PREDEFINED_ROLES } from "./hunterContactSearch";
import { domainSearch } from "./hunterService";
import { apolloPeopleSearch } from "./apolloEnrichment";
import type { RawContactRow } from "./campaignService";
import { nanoid } from "nanoid";

// ── Types ──

export interface CompanySearchJobInput {
  /** Companies with domains (for Hunter search) */
  withDomain: { company: string; domain: string }[];
  /** Companies without domains (for Apollo name search) */
  withoutDomain: { company: string }[];
  /** Target role keys from PREDEFINED_ROLES */
  targetRoles: string[];
  /** Custom role patterns (regex strings) */
  customRolePatterns?: string[];
  /** Max contacts per company */
  maxPerCompany: number;
  /** Max total contacts */
  maxTotal: number;
}

export interface CompanySearchProgress {
  jobId: string;
  status: "running" | "completed" | "failed";
  /** Total companies to search */
  totalCompanies: number;
  /** Companies searched so far */
  companiesSearched: number;
  /** Contacts found so far (pre-filter) */
  totalFound: number;
  /** Contacts matching role filters */
  totalFiltered: number;
  /** Companies that returned at least 1 matching contact */
  companiesWithResults: number;
  /** Current company being searched */
  currentCompany: string | null;
  /** Error message if failed */
  error: string | null;
  /** Per-company breakdown (available when completed) */
  domainBreakdown: { domain: string; organization: string; found: number; filtered: number }[];
  /** All matching contacts (available when completed) */
  contacts: RawContactRow[];
  /** Start time */
  startedAt: number;
  /** Elapsed seconds */
  elapsedSeconds: number;
}

// ── In-memory job store ──
// Jobs are ephemeral — they only need to survive long enough for the client to poll results.
// Auto-cleaned after 30 minutes.

const jobs = new Map<string, CompanySearchProgress>();

const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes

function cleanupOldJobs() {
  const now = Date.now();
  Array.from(jobs.entries()).forEach(([id, job]) => {
    if (now - job.startedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  });
}

// ── Role filtering helpers (duplicated from hunterContactSearch for isolation) ──

const EXCLUDE_PATTERNS = [
  /\bhr\b/i, /human\s*resource/i, /recruit/i, /talent/i,
  /\bmarketing\b/i, /\bcommunication/i, /\bpr\b/i, /public\s*relation/i,
  /\bfinance\b/i, /\baccountant/i, /\btax\b/i, /\baudit/i, /\bcfo\b/i,
  /\blegal\b/i, /\bcompliance\b/i, /\brisk\b/i,
  /\bit\b\s*(manager|director|officer)/i, /\bcio\b/i, /\bcto\b/i, /software/i, /developer/i,
  /\breception/i, /\badmin\s*assist/i, /\bsecretary/i,
  /\bsales\s*rep/i, /\baccount\s*exec/i,
];

function matchesRole(title: string | null, rolePatterns: RegExp[]): boolean {
  if (!title) return false;
  return rolePatterns.some(p => p.test(title));
}

function isExcludedRole(title: string | null): boolean {
  if (!title) return false;
  return EXCLUDE_PATTERNS.some(p => p.test(title));
}

function buildRolePatterns(targetRoles: string[], customRolePatterns?: string[]): RegExp[] {
  const patterns: RegExp[] = [];
  for (const roleKey of targetRoles) {
    const role = PREDEFINED_ROLES[roleKey];
    if (role) patterns.push(...role.patterns);
  }
  if (customRolePatterns) {
    for (const p of customRolePatterns) {
      try { patterns.push(new RegExp(p, "i")); } catch { /* skip invalid */ }
    }
  }
  return patterns;
}

function buildApolloTitles(targetRoles: string[]): string[] {
  const titles: string[] = [];
  for (const roleKey of targetRoles) {
    switch (roleKey) {
      case "operations":
        titles.push("Operations Manager", "General Manager", "Managing Director", "Director", "COO");
        break;
      case "fleet_equipment":
        titles.push("Fleet Manager", "Equipment Manager", "Plant Manager", "Maintenance Manager", "Workshop Manager");
        break;
      case "procurement":
        titles.push("Procurement Manager", "Purchasing Manager", "Supply Chain Manager", "Buyer");
        break;
      case "project_management":
        titles.push("Project Manager", "Project Director", "Project Engineer");
        break;
      case "engineering":
        titles.push("Engineer", "Technical Manager", "Chief Engineer");
        break;
      case "site_management":
        titles.push("Site Manager", "Site Supervisor", "Foreman", "Area Manager");
        break;
      case "rc_driller":
        titles.push("Drill Manager", "Rig Manager", "Drilling Superintendent");
        break;
      case "blasting":
        titles.push("Blasting Manager", "Coating Manager", "Surface Preparation Manager");
        break;
      case "exploration":
        titles.push("Exploration Manager", "Geologist", "Geotechnical Engineer");
        break;
      case "water_well":
        titles.push("Water Well Manager", "Bore Driller", "Hydrogeologist");
        break;
    }
  }
  return titles;
}

// ── Job execution ──

export function startCompanySearch(input: CompanySearchJobInput): string {
  cleanupOldJobs();

  const jobId = nanoid(12);
  const totalCompanies = input.withDomain.length + input.withoutDomain.length;

  const progress: CompanySearchProgress = {
    jobId,
    status: "running",
    totalCompanies,
    companiesSearched: 0,
    totalFound: 0,
    totalFiltered: 0,
    companiesWithResults: 0,
    currentCompany: null,
    error: null,
    domainBreakdown: [],
    contacts: [],
    startedAt: Date.now(),
    elapsedSeconds: 0,
  };

  jobs.set(jobId, progress);

  // Run the search in the background (fire and forget)
  runSearchJob(jobId, input).catch(err => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = "failed";
      job.error = err.message || "Unknown error";
      job.elapsedSeconds = Math.round((Date.now() - job.startedAt) / 1000);
    }
  });

  return jobId;
}

export function getCompanySearchProgress(jobId: string): CompanySearchProgress | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  // Update elapsed time
  job.elapsedSeconds = Math.round((Date.now() - job.startedAt) / 1000);
  return job;
}

async function runSearchJob(jobId: string, input: CompanySearchJobInput): Promise<void> {
  const job = jobs.get(jobId)!;
  const rolePatterns = buildRolePatterns(input.targetRoles, input.customRolePatterns);
  const apolloTitles = buildApolloTitles(input.targetRoles);
  let rowCounter = 1;

  // ── Phase 1: Hunter domain search ──
  for (const company of input.withDomain) {
    if (job.contacts.length >= input.maxTotal) break;

    job.currentCompany = company.company || company.domain;

    try {
      const result = await domainSearch(company.domain, { type: "personal", limit: 100 });
      job.totalFound += result.emails.length;

      let domainFiltered = 0;
      const domainContacts: RawContactRow[] = [];

      for (const email of result.emails) {
        if (isExcludedRole(email.position)) continue;
        if (rolePatterns.length > 0 && !matchesRole(email.position, rolePatterns)) continue;
        if (email.type === "generic") continue;
        if (email.confidence < 30) continue;

        domainContacts.push({
          firstName: email.first_name,
          lastName: email.last_name,
          title: email.position,
          company: result.organization || company.domain,
          reviewedCompanyName: result.organization || null,
          phone: email.phone_number,
          mobile: null,
          email: email.value,
          nameCheckStatus: `hunter_${email.confidence}%`,
          reviewNotes: email.linkedin ? `LinkedIn: ${email.linkedin}` : null,
          sourceRow: rowCounter++,
        });

        domainFiltered++;
        if (domainContacts.length >= input.maxPerCompany) break;
      }

      if (domainContacts.length > 0) job.companiesWithResults++;
      job.totalFiltered += domainFiltered;
      job.contacts.push(...domainContacts);
      job.domainBreakdown.push({
        domain: company.domain,
        organization: result.organization || company.domain,
        found: result.emails.length,
        filtered: domainFiltered,
      });
    } catch (err) {
      console.error(`[CompanySearchJob] Hunter failed for ${company.domain}:`, err);
      job.domainBreakdown.push({
        domain: company.domain,
        organization: company.company || company.domain,
        found: 0,
        filtered: 0,
      });
    }

    job.companiesSearched++;
    await new Promise(r => setTimeout(r, 200));
  }

  // ── Phase 2: Apollo company name search ──
  for (const company of input.withoutDomain) {
    if (job.contacts.length >= input.maxTotal) break;

    job.currentCompany = company.company;

    try {
      const result = await apolloPeopleSearch({
        organizationName: company.company,
        personTitles: apolloTitles.length > 0 ? apolloTitles : undefined,
        organizationLocations: ["Australia"],
        perPage: 50,
      });

      job.totalFound += result.people.length;
      let companyFiltered = 0;
      const companyContacts: RawContactRow[] = [];

      for (const person of result.people) {
        if (isExcludedRole(person.title)) continue;
        if (rolePatterns.length > 0 && !matchesRole(person.title, rolePatterns)) continue;

        companyContacts.push({
          firstName: person.first_name || null,
          lastName: person.last_name_obfuscated || null,
          title: person.title || null,
          company: person.organization?.name || company.company,
          reviewedCompanyName: person.organization?.name || null,
          phone: null,
          mobile: null,
          email: null,
          nameCheckStatus: person.has_email ? "apollo_has_email" : "apollo_no_email",
          reviewNotes: `Apollo ID: ${person.id}`,
          sourceRow: rowCounter++,
        });

        companyFiltered++;
        if (companyContacts.length >= input.maxPerCompany) break;
        if (job.contacts.length + companyContacts.length >= input.maxTotal) break;
      }

      if (companyContacts.length > 0) job.companiesWithResults++;
      job.totalFiltered += companyFiltered;
      job.contacts.push(...companyContacts);
      job.domainBreakdown.push({
        domain: company.company,
        organization: company.company,
        found: result.people.length,
        filtered: companyFiltered,
      });
    } catch (err) {
      console.error(`[CompanySearchJob] Apollo failed for "${company.company}":`, err);
      job.domainBreakdown.push({
        domain: company.company,
        organization: company.company,
        found: 0,
        filtered: 0,
      });
    }

    job.companiesSearched++;
    await new Promise(r => setTimeout(r, 300));
  }

  // ── Done ──
  job.status = "completed";
  job.currentCompany = null;
  job.elapsedSeconds = Math.round((Date.now() - job.startedAt) / 1000);
  console.log(`[CompanySearchJob] ${jobId} completed: ${job.totalFiltered} contacts from ${job.companiesWithResults}/${job.totalCompanies} companies in ${job.elapsedSeconds}s`);
}
