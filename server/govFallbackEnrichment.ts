/**
 * Government-Owner Fallback Enrichment Service
 *
 * For projects blocked from Apollo due to government/public-body ownership,
 * this service attempts to find procurement/project/delivery stakeholders via:
 *   1. Projectory search (primary — authenticated, structured data)
 *   2. LLM-assisted web search (secondary — for projects Projectory doesn't find)
 *   3. Structured manual-discovery flag (fallback — when no reliable source exists)
 *
 * Honesty rules:
 *   - Named contacts from Projectory → verificationStatus = "unverified", enrichmentSource = "web_search"
 *   - Role-only contacts (no name) → verificationStatus = "ai_suggested", title = role, name = "[Role TBD]"
 *   - Never invent named people from model memory
 *   - All contacts get govFallbackStatus written to the project record
 *
 * Status model (written to projects.govFallbackStatus):
 *   government_fallback_contact_found         — named person with email or LinkedIn
 *   government_fallback_named_person_no_email — named person, no direct contact path
 *   government_fallback_role_only             — only a likely role identified, no named person
 *   government_fallback_no_result             — no useful result from any path
 *   government_fallback_manual_review_required — complex project, human review needed
 */

import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  projects, contacts, contactProjects, reports,
  type InsertContact, type InsertContactProject,
} from "../drizzle/schema";
import { enrichProject as projectoryEnrichProject } from "./projectoryEnrichment";
import { invokeLLM } from "./_core/llm";

export type GovFallbackStatus =
  | "government_fallback_contact_found"
  | "government_fallback_named_person_no_email"
  | "government_fallback_role_only"
  | "government_fallback_no_result"
  | "government_fallback_manual_review_required";

export interface GovFallbackContact {
  name: string;
  title: string;
  company: string;
  email?: string;
  linkedin?: string;
  sourceUrl?: string;
  isNamedPerson: boolean;  // false = role-only placeholder
  confidence: "high" | "medium" | "low";
  discoveryPath: "projectory" | "web_search" | "llm_inference";
}

export interface GovFallbackResult {
  projectId: number;
  projectName: string;
  owner: string;
  govFallbackStatus: GovFallbackStatus;
  contactsFound: GovFallbackContact[];
  contactsSaved: number;
  junctionRowsAdded: number;
  sendReadyAfter: boolean;
  discoveryPath: string;
  notes: string;
}

// Target roles for government project procurement/delivery contacts
const GOV_TARGET_ROLES = [
  "Project Director",
  "Project Manager",
  "Procurement Manager",
  "Infrastructure Manager",
  "Asset Manager",
  "Operations Manager",
  "Engineering Manager",
  "Director of Infrastructure",
  "Director of Projects",
  "General Manager Infrastructure",
  "Capital Works Manager",
  "Delivery Manager",
];

/**
 * Determine the best target roles based on project sector and name
 */
function getTargetRolesForProject(project: { name: string; sector: string; overview?: string | null }): string[] {
  const text = `${project.name} ${project.sector} ${project.overview || ""}`.toLowerCase();

  if (text.includes("water") || text.includes("pipeline") || text.includes("sewage")) {
    return ["Infrastructure Manager", "Project Manager", "Asset Manager", "Capital Works Manager", "Engineering Manager"];
  }
  if (text.includes("road") || text.includes("highway") || text.includes("bridge")) {
    return ["Project Manager", "Delivery Manager", "Director of Infrastructure", "Capital Works Manager", "Procurement Manager"];
  }
  if (text.includes("hydro") || text.includes("power") || text.includes("energy")) {
    return ["Project Director", "Engineering Manager", "Operations Manager", "Asset Manager", "Project Manager"];
  }
  if (text.includes("port") || text.includes("harbour") || text.includes("wharf")) {
    return ["Port Operations Manager", "Infrastructure Manager", "Project Manager", "Procurement Manager", "Asset Manager"];
  }
  if (text.includes("arts") || text.includes("culture") || text.includes("community")) {
    return ["Project Manager", "Capital Works Manager", "Procurement Manager", "Director of Infrastructure"];
  }
  if (text.includes("mining") || text.includes("resource")) {
    return ["Project Director", "Operations Manager", "Engineering Manager", "Procurement Manager"];
  }

  // Default
  return GOV_TARGET_ROLES.slice(0, 5);
}

/**
 * Step 1: Try Projectory enrichment for the project.
 * Returns any stakeholders found in the Projectory page.
 */
async function tryProjectoryPath(
  projectId: number,
  projectName: string
): Promise<{ stakeholders: { name: string; position: string; organisation: string; email?: string }[]; sourceUrl: string; found: boolean }> {
  try {
    const result = await projectoryEnrichProject(projectId);

    if (!result.matched) {
      return { stakeholders: [], sourceUrl: "", found: false };
    }

    // Projectory enrichment updates the project record with contractors/consultants
    // but stakeholders from the page are logged in projectoryEnrichmentLog.
    // We need to re-read the enrichment log to get stakeholders.
    const db = await getDb();
    if (!db) return { stakeholders: [], sourceUrl: result.sourceUrl, found: true };

    const { projectoryEnrichmentLog } = await import("../drizzle/schema");
    const [logRow] = await db
      .select({ stakeholdersFound: projectoryEnrichmentLog.stakeholdersFound, projectoryUrl: projectoryEnrichmentLog.projectoryUrl })
      .from(projectoryEnrichmentLog)
      .where(eq(projectoryEnrichmentLog.projectId, projectId))
      .orderBy(projectoryEnrichmentLog.id)
      .limit(1);

    const stakeholders = (logRow?.stakeholdersFound as any[]) || [];
    return {
      stakeholders,
      sourceUrl: logRow?.projectoryUrl || result.sourceUrl,
      found: true,
    };
  } catch (err: any) {
    console.warn(`[GovFallback] Projectory path failed for "${projectName}": ${err?.message}`);
    return { stakeholders: [], sourceUrl: "", found: false };
  }
}

/**
 * Step 2: LLM-assisted inference for likely roles.
 * IMPORTANT: This does NOT invent named people. It only infers likely roles
 * based on the project type and owner. Returns role-only placeholders.
 */
async function tryLLMRoleInference(project: {
  name: string;
  owner: string;
  sector: string;
  overview?: string | null;
  location: string;
}): Promise<GovFallbackContact[]> {
  const targetRoles = getTargetRolesForProject(project);

  const prompt = `You are a market intelligence assistant for Atlas Copco Power Technique in Australia.

Project: "${project.name}"
Owner: "${project.owner}"
Sector: ${project.sector}
Location: ${project.location}
Overview: ${project.overview || "Not available"}

Task: For this government/public-body project, identify the 2-3 most likely procurement or project delivery roles that would be responsible for equipment and services procurement.

Rules:
- Do NOT invent named people. Only return role titles.
- Only include roles that are realistic for this type of government project.
- Focus on roles that would be involved in procuring portable air compressors, pumps, generators, or similar PT equipment.
- Return only roles from this list where relevant: ${targetRoles.join(", ")}

Return JSON array of objects with fields: title (string), rationale (string, max 20 words).
Example: [{"title": "Project Manager", "rationale": "Responsible for civil works delivery and equipment procurement"}]`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system" as const, content: "You are a market intelligence assistant. Return only valid JSON." },
        { role: "user" as const, content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "role_inference",
          strict: true,
          schema: {
            type: "object",
            properties: {
              roles: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    rationale: { type: "string" },
                  },
                  required: ["title", "rationale"],
                  additionalProperties: false,
                },
              },
            },
            required: ["roles"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response?.choices?.[0]?.message?.content;
    if (!rawContent) return [];
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

    const parsed = JSON.parse(content);
    const roles: { title: string; rationale: string }[] = parsed.roles || [];

    return roles.slice(0, 3).map(r => ({
      name: "[Role TBD — Manual Discovery Required]",
      title: r.title,
      company: project.owner,
      isNamedPerson: false,
      confidence: "low" as const,
      discoveryPath: "llm_inference" as const,
      sourceUrl: undefined,
    }));
  } catch (err: any) {
    console.warn(`[GovFallback] LLM role inference failed: ${err?.message}`);
    return [];
  }
}

/**
 * Save a government fallback contact to the contacts table and create junction row.
 */
async function saveGovContact(
  db: any,
  contact: GovFallbackContact,
  project: { id: number; name: string; priority: string; reportId: number },
): Promise<{ contactId: number; isNew: boolean }> {
  // Check for existing contact with same name + company
  const [existing] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.name, contact.name),
        eq(contacts.company, contact.company)
      )
    )
    .limit(1);

  let contactId: number;
  let isNew = false;

  if (existing) {
    contactId = existing.id;
  } else {
    const insertData: InsertContact = {
      reportId: project.reportId,
      name: contact.name,
      title: contact.title,
      company: contact.company,
      project: project.name,
      priority: project.priority as "hot" | "warm" | "cold",
      roleBucket: contact.title,
      email: contact.email,
      linkedin: contact.linkedin,
      enrichmentStatus: contact.isNamedPerson ? "enriched" : "pending",
      enrichmentSource: contact.discoveryPath === "projectory" ? "web_search" : "web_search",
      sourceUrl: contact.sourceUrl,
      verificationStatus: contact.isNamedPerson ? "unverified" : "ai_suggested",
      confidenceScore: contact.confidence,
      roleRelevance: contact.confidence === "high" ? "high" : contact.confidence === "medium" ? "medium" : "low",
      source: "scraper",
      regionClassification: "australia",
    };

    const [result] = await db.insert(contacts).values(insertData);
    contactId = (result as any).insertId;
    isNew = true;
  }

  // Create junction row if not already linked
  const [existingJunction] = await db
    .select({ id: contactProjects.id })
    .from(contactProjects)
    .where(
      and(
        eq(contactProjects.contactId, contactId),
        eq(contactProjects.projectId, project.id)
      )
    )
    .limit(1);

  if (!existingJunction) {
    const junctionData: InsertContactProject = {
      contactId,
      projectId: project.id,
      projectName: project.name,
      relevance: "primary",
    };
    await db.insert(contactProjects).values(junctionData);
  }

  return { contactId, isNew };
}

/**
 * Check if a project is now send-ready (has at least one contact with email or LinkedIn + medium/high relevance)
 */
async function checkSendReady(db: any, projectId: number): Promise<boolean> {
  const links = await db
    .select({ contactId: contactProjects.contactId })
    .from(contactProjects)
    .where(eq(contactProjects.projectId, projectId));

  if (links.length === 0) return false;

  const contactIds = links.map((l: any) => l.contactId);
  const contactRows = await db
    .select({ email: contacts.email, linkedin: contacts.linkedin, roleRelevance: contacts.roleRelevance })
    .from(contacts)
    .where(inArray(contacts.id, contactIds));

  return contactRows.some((c: any) => {
    const hasSendPath = c.email || c.linkedin;
    const isRelevant = c.roleRelevance === "high" || c.roleRelevance === "medium";
    return hasSendPath && isRelevant;
  });
}

/**
 * Run government fallback enrichment for a single project.
 */
export async function runGovFallback(projectId: number): Promise<GovFallbackResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw new Error(`Project ${projectId} not found`);

  const result: GovFallbackResult = {
    projectId,
    projectName: project.name,
    owner: project.owner || "",
    govFallbackStatus: "government_fallback_no_result",
    contactsFound: [],
    contactsSaved: 0,
    junctionRowsAdded: 0,
    sendReadyAfter: false,
    discoveryPath: "",
    notes: "",
  };

  console.log(`\n[GovFallback] Processing: ${project.name.slice(0, 60)}`);
  console.log(`             Owner: ${project.owner}`);

  // ── Step 1: Projectory path ──
  const projectoryResult = await tryProjectoryPath(projectId, project.name);

  if (projectoryResult.found && projectoryResult.stakeholders.length > 0) {
    console.log(`[GovFallback] Projectory found ${projectoryResult.stakeholders.length} stakeholder(s)`);
    result.discoveryPath = "projectory";

    for (const s of projectoryResult.stakeholders) {
      if (!s.name || s.name === "[Role TBD — Manual Discovery Required]") continue;

      const contact: GovFallbackContact = {
        name: s.name,
        title: s.position || "Stakeholder",
        company: s.organisation || project.owner || "",
        email: s.email,
        isNamedPerson: true,
        confidence: s.email ? "high" : "medium",
        discoveryPath: "projectory",
        sourceUrl: projectoryResult.sourceUrl,
      };
      result.contactsFound.push(contact);
    }
  } else if (projectoryResult.found) {
    console.log(`[GovFallback] Projectory matched project but found no stakeholders`);
    result.discoveryPath = "projectory";
    result.notes = "Projectory matched project but no stakeholders listed on page";
  } else {
    console.log(`[GovFallback] Projectory: no match found`);
    result.discoveryPath = "llm_inference";
  }

  // ── Step 2: LLM role inference (always run if no named contacts found) ──
  const hasNamedContacts = result.contactsFound.some(c => c.isNamedPerson);

  if (!hasNamedContacts) {
    console.log(`[GovFallback] Running LLM role inference...`);
    const roleContacts = await tryLLMRoleInference({
      name: project.name,
      owner: project.owner || "",
      sector: project.sector,
      overview: project.overview,
      location: project.location,
    });
    result.contactsFound.push(...roleContacts);

    if (roleContacts.length > 0) {
      result.notes += ` LLM inferred ${roleContacts.length} likely role(s) — not verified named people.`;
    }
  }

  // ── Determine govFallbackStatus ──
  const namedWithContact = result.contactsFound.filter(c => c.isNamedPerson && (c.email || c.linkedin));
  const namedNoContact = result.contactsFound.filter(c => c.isNamedPerson && !c.email && !c.linkedin);
  const roleOnly = result.contactsFound.filter(c => !c.isNamedPerson);

  if (namedWithContact.length > 0) {
    result.govFallbackStatus = "government_fallback_contact_found";
  } else if (namedNoContact.length > 0) {
    result.govFallbackStatus = "government_fallback_named_person_no_email";
  } else if (roleOnly.length > 0) {
    result.govFallbackStatus = "government_fallback_role_only";
  } else if (projectoryResult.found) {
    // Projectory found the project but no useful contacts — complex, needs human review
    result.govFallbackStatus = "government_fallback_manual_review_required";
  } else {
    result.govFallbackStatus = "government_fallback_no_result";
  }

  // ── Save contacts and junction rows ──
  let junctionRowsBefore = 0;
  const existingLinks = await db
    .select({ id: contactProjects.id })
    .from(contactProjects)
    .where(eq(contactProjects.projectId, projectId));
  junctionRowsBefore = existingLinks.length;

  for (const contact of result.contactsFound) {
    try {
      const { isNew } = await saveGovContact(db, contact, {
        id: project.id,
        name: project.name,
        priority: project.priority,
        reportId: project.reportId,
      });
      if (isNew) result.contactsSaved++;
    } catch (err: any) {
      console.warn(`[GovFallback] Failed to save contact "${contact.name}": ${err?.message}`);
    }
  }

  const afterLinks = await db
    .select({ id: contactProjects.id })
    .from(contactProjects)
    .where(eq(contactProjects.projectId, projectId));
  result.junctionRowsAdded = afterLinks.length - junctionRowsBefore;

  // ── Update project with govFallbackStatus ──
  await db.update(projects)
    .set({ govFallbackStatus: result.govFallbackStatus } as any)
    .where(eq(projects.id, projectId));

  // ── Check send-ready ──
  result.sendReadyAfter = await checkSendReady(db, projectId);

  console.log(`[GovFallback] → ${result.govFallbackStatus} | contacts saved: ${result.contactsSaved} | send-ready: ${result.sendReadyAfter}`);

  return result;
}

/**
 * Run government fallback enrichment for all 8 blocked government projects.
 */
export async function runGovFallbackBatch(projectIds: number[]): Promise<GovFallbackResult[]> {
  const results: GovFallbackResult[] = [];

  for (const id of projectIds) {
    try {
      const result = await runGovFallback(id);
      results.push(result);
    } catch (err: any) {
      console.error(`[GovFallback] Fatal error for project ${id}: ${err?.message}`);
      results.push({
        projectId: id,
        projectName: `Project ${id}`,
        owner: "",
        govFallbackStatus: "government_fallback_no_result",
        contactsFound: [],
        contactsSaved: 0,
        junctionRowsAdded: 0,
        sendReadyAfter: false,
        discoveryPath: "error",
        notes: err?.message || "Unknown error",
      });
    }
    // Rate limit between projects
    await new Promise(r => setTimeout(r, 1500));
  }

  return results;
}
