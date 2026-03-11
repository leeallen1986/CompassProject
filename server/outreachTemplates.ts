/**
 * outreachTemplates.ts — Outreach email template library
 * 
 * Allows sales reps to:
 * - Save successful outreach emails as reusable templates
 * - Browse/filter templates by role, sector, tone, popularity
 * - Apply a template to a new contact with auto-personalisation via LLM
 * - Track usage to surface the most popular templates
 */
import { getDb } from "./db";
import { outreachTemplates } from "../drizzle/schema";
import { eq, desc, and, or, sql, like } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";

export interface CreateTemplateInput {
  name: string;
  description?: string;
  subject: string;
  body: string;
  tone: "professional" | "consultative" | "direct" | "contractor_focused" | "owner_epc_focused" | "procurement_led" | "engineering_led" | "first_touch";
  roleBucket?: string;
  sector?: string;
  tags?: string[];
  createdBy: number;
  createdByName?: string;
  isShared?: boolean;
}

export interface UpdateTemplateInput {
  id: number;
  name?: string;
  description?: string;
  subject?: string;
  body?: string;
  tone?: "professional" | "consultative" | "direct" | "contractor_focused" | "owner_epc_focused" | "procurement_led" | "engineering_led" | "first_touch";
  roleBucket?: string;
  sector?: string;
  tags?: string[];
  isShared?: boolean;
}

export interface TemplateFilter {
  roleBucket?: string;
  sector?: string;
  tone?: string;
  search?: string;
  createdBy?: number;
  sharedOnly?: boolean;
}

export interface PersonaliseInput {
  templateId: number;
  contactName: string;
  contactTitle: string;
  contactCompany: string;
  contactEmail: string;
  contactRoleBucket: string;
  projectName: string;
  projectLocation: string;
  projectValue: string;
  projectSector: string;
  projectStage: string | null;
  projectOverview: string | null;
  equipmentSignals: string[] | null;
  matchedBusinessLines: string[];
  senderName: string;
}

/**
 * Create a new outreach template.
 */
export async function createTemplate(input: CreateTemplateInput): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(outreachTemplates).values({
    name: input.name,
    description: input.description ?? null,
    subject: input.subject,
    body: input.body,
    tone: input.tone,
    roleBucket: input.roleBucket ?? null,
    sector: input.sector ?? null,
    tags: input.tags ?? null,
    createdBy: input.createdBy,
    createdByName: input.createdByName ?? null,
    isShared: input.isShared ?? true,
  });

  return { id: Number(result[0].insertId) };
}

/**
 * List templates with optional filtering.
 */
export async function listTemplates(filter?: TemplateFilter): Promise<{
  id: number;
  name: string;
  description: string | null;
  subject: string;
  body: string;
  tone: string;
  roleBucket: string | null;
  sector: string | null;
  tags: string[] | null;
  usageCount: number;
  createdBy: number;
  createdByName: string | null;
  isShared: boolean;
  createdAt: Date;
  updatedAt: Date;
}[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions: ReturnType<typeof eq>[] = [];

  if (filter?.roleBucket) {
    conditions.push(eq(outreachTemplates.roleBucket, filter.roleBucket));
  }
  if (filter?.sector) {
    conditions.push(eq(outreachTemplates.sector, filter.sector));
  }
  if (filter?.tone) {
    conditions.push(eq(outreachTemplates.tone, filter.tone as any));
  }
  if (filter?.createdBy) {
    conditions.push(eq(outreachTemplates.createdBy, filter.createdBy));
  }

  // Build the query
  let query;
  if (filter?.sharedOnly) {
    conditions.push(eq(outreachTemplates.isShared, true));
  }

  if (conditions.length > 0) {
    query = db.select().from(outreachTemplates)
      .where(and(...conditions))
      .orderBy(desc(outreachTemplates.usageCount), desc(outreachTemplates.createdAt));
  } else {
    query = db.select().from(outreachTemplates)
      .orderBy(desc(outreachTemplates.usageCount), desc(outreachTemplates.createdAt));
  }

  const rows = await query;

  // Apply text search filter client-side (simpler than SQL LIKE for multiple fields)
  if (filter?.search) {
    const q = filter.search.toLowerCase();
    return rows.filter((r: typeof rows[number]) =>
      r.name.toLowerCase().includes(q) ||
      (r.description && r.description.toLowerCase().includes(q)) ||
      r.subject.toLowerCase().includes(q) ||
      (r.tags && r.tags.some((t: string) => t.toLowerCase().includes(q)))
    );
  }

  return rows;
}

/**
 * Get a single template by ID.
 */
export async function getTemplateById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(outreachTemplates)
    .where(eq(outreachTemplates.id, id))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Update an existing template.
 */
export async function updateTemplate(input: UpdateTemplateInput): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.subject !== undefined) updates.subject = input.subject;
  if (input.body !== undefined) updates.body = input.body;
  if (input.tone !== undefined) updates.tone = input.tone;
  if (input.roleBucket !== undefined) updates.roleBucket = input.roleBucket;
  if (input.sector !== undefined) updates.sector = input.sector;
  if (input.tags !== undefined) updates.tags = input.tags;
  if (input.isShared !== undefined) updates.isShared = input.isShared;

  if (Object.keys(updates).length === 0) return { success: true };

  await db.update(outreachTemplates)
    .set(updates)
    .where(eq(outreachTemplates.id, input.id));

  return { success: true };
}

/**
 * Delete a template by ID. Only the creator can delete.
 */
export async function deleteTemplate(id: number, userId: number): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Verify ownership
  const template = await getTemplateById(id);
  if (!template) throw new Error("Template not found");
  if (template.createdBy !== userId) throw new Error("Only the template creator can delete it");

  await db.delete(outreachTemplates)
    .where(eq(outreachTemplates.id, id));

  return { success: true };
}

/**
 * Increment usage count when a template is used.
 */
export async function incrementTemplateUsage(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.update(outreachTemplates)
    .set({ usageCount: sql`${outreachTemplates.usageCount} + 1` })
    .where(eq(outreachTemplates.id, id));
}

/**
 * Apply a template to a new contact — uses LLM to personalise the template
 * with the specific contact and project details while preserving the template's
 * proven structure and messaging approach.
 */
export async function personaliseTemplate(input: PersonaliseInput): Promise<{
  subject: string;
  body: string;
}> {
  const template = await getTemplateById(input.templateId);
  if (!template) throw new Error("Template not found");

  // Increment usage
  await incrementTemplateUsage(input.templateId);

  const prompt = `You are an expert sales email personaliser. You have a proven outreach email template that has been successful. Your job is to adapt it for a NEW contact and project while preserving the template's structure, tone, and messaging approach.

ORIGINAL TEMPLATE:
Subject: ${template.subject}
Body:
${template.body}

NEW CONTACT DETAILS:
- Name: ${input.contactName}
- Title: ${input.contactTitle}
- Company: ${input.contactCompany}
- Email: ${input.contactEmail}
- Role: ${input.contactRoleBucket}

NEW PROJECT DETAILS:
- Project: ${input.projectName}
- Location: ${input.projectLocation}
- Value: ${input.projectValue}
- Sector: ${input.projectSector}
- Stage: ${input.projectStage || "Not specified"}
- Overview: ${input.projectOverview || "Not available"}
- Equipment needs: ${input.equipmentSignals?.join(", ") || "Not specified"}
- Business lines: ${input.matchedBusinessLines.join(", ") || "General"}

SENDER: ${input.senderName}, Atlas Copco Power Technique

INSTRUCTIONS:
1. Keep the same overall structure, flow, and persuasion approach as the original template
2. Replace all contact-specific details (name, title, company) with the new contact's info
3. Replace all project-specific details (project name, location, value, equipment) with the new project's info
4. Adjust any role-specific messaging to match the new contact's role
5. Keep the same tone and length as the original
6. Update the sender name
7. Do NOT add new sections or significantly change the template's proven approach

Return ONLY valid JSON:
{
  "subject": "The personalised subject line",
  "body": "The personalised email body"
}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "You personalise sales email templates. Return only valid JSON." },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "personalised_email",
        strict: true,
        schema: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Personalised subject line" },
            body: { type: "string", description: "Personalised email body" },
          },
          required: ["subject", "body"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty response");
  const contentStr = typeof content === "string" ? content : JSON.stringify(content);

  const parsed = JSON.parse(contentStr);
  return {
    subject: parsed.subject,
    body: parsed.body,
  };
}

/**
 * Get template stats for the library overview.
 */
export async function getTemplateStats(): Promise<{
  totalTemplates: number;
  totalUsage: number;
  topRoles: { role: string; count: number }[];
  topTones: { tone: string; count: number }[];
}> {
  const db = await getDb();
  if (!db) return { totalTemplates: 0, totalUsage: 0, topRoles: [], topTones: [] };

  const { count, sum } = await import("drizzle-orm");

  const allTemplates = await db.select().from(outreachTemplates);
  const totalTemplates = allTemplates.length;
  const totalUsage = allTemplates.reduce((acc: number, t: typeof allTemplates[number]) => acc + t.usageCount, 0);

  // Aggregate by role
  const roleMap = new Map<string, number>();
  for (const t of allTemplates) {
    const role = t.roleBucket || "general";
    roleMap.set(role, (roleMap.get(role) || 0) + 1);
  }
  const topRoles = Array.from(roleMap.entries())
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Aggregate by tone
  const toneMap = new Map<string, number>();
  for (const t of allTemplates) {
    toneMap.set(t.tone, (toneMap.get(t.tone) || 0) + 1);
  }
  const topTones = Array.from(toneMap.entries())
    .map(([tone, count]) => ({ tone, count }))
    .sort((a, b) => b.count - a.count);

  return { totalTemplates, totalUsage, topRoles, topTones };
}
