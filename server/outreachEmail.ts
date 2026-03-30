/**
 * outreachEmail.ts — AI-powered personalised outreach email generator
 * 
 * Generates tailored sales emails based on:
 * - Project details (name, sector, location, value, equipment signals)
 * - Contact info (name, title, company, role)
 * - Atlas Copco Power Technique product/solution knowledge
 * - User's preferred tone (professional, consultative, direct)
 */
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { outreachEmails } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

export interface OutreachInput {
  // Contact info
  contactName: string;
  contactTitle: string;
  contactCompany: string;
  contactEmail: string;
  contactRoleBucket: string;

  // Project info
  projectName: string;
  projectLocation: string;
  projectValue: string;
  projectSector: string;
  projectStage: string | null;
  projectOverview: string | null;
  equipmentSignals: string[] | null;
  opportunityRoute: string;
  matchedBusinessLines: string[];

  // Sender info
  senderName: string;
  senderTitle?: string;
  senderCompany?: string;
  senderBusinessLines?: string[]; // User's assigned BLs — used to focus the outreach on their products

  // Tone / Style
  tone: "professional" | "consultative" | "direct" | "contractor_focused" | "owner_epc_focused" | "procurement_led" | "engineering_led" | "first_touch";
  style?: "standard" | "contractor_focused" | "owner_epc_focused" | "procurement_led" | "engineering_led" | "first_touch";
}

export interface OutreachResult {
  subject: string;
  body: string;
  toneUsed: string;
  keyPoints: string[];
}

const ATLAS_COPCO_PT_KNOWLEDGE = `
Atlas Copco Power Technique provides innovative solutions for the construction, mining, oil & gas, and industrial sectors.

BUSINESS LINES & KEY PRODUCTS:

1. PORTABLE AIR (Compressors):
   - Portable air compressors from 25 to 3000+ CFM
   - Applications: drilling (RC & diamond), blasting, pipeline testing, sandblasting, pneumatic tools
   - Key models: XAS, XATS, XAHS, XAVS, DrillAir series
   - Available as single axle, skid mount, and support mount configurations
   - Fuel-efficient, low emission designs with electronic controllers
   - Aftermarket: service agreements, genuine parts, rental fleet support

2. PAL (Power & Lighting):
   - Diesel and gas generators from 8 kVA to 1500+ kVA
   - LED lighting towers for construction and mining sites
   - Prime, standby, and continuous power solutions
   - Key models: QAS, QIS, QES generator ranges; HiLight tower range
   - Applications: remote site power, construction, events, emergency backup

3. BESS (Battery Energy Storage Systems):
   - ZenergiZe range of battery energy storage
   - Hybrid power solutions combining diesel + battery
   - Peak shaving, load management, and renewable integration
   - Zero-emission power for noise-sensitive and indoor applications
   - Reduces fuel consumption by up to 50% in hybrid configurations

4. PUMP (Flow Solutions):
   - Dewatering pumps for mining and construction
   - Submersible, centrifugal, and wellpoint pumps
   - WEDA range for submersible dewatering
   - PAS range for self-priming centrifugal pumps
   - Applications: mine dewatering, flood control, sewage bypass, construction site drainage

VALUE PROPOSITIONS:
- Total cost of ownership focus (not just purchase price)
- 24/7 service and parts availability across Australia
- Rental and hire-purchase flexibility
- Site assessment and solution design services
- Training and operator certification
- Sustainability: fuel savings, emission reduction, noise reduction
- Digital fleet management (FleetLink telematics)
`;

/**
 * Role-KPI mapping: maps each role bucket to the KPIs, pain points, and
 * messaging angles that resonate most with that persona.
 */
const ROLE_KPI_MAP: Record<string, {
  kpis: string[];
  painPoints: string[];
  messagingAngle: string;
}> = {
  procurement: {
    kpis: ["Total cost of ownership (TCO)", "Supplier consolidation", "Contract compliance", "On-time delivery", "Cost savings vs. budget"],
    painPoints: ["Managing multiple equipment vendors", "Unpredictable maintenance costs", "Long lead times on parts", "Price volatility on hire/purchase"],
    messagingAngle: "Focus on TCO savings, bundled service agreements, single-vendor simplification, and flexible hire-purchase options that protect their budget.",
  },
  engineering: {
    kpis: ["Equipment uptime & reliability", "Technical spec compliance", "Safety standards", "Energy efficiency", "Integration with existing systems"],
    painPoints: ["Equipment failures causing project delays", "Spec mismatches discovered on-site", "Emission compliance pressure", "Noise restrictions near communities"],
    messagingAngle: "Lead with technical credibility — specific CFM/kVA ratings, emission standards met, noise levels, and how Atlas Copco's engineering support de-risks their design.",
  },
  operations: {
    kpis: ["Site productivity (tonnes/hour, metres/day)", "Equipment availability %", "Fuel consumption per unit output", "Safety incident rate", "Shift utilisation"],
    painPoints: ["Unplanned downtime halting production", "Fuel cost blowouts", "Operator skill gaps", "Remote site logistics"],
    messagingAngle: "Emphasise uptime guarantees, FleetLink telematics for real-time monitoring, fuel savings data, and 24/7 service coverage even at remote sites.",
  },
  project_management: {
    kpis: ["On-time project delivery", "Budget adherence", "Resource utilisation", "Stakeholder satisfaction", "Risk mitigation"],
    painPoints: ["Equipment delays pushing back milestones", "Scope creep on temporary power/air needs", "Coordinating multiple subcontractors", "Budget overruns on equipment hire"],
    messagingAngle: "Position Atlas Copco as a reliability partner — guaranteed delivery timelines, rental flexibility to scale up/down, and a single point of contact to simplify their vendor management.",
  },
  maintenance: {
    kpis: ["Mean time between failures (MTBF)", "Planned vs. unplanned maintenance ratio", "Parts availability", "Maintenance cost per operating hour"],
    painPoints: ["Sourcing genuine parts quickly", "Ageing fleet with increasing breakdown frequency", "Lack of OEM support in remote areas", "Training new technicians"],
    messagingAngle: "Highlight genuine parts availability, preventive maintenance programs, operator/technician training, and service agreements that lock in response times.",
  },
  fleet: {
    kpis: ["Fleet utilisation rate", "Cost per operating hour", "Fleet age & replacement cycle", "Fuel efficiency across fleet", "Compliance & certification currency"],
    painPoints: ["Ageing fleet driving up repair costs", "Underutilised assets sitting idle", "Balancing owned vs. hired equipment", "Tracking certification expiry dates"],
    messagingAngle: "Talk fleet strategy — trade-in programs, rent-to-own pathways, FleetLink telematics for utilisation tracking, and lifecycle cost modelling to justify fleet refresh.",
  },
  executive: {
    kpis: ["EBITDA / margin improvement", "Capital allocation efficiency", "ESG / sustainability targets", "Shareholder value", "Strategic partnerships"],
    painPoints: ["Pressure to reduce carbon footprint", "Capital vs. opex trade-offs", "Board-level ESG reporting requirements", "Finding strategic suppliers, not just vendors"],
    messagingAngle: "Elevate the conversation to strategic partnership — sustainability credentials (ZenergiZe BESS, hybrid solutions), total value delivered across their portfolio, and executive-level case studies.",
  },
  construction: {
    kpis: ["Daily pour/placement rates", "Site setup time", "Equipment mobilisation speed", "Safety compliance", "Subcontractor coordination"],
    painPoints: ["Tight construction windows", "Noise and emission restrictions in urban areas", "Power reliability for concrete batching/cranes", "Multiple equipment vendors to coordinate"],
    messagingAngle: "Focus on rapid mobilisation, quiet/low-emission options for urban sites, and bundled air+power+lighting packages that simplify their site setup.",
  },
  other: {
    kpis: ["Operational efficiency", "Cost management", "Risk reduction", "Compliance"],
    painPoints: ["General equipment reliability concerns", "Cost pressures", "Vendor management complexity"],
    messagingAngle: "Take a broad value approach — reliability, service coverage, and flexible commercial models.",
  },
};

/** Get the best role-KPI match for a contact's role bucket */
function getRoleKPIs(roleBucket: string): typeof ROLE_KPI_MAP[string] {
  const normalised = roleBucket.toLowerCase().replace(/[\s_-]+/g, "_");
  // Try exact match first
  if (ROLE_KPI_MAP[normalised]) return ROLE_KPI_MAP[normalised];
  // Try partial match
  for (const [key, value] of Object.entries(ROLE_KPI_MAP)) {
    if (normalised.includes(key) || key.includes(normalised)) return value;
  }
  return ROLE_KPI_MAP.other;
}

export async function generateOutreachEmail(input: OutreachInput): Promise<OutreachResult> {
  const toneGuide: Record<string, string> = {
    professional: "Write in a formal, professional tone. Use proper business language. Be respectful of the recipient's time. Focus on value proposition and credibility.",
    consultative: "Write in a warm, consultative tone. Position yourself as a trusted advisor who understands their challenges. Ask thoughtful questions. Show genuine interest in their project success.",
    direct: "Write in a concise, direct tone. Get straight to the point. Lead with the specific value you can deliver. Include a clear call-to-action. Keep it under 150 words.",
    contractor_focused: "Write specifically for a CONTRACTOR audience (EPC, construction company, mining contractor). They care about: equipment reliability on-site, mobilisation speed, rental flexibility, service response times, and total cost of ownership. Reference their role as the contractor delivering the project — they need equipment that won't let them down. Mention fleet support, 24/7 service, and flexible hire/purchase options. Their pain: equipment delays = liquidated damages.",
    owner_epc_focused: "Write specifically for a PROJECT OWNER or EPC audience. They care about: project timeline adherence, budget control, vendor consolidation, and ESG/sustainability credentials. Position Atlas Copco as a strategic partner, not just a vendor. Reference portfolio-level value, single-vendor simplification, and executive-level case studies. Their pain: managing multiple equipment vendors across a large project portfolio.",
    procurement_led: "Write specifically for a PROCUREMENT audience. They care about: competitive pricing, contract terms, TCO analysis, vendor qualification, and supply chain reliability. Lead with commercial value — bundled pricing, service agreements that lock in costs, trade-in programs, and flexible payment structures. Reference specific cost savings data. Their pain: price volatility, long lead times, and managing multiple vendor relationships.",
    engineering_led: "Write specifically for an ENGINEERING audience. They care about: technical specifications, compliance standards, energy efficiency, noise/emission levels, and system integration. Lead with technical credibility — specific CFM/kVA ratings, emission standards (Tier 4 Final / Stage V), noise levels in dB(A), and how Atlas Copco's engineering support de-risks their design. Reference technical documentation and site assessment capabilities. Their pain: spec mismatches discovered on-site.",
    first_touch: "This is a FIRST-TOUCH cold outreach. The recipient has never heard from you. Be brief (under 120 words), lead with a specific observation about their project that shows you've done your homework, and make a very low-commitment ask (e.g., 'Would it be worth a quick chat?' or 'Happy to share a one-page overview'). Do NOT pitch products in the first email — focus on establishing relevance and curiosity. The goal is to get a reply, not close a deal.",
  };

  const businessLineContext = input.matchedBusinessLines.length > 0
    ? `This project is relevant to: ${input.matchedBusinessLines.join(", ")}. Focus your pitch on the products and solutions from these specific business lines.`
    : "Identify which Atlas Copco Power Technique products would be most relevant based on the project details.";

  const equipmentContext = input.equipmentSignals && input.equipmentSignals.length > 0
    ? `Equipment signals detected: ${input.equipmentSignals.join(", ")}. Reference these specific needs in your email.`
    : "";

  // Get role-specific KPIs and pain points for deep personalisation
  const roleKPIs = getRoleKPIs(input.contactRoleBucket);
  const roleContext = `
ROLE-SPECIFIC PERSONALISATION (CRITICAL — this is what makes the email resonate):
The recipient is a "${input.contactRoleBucket}" persona. Their key KPIs are:
${roleKPIs.kpis.map((k, i) => `  ${i + 1}. ${k}`).join("\n")}

Their typical pain points are:
${roleKPIs.painPoints.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}

Messaging strategy: ${roleKPIs.messagingAngle}

You MUST weave at least 2 of their KPIs or pain points into the email body naturally.
Do NOT list KPIs — instead, demonstrate understanding of their world.
For example, if they are a Procurement Manager, don't say "we can help with TCO" — instead say
"With ${input.projectName} moving into [stage], locking in a service agreement now could save
15-20% on maintenance costs over the project lifecycle compared to ad-hoc call-outs."
`;

  const prompt = `You are a sales email copywriter for Atlas Copco Power Technique. Generate a personalised outreach email.

${ATLAS_COPCO_PT_KNOWLEDGE}

RECIPIENT:
- Name: ${input.contactName}
- Title: ${input.contactTitle}
- Company: ${input.contactCompany}
- Role type: ${input.contactRoleBucket}
${roleContext}

PROJECT CONTEXT:
- Project: ${input.projectName}
- Location: ${input.projectLocation}
- Estimated value: ${input.projectValue}
- Sector: ${input.projectSector}
- Stage: ${input.projectStage || "Unknown"}
- Overview: ${input.projectOverview || "Not available"}
- Opportunity route: ${input.opportunityRoute}
${equipmentContext}
${businessLineContext}

SENDER: ${input.senderName}${input.senderTitle ? `, ${input.senderTitle}` : ""}${input.senderCompany ? ` at ${input.senderCompany}` : " at Atlas Copco Australia - Power Technique"}
${input.senderBusinessLines && input.senderBusinessLines.length > 0 ? `SENDER'S PRODUCT FOCUS: The sender specialises in ${input.senderBusinessLines.join(", ")}. Prioritise these business lines in the email while remaining relevant to the project needs. If the project is more relevant to other BLs, briefly mention the sender's products but focus on the best-fit solution.` : ""}

TONE: ${toneGuide[input.tone]}

RULES:
1. The email MUST feel deeply personalised — reference the specific project by name, the recipient's role, and at least 2 of their role-specific KPIs or pain points
2. Lead with value for THEIR project, not a product pitch — show you understand what keeps them up at night
3. Reference specific Atlas Copco PT products/solutions that match the project needs
4. Include a clear, low-commitment call-to-action (e.g., "Would a 15-minute call this week work?" or "Happy to share a site assessment")
5. Keep the email concise — 3-4 short paragraphs maximum
6. Do NOT use generic phrases like "I hope this email finds you well" or "I wanted to reach out"
7. Do NOT include [placeholder] brackets — use real product names and specific details
8. Sign off with the sender's full name, title, and company on separate lines. Use the SENDER information above for the signature. The signature MUST include: sender name, sender title, company name, and sender email address on separate lines.
9. The subject line should reference the project name and be compelling
10. The opening line should hook them by referencing something specific about their project or role — NOT a self-introduction

Return your response as JSON with this exact structure:
{
  "subject": "Email subject line",
  "body": "Full email body text (use \\n for line breaks between paragraphs)",
  "keyPoints": ["Key selling point 1", "Key selling point 2", "Key selling point 3"]
}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "You are an expert B2B sales email copywriter specialising in industrial equipment and project-based sales. You write emails that get responses because they demonstrate genuine understanding of the recipient's project needs." },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "outreach_email",
        strict: true,
        schema: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Email subject line" },
            body: { type: "string", description: "Full email body with \\n for paragraph breaks" },
            keyPoints: {
              type: "array",
              items: { type: "string" },
              description: "3 key selling points used in the email",
            },
          },
          required: ["subject", "body", "keyPoints"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("LLM returned empty response for outreach email");
  }

  const parsed = JSON.parse(content) as OutreachResult;
  parsed.toneUsed = input.tone;
  return parsed;
}

/**
 * Save an outreach email to the database for tracking.
 */
export async function saveOutreachEmail(params: {
  userId: number;
  contactId?: number;
  contactName: string;
  contactEmail?: string;
  projectId?: number;
  projectName?: string;
  subject: string;
  body: string;
  tone: "professional" | "consultative" | "direct" | "contractor_focused" | "owner_epc_focused" | "procurement_led" | "engineering_led" | "first_touch";
  status: "drafted" | "opened_in_email" | "sent";
}): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(outreachEmails).values({
    userId: params.userId,
    contactId: params.contactId ?? null,
    contactName: params.contactName,
    contactEmail: params.contactEmail ?? null,
    projectId: params.projectId ?? null,
    projectName: params.projectName ?? null,
    subject: params.subject,
    body: params.body,
    tone: params.tone,
    status: params.status,
  });

  return { id: Number(result[0].insertId) };
}

/**
 * Get outreach history for a contact (most recent first).
 */
export async function getOutreachHistory(contactId: number): Promise<{
  id: number;
  userId: number;
  subject: string;
  tone: string;
  status: string;
  createdAt: Date;
}[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select({
    id: outreachEmails.id,
    userId: outreachEmails.userId,
    subject: outreachEmails.subject,
    tone: outreachEmails.tone,
    status: outreachEmails.status,
    createdAt: outreachEmails.createdAt,
  })
    .from(outreachEmails)
    .where(eq(outreachEmails.contactId, contactId))
    .orderBy(desc(outreachEmails.createdAt));
}

/**
 * Get outreach history for a specific user + project combination.
 */
export async function getProjectOutreachHistory(userId: number, projectId: number): Promise<{
  id: number;
  contactName: string;
  contactEmail: string | null;
  subject: string;
  tone: string;
  status: string;
  createdAt: Date;
}[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select({
    id: outreachEmails.id,
    contactName: outreachEmails.contactName,
    contactEmail: outreachEmails.contactEmail,
    subject: outreachEmails.subject,
    tone: outreachEmails.tone,
    status: outreachEmails.status,
    createdAt: outreachEmails.createdAt,
  })
    .from(outreachEmails)
    .where(and(eq(outreachEmails.userId, userId), eq(outreachEmails.projectId, projectId)))
    .orderBy(desc(outreachEmails.createdAt));
}

/**
 * Get a set of contact names that have been contacted by anyone on the team.
 * Used to show "Contacted" badges on the contacts table.
 */
export async function getContactedContactNames(): Promise<Map<string, { userId: number; userName: string | null; sentAt: Date }>> {
  const db = await getDb();
  if (!db) return new Map();

  const rows = await db.select({
    contactName: outreachEmails.contactName,
    contactId: outreachEmails.contactId,
    userId: outreachEmails.userId,
    createdAt: outreachEmails.createdAt,
  })
    .from(outreachEmails)
    .orderBy(desc(outreachEmails.createdAt));

  // Deduplicate: keep the most recent outreach per contact name
  const map = new Map<string, { userId: number; userName: string | null; sentAt: Date }>();
  for (const row of rows) {
    const key = row.contactName.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { userId: row.userId, userName: null, sentAt: row.createdAt });
    }
  }
  return map;
}

/**
 * Get contacted contact names as a simple list for the API.
 */
export async function getContactedContactList(): Promise<{
  contactName: string;
  contactId: number | null;
  userId: number;
  sentAt: Date;
}[]> {
  const db = await getDb();
  if (!db) return [];

  // Get the most recent outreach per contact name using a subquery approach
  const rows = await db.select({
    contactName: outreachEmails.contactName,
    contactId: outreachEmails.contactId,
    userId: outreachEmails.userId,
    sentAt: outreachEmails.createdAt,
  })
    .from(outreachEmails)
    .orderBy(desc(outreachEmails.createdAt));

  // Deduplicate by contact name (keep most recent)
  const seen = new Set<string>();
  const result: { contactName: string; contactId: number | null; userId: number; sentAt: Date }[] = [];
  for (const row of rows) {
    const key = row.contactName.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push({
        contactName: row.contactName,
        contactId: row.contactId,
        userId: row.userId,
        sentAt: row.sentAt,
      });
    }
  }
  return result;
}

/**
 * Get outreach leaderboard — count of emails per user in a given time window.
 */
export async function getOutreachLeaderboard(sinceDate?: Date): Promise<{
  userId: number;
  count: number;
}[]> {
  const db = await getDb();
  if (!db) return [];

  const { sql, count } = await import("drizzle-orm");
  
  let query;
  if (sinceDate) {
    query = db.select({
      userId: outreachEmails.userId,
      count: count(),
    })
      .from(outreachEmails)
      .where(sql`${outreachEmails.createdAt} >= ${sinceDate}`)
      .groupBy(outreachEmails.userId)
      .orderBy(desc(count()));
  } else {
    query = db.select({
      userId: outreachEmails.userId,
      count: count(),
    })
      .from(outreachEmails)
      .groupBy(outreachEmails.userId)
      .orderBy(desc(count()));
  }

  const rows = await query;
  return rows.map(r => ({ userId: r.userId, count: Number(r.count) }));
}

/**
 * Get all outreach emails sent by a user.
 */
export async function getUserOutreachHistory(userId: number): Promise<{
  id: number;
  contactName: string;
  contactEmail: string | null;
  projectName: string | null;
  subject: string;
  tone: string;
  status: string;
  createdAt: Date;
}[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select({
    id: outreachEmails.id,
    contactName: outreachEmails.contactName,
    contactEmail: outreachEmails.contactEmail,
    projectName: outreachEmails.projectName,
    subject: outreachEmails.subject,
    tone: outreachEmails.tone,
    status: outreachEmails.status,
    createdAt: outreachEmails.createdAt,
  })
    .from(outreachEmails)
    .where(eq(outreachEmails.userId, userId))
    .orderBy(desc(outreachEmails.createdAt));
}
