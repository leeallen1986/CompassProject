/**
 * hunterContactSearch.ts — Hunter.io Domain Search for finding new contacts
 *
 * Used by the Campaign Builder to discover contacts at target companies
 * when the user doesn't have a pre-existing contact list.
 *
 * Flow:
 * 1. User provides company domains or company names
 * 2. We run Hunter.io Domain Search on each
 * 3. Filter results by target roles (e.g., "RC drillers", "operations managers")
 * 4. Return structured contacts ready for campaign import
 */

import { domainSearch, type HunterEmail } from "./hunterService";
import type { RawContactRow } from "./campaignService";

// ── Role-based filtering ──

export interface TargetRoleConfig {
  /** Display name for the role category */
  name: string;
  /** Regex patterns to match against job titles */
  patterns: RegExp[];
}

/** Pre-defined role categories for common Atlas Copco target segments */
export const PREDEFINED_ROLES: Record<string, TargetRoleConfig> = {
  // Drilling segment
  rc_driller: {
    name: "RC Drillers",
    patterns: [/drill/i, /\brc\b/i, /reverse\s*circ/i, /bore\s*hole/i, /rig\s*manager/i],
  },
  water_well: {
    name: "Water Well Drillers",
    patterns: [/water\s*well/i, /bore\s*drill/i, /hydro/i, /ground\s*water/i, /well\s*drill/i],
  },
  exploration: {
    name: "Exploration",
    patterns: [/explor/i, /geolog/i, /geo\s*tech/i, /mineral/i, /assay/i, /core\s*drill/i],
  },
  // Blasting/coating segment
  blasting: {
    name: "Blasting & Coating",
    patterns: [/blast/i, /coat/i, /paint/i, /surface\s*(prep|treat|protect)/i, /corrosion/i, /abrasive/i, /nace/i, /uhp/i],
  },
  // General operations
  operations: {
    name: "Operations & Management",
    patterns: [/operations/i, /general\s*manager/i, /managing\s*director/i, /\bceo\b/i, /\bcoo\b/i, /director/i, /superintendent/i],
  },
  procurement: {
    name: "Procurement & Purchasing",
    patterns: [/procurement/i, /purchas/i, /supply\s*chain/i, /buyer/i, /sourcing/i],
  },
  project_management: {
    name: "Project Management",
    patterns: [/project\s*manager/i, /project\s*director/i, /project\s*engineer/i, /project\s*coord/i],
  },
  fleet_equipment: {
    name: "Fleet & Equipment",
    patterns: [/fleet/i, /equipment/i, /plant\s*manager/i, /maintenance/i, /workshop/i, /mechanic/i],
  },
  engineering: {
    name: "Engineering",
    patterns: [/engineer/i, /technical/i, /design/i],
  },
  site_management: {
    name: "Site Management",
    patterns: [/site\s*manager/i, /site\s*super/i, /foreman/i, /supervisor/i, /area\s*manager/i],
  },
};

/** Irrelevant corporate roles to always exclude */
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

// ── Domain Search ──

export interface ContactSearchInput {
  /** Company domains to search (e.g., ["monadelphous.com.au", "linkforce.com.au"]) */
  domains: string[];
  /** Target role keys from PREDEFINED_ROLES (e.g., ["rc_driller", "operations"]) */
  targetRoles: string[];
  /** Custom role patterns (regex strings) if predefined roles don't cover the need */
  customRolePatterns?: string[];
  /** Whether to include contacts with no title (default: false) */
  includeNoTitle?: boolean;
  /** Maximum contacts per domain (default: 50) */
  maxPerDomain?: number;
  /** Maximum total contacts across all domains (default: 2000) */
  maxTotal?: number;
}

export interface ContactSearchResult {
  contacts: RawContactRow[];
  domainsSearched: number;
  domainsWithResults: number;
  totalFound: number;
  totalFiltered: number;
  domainBreakdown: { domain: string; organization: string; found: number; filtered: number }[];
}

/**
 * Search for contacts at specified company domains, filtered by target roles.
 * Each domain search costs 1 Hunter.io API credit.
 */
export async function searchContactsByDomain(
  input: ContactSearchInput
): Promise<ContactSearchResult> {
  const { domains, targetRoles, customRolePatterns, includeNoTitle, maxPerDomain = 50, maxTotal = 2000 } = input;

  // Build combined role patterns
  const rolePatterns: RegExp[] = [];
  for (const roleKey of targetRoles) {
    const role = PREDEFINED_ROLES[roleKey];
    if (role) rolePatterns.push(...role.patterns);
  }
  if (customRolePatterns) {
    for (const pattern of customRolePatterns) {
      try {
        rolePatterns.push(new RegExp(pattern, "i"));
      } catch {
        // Skip invalid regex
      }
    }
  }

  const allContacts: RawContactRow[] = [];
  const domainBreakdown: ContactSearchResult["domainBreakdown"] = [];
  let domainsWithResults = 0;
  let totalFound = 0;
  let totalFiltered = 0;
  let rowCounter = 1;

  for (const domain of domains) {
    try {
      // Stop if we've already hit the total cap
      if (allContacts.length >= maxTotal) break;

      const result = await domainSearch(domain, { type: "personal", limit: 100 });
      totalFound += result.emails.length;

      let domainFiltered = 0;
      const domainContacts: RawContactRow[] = [];

      for (const email of result.emails) {
        // Skip excluded roles
        if (isExcludedRole(email.position)) continue;

        // Filter by target roles (if any specified)
        if (rolePatterns.length > 0) {
          if (!matchesRole(email.position, rolePatterns) && !includeNoTitle) continue;
          if (!matchesRole(email.position, rolePatterns) && includeNoTitle && email.position) continue;
        }

        // Skip generic emails (info@, sales@, etc.)
        if (email.type === "generic") continue;

        // Skip low confidence
        if (email.confidence < 30) continue;

        domainContacts.push({
          firstName: email.first_name,
          lastName: email.last_name,
          title: email.position,
          company: result.organization || domain,
          reviewedCompanyName: result.organization || null,
          phone: email.phone_number,
          mobile: null,
          email: email.value,
          nameCheckStatus: `hunter_${email.confidence}%`,
          reviewNotes: email.linkedin ? `LinkedIn: ${email.linkedin}` : null,
          sourceRow: rowCounter++,
        });

        domainFiltered++;
        if (domainContacts.length >= maxPerDomain) break;
      }

      if (domainContacts.length > 0) domainsWithResults++;
      totalFiltered += domainFiltered;
      allContacts.push(...domainContacts);

      domainBreakdown.push({
        domain,
        organization: result.organization || domain,
        found: result.emails.length,
        filtered: domainFiltered,
      });

      // Rate limit: 200ms between requests
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`[HunterSearch] Failed for domain ${domain}:`, err);
      domainBreakdown.push({
        domain,
        organization: domain,
        found: 0,
        filtered: 0,
      });
    }
  }

  return {
    contacts: allContacts,
    domainsSearched: domains.length,
    domainsWithResults,
    totalFound,
    totalFiltered,
    domainBreakdown,
  };
}

// ── Company Name Search (via Apollo) ──

export interface CompanyNameSearchInput {
  /** Company names to search (e.g., ["Access Hire", "Brooks Hire"]) */
  companyNames: string[];
  /** Target role keys from PREDEFINED_ROLES */
  targetRoles: string[];
  /** Custom role patterns (regex strings) */
  customRolePatterns?: string[];
  /** Maximum contacts per company (default: 25) */
  maxPerCompany?: number;
  /** Maximum total contacts across all companies (default: 2000) */
  maxTotal?: number;
}

export interface CompanyNameSearchResult {
  contacts: RawContactRow[];
  companiesSearched: number;
  companiesWithResults: number;
  totalFound: number;
  totalFiltered: number;
  companyBreakdown: { company: string; found: number; filtered: number }[];
}

/**
 * Search for contacts at companies by name (no domain required).
 * Uses Apollo People Search with q_organization_name.
 * Free — no credits consumed for the search step.
 */
export async function searchContactsByCompanyName(
  input: CompanyNameSearchInput
): Promise<CompanyNameSearchResult> {
  const { apolloPeopleSearch } = await import("./apolloEnrichment");
  const { companyNames, targetRoles, customRolePatterns, maxPerCompany = 25, maxTotal = 2000 } = input;

  // Build combined role patterns for filtering
  const rolePatterns: RegExp[] = [];
  for (const roleKey of targetRoles) {
    const role = PREDEFINED_ROLES[roleKey];
    if (role) rolePatterns.push(...role.patterns);
  }
  if (customRolePatterns) {
    for (const pattern of customRolePatterns) {
      try {
        rolePatterns.push(new RegExp(pattern, "i"));
      } catch {
        // Skip invalid regex
      }
    }
  }

  // Map role keys to Apollo person_titles for better search results
  const apolloTitles: string[] = [];
  for (const roleKey of targetRoles) {
    switch (roleKey) {
      case "operations":
        apolloTitles.push("Operations Manager", "General Manager", "Managing Director", "Director", "COO");
        break;
      case "fleet_equipment":
        apolloTitles.push("Fleet Manager", "Equipment Manager", "Plant Manager", "Maintenance Manager", "Workshop Manager");
        break;
      case "procurement":
        apolloTitles.push("Procurement Manager", "Purchasing Manager", "Supply Chain Manager", "Buyer");
        break;
      case "project_management":
        apolloTitles.push("Project Manager", "Project Director", "Project Engineer");
        break;
      case "engineering":
        apolloTitles.push("Engineer", "Technical Manager", "Chief Engineer");
        break;
      case "site_management":
        apolloTitles.push("Site Manager", "Site Supervisor", "Foreman", "Area Manager");
        break;
      case "rc_driller":
        apolloTitles.push("Drill Manager", "Rig Manager", "Drilling Superintendent");
        break;
      case "blasting":
        apolloTitles.push("Blasting Manager", "Coating Manager", "Surface Preparation Manager");
        break;
      case "exploration":
        apolloTitles.push("Exploration Manager", "Geologist", "Geotechnical Engineer");
        break;
      case "water_well":
        apolloTitles.push("Water Well Driller", "Bore Driller", "Hydrogeologist");
        break;
    }
  }

  const allContacts: RawContactRow[] = [];
  const companyBreakdown: CompanyNameSearchResult["companyBreakdown"] = [];
  let companiesWithResults = 0;
  let totalFound = 0;
  let totalFiltered = 0;
  let rowCounter = 1;

  for (const companyName of companyNames) {
    try {
      // Stop if we've already hit the total cap
      if (allContacts.length >= maxTotal) break;

      const result = await apolloPeopleSearch({
        organizationName: companyName,
        personTitles: apolloTitles.length > 0 ? apolloTitles : undefined,
        organizationLocations: ["Australia"],
        perPage: 50,
      });

      totalFound += result.people.length;
      let companyFiltered = 0;
      const companyContacts: RawContactRow[] = [];

      for (const person of result.people) {
        // Skip excluded roles
        if (isExcludedRole(person.title)) continue;

        // Filter by target roles if specified
        if (rolePatterns.length > 0) {
          if (!matchesRole(person.title, rolePatterns)) continue;
        }

        // Build a display name from first_name + obfuscated last name
        const firstName = person.first_name || "";
        const lastName = person.last_name_obfuscated || "";

        companyContacts.push({
          firstName: firstName || null,
          lastName: lastName || null,
          title: person.title || null,
          company: person.organization?.name || companyName,
          reviewedCompanyName: person.organization?.name || null,
          phone: null,
          mobile: null,
          email: null, // Apollo search doesn't return emails — needs enrichment
          nameCheckStatus: person.has_email ? "apollo_has_email" : "apollo_no_email",
          reviewNotes: `Apollo ID: ${person.id}`,
          sourceRow: rowCounter++,
        });

        companyFiltered++;
        if (companyContacts.length >= maxPerCompany) break;
        if (allContacts.length + companyContacts.length >= maxTotal) break;
      }

      if (companyContacts.length > 0) companiesWithResults++;
      totalFiltered += companyFiltered;
      allContacts.push(...companyContacts);

      companyBreakdown.push({
        company: companyName,
        found: result.people.length,
        filtered: companyFiltered,
      });

      // Rate limit: 300ms between requests
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`[ApolloCompanySearch] Failed for company "${companyName}":`, err);
      companyBreakdown.push({
        company: companyName,
        found: 0,
        filtered: 0,
      });
    }
  }

  return {
    contacts: allContacts,
    companiesSearched: companyNames.length,
    companiesWithResults,
    totalFound,
    totalFiltered,
    companyBreakdown,
  };
}

/**
 * Get the list of predefined role categories with their display names.
 */
export function getAvailableRoles(): { key: string; name: string }[] {
  return Object.entries(PREDEFINED_ROLES).map(([key, config]) => ({
    key,
    name: config.name,
  }));
}
