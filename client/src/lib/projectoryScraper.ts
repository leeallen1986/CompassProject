/**
 * Client-side Projectory Scraper
 *
 * Runs in the admin's browser to bypass Cloudflare anti-bot protection.
 * The admin is already logged into Projectory, so fetch() requests from
 * the browser include the necessary session cookies automatically.
 *
 * Flow:
 * 1. Fetch category listing pages → extract article URLs
 * 2. Fetch each article page → parse project details + contacts
 * 3. Send structured data to server API for deduplication + storage
 */

const BASE_URL = "https://www.projectory.com.au";

const CATEGORIES = [
  "resources-projects",
  "infrastructure-projects",
  "construction-projects",
  "energy-utilities",
  "industrial-projects",
  "defence",
];

const PAGES_PER_CATEGORY = 2;
const REQUEST_DELAY_MS = 2000;

// ── Types ──

export interface ProjectoryArticle {
  title: string;
  url: string;
  date: string;
  categories: string[];
  regions: string[];
}

export interface ProjectoryProject {
  name: string;
  projectUrl: string;
  status: string;
  site: string;
  capex: string;
  proponent: string;
}

export interface ProjectoryContact {
  name: string;
  position: string;
  organisation: string;
  telephone: string;
  email: string;
  website: string;
}

export interface ScrapedArticleData {
  article: ProjectoryArticle;
  project: ProjectoryProject | null;
  contacts: ProjectoryContact[];
  bodyText: string;
}

export interface ClientScrapeProgress {
  phase: "listing" | "articles" | "sending" | "done" | "error";
  message: string;
  articlesFound: number;
  articlesScraped: number;
  totalArticles: number;
}

// ── HTML Helpers ──

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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Fetch with CORS proxy ──
// Since Projectory is a different origin, we use the server as a proxy

async function fetchViaProxy(url: string): Promise<string> {
  const response = await fetch("/api/trpc/projectory.proxyFetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ "0": { json: { url } } }),
  });

  if (!response.ok) {
    throw new Error(`Proxy fetch failed: ${response.status}`);
  }

  const data = await response.json();
  // tRPC batch response format
  const result = Array.isArray(data) ? data[0] : data;
  return result?.result?.data?.json?.html || "";
}

// ── Parse listing page ──

export function parseListingPage(html: string): ProjectoryArticle[] {
  const articles: ProjectoryArticle[] = [];

  // Match article blocks with h3 links
  const articleRegex = /<h3[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const url = match[1].startsWith("http") ? match[1] : `${BASE_URL}${match[1]}`;
    const title = stripHtml(match[2]);

    // Extract date from nearby "on Month DD, YYYY" pattern
    const afterMatch = html.slice(match.index, match.index + 1000);
    const dateMatch = afterMatch.match(/on\s+(\w+\s+\d{1,2},?\s+\d{4})/i);
    const date = dateMatch ? dateMatch[1] : "";

    // Extract categories from links after the title
    const categories: string[] = [];
    const catRegex = /category\/([^/"]+)/g;
    let catMatch;
    while ((catMatch = catRegex.exec(afterMatch)) !== null) {
      categories.push(catMatch[1].replace(/-/g, " "));
    }

    // Extract regions
    const regions: string[] = [];
    const regionRegex = /region\/([^/"]+)/g;
    let regionMatch;
    while ((regionMatch = regionRegex.exec(afterMatch)) !== null) {
      regions.push(regionMatch[1].replace(/-/g, " "));
    }

    articles.push({ title, url, date, categories, regions });
  }

  return articles;
}

// ── Parse article page ──

export function parseArticlePage(html: string): {
  project: ProjectoryProject | null;
  contacts: ProjectoryContact[];
  bodyText: string;
} {
  let project: ProjectoryProject | null = null;

  const projectNameMatch = html.match(/c-project-snapshot__name[^>]*>\s*<a\s+href="([^"]*)"[^>]*>([^<]+)<\/a>/i);
  if (projectNameMatch) {
    const projectUrl = projectNameMatch[1];
    const name = stripHtml(projectNameMatch[2]);

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

  // Extract contacts
  const contactsList: ProjectoryContact[] = [];
  const contactsSectionIdx = html.indexOf("Project Contacts");
  if (contactsSectionIdx !== -1) {
    const contactsHtml = html.slice(contactsSectionIdx);
    const titleRegex = /c-accordion__title-text"[^>]*>([^<]+)<\/span>/gi;
    const titleMatches: { name: string; index: number }[] = [];
    let nameMatch;
    while ((nameMatch = titleRegex.exec(contactsHtml)) !== null) {
      titleMatches.push({ name: stripHtml(nameMatch[1]), index: nameMatch.index });
    }

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

      const emailLinkMatch = block.match(/href="mailto:([^"]+)"/i);
      const emailFromField = getContactField("Email");
      const email = emailLinkMatch ? emailLinkMatch[1] : emailFromField;

      const websiteLinkMatch = block.match(/href="(https?:\/\/[^"]+)"[^>]*>[^<]*(?:website|www|\.com)/i);
      const websiteFromField = getContactField("Website");
      const website = websiteLinkMatch ? websiteLinkMatch[1] : websiteFromField;

      if (contactName) {
        contactsList.push({
          name: contactName,
          position: getContactField("Position"),
          organisation: getContactField("Organisation"),
          telephone: getContactField("Telephone"),
          email,
          website,
        });
      }
    }
  }

  // Extract body text
  let bodyText = "";
  const contentMatch = html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (contentMatch) {
    bodyText = stripHtml(contentMatch[1]).slice(0, 3000);
  }

  return { project, contacts: contactsList, bodyText };
}

// ── Main client-side scraper ──

export async function runClientSideScrape(
  onProgress: (progress: ClientScrapeProgress) => void
): Promise<ScrapedArticleData[]> {
  const allArticles: ProjectoryArticle[] = [];

  // Phase 1: Fetch listing pages
  onProgress({ phase: "listing", message: "Fetching category listings...", articlesFound: 0, articlesScraped: 0, totalArticles: 0 });

  for (const category of CATEGORIES) {
    for (let page = 1; page <= PAGES_PER_CATEGORY; page++) {
      const url = page === 1
        ? `${BASE_URL}/category/${category}`
        : `${BASE_URL}/category/${category}/page/${page}`;

      try {
        onProgress({
          phase: "listing",
          message: `Fetching ${category} page ${page}...`,
          articlesFound: allArticles.length,
          articlesScraped: 0,
          totalArticles: 0,
        });

        const html = await fetchViaProxy(url);
        const articles = parseListingPage(html);
        allArticles.push(...articles);
      } catch (err) {
        console.warn(`[Projectory] Failed to fetch ${url}:`, err);
      }

      await sleep(REQUEST_DELAY_MS);
    }
  }

  // Deduplicate
  const uniqueMap = new Map<string, ProjectoryArticle>();
  for (const article of allArticles) {
    if (!uniqueMap.has(article.url)) {
      uniqueMap.set(article.url, article);
    }
  }
  const uniqueArticles = Array.from(uniqueMap.values());

  onProgress({
    phase: "articles",
    message: `Found ${uniqueArticles.length} unique articles. Scraping details...`,
    articlesFound: uniqueArticles.length,
    articlesScraped: 0,
    totalArticles: uniqueArticles.length,
  });

  // Phase 2: Scrape each article
  const results: ScrapedArticleData[] = [];

  for (let i = 0; i < uniqueArticles.length; i++) {
    const article = uniqueArticles[i];

    try {
      onProgress({
        phase: "articles",
        message: `Scraping article ${i + 1}/${uniqueArticles.length}: ${article.title.slice(0, 50)}...`,
        articlesFound: uniqueArticles.length,
        articlesScraped: i,
        totalArticles: uniqueArticles.length,
      });

      const html = await fetchViaProxy(article.url);
      const { project, contacts, bodyText } = parseArticlePage(html);

      results.push({ article, project, contacts, bodyText });
    } catch (err) {
      console.warn(`[Projectory] Failed to scrape ${article.url}:`, err);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  onProgress({
    phase: "done",
    message: `Scraped ${results.length} articles with ${results.filter(r => r.project).length} projects.`,
    articlesFound: uniqueArticles.length,
    articlesScraped: results.length,
    totalArticles: uniqueArticles.length,
  });

  return results;
}
