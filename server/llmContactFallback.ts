/**
 * LLM Contact Generation Fallback
 *
 * When the LinkedIn People Search API quota is exhausted, this service uses
 * the built-in LLM to infer likely decision-makers for a project based on:
 * - Company name, size, and industry
 * - Project type, sector, and value
 * - Common organisational structures in Australian mining, energy, infrastructure
 *
 * Generated contacts are marked with enrichmentSource = "llm" so the UI can
 * distinguish them from LinkedIn-verified contacts. LLM contacts include:
 * - Inferred name patterns (generic role-based names are NOT used)
 * - Realistic job titles
 * - Inferred corporate email patterns
 * - Role bucket classification
 *
 * The LLM is prompted to generate plausible but clearly labelled contacts,
 * NOT to fabricate real people. The UI shows an "AI-Generated" badge.
 */

import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { contacts, projects, type InsertContact } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { computeVerificationScore, generateLinkedInSearchUrl } from "./verificationScoring";
import { classifyRoleRelevance } from "./roleRelevance";

// ── Types ──

export interface LLMGeneratedContact {
  name: string;
  title: string;
  roleBucket: string;
  email: string | null;
  reasoning: string;
  confidence: "high" | "medium" | "low";
}

export interface LLMFallbackResult {
  projectId: number;
  projectName: string;
  contactsGenerated: number;
  contacts: LLMGeneratedContact[];
  source: "llm";
  note: string;
}

// ── Configuration ──

const MAX_CONTACTS_PER_PROJECT = 5;
const MIN_VERIFICATION_SCORE = 60;
const MIN_CONFIDENCE = "medium"; // Reject "low" confidence contacts

// ── Helpers ──

/** Infer a corporate email pattern from name and company */
function inferEmail(name: string, company: string): string | null {
  if (!name || !company) return null;
  const parts = name.toLowerCase().trim().split(/\s+/);
  if (parts.length < 2) return null;
  const first = parts[0].replace(/[^a-z]/g, "");
  const last = parts[parts.length - 1].replace(/[^a-z]/g, "");
  if (!first || !last) return null;

  const domain = company
    .toLowerCase()
    .replace(/\s*(pty|ltd|limited|inc|corp|group|australia|holdings)\s*/gi, "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (!domain) return null;
  return `${first}.${last}@${domain}.com.au`;
}

/** Map role bucket string to a clean label */
function normalizeRoleBucket(role: string): string {
  const h = role.toLowerCase();
  if (h.includes("procurement") || h.includes("supply chain") || h.includes("purchasing"))
    return "procurement";
  if (h.includes("project manager") || h.includes("project director"))
    return "project_manager";
  if (h.includes("engineer") || h.includes("engineering"))
    return "engineering";
  if (h.includes("operations") || h.includes("ops"))
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
  if (h.includes("construction"))
    return "construction_manager";
  if (h.includes("mining"))
    return "mining_manager";
  if (h.includes("plant"))
    return "plant_manager";
  return "other";
}

// ── Core LLM Contact Generation ──

/**
 * Use the LLM to generate plausible decision-maker contacts for a project.
 * These are NOT real people — they are role-based inferences that help sales
 * teams know WHO to look for at a company.
 */
export async function generateContactsWithLLM(
  projectName: string,
  owner: string,
  contractors: { name: string; status: string }[],
  sector: string,
  projectValue: string,
  location: string,
  stage?: string,
  preferredRoles?: string[] | null,
): Promise<LLMGeneratedContact[]> {
  const companies = [owner, ...contractors.map(c => c.name)].filter(Boolean);
  const uniqueCompanies = Array.from(new Set(companies)).slice(0, 3); // Limit to top 3 companies

  const roleGuidance = preferredRoles && preferredRoles.length > 0
    ? `The user is specifically interested in these buyer roles: ${preferredRoles.join(", ")}. Prioritize generating contacts in these roles.`
    : "Generate contacts across procurement, project management, operations, and engineering roles.";

  const prompt = `You are an Australian industrial market intelligence assistant. Given a project, generate realistic decision-maker contacts that a sales team should target.

PROJECT DETAILS:
- Name: ${projectName}
- Owner/Client: ${owner}
- Contractors: ${contractors.map(c => `${c.name} (${c.status})`).join(", ") || "None specified"}
- Sector: ${sector}
- Value: ${projectValue}
- Location: ${location}
- Stage: ${stage || "Unknown"}

TARGET COMPANIES: ${uniqueCompanies.join(", ")}

${roleGuidance}

RULES:
1. Generate ${MAX_CONTACTS_PER_PROJECT} contacts across the target companies
2. CRITICAL — NAME UNIQUENESS: Every name you generate MUST be unique and different from common/generic names. Use the project name "${projectName}" as a seed to vary your name choices. DO NOT reuse names like "Sarah Chen", "Priya Sharma", "David Miller", "James Wilson", "Michael Thompson", "John Smith" or any other common placeholder names. Generate diverse, realistic Australian names — mix Anglo-Saxon, Southern European, East Asian, South Asian, Indigenous Australian, and Middle Eastern names that reflect Australia's multicultural workforce.
3. Job titles must be specific and realistic for the sector and company size
4. Each contact must have a different role/function — no duplicates
5. Assign confidence: "high" if the role definitely exists at that company type, "medium" if likely, "low" if uncertain
6. Provide brief reasoning for why this role would be relevant to Atlas Copco Power Technique equipment sales
7. For role_bucket, use one of: procurement, project_manager, engineering, operations, maintenance, site_manager, fleet_manager, general_manager, commercial, construction_manager, mining_manager, plant_manager
8. Remember: these contacts are AI-suggested role templates to guide sales outreach. The names should be plausible but clearly unique per project.

Return a JSON array of contacts.`;

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a market intelligence assistant that generates realistic contact role suggestions for B2B sales targeting in Australian mining, energy, infrastructure, and construction sectors. Always respond with valid JSON.",
        },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "contact_suggestions",
          strict: true,
          schema: {
            type: "object",
            properties: {
              contacts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Full name of the suggested contact" },
                    title: { type: "string", description: "Job title" },
                    company: { type: "string", description: "Company name" },
                    role_bucket: { type: "string", description: "Role category" },
                    confidence: { type: "string", description: "high, medium, or low" },
                    reasoning: { type: "string", description: "Why this role is relevant for Atlas Copco PT equipment sales" },
                  },
                  required: ["name", "title", "company", "role_bucket", "confidence", "reasoning"],
                  additionalProperties: false,
                },
              },
            },
            required: ["contacts"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      console.error("[LLM Fallback] No content in LLM response");
      return [];
    }

    const parsed = JSON.parse(content) as {
      contacts: Array<{
        name: string;
        title: string;
        company: string;
        role_bucket: string;
        confidence: string;
        reasoning: string;
      }>;
    };

    if (!parsed.contacts || !Array.isArray(parsed.contacts)) {
      console.error("[LLM Fallback] Invalid response structure");
      return [];
    }

    // Filter out low-confidence contacts before returning
    const mapped = parsed.contacts.slice(0, MAX_CONTACTS_PER_PROJECT).map(c => ({
      name: c.name,
      title: c.title,
      company: c.company,
      roleBucket: normalizeRoleBucket(c.role_bucket),
      email: inferEmail(c.name, c.company),
      reasoning: c.reasoning,
      confidence: (c.confidence as "high" | "medium" | "low") || "medium",
    }));

    // Quality gate: reject low-confidence contacts
    const filtered = mapped.filter(c => c.confidence !== "low");
    console.log(`[LLM Fallback] Generated ${mapped.length} contacts, kept ${filtered.length} after quality filter (rejected ${mapped.length - filtered.length} low-confidence)`);
    return filtered;
  } catch (err) {
    console.error("[LLM Fallback] Error generating contacts:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

// ── Save LLM-generated contacts to database ──

/**
 * Generate contacts using LLM and save them to the database.
 * Returns the full fallback result with metadata.
 */
export async function generateAndSaveLLMContacts(
  projectId: number,
  reportId: number,
  projectName: string,
  owner: string,
  contractors: { name: string; status: string }[],
  sector: string,
  projectValue: string,
  location: string,
  stage?: string,
  preferredRoles?: string[] | null,
): Promise<LLMFallbackResult> {
  const db = await getDb();
  if (!db) {
    return {
      projectId,
      projectName,
      contactsGenerated: 0,
      contacts: [],
      source: "llm",
      note: "Database not available",
    };
  }

  // Check if project already has LLM-generated contacts (avoid duplicates)
  const existingLLMContacts = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        sql`${contacts.project} = ${projectName}`,
        eq(contacts.enrichmentSource, "llm")
      )
    )
    .limit(1);

  if (existingLLMContacts.length > 0) {
    console.log(`[LLM Fallback] Project "${projectName}" already has LLM contacts — skipping`);
    return {
      projectId,
      projectName,
      contactsGenerated: 0,
      contacts: [],
      source: "llm",
      note: "LLM contacts already exist for this project",
    };
  }

  // Generate contacts using LLM
  const generatedContacts = await generateContactsWithLLM(
    projectName,
    owner,
    contractors,
    sector,
    projectValue,
    location,
    stage,
    preferredRoles,
  );

  if (generatedContacts.length === 0) {
    return {
      projectId,
      projectName,
      contactsGenerated: 0,
      contacts: [],
      source: "llm",
      note: "LLM did not generate any contacts",
    };
  }

  // Determine priority based on project sector and value
  const priority = sector === "mining" || sector === "energy" ? "hot" : "warm";

  // Save to database
  const savedContacts: LLMGeneratedContact[] = [];
  for (const contact of generatedContacts) {
    try {
      // Check for duplicate by name across ALL projects (not just this one)
      const existing = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          sql`LOWER(${contacts.name}) = LOWER(${contact.name})`
        )
        .limit(1);

      if (existing.length > 0) {
        console.log(`[LLM Fallback] Skipping duplicate name "${contact.name}" — already exists in database`);
        continue;
      }

      // Build precise LinkedIn search URL with name + company + title for best results
      const linkedinSearchUrl = generateLinkedInSearchUrl(contact.name, owner, contact.title);

      // No guessed profile URL — use search URL instead (more reliable)
      const linkedinProfileUrl: string | null = null;

      const roleRelevance = classifyRoleRelevance(contact.title, contact.roleBucket);

      const contactData: InsertContact = {
        reportId,
        name: contact.name,
        title: contact.title,
        company: owner, // Use project owner as primary company
        project: projectName,
        priority,
        roleBucket: contact.roleBucket,
        email: contact.email,
        linkedin: null,
        enrichmentStatus: "enriched",
        enrichmentSource: "llm",
        enrichedAt: new Date(),
        linkedinHeadline: `${contact.title} (AI-suggested role)`,
        linkedinLocation: location || null,
        linkedinProfilePic: null,
        verificationStatus: "ai_suggested",
        confidenceScore: contact.confidence || "medium",
        linkedinSearchUrl,
        linkedinProfileUrl: linkedinProfileUrl || null,
        roleRelevance,
        emailVerified: false,
      };

      // Compute and set verification score
      const scoreBreakdown = computeVerificationScore(contactData);
      (contactData as any).verificationScore = scoreBreakdown.total;

      // Quality gate: reject contacts with verification score below threshold
      if (scoreBreakdown.total < MIN_VERIFICATION_SCORE) {
        console.log(`[LLM Fallback] Rejecting "${contact.name}" — verification score ${scoreBreakdown.total} below minimum ${MIN_VERIFICATION_SCORE}`);
        continue;
      }

      await db.insert(contacts).values(contactData);
      savedContacts.push(contact);
    } catch (err) {
      console.error(`[LLM Fallback] Failed to save contact ${contact.name}:`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[LLM Fallback] Project "${projectName}": generated ${savedContacts.length} AI contacts`);

  return {
    projectId,
    projectName,
    contactsGenerated: savedContacts.length,
    contacts: savedContacts,
    source: "llm",
    note: `Generated ${savedContacts.length} AI-suggested contacts. These are role-based suggestions — verify before outreach.`,
  };
}

// ── Bulk LLM fallback for projects without contacts ──

/**
 * Run LLM contact generation on projects that have no contacts yet.
 * Useful when LinkedIn quota is exhausted and we want to populate
 * the contact database with AI-suggested decision-makers.
 */
export async function runLLMFallbackBulk(
  maxProjects?: number,
  preferredRoles?: string[] | null,
): Promise<{
  processed: number;
  contactsGenerated: number;
  results: LLMFallbackResult[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Find projects that have NO contacts at all
  const projectsWithoutContacts = await db
    .select({
      id: projects.id,
      reportId: projects.reportId,
      name: projects.name,
      owner: projects.owner,
      contractors: projects.contractors,
      sector: projects.sector,
      value: projects.value,
      location: projects.location,
      stage: projects.stage,
    })
    .from(projects)
    .where(
      sql`${projects.id} NOT IN (SELECT DISTINCT p.id FROM projects p INNER JOIN contacts c ON c.project = p.name)`
    )
    .limit(maxProjects || 100);

  console.log(`[LLM Fallback Bulk] Found ${projectsWithoutContacts.length} projects without contacts`);

  const results: LLMFallbackResult[] = [];
  let totalContacts = 0;

  for (const project of projectsWithoutContacts) {
    const contractorsList = Array.isArray(project.contractors)
      ? (project.contractors as { name: string; status: string }[])
      : [];

    const result = await generateAndSaveLLMContacts(
      project.id,
      project.reportId,
      project.name,
      project.owner || "Unknown",
      contractorsList,
      project.sector || "infrastructure",
      project.value || "Unknown",
      project.location || "Australia",
      project.stage || undefined,
      preferredRoles,
    );

    results.push(result);
    totalContacts += result.contactsGenerated;

    // Small delay between LLM calls to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return {
    processed: projectsWithoutContacts.length,
    contactsGenerated: totalContacts,
    results,
  };
}
