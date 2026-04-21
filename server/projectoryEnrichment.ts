/**
 * Projectory Enrichment Service
 *
 * Authenticated enrichment layer for the Atlas Copco intelligence platform.
 * NOT a primary discovery crawler — only accessed when a project has already
 * been identified from another source.
 *
 * Strategy:
 * 1. Auto-login with stored credentials (no manual cookie extraction)
 * 2. Search Projectory for a known project name
 * 3. Extract structured enrichment data (delivery chain, timeline, contractors)
 * 4. Attach data to existing project record
 * 5. Track enrichment results and contractor frequency
 *
 * Rate-limited: 1.5s between requests. Only accesses pages for known projects.
 */
import { eq, sql, desc, and } from "drizzle-orm";
import { getDb, touchProjectSourceSeen } from "./db";
import {
  projects,
  projectoryEnrichmentLog,
  projectoryContractorFrequency,
} from "../drizzle/schema";
import type {
  InsertProjectoryEnrichmentLog,
  InsertProjectoryContractorFrequency,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

// ── Types ──

export interface ProjectorySession {
  cookies: string;
  csrfToken: string;
  expiresAt: number; // Unix timestamp
}

export interface ProjectoryProjectData {
  name: string;
  location: string;
  sector: string;
  estimatedValue: string;
  projectStage: string;
  owner: string;
  epcContractor: string;
  designConsultants: { name: string; role: string; detail?: string }[];
  contractors: { name: string; role: string; detail?: string }[];
  subcontractors: { name: string; role: string; detail?: string }[];
  stakeholders: { name: string; position: string; organisation: string; email?: string }[];
  timelineSignals: { phase: string; signal: string; date?: string }[];
  sourceUrl: string;
  rawSnapshotData: Record<string, string>;
}

export interface EnrichmentResult {
  projectId: number;
  projectName: string;
  matched: boolean;
  enriched: boolean;
  contractorsDiscovered: number;
  consultantsDiscovered: number;
  stageUpdated: boolean;
  sourceUrl: string;
  error?: string;
}

export interface BulkEnrichmentResult {
  totalProcessed: number;
  totalMatched: number;
  totalEnriched: number;
  totalContractorsDiscovered: number;
  totalConsultantsDiscovered: number;
  totalStageUpdates: number;
  totalErrors: number;
  results: EnrichmentResult[];
  duration: number;
}

export interface ContractorFrequencyItem {
  name: string;
  role: string;
  projectCount: number;
  projects: string[];
  sectors: string[];
  states: string[];
}

// ── Session Management ──

let currentSession: ProjectorySession | null = null;
const SESSION_TTL_MS = 90 * 60 * 1000; // 90 minutes (conservative, actual is ~2 hours)
const RATE_LIMIT_MS = 1500;

async function login(): Promise<ProjectorySession> {
  const email = ENV.projectoryEmail;
  const password = ENV.projectoryPassword;

  if (!email || !password) {
    throw new Error("Projectory credentials not configured (PROJECTORY_EMAIL, PROJECTORY_PASSWORD)");
  }

  console.log("[Projectory] Logging in...");

  // Step 1: Get CSRF token and session cookie
  const loginPageRes = await fetch("https://www.projectory.com.au/login", {
    redirect: "manual",
  });

  if (!loginPageRes.ok) {
    throw new Error(`Failed to load login page: HTTP ${loginPageRes.status}`);
  }

  const html = await loginPageRes.text();
  const csrfMatch = html.match(/csrfToken":"([^"]+)"/);
  if (!csrfMatch) {
    throw new Error("Could not extract CSRF token from login page");
  }
  const csrfToken = csrfMatch[1];

  // Extract cookies
  const setCookies = loginPageRes.headers.getSetCookie?.() ?? [];
  const initialCookies = setCookies.map((c: string) => c.split(";")[0]).join("; ");

  // Step 2: POST login
  const loginRes = await fetch("https://www.projectory.com.au/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-TOKEN": csrfToken,
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "application/json",
      "Referer": "https://www.projectory.com.au/login",
      "Origin": "https://www.projectory.com.au",
      "Cookie": initialCookies,
    },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });

  if (loginRes.status !== 204) {
    throw new Error(`Login failed: HTTP ${loginRes.status}`);
  }

  // Merge cookies from login response
  const loginCookies = loginRes.headers.getSetCookie?.() ?? [];
  const allCookieMap = new Map<string, string>();
  for (const c of [...setCookies, ...loginCookies]) {
    const [nameVal] = c.split(";");
    const [name] = nameVal.split("=");
    allCookieMap.set(name.trim(), nameVal.trim());
  }
  const cookies = Array.from(allCookieMap.values()).join("; ");

  const session: ProjectorySession = {
    cookies,
    csrfToken,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  currentSession = session;
  console.log("[Projectory] Login successful, session valid for 90 minutes");
  return session;
}

async function getSession(): Promise<ProjectorySession> {
  if (currentSession && Date.now() < currentSession.expiresAt) {
    return currentSession;
  }
  console.log("[Projectory] Session expired or not available, re-authenticating...");
  return login();
}

export function isSessionExpired(): boolean {
  return !currentSession || Date.now() >= currentSession.expiresAt;
}

export function getSessionStatus(): { active: boolean; expiresIn: number | null } {
  if (!currentSession) return { active: false, expiresIn: null };
  const remaining = currentSession.expiresAt - Date.now();
  return { active: remaining > 0, expiresIn: remaining > 0 ? Math.round(remaining / 1000) : null };
}

// ── Authenticated Fetch ──

async function authenticatedFetch(url: string): Promise<string> {
  const session = await getSession();
  const response = await fetch(url, {
    headers: {
      "Cookie": session.cookies,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": "https://www.projectory.com.au/",
    },
    redirect: "follow",
  });

  if (response.status === 401 || response.status === 403) {
    // Session expired — force re-login
    console.warn("[Projectory] Session expired (401/403), re-authenticating...");
    currentSession = null;
    const newSession = await login();
    const retryRes = await fetch(url, {
      headers: {
        "Cookie": newSession.cookies,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.projectory.com.au/",
      },
      redirect: "follow",
    });
    if (!retryRes.ok) throw new Error(`HTTP ${retryRes.status} after re-auth`);
    return retryRes.text();
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

// ── Search Projectory ──

async function searchProject(projectName: string): Promise<{ url: string; title: string }[]> {
  const searchUrl = `https://www.projectory.com.au/search?keyword=${encodeURIComponent(projectName)}&advanced_serach_flag=1`;
  const html = await authenticatedFetch(searchUrl);

  const results: { url: string; title: string }[] = [];
  const seenUrls = new Set<string>();

  // Primary: Match c-teaser blocks (Projectory's actual HTML structure)
  // <h3 class="c-teaser__title">
  //   <a class="c-teaser__link" href="https://www.projectory.com.au/article/...">Title</a>
  // </h3>
  const teaserRegex = /<h3[^>]*class="[^"]*c-teaser__title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/www\.projectory\.com\.au\/(?:article|project)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi;
  let match;
  while ((match = teaserRegex.exec(html)) !== null) {
    const url = match[1].trim();
    const title = match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (title && !seenUrls.has(url)) {
      seenUrls.add(url);
      results.push({ url, title });
    }
  }

  // Fallback: Match any article/project links with full URLs (covers both relative and absolute)
  const fullUrlRegex = /href="(https?:\/\/www\.projectory\.com\.au\/(?:article|project)\/[^"]+)"[^>]*>([^<]*)/g;
  while ((match = fullUrlRegex.exec(html)) !== null) {
    const url = match[1].trim();
    const title = match[2].trim();
    if (title && !seenUrls.has(url)) {
      seenUrls.add(url);
      results.push({ url, title });
    }
  }

  // Fallback: Match relative article/project links (legacy format)
  const relativeRegex = /href="(\/(?:article|project)\/[^"]+)"[^>]*>([^<]*)/g;
  while ((match = relativeRegex.exec(html)) !== null) {
    const url = `https://www.projectory.com.au${match[1].trim()}`;
    const title = match[2].trim();
    if (title && !seenUrls.has(url)) {
      seenUrls.add(url);
      results.push({ url, title });
    }
  }

  return results;
}

// ── Extract Project Data from Page ──

function parseProjectPage(html: string, sourceUrl: string): ProjectoryProjectData | null {
  const snapshot: Record<string, string> = {};

  // Parse snapshot fields (key: value pairs in the project page)
  const fieldPatterns = [
    { key: "Project Name", regex: /Project\s*Name[^:]*:\s*([^<\n]+)/i },
    { key: "Project Status", regex: /Project\s*Status[^:]*:\s*([^<\n]+)/i },
    { key: "Site / Location", regex: /Site\s*\/?\s*Location[^:]*:\s*([^<\n]+)/i },
    { key: "CAPEX", regex: /CAPEX[^:]*:\s*([^<\n]+)/i },
    { key: "Proponent", regex: /Proponent[^:]*:\s*([^<\n]+)/i },
    { key: "Contractor", regex: /Contractor[^:]*:\s*([^<\n]+)/i },
    { key: "Construction Start", regex: /Construction\s*Start[^:]*:\s*([^<\n]+)/i },
    { key: "Practical Completion", regex: /Practical\s*Completion[^:]*:\s*([^<\n]+)/i },
    { key: "Project Region", regex: /Project\s*Region[^:]*:\s*([^<\n]+)/i },
    { key: "Project Type", regex: /Project\s*Type[^:]*:\s*([^<\n]+)/i },
    { key: "Design Consultant", regex: /Design\s*Consultant[^:]*:\s*([^<\n]+)/i },
    { key: "Subcontractor", regex: /Subcontractor[^:]*:\s*([^<\n]+)/i },
    { key: "Project Lifespan", regex: /Project\s*Lifespan[^:]*:\s*([^<\n]+)/i },
  ];

  for (const { key, regex } of fieldPatterns) {
    const m = html.match(regex);
    if (m) {
      snapshot[key] = m[1].trim().replace(/<[^>]+>/g, "").trim();
    }
  }

  // Also try parsing from structured HTML tables/divs
  const tdRegex = /<td[^>]*class="[^"]*snapshot[^"]*"[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>/gi;
  let match;
  while ((match = tdRegex.exec(html)) !== null) {
    snapshot[match[1].trim()] = match[2].trim();
  }

  // Parse contacts/stakeholders from the page
  const stakeholders: { name: string; position: string; organisation: string; email?: string }[] = [];
  const contactRegex = /class="[^"]*contact[^"]*"[^>]*>[\s\S]*?<strong>([^<]+)<\/strong>[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi;
  while ((match = contactRegex.exec(html)) !== null) {
    stakeholders.push({
      name: match[1].trim(),
      position: match[2].trim(),
      organisation: match[3].trim(),
    });
  }

  // Parse delivery chain from contractor field
  const contractorText = snapshot["Contractor"] || "";
  const contractors: { name: string; role: string; detail?: string }[] = contractorText
    .split(/[;,]/)
    .map(c => c.trim())
    .filter(c => c.length > 2 && !c.match(/^\(.*\)$/))
    .map(c => ({ name: c, role: "Contractor", detail: "Confirmed via Projectory" }));

  // Extract design consultants
  const consultantText = snapshot["Design Consultant"] || "";
  const designConsultants: { name: string; role: string; detail?: string }[] = consultantText
    .split(/[;,]/)
    .map(c => c.trim())
    .filter(c => c.length > 2)
    .map(c => ({ name: c, role: "Design Consultant", detail: "Confirmed via Projectory" }));

  // Extract subcontractors
  const subText = snapshot["Subcontractor"] || "";
  const subcontractors: { name: string; role: string; detail?: string }[] = subText
    .split(/[;,]/)
    .map(c => c.trim())
    .filter(c => c.length > 2)
    .map(c => ({ name: c, role: "Subcontractor", detail: "Confirmed via Projectory" }));

  // Map sector from project type
  const projectType = (snapshot["Project Type"] || "").toLowerCase();
  let sector = "infrastructure";
  if (projectType.includes("mining") || projectType.includes("resource")) sector = "mining";
  if (projectType.includes("energy") || projectType.includes("solar") || projectType.includes("wind")) sector = "energy";
  if (projectType.includes("oil") || projectType.includes("gas")) sector = "oil_gas";
  if (projectType.includes("defence") || projectType.includes("defense")) sector = "defence";

  // Build timeline signals
  const timelineSignals: { phase: string; signal: string; date?: string }[] = [];
  if (snapshot["Construction Start"]) {
    timelineSignals.push({ phase: "construction", signal: "Construction start date", date: snapshot["Construction Start"] });
  }
  if (snapshot["Practical Completion"]) {
    timelineSignals.push({ phase: "completion", signal: "Practical completion date", date: snapshot["Practical Completion"] });
  }
  if (snapshot["Project Status"]) {
    timelineSignals.push({ phase: "current", signal: snapshot["Project Status"] });
  }

  if (Object.keys(snapshot).length === 0) return null;

  return {
    name: snapshot["Project Name"] || "",
    location: snapshot["Site / Location"] || snapshot["Project Region"] || "",
    sector,
    estimatedValue: snapshot["CAPEX"] || "",
    projectStage: snapshot["Project Status"] || "",
    owner: snapshot["Proponent"] || "",
    epcContractor: contractors[0]?.name || "",
    designConsultants,
    contractors,
    subcontractors,
    stakeholders,
    timelineSignals,
    sourceUrl,
    rawSnapshotData: snapshot,
  };
}

// ── Enrich a Single Project ──

export async function enrichProject(projectId: number): Promise<EnrichmentResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get project details
  const [project] = await db
    .select({ id: projects.id, name: projects.name, owner: projects.owner })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return {
      projectId,
      projectName: "Unknown",
      matched: false,
      enriched: false,
      contractorsDiscovered: 0,
      consultantsDiscovered: 0,
      stageUpdated: false,
      sourceUrl: "",
      error: "Project not found",
    };
  }

  console.log(`[Projectory] Enriching: ${project.name}`);

  try {
    // Search Projectory for the project
    let searchResults = await searchProject(project.name);
    await sleep(RATE_LIMIT_MS);

    if (searchResults.length === 0) {
      // Try searching with just the first few words
      const shortName = project.name.split(/\s+/).slice(0, 3).join(" ");
      searchResults = await searchProject(shortName);
      await sleep(RATE_LIMIT_MS);
    }

    if (searchResults.length === 0) {
      // Log as not found
      const logEntry: InsertProjectoryEnrichmentLog = {
        projectId,
        projectName: project.name,
        status: "not_found",
        searchQuery: project.name,
      };
      await db.insert(projectoryEnrichmentLog).values(logEntry);

      return {
        projectId,
        projectName: project.name,
        matched: false,
        enriched: false,
        contractorsDiscovered: 0,
        consultantsDiscovered: 0,
        stageUpdated: false,
        sourceUrl: "",
      };
    }

    // Find the best match
    const projectNameLower = project.name.toLowerCase();
    const firstWord = projectNameLower.split(/\s+/)[0];
    const bestMatch = searchResults.find(r =>
      r.title.toLowerCase().includes(firstWord) ||
      projectNameLower.includes(r.title.toLowerCase().split(/\s+/)[0])
    ) || searchResults[0];

    // Fetch the project/article page
    const pageHtml = await authenticatedFetch(bestMatch.url);
    await sleep(RATE_LIMIT_MS);

    const projectData = parseProjectPage(pageHtml, bestMatch.url);

    if (!projectData || Object.keys(projectData.rawSnapshotData).length === 0) {
      const logEntry: InsertProjectoryEnrichmentLog = {
        projectId,
        projectName: project.name,
        projectoryUrl: bestMatch.url,
        status: "matched",
        searchQuery: project.name,
      };
      await db.insert(projectoryEnrichmentLog).values(logEntry);

      return {
        projectId,
        projectName: project.name,
        matched: true,
        enriched: false,
        contractorsDiscovered: 0,
        consultantsDiscovered: 0,
        stageUpdated: false,
        sourceUrl: bestMatch.url,
      };
    }

    // Update the project record with enrichment data
    const [existing] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!existing) throw new Error("Project disappeared during enrichment");

    const updateData: Record<string, any> = {};
    let stageUpdated = false;

    // Merge contractors
    const existingContractors = (existing.contractors as any[]) || [];
    const newContractors = [...existingContractors];
    let contractorsDiscovered = 0;

    const allNewEntities = [
      ...projectData.contractors,
      ...projectData.subcontractors,
    ];

    for (const c of allNewEntities) {
      if (c.name && !newContractors.some(ec => ec.name?.toLowerCase() === c.name.toLowerCase())) {
        newContractors.push({
          name: c.name,
          status: "confirmed",
          confidence: 0.9,
          detail: `${c.role} (Projectory)`,
        });
        contractorsDiscovered++;
      }
    }

    for (const c of projectData.designConsultants) {
      if (c.name && !newContractors.some(ec => ec.name?.toLowerCase() === c.name.toLowerCase())) {
        newContractors.push({
          name: c.name,
          status: "confirmed",
          confidence: 0.85,
          detail: "Design consultant (Projectory)",
        });
        contractorsDiscovered++;
      }
    }

    if (contractorsDiscovered > 0) {
      updateData.contractors = newContractors;
    }

    // Update stage if Projectory has more specific info
    if (projectData.projectStage && projectData.projectStage !== existing.stage) {
      updateData.stage = projectData.projectStage;
      stageUpdated = true;
    }

    // Update value if not already set
    if (projectData.estimatedValue && (!existing.value || existing.value === "Not disclosed")) {
      updateData.value = projectData.estimatedValue;
    }

    // Update location if more specific
    if (projectData.location && (!existing.location || existing.location === "Australia")) {
      updateData.location = projectData.location;
    }

    // Add Projectory source
    const existingSources = (existing.sources as any[]) || [];
    if (!existingSources.some((s: any) => s.label === "Projectory")) {
      existingSources.push({
        label: "Projectory",
        url: bestMatch.url,
        date: new Date().toISOString().split("T")[0],
      });
      updateData.sources = existingSources;
    }

    // Mark as Projectory enriched
    updateData.projectoryEnriched = true;

    if (Object.keys(updateData).length > 0) {
      await db.update(projects).set(updateData).where(eq(projects.id, projectId));
    }
    // Stage 5A: Projectory corroboration — update sourceLastSeenAt and re-activate if stale
    await touchProjectSourceSeen(projectId, true);

    // Log enrichment
    const logEntry: InsertProjectoryEnrichmentLog = {
      projectId,
      projectName: project.name,
      projectoryUrl: bestMatch.url,
      status: "matched",
      contractorsFound: [...projectData.contractors, ...projectData.subcontractors],
      consultantsFound: projectData.designConsultants,
      stakeholdersFound: projectData.stakeholders,
      stageUpdate: stageUpdated ? projectData.projectStage : undefined,
      valueUpdate: projectData.estimatedValue || undefined,
      timelineSignals: projectData.timelineSignals,
      searchQuery: project.name,
    };
    await db.insert(projectoryEnrichmentLog).values(logEntry);

    // Update contractor frequency table
    const allEntities = [
      ...projectData.contractors,
      ...projectData.designConsultants,
      ...projectData.subcontractors,
    ];
    for (const entity of allEntities) {
      if (!entity.name || entity.name.length < 3) continue;
      await upsertContractorFrequency(entity.name, entity.role, projectId, existing.sector, existing.location);
    }

    console.log(`[Projectory] Enriched: ${project.name} — ${contractorsDiscovered} new contractors, stage ${stageUpdated ? "updated" : "unchanged"}`);

    return {
      projectId,
      projectName: project.name,
      matched: true,
      enriched: contractorsDiscovered > 0 || stageUpdated,
      contractorsDiscovered,
      consultantsDiscovered: projectData.designConsultants.length,
      stageUpdated,
      sourceUrl: bestMatch.url,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Projectory] Enrichment failed for ${project.name}: ${errMsg}`);

    // Detect auth expiry
    const isAuthError = errMsg.includes("401") || errMsg.includes("403") || errMsg.includes("Login failed");

    try {
      const logEntry: InsertProjectoryEnrichmentLog = {
        projectId,
        projectName: project.name,
        status: isAuthError ? "auth_expired" : "error",
        searchQuery: project.name,
        errorMessage: errMsg,
      };
      await db.insert(projectoryEnrichmentLog).values(logEntry);
    } catch {}

    return {
      projectId,
      projectName: project.name,
      matched: false,
      enriched: false,
      contractorsDiscovered: 0,
      consultantsDiscovered: 0,
      stageUpdated: false,
      sourceUrl: "",
      error: errMsg,
    };
  }
}

// ── Contractor Frequency Upsert ──

async function upsertContractorFrequency(
  contractorName: string,
  role: string,
  projectId: number,
  sector: string,
  location: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Extract state from location
  const stateMatch = location?.match(/\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/i);
  const state = stateMatch ? stateMatch[1].toUpperCase() : "";

  // Check if entry exists
  const [existing] = await db
    .select()
    .from(projectoryContractorFrequency)
    .where(
      and(
        eq(projectoryContractorFrequency.contractorName, contractorName),
        eq(projectoryContractorFrequency.role, role)
      )
    )
    .limit(1);

  if (existing) {
    const existingProjectIds = (existing.projectIds as number[]) || [];
    const existingSectors = (existing.sectors as string[]) || [];
    const existingStates = (existing.states as string[]) || [];

    if (!existingProjectIds.includes(projectId)) {
      existingProjectIds.push(projectId);
    }
    if (sector && !existingSectors.includes(sector)) {
      existingSectors.push(sector);
    }
    if (state && !existingStates.includes(state)) {
      existingStates.push(state);
    }

    await db.update(projectoryContractorFrequency).set({
      projectCount: existingProjectIds.length,
      projectIds: existingProjectIds,
      sectors: existingSectors,
      states: existingStates,
      lastSeenAt: new Date(),
    }).where(eq(projectoryContractorFrequency.id, existing.id));
  } else {
    const entry: InsertProjectoryContractorFrequency = {
      contractorName,
      role,
      projectCount: 1,
      projectIds: [projectId],
      sectors: sector ? [sector] : [],
      states: state ? [state] : [],
    };
    await db.insert(projectoryContractorFrequency).values(entry);
  }
}

// ── Bulk Enrichment ──

export async function enrichUnenrichedProjects(limit: number = 20): Promise<BulkEnrichmentResult> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Find projects not yet enriched via Projectory
  const unenriched = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(
      and(
        sql`(${projects.projectoryEnriched} IS NULL OR ${projects.projectoryEnriched} = false)`,
        sql`${projects.lifecycleStatus} != 'archived'`
      )
    )
    .orderBy(
      sql`CASE WHEN ${projects.priority} = 'hot' THEN 0 WHEN ${projects.priority} = 'warm' THEN 1 ELSE 2 END`,
      desc(projects.createdAt)
    )
    .limit(limit);

  console.log(`[Projectory] Bulk enrichment: ${unenriched.length} projects to process`);

  const results: EnrichmentResult[] = [];
  let totalContractorsDiscovered = 0;
  let totalConsultantsDiscovered = 0;
  let totalStageUpdates = 0;
  let totalErrors = 0;

  for (const project of unenriched) {
    const result = await enrichProject(project.id);
    results.push(result);

    if (result.error) totalErrors++;
    totalContractorsDiscovered += result.contractorsDiscovered;
    totalConsultantsDiscovered += result.consultantsDiscovered;
    if (result.stageUpdated) totalStageUpdates++;

    // Rate limit between projects
    await sleep(RATE_LIMIT_MS);
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  const totalMatched = results.filter(r => r.matched).length;
  const totalEnriched = results.filter(r => r.enriched).length;

  console.log(`[Projectory] Bulk enrichment complete in ${duration}s: ${totalEnriched} enriched, ${totalMatched} matched, ${totalContractorsDiscovered} contractors, ${totalStageUpdates} stage updates`);

  return {
    totalProcessed: results.length,
    totalMatched,
    totalEnriched,
    totalContractorsDiscovered,
    totalConsultantsDiscovered,
    totalStageUpdates,
    totalErrors,
    results,
    duration,
  };
}

// ── Contractor Frequency Analysis ──

export async function getContractorFrequency(): Promise<ContractorFrequencyItem[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(projectoryContractorFrequency)
    .orderBy(desc(projectoryContractorFrequency.projectCount));

  return rows.map(r => ({
    name: r.contractorName,
    role: r.role,
    projectCount: r.projectCount,
    projects: [], // Would need a join to get project names
    sectors: (r.sectors as string[]) || [],
    states: (r.states as string[]) || [],
  }));
}

// ── Enrichment Stats ──

export async function getEnrichmentStats() {
  const db = await getDb();
  if (!db) return null;

  const [totalEnriched] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(eq(projects.projectoryEnriched, true));

  const [totalUnenriched] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(projects)
    .where(
      sql`(${projects.projectoryEnriched} IS NULL OR ${projects.projectoryEnriched} = false) AND ${projects.lifecycleStatus} != 'archived'`
    );

  const logRows = await db
    .select({
      status: projectoryEnrichmentLog.status,
    })
    .from(projectoryEnrichmentLog);

  const totalLogs = logRows.length;
  const totalMatched = logRows.filter(r => r.status === "matched").length;
  const totalNotFound = logRows.filter(r => r.status === "not_found").length;
  const totalAuthExpired = logRows.filter(r => r.status === "auth_expired").length;
  const totalErrorLogs = logRows.filter(r => r.status === "error").length;

  return {
    projectsEnriched: totalEnriched?.count || 0,
    projectsUnenriched: totalUnenriched?.count || 0,
    totalAttempts: totalLogs,
    totalMatched,
    totalNotFound,
    totalAuthExpired,
    totalErrors: totalErrorLogs,
    session: getSessionStatus(),
  };
}

// ── Utility ──

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Exported helpers for testing ──

export const _testing = {
  parseProjectPage,
  isSessionExpired,
  getSessionStatus,
  login,
};
