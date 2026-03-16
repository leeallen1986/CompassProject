/**
 * Projectory Scraper — Server-side HTML scraper for projectory.com.au
 *
 * Crawls category listing pages, extracts article URLs, then scrapes each
 * article page for structured project details and contacts.
 *
 * Strategy:
 * - Weekly run: scrape page 1 of each category (~60 articles)
 * - Deduplicates against existing projects by name + proponent
 * - Inserts new projects and contacts into the database
 * - Zero AI credits — pure HTML parsing
 *
 * Requires session cookies from a logged-in Projectory account.
 */
import { eq, desc, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  projects, contacts, reports,
  type InsertProject, type InsertContact,
} from "../drizzle/schema";
import crypto from "crypto";

// ── Configuration ──

const BASE_URL = "https://www.projectory.com.au";
const CATEGORIES = [
  "resources-projects",
  "infrastructure-projects",
  "construction-projects",
  "energy-utilities",
  "industrial-projects",
  "defence",
];

/** How many listing pages to crawl per category (1 = most recent ~10 articles) */
const PAGES_PER_CATEGORY = 2;

/** Delay between HTTP requests to avoid rate limiting (ms) */
const REQUEST_DELAY_MS = 1500;

/** Session cookies for authenticated access — set via environment or admin */
let sessionCookies = process.env.PROJECTORY_COOKIES || "";

// ── Types ──

interface ProjectoryArticle {
  title: string;
  url: string;
  date: string;
  categories: string[];
  regions: string[];
}

interface ProjectoryProject {
  name: string;
  projectUrl: string;
  status: string;
  site: string;
  capex: string;
  proponent: string;
}

interface ProjectoryContact {
  name: string;
  position: string;
  organisation: string;
  postalAddress: string;
  cityStatePostcode: string;
  telephone: string;
  fax: string;
  email: string;
  website: string;
}

interface ScrapedArticle {
  article: ProjectoryArticle;
  project: ProjectoryProject | null;
  contacts: ProjectoryContact[];
  bodyText: string;
}

interface ScrapeResult {
  totalCategories: number;
  totalArticlesFound: number;
  totalScraped: number;
  totalNewProjects: number;
  totalNewContacts: number;
  totalDuplicates: number;
  totalErrors: number;
  errors: string[];
  duration: number;
}

// ── Cookie management ──

export function setProjectoryCookies(cookies: string): void {
  sessionCookies = cookies;
}

export function getProjectoryCookies(): string {
  return sessionCookies;
}

// ── HTML helpers (no external deps) ──

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBetween(html: string, startMarker: string, endMarker: string): string {
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return "";
  const afterStart = startIdx + startMarker.length;
  const endIdx = html.indexOf(endMarker, afterStart);
  if (endIdx === -1) return html.slice(afterStart);
  return html.slice(afterStart, endIdx);
}

function extractAll(html: string, regex: RegExp): string[] {
  const matches: string[] = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── HTTP fetch with cookies ──

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
        Cookie: sessionCookies,
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ── Parse category listing page ──

export function parseListingPage(html: string): ProjectoryArticle[] {
  const articles: ProjectoryArticle[] = [];

  // Projectory uses c-teaser blocks with structure:
  // <h3 class="c-teaser__title">
  //   <a class="c-teaser__link" href="https://www.projectory.com.au/article/...">Title</a>
  // </h3>
  // Followed by c-teaser__footer with date, categories, and regions
  const articleLinkRegex = /<h3[^>]*class="[^"]*c-teaser__title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/www\.projectory\.com\.au\/article\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi;
  let match;

  while ((match = articleLinkRegex.exec(html)) !== null) {
    const url = match[1];
    const title = stripHtml(match[2]);

    // Look ahead into the c-teaser__footer block for date, categories, regions
    const afterMatch = html.slice(match.index, match.index + 3000);

    // Extract date: "on March 16, 2026" or "on March 9, 2026"
    const dateMatch = afterMatch.match(/on\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i);
    const date = dateMatch ? dateMatch[1] : "";

    // Extract category tags from /category/ links
    const categories: string[] = [];
    const catRegex = /href="https?:\/\/www\.projectory\.com\.au\/category\/[^"]+"[^>]*title="([^"]+)"/gi;
    const footerSection = afterMatch.slice(0, 2000);
    let catMatch;
    while ((catMatch = catRegex.exec(footerSection)) !== null) {
      const cat = stripHtml(catMatch[1]);
      if (cat && !categories.includes(cat)) categories.push(cat);
    }

    // Extract region tags from /region/ links
    const regions: string[] = [];
    const regionRegex = /href="https?:\/\/www\.projectory\.com\.au\/region\/[^"]+"[^>]*title="([^"]+)"/gi;
    let regionMatch;
    while ((regionMatch = regionRegex.exec(footerSection)) !== null) {
      const region = stripHtml(regionMatch[1]);
      if (region && !regions.includes(region)) regions.push(region);
    }

    articles.push({ title, url, date, categories, regions });
  }

  return articles;
}

// ── Parse article page for project details and contacts ──

export function parseArticlePage(html: string): {
  project: ProjectoryProject | null;
  contacts: ProjectoryContact[];
  bodyText: string;
} {
  // Extract project details from c-project-snapshot section
  let project: ProjectoryProject | null = null;

  const projectNameMatch = html.match(/c-project-snapshot__name[^>]*>\s*<a\s+href="([^"]*)"[^>]*>([^<]+)<\/a>/i);
  if (projectNameMatch) {
    const projectUrl = projectNameMatch[1];
    const name = stripHtml(projectNameMatch[2]);

    // Extract fields from c-project-snapshot__line divs
    const getField = (label: string): string => {
      const regex = new RegExp(
        `c-project-snapshot__label"[^>]*>\\s*${label}:?\\s*<\\/label>\\s*([^<]+)`,
        "i"
      );
      const m = html.match(regex);
      return m ? stripHtml(m[1]) : "";
    };

    project = {
      name,
      projectUrl: projectUrl.startsWith("http") ? projectUrl : `${BASE_URL}${projectUrl}`,
      status: getField("Status"),
      site: getField("Site"),
      capex: getField("CAPEX\\(\\$AUD million\\)") || getField("CAPEX"),
      proponent: getField("Proponent"),
    };
  }

  // Extract contacts from c-accordion sections
  const contactsList: ProjectoryContact[] = [];

  // Find the "Project Contacts" section
  const contactsSectionIdx = html.indexOf("Project Contacts");
  if (contactsSectionIdx !== -1) {
    const contactsHtml = html.slice(contactsSectionIdx);

    // Find each contact block: from one c-accordion__title-text to the next (or end)
    const titleRegex = /c-accordion__title-text"[^>]*>([^<]+)<\/span>/gi;
    const titleMatches: { name: string; index: number }[] = [];
    let nameMatch;
    while ((nameMatch = titleRegex.exec(contactsHtml)) !== null) {
      titleMatches.push({ name: stripHtml(nameMatch[1]), index: nameMatch.index });
    }

    // For each contact, extract the block from this title to the next title
    for (let i = 0; i < titleMatches.length; i++) {
      const startIdx = titleMatches[i].index;
      const endIdx = i + 1 < titleMatches.length ? titleMatches[i + 1].index : contactsHtml.length;
      const block = contactsHtml.slice(startIdx, endIdx);
      const contactName = titleMatches[i].name;

      const getContactField = (label: string): string => {
        const regex = new RegExp(
          `c-project-snapshot__label[^>]*>\\s*${label}:?\\s*<\\/td>\\s*<td[^>]*>\\s*([^<]+)`,
          "i"
        );
        const m = block.match(regex);
        return m ? stripHtml(m[1]) : "";
      };

      // Also check for email links
      const emailLinkMatch = block.match(/href="mailto:([^"]+)"/i);
      const emailFromField = getContactField("Email");
      const email = emailLinkMatch ? emailLinkMatch[1] : emailFromField;

      // Check for website links
      const websiteLinkMatch = block.match(/href="(https?:\/\/[^"]+)"[^>]*>[^<]*(?:website|www|\.com)/i);
      const websiteFromField = getContactField("Website");
      const website = websiteLinkMatch ? websiteLinkMatch[1] : websiteFromField;

      if (contactName) {
        contactsList.push({
          name: contactName,
          position: getContactField("Position"),
          organisation: getContactField("Organisation"),
          postalAddress: getContactField("Postal Address"),
          cityStatePostcode: getContactField("City State Postcode"),
          telephone: getContactField("Telephone"),
          fax: getContactField("Fax"),
          email,
          website,
        });
      }
    }
  }

  // Extract body text (article content)
  let bodyText = "";
  const contentMatch = html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (contentMatch) {
    bodyText = stripHtml(contentMatch[1]).slice(0, 3000);
  } else {
    // Fallback: extract text between the article title and project details
    const titleEnd = html.indexOf("</h1>");
    const detailsStart = html.indexOf("Project details");
    if (titleEnd !== -1 && detailsStart !== -1) {
      bodyText = stripHtml(html.slice(titleEnd, detailsStart)).slice(0, 3000);
    }
  }

  return { project, contacts: contactsList, bodyText };
}

// ── Map Projectory data to Atlas Copco schema ──

function mapSector(categories: string[]): "mining" | "oil_gas" | "infrastructure" | "energy" | "defence" {
  const cats = categories.map(c => c.toLowerCase()).join(" ");
  if (cats.includes("defence") || cats.includes("defense")) return "defence";
  if (cats.includes("energy") || cats.includes("utilities") || cats.includes("solar") || cats.includes("wind") || cats.includes("battery") || cats.includes("hydrogen")) return "energy";
  if (cats.includes("oil") || cats.includes("gas") || cats.includes("lng") || cats.includes("petroleum")) return "oil_gas";
  if (cats.includes("mining") || cats.includes("gold") || cats.includes("copper") || cats.includes("iron") || cats.includes("coal") || cats.includes("mineral") || cats.includes("lithium") || cats.includes("nickel") || cats.includes("resources")) return "mining";
  return "infrastructure";
}

function mapPriority(status: string, capex: string): "hot" | "warm" | "cold" {
  const s = status.toLowerCase();
  if (s.includes("construction") || s.includes("execution") || s.includes("mobilisation") || s.includes("awarded") || s.includes("commenced")) return "hot";
  if (s.includes("approval") || s.includes("feasibility") || s.includes("planning") || s.includes("assessment") || s.includes("proposed")) return "warm";
  return "cold";
}

function mapCapexGrade(capex: string): "A" | "B" | "Unknown" {
  if (!capex || capex.toLowerCase() === "unknown" || capex === "-") return "Unknown";
  if (capex.includes("$")) return "A"; // Projectory provides sourced CAPEX ranges
  return "B";
}

function mapOpportunityRoute(status: string): "Direct CAPEX" | "Fleet CAPEX" | "OPEX/Monitor" {
  const s = status.toLowerCase();
  if (s.includes("construction") || s.includes("execution") || s.includes("awarded")) return "Fleet CAPEX";
  if (s.includes("feasibility") || s.includes("planning") || s.includes("proposed")) return "Direct CAPEX";
  return "OPEX/Monitor";
}

function extractLocation(site: string, regions: string[]): string {
  if (site) return site;
  if (regions.length > 0) return regions.join(", ");
  return "Australia";
}

// ── Deduplication ──

async function isProjectDuplicate(projectName: string, proponent: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const normalizedName = projectName.toLowerCase().trim().replace(/\s+/g, " ");
  const existing = await db.select({ id: projects.id, name: projects.name, owner: projects.owner })
    .from(projects)
    .orderBy(desc(projects.id))
    .limit(300);

  for (const p of existing) {
    const existingNorm = p.name.toLowerCase().trim().replace(/\s+/g, " ");
    if (existingNorm === normalizedName) return true;
    if (existingNorm.includes(normalizedName) || normalizedName.includes(existingNorm)) return true;
  }

  return false;
}

// ── Get or create today's report ──

async function getOrCreateTodayReport(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const today = new Date();
  const weekEnding = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const existing = await db.select()
    .from(reports)
    .where(eq(reports.weekEnding, weekEnding))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [result] = await db.insert(reports).values({
    weekEnding,
    generatedTime: today.toISOString(),
    totalProjects: 0,
    hotProjects: 0,
    warmProjects: 0,
    coldProjects: 0,
    confirmedContractors: 0,
    predictedContractors: 0,
    capexOpportunities: 0,
    totalContacts: 0,
    sourcesSearched: "Projectory",
    newProjectsCount: 0,
    executiveSummaryMain: "Auto-generated from Projectory scraper.",
  });
  return Number(result.insertId);
}

// ── Main scraper pipeline ──

export async function runProjectoryScraper(
  options?: { maxPages?: number; categories?: string[] }
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const categoriesToScrape = options?.categories || CATEGORIES;
  const maxPages = options?.maxPages || PAGES_PER_CATEGORY;

  const errors: string[] = [];
  let totalArticlesFound = 0;
  let totalScraped = 0;
  let totalNewProjects = 0;
  let totalNewContacts = 0;
  let totalDuplicates = 0;
  let totalErrors = 0;

  console.log(`[Projectory] Starting scrape of ${categoriesToScrape.length} categories, ${maxPages} pages each...`);

  // Step 1: Collect article URLs from listing pages
  const articleUrls: ProjectoryArticle[] = [];

  for (const category of categoriesToScrape) {
    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1
        ? `${BASE_URL}/category/${category}`
        : `${BASE_URL}/category/${category}/page/${page}`;

      try {
        console.log(`[Projectory] Fetching listing: ${url}`);
        const html = await fetchPage(url);
        const articles = parseListingPage(html);
        articleUrls.push(...articles);
        totalArticlesFound += articles.length;
        console.log(`[Projectory] Found ${articles.length} articles on ${category} page ${page}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Listing ${category}/page/${page}: ${msg}`);
        totalErrors++;
      }

      await sleep(REQUEST_DELAY_MS);
    }
  }

  // Deduplicate article URLs
  const uniqueArticles = new Map<string, ProjectoryArticle>();
  for (const article of articleUrls) {
    if (!uniqueArticles.has(article.url)) {
      uniqueArticles.set(article.url, article);
    }
  }
  const articlesToScrape = Array.from(uniqueArticles.values());
  console.log(`[Projectory] ${articlesToScrape.length} unique articles to scrape (from ${totalArticlesFound} total)`);

  // Step 2: Scrape each article page
  const reportId = await getOrCreateTodayReport();

  for (const article of articlesToScrape) {
    try {
      console.log(`[Projectory] Scraping: ${article.title.slice(0, 60)}...`);
      const html = await fetchPage(article.url);
      const { project, contacts: articleContacts, bodyText } = parseArticlePage(html);
      totalScraped++;

      if (!project) {
        console.log(`[Projectory] No project details found in: ${article.title.slice(0, 60)}`);
        continue;
      }

      // Check for duplicate
      const isDup = await isProjectDuplicate(project.name, project.proponent);
      if (isDup) {
        totalDuplicates++;
        console.log(`[Projectory] Duplicate: ${project.name}`);
        continue;
      }

      // Map to Atlas Copco schema
      const sector = mapSector(article.categories);
      const priority = mapPriority(project.status, project.capex);
      const capexGrade = mapCapexGrade(project.capex);
      const opportunityRoute = mapOpportunityRoute(project.status);
      const location = extractLocation(project.site, article.regions);

      const projectKey = `projectory-${crypto.createHash("md5").update(project.name).digest("hex").slice(0, 12)}`;

      const projectData: InsertProject = {
        reportId,
        projectKey,
        name: project.name,
        location,
        value: project.capex || "Unknown",
        owner: project.proponent || "Unknown",
        priority,
        capexGrade,
        opportunityRoute,
        sector,
        isNew: true,
        stage: project.status || "Unknown",
        overview: bodyText.slice(0, 2000),
        equipmentSignals: [],
        contractors: [],
        opportunityNote: `Source: Projectory. Status: ${project.status}. CAPEX: ${project.capex}.`,
        sources: [{ label: "Projectory", url: article.url, date: article.date }],
        timeline: "",
        completion: "",
      };

      const [insertResult] = await db.insert(projects).values(projectData);
      const newProjectId = Number(insertResult.insertId);
      totalNewProjects++;
      console.log(`[Projectory] New project: ${project.name} (ID: ${newProjectId})`);

      // Insert contacts
      for (const contact of articleContacts) {
        if (!contact.name) continue;

        // Determine role bucket from position
        const pos = contact.position.toLowerCase();
        let roleBucket = "operations";
        if (pos.includes("procurement") || pos.includes("supply") || pos.includes("purchasing")) roleBucket = "procurement";
        else if (pos.includes("project manager") || pos.includes("project director")) roleBucket = "project_management";
        else if (pos.includes("engineer") || pos.includes("technical")) roleBucket = "engineering";
        else if (pos.includes("ceo") || pos.includes("managing director") || pos.includes("general manager") || pos.includes("director")) roleBucket = "executive";
        else if (pos.includes("site manager") || pos.includes("mine manager") || pos.includes("operations")) roleBucket = "operations";

        const contactData: InsertContact = {
          reportId,
          name: contact.name,
          title: contact.position || "Unknown",
          company: contact.organisation || project.proponent || "Unknown",
          project: project.name,
          priority,
          roleBucket,
          email: contact.email || null,
          phone: contact.telephone || null,
          enrichmentStatus: contact.email ? "enriched" : "pending",
        };

        try {
          await db.insert(contacts).values(contactData);
          totalNewContacts++;
        } catch (insertErr) {
          const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
          errors.push(`Contact insert for "${contact.name}": ${msg}`);
          totalErrors++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Article "${article.title.slice(0, 60)}": ${msg}`);
      totalErrors++;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  // Update report stats
  if (totalNewProjects > 0) {
    const allProjects = await db.select().from(projects).where(eq(projects.reportId, reportId));
    const hot = allProjects.filter(p => p.priority === "hot").length;
    const warm = allProjects.filter(p => p.priority === "warm").length;
    const cold = allProjects.filter(p => p.priority === "cold").length;

    await db.update(reports).set({
      totalProjects: allProjects.length,
      hotProjects: hot,
      warmProjects: warm,
      coldProjects: cold,
      newProjectsCount: totalNewProjects,
    }).where(eq(reports.id, reportId));
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`[Projectory] Scrape complete in ${duration}s: ${totalNewProjects} new projects, ${totalNewContacts} contacts, ${totalDuplicates} duplicates`);

  return {
    totalCategories: categoriesToScrape.length,
    totalArticlesFound,
    totalScraped,
    totalNewProjects,
    totalNewContacts,
    totalDuplicates,
    totalErrors,
    errors,
    duration,
  };
}
