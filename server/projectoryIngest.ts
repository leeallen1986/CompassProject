/**
 * Projectory Ingest — Server-side handler for client-scraped Projectory data.
 *
 * Receives pre-parsed article data from the client-side scraper,
 * deduplicates against existing projects, and inserts new ones.
 * Also handles the proxy fetch endpoint for the client scraper.
 */
import { eq, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  projects, contacts, reports,
  type InsertProject, type InsertContact,
} from "../drizzle/schema";
import crypto from "crypto";

// ── Types (matches client-side types) ──

export interface IngestArticle {
  title: string;
  url: string;
  date: string;
  categories: string[];
  regions: string[];
}

export interface IngestProject {
  name: string;
  projectUrl: string;
  status: string;
  site: string;
  capex: string;
  proponent: string;
}

export interface IngestContact {
  name: string;
  position: string;
  organisation: string;
  telephone: string;
  email: string;
  website: string;
}

export interface IngestArticleData {
  article: IngestArticle;
  project: IngestProject | null;
  contacts: IngestContact[];
  bodyText: string;
}

export interface IngestResult {
  totalReceived: number;
  totalNewProjects: number;
  totalNewContacts: number;
  totalDuplicates: number;
  totalSkipped: number;
  totalErrors: number;
  errors: string[];
}

// ── Proxy fetch for client-side scraper ──

export async function proxyFetchUrl(url: string): Promise<string> {
  // Validate URL is from Projectory
  if (!url.startsWith("https://www.projectory.com.au/")) {
    throw new Error("Only Projectory URLs are allowed");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
      },
    });
    clearTimeout(timeout);

    const html = await response.text();

    // Check if we got the anti-bot page
    if (html.includes("One moment, please...") || html.includes("window.location.reload")) {
      throw new Error("ANTI_BOT_BLOCKED: Projectory returned an anti-bot challenge. The server cannot bypass this — please use the client-side scraper.");
    }

    return html;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ── Mapping helpers ──

function mapSector(categories: string[]): "mining" | "oil_gas" | "infrastructure" | "energy" | "defence" {
  const cats = categories.map(c => c.toLowerCase()).join(" ");
  if (cats.includes("defence") || cats.includes("defense")) return "defence";
  if (cats.includes("energy") || cats.includes("utilities") || cats.includes("solar") || cats.includes("wind") || cats.includes("battery") || cats.includes("hydrogen")) return "energy";
  if (cats.includes("oil") || cats.includes("gas") || cats.includes("lng") || cats.includes("petroleum")) return "oil_gas";
  if (cats.includes("mining") || cats.includes("gold") || cats.includes("copper") || cats.includes("iron") || cats.includes("coal") || cats.includes("mineral") || cats.includes("lithium") || cats.includes("nickel") || cats.includes("resources")) return "mining";
  return "infrastructure";
}

function mapPriority(status: string, _capex: string): "hot" | "warm" | "cold" {
  const s = status.toLowerCase();
  if (s.includes("construction") || s.includes("execution") || s.includes("mobilisation") || s.includes("awarded") || s.includes("commenced")) return "hot";
  if (s.includes("approval") || s.includes("feasibility") || s.includes("planning") || s.includes("assessment") || s.includes("proposed")) return "warm";
  return "cold";
}

function mapCapexGrade(capex: string): "A" | "B" | "Unknown" {
  if (!capex || capex.toLowerCase() === "unknown" || capex === "-") return "Unknown";
  if (capex.includes("$")) return "A";
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

function mapRoleBucket(position: string): string {
  const pos = position.toLowerCase();
  if (pos.includes("procurement") || pos.includes("supply") || pos.includes("purchasing")) return "procurement";
  if (pos.includes("project manager") || pos.includes("project director")) return "project_management";
  if (pos.includes("engineer") || pos.includes("technical")) return "engineering";
  if (pos.includes("ceo") || pos.includes("managing director") || pos.includes("general manager") || pos.includes("director")) return "executive";
  return "operations";
}

// ── Deduplication ──

async function isProjectDuplicate(projectName: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const normalizedName = projectName.toLowerCase().trim().replace(/\s+/g, " ");
  const existing = await db.select({ id: projects.id, name: projects.name })
    .from(projects)
    .orderBy(desc(projects.id))
    .limit(500);

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

// ── Main ingest function ──

export async function ingestProjectoryArticles(
  articles: IngestArticleData[]
): Promise<IngestResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const errors: string[] = [];
  let totalNewProjects = 0;
  let totalNewContacts = 0;
  let totalDuplicates = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  const reportId = await getOrCreateTodayReport();

  for (const item of articles) {
    try {
      if (!item.project || !item.project.name) {
        totalSkipped++;
        continue;
      }

      // Check for duplicate
      const isDup = await isProjectDuplicate(item.project.name);
      if (isDup) {
        totalDuplicates++;
        continue;
      }

      // Map to Atlas Copco schema
      const sector = mapSector(item.article.categories);
      const priority = mapPriority(item.project.status, item.project.capex);
      const capexGrade = mapCapexGrade(item.project.capex);
      const opportunityRoute = mapOpportunityRoute(item.project.status);
      const location = extractLocation(item.project.site, item.article.regions);

      const projectKey = `projectory-${crypto.createHash("md5").update(item.project.name).digest("hex").slice(0, 12)}`;

      const projectData: InsertProject = {
        reportId,
        projectKey,
        name: item.project.name,
        location,
        value: item.project.capex || "Unknown",
        owner: item.project.proponent || "Unknown",
        priority,
        capexGrade,
        opportunityRoute,
        sector,
        isNew: true,
        stage: item.project.status || "Unknown",
        overview: item.bodyText.slice(0, 2000),
        equipmentSignals: [],
        contractors: [],
        opportunityNote: `Source: Projectory. Status: ${item.project.status}. CAPEX: ${item.project.capex}.`,
        sources: [{ label: "Projectory", url: item.article.url, date: item.article.date }],
        timeline: "",
        completion: "",
      };

      const [insertResult] = await db.insert(projects).values(projectData);
      const newProjectId = Number(insertResult.insertId);
      totalNewProjects++;
      console.log(`[Projectory Ingest] New project: ${item.project.name} (ID: ${newProjectId})`);

      // Insert contacts
      for (const contact of item.contacts) {
        if (!contact.name) continue;

        const contactData: InsertContact = {
          reportId,
          name: contact.name,
          title: contact.position || "Unknown",
          company: contact.organisation || item.project.proponent || "Unknown",
          project: item.project.name,
          priority,
          roleBucket: mapRoleBucket(contact.position),
          email: contact.email || null,
          phone: contact.telephone || null,
          enrichmentStatus: contact.email ? "enriched" : "pending",
        };

        try {
          await db.insert(contacts).values(contactData);
          totalNewContacts++;
        } catch (insertErr) {
          const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
          errors.push(`Contact "${contact.name}": ${msg}`);
          totalErrors++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Article "${item.article.title.slice(0, 60)}": ${msg}`);
      totalErrors++;
    }
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

  console.log(`[Projectory Ingest] Complete: ${totalNewProjects} new projects, ${totalNewContacts} contacts, ${totalDuplicates} duplicates, ${totalSkipped} skipped`);

  return {
    totalReceived: articles.length,
    totalNewProjects,
    totalNewContacts,
    totalDuplicates,
    totalSkipped,
    totalErrors,
    errors,
  };
}
